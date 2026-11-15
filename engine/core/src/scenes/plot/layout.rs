//! The plot scene's model and layout: a port of shared/plot.mjs (parts, axes, geometry, labels).

use super::expr::{Expr, Scope};
use crate::scenes::step_state::{SceneState, list};
pub use crate::textfit::{Family, Font, measure};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

pub const TICK_FONT: Font = Font { family: Family::Sans, weight: 500.0, size: 22.0, letter_spacing: 0.0, upper: false };
pub const AXIS_FONT: Font = Font { family: Family::Sans, weight: 600.0, size: 24.0, letter_spacing: 0.0, upper: false };
pub const LABEL_FONT: Font =
    Font { family: Family::Sans, weight: 600.0, size: 26.0, letter_spacing: 0.0, upper: false };
pub const POINT_R: f64 = 9.0;
pub const TICK_LEN: f64 = 10.0;
const TICK_GAP: f64 = 14.0;
const SAMPLES: usize = 480;
const DRAW_PX: f64 = 2.0;
const LINE_TONES: [&str; 5] = ["accent", "good", "warn", "bad", "neutral"];
const KINDS: [&str; 5] = ["functions", "series", "points", "vectors", "areas"];

pub type Px = [f64; 2];

fn line_height(font: &Font) -> f64 {
    crate::timing::js_round(font.size * 1.3)
}

/// A number written as a number or as an expression.
#[derive(Debug, Clone)]
pub enum Num {
    Const(f64),
    Expr(Arc<Expr>),
    Nan,
}

impl Num {
    pub fn of(v: Option<&Value>) -> Num {
        match v {
            Some(Value::Number(n)) => Num::Const(n.as_f64().unwrap_or(f64::NAN)),
            Some(Value::String(s)) => Num::Expr(Arc::new(Expr::parse(s))),
            _ => Num::Nan,
        }
    }
    pub fn at(&self, scope: &mut Scope) -> f64 {
        match self {
            Num::Const(v) => *v,
            Num::Expr(e) => e.eval(scope),
            Num::Nan => f64::NAN,
        }
    }
    pub fn names(&self) -> &[String] {
        match self {
            Num::Expr(e) => &e.names,
            _ => &[],
        }
    }
}

/// A point written as `[x, y]` or as a single number.
#[derive(Debug, Clone)]
pub enum Pt {
    Pair(Num, Num),
    One(Num),
}

impl Pt {
    fn of(v: &Value) -> Pt {
        match v {
            Value::Array(a) => Pt::Pair(Num::of(a.first()), Num::of(a.get(1))),
            other => Pt::One(Num::of(Some(other))),
        }
    }
    fn nums(&self) -> Vec<&Num> {
        match self {
            Pt::Pair(a, b) => vec![a, b],
            Pt::One(a) => vec![a],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Functions,
    Series,
    Points,
    Vectors,
    Areas,
}

#[derive(Debug)]
pub enum Item {
    Function { x: Option<Num>, y: Num, t: Vec<Num>, from: Option<Num>, to: Option<Num>, dashed: bool },
    Series { points: Vec<(f64, f64)>, line: bool, dashed: bool },
    Point { at: Pt, guides: bool },
    Vector { from: Option<Pt>, to: Pt },
    Area { under: Option<String>, between: Vec<String>, from: Option<Num>, to: Option<Num> },
}

#[derive(Debug)]
pub struct Label {
    pub pieces: Vec<Piece>,
}

#[derive(Debug)]
pub enum Piece {
    Text(String),
    Hole(Expr, Option<usize>),
}

#[derive(Debug)]
pub struct Part {
    pub kind: Kind,
    pub id: String,
    pub item: Item,
    pub tone: Option<String>,
    pub label: Option<Label>,
    pub side: Option<String>,
    pub hidden: bool,
}

#[derive(Debug)]
pub enum Ticks {
    Auto,
    Step(f64),
    Pi,
    List(Vec<f64>),
}

#[derive(Debug)]
pub struct Axis {
    pub from: f64,
    pub to: f64,
    pub log: bool,
    pub ticks: Ticks,
    pub prefix: String,
    pub suffix: String,
    pub label: Option<String>,
    pub grid: bool,
}

fn num_or_nan(v: Option<&Value>) -> f64 {
    v.and_then(Value::as_f64).unwrap_or(f64::NAN)
}

impl Axis {
    fn of(v: &Value) -> Axis {
        let ticks = match v.get("ticks") {
            Some(Value::Array(a)) => Ticks::List(a.iter().filter_map(Value::as_f64).collect()),
            Some(Value::String(s)) if s == "pi" => Ticks::Pi,
            Some(Value::Number(n)) if n.as_f64().is_some_and(|n| n > 0.0) => Ticks::Step(n.as_f64().unwrap()),
            _ => Ticks::Auto,
        };
        let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        Axis {
            from: num_or_nan(v.get("from")),
            to: num_or_nan(v.get("to")),
            log: v.get("log") == Some(&Value::Bool(true)),
            ticks,
            prefix: s("prefix"),
            suffix: s("suffix"),
            label: v.get("label").and_then(Value::as_str).filter(|l| !l.is_empty()).map(str::to_string),
            grid: truthy(v.get("grid")),
        }
    }
}

pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        _ => true,
    }
}

pub struct Model {
    pub x: Axis,
    pub y: Option<Axis>,
    pub equal: bool,
    pub parts: Vec<Part>,
    /// The parameters' first values, in the order written.
    pub params: Vec<(String, f64)>,
    pub dependents: HashMap<String, Vec<String>>,
    /// Ids a step traces, for the initial hidden set.
    pub traced: Vec<String>,
}

fn parse_label(v: &Value) -> Option<Label> {
    let s = v.as_str()?;
    let mut pieces = Vec::new();
    let mut at = 0;
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{'
            && let Some(close) = s[i + 1..].find(['{', '}']).filter(|&c| bytes[i + 1 + c] == b'}')
        {
            if i > at {
                pieces.push(Piece::Text(s[at..i].to_string()));
            }
            let inner = &s[i + 1..i + 1 + close];
            // `^(.*?)(?::(\d))?$`: a trailing ":d" with one digit is the decimals.
            let (expr, digits) = match inner.rsplit_once(':') {
                Some((e, d)) if d.len() == 1 && d.as_bytes()[0].is_ascii_digit() => {
                    (e, Some((d.as_bytes()[0] - b'0') as usize))
                }
                _ => (inner, None),
            };
            pieces.push(Piece::Hole(Expr::parse(expr), digits));
            i += close + 2;
            at = i;
            continue;
        }
        i += 1;
    }
    if at < s.len() {
        pieces.push(Piece::Text(s[at..].to_string()));
    }
    Some(Label { pieces })
}

fn part_of_item(kind: Kind, item: &Value) -> Option<Part> {
    let id = item.get("id")?.as_str()?.to_string();
    let n = |k: &str| item.get(k).map(|v| Num::of(Some(v)));
    let it = match kind {
        Kind::Functions => Item::Function {
            x: n("x"),
            y: Num::of(item.get("y")),
            t: list(item.get("t")).iter().map(|v| Num::of(Some(v))).collect(),
            from: n("from"),
            to: n("to"),
            dashed: truthy(item.get("dashed")),
        },
        Kind::Series => Item::Series {
            points: list(item.get("points"))
                .iter()
                .filter_map(Value::as_array)
                .map(|q| (num_or_nan(q.first()), num_or_nan(q.get(1))))
                .collect(),
            line: item.get("style").and_then(Value::as_str) == Some("line"),
            dashed: truthy(item.get("dashed")),
        },
        Kind::Points => {
            Item::Point { at: item.get("at").map_or(Pt::One(Num::Nan), Pt::of), guides: truthy(item.get("guides")) }
        }
        Kind::Vectors => {
            Item::Vector { from: item.get("from").map(Pt::of), to: item.get("to").map_or(Pt::One(Num::Nan), Pt::of) }
        }
        Kind::Areas => Item::Area {
            under: item.get("under").and_then(Value::as_str).map(str::to_string),
            between: list(item.get("between")).iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
            from: n("from"),
            to: n("to"),
        },
    };
    Some(Part {
        kind,
        id,
        item: it,
        tone: item.get("tone").and_then(Value::as_str).map(str::to_string),
        label: item.get("label").and_then(parse_label),
        side: item.get("side").and_then(Value::as_str).map(str::to_string),
        hidden: item.get("hidden") == Some(&Value::Bool(true)),
    })
}

impl Part {
    /// Every number a part is placed by, for the parameters it reads (`partNumbers`).
    fn numbers(&self) -> Vec<&Num> {
        match &self.item {
            Item::Function { x: Some(x), y, t, .. } => [x, y].into_iter().chain(t.iter()).collect(),
            Item::Function { y, from, to, .. } => [Some(y), from.as_ref(), to.as_ref()].into_iter().flatten().collect(),
            Item::Point { at, .. } => at.nums(),
            Item::Vector { from, to } => from.iter().flat_map(Pt::nums).chain(to.nums()).collect(),
            Item::Area { from, to, .. } => [from.as_ref(), to.as_ref()].into_iter().flatten().collect(),
            Item::Series { .. } => Vec::new(),
        }
    }

    /// The function ids an area fills between.
    pub fn area_functions(&self) -> Vec<&str> {
        match &self.item {
            Item::Area { under: Some(u), .. } => vec![u.as_str()],
            Item::Area { between, .. } => between.iter().map(String::as_str).collect(),
            _ => Vec::new(),
        }
    }
}

impl Model {
    pub fn new(scene: &Value) -> Result<Model, String> {
        if !scene.get("x").is_some_and(Value::is_object) {
            return Err("a plot without an x axis".into());
        }
        // Parts in drawing order; an item without a string id is not a part.
        let mut parts = Vec::new();
        for (kind, name) in
            [Kind::Functions, Kind::Series, Kind::Points, Kind::Vectors, Kind::Areas].into_iter().zip(KINDS)
        {
            for item in list(scene.get(name)) {
                if let Some(p) = part_of_item(kind, item) {
                    parts.push(p);
                }
            }
        }
        let params: Vec<(String, f64)> = scene
            .get("params")
            .and_then(Value::as_object)
            .map(|o| o.iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(f64::NAN))).collect())
            .unwrap_or_default();
        let mut dependents: HashMap<String, Vec<String>> = HashMap::new();
        for part in &parts {
            let mut read: Vec<String> = Vec::new();
            let mut add = |names: &[String]| {
                for n in names {
                    if !read.contains(n) {
                        read.push(n.clone());
                    }
                }
            };
            for n in part.numbers() {
                add(n.names());
            }
            if let Some(l) = &part.label {
                for p in &l.pieces {
                    if let Piece::Hole(e, _) = p {
                        add(&e.names);
                    }
                }
            }
            for fid in part.area_functions() {
                if let Some(f) = parts.iter().find(|p| p.id == fid) {
                    for n in f.numbers() {
                        add(n.names());
                    }
                }
            }
            for name in read {
                if params.iter().any(|(k, _)| *k == name) {
                    dependents.entry(name).or_default().push(part.id.clone());
                }
            }
        }
        let traced = list(scene.get("steps"))
            .iter()
            .flat_map(|s| list(s.get("trace")))
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        Ok(Model {
            x: Axis::of(&scene["x"]),
            y: scene.get("y").filter(|y| y.is_object()).map(Axis::of),
            equal: scene.get("equal") == Some(&Value::Bool(true)),
            parts,
            params,
            dependents,
            traced,
        })
    }

    pub fn part(&self, id: &str) -> Option<&Part> {
        self.parts.iter().find(|p| p.id == id)
    }

    /// The parameters in a state, by name (`stateParams`).
    pub fn state_params(&self, state: &SceneState) -> Vec<(String, f64)> {
        self.params
            .iter()
            .map(|(name, first)| {
                let v = state.values.get(&format!("k:{name}")).and_then(Value::as_f64).unwrap_or(*first);
                (name.clone(), v)
            })
            .collect()
    }

    /// The tone a part draws in (`partTone`).
    pub fn part_tone(&self, part: &Part) -> String {
        if let Some(t) = &part.tone {
            return t.clone();
        }
        if part.kind == Kind::Areas {
            return match part.area_functions().first().and_then(|id| self.part(id)) {
                Some(f) => self.part_tone(f),
                None => "accent".into(),
            };
        }
        if matches!(part.kind, Kind::Points | Kind::Vectors) {
            return "accent".into();
        }
        // The JS looks the part up in a fresh `plotParts(scene)`, which never holds this object: index -1, so the
        // first colour. Kept, so the engine draws what Remotion does.
        LINE_TONES[0].to_string()
    }
}

// ─── Numbers as text ───

/// `Number.prototype.toFixed`: ties round up.
pub fn to_fixed(v: f64, digits: usize) -> String {
    let exact = format!("{:.*}", digits + 30, v.abs());
    let (whole, frac) = exact.split_once('.').unwrap_or((&exact, ""));
    let mut digs: Vec<u8> = whole.bytes().chain(frac.bytes().take(digits)).map(|b| b - b'0').collect();
    let round_up = frac.as_bytes().get(digits).is_some_and(|&b| b >= b'5');
    if round_up {
        let mut i = digs.len();
        loop {
            if i == 0 {
                digs.insert(0, 1);
                break;
            }
            i -= 1;
            if digs[i] == 9 {
                digs[i] = 0;
            } else {
                digs[i] += 1;
                break;
            }
        }
    }
    let int_len = digs.len() - digits;
    let s: String = digs.iter().map(|d| (b'0' + d) as char).collect();
    let mut out = s[..int_len].to_string();
    if digits > 0 {
        out.push('.');
        out.push_str(&s[int_len..]);
    }
    out
}

/// "12,345.6" with a real minus sign (`formatNumber`).
pub fn format_number(v: f64, digits: Option<usize>) -> String {
    if !v.is_finite() {
        return "?".into();
    }
    let fixed = to_fixed(v, digits.unwrap_or(2));
    let (whole, frac) = fixed.split_once('.').map_or((fixed.as_str(), ""), |(a, b)| (a, b));
    let mut grouped = String::new();
    for (i, c) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    let tail = if digits.is_none() { frac.trim_end_matches('0') } else { frac };
    let text = if tail.is_empty() { grouped } else { format!("{grouped}.{tail}") };
    let nonzero = fixed.parse::<f64>().is_ok_and(|n| n != 0.0);
    if v < 0.0 && nonzero { format!("−{text}") } else { text }
}

fn label_text(label: &Label, scope: &mut Scope) -> String {
    label
        .pieces
        .iter()
        .map(|p| match p {
            Piece::Text(t) => t.clone(),
            Piece::Hole(e, digits) => format_number(e.eval(scope), *digits),
        })
        .collect()
}

// ─── Axes ───

#[derive(Clone, Copy)]
pub struct Scale {
    log: bool,
    from: f64,
    to: f64,
    a: f64,
    b: f64,
    /// A number line has no y axis: everything sits at `a`.
    flat: bool,
}

impl Scale {
    fn new(axis: &Axis, a: f64, b: f64) -> Scale {
        Scale { log: axis.log, from: axis.from, to: axis.to, a, b, flat: false }
    }
    pub fn at(&self, v: f64) -> f64 {
        if self.flat {
            return self.a;
        }
        let t = |v: f64| if self.log { if v > 0.0 { v.log10() } else { f64::NAN } } else { v };
        let (lo, hi) = (t(self.from), t(self.to));
        self.a + ((t(v) - lo) / (hi - lo)) * (self.b - self.a)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn overlaps(a: &Rect, b: &Rect) -> bool {
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

fn inside(inner: &Rect, outer: &Rect) -> bool {
    inner.x >= outer.x - 0.5
        && inner.y >= outer.y - 0.5
        && inner.x + inner.width <= outer.x + outer.width + 0.5
        && inner.y + inner.height <= outer.y + outer.height + 0.5
}

pub struct Tick {
    pub value: f64,
    pub text: String,
    pub at: f64,
    pub box_: Rect,
}

pub struct AxisLabel {
    pub text: String,
    pub box_: Rect,
}

pub struct Axes {
    pub width: f64,
    pub height: f64,
    pub plot: Rect,
    pub sx: Scale,
    pub sy: Scale,
    pub x_axis_y: f64,
    pub y_axis_x: Option<f64>,
    pub ticks_x: Vec<Tick>,
    pub ticks_y: Vec<Tick>,
    pub label_x: Option<AxisLabel>,
    pub label_y: Option<AxisLabel>,
    pub number_line: bool,
}

fn nice_step(span: f64) -> f64 {
    let raw = span / 6.0;
    let p = 10f64.powf(raw.log10().floor());
    [1.0, 2.0, 5.0, 10.0].iter().map(|m| m * p).find(|s| *s >= raw * 0.75).unwrap_or(10.0 * p)
}

fn pi_label(halves: i64) -> String {
    if halves == 0 {
        return "0".into();
    }
    let sign = if halves < 0 { "−" } else { "" };
    let h = halves.abs();
    if h % 2 == 0 {
        return format!("{sign}{}π", if h == 2 { String::new() } else { (h / 2).to_string() });
    }
    format!("{sign}{}π/2", if h == 1 { String::new() } else { h.to_string() })
}

fn tick_text(v: f64, step: f64, axis: &Axis) -> String {
    let abs = v.abs();
    let digits = |s: f64| (-(s.log10() + 1e-9).floor()).clamp(0.0, 6.0) as usize;
    let text = if abs >= 1e6 && step >= 1e5 {
        format!("{}M", format_number(v / 1e6, Some(digits(step / 1e6))))
    } else if abs >= 1e4 && step >= 1e3 {
        format!("{}k", format_number(v / 1e3, Some(digits(step / 1e3))))
    } else {
        format_number(v, Some(digits(step)))
    };
    format!("{}{}{}", axis.prefix, text, axis.suffix)
}

fn axis_ticks(axis: &Axis) -> Vec<(f64, String)> {
    let (from, to) = (axis.from, axis.to);
    let in_range = |v: f64| v >= from.min(to) - 1e-9 && v <= from.max(to) + 1e-9;
    if let Ticks::List(list) = &axis.ticks {
        let vals: Vec<f64> = list.iter().copied().filter(|v| in_range(*v)).collect();
        let step = if vals.len() > 1 {
            vals.windows(2).map(|w| (w[1] - w[0]).abs()).filter(|d| *d > 0.0).fold(f64::INFINITY, f64::min)
        } else {
            1.0
        };
        let step = if step == 0.0 || step.is_nan() { 1.0 } else { step };
        // Math.min of nothing is Infinity, which is truthy: kept.
        return vals.into_iter().map(|v| (v, tick_text(v, step, axis))).collect();
    }
    let mut out = Vec::new();
    if axis.log {
        let a = (from.log10() + 1e-9).floor() as i64;
        let b = (to.log10() - 1e-9).ceil() as i64;
        let few = b - a < 3;
        let mut k = a;
        while k <= b && out.len() < 200 {
            for m in if few { &[1.0, 2.0, 5.0][..] } else { &[1.0][..] } {
                let v = m * 10f64.powf(k as f64);
                if in_range(v) {
                    out.push((v, tick_text(v, 10f64.powf(k as f64), axis)));
                }
            }
            k += 1;
        }
        return out;
    }
    if matches!(axis.ticks, Ticks::Pi) {
        let halves = if (to - from).abs() / (std::f64::consts::PI / 2.0) > 12.0 { 2 } else { 1 };
        let step = halves as f64 * std::f64::consts::PI / 2.0;
        let mut m = (from / step - 1e-9).ceil() as i64;
        while m as f64 * step <= to + 1e-9 && out.len() < 200 {
            out.push((m as f64 * step, format!("{}{}{}", axis.prefix, pi_label(m * halves), axis.suffix)));
            m += 1;
        }
        return out;
    }
    let step = if let Ticks::Step(s) = axis.ticks { s } else { nice_step((to - from).abs()) };
    let mut m = (from / step - 1e-9).ceil() as i64;
    while m as f64 * step <= to + 1e-9 && out.len() < 200 {
        let raw = m as f64 * step;
        let v = if raw.abs() < step * 1e-9 { 0.0 } else { raw };
        out.push((v, tick_text(v, step, axis)));
        m += 1;
    }
    out
}

fn text_box(text: &str, font: &Font, x: f64, y: f64, anchor: char) -> Rect {
    let width = measure(text, font);
    let left = match anchor {
        'm' => x - width / 2.0,
        'e' => x - width,
        _ => x,
    };
    Rect { x: left, y, width, height: line_height(font) }
}

impl Axes {
    pub fn new(m: &Model, box_w: f64, box_h: f64) -> Axes {
        let x = &m.x;
        let y = m.y.as_ref();
        let x_ticks = axis_ticks(x);
        let y_ticks = y.map(axis_ticks).unwrap_or_default();
        let y_tick_w = y_ticks.iter().map(|(_, t)| measure(t, &TICK_FONT)).fold(0.0, f64::max);
        let zero_inside = |a: &Axis| !a.log && a.from.min(a.to) < 0.0 && a.from.max(a.to) > 0.0;
        let y_axis_inside = y.is_some() && zero_inside(x);
        let x_axis_inside = y.is_some_and(zero_inside);
        let left = if y.is_some() && !y_axis_inside { (y_tick_w + TICK_GAP + 8.0).ceil() } else { 16.0 };
        let right = x_ticks.last().map_or(24.0, |(_, t)| (measure(t, &TICK_FONT) / 2.0).ceil() + 8.0).max(24.0);
        let top = if y.is_some() { 20.0 } else { 0.0 };
        let bottom = if y.is_some() && !x_axis_inside { TICK_GAP + line_height(&TICK_FONT) + 8.0 } else { 20.0 };
        let mut plot =
            Rect { x: left, y: top, width: (box_w - left - right).max(1.0), height: (box_h - top - bottom).max(1.0) };
        if m.equal
            && let Some(ya) = y
            && !x.log
            && !ya.log
        {
            let unit = (plot.width / (x.to - x.from)).min(plot.height / (ya.to - ya.from));
            let (w, h) = (unit * (x.to - x.from), unit * (ya.to - ya.from));
            plot =
                Rect { x: plot.x + (plot.width - w) / 2.0, y: plot.y + (plot.height - h) / 2.0, width: w, height: h };
        }
        let sx = Scale::new(x, plot.x, plot.x + plot.width);
        let sy = match y {
            Some(ya) => Scale::new(ya, plot.y + plot.height, plot.y),
            None => Scale { flat: true, a: plot.y + plot.height / 2.0, ..Scale::new(x, 0.0, 0.0) },
        };
        let x_axis_y = if y.is_some() {
            if x_axis_inside { sy.at(0.0) } else { plot.y + plot.height }
        } else {
            plot.y + plot.height / 2.0
        };
        let y_axis_x = y.map(|_| if y_axis_inside { sx.at(0.0) } else { plot.x });
        let ticks_x: Vec<Tick> = x_ticks
            .into_iter()
            .map(|(v, t)| Tick {
                value: v,
                at: sx.at(v),
                box_: text_box(&t, &TICK_FONT, sx.at(v), x_axis_y + TICK_GAP, 'm'),
                text: t,
            })
            .collect();
        let mut ticks_y: Vec<Tick> = match y_axis_x {
            Some(yx) => y_ticks
                .into_iter()
                .map(|(v, t)| Tick {
                    value: v,
                    at: sy.at(v),
                    box_: text_box(&t, &TICK_FONT, yx - TICK_GAP, sy.at(v) - line_height(&TICK_FONT) / 2.0, 'e'),
                    text: t,
                })
                .collect(),
            None => Vec::new(),
        };
        ticks_y.retain(|t| {
            !ticks_x.iter().any(|u| overlaps(&t.box_, &u.box_)) && !(x_axis_inside && y_axis_inside && t.value == 0.0)
        });
        let label_x = x.label.as_ref().map(|l| AxisLabel {
            text: l.clone(),
            box_: text_box(l, &AXIS_FONT, plot.x + plot.width, x_axis_y - 10.0 - line_height(&AXIS_FONT), 'e'),
        });
        let label_y = match (y, y_axis_x) {
            (Some(ya), Some(yx)) => ya
                .label
                .as_ref()
                .map(|l| AxisLabel { text: l.clone(), box_: text_box(l, &AXIS_FONT, yx + 14.0, plot.y - 4.0, 's') }),
            _ => None,
        };
        Axes {
            width: box_w,
            height: box_h,
            plot,
            sx,
            sy,
            x_axis_y,
            y_axis_x,
            ticks_x,
            ticks_y,
            label_x,
            label_y,
            number_line: y.is_none(),
        }
    }
}

// ─── Parts in a frame ───

type Sample = [f64; 3];
type Pieces<'a> = dyn Fn(&Sample, &Sample) -> usize + 'a;
type Run = Vec<Px>;

/// A function's or curve's samples in data space, as runs between the places it has no value (`sampleFunction`).
fn sample_function(part: &Part, m: &Model, scope: &Scope, progress: f64, pieces: Option<&Pieces<'_>>) -> Vec<Run> {
    let Item::Function { x: fx, y: fy, t, from, to, .. } = &part.item else { return Vec::new() };
    let mut runs: Vec<Run> = Vec::new();
    let mut run: Run = Vec::new();
    let push = |s: &Sample, runs: &mut Vec<Run>, run: &mut Run| {
        if s[0].is_finite() && s[1].is_finite() {
            run.push([s[0], s[1]]);
        } else {
            if !run.is_empty() {
                runs.push(std::mem::take(run));
            }
            *run = Vec::new();
        }
    };
    let sweep = |point_at: &mut dyn FnMut(f64) -> Sample, runs: &mut Vec<Run>, run: &mut Run| {
        let mut prev = point_at(0.0);
        push(&prev, runs, run);
        for i in 1..=SAMPLES {
            let next = point_at(i as f64 / SAMPLES as f64);
            let n = pieces.map_or(1, |p| p(&prev, &next));
            for j in 1..n {
                let s = point_at((i as f64 - 1.0 + j as f64 / n as f64) / SAMPLES as f64);
                push(&s, runs, run);
            }
            push(&next, runs, run);
            prev = next;
        }
    };
    if let Some(fx) = fx {
        let mut sc = scope.clone();
        let t0 = t.first().map_or(f64::NAN, |n| n.at(&mut sc));
        let t1 = t.get(1).map_or(f64::NAN, |n| n.at(&mut sc));
        let end = t0 + (t1 - t0) * progress;
        let mut s = scope.with("t", 0.0);
        sweep(
            &mut |u| {
                let tv = t0 + (end - t0) * u;
                s.set_last(tv);
                [fx.at(&mut s), fy.at(&mut s), tv]
            },
            &mut runs,
            &mut run,
        );
    } else {
        let ax = &m.x;
        let mut sc = scope.clone();
        let lo = ax.from.min(ax.to).max(from.as_ref().map_or(f64::NEG_INFINITY, |n| n.at(&mut sc)));
        let hi = ax.from.max(ax.to).min(to.as_ref().map_or(f64::INFINITY, |n| n.at(&mut sc)));
        let end = lo + (hi - lo) * progress;
        if lo.is_finite() && hi.is_finite() && hi > lo {
            let log = ax.log;
            let mut s = scope.with("x", 0.0);
            sweep(
                &mut |u| {
                    let xv =
                        if log { 10f64.powf(lo.log10() + (end.log10() - lo.log10()) * u) } else { lo + (end - lo) * u };
                    s.set_last(xv);
                    [xv, fy.at(&mut s), xv]
                },
                &mut runs,
                &mut run,
            );
        }
    }
    if !run.is_empty() {
        runs.push(run);
    }
    runs
}

/// Data-space runs as pixel runs, broken where a jump leaves the plot (`toPixels`).
fn to_pixels(runs: &[Run], axes: &Axes) -> Vec<Run> {
    let plot = &axes.plot;
    let (lo, hi) = (plot.y - plot.height, plot.y + 2.0 * plot.height);
    let mut out = Vec::new();
    for r in runs {
        let mut cur: Run = Vec::new();
        for [x, y] in r {
            let p = [axes.sx.at(*x), axes.sy.at(*y).max(lo).min(hi)];
            // `Math.min(hi, Math.max(lo, v))` keeps NaN.
            let p = if axes.sy.at(*y).is_nan() { [p[0], f64::NAN] } else { p };
            if !p[0].is_finite() || !p[1].is_finite() {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                continue;
            }
            if let Some(prev) = cur.last()
                && (p[1] - prev[1]).abs() > plot.height
                && (prev[1] <= plot.y
                    || prev[1] >= plot.y + plot.height
                    || p[1] <= plot.y
                    || p[1] >= plot.y + plot.height)
            {
                out.push(std::mem::take(&mut cur));
            }
            cur.push(p);
        }
        if !cur.is_empty() {
            out.push(cur);
        }
    }
    out
}

fn inside_plot(p: &Px, plot: &Rect) -> bool {
    p[0] >= plot.x - 0.5
        && p[0] <= plot.x + plot.width + 0.5
        && p[1] >= plot.y - 0.5
        && p[1] <= plot.y + plot.height + 0.5
}

fn bounds_of(pts: &[Px]) -> Option<Rect> {
    if pts.is_empty() {
        return None;
    }
    let min = |i: usize| pts.iter().map(|p| p[i]).fold(f64::INFINITY, f64::min);
    let max = |i: usize| pts.iter().map(|p| p[i]).fold(f64::NEG_INFINITY, f64::max);
    Some(Rect { x: min(0), y: min(1), width: max(0) - min(0), height: max(1) - min(1) })
}

/// Where a part draws at a set of parameter values.
#[derive(Default)]
pub struct Geo {
    pub part: usize,
    pub runs: Vec<Run>,
    pub dots: Vec<Px>,
    pub polygon: Option<Vec<Px>>,
    pub dot: Option<Px>,
    pub arrow: Option<[Px; 2]>,
    pub visible: bool,
    pub box_: Option<Rect>,
    pub end: Option<Px>,
    pub along: Vec<Px>,
    pub centre: Option<Px>,
}

fn point_of(pt: &Pt, scope: &mut Scope, axes: &Axes) -> (Px, Px) {
    let (vx, vy) = match pt {
        Pt::Pair(a, b) => (a.at(scope), if axes.number_line { 0.0 } else { b.at(scope) }),
        Pt::One(a) => (a.at(scope), 0.0),
    };
    ([vx, vy], [axes.sx.at(vx), if axes.number_line { axes.x_axis_y } else { axes.sy.at(vy) }])
}

fn clamp_y(y: f64, plot: &Rect) -> f64 {
    (plot.y + plot.height).min(plot.y.max(y))
}

/// Where each part draws (`plotGeometry`), with the whole view under the camera.
pub fn geometry(m: &Model, axes: &Axes, scope: &Scope, progress: &dyn Fn(&str) -> f64) -> Vec<Geo> {
    let plot = &axes.plot;
    let mut out: Vec<Geo> = Vec::new();
    let (rect, zoom) = (Rect { x: 0.0, y: 0.0, width: axes.width, height: axes.height }, 1.0);
    for (index, part) in m.parts.iter().enumerate() {
        if part.kind == Kind::Areas {
            continue;
        }
        let p = progress(&part.id);
        let mut geo = Geo { part: index, ..Default::default() };
        match &part.item {
            Item::Function { x: curve, .. } => {
                let runs = sample_function(part, m, scope, p, None);
                let px = to_pixels(&runs, axes);
                let visible: Vec<Px> = px.iter().flatten().filter(|q| inside_plot(q, plot)).copied().collect();
                let is_curve = curve.is_some();
                let pieces = |a: &Sample, b: &Sample| -> usize {
                    let (ax, bx, ay, by) = (axes.sx.at(a[0]), axes.sx.at(b[0]), axes.sy.at(a[1]), axes.sy.at(b[1]));
                    if !ax.is_finite() || !bx.is_finite() || (is_curve && !(ay.is_finite() && by.is_finite())) {
                        return 1;
                    }
                    let span = if is_curve { (bx - ax).abs().max((by - ay).abs()) } else { (bx - ax).abs() };
                    if ax.max(bx) + span < rect.x || ax.min(bx) - span > rect.x + rect.width {
                        return 1;
                    }
                    if is_curve && (ay.max(by) + span < rect.y || ay.min(by) - span > rect.y + rect.height) {
                        return 1;
                    }
                    ((span * zoom / DRAW_PX).ceil()).clamp(1.0, 64.0) as usize
                };
                geo.runs = to_pixels(&sample_function(part, m, scope, p, Some(&pieces)), axes);
                geo.visible = !visible.is_empty();
                geo.box_ = bounds_of(&visible);
                geo.end = visible.last().copied();
                geo.along = visible;
            }
            Item::Series { points, line, .. } => {
                let pts: Vec<Px> = points
                    .iter()
                    .map(|q| [axes.sx.at(q.0), if axes.number_line { axes.x_axis_y } else { axes.sy.at(q.1) }])
                    .collect();
                let take = ((pts.len() as f64 * p - 1e-9).ceil()).max(1.0) as usize;
                let mut shown: Vec<Px> = pts.iter().take(take).copied().collect();
                if p < 1.0 && shown.len() > 1 {
                    let exact = (pts.len() as f64 - 1.0) * p;
                    let (i, f) = (exact.floor() as usize, exact - exact.floor());
                    let (a, b) = (pts[i], pts[(i + 1).min(pts.len() - 1)]);
                    shown.truncate(i + 1);
                    shown.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
                }
                let visible: Vec<Px> = shown.iter().filter(|q| inside_plot(q, plot)).copied().collect();
                geo.dots = if *line {
                    Vec::new()
                } else {
                    let n = if p < 1.0 { ((pts.len() as f64 - 1.0) * p).floor() as usize + 1 } else { pts.len() };
                    shown.iter().take(n).copied().collect()
                };
                geo.runs = vec![shown];
                geo.visible = !visible.is_empty();
                geo.box_ = bounds_of(&visible);
                geo.end = visible.last().copied();
                geo.along = visible;
            }
            Item::Point { at, .. } => {
                let mut sc = scope.clone();
                let (_, px) = point_of(at, &mut sc, axes);
                let ok = px.iter().all(|v| v.is_finite()) && inside_plot(&px, plot);
                geo.dot = Some(px);
                geo.visible = ok;
                geo.box_ = ok.then_some(Rect {
                    x: px[0] - POINT_R,
                    y: px[1] - POINT_R,
                    width: 2.0 * POINT_R,
                    height: 2.0 * POINT_R,
                });
            }
            Item::Vector { from, to } => {
                let mut sc = scope.clone();
                let from = match from {
                    Some(f) => point_of(f, &mut sc, axes).1,
                    None => point_of(&Pt::One(Num::Const(0.0)), &mut sc, axes).1,
                };
                let to = point_of(to, &mut sc, axes).1;
                let tip = [from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p];
                let ok = from.iter().chain(tip.iter()).all(|v| v.is_finite());
                if ok {
                    geo.arrow = Some([from, tip]);
                    geo.box_ = bounds_of(&[from, tip]);
                }
                geo.visible = ok && (inside_plot(&from, plot) || inside_plot(&tip, plot));
            }
            Item::Area { .. } => {}
        }
        out.push(geo);
    }
    for (index, part) in m.parts.iter().enumerate().filter(|(_, p)| p.kind == Kind::Areas) {
        let Item::Area { from: afrom, to: ato, .. } = &part.item else { continue };
        let mut geo = Geo { part: index, ..Default::default() };
        let line_of = |fid: &str| {
            m.part(fid).filter(|f| f.kind == Kind::Functions && matches!(&f.item, Item::Function { x: None, .. }))
        };
        let fns: Vec<Option<&Part>> = part.area_functions().into_iter().map(line_of).collect();
        let Some(Some(f)) = fns.first() else {
            out.push(geo);
            continue;
        };
        let g = fns.get(1).copied().flatten();
        let Item::Function { y: fy, from: ffrom, to: fto, .. } = &f.item else { continue };
        let mut sc = scope.clone();
        let ninf = f64::NEG_INFINITY;
        let lo =
            m.x.from
                .min(m.x.to)
                .max(afrom.as_ref().map_or(ninf, |n| n.at(&mut sc)))
                .max(ffrom.as_ref().map_or(ninf, |n| n.at(&mut sc)));
        let hi =
            m.x.from
                .max(m.x.to)
                .min(ato.as_ref().map_or(f64::INFINITY, |n| n.at(&mut sc)))
                .min(fto.as_ref().map_or(f64::INFINITY, |n| n.at(&mut sc)));
        let end = lo + (hi - lo) * progress(&part.id);
        let (mut top, mut bottom): (Vec<Px>, Vec<Px>) = (Vec::new(), Vec::new());
        if lo.is_finite() && end.is_finite() && end > lo {
            let n = 240;
            let mut s = scope.with("x", 0.0);
            for i in 0..=n {
                let x = lo + ((end - lo) * i as f64) / n as f64;
                s.set_last(x);
                let a = fy.at(&mut s);
                let b = match g {
                    Some(Part { item: Item::Function { y, .. }, .. }) => y.at(&mut s),
                    _ => 0.0,
                };
                if !a.is_finite() || !b.is_finite() {
                    continue;
                }
                top.push([axes.sx.at(x), clamp_y(axes.sy.at(a), plot)]);
                bottom.push([axes.sx.at(x), clamp_y(axes.sy.at(b), plot)]);
            }
        }
        if top.len() > 1 {
            let mid = top.len() / 2;
            geo.centre = Some([top[mid][0], (top[mid][1] + bottom[bottom.len() - 1 - mid][1]) / 2.0]);
            let mut poly = top;
            poly.extend(bottom.into_iter().rev());
            geo.box_ = bounds_of(&poly);
            geo.polygon = Some(poly);
            geo.visible = true;
        }
        out.push(geo);
    }
    out
}

// ─── Labels ───

pub struct Placed {
    pub id: String,
    pub text: String,
    pub box_: Rect,
    pub tone: String,
}

fn label_spots(geo: &Geo, w: f64, h: f64, side: Option<&str>) -> Vec<Px> {
    let gap = 12.0;
    if let Some([x, y]) = geo.dot {
        let spot = |s: &str| match s {
            "above" => Some([x - w / 2.0, y - POINT_R - gap - h]),
            "right" => Some([x + POINT_R + gap, y - h / 2.0]),
            "left" => Some([x - POINT_R - gap - w, y - h / 2.0]),
            "below" => Some([x - w / 2.0, y + POINT_R + gap]),
            _ => None,
        };
        return match side {
            Some(s) => vec![spot(s).unwrap_or([f64::NAN, f64::NAN])],
            None => ["above", "right", "left", "below"].iter().filter_map(|s| spot(s)).collect(),
        };
    }
    if let Some([[x0, y0], [x1, y1]]) = geo.arrow {
        let len = (x1 - x0).hypot(y1 - y0);
        let len = if len == 0.0 { 1.0 } else { len };
        let (ux, uy) = ((x1 - x0) / len, (y1 - y0) / len);
        let c = [x1 + ux * (gap + w / 2.0), y1 + uy * (gap + h / 2.0)];
        return vec![[c[0] - w / 2.0, c[1] - h / 2.0], [x1 + gap, y1 - h - gap], [x1 - w - gap, y1 - h - gap]];
    }
    if let Some(c) = geo.centre {
        return vec![[c[0] - w / 2.0, c[1] - h / 2.0]];
    }
    if let Some([x, y]) = geo.end {
        let mut out = vec![[x - w, y - h - gap], [x - w, y + gap], [x + gap, y - h / 2.0]];
        for f in [0.8, 0.6, 0.4, 0.2] {
            let [ax, ay] = geo.along[((geo.along.len() as f64 - 1.0) * f).floor() as usize];
            out.push([ax - w / 2.0, ay - h - gap]);
            out.push([ax - w / 2.0, ay + gap]);
        }
        return out;
    }
    Vec::new()
}

/// Each shown part's label, placed on the first spot that stays on the stage and clear of the rest (`plotLabels`).
pub fn labels(m: &Model, axes: &Axes, geos: &[Geo], scope: &Scope, shown: &dyn Fn(&str) -> bool) -> Vec<Placed> {
    let mut placed: Vec<Placed> = Vec::new();
    let fixed: Vec<Rect> = axes
        .ticks_x
        .iter()
        .map(|t| t.box_)
        .chain(axes.ticks_y.iter().map(|t| t.box_))
        .chain([&axes.label_x, &axes.label_y].into_iter().flatten().map(|l| l.box_))
        .collect();
    let stage = Rect { x: 0.0, y: 0.0, width: axes.width, height: axes.height };
    let order = |k: Kind| match k {
        Kind::Points => 0,
        Kind::Vectors => 1,
        Kind::Functions => 2,
        Kind::Series => 3,
        Kind::Areas => 4,
    };
    let mut parts: Vec<&Geo> = geos
        .iter()
        .filter(|g| {
            let p = &m.parts[g.part];
            g.visible && p.label.as_ref().is_some_and(|l| !l.pieces.is_empty()) && shown(&p.id)
        })
        .collect();
    parts.sort_by_key(|g| order(m.parts[g.part].kind));
    for geo in parts {
        let part = &m.parts[geo.part];
        let mut sc = scope.clone();
        let text = label_text(part.label.as_ref().unwrap(), &mut sc);
        let (w, h) = (measure(&text, &LABEL_FONT), line_height(&LABEL_FONT));
        let spots: Vec<Rect> = label_spots(geo, w, h, part.side.as_deref())
            .into_iter()
            .map(|s| Rect { x: s[0], y: s[1], width: w, height: h })
            .collect();
        let clear = |b: &Rect| {
            inside(b, &stage)
                && !placed.iter().any(|l| overlaps(&l.box_, b))
                && !fixed.iter().any(|f| overlaps(f, b))
                && !(part.kind != Kind::Points
                    && geos.iter().any(|g| {
                        !std::ptr::eq(g, geo)
                            && g.dot.is_some()
                            && g.visible
                            && g.box_.as_ref().is_some_and(|gb| overlaps(gb, b))
                    }))
        };
        let box_ = spots
            .iter()
            .find(|b| clear(b))
            .or_else(|| spots.iter().find(|b| inside(b, &stage)))
            .or(spots.first())
            .copied();
        let Some(box_) = box_ else { continue };
        placed.push(Placed { id: part.id.clone(), text, box_, tone: m.part_tone(part) });
    }
    placed
}
