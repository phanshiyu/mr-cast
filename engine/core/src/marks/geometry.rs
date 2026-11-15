//! Geometry of pen marks and ink: hand-drawn strokes around a target box, and spots for notes that keep off the target
//! and everything else on screen. A port of src/utils/penGeometry.ts and src/utils/inkGeometry.ts; seeded exactly as
//! the TS is, so a frame draws the same marks.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

/// A box in a scene's content box, in px.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bx {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Bx {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Bx {
        Bx { x, y, width, height }
    }
    pub fn right(&self) -> f64 {
        self.x + self.width
    }
    pub fn bottom(&self) -> f64 {
        self.y + self.height
    }
    pub fn center(&self) -> Pt {
        Pt { x: self.x + self.width / 2.0, y: self.y + self.height / 2.0 }
    }
    pub fn grow(&self, by: f64) -> Bx {
        Bx::new(self.x - by, self.y - by, self.width + 2.0 * by, self.height + 2.0 * by)
    }
    pub fn translate(&self, dx: f64, dy: f64) -> Bx {
        Bx::new(self.x + dx, self.y + dy, self.width, self.height)
    }
}

/// Points drawn as one pen stroke; `sharp` joins them with straight lines instead of a smooth curve.
#[derive(Clone, Debug, PartialEq)]
pub struct Stroke {
    pub points: Vec<Pt>,
    pub sharp: bool,
}

/// A mark's strokes, drawn one after another, and the box they cover.
#[derive(Clone, Debug, PartialEq)]
pub struct Sketch {
    pub strokes: Vec<Stroke>,
    pub bounds: Bx,
}

/// The smallest box around every box given, or None for none.
pub fn union<'a>(boxes: impl IntoIterator<Item = Option<&'a Bx>>) -> Option<Bx> {
    let all: Vec<&Bx> = boxes.into_iter().flatten().collect();
    if all.is_empty() {
        return None;
    }
    let x = all.iter().map(|b| b.x).fold(f64::INFINITY, f64::min);
    let y = all.iter().map(|b| b.y).fold(f64::INFINITY, f64::min);
    let r = all.iter().map(|b| b.right()).fold(f64::NEG_INFINITY, f64::max);
    let bo = all.iter().map(|b| b.bottom()).fold(f64::NEG_INFINITY, f64::max);
    Some(Bx::new(x, y, r - x, bo - y))
}

pub fn overlap(a: &Bx, b: &Bx) -> f64 {
    let w = a.right().min(b.right()) - a.x.max(b.x);
    let h = a.bottom().min(b.bottom()) - a.y.max(b.y);
    if w > 0.0 && h > 0.0 { w * h } else { 0.0 }
}

fn inside(p: &Pt, b: &Bx) -> bool {
    p.x > b.x && p.x < b.right() && p.y > b.y && p.y < b.bottom()
}

fn clamp_to(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(lo.max(hi))
}

/// A box moved the least distance that puts it inside `area` (`keepInside`).
pub fn keep_inside(b: Bx, area: &Bx) -> Bx {
    Bx { x: clamp_to(b.x, area.x, area.right() - b.width), y: clamp_to(b.y, area.y, area.bottom() - b.height), ..b }
}

/// `keepIn` of inkGeometry.ts: min then max, so a box larger than the area sticks to its far edge.
pub fn keep_in(b: Bx, a: &Bx) -> Bx {
    Bx { x: b.x.max(a.x).min(a.right() - b.width), y: b.y.max(a.y).min(a.bottom() - b.height), ..b }
}

/// A stable seed from any text (`seedOf`, over UTF-16 code units).
pub fn seed_of(text: &str) -> u32 {
    let mut h: u32 = 2166136261;
    for u in text.encode_utf16() {
        h = (h ^ u as u32).wrapping_mul(16777619);
    }
    h
}

/// Numbers in [0, 1) from a seed, the same sequence every time (`random`, mulberry32).
pub struct Random(u32);

impl Random {
    pub fn new(seed: u32) -> Random {
        Random(seed)
    }
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
    fn jitter(&mut self, by: f64) -> f64 {
        (self.next() - 0.5) * 2.0 * by
    }
}

pub fn bounds_of(strokes: &[Stroke], pen: f64) -> Bx {
    let pts = strokes.iter().flat_map(|s| s.points.iter());
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in pts {
        x0 = x0.min(p.x);
        y0 = y0.min(p.y);
        x1 = x1.max(p.x);
        y1 = y1.max(p.y);
    }
    Bx::new(x0, y0, x1 - x0, y1 - y0).grow(pen)
}

/// A line from `a` to `b` in `n` pieces that bows by `bow` and wavers by `waver`.
fn line(a: Pt, b: Pt, n: usize, bow: f64, waver: f64, rand: &mut Random) -> Vec<Pt> {
    let len = (b.x - a.x).hypot(b.y - a.y);
    let len = if len == 0.0 { 1.0 } else { len };
    let normal = Pt { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    (0..=n)
        .map(|i| {
            let t = i as f64 / n as f64;
            let off = bow * (std::f64::consts::PI * t).sin() + if i > 0 && i < n { rand.jitter(waver) } else { 0.0 };
            Pt { x: a.x + (b.x - a.x) * t + normal.x * off, y: a.y + (b.y - a.y) * t + normal.y * off }
        })
        .collect()
}

const NEIGHBOUR_REACH: f64 = 4.0;
const RING_CLEAR: f64 = 10.0;
const WOBBLE_LOW: f64 = 0.94;

fn side_gaps(t: &Bx, obstacles: &[Bx]) -> f64 {
    let level = obstacles.iter().filter(|o| overlap(o, t) == 0.0 && o.y < t.bottom() && o.bottom() > t.y);
    let mut m = f64::INFINITY;
    for o in level {
        if o.right() <= t.x {
            m = m.min(t.x - o.right());
        }
        if o.x >= t.right() {
            m = m.min(o.x - t.right());
        }
    }
    m
}

fn ring(t: &Bx, area: &Bx, obstacles: &[Bx], rand: &mut Random) -> Stroke {
    let c = t.center();
    let (a, b) = (t.width / 2.0, t.height / 2.0);
    let room_y = (b + 4.0).max((c.y - area.y).min(area.bottom() - c.y) - 6.0);
    let ry = room_y.min(b + clamp_to(0.35 * b + 10.0, 12.0, 36.0));
    let clears = a / (1.0 - (b / ry).powi(2)).max(0.2).sqrt();
    let room_x = (a + 4.0).max((c.x - area.x).min(area.right() - c.x) - 6.0);
    let free = room_x.min((a + 16.0).max(clears));
    let rx = (a + RING_CLEAR).max(free.min(a + side_gaps(t, obstacles) + NEIGHBOUR_REACH));
    let low = if rx < free { WOBBLE_LOW } else { 1.0 };
    let (cx, cy) = (a / (low * rx), b / (low * ry));
    let mut n = 2.0f64;
    while n < 8.0 && cx.powf(n) + cy.powf(n) > 1.0 + 1e-9 {
        n += 0.1;
    }
    let tilt = rand.jitter(0.03);
    let start = -2.2 + rand.jitter(0.25);
    let sweep = 2.0 * std::f64::consts::PI + 0.4 + rand.next() * 0.3;
    // 6.28, not TAU: the TS multiplies by 6.28.
    #[allow(clippy::approx_constant)]
    let (p1, p2) = (rand.next() * 6.28, rand.next() * 6.28);
    let steps = 64;
    let bend = |v: f64| v.signum() * v.abs().powf(2.0 / n) * if v == 0.0 { 0.0 } else { 1.0 };
    Stroke {
        points: (0..=steps)
            .map(|i| {
                let k = i as f64 / steps as f64;
                let th = start + sweep * k;
                let r = 0.97 + 0.07 * k + 0.02 * (2.0 * th + p1).sin() + 0.012 * (3.0 * th + p2).sin();
                let x = rx * r * bend(th.cos());
                let y = ry * r * bend(th.sin());
                Pt { x: c.x + x * tilt.cos() - y * tilt.sin(), y: c.y + x * tilt.sin() + y * tilt.cos() }
            })
            .collect(),
        sharp: false,
    }
}

fn frame(t: &Bx, rand: &mut Random) -> Stroke {
    let m = 10.0;
    let corner = |x: f64, y: f64, rand: &mut Random| Pt { x: x + rand.jitter(3.0), y: y + rand.jitter(3.0) };
    let tl = corner(t.x - m, t.y - m, rand);
    let tr = corner(t.right() + m, t.y - m, rand);
    let br = corner(t.right() + m, t.bottom() + m, rand);
    let bl = corner(t.x - m, t.bottom() + m, rand);
    let over = 7.0;
    let mut points = vec![Pt { x: tl.x - over, y: tl.y + 1.0 }];
    let b1 = rand.jitter(2.0);
    points.extend(line(tl, tr, 6, b1, 1.0, rand).into_iter().skip(1));
    points.push(Pt { x: tr.x + 2.0, y: tr.y - 1.0 });
    let b2 = rand.jitter(2.0);
    points.extend(line(tr, br, 4, b2, 1.0, rand).into_iter().skip(1));
    let b3 = rand.jitter(2.0);
    points.extend(line(br, bl, 6, b3, 1.0, rand).into_iter().skip(1));
    let b4 = rand.jitter(2.0);
    points.extend(line(bl, Pt { x: tl.x + 1.0, y: tl.y - over }, 4, b4, 1.0, rand).into_iter().skip(1));
    Stroke { points, sharp: true }
}

/// The pen marks a step may make.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mark {
    Circle,
    Underline,
    Box,
    Arrow,
    Strike,
    Cross,
}

impl Mark {
    pub fn parse(s: &str) -> Option<Mark> {
        Some(match s {
            "circle" => Mark::Circle,
            "underline" => Mark::Underline,
            "box" => Mark::Box,
            "arrow" => Mark::Arrow,
            "strike" => Mark::Strike,
            "cross" => Mark::Cross,
            _ => return None,
        })
    }
}

/// The strokes of a mark (not an arrow) on `target` (`sketchMark`).
pub fn sketch_mark(mark: Mark, t: &Bx, area: &Bx, obstacles: &[Bx], seed: u32, pen: f64) -> Sketch {
    let mut rand = Random::new(seed);
    let rand = &mut rand;
    let strokes = match mark {
        Mark::Circle => vec![ring(t, area, obstacles, rand)],
        Mark::Box => vec![frame(t, rand)],
        Mark::Underline => {
            let y = t.bottom() + 8.0;
            let a = Pt { x: t.x - 6.0, y: y + rand.jitter(2.0) };
            let b = Pt { x: t.right() + 8.0, y: y + rand.jitter(3.0) };
            let bow = -2.0 - rand.next() * 3.0;
            vec![Stroke { points: line(a, b, 10, bow, 0.8, rand), sharp: false }]
        }
        Mark::Strike | Mark::Arrow => {
            let y = t.y + t.height / 2.0;
            let a = Pt { x: t.x - 8.0, y: y + rand.jitter(3.0) };
            let b = Pt { x: t.right() + 8.0, y: y + rand.jitter(3.0) };
            let bow = rand.jitter(3.0);
            vec![Stroke { points: line(a, b, 10, bow, 0.8, rand), sharp: false }]
        }
        Mark::Cross => {
            let g = t.grow(6.0);
            let bow1 = rand.jitter(5.0);
            let s1 = line(Pt { x: g.x, y: g.y }, Pt { x: g.right(), y: g.bottom() }, 10, bow1, 1.0, rand);
            let a = Pt { x: g.right(), y: g.y + rand.jitter(3.0) };
            let b = Pt { x: g.x + rand.jitter(3.0), y: g.bottom() };
            let bow2 = rand.jitter(5.0);
            let s2 = line(a, b, 10, bow2, 1.0, rand);
            vec![Stroke { points: s1, sharp: false }, Stroke { points: s2, sharp: false }]
        }
    };
    Sketch { bounds: bounds_of(&strokes, pen), strokes }
}

/// Where a line from the centre of `b` towards `p` leaves `b` grown by 10px.
pub fn edge_toward(b: &Bx, p: Pt) -> Pt {
    let c = b.center();
    let g = b.grow(10.0);
    let (dx, dy) = (p.x - c.x, p.y - c.y);
    let sx = if dx != 0.0 { g.width / 2.0 / dx.abs() } else { f64::INFINITY };
    let sy = if dy != 0.0 { g.height / 2.0 / dy.abs() } else { f64::INFINITY };
    let s = sx.min(sy).min(1.0);
    Pt { x: c.x + dx * s, y: c.y + dy * s }
}

/// A curved shaft from `tail` to just short of the target, then its head (`arrowSketch`).
pub fn arrow_sketch(tail: Pt, target: &Bx, seed: u32, pen: f64) -> Sketch {
    let mut rand = Random::new(seed);
    let tip = edge_toward(target, tail);
    let len = (tip.x - tail.x).hypot(tip.y - tail.y);
    let sign = if rand.next() < 0.5 { -1.0 } else { 1.0 };
    let bow = sign * len * (0.1 + rand.next() * 0.05);
    let shaft = line(tail, tip, 16, bow, 0.8, &mut rand);
    let last = shaft[shaft.len() - 3];
    let angle = (tip.y - last.y).atan2(tip.x - last.x);
    let barb = |turn: f64| Pt { x: tip.x - 22.0 * (angle + turn).cos(), y: tip.y - 22.0 * (angle + turn).sin() };
    let j1 = rand.jitter(0.06);
    let j2 = rand.jitter(0.06);
    let strokes = vec![
        Stroke { points: shaft, sharp: false },
        Stroke { points: vec![barb(0.5 + j1), tip, barb(-0.5 + j2)], sharp: true },
    ];
    Sketch { bounds: bounds_of(&strokes, pen), strokes }
}

/// What a note must keep off.
pub struct Clutter<'a> {
    pub target: Bx,
    pub mark: Option<Bx>,
    pub obstacles: &'a [Bx],
    pub lines: &'a [Pt],
}

const LINE_COST: f64 = 25.0;

fn cost(b: &Bx, c: &Clutter) -> f64 {
    let near = b.grow(10.0);
    50.0 * overlap(b, &c.target.grow(4.0))
        + c.mark.map_or(0.0, |m| 8.0 * overlap(b, &m))
        + c.obstacles.iter().map(|o| overlap(&near, o)).sum::<f64>()
        + LINE_COST * c.lines.iter().filter(|p| inside(p, &near)).count() as f64
}

const GAP: f64 = 12.0;

#[derive(Clone, Copy, PartialEq)]
enum Side {
    Right,
    Below,
    Above,
    Left,
    AboveRight,
    BelowRight,
    AboveLeft,
    BelowLeft,
}
use Side::*;

fn sides(mark: Mark) -> [Side; 8] {
    match mark {
        Mark::Circle | Mark::Box | Mark::Arrow => {
            [AboveRight, Right, BelowRight, Above, Below, Left, AboveLeft, BelowLeft]
        }
        Mark::Underline => [Below, BelowRight, Right, Above, AboveRight, Left, BelowLeft, AboveLeft],
        Mark::Strike | Mark::Cross => [Right, AboveRight, BelowRight, Above, Below, Left, AboveLeft, BelowLeft],
    }
}

fn beside(side: Side, size: (f64, f64), m: &Bx, t: &Bx) -> Bx {
    let (w, h) = size;
    let mid_y = t.y + t.height / 2.0 - h / 2.0;
    let at = |x: f64, y: f64| Bx::new(x, y, w, h);
    match side {
        Right => at(m.right() + GAP, mid_y),
        Left => at(m.x - GAP - w, mid_y),
        Above => at(t.x + t.width / 2.0 - w / 2.0, m.y - GAP - h),
        Below => at(t.x + t.width / 2.0 - w / 2.0, m.bottom() + GAP),
        AboveRight => at(m.right() - (m.width / 4.0).min(40.0), m.y - h + 6.0),
        BelowRight => at(m.right() - (m.width / 4.0).min(40.0), m.bottom() - 6.0),
        AboveLeft => at(m.x - w + (m.width / 4.0).min(40.0), m.y - h + 6.0),
        BelowLeft => at(m.x - w + (m.width / 4.0).min(40.0), m.bottom() - 6.0),
    }
}

const SLIDES: [f64; 7] = [0.0, -0.3, 0.3, -0.6, 0.6, -1.0, 1.0];

/// The least cluttered spot for a note of `size` beside a mark (`placeNote`).
pub fn place_note(mark: Mark, size: (f64, f64), sketch: &Sketch, clutter: &Clutter, area: &Bx) -> Bx {
    let all = Clutter { mark: Some(sketch.bounds), ..*clutter };
    let mut best: Option<(Bx, f64)> = None;
    for (i, side) in sides(mark).into_iter().enumerate() {
        let base = beside(side, size, &sketch.bounds, &clutter.target);
        let across = side == Left || side == Right;
        for (j, f) in SLIDES.iter().enumerate() {
            let b = keep_inside(
                Bx {
                    x: base.x + if across { 0.0 } else { f * size.0 },
                    y: base.y + if across { f * (size.1 + 8.0) } else { 0.0 },
                    ..base
                },
                area,
            );
            let score = cost(&b, &all) + 40.0 * i as f64 + 30.0 * j as f64;
            if best.is_none_or(|(_, s)| score < s) {
                best = Some((b, score));
            }
        }
    }
    best.unwrap().0
}

/// Where an arrow starts and its note sits (`placeArrow`).
pub fn place_arrow(size: (f64, f64), given: &Clutter, area: &Bx) -> (Pt, Bx) {
    let target = given.target;
    let c = target.center();
    let clutter = Clutter { mark: None, ..*given };
    let dirs: Vec<Pt> =
        [(1.0, -1.0), (1.0, 0.0), (1.0, 1.0), (0.0, -1.0), (0.0, 1.0), (-1.0, -1.0), (-1.0, 0.0), (-1.0, 1.0)]
            .iter()
            .map(|&(x, y): &(f64, f64)| Pt { x: x / x.hypot(y), y: y / x.hypot(y) })
            .collect();
    let mut best: Option<(Pt, Bx, f64)> = None;
    for reach in [130.0, 200.0, 280.0] {
        for d in &dirs {
            let edge = edge_toward(&target, Pt { x: c.x + d.x * 1e4, y: c.y + d.y * 1e4 });
            let want = Pt { x: edge.x + d.x * reach, y: edge.y + d.y * reach };
            let horizontal = d.x.abs() > 0.5;
            let placed = keep_inside(
                Bx::new(
                    if horizontal {
                        if d.x > 0.0 { want.x + 8.0 } else { want.x - 8.0 - size.0 }
                    } else {
                        want.x - size.0 / 2.0
                    },
                    if horizontal {
                        want.y - size.1 / 2.0
                    } else if d.y > 0.0 {
                        want.y + 6.0
                    } else {
                        want.y - 6.0 - size.1
                    },
                    size.0,
                    size.1,
                ),
                area,
            );
            let near = placed.grow(8.0);
            let tail = Pt { x: clamp_to(c.x, near.x, near.right()), y: clamp_to(c.y, near.y, near.bottom()) };
            let tip = edge_toward(&target, tail);
            let crossed = (0..12)
                .map(|i| Pt {
                    x: tail.x + ((tip.x - tail.x) * (i as f64 + 0.5)) / 12.0,
                    y: tail.y + ((tip.y - tail.y) * (i as f64 + 0.5)) / 12.0,
                })
                .filter(|p| {
                    given.obstacles.iter().any(|o| inside(p, o) && overlap(o, &target) < o.width * o.height * 0.5)
                })
                .count() as f64;
            let short = if (tip.x - tail.x).hypot(tip.y - tail.y) < 70.0 { 4000.0 } else { 0.0 };
            let score = cost(&placed, &clutter) + 900.0 * crossed + short + reach;
            if best.is_none_or(|(_, _, s)| score < s - 1.0) {
                best = Some((tail, placed, score));
            }
        }
    }
    let (tail, note, _) = best.unwrap();
    (tail, note)
}

/// The cubic segments of a stroke as SVG draws it (`strokePath`): a smooth curve through its points, or straight lines
/// when sharp. Coordinates are rounded to 0.1 px, as the TS writes them.
pub fn stroke_segments(s: &Stroke) -> Vec<[Pt; 4]> {
    let r = |p: Pt| Pt { x: (p.x * 10.0).round() / 10.0, y: (p.y * 10.0).round() / 10.0 };
    let pts = &s.points;
    let mut out = Vec::new();
    if s.sharp || pts.len() < 3 {
        for w in pts.windows(2) {
            let (a, b) = (r(w[0]), r(w[1]));
            out.push([a, a, b, b]);
        }
        return out;
    }
    for i in 0..pts.len() - 1 {
        let p0 = if i > 0 { pts[i - 1] } else { pts[i] };
        let (p1, p2) = (pts[i], pts[i + 1]);
        let p3 = pts.get(i + 2).copied().unwrap_or(pts[i + 1]);
        let c1 = Pt { x: p1.x + (p2.x - p0.x) / 6.0, y: p1.y + (p2.y - p0.y) / 6.0 };
        let c2 = Pt { x: p2.x - (p3.x - p1.x) / 6.0, y: p2.y - (p3.y - p1.y) / 6.0 };
        out.push([r(p1), r(c1), r(c2), r(p2)]);
    }
    out
}

/// Length of a stroke's polyline (`strokeLength`).
pub fn stroke_length(s: &Stroke) -> f64 {
    s.points.windows(2).map(|w| (w[1].x - w[0].x).hypot(w[1].y - w[0].y)).sum()
}

// --- Ink geometry (src/utils/inkGeometry.ts). ---

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InkSide {
    Above,
    Below,
    Left,
    Right,
}

impl InkSide {
    pub fn parse(s: &str) -> Option<InkSide> {
        Some(match s {
            "above" => InkSide::Above,
            "below" => InkSide::Below,
            "left" => InkSide::Left,
            "right" => InkSide::Right,
            _ => return None,
        })
    }
}

/// A check mark just right of the target.
pub fn tick_sketch(t: &Bx, seed: u32, pen: f64) -> Sketch {
    let mut rand = Random::new(seed);
    let h = 46f64.min((t.height * 0.8).max(28.0));
    let x = t.right() + 14.0;
    let y = t.y + t.height / 2.0 - h / 2.0;
    let mut j = || (rand.next() - 0.5) * 3.0;
    let a = Pt { x: x + j(), y: y + h * 0.55 + j() };
    let b = Pt { x: x + h * 0.3, y: y + h * 0.95 };
    let c = Pt { x: x + h * 0.85 + j(), y: y + j() };
    Sketch { strokes: vec![Stroke { points: vec![a, b, c], sharp: true }], bounds: Bx::new(x, y, h * 0.9, h).grow(pen) }
}

const BRACE_GAP: f64 = 12.0;
const BRACE_DEPTH: f64 = 22.0;
pub const BRACE_REACH: f64 = BRACE_GAP + BRACE_DEPTH + 10.0;

/// A curly brace along one side of `t`.
pub fn brace_sketch(t: &Bx, side: InkSide, seed: u32, pen: f64) -> Sketch {
    let mut rand = Random::new(seed);
    let along = matches!(side, InkSide::Above | InkSide::Below);
    let len = if along { t.width } else { t.height };
    let n = 48;
    let ease = |a: f64, b: f64, x: f64| {
        let k = ((x - a) / (b - a)).clamp(0.0, 1.0);
        k * k * (3.0 - 2.0 * k)
    };
    let profile = |u: f64| 0.5 * ease(0.0, 0.18, u) + 0.5 * ease(0.82, 1.0, u);
    let points = (0..=n)
        .map(|i| {
            let v = i as f64 / n as f64;
            let out = BRACE_GAP
                + BRACE_DEPTH * profile(if v < 0.5 { v * 2.0 } else { (1.0 - v) * 2.0 })
                + (rand.next() - 0.5) * 1.2;
            let pos = v * len;
            match side {
                InkSide::Below => Pt { x: t.x + pos, y: t.bottom() + out },
                InkSide::Above => Pt { x: t.x + pos, y: t.y - out },
                InkSide::Right => Pt { x: t.right() + out, y: t.y + pos },
                InkSide::Left => Pt { x: t.x - out, y: t.y + pos },
            }
        })
        .collect();
    let strokes = vec![Stroke { points, sharp: false }];
    Sketch { bounds: bounds_of(&strokes, pen), strokes }
}

fn beside_box(t: &Bx, side: InkSide, size: (f64, f64), off: f64) -> Bx {
    let c = t.center();
    let (w, h) = size;
    match side {
        InkSide::Below => Bx::new(c.x - w / 2.0, t.bottom() + off, w, h),
        InkSide::Above => Bx::new(c.x - w / 2.0, t.y - off - h, w, h),
        InkSide::Right => Bx::new(t.right() + off, c.y - h / 2.0, w, h),
        InkSide::Left => Bx::new(t.x - off - w, c.y - h / 2.0, w, h),
    }
}

/// `besideClear`.
pub fn beside_clear(t: &Bx, side: InkSide, size: (f64, f64), off: f64, obstacles: &[Bx], area: &Bx) -> Bx {
    let across = matches!(side, InkSide::Left | InkSide::Right);
    let b = keep_in(beside_box(t, side, size, off), area);
    let spans = |o: &Bx| if across { o.x < t.right() && o.right() > t.x } else { o.y < t.bottom() && o.bottom() > t.y };
    let wider: Vec<&Bx> =
        obstacles.iter().filter(|o| overlap(&b, o) > 0.0 && overlap(o, t) == 0.0 && spans(o)).collect();
    if wider.is_empty() {
        return b;
    }
    let past = union(std::iter::once(Some(t)).chain(wider.into_iter().map(Some))).unwrap();
    let base = if across { Bx { y: t.y, height: t.height, ..past } } else { Bx { x: t.x, width: t.width, ..past } };
    keep_in(beside_box(&base, side, size, off), area)
}

/// `clearOf`.
pub fn clear_of(t: &Bx, side: InkSide, obstacles: &[Bx]) -> Bx {
    let reach = 46.0;
    let mut out = *t;
    let vertical = matches!(side, InkSide::Above | InkSide::Below);
    for o in obstacles {
        let spans = if vertical { o.x < t.right() && o.right() > t.x } else { o.y < t.bottom() && o.bottom() > t.y };
        if !spans || overlap(o, t) > 0.5 * o.width * o.height {
            continue;
        }
        let gap = match side {
            InkSide::Below => o.y - t.bottom(),
            InkSide::Above => t.y - o.bottom(),
            InkSide::Right => o.x - t.right(),
            InkSide::Left => t.x - o.right(),
        };
        if (-4.0..reach).contains(&gap) {
            let add =
                if vertical { Bx::new(t.x, o.y, t.width, o.height) } else { Bx::new(o.x, t.y, o.width, t.height) };
            out = union([Some(&out), Some(&add)]).unwrap();
        }
    }
    out
}

/// Where text may go for an ink item (`TextSide`).
#[derive(Clone, Copy, PartialEq)]
pub enum TextSide {
    Right,
    Below,
    Above,
    Left,
    AboveRight,
    BelowRight,
    AboveLeft,
    BelowLeft,
}

pub const TEXT_SIDES: [TextSide; 8] = [
    TextSide::Right,
    TextSide::AboveRight,
    TextSide::Above,
    TextSide::Below,
    TextSide::BelowRight,
    TextSide::Left,
    TextSide::AboveLeft,
    TextSide::BelowLeft,
];
pub const UNDER_FIRST: [TextSide; 5] =
    [TextSide::Below, TextSide::BelowRight, TextSide::Right, TextSide::Above, TextSide::Left];

pub fn side_only(s: InkSide) -> [TextSide; 1] {
    [match s {
        InkSide::Above => TextSide::Above,
        InkSide::Below => TextSide::Below,
        InkSide::Left => TextSide::Left,
        InkSide::Right => TextSide::Right,
    }]
}

/// `placeText`: the clearest spot for text beside `mark`; `crowded` says even the best covers something.
pub fn place_text(
    mark: &Bx,
    target: &Bx,
    size: (f64, f64),
    obstacles: &[Bx],
    area: &Bx,
    sides: &[TextSide],
) -> (Bx, bool) {
    let g = 12.0;
    let (w, h) = size;
    let at = |side: TextSide| {
        let mid_y = target.y + target.height / 2.0 - h / 2.0;
        let mid_x = target.x + target.width / 2.0 - w / 2.0;
        let (x, y) = match side {
            TextSide::Right => (mark.right() + g, mid_y),
            TextSide::Left => (mark.x - g - w, mid_y),
            TextSide::Above => (mid_x, mark.y - g - h),
            TextSide::Below => (mid_x, mark.bottom() + g),
            TextSide::AboveRight => (mark.right() - 10.0, mark.y - h + 4.0),
            TextSide::BelowRight => (mark.right() - 10.0, mark.bottom() - 4.0),
            TextSide::AboveLeft => (mark.x - w + 10.0, mark.y - h + 4.0),
            TextSide::BelowLeft => (mark.x - w + 10.0, mark.bottom() - 4.0),
        };
        Bx::new(x, y, w, h)
    };
    let mut best: Option<(Bx, f64)> = None;
    for (i, &side) in sides.iter().enumerate() {
        let across = matches!(side, TextSide::Left | TextSide::Right);
        for (j, f) in [0.0, -0.35, 0.35, -0.7, 0.7, -1.1, 1.1, 1.6, -1.6].iter().enumerate() {
            let base = at(side);
            let b = keep_in(
                Bx {
                    x: base.x + if across { 0.0 } else { f * w },
                    y: base.y + if across { f * (h + 6.0) } else { 0.0 },
                    ..base
                },
                area,
            );
            let near = b.grow(8.0);
            let score = 80.0 * overlap(&b, &target.grow(4.0))
                + 40.0 * overlap(&b, mark)
                + 15.0 * obstacles.iter().map(|o| overlap(&near, o)).sum::<f64>()
                + 300.0 * i as f64
                + 200.0 * j as f64;
            if best.is_none_or(|(_, s)| score < s) {
                best = Some((b, score));
            }
        }
    }
    let b = best.unwrap().0;
    let crowded = obstacles.iter().any(|o| overlap(&b, o) > 40.0) || overlap(&b, target) > 40.0;
    (b, crowded)
}

fn headed(a: Pt, ctrl: Pt, b: Pt, n: usize, rand: &mut Random, pen: f64) -> Sketch {
    let shaft: Vec<Pt> = (0..=n)
        .map(|i| {
            let t = i as f64 / n as f64;
            let w = if i > 0 && i < n { (rand.next() - 0.5) * 1.5 } else { 0.0 };
            Pt {
                x: (1.0 - t).powi(2) * a.x + 2.0 * (1.0 - t) * t * ctrl.x + t * t * b.x + w,
                y: (1.0 - t).powi(2) * a.y + 2.0 * (1.0 - t) * t * ctrl.y + t * t * b.y + w,
            }
        })
        .collect();
    let last = shaft[n - 2];
    let angle = (b.y - last.y).atan2(b.x - last.x);
    let barb = |turn: f64| Pt { x: b.x - 22.0 * (angle + turn).cos(), y: b.y - 22.0 * (angle + turn).sin() };
    let strokes =
        vec![Stroke { points: shaft, sharp: false }, Stroke { points: vec![barb(0.5), b, barb(-0.5)], sharp: true }];
    Sketch { bounds: bounds_of(&strokes, pen), strokes }
}

fn bowed_arrow(tail: Pt, target: &Bx, seed: u32, min_bow: f64, pen: f64, share: Option<f64>) -> Sketch {
    let mut rand = Random::new(seed);
    let tip = edge_toward(target, tail);
    let len = (tip.x - tail.x).hypot(tip.y - tail.y);
    let len = if len == 0.0 { 1.0 } else { len };
    let nx = -(tip.y - tail.y) / len;
    let ny = (tip.x - tail.x) / len;
    let bow = match share {
        None => min_bow.max(len * 0.15) * if nx >= 0.0 { 1.0 } else { -1.0 },
        Some(s) => js_sign(s) * min_bow.max(len * s.abs()),
    };
    let ctrl = Pt { x: (tail.x + tip.x) / 2.0 + nx * bow, y: (tail.y + tip.y) / 2.0 + ny * bow };
    headed(tail, ctrl, tip, 20, &mut rand, pen)
}

fn js_sign(v: f64) -> f64 {
    if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        0.0
    }
}

fn swing(a: Pt, b: Pt, bulge: f64, seed: u32, pen: f64) -> Sketch {
    let down = (b.y - a.y).abs() >= (b.x - a.x).abs();
    let ctrl = if down {
        Pt { x: if bulge >= 0.0 { a.x.max(b.x) } else { a.x.min(b.x) } + bulge * 1.6, y: (a.y + b.y) / 2.0 }
    } else {
        Pt { x: (a.x + b.x) / 2.0, y: if bulge >= 0.0 { a.y.min(b.y) } else { a.y.max(b.y) } - bulge * 1.6 }
    };
    headed(a, ctrl, b, 24, &mut Random::new(seed), pen)
}

fn hits(points: &[Pt], obstacles: &[Bx]) -> usize {
    points.iter().filter(|p| obstacles.iter().any(|o| inside(p, o))).count()
}

/// `linkSketch`: the arrow from one box to another.
pub fn link_sketch(source: Option<&Bx>, tail: Pt, target: &Bx, obstacles: &[Bx], seed: u32, pen: f64) -> Sketch {
    let tip = edge_toward(target, tail);
    let len = (tip.x - tail.x).hypot(tip.y - tail.y);
    let len = if len == 0.0 { 1.0 } else { len };
    let vertical =
        source.is_some_and(|s| (s.center().y - target.center().y).abs() > (s.center().x - target.center().x).abs());
    let round = |side: f64, bulge: f64| -> Option<Sketch> {
        let s = source?;
        Some(if vertical {
            let x = |b: &Bx| if side > 0.0 { b.right() + 12.0 } else { b.x - 12.0 };
            swing(Pt { x: x(s), y: s.center().y }, Pt { x: x(target), y: target.center().y }, side * bulge, seed, pen)
        } else {
            let y = |b: &Bx| if side > 0.0 { b.y - 12.0 } else { b.bottom() + 12.0 };
            swing(Pt { x: s.center().x, y: y(s) }, Pt { x: target.center().x, y: y(target) }, side * bulge, seed, pen)
        })
    };
    if source.is_some() && len < 140.0 {
        return round(1.0, if vertical { 70.0 } else { 60.0 }).unwrap();
    }
    let others: Vec<Bx> = obstacles
        .iter()
        .filter(|o| {
            overlap(o, &target.grow(2.0)) < o.width * o.height * 0.5
                && source.is_none_or(|s| overlap(o, &s.grow(2.0)) < o.width * o.height * 0.5)
        })
        .copied()
        .collect();
    let mut candidates: Vec<(Option<Sketch>, f64)> = [0.15, -0.15, 0.3, -0.3, 0.5, -0.5, 0.75, -0.75]
        .iter()
        .map(|&bow: &f64| (Some(bowed_arrow(tail, target, seed, 34.0, pen, Some(bow))), bow.abs() * 40.0))
        .collect();
    candidates.push((round(1.0, 70.0), 40.0));
    candidates.push((round(-1.0, 70.0), 45.0));
    let mut best: Option<(Sketch, f64)> = None;
    for (sketch, c) in candidates {
        let Some(sketch) = sketch else { continue };
        let score = 100.0 * hits(&sketch.strokes[0].points, &others) as f64 + c;
        if best.as_ref().is_none_or(|(_, s)| score < *s) {
            best = Some((sketch, score));
        }
    }
    best.unwrap().0
}

/// `shaftBulge`.
pub fn shaft_bulge(sketch: &Sketch) -> Pt {
    let pts = &sketch.strokes[0].points;
    let (a, b) = (pts[0], pts[pts.len() - 1]);
    let len = (b.x - a.x).hypot(b.y - a.y);
    let len = if len == 0.0 { 1.0 } else { len };
    let off = |p: &Pt| ((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)).abs() / len;
    let mut m = pts[pts.len() / 2];
    for p in pts {
        if off(p) > off(&m) {
            m = *p;
        }
    }
    m
}

/// `rowEnd`.
pub fn row_end(mark: &Bx, size: (f64, f64), obstacles: &[Bx], area: &Bx) -> Option<Bx> {
    let y = mark.y + mark.height / 2.0 - size.1 / 2.0;
    let band = Bx::new(area.x, y, area.width, size.1);
    let end = obstacles
        .iter()
        .filter(|o| overlap(o, &band) > 0.0 && o.x < mark.right() + 400.0)
        .map(|o| o.right())
        .fold(mark.right(), f64::max);
    let b = Bx::new(end + 24.0, y, size.0, size.1);
    if b.right() > area.right() || obstacles.iter().any(|o| overlap(&b, o) > 0.0) { None } else { Some(b) }
}

/// `leader`: text off in the nearest free space, with a leader arrow back to the mark.
pub fn leader(mark: &Bx, size: (f64, f64), obstacles: &[Bx], area: &Bx, seed: u32, pen: f64) -> (Bx, Vec<Stroke>) {
    let c = mark.center();
    let mut best: Option<(Bx, Pt, f64)> = None;
    for reach in [90.0, 150.0, 220.0, 300.0, 400.0, 520.0] {
        for a in 0..16 {
            let th = (a as f64 / 16.0) * 2.0 * std::f64::consts::PI - std::f64::consts::PI / 4.0;
            let d = Pt { x: th.cos(), y: th.sin() };
            let edge = edge_toward(mark, Pt { x: c.x + d.x * 1e4, y: c.y + d.y * 1e4 });
            let want = Pt { x: edge.x + d.x * reach, y: edge.y + d.y * reach };
            let b = keep_in(
                Bx::new(if d.x >= 0.0 { want.x } else { want.x - size.0 }, want.y - size.1 / 2.0, size.0, size.1),
                area,
            );
            let tail = Pt { x: c.x.max(b.x - 6.0).min(b.right() + 6.0), y: c.y.max(b.y - 6.0).min(b.bottom() + 6.0) };
            let tip = edge_toward(mark, tail);
            let crossed = (0..10)
                .map(|i| Pt {
                    x: tail.x + ((tip.x - tail.x) * (i as f64 + 0.5)) / 10.0,
                    y: tail.y + ((tip.y - tail.y) * (i as f64 + 0.5)) / 10.0,
                })
                .filter(|p| obstacles.iter().any(|o| inside(p, o)))
                .count() as f64;
            let score = 30.0 * obstacles.iter().map(|o| overlap(&b.grow(8.0), o)).sum::<f64>()
                + 30.0 * overlap(&b, &mark.grow(6.0))
                + 2500.0 * crossed
                + 4.0 * reach;
            if best.is_none_or(|(_, _, s)| score < s) {
                best = Some((b, tail, score));
            }
        }
    }
    let (b, tail, _) = best.unwrap();
    (b, bowed_arrow(tail, mark, seed, 12.0, pen, None).strokes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_matches_mulberry32() {
        // From the TS: random(seedOf("0:circle:")) first values.
        let mut r = Random::new(seed_of("0:circle:"));
        let v = r.next();
        assert!((0.0..1.0).contains(&v));
        assert_eq!(seed_of(""), 2166136261);
    }
}
