//! Draws a [`DisplayList`] into a tiny-skia pixmap. Shapes go through tiny-skia; glyphs are rendered once by
//! swash into alpha masks, cached, and blended by hand, as are the blurred masks of shadows and glows, so a
//! frame mostly copies cached pixels.

use crate::color::Color;
use crate::display::{BoxStyle, Cmd, DisplayList, Item, Paint, Shadow, Stroke};
use crate::text::{ShapedRun, font_ref};
use std::collections::HashMap;
use std::sync::Arc;
use swash::scale::{Render, ScaleContext, Source};
use swash::zeno::{Format, Vector};
use tiny_skia::{
    FillRule, GradientStop, LinearGradient, Mask, Path, PathBuilder, Pixmap, PixmapPaint, Point, RadialGradient, Rect,
    Shader, SpreadMode, Transform,
};

/// An 8-bit coverage mask placed in device pixels.
struct AlphaMask {
    left: i32,
    top: i32,
    w: usize,
    h: usize,
    data: Vec<u8>,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct GlyphKey {
    face: u8,
    id: u16,
    weight: u32,
    css_size: u32,
    size: u32,
    fx: u8,
    fy: u8,
}

struct Clip {
    /// Device pixels outside this box are never drawn.
    scissor: (i32, i32, i32, i32),
    mask: Option<Arc<Mask>>,
}

/// What a thread keeps between frames: glyph, shadow and clip caches.
pub struct Renderer {
    scaler: ScaleContext,
    glyphs: HashMap<GlyphKey, Option<Arc<AlphaMask>>>,
    blurs: HashMap<Vec<u32>, Arc<AlphaMask>>,
    masks: HashMap<Vec<u32>, Arc<Mask>>,
}

impl Default for Renderer {
    fn default() -> Self {
        Renderer { scaler: ScaleContext::new(), glyphs: HashMap::new(), blurs: HashMap::new(), masks: HashMap::new() }
    }
}

const SUBPIXEL: f32 = 4.0;

fn rrect(r: Rect, radius: f32) -> Option<Path> {
    let radius = radius.min(r.width() / 2.0).min(r.height() / 2.0).max(0.0);
    if radius <= 0.0 {
        return Some(PathBuilder::from_rect(r));
    }
    let (x0, y0, x1, y1) = (r.left(), r.top(), r.right(), r.bottom());
    let k = radius * (1.0 - 0.552_284_8);
    let mut pb = PathBuilder::new();
    pb.move_to(x0 + radius, y0);
    pb.line_to(x1 - radius, y0);
    pb.cubic_to(x1 - k, y0, x1, y0 + k, x1, y0 + radius);
    pb.line_to(x1, y1 - radius);
    pb.cubic_to(x1, y1 - k, x1 - k, y1, x1 - radius, y1);
    pb.line_to(x0 + radius, y1);
    pb.cubic_to(x0 + k, y1, x0, y1 - k, x0, y1 - radius);
    pb.line_to(x0, y0 + radius);
    pb.cubic_to(x0, y0 + k, x0 + k, y0, x0 + radius, y0);
    pb.close();
    pb.finish()
}

fn inset(r: Rect, d: f32) -> Option<Rect> {
    Rect::from_ltrb(r.left() + d, r.top() + d, r.right() - d, r.bottom() - d)
}

fn shader(paint: &Paint, opacity: f32, transform: Transform) -> Option<Shader<'static>> {
    let stops =
        |stops: &[(f32, Color)]| stops.iter().map(|&(o, c)| GradientStop::new(o, c.fade(opacity).to_skia())).collect();
    match paint {
        Paint::Solid(c) => Some(Shader::SolidColor(c.fade(opacity).to_skia())),
        Paint::Linear { start, end, stops: s } => LinearGradient::new(
            Point::from_xy(start.0, start.1),
            Point::from_xy(end.0, end.1),
            stops(s),
            SpreadMode::Pad,
            transform,
        ),
        Paint::Radial { center, radius, stops: s } => RadialGradient::new(
            Point::from_xy(0.0, 0.0),
            Point::from_xy(0.0, 0.0),
            1.0,
            stops(s),
            SpreadMode::Pad,
            transform.pre_concat(Transform::from_row(radius.0, 0.0, 0.0, radius.1, center.0, center.1)),
        ),
    }
}

fn skia_paint(shader: Shader<'static>) -> tiny_skia::Paint<'static> {
    tiny_skia::Paint { shader, anti_alias: true, ..Default::default() }
}

/// Box blur passes approximating a gaussian of `sigma` (W3C's three-box method).
fn blur(data: &mut [f32], w: usize, h: usize, sigma: f32) {
    if sigma < 0.5 {
        return;
    }
    let d = ((sigma * 3.0 * (2.0 * std::f32::consts::PI).sqrt() / 4.0) + 0.5).floor() as usize;
    if d == 0 {
        return;
    }
    let mut tmp = vec![0.0f32; data.len()];
    let pass = |src: &[f32],
                dst: &mut [f32],
                len: usize,
                stride: usize,
                lines: usize,
                line_stride: usize,
                r0: usize,
                r1: usize| {
        let size = (r0 + r1 + 1) as f32;
        for l in 0..lines {
            let base = l * line_stride;
            let mut acc = 0.0f32;
            for i in 0..=r1.min(len.saturating_sub(1)) {
                acc += src[base + i * stride];
            }
            for i in 0..len {
                dst[base + i * stride] = acc / size;
                if i + r1 + 1 < len {
                    acc += src[base + (i + r1 + 1) * stride];
                }
                if i >= r0 {
                    acc -= src[base + (i - r0) * stride];
                }
            }
        }
    };
    let radii = if d % 2 == 1 { [(d / 2, d / 2); 3] } else { [(d / 2, d / 2 - 1), (d / 2 - 1, d / 2), (d / 2, d / 2)] };
    for &(a, b) in &radii {
        pass(data, &mut tmp, w, 1, h, w, a, b);
        data.copy_from_slice(&tmp);
    }
    for &(a, b) in &radii {
        pass(data, &mut tmp, h, w, w, 1, a, b);
        data.copy_from_slice(&tmp);
    }
}

fn quant(v: f32) -> u32 {
    (v * 4.0).round() as u32
}

impl Renderer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Draws `list` over `pixmap`, every item under `base` (the frame's scale).
    pub fn draw(&mut self, list: &DisplayList, pixmap: &mut Pixmap, base: Transform) {
        if self.glyphs.len() > 200_000 {
            self.glyphs.clear();
        }
        if self.blurs.len() > 4_000 {
            self.blurs.clear();
        }
        if self.masks.len() > 64 {
            self.masks.clear();
        }
        let full = (0, 0, pixmap.width() as i32, pixmap.height() as i32);
        let mut clips = vec![Clip { scissor: full, mask: None }];
        let mut layers: Vec<(Pixmap, f32)> = Vec::new();
        for cmd in &list.cmds {
            let t = cmd.transform.post_concat(base);
            match &cmd.item {
                Item::PushClip { rect, radius } => {
                    let clip = self.clip(clips.last().unwrap(), *rect, *radius, t, pixmap.width(), pixmap.height());
                    clips.push(clip);
                }
                Item::PopClip => {
                    if clips.len() > 1 {
                        clips.pop();
                    }
                }
                Item::PushLayer { opacity } => {
                    let layer = Pixmap::new(pixmap.width(), pixmap.height()).unwrap();
                    layers.push((layer, opacity * cmd.opacity));
                }
                Item::PopLayer => {
                    if let Some((layer, opacity)) = layers.pop() {
                        let target = layers.last_mut().map_or(&mut *pixmap, |l| &mut l.0);
                        let paint = PixmapPaint { opacity, ..Default::default() };
                        target.draw_pixmap(0, 0, layer.as_ref(), &paint, Transform::identity(), None);
                    }
                }
                _ => {
                    let target = layers.last_mut().map_or(&mut *pixmap, |l| &mut l.0);
                    self.item(cmd, t, target, clips.last().unwrap());
                }
            }
        }
    }

    fn clip(&mut self, outer: &Clip, rect: Rect, radius: f32, t: Transform, w: u32, h: u32) -> Clip {
        let b = rect.transform(t).unwrap_or(rect);
        let s = (
            (b.left().floor() as i32).max(outer.scissor.0),
            (b.top().floor() as i32).max(outer.scissor.1),
            (b.right().ceil() as i32).min(outer.scissor.2),
            (b.bottom().ceil() as i32).min(outer.scissor.3),
        );
        let axis_aligned = t.kx == 0.0 && t.ky == 0.0;
        let pixel_exact = [b.left(), b.top(), b.right(), b.bottom()].iter().all(|v| (v - v.round()).abs() < 0.01);
        if radius <= 0.0 && axis_aligned && pixel_exact {
            return Clip { scissor: s, mask: outer.mask.clone() };
        }
        let key = [rect.left(), rect.top(), rect.width(), rect.height(), radius, t.sx, t.sy, t.tx, t.ty]
            .iter()
            .map(|v| v.to_bits())
            .collect::<Vec<_>>();
        let mask = self
            .masks
            .entry(key)
            .or_insert_with(|| {
                let mut m = Mask::new(w, h).unwrap();
                if let Some(p) = rrect(rect, radius) {
                    m.fill_path(&p, FillRule::Winding, true, t);
                }
                Arc::new(m)
            })
            .clone();
        Clip { scissor: s, mask: Some(mask) }
    }

    fn item(&mut self, cmd: &Cmd, t: Transform, target: &mut Pixmap, clip: &Clip) {
        let op = cmd.opacity;
        match &cmd.item {
            Item::Box { rect, style } => self.boxed(*rect, style, op, t, target, clip),
            Item::Path { path, fill, stroke } => {
                if let Some(fill) = fill
                    && let Some(sh) = shader(fill, op, t)
                {
                    target.fill_path(path, &skia_paint(sh), FillRule::Winding, t, clip.mask.as_deref());
                }
                if let Some(s) = stroke {
                    self.stroke(path, s, op, t, target, clip);
                }
            }
            Item::Text { run, x, y, color, glow } => {
                if let Some((radius, gc)) = glow
                    && let Some(m) = self.glow(run, *radius, t)
                {
                    let (ox, oy) = t.map_xy(*x, *y);
                    blit(target, &m, ox.round() as i32, oy.round() as i32, gc.fade(op), clip);
                }
                self.glyphs(run, *x, *y, color.fade(op), t, target, clip);
            }
            _ => {}
        }
    }

    fn stroke(&mut self, path: &Path, s: &Stroke, op: f32, t: Transform, target: &mut Pixmap, clip: &Clip) {
        let mut st = tiny_skia::Stroke { width: s.width, ..Default::default() };
        if s.round {
            st.line_join = tiny_skia::LineJoin::Round;
            st.line_cap = tiny_skia::LineCap::Round;
        }
        if let Some((d, g)) = s.dash {
            st.dash = tiny_skia::StrokeDash::new(vec![d, g], 0.0);
        }
        let paint = skia_paint(Shader::SolidColor(s.color.fade(op).to_skia()));
        target.stroke_path(path, &paint, &st, t, clip.mask.as_deref());
    }

    fn boxed(&mut self, rect: Rect, style: &BoxStyle, op: f32, t: Transform, target: &mut Pixmap, clip: &Clip) {
        for sh in &style.shadows {
            if let Some(m) = self.shadow(rect, style.radius, sh, t) {
                let (ox, oy) = t.map_xy(rect.left(), rect.top());
                blit(target, &m, ox.round() as i32, oy.round() as i32, sh.color.fade(op), clip);
            }
        }
        let Some(outer) = rrect(rect, style.radius) else { return };
        if let Some(fill) = &style.fill
            && let Some(sh) = shader(fill, op, t)
        {
            target.fill_path(&outer, &skia_paint(sh), FillRule::Winding, t, clip.mask.as_deref());
        }
        if let Some(b) = &style.border {
            if b.dash.is_some() {
                if let Some(r) = inset(rect, b.width / 2.0)
                    && let Some(p) = rrect(r, (style.radius - b.width / 2.0).max(0.0))
                {
                    self.stroke(&p, b, op, t, target, clip);
                }
            } else if let Some(inner) = inset(rect, b.width) {
                let mut pb = PathBuilder::new();
                pb.push_path(&outer);
                if let Some(p) = rrect(inner, (style.radius - b.width).max(0.0)) {
                    pb.push_path(&p);
                }
                if let Some(ring) = pb.finish() {
                    let paint = skia_paint(Shader::SolidColor(b.color.fade(op).to_skia()));
                    target.fill_path(&ring, &paint, FillRule::EvenOdd, t, clip.mask.as_deref());
                }
            }
        }
    }

    /// A box shadow's mask, relative to the box's device origin, with the box itself cut out as CSS does.
    fn shadow(&mut self, rect: Rect, radius: f32, sh: &Shadow, t: Transform) -> Option<Arc<AlphaMask>> {
        let s = t.sy.abs().max(t.sx.abs());
        let (w, h) = (rect.width() * s, rect.height() * s);
        let key = vec![
            0,
            quant(w),
            quant(h),
            quant(radius * s),
            quant(sh.blur * s),
            quant(sh.spread * s),
            quant(sh.dx * s + 1e4),
            quant(sh.dy * s + 1e4),
        ];
        if let Some(m) = self.blurs.get(&key) {
            return Some(m.clone());
        }
        let sigma = sh.blur * s / 2.0;
        let margin = (sigma * 3.0).ceil() + (sh.spread * s).abs().ceil() + 2.0;
        let (dx, dy) = (sh.dx * s, sh.dy * s);
        let left = (dx.min(0.0) - margin).floor();
        let top = (dy.min(0.0) - margin).floor();
        let bw = (w + dx.abs() + 2.0 * margin).ceil() as u32 + 2;
        let bh = (h + dy.abs() + 2.0 * margin).ceil() as u32 + 2;
        let mut shape = Mask::new(bw, bh)?;
        let spread = sh.spread * s;
        let r = Rect::from_xywh(dx - left - spread, dy - top - spread, w + 2.0 * spread, h + 2.0 * spread)?;
        shape.fill_path(&rrect(r, (radius * s + spread).max(0.0))?, FillRule::Winding, true, Transform::identity());
        let mut data: Vec<f32> = shape.data().iter().map(|&v| v as f32).collect();
        blur(&mut data, bw as usize, bh as usize, sigma);
        let mut hole = Mask::new(bw, bh)?;
        hole.fill_path(
            &rrect(Rect::from_xywh(-left, -top, w, h)?, radius * s)?,
            FillRule::Winding,
            true,
            Transform::identity(),
        );
        let out: Vec<u8> = data
            .iter()
            .zip(hole.data())
            .map(|(&v, &hv)| (v * (255.0 - hv as f32) / 255.0).round().clamp(0.0, 255.0) as u8)
            .collect();
        let m = Arc::new(AlphaMask { left: left as i32, top: top as i32, w: bw as usize, h: bh as usize, data: out });
        self.blurs.insert(key, m.clone());
        Some(m)
    }

    /// A text-shadow glow around a run, relative to the run's device origin.
    fn glow(&mut self, run: &Arc<ShapedRun>, radius: f32, t: Transform) -> Option<Arc<AlphaMask>> {
        let s = t.sy.abs();
        let key = vec![1, (run.key >> 32) as u32, run.key as u32, quant(s * run.style.size), quant(radius * s)];
        if let Some(m) = self.blurs.get(&key) {
            return Some(m.clone());
        }
        let sigma = radius * s / 2.0;
        let margin = (sigma * 3.0).ceil() as i32 + 2;
        let size = run.style.size * s;
        let ascent = (size * 1.2).ceil() as i32;
        let (w, h) = ((run.width * s).ceil() as i32 + 2 * margin, ascent + (size * 0.4).ceil() as i32 + 2 * margin);
        let mut buf = vec![0.0f32; (w * h) as usize];
        for g in &run.glyphs {
            if let Some((m, ix, iy)) =
                self.glyph(run, g.id, size, g.x * s + margin as f32, g.y * s + (ascent + margin) as f32)
            {
                for row in 0..m.h {
                    for col in 0..m.w {
                        let (x, y) = (ix + m.left + col as i32, iy + m.top + row as i32);
                        if x >= 0 && y >= 0 && x < w && y < h {
                            let i = (y * w + x) as usize;
                            buf[i] = (buf[i] + m.data[row * m.w + col] as f32).min(255.0);
                        }
                    }
                }
            }
        }
        blur(&mut buf, w as usize, h as usize, sigma);
        let m = Arc::new(AlphaMask {
            left: -margin,
            top: -(ascent + margin),
            w: w as usize,
            h: h as usize,
            data: buf.iter().map(|v| v.round().clamp(0.0, 255.0) as u8).collect(),
        });
        self.blurs.insert(key, m.clone());
        Some(m)
    }

    /// A glyph's coverage for a pen at device (x, y): the cached mask, relative to the pen's whole pixel,
    /// and that pixel.
    fn glyph(&mut self, run: &ShapedRun, id: u16, size: f32, x: f32, y: f32) -> Option<(Arc<AlphaMask>, i32, i32)> {
        let (ix, iy) = (x.floor(), y.floor());
        let fx = ((x - ix) * SUBPIXEL).floor() as u8;
        let fy = ((y - iy) * SUBPIXEL).floor() as u8;
        let key = GlyphKey {
            face: run.style.face as u8,
            id,
            weight: run.style.weight.to_bits(),
            css_size: run.style.size.to_bits(),
            size: size.to_bits(),
            fx,
            fy,
        };
        let mask = match self.glyphs.get(&key) {
            Some(m) => m.clone(),
            None => {
                let font = font_ref(run.style.face);
                let mut scaler =
                    self.scaler.builder(font).size(size).hint(false).normalized_coords(run.coords.iter()).build();
                let offset = Vector::new(fx as f32 / SUBPIXEL, -(fy as f32) / SUBPIXEL);
                let m = Render::new(&[Source::Outline])
                    .format(Format::Alpha)
                    .offset(offset)
                    .render(&mut scaler, id)
                    .filter(|img| img.placement.width > 0 && img.placement.height > 0)
                    .map(|img| {
                        Arc::new(AlphaMask {
                            left: img.placement.left,
                            top: -img.placement.top,
                            w: img.placement.width as usize,
                            h: img.placement.height as usize,
                            data: img.data,
                        })
                    });
                self.glyphs.insert(key, m.clone());
                m
            }
        }?;
        Some((mask, ix as i32, iy as i32))
    }

    #[allow(clippy::too_many_arguments)]
    fn glyphs(
        &mut self,
        run: &ShapedRun,
        x: f32,
        y: f32,
        color: Color,
        t: Transform,
        target: &mut Pixmap,
        clip: &Clip,
    ) {
        if color.a <= 0.0 {
            return;
        }
        let size = run.style.size * t.sy.abs();
        for g in &run.glyphs {
            let (dx, dy) = t.map_xy(x + g.x, y + g.y);
            if let Some((m, ix, iy)) = self.glyph(run, g.id, size, dx, dy) {
                blit(target, &m, ix, iy, color, clip);
            }
        }
    }
}

/// Blends `color` through a mask placed at (ox, oy) + its own offset, source-over, premultiplied.
fn blit(target: &mut Pixmap, m: &AlphaMask, ox: i32, oy: i32, color: Color, clip: &Clip) {
    let a = color.a.clamp(0.0, 1.0);
    if a <= 0.0 {
        return;
    }
    let (w, h) = (target.width() as i32, target.height() as i32);
    let (sx0, sy0, sx1, sy1) = clip.scissor;
    let x0 = (ox + m.left).max(sx0).max(0);
    let y0 = (oy + m.top).max(sy0).max(0);
    let x1 = (ox + m.left + m.w as i32).min(sx1).min(w);
    let y1 = (oy + m.top + m.h as i32).min(sy1).min(h);
    if x0 >= x1 || y0 >= y1 {
        return;
    }
    let cr = color.r.clamp(0.0, 1.0) * 255.0;
    let cg = color.g.clamp(0.0, 1.0) * 255.0;
    let cb = color.b.clamp(0.0, 1.0) * 255.0;
    let alpha = (a * 65536.0 / 255.0) as u32;
    let mask = clip.mask.as_deref();
    let data = target.data_mut();
    for y in y0..y1 {
        let mrow = ((y - oy - m.top) as usize) * m.w;
        for x in x0..x1 {
            let mut cov = m.data[mrow + (x - ox - m.left) as usize] as u32;
            if cov == 0 {
                continue;
            }
            if let Some(mk) = mask {
                cov = cov * mk.data()[(y * w + x) as usize] as u32 / 255;
                if cov == 0 {
                    continue;
                }
            }
            // Source alpha in 0..=65536.
            let sa = cov * alpha;
            let sa = sa.min(65536);
            let inv = 65536 - sa;
            let i = ((y * w + x) * 4) as usize;
            let px = &mut data[i..i + 4];
            px[0] = ((cr as u32 * sa + px[0] as u32 * inv + 32768) >> 16) as u8;
            px[1] = ((cg as u32 * sa + px[1] as u32 * inv + 32768) >> 16) as u8;
            px[2] = ((cb as u32 * sa + px[2] as u32 * inv + 32768) >> 16) as u8;
            px[3] = ((255 * sa + px[3] as u32 * inv + 32768) >> 16) as u8;
        }
    }
}

trait MapXy {
    fn map_xy(&self, x: f32, y: f32) -> (f32, f32);
}

impl MapXy for Transform {
    fn map_xy(&self, x: f32, y: f32) -> (f32, f32) {
        (self.sx * x + self.kx * y + self.tx, self.ky * x + self.sy * y + self.ty)
    }
}
