//! The pencil on the board look (ADR 48): drawn at the point being drawn, gliding between strokes, resting where it
//! last drew. A scene says what it draws and when as spans; the pencil follows each span's path while it plays.

use crate::color::Color;
use crate::display::{DisplayList, Paint, PathBuilder, Stroke as LineStroke};
use crate::marks::geometry::Pt;

/// Something drawn from frame `from` to `to`, its tip moving along `path` in frame coordinates.
#[derive(Clone, Debug)]
pub struct Span {
    pub from: f64,
    pub to: f64,
    pub path: Vec<Pt>,
}

/// Frames the pencil takes to glide to the next thing it draws.
const GLIDE: f64 = 14.0;
/// Where the pencil rests before a scene draws anything, when nothing came before.
const REST: Pt = Pt { x: 1640.0, y: 820.0 };
/// How far the pencil lifts off the board between strokes.
const LIFT: (f64, f64) = (12.0, -10.0);

fn length(path: &[Pt]) -> f64 {
    path.windows(2).map(|w| (w[1].x - w[0].x).hypot(w[1].y - w[0].y)).sum()
}

fn along(path: &[Pt], share: f64) -> Pt {
    let total = length(path);
    let mut left = share.clamp(0.0, 1.0) * total;
    for w in path.windows(2) {
        let seg = (w[1].x - w[0].x).hypot(w[1].y - w[0].y);
        if left <= seg && seg > 0.0 {
            return Pt { x: w[0].x + (w[1].x - w[0].x) * left / seg, y: w[0].y + (w[1].y - w[0].y) * left / seg };
        }
        left -= seg;
    }
    path.last().copied().unwrap_or(REST)
}

fn ease(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Where the pencil's tip is at `frame`, and how far it is lifted off the board (0 drawing, 1 lifted). `enter` is
/// where it was as the scene started.
pub fn tip(spans: &[Span], frame: f64, enter: Option<Pt>) -> (Pt, f64) {
    let lifted = |p: Pt| Pt { x: p.x + LIFT.0, y: p.y + LIFT.1 };
    if let Some(s) = spans.iter().find(|s| frame >= s.from && frame < s.to && !s.path.is_empty()) {
        return (along(&s.path, (frame - s.from) / (s.to - s.from).max(1.0)), 0.0);
    }
    let prev = spans.iter().filter(|s| s.to <= frame && !s.path.is_empty()).max_by(|a, b| a.to.total_cmp(&b.to));
    let next = spans.iter().filter(|s| s.from > frame && !s.path.is_empty()).min_by(|a, b| a.from.total_cmp(&b.from));
    let rest = lifted(prev.and_then(|s| s.path.last().copied()).or(enter).unwrap_or(REST));
    match next {
        Some(n) if frame > n.from - GLIDE => {
            let t = ease((frame - (n.from - GLIDE)) / GLIDE);
            let to = n.path[0];
            // It lifts as it leaves and sets down as it arrives.
            (Pt { x: rest.x + (to.x - rest.x) * t, y: rest.y + (to.y - rest.y) * t }, 1.0 - t)
        }
        _ => {
            // At rest it sways a little, as a hand holding it does.
            let sway = (frame / 23.0).sin() * 2.0;
            (Pt { x: rest.x + sway, y: rest.y + sway * 0.5 }, 1.0)
        }
    }
}

/// Where the pencil ends a scene: where it last drew, or where it came in.
pub fn last(spans: &[Span], enter: Option<Pt>) -> Option<Pt> {
    spans
        .iter()
        .filter(|s| !s.path.is_empty())
        .max_by(|a, b| a.to.total_cmp(&b.to))
        .and_then(|s| s.path.last().copied())
        .or(enter)
}

/// A pencil with its point at `at`, its body running down and to the right, `lift` (0 to 1) off the board.
pub fn draw(dl: &mut DisplayList, at: Pt, lift: f64, opacity: f32) {
    const BODY: f32 = 150.0;
    const HALF: f32 = 7.5;
    const CONE: f32 = 26.0;
    let (dx, dy) = (0.5f32, 0.866f32);
    let (nx, ny) = (-dy, dx);
    let lift = lift.clamp(0.0, 1.0) as f32;
    let (x, y) = (at.x as f32, at.y as f32);
    let p = |along: f32, side: f32| (x + dx * along + nx * side, y + dy * along + ny * side);
    let poly = |pts: &[(f32, f32)]| {
        let mut b = PathBuilder::new();
        b.move_to(pts[0].0, pts[0].1);
        for q in &pts[1..] {
            b.line_to(q.0, q.1);
        }
        b.close();
        b.finish()
    };
    dl.group(|dl| {
        dl.fade(opacity);
        // Its shadow on the board, further off the higher it is lifted.
        let off = 6.0 + 14.0 * lift;
        let shadow = Color::rgba8(0, 0, 0, 0.35 * (1.0 - 0.4 * lift));
        if let Some(path) = poly(&[p(CONE, -HALF), p(BODY, -HALF), p(BODY, HALF), p(CONE, HALF), p(2.0, 0.0)]) {
            dl.group(|dl| {
                dl.translate(off, off * 0.6);
                dl.path(path, Some(Paint::Solid(shadow)), None);
            });
        }
        let wood = Color::rgba8(0xd8, 0xb0, 0x86, 1.0);
        let graphite = Color::rgba8(0x3a, 0x3a, 0x38, 1.0);
        let body = Color::rgba8(0x9c, 0x9b, 0x96, 1.0);
        let shade = Color::rgba8(0x74, 0x73, 0x6e, 1.0);
        let ferrule = Color::rgba8(0xb8, 0xb6, 0xae, 1.0);
        let fill = |dl: &mut DisplayList, pts: &[(f32, f32)], c: Color| {
            if let Some(path) = poly(pts) {
                dl.path(path, Some(Paint::Solid(c)), None);
            }
        };
        fill(dl, &[p(CONE, -HALF), p(BODY - 22.0, -HALF), p(BODY - 22.0, HALF), p(CONE, HALF)], body);
        fill(dl, &[p(CONE, 0.0), p(BODY - 22.0, 0.0), p(BODY - 22.0, HALF), p(CONE, HALF)], shade);
        fill(dl, &[p(BODY - 22.0, -HALF), p(BODY - 12.0, -HALF), p(BODY - 12.0, HALF), p(BODY - 22.0, HALF)], ferrule);
        fill(
            dl,
            &[p(BODY - 12.0, -HALF), p(BODY, -HALF + 1.5), p(BODY, HALF - 1.5), p(BODY - 12.0, HALF)],
            crate::look::ORANGE,
        );
        fill(dl, &[p(0.0, 0.0), p(CONE, -HALF), p(CONE, HALF)], wood);
        fill(dl, &[p(0.0, 0.0), p(9.0, -2.6), p(9.0, 2.6)], graphite);
        // A thin edge so it reads against the board.
        if let Some(path) = poly(&[p(0.0, 0.0), p(CONE, -HALF), p(BODY, -HALF), p(BODY, HALF), p(CONE, HALF)]) {
            dl.path(path, None, Some(LineStroke::solid(Color::rgba8(0, 0, 0, 0.35), 1.0)));
        }
    });
}

/// A path along handwriting in a box: left to right along its middle, wavering as the letters do.
pub fn writing_path(x: f64, y: f64, width: f64, height: f64) -> Vec<Pt> {
    let n = ((width / 12.0).ceil() as usize).max(2);
    (0..=n)
        .map(|i| {
            let t = i as f64 / n as f64;
            Pt { x: x + width * t, y: y + height * (0.62 + 0.18 * (t * 37.0).sin()) }
        })
        .collect()
}
