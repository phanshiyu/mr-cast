//! The image scene: a picture in a frame with its caption and credit, a slow pan and zoom (`kenBurns`), and the
//! regions steps light. A port of src/components/ImageFrame.tsx, Picture.tsx and src/utils/imageLayout.ts.

use super::media::{Focus, downscale, header_box, target_steps};
use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, interpolate};
use crate::chrome::fittext::{Align, LineHeight, TextOpts, draw_fit, drawn_width, fit_height};
use crate::chrome::shell::{Aside, Shell};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint, Path, PathBuilder, Shadow, Stroke};
use crate::icons;
use crate::text::{Style, width};
use crate::textfit::{Fit, Slot, fit_text};
use crate::theme::{ACCENT, ACCENT_GLOW, BG, BORDER_STRONG, FAINT, RAISED, TEXT};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tiny_skia::{Pixmap, Rect};

const DIM: f64 = 0.58;
const RADIUS: f32 = 18.0;
const UNKNOWN_ASPECT: f64 = 16.0 / 9.0;
const CAPTION_GAP: f64 = 18.0;
const PUSH_IN: [f64; 4] = [0.06, 0.06, 0.88, 0.88];
const WHOLE: [f64; 4] = [0.0, 0.0, 1.0, 1.0];

#[derive(Deserialize)]
struct Region {
    id: String,
    #[serde(rename = "box")]
    at: [f64; 4],
    label: Option<String>,
}

#[derive(Deserialize)]
struct ImageScene {
    src: String,
    fit: Option<String>,
    caption: Option<String>,
    credit: Option<String>,
    #[serde(default, rename = "kenBurns")]
    ken_burns: Value,
    #[serde(default)]
    regions: Vec<Region>,
}

#[derive(Clone, Copy, Debug)]
struct Box4 {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

struct Layout {
    frame: Box4,
    base: Box4,
    caption: Option<Fit>,
    credit: Option<Fit>,
    caption_top: f64,
    labels: HashMap<String, Fit>,
}

struct Camera {
    zoom: f64,
    left: f64,
    top: f64,
    mid: (f64, f64),
    centre: (f64, f64),
}

impl Camera {
    fn map(&self, x: f64, y: f64) -> (f64, f64) {
        (self.mid.0 + (x - self.centre.0) * self.zoom, self.mid.1 + (y - self.centre.1) * self.zoom)
    }
}

struct ImageView {
    shell: Shell,
    scene: ImageScene,
    layout: Layout,
    width: f64,
    pixels: Option<Arc<Pixmap>>,
    key: u64,
    targets: HashMap<String, Vec<usize>>,
}

fn view_of(scene: &ImageScene, at: &Value) -> [f64; 4] {
    if let Some(a) = at.as_array() {
        let v: Vec<f64> = a.iter().filter_map(Value::as_f64).collect();
        if v.len() == 4 {
            return [v[0], v[1], v[2], v[3]];
        }
    }
    at.as_str().and_then(|id| scene.regions.iter().find(|r| r.id == id)).map_or(WHOLE, |r| r.at)
}

fn view_at(scene: &ImageScene, t: f64) -> [f64; 4] {
    let (from, to) = match &scene.ken_burns {
        Value::Bool(true) => (WHOLE, PUSH_IN),
        Value::Object(o) => {
            (view_of(scene, o.get("from").unwrap_or(&Value::Null)), view_of(scene, o.get("to").unwrap_or(&Value::Null)))
        }
        _ => return WHOLE,
    };
    let e = if t < 0.5 { 2.0 * t * t } else { 1.0 - (-2.0 * t + 2.0).powi(2) / 2.0 };
    let e = e.clamp(0.0, 1.0);
    [0, 1, 2, 3].map(|i| from[i] + (to[i] - from[i]) * e)
}

fn camera_for(l: &Layout, view: [f64; 4]) -> Camera {
    let b = l.base;
    let zoom = (1.0 / view[2]).min(1.0 / view[3]);
    let centre = (b.x + (view[0] + view[2] / 2.0) * b.w, b.y + (view[1] + view[3] / 2.0) * b.h);
    let mid = (b.x + b.w / 2.0, b.y + b.h / 2.0);
    let mut c = Camera { zoom, left: 0.0, top: 0.0, mid, centre };
    let corner = c.map(b.x, b.y);
    c.left = corner.0;
    c.top = corner.1;
    c
}

fn region_on_screen(l: &Layout, c: &Camera, r: [f64; 4]) -> Box4 {
    let b = l.base;
    let a = c.map(b.x + r[0] * b.w, b.y + r[1] * b.h);
    let e = c.map(b.x + (r[0] + r[2]) * b.w, b.y + (r[1] + r[3]) * b.h);
    Box4 { x: a.0, y: a.1, w: e.0 - a.0, h: e.1 - a.1 }
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: ImageScene = parse(input)?;
    let shell = Shell::new(input.scene);
    let (bw, bh) = header_box(input.scene, &shell);
    let caption =
        scene.caption.as_deref().filter(|c| !c.is_empty()).map(|c| fit_text(c, &Slot::named("imageCaption", bw * 0.8)));
    let credit =
        scene.credit.as_deref().filter(|c| !c.is_empty()).map(|c| fit_text(c, &Slot::named("imageCredit", bw * 0.5)));
    let below = [caption.as_ref(), credit.as_ref()]
        .iter()
        .flatten()
        .map(|f| f.lines.len() as f64 * (f.size * f.line_height))
        .fold(0.0, f64::max);
    let frame = Box4 { x: 0.0, y: 0.0, w: bw, h: bh - if below > 0.0 { below + CAPTION_GAP } else { 0.0 } };
    let entry = input.props.images.get(&scene.src);
    let aspect = entry.map_or(UNKNOWN_ASPECT, |e| e.width as f64 / e.height as f64);
    let wide = aspect > frame.w / frame.h;
    let contain_w = if wide { frame.w } else { frame.h * aspect };
    let cover_w = if wide { frame.h * aspect } else { frame.w };
    let w = if scene.fit.as_deref() == Some("cover") { cover_w } else { contain_w };
    let h = w / aspect;
    let base = Box4 { x: (frame.w - w) / 2.0, y: (frame.h - h) / 2.0, w, h };
    let shown = if scene.fit.as_deref() == Some("cover") { frame } else { base };
    let labels = scene
        .regions
        .iter()
        .filter_map(|r| r.label.as_ref().map(|l| (r.id.clone(), fit_text(l, &Slot::named("regionLabel", 420.0)))))
        .collect();
    let layout = Layout { frame: shown, base, caption, credit, caption_top: shown.y + shown.h + CAPTION_GAP, labels };
    // The picture, filtered down once to the largest size the pan and zoom draws it at.
    let (mut pixels, mut key) = (None, 0u64);
    if let Some(pic) = input.props.pictures.get(&scene.src) {
        let probe = Layout { labels: HashMap::new(), caption: None, credit: None, ..layout_copy(&layout) };
        let zoom = (0..=100).map(|i| camera_for(&probe, view_at(&scene, i as f64 / 100.0)).zoom).fold(1.0, f64::max);
        let (tw, th) = ((base.w * zoom).ceil() as u32, (base.h * zoom).ceil() as u32);
        let p = downscale(&pic.pixmap, tw, th).map_or_else(|| pic.pixmap.clone(), Arc::new);
        key = Arc::as_ptr(&p) as usize as u64;
        pixels = Some(p);
    }
    let targets = target_steps(input.scene, |r| {
        r.as_str()
            .filter(|id| scene.regions.iter().any(|g| g.id == *id))
            .map(|id| vec![format!("im:{id}")])
            .unwrap_or_default()
    });
    Ok(Box::new(ImageView { shell, scene, layout, width: bw, pixels, key, targets }))
}

fn layout_copy(l: &Layout) -> Layout {
    Layout {
        frame: l.frame,
        base: l.base,
        caption: None,
        credit: None,
        caption_top: l.caption_top,
        labels: HashMap::new(),
    }
}

fn rrect(x: f32, y: f32, w: f32, h: f32, r: f32) -> Option<Path> {
    let rect = Rect::from_xywh(x, y, w, h)?;
    let mut pb = PathBuilder::new();
    let r = r.min(w / 2.0).min(h / 2.0);
    let k = r * 0.5522847;
    pb.move_to(rect.left() + r, rect.top());
    pb.line_to(rect.right() - r, rect.top());
    pb.cubic_to(rect.right() - r + k, rect.top(), rect.right(), rect.top() + r - k, rect.right(), rect.top() + r);
    pb.line_to(rect.right(), rect.bottom() - r);
    pb.cubic_to(
        rect.right(),
        rect.bottom() - r + k,
        rect.right() - r + k,
        rect.bottom(),
        rect.right() - r,
        rect.bottom(),
    );
    pb.line_to(rect.left() + r, rect.bottom());
    pb.cubic_to(rect.left() + r - k, rect.bottom(), rect.left(), rect.bottom() - r + k, rect.left(), rect.bottom() - r);
    pb.line_to(rect.left(), rect.top() + r);
    pb.cubic_to(rect.left(), rect.top() + r - k, rect.left() + r - k, rect.top(), rect.left() + r, rect.top());
    pb.close();
    pb.finish()
}

impl SceneView for ImageView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let l = &self.layout;
        let camera = camera_for(l, view_at(&self.scene, frame / f.duration.max(1.0)));
        let focus = Focus::new(frame, f.segments, &self.targets);
        let dim = f.segments.get(1).map_or(0.0, |s| interpolate(frame, &[s.from, s.from + 14.0], &[0.0, 1.0], CLAMP));
        let appear = interpolate(frame, &[0.0, 18.0], &[0.0, 1.0], CLAMP);
        let area = l.frame;
        let regions: Vec<(&Region, Box4, f64)> = self
            .scene
            .regions
            .iter()
            .map(|r| (r, region_on_screen(l, &camera, r.at), focus.of(&format!("im:{}", r.id)).glow))
            .collect();
        self.shell.draw(dl, f.frame, f.duration, None::<Aside>, |dl, _bx| {
            let (ax, ay, aw, ah) = (area.x as f32, area.y as f32, area.w as f32, area.h as f32);
            dl.push_layer(appear as f32);
            dl.rect(
                ax,
                ay,
                aw,
                ah,
                BoxStyle::fill(RAISED).radius(RADIUS).shadow(Shadow::new(0.0, 30.0, 80.0, Color::rgba8(0, 0, 0, 0.5))),
            );
            dl.push_clip(ax, ay, aw, ah, RADIUS);
            let (px, py) = (camera.left as f32, camera.top as f32);
            let (pw, ph) = ((l.base.w * camera.zoom) as f32, (l.base.h * camera.zoom) as f32);
            match &self.pixels {
                Some(p) => dl.image(p.clone(), self.key, px, py, pw, ph),
                None => placeholder(dl, px, py, pw, ph, &self.scene.src),
            }
            if dim > 0.0 {
                let a = (DIM * dim) as f32;
                let black = Color::rgba8(0, 0, 0, 1.0);
                let lit: Vec<_> = regions.iter().filter(|(_, _, k)| *k > 0.0).collect();
                let mut pb = PathBuilder::new();
                if let Some(r) = Rect::from_xywh(ax, ay, aw, ah) {
                    pb.push_rect(r);
                }
                let mut holes = Vec::new();
                for (_, at, k) in &lit {
                    if let Some(p) = rrect(at.x as f32, at.y as f32, at.w as f32, at.h as f32, 12.0) {
                        holes.push((p, *k));
                    }
                }
                let mut overlay = pb.finish();
                if let Some(base) = overlay.take() {
                    // Holes wind the other way so they cut the overlay out under a non-zero fill.
                    let mut pb = PathBuilder::new();
                    pb.push_path(&base);
                    for (p, _) in &holes {
                        if let Some(rev) = reversed(p) {
                            pb.push_path(&rev);
                        }
                    }
                    if let Some(path) = pb.finish() {
                        dl.path(path, Some(Paint::Solid(black.fade(a))), None);
                    }
                }
                for (p, k) in holes {
                    if k < 1.0 {
                        dl.path(p, Some(Paint::Solid(black.fade(a * (1.0 - k as f32)))), None);
                    }
                }
            }
            dl.pop_clip();
            dl.pop_layer();
            for (r, at, k) in &regions {
                if *k <= 0.0 {
                    continue;
                }
                dl.save();
                dl.fade(*k as f32);
                let (x, y, w, h) = (at.x as f32, at.y as f32, at.w as f32, at.h as f32);
                dl.rect(
                    x - 3.0,
                    y - 3.0,
                    w + 6.0,
                    h + 6.0,
                    BoxStyle::empty().radius(14.0).border(ACCENT, 3.0).shadow(Shadow::new(0.0, 0.0, 32.0, ACCENT_GLOW)),
                );
                if let Some(label) = l.labels.get(&r.id) {
                    let tw = label.lines.iter().map(|ln| drawn_width(label, ln, None)).fold(0.0, f32::max);
                    let th = fit_height(label, LineHeight::Fit);
                    let (bw, bh) = (tw + 28.0, th + 12.0);
                    let by = if at.y > 60.0 { y - 10.0 - bh } else { y + h + 10.0 };
                    dl.rect(x - 3.0, by, bw, bh, BoxStyle::fill(ACCENT).radius(10.0));
                    draw_fit(dl, label, x - 3.0 + 14.0, by + 6.0, TextOpts::new(BG));
                }
                dl.restore();
            }
            if let Some(c) = &l.caption {
                dl.save();
                dl.fade(appear as f32);
                draw_fit(dl, c, area.x as f32, l.caption_top as f32, TextOpts::new(TEXT));
                dl.restore();
            }
            if let Some(c) = &l.credit {
                let w = c.lines.iter().map(|ln| drawn_width(c, ln, None)).fold(0.0, f32::max);
                dl.save();
                dl.fade(appear as f32);
                let mut o = TextOpts::new(FAINT);
                o.align = Align::Right;
                o.width = w;
                draw_fit(dl, c, (area.x + area.w) as f32 - w, l.caption_top as f32 + 4.0, o);
                dl.restore();
            }
            // TODO(marks): PenMarks on the lit regions.
            // TODO(camera): the scene's `camera` field.
            let _ = self.width;
        });
    }
}

/// The path with its contour direction flipped: mirrored top to bottom about its own middle.
fn reversed(p: &Path) -> Option<Path> {
    let b = p.bounds();
    p.clone().transform(tiny_skia::Transform::from_row(1.0, 0.0, 0.0, -1.0, 0.0, b.top() + b.bottom()))
}

/// What `Picture` draws when it has no copy of the image: a dashed box naming the source.
fn placeholder(dl: &mut DisplayList, x: f32, y: f32, w: f32, h: f32, src: &str) {
    dl.rect(x, y, w, h, BoxStyle::empty().radius(14.0).border_stroke(Stroke::dashed(BORDER_STRONG, 2.0, 6.0, 6.0)));
    let style = Style::mono(400.0, 18.0);
    let text_w = (w * 0.8).max(10.0);
    let tw = width(src, style).min(text_w);
    let cy = y + h / 2.0;
    icons::draw(dl, "ImageOff", x + w / 2.0 - 24.0, cy - 48.0, 48.0, FAINT, 2.0);
    dl.text(src, style, x + (w - tw) / 2.0, cy + 40.0, FAINT);
}
