//! A retained display list: what one frame draws, in order, built fresh by the scenes for every frame and
//! drawn by [`crate::raster`]. Items carry their own transform and opacity, so a scene builds it with a
//! CSS-like stack (`save`, `translate`, `scale_about`, `fade`, `restore`) and never touches pixels.

use crate::color::Color;
use crate::text::{ShapedRun, Style, shape};
use std::sync::Arc;
pub use tiny_skia::{Path, PathBuilder, Rect, Transform};

/// A fill: a colour or a gradient, in the item's own coordinates.
#[derive(Clone, Debug)]
pub enum Paint {
    Solid(Color),
    /// From `start` to `end`, stops at offsets 0 to 1.
    Linear {
        start: (f32, f32),
        end: (f32, f32),
        stops: Vec<(f32, Color)>,
    },
    /// An ellipse at `center` with radii `radius`, as CSS `radial-gradient(rx ry at x y, ...)`.
    Radial {
        center: (f32, f32),
        radius: (f32, f32),
        stops: Vec<(f32, Color)>,
    },
}

impl From<Color> for Paint {
    fn from(c: Color) -> Self {
        Paint::Solid(c)
    }
}

impl Paint {
    /// CSS `linear-gradient(<angle>deg, ...)` across a box `w` by `h` at its origin.
    pub fn css_linear(angle_deg: f32, w: f32, h: f32, stops: Vec<(f32, Color)>) -> Paint {
        let a = angle_deg.to_radians();
        let (dx, dy) = (a.sin(), -a.cos());
        let half = (w * dx.abs() + h * dy.abs()) / 2.0;
        let (cx, cy) = (w / 2.0, h / 2.0);
        Paint::Linear { start: (cx - dx * half, cy - dy * half), end: (cx + dx * half, cy + dy * half), stops }
    }
    /// `linear-gradient(180deg, a, b)`: top to bottom.
    pub fn vertical(y0: f32, y1: f32, a: Color, b: Color) -> Paint {
        Paint::Linear { start: (0.0, y0), end: (0.0, y1), stops: vec![(0.0, a), (1.0, b)] }
    }
}

/// A CSS `box-shadow`: offset, blur radius, spread and colour.
#[derive(Clone, Copy, Debug)]
pub struct Shadow {
    pub dx: f32,
    pub dy: f32,
    pub blur: f32,
    pub spread: f32,
    pub color: Color,
}

impl Shadow {
    pub fn new(dx: f32, dy: f32, blur: f32, color: Color) -> Shadow {
        Shadow { dx, dy, blur, spread: 0.0, color }
    }
}

/// A line along a path.
#[derive(Clone, Debug)]
pub struct Stroke {
    pub color: Color,
    pub width: f32,
    /// Dash and gap lengths, as SVG `stroke-dasharray`.
    pub dash: Option<(f32, f32)>,
    pub round: bool,
}

impl Stroke {
    pub fn solid(color: Color, width: f32) -> Stroke {
        Stroke { color, width, dash: None, round: false }
    }
    pub fn dashed(color: Color, width: f32, dash: f32, gap: f32) -> Stroke {
        Stroke { color, width, dash: Some((dash, gap)), round: false }
    }
    pub fn rounded(mut self) -> Stroke {
        self.round = true;
        self
    }
}

/// A CSS box: its border box, corner radius, background, border (drawn inside the box) and shadows.
#[derive(Clone, Debug)]
pub struct BoxStyle {
    pub radius: f32,
    pub fill: Option<Paint>,
    pub border: Option<Stroke>,
    pub shadows: Vec<Shadow>,
}

impl BoxStyle {
    pub fn fill(paint: impl Into<Paint>) -> BoxStyle {
        BoxStyle { radius: 0.0, fill: Some(paint.into()), border: None, shadows: Vec::new() }
    }
    pub fn empty() -> BoxStyle {
        BoxStyle { radius: 0.0, fill: None, border: None, shadows: Vec::new() }
    }
    pub fn radius(mut self, r: f32) -> Self {
        self.radius = r;
        self
    }
    pub fn border(mut self, color: Color, width: f32) -> Self {
        self.border = Some(Stroke::solid(color, width));
        self
    }
    pub fn border_stroke(mut self, s: Stroke) -> Self {
        self.border = Some(s);
        self
    }
    pub fn shadow(mut self, s: Shadow) -> Self {
        self.shadows.push(s);
        self
    }
}

#[derive(Clone, Debug)]
pub enum Item {
    Box {
        rect: Rect,
        style: BoxStyle,
    },
    Path {
        path: Arc<Path>,
        fill: Option<Paint>,
        stroke: Option<Stroke>,
    },
    /// A shaped run with its pen origin on the baseline at (x, y); `glow` is a CSS text-shadow (blur, colour).
    Text {
        run: Arc<ShapedRun>,
        x: f32,
        y: f32,
        color: Color,
        glow: Option<(f32, Color)>,
    },
    /// A shaped run filled with a gradient, as CSS `background-clip: text` draws it; the paint is in the item's
    /// coordinates.
    TextPaint {
        run: Arc<ShapedRun>,
        x: f32,
        y: f32,
        paint: Paint,
    },
    /// Clips what follows, until the matching `PopClip`, to a rounded rect.
    PushClip {
        rect: Rect,
        radius: f32,
    },
    PopClip,
    /// Draws what follows into a layer composited at `opacity`: CSS group opacity, for overlapping content.
    PushLayer {
        opacity: f32,
    },
    PopLayer,
    /// Draws what follows into a layer shown only inside `rect`, fading out over `fade` px at its edges: a CSS mask of
    /// two edge gradients, as the camera's view uses. Ends at the matching `PopLayer`.
    PushFadeLayer {
        rect: Rect,
        fade: f32,
    },
}

#[derive(Clone, Debug)]
pub struct Cmd {
    pub item: Item,
    pub transform: Transform,
    pub opacity: f32,
}

#[derive(Clone, Copy)]
struct State {
    transform: Transform,
    opacity: f32,
}

/// A frame's drawing, in painter's order.
pub struct DisplayList {
    pub cmds: Vec<Cmd>,
    state: State,
    stack: Vec<State>,
}

impl Default for DisplayList {
    fn default() -> Self {
        DisplayList {
            cmds: Vec::new(),
            state: State { transform: Transform::identity(), opacity: 1.0 },
            stack: Vec::new(),
        }
    }
}

impl DisplayList {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn save(&mut self) {
        self.stack.push(self.state);
    }
    pub fn restore(&mut self) {
        self.state = self.stack.pop().expect("restore without save");
    }
    /// Runs `f` with the state saved around it.
    pub fn group(&mut self, f: impl FnOnce(&mut DisplayList)) {
        self.save();
        f(self);
        self.restore();
    }
    pub fn translate(&mut self, dx: f32, dy: f32) {
        self.state.transform = self.state.transform.pre_translate(dx, dy);
    }
    /// CSS `transform: scale(s)` with `transform-origin` at (x, y).
    pub fn scale_about(&mut self, s: f32, x: f32, y: f32) {
        self.state.transform = self.state.transform.pre_translate(x, y).pre_scale(s, s).pre_translate(-x, -y);
    }
    /// Multiplies the opacity of what follows: CSS opacity, item by item.
    pub fn fade(&mut self, k: f32) {
        self.state.opacity *= k.clamp(0.0, 1.0);
    }
    pub fn opacity(&self) -> f32 {
        self.state.opacity
    }
    pub fn transform(&self) -> Transform {
        self.state.transform
    }

    fn push(&mut self, item: Item) {
        if self.state.opacity <= 0.0
            && !matches!(item, Item::PopClip | Item::PopLayer | Item::PushClip { .. } | Item::PushLayer { .. })
        {
            return;
        }
        self.cmds.push(Cmd { item, transform: self.state.transform, opacity: self.state.opacity });
    }

    /// A CSS box at (x, y), `w` by `h`.
    pub fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, style: BoxStyle) {
        if w <= 0.0 || h <= 0.0 {
            return;
        }
        if let Some(rect) = Rect::from_xywh(x, y, w, h) {
            self.push(Item::Box { rect, style });
        }
    }
    pub fn fill_rect(&mut self, x: f32, y: f32, w: f32, h: f32, color: Color) {
        self.rect(x, y, w, h, BoxStyle::fill(color));
    }
    pub fn path(&mut self, path: Path, fill: Option<Paint>, stroke: Option<Stroke>) {
        self.push(Item::Path { path: Arc::new(path), fill, stroke });
    }
    pub fn circle(&mut self, cx: f32, cy: f32, r: f32, fill: Color) {
        if let Some(p) = PathBuilder::from_circle(cx, cy, r) {
            self.path(p, Some(fill.into()), None);
        }
    }
    /// A run with its baseline origin at (x, y).
    pub fn run(&mut self, run: Arc<ShapedRun>, x: f32, y: f32, color: Color) {
        self.push(Item::Text { run, x, y, color, glow: None });
    }
    pub fn run_glow(&mut self, run: Arc<ShapedRun>, x: f32, y: f32, color: Color, glow: (f32, Color)) {
        self.push(Item::Text { run, x, y, color, glow: Some(glow) });
    }
    /// A run filled with a gradient (or any paint) instead of a colour.
    pub fn run_paint(&mut self, run: Arc<ShapedRun>, x: f32, y: f32, paint: Paint) {
        self.push(Item::TextPaint { run, x, y, paint });
    }
    /// Shapes and draws `text` with its baseline origin at (x, y); returns its advance.
    pub fn text(&mut self, text: &str, style: Style, x: f32, y: f32, color: Color) -> f32 {
        let run = shape(text, style);
        let w = run.width;
        self.run(run, x, y, color);
        w
    }
    pub fn push_clip(&mut self, x: f32, y: f32, w: f32, h: f32, radius: f32) {
        let rect =
            Rect::from_xywh(x, y, w.max(0.0), h.max(0.0)).unwrap_or(Rect::from_xywh(x, y, 0.001, 0.001).unwrap());
        self.push(Item::PushClip { rect, radius });
    }
    pub fn pop_clip(&mut self) {
        self.push(Item::PopClip);
    }
    pub fn push_layer(&mut self, opacity: f32) {
        self.push(Item::PushLayer { opacity });
    }
    /// A layer that shows only inside the rect, fading out over `fade` px at its edges.
    pub fn push_fade_layer(&mut self, x: f32, y: f32, w: f32, h: f32, fade: f32) {
        if let Some(rect) = Rect::from_xywh(x, y, w.max(0.001), h.max(0.001)) {
            self.push(Item::PushFadeLayer { rect, fade });
        }
    }
    pub fn pop_layer(&mut self) {
        self.push(Item::PopLayer);
    }
}

/// An SVG path's `d`, as a tiny-skia path; empty paths are None.
pub fn svg_path(d: &str) -> Option<Path> {
    let bez = kurbo::BezPath::from_svg(d).ok()?;
    let mut pb = PathBuilder::new();
    for el in bez.elements() {
        match *el {
            kurbo::PathEl::MoveTo(p) => pb.move_to(p.x as f32, p.y as f32),
            kurbo::PathEl::LineTo(p) => pb.line_to(p.x as f32, p.y as f32),
            kurbo::PathEl::QuadTo(a, p) => pb.quad_to(a.x as f32, a.y as f32, p.x as f32, p.y as f32),
            kurbo::PathEl::CurveTo(a, b, p) => {
                pb.cubic_to(a.x as f32, a.y as f32, b.x as f32, b.y as f32, p.x as f32, p.y as f32)
            }
            kurbo::PathEl::ClosePath => pb.close(),
        }
    }
    pb.finish()
}

/// Feeds what an item draws into a hasher, so equal frames hash equal.
struct Fingerprint(std::collections::hash_map::DefaultHasher);

impl Fingerprint {
    fn f(&mut self, v: f32) {
        std::hash::Hasher::write_u32(&mut self.0, v.to_bits());
    }
    fn u(&mut self, v: u64) {
        std::hash::Hasher::write_u64(&mut self.0, v);
    }
    fn color(&mut self, c: Color) {
        for v in [c.r, c.g, c.b, c.a] {
            self.f(v);
        }
    }
    fn stops(&mut self, stops: &[(f32, Color)]) {
        for &(o, c) in stops {
            self.f(o);
            self.color(c);
        }
    }
    fn paint(&mut self, p: &Paint) {
        match p {
            Paint::Solid(c) => {
                self.u(1);
                self.color(*c);
            }
            Paint::Linear { start, end, stops } => {
                self.u(2);
                for v in [start.0, start.1, end.0, end.1] {
                    self.f(v);
                }
                self.stops(stops);
            }
            Paint::Radial { center, radius, stops } => {
                self.u(3);
                for v in [center.0, center.1, radius.0, radius.1] {
                    self.f(v);
                }
                self.stops(stops);
            }
        }
    }
    fn stroke(&mut self, s: &Stroke) {
        self.color(s.color);
        self.f(s.width);
        if let Some((d, g)) = s.dash {
            self.f(d);
            self.f(g);
        }
        self.u(s.round as u64);
    }
}

impl DisplayList {
    /// A hash of everything the list draws: two frames with equal fingerprints draw the same pixels, so a
    /// renderer can reuse the first. Cheap next to rasterizing.
    pub fn fingerprint(&self) -> u64 {
        let mut h = Fingerprint(std::collections::hash_map::DefaultHasher::new());
        for cmd in &self.cmds {
            let t = cmd.transform;
            for v in [t.sx, t.kx, t.ky, t.sy, t.tx, t.ty, cmd.opacity] {
                h.f(v);
            }
            match &cmd.item {
                Item::Box { rect, style } => {
                    h.u(10);
                    for v in [rect.left(), rect.top(), rect.width(), rect.height(), style.radius] {
                        h.f(v);
                    }
                    if let Some(p) = &style.fill {
                        h.paint(p);
                    }
                    if let Some(b) = &style.border {
                        h.stroke(b);
                    }
                    for s in &style.shadows {
                        for v in [s.dx, s.dy, s.blur, s.spread] {
                            h.f(v);
                        }
                        h.color(s.color);
                    }
                }
                Item::Path { path, fill, stroke } => {
                    h.u(11);
                    for p in path.points() {
                        h.f(p.x);
                        h.f(p.y);
                    }
                    for v in path.verbs() {
                        h.u(*v as u64);
                    }
                    if let Some(p) = fill {
                        h.paint(p);
                    }
                    if let Some(s) = stroke {
                        h.stroke(s);
                    }
                }
                Item::Text { run, x, y, color, glow } => {
                    h.u(12);
                    h.u(run.key);
                    h.f(*x);
                    h.f(*y);
                    h.color(*color);
                    if let Some((r, c)) = glow {
                        h.f(*r);
                        h.color(*c);
                    }
                }
                Item::TextPaint { run, x, y, paint } => {
                    h.u(18);
                    h.u(run.key);
                    h.f(*x);
                    h.f(*y);
                    h.paint(paint);
                }
                Item::PushClip { rect, radius } => {
                    h.u(13);
                    for v in [rect.left(), rect.top(), rect.width(), rect.height(), *radius] {
                        h.f(v);
                    }
                }
                Item::PopClip => h.u(14),
                Item::PushLayer { opacity } => {
                    h.u(15);
                    h.f(*opacity);
                }
                Item::PopLayer => h.u(16),
                Item::PushFadeLayer { rect, fade } => {
                    h.u(17);
                    for v in [rect.left(), rect.top(), rect.width(), rect.height(), *fade] {
                        h.f(v);
                    }
                }
            }
        }
        std::hash::Hasher::finish(&h.0)
    }
}
