//! Path helpers the diagram scenes share: SVG paths and polylines drawn on by length, arrowheads, rounded rects with a
//! radius per corner, and struck-through text.

use crate::color::Color;
use crate::display::{DisplayList, Path, PathBuilder};
use crate::text::{Style, font_ref};
use kurbo::{BezPath, ParamCurve, ParamCurveArclen, PathEl, PathSeg, Point};

const ACC: f64 = 0.05;

/// An SVG path's `d` as a Bézier path; empty for malformed data.
pub fn bez(d: &str) -> BezPath {
    BezPath::from_svg(d).unwrap_or_default()
}

/// A kurbo path as a tiny-skia path.
pub fn skia(b: &BezPath) -> Option<Path> {
    let mut pb = PathBuilder::new();
    for el in b.elements() {
        match *el {
            PathEl::MoveTo(p) => pb.move_to(p.x as f32, p.y as f32),
            PathEl::LineTo(p) => pb.line_to(p.x as f32, p.y as f32),
            PathEl::QuadTo(a, p) => pb.quad_to(a.x as f32, a.y as f32, p.x as f32, p.y as f32),
            PathEl::CurveTo(a, c, p) => {
                pb.cubic_to(a.x as f32, a.y as f32, c.x as f32, c.y as f32, p.x as f32, p.y as f32)
            }
            PathEl::ClosePath => pb.close(),
        }
    }
    pb.finish()
}

/// The path's length.
pub fn length(b: &BezPath) -> f64 {
    b.segments().map(|s| s.arclen(ACC)).sum()
}

/// The first `frac` of the path by length: what `pathLength=1` with `stroke-dashoffset: 1 - frac` leaves drawn.
pub fn trim(b: &BezPath, frac: f64) -> BezPath {
    let total = length(b);
    let mut left = total * frac.clamp(0.0, 1.0);
    let mut out = BezPath::new();
    for seg in b.segments() {
        let len = seg.arclen(ACC);
        if left <= 0.0 {
            break;
        }
        let part = if left >= len { seg } else { seg.subsegment(0.0..seg.inv_arclen(left, ACC)) };
        if out.elements().is_empty() {
            out.move_to(part.eval(0.0));
        }
        match part {
            PathSeg::Line(l) => out.line_to(l.p1),
            PathSeg::Quad(q) => out.quad_to(q.p1, q.p2),
            PathSeg::Cubic(c) => out.curve_to(c.p1, c.p2, c.p3),
        }
        left -= len;
    }
    out
}

fn unit(dx: f64, dy: f64) -> (f64, f64) {
    let l = dx.hypot(dy).max(1e-9);
    (dx / l, dy / l)
}

/// The end point of a path and the unit direction it ends in.
pub fn end_dir(b: &BezPath) -> Option<(Point, (f64, f64))> {
    let seg = b.segments().filter(|s| s.arclen(ACC) > 1e-6).last()?;
    let end = seg.eval(1.0);
    let from = match seg {
        PathSeg::Line(l) => l.p0,
        PathSeg::Quad(q) => q.p1,
        PathSeg::Cubic(c) => {
            if (c.p2 - c.p3).hypot() > 1e-6 {
                c.p2
            } else {
                c.p1
            }
        }
    };
    Some((end, unit(end.x - from.x, end.y - from.y)))
}

/// The start point of a path and the unit direction it starts in.
pub fn start_dir(b: &BezPath) -> Option<(Point, (f64, f64))> {
    let seg = b.segments().find(|s| s.arclen(ACC) > 1e-6)?;
    let start = seg.eval(0.0);
    let to = match seg {
        PathSeg::Line(l) => l.p1,
        PathSeg::Quad(q) => q.p1,
        PathSeg::Cubic(c) => {
            if (c.p1 - c.p0).hypot() > 1e-6 {
                c.p1
            } else {
                c.p2
            }
        }
    };
    Some((start, unit(to.x - start.x, to.y - start.y)))
}

/// The arrowhead marker of graph.tsx (`viewBox 0 0 10 10, refX 8, refY 5, markerWidth 7` in stroke widths): a
/// triangle whose tip is 2 units past `at`, pointing along `dir`, for a stroke `sw` wide.
pub fn marker(dl: &mut DisplayList, at: (f32, f32), dir: (f32, f32), sw: f32, color: Color) {
    let k = 7.0 * sw / 10.0;
    let (dx, dy) = dir;
    let pt = |u: f32, v: f32| {
        (at.0 + dx * (u - 8.0) * k - dy * (v - 5.0) * k, at.1 + dy * (u - 8.0) * k + dx * (v - 5.0) * k)
    };
    let mut pb = PathBuilder::new();
    let a = pt(0.0, 0.0);
    pb.move_to(a.0, a.1);
    let b = pt(10.0, 5.0);
    pb.line_to(b.0, b.1);
    let c = pt(0.0, 10.0);
    pb.line_to(c.0, c.1);
    pb.close();
    if let Some(p) = pb.finish() {
        dl.path(p, Some(color.into()), None);
    }
}

/// A `text-decoration: line-through` across a line of text starting at `x` on `baseline`, `w` wide.
pub fn strike(dl: &mut DisplayList, style: Style, x: f32, baseline: f32, w: f32, color: Color, thickness: Option<f32>) {
    let m = font_ref(style.face).metrics(&[]);
    let k = style.size / m.units_per_em as f32;
    let t = thickness.unwrap_or((m.stroke_size * k).max(1.0));
    let y = baseline - m.strikeout_offset * k;
    dl.fill_rect(x, y - t / 2.0, w, t, color);
}

/// A polyline through `points`, or None for fewer than two.
pub fn polyline(points: &[(f64, f64)]) -> Option<Path> {
    let mut pb = PathBuilder::new();
    for (i, p) in points.iter().enumerate() {
        if i == 0 {
            pb.move_to(p.0 as f32, p.1 as f32);
        } else {
            pb.line_to(p.0 as f32, p.1 as f32);
        }
    }
    pb.finish()
}

/// The first `t` (0..1) of a polyline by length, plus the heading of its last segment in radians.
pub fn partial_polyline(points: &[(f64, f64)], t: f64) -> (Vec<(f64, f64)>, f64) {
    let segs: Vec<f64> = points.windows(2).map(|w| (w[1].0 - w[0].0).hypot(w[1].1 - w[0].1)).collect();
    let mut remaining = segs.iter().sum::<f64>() * t;
    let mut out = vec![points[0]];
    for (i, &len) in segs.iter().enumerate() {
        let (a, b) = (points[i], points[i + 1]);
        let f = if len == 0.0 { 1.0 } else { 1.0f64.min(remaining / len) };
        out.push((a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f));
        remaining -= len;
        if remaining <= 0.0 || f < 1.0 {
            return (out, (b.1 - a.1).atan2(b.0 - a.0));
        }
    }
    let (a, b) = (points[points.len() - 2], points[points.len() - 1]);
    (out, (b.1 - a.1).atan2(b.0 - a.0))
}

/// A rounded rectangle with a radius per corner (top left, top right, bottom right, bottom left).
pub fn rounded_rect(x: f32, y: f32, w: f32, h: f32, r: [f32; 4]) -> Option<Path> {
    const K: f32 = 0.552_285;
    let [tl, tr, br, bl] = r;
    let mut pb = PathBuilder::new();
    pb.move_to(x + tl, y);
    pb.line_to(x + w - tr, y);
    pb.cubic_to(x + w - tr + K * tr, y, x + w, y + tr - K * tr, x + w, y + tr);
    pb.line_to(x + w, y + h - br);
    pb.cubic_to(x + w, y + h - br + K * br, x + w - br + K * br, y + h, x + w - br, y + h);
    pb.line_to(x + bl, y + h);
    pb.cubic_to(x + bl - K * bl, y + h, x, y + h - bl + K * bl, x, y + h - bl);
    pb.line_to(x, y + tl);
    pb.cubic_to(x, y + tl - K * tl, x + tl - K * tl, y, x + tl, y);
    pb.close();
    pb.finish()
}
