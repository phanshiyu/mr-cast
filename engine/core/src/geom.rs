//! Small path helpers the scenes share.

use crate::display::{Path, PathBuilder};

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
