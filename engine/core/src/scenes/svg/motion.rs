//! Motion on the svg scene: a step's `move` (a transform tweened), `morph` (a path into another's shape) and
//! `trace` (a line drawn on). A port of shared/svg-motion.mjs.

#![allow(clippy::type_complexity)]

use super::tree::Elem;

/// `Math.round`: halves go up.
use crate::timing::js_round;
fn round3(n: f64) -> f64 {
    js_round(n * 1000.0) / 1000.0
}

/// One function of a `move` transform and its arguments.
#[derive(Clone, Debug, PartialEq)]
pub struct Func {
    pub name: &'static str,
    pub args: Vec<f64>,
}

fn arity(name: &str) -> Option<(&'static str, usize, usize)> {
    match name {
        "translate" => Some(("translate", 1, 2)),
        "rotate" => Some(("rotate", 1, 3)),
        "scale" => Some(("scale", 1, 2)),
        _ => None,
    }
}

fn split_args(s: &str) -> Vec<&str> {
    s.split(|c: char| c == ',' || c.is_whitespace()).filter(|p| !p.is_empty()).collect()
}

/// A JS `Number(text)` for the numbers a transform holds; NaN when it is none.
fn number(s: &str) -> f64 {
    s.parse::<f64>().unwrap_or(f64::NAN)
}

/// A `transform` as a list of translate, rotate and scale (`parseTransform`); None for anything else.
pub fn parse_transform(text: &str) -> Option<Vec<Func>> {
    let mut rest = text.trim();
    let mut out = Vec::new();
    while !rest.is_empty() {
        let open = rest.find('(')?;
        let name = rest[..open].trim();
        if name.is_empty() || !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return None;
        }
        let close = rest[open..].find(')')? + open;
        let (fname, min, max) = arity(name)?;
        let args: Vec<f64> = split_args(&rest[open + 1..close]).into_iter().map(number).collect();
        if args.len() < min
            || args.len() > max
            || (fname == "rotate" && args.len() == 2)
            || args.iter().any(|a| !a.is_finite())
        {
            return None;
        }
        let args = match fname {
            "translate" => vec![args[0], *args.get(1).unwrap_or(&0.0)],
            "scale" => vec![args[0], *args.get(1).unwrap_or(&args[0])],
            _ => vec![args[0], *args.get(1).unwrap_or(&0.0), *args.get(2).unwrap_or(&0.0)],
        };
        out.push(Func { name: fname, args });
        rest = rest[close + 1..].trim_start();
        if let Some(r) = rest.strip_prefix(',') {
            rest = r.trim_start();
        }
    }
    Some(out)
}

/// Numbers as JS prints them: whole numbers without a point.
pub use crate::timing::js_num;

fn write(list: &[Func]) -> String {
    list.iter()
        .map(|f| format!("{}({})", f.name, f.args.iter().map(|a| js_num(round3(*a))).collect::<Vec<_>>().join(" ")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn identity_of(f: &Func) -> Func {
    Func {
        name: f.name,
        args: match f.name {
            "scale" => vec![1.0, 1.0],
            "rotate" => vec![0.0, f.args[1], f.args[2]],
            _ => vec![0.0, 0.0],
        },
    }
}

type Matrix = [f64; 6];

fn mul(p: Matrix, q: Matrix) -> Matrix {
    [
        p[0] * q[0] + p[2] * q[1],
        p[1] * q[0] + p[3] * q[1],
        p[0] * q[2] + p[2] * q[3],
        p[1] * q[2] + p[3] * q[3],
        p[0] * q[4] + p[2] * q[5] + p[4],
        p[1] * q[4] + p[3] * q[5] + p[5],
    ]
}

fn matrix_of(list: &[Func]) -> Matrix {
    let mut m: Matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    for f in list {
        match f.name {
            "translate" => m = mul(m, [1.0, 0.0, 0.0, 1.0, f.args[0], f.args[1]]),
            "scale" => m = mul(m, [f.args[0], 0.0, 0.0, f.args[1], 0.0, 0.0]),
            _ => {
                let r = f.args[0].to_radians();
                m = mul(
                    mul(
                        mul(m, [1.0, 0.0, 0.0, 1.0, f.args[1], f.args[2]]),
                        [r.cos(), r.sin(), -r.sin(), r.cos(), 0.0, 0.0],
                    ),
                    [1.0, 0.0, 0.0, 1.0, -f.args[1], -f.args[2]],
                );
            }
        }
    }
    m
}

struct Parts {
    tx: f64,
    ty: f64,
    angle: f64,
    sx: f64,
    sy: f64,
}

fn decompose([a, b, c, d, e, f]: Matrix) -> Parts {
    let sx = a.hypot(b);
    let angle = b.atan2(a);
    let sy = if sx != 0.0 { (a * d - b * c) / sx } else { c.hypot(d) };
    Parts { tx: e, ty: f, angle: angle.to_degrees(), sx, sy }
}

/// The transform partway, `t` from 0 to 1, as CSS tweens one (`tweenTransform`).
pub fn tween_transform(from: &str, to: &str, t: f64) -> String {
    let a = parse_transform(from).unwrap_or_default();
    let b = parse_transform(to).unwrap_or_default();
    if t <= 0.0 {
        return write(&a);
    }
    if t >= 1.0 {
        return write(&b);
    }
    let pa: Vec<Func> = if a.is_empty() { b.iter().map(identity_of).collect() } else { a.clone() };
    let pb: Vec<Func> = if b.is_empty() { a.iter().map(identity_of).collect() } else { b.clone() };
    if pa.len() == pb.len() && pa.iter().zip(&pb).all(|(f, g)| f.name == g.name) {
        let mixed: Vec<Func> = pa
            .iter()
            .zip(&pb)
            .map(|(f, g)| Func {
                name: f.name,
                args: f.args.iter().zip(&g.args).map(|(v, w)| v + (w - v) * t).collect(),
            })
            .collect();
        return write(&mixed);
    }
    let (x, y) = (decompose(matrix_of(&pa)), decompose(matrix_of(&pb)));
    let mut turn = y.angle - x.angle;
    if turn > 180.0 {
        turn -= 360.0;
    }
    if turn < -180.0 {
        turn += 360.0;
    }
    let at = |p: f64, q: f64| p + (q - p) * t;
    write(&[
        Func { name: "translate", args: vec![at(x.tx, y.tx), at(x.ty, y.ty)] },
        Func { name: "rotate", args: vec![x.angle + turn * t, 0.0, 0.0] },
        Func { name: "scale", args: vec![at(x.sx, y.sx), at(x.sy, y.sy)] },
    ])
}

// ─── Paths ───

/// A curve as [c1x, c1y, c2x, c2y, x, y].
type Curve = [f64; 6];

#[derive(Clone, Debug)]
pub struct Outline {
    start: (f64, f64),
    curves: Vec<Curve>,
    closed: bool,
}

/// A path's tokens: command letters and numbers, the way the JS regex scans them; Err on stray characters.
fn tokens(text: &str) -> Result<Vec<String>, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    let mut total = 0;
    while i < chars.len() {
        let c = chars[i];
        if "MLHVCSQTAZmlhvcsqtaz".contains(c) {
            out.push(c.to_string());
            total += 1;
            i += 1;
            continue;
        }
        // -?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?
        let mut j = i;
        if chars[j] == '-' {
            j += 1;
        }
        let digits_start = j;
        while j < chars.len() && chars[j].is_ascii_digit() {
            j += 1;
        }
        let mut ok = j > digits_start;
        if ok {
            if j < chars.len() && chars[j] == '.' {
                j += 1;
                while j < chars.len() && chars[j].is_ascii_digit() {
                    j += 1;
                }
            }
        } else if j < chars.len() && chars[j] == '.' {
            let k = j + 1;
            let mut e = k;
            while e < chars.len() && chars[e].is_ascii_digit() {
                e += 1;
            }
            if e > k {
                j = e;
                ok = true;
            }
        }
        if ok {
            if j < chars.len() && (chars[j] == 'e' || chars[j] == 'E') {
                let mut k = j + 1;
                if k < chars.len() && (chars[k] == '-' || chars[k] == '+') {
                    k += 1;
                }
                let ds = k;
                while k < chars.len() && chars[k].is_ascii_digit() {
                    k += 1;
                }
                if k > ds {
                    j = k;
                }
            }
            let tok: String = chars[i..j].iter().collect();
            total += tok.chars().count();
            out.push(tok);
            i = j;
        } else {
            i += 1;
        }
    }
    let wanted = text.chars().filter(|c| !c.is_whitespace() && *c != ',').count();
    if total < wanted {
        return Err("has characters a path's d does not use".into());
    }
    Ok(out)
}

fn cubic_outlines(d: &str) -> Result<Vec<Outline>, String> {
    let toks = tokens(d)?;
    let mut outlines: Vec<Outline> = Vec::new();
    // `pending` marks an outline begun by Z that has drawn nothing yet.
    let mut cur: Option<(Outline, bool)> = None;
    let (mut x, mut y) = (0.0f64, 0.0f64);
    let (mut last_c, mut last_q): (Option<(f64, f64)>, Option<(f64, f64)>) = (None, None);
    let mut i = 0;
    let mut cmd: Option<char> = None;
    let fail = |m: &str| Err(m.to_string());
    macro_rules! num {
        () => {{
            let v = toks.get(i).and_then(|t| t.parse::<f64>().ok());
            i += 1;
            match v {
                Some(v) if v.is_finite() => v,
                _ => return fail("ends partway through a command"),
            }
        }};
    }
    while i < toks.len() {
        let t = &toks[i];
        if t.len() == 1 && t.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
            cmd = t.chars().next();
            i += 1;
        } else if cmd.is_none() {
            return fail("must start with M");
        }
        let c = cmd.unwrap();
        let cu = c.to_ascii_uppercase();
        let rel = c != cu;
        let px = |v: f64, x: f64| if rel { x + v } else { v };
        if cur.is_none() && cu != 'M' {
            return fail("must start with M");
        }
        let (mut next_c, mut next_q) = (None, None);
        if cu == 'Z' {
            let (o, _) = cur.as_mut().unwrap();
            if x != o.start.0 || y != o.start.1 {
                let (nx, ny) = o.start;
                o.curves.push([
                    x + (nx - x) / 3.0,
                    y + (ny - y) / 3.0,
                    x + 2.0 * (nx - x) / 3.0,
                    y + 2.0 * (ny - y) / 3.0,
                    nx,
                    ny,
                ]);
            }
            o.closed = true;
            outlines.push(o.clone());
            (x, y) = o.start;
            cur = Some((Outline { start: (x, y), curves: vec![], closed: false }, true));
            cmd = None;
            last_c = None;
            last_q = None;
            continue;
        }
        if cu == 'M' {
            let (nx, ny) = (px(num!(), x), px(num!(), y));
            if let Some((o, pending)) = cur.take()
                && !pending
                && !o.curves.is_empty()
            {
                outlines.push(o);
            }
            cur = Some((Outline { start: (nx, ny), curves: vec![], closed: false }, false));
            (x, y) = (nx, ny);
            cmd = Some(if rel { 'l' } else { 'L' });
        } else if cu == 'L' || cu == 'H' || cu == 'V' {
            let nx = if cu == 'V' { x } else { px(num!(), x) };
            let ny = if cu == 'H' { y } else { px(num!(), y) };
            cur.as_mut().unwrap().0.curves.push([
                x + (nx - x) / 3.0,
                y + (ny - y) / 3.0,
                x + 2.0 * (nx - x) / 3.0,
                y + 2.0 * (ny - y) / 3.0,
                nx,
                ny,
            ]);
            (x, y) = (nx, ny);
        } else if cu == 'C' || cu == 'S' {
            let (c1x, c1y) = if cu == 'S' {
                last_c.map_or((x, y), |l| (2.0 * x - l.0, 2.0 * y - l.1))
            } else {
                (px(num!(), x), px(num!(), y))
            };
            let (c2x, c2y, nx, ny) = (px(num!(), x), px(num!(), y), px(num!(), x), px(num!(), y));
            cur.as_mut().unwrap().0.curves.push([c1x, c1y, c2x, c2y, nx, ny]);
            next_c = Some((c2x, c2y));
            (x, y) = (nx, ny);
        } else if cu == 'Q' || cu == 'T' {
            let (qx, qy) = if cu == 'T' {
                last_q.map_or((x, y), |l| (2.0 * x - l.0, 2.0 * y - l.1))
            } else {
                (px(num!(), x), px(num!(), y))
            };
            let (nx, ny) = (px(num!(), x), px(num!(), y));
            cur.as_mut().unwrap().0.curves.push([
                x + 2.0 / 3.0 * (qx - x),
                y + 2.0 / 3.0 * (qy - y),
                nx + 2.0 / 3.0 * (qx - nx),
                ny + 2.0 / 3.0 * (qy - ny),
                nx,
                ny,
            ]);
            next_q = Some((qx, qy));
            (x, y) = (nx, ny);
        } else if cu == 'A' {
            let (rx, ry, rot, large, sweep) = (num!(), num!(), num!(), num!(), num!());
            let (nx, ny) = (px(num!(), x), px(num!(), y));
            let arcs = arc_curves(x, y, rx, ry, rot, large != 0.0, sweep != 0.0, nx, ny);
            cur.as_mut().unwrap().0.curves.extend(arcs);
            (x, y) = (nx, ny);
        }
        if let Some((_, p)) = cur.as_mut() {
            *p = false;
        }
        last_c = next_c;
        last_q = next_q;
    }
    if let Some((o, pending)) = cur
        && !pending
        && !o.curves.is_empty()
    {
        outlines.push(o);
    }
    if outlines.is_empty() {
        return fail("draws nothing");
    }
    Ok(outlines)
}

#[allow(clippy::too_many_arguments)]
fn arc_curves(
    x1: f64,
    y1: f64,
    rx: f64,
    ry: f64,
    rotation: f64,
    large: bool,
    sweep: bool,
    x2: f64,
    y2: f64,
) -> Vec<Curve> {
    if (x1 == x2 && y1 == y2) || rx == 0.0 || ry == 0.0 {
        return if x1 == x2 && y1 == y2 { vec![] } else { vec![[x1, y1, x2, y2, x2, y2]] };
    }
    let (mut rx, mut ry) = (rx.abs(), ry.abs());
    let phi = rotation.to_radians();
    let (cos, sin) = (phi.cos(), phi.sin());
    let (dx, dy) = ((x1 - x2) / 2.0, (y1 - y2) / 2.0);
    let (x1p, y1p) = (cos * dx + sin * dy, -sin * dx + cos * dy);
    let grow = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if grow > 1.0 {
        rx *= grow.sqrt();
        ry *= grow.sqrt();
    }
    let sign = if large == sweep { -1.0 } else { 1.0 };
    let n = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    let k = sign * (n / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)).max(0.0).sqrt();
    let (cxp, cyp) = (k * rx * y1p / ry, -k * ry * x1p / rx);
    let (cx, cy) = (cos * cxp - sin * cyp + (x1 + x2) / 2.0, sin * cxp + cos * cyp + (y1 + y2) / 2.0);
    let angle = |ux: f64, uy: f64, vx: f64, vy: f64| (ux * vy - uy * vx).atan2(ux * vx + uy * vy);
    let theta = angle(1.0, 0.0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let mut delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if !sweep && delta > 0.0 {
        delta -= 2.0 * std::f64::consts::PI;
    }
    if sweep && delta < 0.0 {
        delta += 2.0 * std::f64::consts::PI;
    }
    let parts = ((delta.abs() / (std::f64::consts::PI / 2.0) - 1e-9).ceil()).max(1.0) as usize;
    let step = delta / parts as f64;
    let kappa = 4.0 / 3.0 * (step / 4.0).tan();
    let point = |a: f64| (cx + rx * a.cos() * cos - ry * a.sin() * sin, cy + rx * a.cos() * sin + ry * a.sin() * cos);
    let tangent = |a: f64| (-rx * a.sin() * cos - ry * a.cos() * sin, -rx * a.sin() * sin + ry * a.cos() * cos);
    (0..parts)
        .map(|n| {
            let (a0, a1) = (theta + n as f64 * step, theta + (n + 1) as f64 * step);
            let (p0, p1, t0, t1) = (point(a0), point(a1), tangent(a0), tangent(a1));
            [
                p0.0 + kappa * t0.0,
                p0.1 + kappa * t0.1,
                p1.0 - kappa * t1.0,
                p1.1 - kappa * t1.1,
                if n == parts - 1 { x2 } else { p1.0 },
                if n == parts - 1 { y2 } else { p1.1 },
            ]
        })
        .collect()
}

fn halve(from: (f64, f64), c: Curve) -> [Curve; 2] {
    let mid = |a: f64, b: f64| (a + b) / 2.0;
    let (ax, ay, bx, by, cx, cy) =
        (mid(from.0, c[0]), mid(from.1, c[1]), mid(c[0], c[2]), mid(c[1], c[3]), mid(c[2], c[4]), mid(c[3], c[5]));
    let (dx, dy, fx, fy) = (mid(ax, bx), mid(ay, by), mid(bx, cx), mid(by, cy));
    let (mx, my) = (mid(dx, fx), mid(dy, fy));
    [[ax, ay, dx, dy, mx, my], [fx, fy, cx, cy, c[4], c[5]]]
}

fn legs(from: (f64, f64), c: &Curve) -> f64 {
    (c[0] - from.0).hypot(c[1] - from.1) + (c[2] - c[0]).hypot(c[3] - c[1]) + (c[4] - c[2]).hypot(c[5] - c[3])
}

fn split_to(o: &Outline, n: usize) -> Outline {
    let mut curves = o.curves.clone();
    while curves.len() < n {
        let (mut best, mut best_len) = (0, -1.0);
        let mut from = o.start;
        for (i, c) in curves.iter().enumerate() {
            let len = legs(from, c);
            if len > best_len {
                (best, best_len) = (i, len);
            }
            from = (c[4], c[5]);
        }
        let start = if best == 0 { o.start } else { (curves[best - 1][4], curves[best - 1][5]) };
        let [a, b] = halve(start, curves[best]);
        curves.splice(best..=best, [a, b]);
    }
    Outline { curves, ..o.clone() }
}

fn start_at(o: &Outline, k: usize) -> Outline {
    if k == 0 {
        return o.clone();
    }
    let mut curves: Vec<Curve> = o.curves[k..].to_vec();
    curves.extend_from_slice(&o.curves[..k]);
    let last = curves[curves.len() - 1];
    Outline { start: (last[4], last[5]), curves, closed: o.closed }
}

/// Two paths as outlines with matching curves, ready to tween (`pairShapes`).
#[derive(Clone, Debug)]
pub struct PairedShape {
    from: Vec<Outline>,
    to: Vec<Outline>,
}

pub fn pair_shapes(from_d: &str, to_d: &str) -> Result<PairedShape, String> {
    let (a, b) = (cubic_outlines(from_d)?, cubic_outlines(to_d)?);
    if a.len() != b.len() {
        return Err(format!("draws {} outlines and the other {}", a.len(), b.len()));
    }
    let mut from = Vec::new();
    let mut to = Vec::new();
    for (p, q) in a.iter().zip(&b) {
        let n = p.curves.len().max(q.curves.len());
        let (sp, sq) = (split_to(p, n), split_to(q, n));
        if !(sp.closed && sq.closed) {
            from.push(sp);
            to.push(sq);
            continue;
        }
        let (mut best, mut best_cost) = (0, f64::INFINITY);
        for k in 0..n {
            let r = start_at(&sq, k);
            let cost: f64 = r.curves.iter().zip(&sp.curves).map(|(c, s)| (c[4] - s[4]).hypot(c[5] - s[5])).sum();
            if cost < best_cost {
                (best, best_cost) = (k, cost);
            }
        }
        from.push(sp);
        to.push(start_at(&sq, best));
    }
    Ok(PairedShape { from, to })
}

/// Outlines partway, `t` from 0 to 1, as a `d` (`tweenShape`).
pub fn tween_shape(p: &PairedShape, t: f64) -> String {
    let at = |a: f64, b: f64| js_num(round3(a + (b - a) * t));
    p.from
        .iter()
        .zip(&p.to)
        .map(|(a, b)| {
            let start = format!("M{} {}", at(a.start.0, b.start.0), at(a.start.1, b.start.1));
            let curves: String = a
                .curves
                .iter()
                .zip(&b.curves)
                .map(|(c, e)| format!("C{}", c.iter().zip(e).map(|(u, v)| at(*u, *v)).collect::<Vec<_>>().join(" ")))
                .collect();
            let closed = if t < 0.5 { a.closed } else { b.closed };
            format!("{start}{curves}{}", if closed { "Z" } else { "" })
        })
        .collect()
}

fn path_length(d: &str) -> f64 {
    let Ok(outlines) = cubic_outlines(d) else { return 0.0 };
    let mut sum = 0.0;
    for o in &outlines {
        let mut from = o.start;
        for c in &o.curves {
            sum += ((c[4] - from.0).hypot(c[5] - from.1) + legs(from, c)) / 2.0;
            from = (c[4], c[5]);
        }
    }
    sum
}

fn attr_num(e: &Elem, name: &str) -> f64 {
    e.attr(name).and_then(|v| v.trim().parse::<f64>().ok()).unwrap_or(0.0)
}

fn point_list(text: &str) -> Vec<(f64, f64)> {
    let ns: Vec<f64> = split_args(text).into_iter().map(number).collect();
    ns.as_chunks::<2>().0.iter().map(|c| (c[0], c[1])).collect()
}

fn along(pts: &[(f64, f64)], closed: bool) -> f64 {
    let mut sum: f64 = pts.windows(2).map(|w| (w[1].0 - w[0].0).hypot(w[1].1 - w[0].1)).sum();
    if closed && pts.len() > 1 {
        sum += (pts[0].0 - pts[pts.len() - 1].0).hypot(pts[0].1 - pts[pts.len() - 1].1);
    }
    sum
}

/// About how long the line a trace draws on an element is; a group's is its longest line's (`traceLength`).
pub fn trace_length(node: &Elem, d: Option<&str>) -> f64 {
    let n = |name: &str| attr_num(node, name);
    match node.tag.as_str() {
        "path" => path_length(d.or_else(|| node.attr("d")).unwrap_or("")),
        "line" => (n("x2") - n("x1")).hypot(n("y2") - n("y1")),
        "polyline" | "polygon" => along(&point_list(node.attr("points").unwrap_or("")), node.tag == "polygon"),
        "rect" => 2.0 * (n("width") + n("height")),
        "circle" => 2.0 * std::f64::consts::PI * n("r"),
        "ellipse" => {
            let (a, b) = (n("rx"), n("ry"));
            std::f64::consts::PI * (3.0 * (a + b) - ((3.0 * a + b) * (a + 3.0 * b)).sqrt())
        }
        _ => node.elements().map(|c| trace_length(c, None)).fold(0.0, f64::max),
    }
}
