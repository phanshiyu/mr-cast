//! The slice of d3-geo the map scene draws with: the equal-earth, natural-earth and mercator projections turned about a
//! central meridian, antimeridian clipping with polygon rejoin, adaptive resampling, path bounds, fitting a box, and
//! the spherical distance, interpolation and bounds helpers of shared/map.mjs. Ported from d3-geo.

use std::f64::consts::{FRAC_PI_2, PI, TAU};

pub type P = (f64, f64);
const EPS: f64 = 1e-6;
const EPS2: f64 = EPS * EPS;
const RAD: f64 = PI / 180.0;
const DEG: f64 = 180.0 / PI;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    EqualEarth,
    NaturalEarth,
    Mercator,
}

fn raw(kind: Kind, lambda: f64, phi: f64) -> P {
    match kind {
        Kind::EqualEarth => {
            let (a1, a2, a3, a4, m) = (1.340264, -0.081106, 0.000893, 0.003796, 3f64.sqrt() / 2.0);
            let l = (m * phi.sin()).asin();
            let (l2, l6) = (l * l, l.powi(6));
            (
                lambda * l.cos() / (m * (a1 + 3.0 * a2 * l2 + l6 * (7.0 * a3 + 9.0 * a4 * l2))),
                l * (a1 + a2 * l2 + l6 * (a3 + a4 * l2)),
            )
        }
        Kind::NaturalEarth => {
            let (p2, p4) = (phi * phi, phi.powi(4));
            (
                lambda * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
                phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
            )
        }
        Kind::Mercator => (lambda, ((FRAC_PI_2 + phi.clamp(-FRAC_PI_2 + 1e-9, FRAC_PI_2 - 1e-9)) / 2.0).tan().ln()),
    }
}

/// A projection turned about a central meridian, scaled and translated (`geoX().rotate([-meridian, 0])`).
#[derive(Clone, Copy, Debug)]
pub struct Projection {
    pub kind: Kind,
    /// The rotation about the poles' axis, in radians.
    delta: f64,
    pub k: f64,
    pub dx: f64,
    pub dy: f64,
}

/// What a path is drawn from.
pub enum Geom<'a> {
    Sphere,
    Points(&'a [P]),
    Line(&'a [P]),
    /// Polygons as rings of [lng, lat] degrees, each ring closed (its last point repeats the first).
    Polygons(&'a [Vec<Vec<P>>]),
}

/// A path: open lines, or closed rings, in screen coordinates.
#[derive(Default, Debug, Clone)]
pub struct Path {
    pub parts: Vec<(Vec<P>, bool)>,
}

impl Path {
    pub fn bounds(&self) -> Option<[f64; 4]> {
        let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        for (pts, _) in &self.parts {
            for p in pts {
                if p.0.is_finite() && p.1.is_finite() {
                    b = [b[0].min(p.0), b[1].min(p.1), b[2].max(p.0), b[3].max(p.1)];
                }
            }
        }
        (b[0] <= b[2] && b[1] <= b[3]).then_some(b)
    }
    /// SVG path data under a camera `p * k + (x, y)`.
    pub fn svg(&self, k: f64, x: f64, y: f64) -> String {
        let mut s = String::new();
        for (pts, closed) in &self.parts {
            for (i, p) in pts.iter().enumerate() {
                s.push_str(&format!("{}{:.2},{:.2}", if i == 0 { "M" } else { "L" }, p.0 * k + x, p.1 * k + y));
            }
            if *closed && !pts.is_empty() {
                s.push('Z');
            }
        }
        s
    }
}

fn cartesian(l: f64, p: f64) -> [f64; 3] {
    let c = p.cos();
    [c * l.cos(), c * l.sin(), p.sin()]
}

// ─── Clipping ───

fn intersect(l0: f64, p0: f64, l1: f64, p1: f64) -> f64 {
    let s = (l0 - l1).sin();
    if s.abs() > EPS {
        let c1 = p1.cos();
        ((p0.sin() * c1 * l1.sin() - p1.sin() * p0.cos() * l0.sin()) / (p0.cos() * c1 * s)).atan()
    } else {
        (p0 + p1) / 2.0
    }
}

/// The antimeridian line clip: segments of the line, and `clean` (1 without a crossing, 2 with).
fn anti_line(points: &[P]) -> (Vec<Vec<P>>, u8) {
    let mut segs: Vec<Vec<P>> = vec![vec![]];
    let (mut clean, mut l0, mut p0, mut sign0) = (1u8, f64::NAN, f64::NAN, f64::NAN);
    for &(mut l1, p1) in points {
        let sign1 = if l1 > 0.0 { PI } else { -PI };
        let delta = (l1 - l0).abs();
        if (delta - PI).abs() < EPS {
            p0 = if (p0 + p1) / 2.0 > 0.0 { FRAC_PI_2 } else { -FRAC_PI_2 };
            segs.last_mut().unwrap().push((l0, p0));
            segs.last_mut().unwrap().push((sign0, p0));
            segs.push(vec![]);
            segs.last_mut().unwrap().push((sign1, p0));
            segs.last_mut().unwrap().push((l1, p0));
            clean = 0;
        } else if sign0 != sign1 && delta >= PI {
            if (l0 - sign0).abs() < EPS {
                l0 -= sign0 * EPS;
            }
            if (l1 - sign1).abs() < EPS {
                l1 -= sign1 * EPS;
            }
            p0 = intersect(l0, p0, l1, p1);
            segs.last_mut().unwrap().push((sign0, p0));
            segs.push(vec![]);
            segs.last_mut().unwrap().push((sign1, p0));
            clean = 0;
        }
        l0 = l1;
        p0 = p1;
        segs.last_mut().unwrap().push((l0, p0));
        sign0 = sign1;
    }
    (segs, 2 - clean)
}

fn interpolate(from: Option<P>, to: Option<P>, direction: f64, out: &mut Vec<P>) {
    match (from, to) {
        (None, _) | (_, None) => {
            let phi = direction * FRAC_PI_2;
            for p in [
                (-PI, phi),
                (0.0, phi),
                (PI, phi),
                (PI, 0.0),
                (PI, -phi),
                (0.0, -phi),
                (-PI, -phi),
                (-PI, 0.0),
                (-PI, phi),
            ] {
                out.push(p);
            }
        }
        (Some(f), Some(t)) => {
            if (f.0 - t.0).abs() > EPS {
                let lambda = if f.0 < t.0 { PI } else { -PI };
                let phi = direction * lambda / 2.0;
                out.push((-lambda, phi));
                out.push((0.0, phi));
                out.push((lambda, phi));
            } else {
                out.push(t);
            }
        }
    }
}

fn longitude(l: f64) -> f64 {
    if l.abs() <= PI { l } else { l.signum() * ((l.abs() + PI) % TAU - PI) }
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn normalize(a: [f64; 3]) -> [f64; 3] {
    let l = (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt();
    [a[0] / l, a[1] / l, a[2] / l]
}

/// Whether the polygon (rings of [lambda, phi] radians) contains the point (`polygonContains`).
fn polygon_contains(polygon: &[Vec<P>], point: P) -> bool {
    let lambda = longitude(point.0);
    let mut phi = point.1;
    let sin_phi = phi.sin();
    let normal = [lambda.sin(), -lambda.cos(), 0.0];
    let (mut angle, mut winding, mut sum) = (0.0f64, 0i64, 0.0f64);
    if sin_phi == 1.0 {
        phi = FRAC_PI_2 + EPS;
    } else if sin_phi == -1.0 {
        phi = -FRAC_PI_2 - EPS;
    }
    for ring in polygon {
        let m = ring.len();
        if m == 0 {
            continue;
        }
        let mut point0 = ring[m - 1];
        let mut lambda0 = longitude(point0.0);
        let phi0 = point0.1 / 2.0 + PI / 4.0;
        let (mut sin0, mut cos0) = (phi0.sin(), phi0.cos());
        for &point1 in ring {
            let lambda1 = longitude(point1.0);
            let phi1 = point1.1 / 2.0 + PI / 4.0;
            let (sin1, cos1) = (phi1.sin(), phi1.cos());
            let delta = lambda1 - lambda0;
            let sign = if delta >= 0.0 { 1.0 } else { -1.0 };
            let abs_delta = sign * delta;
            let anti = abs_delta > PI;
            let k = sin0 * sin1;
            sum += (k * sign * abs_delta.sin()).atan2(cos0 * cos1 + k * abs_delta.cos());
            angle += if anti { delta + sign * TAU } else { delta };
            if anti ^ (lambda0 >= lambda) ^ (lambda1 >= lambda) {
                let arc = normalize(cross(cartesian(point0.0, point0.1), cartesian(point1.0, point1.1)));
                let inter = normalize(cross(normal, arc));
                let phi_arc = (if anti ^ (delta >= 0.0) { -1.0 } else { 1.0 }) * inter[2].asin();
                if phi > phi_arc || phi == phi_arc && (arc[0] != 0.0 || arc[1] != 0.0) {
                    winding += if anti ^ (delta >= 0.0) { 1 } else { -1 };
                }
            }
            lambda0 = lambda1;
            sin0 = sin1;
            cos0 = cos1;
            point0 = point1;
        }
    }
    ((angle < -EPS || angle < EPS && sum < -EPS2) as i64 ^ (winding & 1)) != 0
}

struct Node {
    x: P,
    z: Option<usize>,
    o: usize,
    e: bool,
    v: bool,
    n: usize,
    p: usize,
}

fn compare(a: &P, b: &P) -> std::cmp::Ordering {
    let f = |p: &P| if p.0 < 0.0 { p.1 - FRAC_PI_2 - EPS } else { FRAC_PI_2 - p.1 };
    f(a).partial_cmp(&f(b)).unwrap_or(std::cmp::Ordering::Equal)
}

fn point_equal(a: P, b: P) -> bool {
    (a.0 - b.0).abs() < EPS && (a.1 - b.1).abs() < EPS
}

/// `clipRejoin`: stitches clipped segments and the antimeridian's edges into rings.
fn rejoin(segments: Vec<Vec<P>>, mut start_inside: bool, out: &mut Vec<Vec<P>>) {
    let mut nodes: Vec<Node> = Vec::new();
    let (mut subject, mut clip): (Vec<usize>, Vec<usize>) = (vec![], vec![]);
    for (si, seg) in segments.iter().enumerate() {
        let n = seg.len().wrapping_sub(1);
        if seg.len() < 2 {
            continue;
        }
        let (p0, p1) = (seg[0], seg[n]);
        if point_equal(p0, p1) {
            out.push(seg[..n].to_vec());
            continue;
        }
        for (pt, entry) in [(p0, true), (p1, false)] {
            let s = nodes.len();
            nodes.push(Node { x: pt, z: Some(si), o: s + 1, e: entry, v: false, n: 0, p: 0 });
            nodes.push(Node { x: pt, z: None, o: s, e: !entry, v: false, n: 0, p: 0 });
            subject.push(s);
            clip.push(s + 1);
        }
    }
    if subject.is_empty() {
        return;
    }
    clip.sort_by(|a, b| compare(&nodes[*a].x, &nodes[*b].x));
    for list in [&subject, &clip] {
        let n = list.len();
        for i in 0..n {
            let (a, b) = (list[i], list[(i + 1) % n]);
            nodes[a].n = b;
            nodes[b].p = a;
        }
    }
    for &c in &clip {
        start_inside = !start_inside;
        nodes[c].e = start_inside;
    }
    let start = subject[0];
    loop {
        let mut current = start;
        let mut is_subject = true;
        while nodes[current].v {
            current = nodes[current].n;
            if current == start {
                return;
            }
        }
        let mut points = nodes[current].z;
        let mut ring: Vec<P> = Vec::new();
        loop {
            nodes[current].v = true;
            let o = nodes[current].o;
            nodes[o].v = true;
            if nodes[current].e {
                if is_subject {
                    if let Some(z) = points {
                        ring.extend(segments[z].iter().copied());
                    }
                } else {
                    interpolate(Some(nodes[current].x), Some(nodes[nodes[current].n].x), 1.0, &mut ring);
                }
                current = nodes[current].n;
            } else {
                if is_subject {
                    points = nodes[nodes[current].p].z;
                    if let Some(z) = points {
                        ring.extend(segments[z].iter().rev().copied());
                    }
                } else {
                    interpolate(Some(nodes[current].x), Some(nodes[nodes[current].p].x), -1.0, &mut ring);
                }
                current = nodes[current].p;
            }
            current = nodes[current].o;
            points = nodes[current].z;
            is_subject = !is_subject;
            if nodes[current].v {
                break;
            }
        }
        out.push(ring);
    }
}

/// Clips polygon rings (radians, rotated) at the antimeridian; the rings to draw.
fn clip_polygon(rings: &[Vec<P>]) -> Vec<Vec<P>> {
    let mut out: Vec<Vec<P>> = Vec::new();
    let mut segments: Vec<Vec<P>> = Vec::new();
    let mut polygon: Vec<Vec<P>> = Vec::new();
    for ring in rings {
        if ring.is_empty() {
            continue;
        }
        let mut closed = ring.clone();
        closed.push(ring[0]);
        let (mut segs, clean) = anti_line(&closed);
        polygon.push(ring.clone());
        if clean & 1 != 0 {
            let seg = &segs[0];
            let m = seg.len() - 1;
            if m > 0 {
                out.push(seg[..m].to_vec());
            }
            continue;
        }
        if segs.len() > 1 && clean & 2 != 0 {
            let last = segs.pop().unwrap();
            let first = segs.remove(0);
            let mut joined = last;
            joined.extend(first);
            segs.push(joined);
        }
        segments.extend(segs.into_iter().filter(|s| s.len() > 1));
    }
    let start_inside = polygon_contains(&polygon, (-PI, -FRAC_PI_2));
    if !segments.is_empty() {
        rejoin(segments, start_inside, &mut out);
    } else if start_inside {
        let mut ring = Vec::new();
        interpolate(None, None, 1.0, &mut ring);
        out.push(ring);
    }
    out
}

// ─── Projection and resampling ───

impl Projection {
    pub fn new(kind: Kind, meridian: f64) -> Projection {
        let k = match kind {
            Kind::EqualEarth => 177.158,
            Kind::NaturalEarth => 175.295,
            Kind::Mercator => 961.0 / TAU,
        };
        Projection { kind, delta: -meridian * RAD, k, dx: 480.0, dy: 250.0 }
    }

    fn rotate(&self, l: f64, p: f64) -> P {
        let mut l = l + self.delta;
        if l > PI {
            l -= TAU;
        } else if l < -PI {
            l += TAU;
        }
        (l, p)
    }

    /// Screen point of a rotated spherical point (radians).
    fn project(&self, l: f64, p: f64) -> P {
        let (x, y) = raw(self.kind, l, p);
        (x * self.k + self.dx, self.dy - y * self.k)
    }

    /// Where [lng, lat] degrees land, or None when the projection cannot place it.
    pub fn point(&self, lng: f64, lat: f64) -> Option<P> {
        let (l, p) = self.rotate(lng * RAD, lat * RAD);
        let r = self.project(l, p);
        (r.0.is_finite() && r.1.is_finite()).then_some(r)
    }

    fn resample_to(&self, a: &Rs, b: &Rs, depth: u32, out: &mut Vec<P>) {
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let d2 = dx * dx + dy * dy;
        if d2 > 4.0 * 0.5 && depth > 0 {
            let depth = depth - 1;
            let (ca, cb, cc) = (a.c[0] + b.c[0], a.c[1] + b.c[1], a.c[2] + b.c[2]);
            let m = (ca * ca + cb * cb + cc * cc).sqrt();
            let cc = cc / m;
            let phi2 = cc.asin();
            let lambda2 =
                if (cc.abs() - 1.0).abs() < EPS || (a.l - b.l).abs() < EPS { (a.l + b.l) / 2.0 } else { cb.atan2(ca) };
            let (x2, y2) = self.project(lambda2, phi2);
            let (dx2, dy2) = (x2 - a.x, y2 - a.y);
            let dz = dy * dx2 - dx * dy2;
            if dz * dz / d2 > 0.5
                || ((dx * dx2 + dy * dy2) / d2 - 0.5).abs() > 0.3
                || a.c[0] * b.c[0] + a.c[1] * b.c[1] + a.c[2] * b.c[2] < (30.0 * RAD).cos()
            {
                let mid = Rs { x: x2, y: y2, l: lambda2, c: [ca / m, cb / m, cc] };
                self.resample_to(a, &mid, depth, out);
                out.push((x2, y2));
                self.resample_to(&mid, b, depth, out);
            }
        }
    }

    fn rs(&self, l: f64, p: f64) -> Rs {
        let (x, y) = self.project(l, p);
        Rs { x, y, l, c: cartesian(l, p) }
    }

    /// A clipped line (radians) resampled and projected; closed to its start for a ring.
    fn resample(&self, pts: &[P], ring: bool) -> Vec<P> {
        let mut out = Vec::new();
        let mut prev: Option<Rs> = None;
        let mut first: Option<Rs> = None;
        for &(l, p) in pts {
            let cur = self.rs(l, p);
            if let Some(a) = &prev {
                self.resample_to(a, &cur, 16, &mut out);
            }
            out.push((cur.x, cur.y));
            if first.is_none() {
                first = Some(Rs { ..cur });
            }
            prev = Some(cur);
        }
        if ring && let (Some(a), Some(b)) = (&prev, &first) {
            self.resample_to(a, b, 16, &mut out);
        }
        out
    }

    /// A geometry drawn through the projection (`geoPath(projection)(geometry)`).
    pub fn path(&self, g: &Geom) -> Path {
        let mut path = Path::default();
        let rot = |p: &P| self.rotate(p.0 * RAD, p.1 * RAD);
        match g {
            Geom::Sphere => {
                let mut ring = Vec::new();
                interpolate(None, None, 1.0, &mut ring);
                path.parts.push((self.resample(&ring, true), true));
            }
            Geom::Points(ps) => {
                for p in ps.iter() {
                    if let Some(q) = self.point(p.0, p.1) {
                        path.parts.push((vec![q], false));
                    }
                }
            }
            Geom::Line(pts) => {
                let rotated: Vec<P> = pts.iter().map(rot).collect();
                let (segs, _) = anti_line(&rotated);
                for s in segs.iter().filter(|s| !s.is_empty()) {
                    path.parts.push((self.resample(s, false), false));
                }
            }
            Geom::Polygons(polys) => {
                for rings in polys.iter() {
                    let rotated: Vec<Vec<P>> = rings
                        .iter()
                        .map(|r| {
                            let n = r.len().saturating_sub(1);
                            r[..n].iter().map(rot).collect()
                        })
                        .collect();
                    for ring in clip_polygon(&rotated) {
                        path.parts.push((self.resample(&ring, true), true));
                    }
                }
            }
        }
        path
    }

    /// Fits `g` in a `w` by `h` box (`fitSize`).
    pub fn fit_size(&mut self, w: f64, h: f64, g: &Geom) {
        self.k = 150.0;
        self.dx = 0.0;
        self.dy = 0.0;
        if let Some(b) = self.path(g).bounds() {
            let k = (w / (b[2] - b[0])).min(h / (b[3] - b[1]));
            self.dx = (w - k * (b[2] + b[0])) / 2.0;
            self.dy = (h - k * (b[3] + b[1])) / 2.0;
            self.k = 150.0 * k;
        }
    }
}

struct Rs {
    x: f64,
    y: f64,
    l: f64,
    c: [f64; 3],
}

impl Clone for Rs {
    fn clone(&self) -> Self {
        Rs { x: self.x, y: self.y, l: self.l, c: self.c }
    }
}

// ─── Spherical helpers ───

/// The angle between two [lng, lat] points (`geoDistance`).
pub fn distance(a: P, b: P) -> f64 {
    let (l0, p0, l1, p1) = (a.0 * RAD, a.1 * RAD, b.0 * RAD, b.1 * RAD);
    let d = l1 - l0;
    let (sd, cd) = (d.sin(), d.cos());
    let x = p1.cos() * sd;
    let y = p0.cos() * p1.sin() - p0.sin() * p1.cos() * cd;
    let z = p0.sin() * p1.sin() + p0.cos() * p1.cos() * cd;
    (x * x + y * y).sqrt().atan2(z)
}

/// The point `t` of the way along the great circle from a to b (`geoInterpolate`).
pub fn interpolate_at(a: P, b: P, t: f64) -> P {
    let (x0, y0, x1, y1) = (a.0 * RAD, a.1 * RAD, b.0 * RAD, b.1 * RAD);
    let (cy0, sy0, cy1, sy1) = (y0.cos(), y0.sin(), y1.cos(), y1.sin());
    let (kx0, ky0, kx1, ky1) = (cy0 * x0.cos(), cy0 * x0.sin(), cy1 * x1.cos(), cy1 * x1.sin());
    let hav = |x: f64| (x / 2.0).sin().powi(2);
    let d = 2.0 * (hav(y1 - y0) + cy0 * cy1 * hav(x1 - x0)).sqrt().asin();
    let k = d.sin();
    if d == 0.0 {
        return (x1 * DEG, y1 * DEG);
    }
    let t = t * d;
    let (bb, aa) = (t.sin() / k, (d - t).sin() / k);
    let (x, y, z) = (aa * kx0 + bb * kx1, aa * ky0 + bb * ky1, aa * sy0 + bb * sy1);
    (y.atan2(x) * DEG, z.atan2((x * x + y * y).sqrt()) * DEG)
}

/// The box round points as [[west, south], [east, north]], west past east when it crosses 180 degrees
/// (`geoBounds`, over the points' own vertices): the longitudes' smallest covering arc.
pub fn bounds_of(points: &[P]) -> Option<[P; 2]> {
    if points.is_empty() {
        return None;
    }
    let (mut s, mut n) = (f64::INFINITY, f64::NEG_INFINITY);
    let mut lngs: Vec<f64> = Vec::new();
    for &(l, p) in points {
        s = s.min(p);
        n = n.max(p);
        let mut l = l % 360.0;
        if l > 180.0 {
            l -= 360.0;
        } else if l < -180.0 {
            l += 360.0;
        }
        lngs.push(l);
    }
    lngs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    lngs.dedup();
    let (mut gap, mut at) = (lngs[0] + 360.0 - lngs[lngs.len() - 1], 0usize);
    for i in 1..lngs.len() {
        let g = lngs[i] - lngs[i - 1];
        if g > gap {
            gap = g;
            at = i;
        }
    }
    let (w, e) = (lngs[at], lngs[(at + lngs.len() - 1) % lngs.len()]);
    Some([(w, s), (e, n)])
}
