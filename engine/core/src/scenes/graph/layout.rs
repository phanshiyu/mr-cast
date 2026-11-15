//! The graph's layout: layers, groups, routed edges and their labels (src/utils/graphLayout.ts).

use super::text::{CardIn, CardText, card_texts, shared_title_size};
use crate::item_marks::{Marks, js_len};
use crate::textfit::{Fit, Slot, fit_text, fit_text_fn};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

const NODE_W: f64 = 320.0;
const NODE_W_MAX: f64 = 440.0;
pub const NODE_H: f64 = 104.0;
const TERMINAL_H: f64 = 80.0;
const DECISION_HEIGHTS: [f64; 5] = [120.0, 140.0, 160.0, 180.0, 200.0];
const DECISION_COMFORT: f64 = 20.0;
const DECISION_PAD: f64 = 10.0;
const TERMINAL_PAD_X: f64 = 40.0;
const MAX_SCALE: f64 = 1.3;
const PAD: f64 = 40.0;
const LOOP_LIFT: f64 = 90.0;
const LANE_MARGIN: f64 = 14.0;
const LANE_EDGE: f64 = 8.0;
const GROUP_PAD: f64 = 26.0;
const GROUP_HEAD: f64 = 44.0;
const BORDERED_GAP: f64 = 64.0;
const BAND_GAP: f64 = 40.0;
const LABEL_FONT: f64 = 19.0;
const LABEL_LINE_HEIGHT: f64 = 1.3;
pub const LABEL_PAD: (f64, f64) = (12.0, 5.0);
const GROUP_FONT: f64 = 18.0;
const MONO_ADVANCE: f64 = 0.61;
const LABEL_CLEAR: f64 = 10.0;
const ARROW_CLEAR: f64 = 24.0;
const BORDER_CLEAR: f64 = 6.0;
const LANE_RANKS: usize = 5;
/// Where a group's name sits inside its box.
pub const GROUP_NAME: (f64, f64) = (22.0, 12.0);

#[derive(Clone, Debug, Deserialize)]
pub struct GraphNode {
    pub id: String,
    #[serde(default, deserialize_with = "crate::item_marks::text_or_number")]
    pub label: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub caption: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub shape: Option<String>,
    #[serde(flatten)]
    pub marks: Marks,
}

impl GraphNode {
    pub fn label(&self) -> &str {
        self.label.as_deref().unwrap_or("")
    }
    pub fn shape(&self) -> Shape {
        match self.shape.as_deref() {
            Some("decision") => Shape::Decision,
            Some("terminal") => Shape::Terminal,
            Some("step") => Shape::Step,
            _ => Shape::Card,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Card,
    Decision,
    Terminal,
    Step,
}

#[derive(Clone, Debug, Deserialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    #[serde(default, deserialize_with = "crate::item_marks::text_or_number")]
    pub label: Option<String>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub change: Option<String>,
    #[serde(default)]
    pub highlight: Option<bool>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dir {
    LR,
    TB,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

fn pt(x: f64, y: f64) -> Pt {
    Pt { x, y }
}

#[derive(Clone, Copy, Debug)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// A node's shape as drawn: its box in layout units.
pub struct PositionedNode {
    pub node: usize,
    pub layer: usize,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub struct EdgeLabelBox {
    pub text: Fit,
    pub x: f64,
    pub y: f64,
}

pub struct RoutedEdge {
    pub edge: usize,
    pub d: String,
    pub label: Option<EdgeLabelBox>,
}

pub struct PlacedGroup {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub layer: usize,
    pub name_left: bool,
    pub label: Fit,
}

pub struct GraphLayout {
    pub nodes: Vec<PositionedNode>,
    pub edges: Vec<RoutedEdge>,
    pub groups: Vec<PlacedGroup>,
    pub layer_count: usize,
    pub texts: HashMap<String, CardText>,
    pub width: f64,
    pub height: f64,
}

/// A graph's direction: its own, or top to bottom when it branches at a decision, as a flowchart reads.
pub fn graph_direction(layout: Option<&str>, nodes: &[GraphNode]) -> Dir {
    match layout {
        Some("LR") => Dir::LR,
        Some("TB") => Dir::TB,
        _ => {
            if nodes.iter().any(|n| n.shape() == Shape::Decision) {
                Dir::TB
            } else {
                Dir::LR
            }
        }
    }
}

fn diamond_width(w: f64, h: f64, line_height: f64) -> impl Fn(usize, f64) -> f64 {
    move |lines, size| w * (1.0 - (lines as f64 * size * line_height + 2.0 * DECISION_PAD) / h) - 2.0 * DECISION_PAD
}

fn decision_fit(node: &GraphNode, w: f64, h: f64, min: Option<f64>) -> Fit {
    let mut slot = Slot::named("decision", 0.0);
    if let Some(m) = min {
        slot.min = m;
    }
    let lh = slot.line_height;
    fit_text_fn(node.label(), &slot, &diamond_width(w, h, lh))
}

/// The height of a graph's diamonds: the least at which every question keeps a comfortable size.
fn decision_height(nodes: &[GraphNode], w: f64) -> f64 {
    DECISION_HEIGHTS
        .iter()
        .copied()
        .find(|&h| {
            nodes
                .iter()
                .filter(|n| n.shape() == Shape::Decision)
                .all(|n| decision_fit(n, w, h, Some(DECISION_COMFORT)).fits)
        })
        .unwrap_or(DECISION_HEIGHTS[4])
}

fn shape_height(shape: Shape, diamond: f64) -> f64 {
    match shape {
        Shape::Decision => diamond,
        Shape::Terminal => TERMINAL_H,
        _ => NODE_H,
    }
}

/// Each node's text, by id.
fn node_texts(nodes: &[GraphNode], w: f64, diamond: f64) -> HashMap<String, CardText> {
    let boxed = boxed_cards(nodes);
    let mut texts = card_texts(&boxed, w, NODE_H);
    for n in nodes {
        match n.shape() {
            Shape::Terminal => {
                texts.insert(
                    n.id.clone(),
                    CardText {
                        title: fit_text(n.label(), &Slot::named("terminal", w - 2.0 * TERMINAL_PAD_X)),
                        caption: None,
                    },
                );
            }
            Shape::Decision => {
                texts.insert(n.id.clone(), CardText { title: decision_fit(n, w, diamond, None), caption: None });
            }
            _ => {}
        }
    }
    texts
}

/// The cards and steps, a step with no icon.
pub fn boxed_cards(nodes: &[GraphNode]) -> Vec<CardIn<'_>> {
    nodes
        .iter()
        .filter(|n| matches!(n.shape(), Shape::Card | Shape::Step))
        .map(|n| CardIn {
            id: &n.id,
            label: n.label(),
            caption: n.caption.as_deref(),
            icon: n.shape() == Shape::Card && n.icon.is_some(),
        })
        .collect()
}

#[derive(Clone, Copy)]
struct Axes {
    dir: Dir,
    v: f64,
    u_gap: f64,
    v_gap: f64,
    u_pad: f64,
    label_chars: f64,
}

impl Axes {
    fn new(dir: Dir, node_w: f64, cell_h: f64) -> Axes {
        match dir {
            Dir::LR => Axes { dir, v: cell_h, u_gap: 280.0, v_gap: 64.0, u_pad: PAD, label_chars: 22.0 },
            Dir::TB => Axes { dir, v: node_w, u_gap: 48.0, v_gap: 56.0, u_pad: 20.0, label_chars: 32.0 },
        }
    }
    fn label_u(&self, w: f64, h: f64) -> f64 {
        if self.dir == Dir::LR { w } else { h }
    }
    fn label_v(&self, w: f64, h: f64) -> f64 {
        if self.dir == Dir::LR { h } else { w }
    }
    fn xy(&self, u: f64, v: f64) -> Pt {
        if self.dir == Dir::LR { pt(u, v) } else { pt(v, u) }
    }
}

#[derive(Clone, Copy)]
struct Placed {
    layer: usize,
    u: f64,
    v: f64,
    u_size: f64,
    iu: f64,
    iv: f64,
}

fn back_edges(nodes: &[GraphNode], edges: &[&GraphEdge]) -> HashSet<usize> {
    let mut out: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, e) in edges.iter().enumerate() {
        out.entry(e.from.as_str()).or_default().push(i);
    }
    // 1 = active, 2 = done
    let mut state: HashMap<&str, u8> = HashMap::new();
    let mut back = HashSet::new();
    fn visit<'a>(
        id: &'a str,
        edges: &[&'a GraphEdge],
        out: &HashMap<&'a str, Vec<usize>>,
        state: &mut HashMap<&'a str, u8>,
        back: &mut HashSet<usize>,
    ) {
        state.insert(id, 1);
        for &i in out.get(id).map_or(&[][..], |v| v.as_slice()) {
            match state.get(edges[i].to.as_str()) {
                Some(1) => {
                    back.insert(i);
                }
                None => visit(edges[i].to.as_str(), edges, out, state, back),
                _ => {}
            }
        }
        state.insert(id, 2);
    }
    for n in nodes {
        if !state.contains_key(n.id.as_str()) {
            visit(n.id.as_str(), edges, &out, &mut state, &mut back);
        }
    }
    back
}

fn assign_layers(nodes: &[GraphNode], dag: &[&GraphEdge]) -> HashMap<String, usize> {
    let mut preds: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in dag {
        preds.entry(e.to.as_str()).or_default().push(e.from.as_str());
    }
    let mut layer: HashMap<String, usize> = HashMap::new();
    fn resolve(id: &str, preds: &HashMap<&str, Vec<&str>>, layer: &mut HashMap<String, usize>) -> usize {
        if let Some(&l) = layer.get(id) {
            return l;
        }
        let mut best: i64 = -1;
        for p in preds.get(id).map_or(&[][..], |v| v.as_slice()) {
            best = best.max(resolve(p, preds, layer) as i64);
        }
        let v = (best + 1) as usize;
        layer.insert(id.to_string(), v);
        v
    }
    for n in nodes {
        resolve(&n.id, &preds, &mut layer);
    }
    layer
}

/// One down and one up barycenter sweep; ties keep input order because the sort is stable.
fn order_layers(nodes: &[GraphNode], columns: &mut [Vec<usize>], dag: &[&GraphEdge]) {
    let neighbours = |id: &str, inward: bool| -> Vec<String> {
        dag.iter()
            .filter(|e| if inward { e.to == id } else { e.from == id })
            .map(|e| if inward { e.from.clone() } else { e.to.clone() })
            .collect()
    };
    let sweep = |columns: &mut [Vec<usize>], l: usize, step: i64, inward: bool| {
        let r = (l as i64 - step) as usize;
        let index: HashMap<&str, usize> =
            columns[r].iter().enumerate().map(|(i, &n)| (nodes[n].id.as_str(), i)).collect();
        let col = columns[l].clone();
        let keys: HashMap<usize, f64> = col
            .iter()
            .enumerate()
            .map(|(i, &n)| {
                let ns: Vec<usize> =
                    neighbours(&nodes[n].id, inward).iter().filter_map(|id| index.get(id.as_str()).copied()).collect();
                (n, if ns.is_empty() { i as f64 } else { ns.iter().sum::<usize>() as f64 / ns.len() as f64 })
            })
            .collect();
        columns[l].sort_by(|a, b| keys[a].partial_cmp(&keys[b]).unwrap_or(std::cmp::Ordering::Equal));
    };
    for l in 1..columns.len() {
        sweep(columns, l, 1, true);
    }
    for l in (0..columns.len().saturating_sub(1)).rev() {
        sweep(columns, l, -1, false);
    }
}

struct Band {
    name: Option<String>,
    first: usize,
    last: usize,
    size: usize,
    track: usize,
    v0: f64,
}

fn bands_of(nodes: &[GraphNode], columns: &[Vec<usize>]) -> Vec<Band> {
    let mut bands: Vec<Band> = Vec::new();
    let mut names: Vec<Option<String>> = Vec::new();
    for n in nodes {
        if !names.contains(&n.group) {
            names.push(n.group.clone());
        }
    }
    for name in names {
        let counts: Vec<usize> =
            columns.iter().map(|col| col.iter().filter(|&&n| nodes[n].group == name).count()).collect();
        let layers: Vec<usize> = counts.iter().enumerate().filter(|(_, c)| **c > 0).map(|(l, _)| l).collect();
        let mut runs: Vec<(usize, usize)> = Vec::new();
        for l in layers {
            match runs.last_mut() {
                Some(run) if name.is_some() || run.1 + 1 == l => run.1 = l,
                _ => runs.push((l, l)),
            }
        }
        for (first, last) in runs {
            let size = counts[first..=last].iter().copied().max().unwrap_or(0);
            bands.push(Band { name: name.clone(), first, last, size, track: 0, v0: 0.0 });
        }
    }
    let mut tracks: Vec<Vec<usize>> = Vec::new();
    for b in 0..bands.len() {
        let (first, last) = (bands[b].first, bands[b].last);
        let t = tracks.iter().position(|track| track.iter().all(|&o| bands[o].last < first || bands[o].first > last));
        let t = t.unwrap_or_else(|| {
            tracks.push(Vec::new());
            tracks.len() - 1
        });
        tracks[t].push(b);
        bands[b].track = t;
    }
    bands
}

#[derive(Clone)]
enum At {
    Bez([Pt; 4]),
    Line(Pt, Pt),
}

impl At {
    fn at(&self, t: f64) -> Pt {
        match self {
            At::Bez([a, b, c, d]) => {
                let w = [(1.0 - t).powi(3), 3.0 * (1.0 - t).powi(2) * t, 3.0 * (1.0 - t) * t * t, t.powi(3)];
                pt(w[0] * a.x + w[1] * b.x + w[2] * c.x + w[3] * d.x, w[0] * a.y + w[1] * b.y + w[2] * c.y + w[3] * d.y)
            }
            At::Line(a, b) => pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
        }
    }
}

fn sample(f: &At, n: usize) -> Vec<Pt> {
    (0..=n).map(|i| f.at(i as f64 / n as f64)).collect()
}

struct Curve {
    d: String,
    points: Vec<Pt>,
    at: At,
    t0: f64,
}

fn cubic(axes: &Axes, p: [Pt; 4], t0: f64) -> Curve {
    let q: Vec<Pt> = p.iter().map(|p| axes.xy(p.x, p.y)).collect();
    let at = At::Bez([q[0], q[1], q[2], q[3]]);
    Curve {
        d: format!("M {} {} C {} {}, {} {}, {} {}", q[0].x, q[0].y, q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y),
        points: sample(&at, 32),
        at,
        t0,
    }
}

fn t_at_u(u0: f64, u3: f64, u: f64) -> f64 {
    let target = (u - u0) / (u3 - u0);
    let (mut lo, mut hi) = (0.0f64, 1.0f64);
    for _ in 0..40 {
        let t = (lo + hi) / 2.0;
        if 1.5 * t * (1.0 - t) + t.powi(3) < target {
            lo = t;
        } else {
            hi = t;
        }
    }
    (lo + hi) / 2.0
}

fn skip_lanes(axes: &Axes, pairs: &[(Placed, Placed)], all: &[Placed], step: f64) -> Vec<Option<f64>> {
    let (v_size, v_gap) = (axes.v, axes.v_gap);
    let mut taken: Vec<(f64, f64, f64)> = Vec::new();
    pairs
        .iter()
        .map(|(a, b)| {
            let between: Vec<&Placed> = all.iter().filter(|n| n.layer > a.layer && n.layer < b.layer).collect();
            if between.is_empty() {
                return None;
            }
            let (u0, u1) = (a.u + a.u_size, b.u);
            let v0 = a.v + v_size / 2.0;
            let v1 = b.v + v_size / 2.0;
            let blocked = between.iter().any(|n| {
                let t = (n.u + n.u_size / 2.0 - u0) / (u1 - u0);
                let v = v0 + (v1 - v0) * t;
                v > n.v - LANE_MARGIN && v < n.v + v_size + LANE_MARGIN
            });
            if !blocked {
                return None;
            }
            let before = between.iter().map(|n| n.v).fold(f64::INFINITY, f64::min) - v_gap / 2.0;
            let after = between.iter().map(|n| n.v + v_size).fold(f64::NEG_INFINITY, f64::max) + v_gap / 2.0;
            let mid = (v0 + v1) / 2.0;
            let sides: [(f64, f64); 2] = if (mid - before).abs() <= (mid - after).abs() {
                [(before, -1.0), (after, 1.0)]
            } else {
                [(after, 1.0), (before, -1.0)]
            };
            let crosses_node = |v: f64| {
                all.iter()
                    .any(|n| n.u < u1 && n.u + n.u_size > u0 && v > n.v - LANE_MARGIN && v < n.v + v_size + LANE_MARGIN)
            };
            let shares_lane =
                |v: f64, taken: &[(f64, f64, f64)]| taken.iter().any(|t| (t.0 - v).abs() < 1.0 && t.1 < u1 && u0 < t.2);
            let mut found = None;
            'outer: for k in 0..LANE_RANKS {
                for (v, out) in sides {
                    let c = v + out * k as f64 * step;
                    if !crosses_node(c) && !shares_lane(c, &taken) {
                        found = Some(c);
                        break 'outer;
                    }
                }
            }
            let v = found.unwrap_or(sides[0].0);
            taken.push((v, u0, u1));
            Some(v)
        })
        .collect()
}

fn route(
    axes: &Axes,
    gaps: &[f64],
    a: &Placed,
    b: &Placed,
    all: &[Placed],
    lane: Option<f64>,
    label_u: &dyn Fn() -> f64,
) -> Curve {
    let v_size = axes.v;
    if b.layer > a.layer {
        let p0 = pt(a.u + a.u_size - a.iu, a.v + v_size / 2.0);
        let p3 = pt(b.u + b.iu, b.v + v_size / 2.0);
        if let Some(lane) = lane {
            let g0 = gaps[a.layer] / 2.0;
            let g1 = gaps[b.layer - 1] / 2.0;
            let pts: Vec<Pt> = [
                p0,
                pt(p0.x + g0 / 2.0, p0.y),
                pt(p0.x + g0 / 2.0, lane),
                pt(p0.x + g0, lane),
                pt(p3.x - g1, lane),
                pt(p3.x - g1 / 2.0, lane),
                pt(p3.x - g1 / 2.0, p3.y),
                p3,
            ]
            .iter()
            .map(|p| axes.xy(p.x, p.y))
            .collect();
            let s = |p: Pt| format!("{} {}", p.x, p.y);
            let d = format!(
                "M {} C {}, {}, {} L {} C {}, {}, {}",
                s(pts[0]),
                s(pts[1]),
                s(pts[2]),
                s(pts[3]),
                s(pts[4]),
                s(pts[5]),
                s(pts[6]),
                s(pts[7])
            );
            let at = At::Line(pts[3], pts[4]);
            let mut points = sample(&At::Bez([pts[0], pts[1], pts[2], pts[3]]), 16);
            points.extend(sample(&at, 16));
            points.extend(sample(&At::Bez([pts[4], pts[5], pts[6], pts[7]]), 16));
            return Curve { d, points, at, t0: 0.5 };
        }
        let du = (p3.x - p0.x) / 2.0;
        let t0 = if b.layer == a.layer + 1 { t_at_u(p0.x, p3.x, label_u()) } else { 0.5 };
        return cubic(axes, [p0, pt(p0.x + du, p0.y), pt(p3.x - du, p3.y), p3], t0);
    }
    if b.layer == a.layer {
        let down = b.v > a.v;
        let p0 = pt(a.u + a.u_size / 2.0 + 40.0, if down { a.v + v_size - a.iv } else { a.v + a.iv });
        let p3 = pt(b.u + b.u_size / 2.0 + 40.0, if down { b.v + b.iv } else { b.v + v_size - b.iv });
        let bulge = a.u_size / 2.0 + 10.0;
        return cubic(axes, [p0, pt(p0.x + bulge, p0.y), pt(p3.x + bulge, p3.y), p3], 0.5);
    }
    let top =
        all.iter().filter(|n| n.layer >= b.layer && n.layer <= a.layer).map(|n| n.v).fold(f64::INFINITY, f64::min)
            - LOOP_LIFT;
    let p0 = pt(a.u + a.u_size / 2.0, a.v + a.iv);
    let p3 = pt(b.u + b.u_size / 2.0, b.v + b.iv);
    cubic(axes, [p0, pt(p0.x, top), pt(p3.x, top), p3], 0.5)
}

fn grow(r: Rect, by: f64) -> Rect {
    Rect { x: r.x - by, y: r.y - by, width: r.width + 2.0 * by, height: r.height + 2.0 * by }
}

fn overlap(a: Rect, b: Rect) -> f64 {
    let w = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
    let h = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
    if w > 0.0 && h > 0.0 { w * h } else { 0.0 }
}

fn group_name_max(width: f64, dir: Dir) -> f64 {
    if dir == Dir::TB { width / 2.0 - 34.0 } else { width - 44.0 }
}

fn group_obstacles(g: &PlacedGroup) -> Vec<Rect> {
    let b = BORDER_CLEAR;
    let name_w = g.label.width;
    vec![
        Rect { x: g.x - b, y: g.y - b, width: g.width + 2.0 * b, height: 2.0 * b },
        Rect { x: g.x - b, y: g.y + g.height - b, width: g.width + 2.0 * b, height: 2.0 * b },
        Rect { x: g.x - b, y: g.y - b, width: 2.0 * b, height: g.height + 2.0 * b },
        Rect { x: g.x + g.width - b, y: g.y - b, width: 2.0 * b, height: g.height + 2.0 * b },
        Rect {
            x: if g.name_left { g.x + GROUP_NAME.0 } else { g.x + g.width - GROUP_NAME.0 - name_w },
            y: g.y + GROUP_NAME.1,
            width: name_w,
            height: GROUP_FONT * 1.3,
        },
    ]
}

struct LabelSize {
    text: Fit,
    width: f64,
    height: f64,
}

fn label_size(text: &str, chars: f64) -> LabelSize {
    let fit = fit_text(text, &Slot::named("edgeLabel", chars * MONO_ADVANCE * LABEL_FONT));
    let cells = fit.lines.iter().map(|l| l.iter().map(|r| js_len(&r.text)).sum::<usize>()).max().unwrap_or(0) as f64;
    let width = (cells * MONO_ADVANCE * fit.size).max(fit.width) + 2.0 * LABEL_PAD.0 + 2.0;
    let height = fit.lines.len() as f64 * fit.size * LABEL_LINE_HEIGHT + 2.0 * LABEL_PAD.1 + 2.0;
    LabelSize { text: fit, width, height }
}

fn label_spots(c: &Curve) -> Vec<Pt> {
    let mut ts = vec![c.t0];
    for k in 1..=30 {
        for t in [c.t0 - 0.03 * k as f64, c.t0 + 0.03 * k as f64] {
            if t > 0.05 && t < 0.95 {
                ts.push(t);
            }
        }
    }
    ts.into_iter().map(|t| c.at.at(t)).collect()
}

fn label_cost(at: Pt, w: f64, h: f64, obstacles: &[Rect], lines: &[Pt]) -> (f64, usize) {
    let rect = Rect { x: at.x - w / 2.0, y: at.y - h / 2.0, width: w, height: h };
    (
        obstacles.iter().map(|o| overlap(rect, *o)).sum(),
        lines
            .iter()
            .filter(|p| p.x > rect.x && p.x < rect.x + rect.width && p.y > rect.y && p.y < rect.y + rect.height)
            .count(),
    )
}

fn place_label(c: &Curve, w: f64, h: f64, obstacles: &[Rect], lines: &[Pt]) -> (Pt, f64) {
    let mut best = (c.at.at(c.t0), f64::INFINITY, usize::MAX);
    for at in label_spots(c) {
        let (cost, crossed) = label_cost(at, w, h, obstacles, lines);
        if cost < best.1 || (cost == best.1 && crossed < best.2) {
            best = (at, cost, crossed);
        }
        if cost == 0.0 && crossed == 0 {
            break;
        }
    }
    (best.0, best.1)
}

/// Lays the graph out in layout units with cards `node_w` wide, growing a gap where a label finds no clear spot.
pub fn layout_graph(nodes: &[GraphNode], edges: &[GraphEdge], dir: Dir, node_w: f64) -> GraphLayout {
    let mut extra: Vec<f64> = Vec::new();
    let mut pass = 0;
    loop {
        let (mut layout, crowded) = layout_pass(nodes, edges, dir, node_w, &extra);
        if crowded.is_empty() || pass == 3 {
            layout.texts = node_texts(nodes, node_w, decision_height(nodes, node_w));
            return layout;
        }
        for (gap, g) in crowded {
            if extra.len() <= gap {
                extra.resize(gap + 1, 0.0);
            }
            extra[gap] += g;
        }
        pass += 1;
    }
}

fn layout_pass(
    nodes: &[GraphNode],
    all_edges: &[GraphEdge],
    dir: Dir,
    node_w: f64,
    extra: &[f64],
) -> (GraphLayout, Vec<(usize, f64)>) {
    let diamond = decision_height(nodes, node_w);
    let height_of = |n: usize| shape_height(nodes[n].shape(), diamond);
    let cell_h = (0..nodes.len()).map(height_of).fold(f64::NEG_INFINITY, f64::max);
    let axes = Axes::new(dir, node_w, cell_h);
    let (v_size, v_gap) = (axes.v, axes.v_gap);
    let ids: HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
    let valid_idx: Vec<usize> = (0..all_edges.len())
        .filter(|&i| {
            let e = &all_edges[i];
            ids.contains(e.from.as_str()) && ids.contains(e.to.as_str()) && e.from != e.to
        })
        .collect();
    let valid: Vec<&GraphEdge> = valid_idx.iter().map(|&i| &all_edges[i]).collect();
    let back = back_edges(nodes, &valid);
    let dag: Vec<&GraphEdge> = valid.iter().enumerate().filter(|(i, _)| !back.contains(i)).map(|(_, e)| *e).collect();
    let layer_of = assign_layers(nodes, &dag);
    let layer = |id: &str| layer_of[id];
    let node_ix: HashMap<&str, usize> = nodes.iter().enumerate().map(|(i, n)| (n.id.as_str(), i)).collect();

    let layer_count = nodes.iter().map(|n| layer(&n.id) + 1).max().unwrap_or(1).max(1);
    let mut columns: Vec<Vec<usize>> = vec![Vec::new(); layer_count];
    for (i, n) in nodes.iter().enumerate() {
        columns[layer(&n.id)].push(i);
    }
    order_layers(nodes, &mut columns, &dag);
    let mut bands = bands_of(nodes, &columns);
    let u_sizes: Vec<f64> = columns
        .iter()
        .map(|col| if dir == Dir::LR { node_w } else { col.iter().map(|&n| height_of(n)).fold(TERMINAL_H, f64::max) })
        .collect();
    let insets = |n: usize, l: usize| {
        if dir == Dir::LR { (0.0, (v_size - height_of(n)) / 2.0) } else { ((u_sizes[l] - height_of(n)) / 2.0, 0.0) }
    };
    let band_of = |bands: &[Band], n: usize| -> usize {
        let l = layer(&nodes[n].id);
        bands.iter().position(|b| b.name == nodes[n].group && b.first <= l && l <= b.last).expect("band")
    };
    for col in columns.iter_mut() {
        let tracks: HashMap<usize, usize> = col.iter().map(|&n| (n, bands[band_of(&bands, n)].track)).collect();
        col.sort_by_key(|n| tracks[n]);
    }

    let head_v = if dir == Dir::LR { GROUP_HEAD } else { 0.0 };
    let head_u = if dir == Dir::TB { GROUP_HEAD } else { 0.0 };
    let has_backward = valid.iter().enumerate().any(|(i, e)| back.contains(&i) || layer(&e.to) < layer(&e.from));
    let top = PAD + if has_backward { LOOP_LIFT } else { 0.0 };
    let extent = |count: f64| count * v_size + (count - 1.0) * v_gap;
    let track_count = bands.iter().map(|b| b.track).max().unwrap_or(0) + 1;
    let mut cursor = top;
    for t in 0..track_count {
        let members: Vec<usize> = (0..bands.len()).filter(|&b| bands[b].track == t).collect();
        let named = members.iter().any(|&b| bands[b].name.is_some());
        let size = members.iter().map(|&b| bands[b].size).max().unwrap_or(0) as f64;
        if named {
            cursor += head_v + GROUP_PAD;
        }
        for &b in &members {
            bands[b].v0 = cursor + (extent(size) - extent(bands[b].size as f64)) / 2.0;
        }
        cursor += extent(size) + if named { GROUP_PAD } else { 0.0 } + if t < track_count - 1 { BAND_GAP } else { 0.0 };
    }

    let named: Vec<usize> = (0..bands.len()).filter(|&b| bands[b].name.is_some()).collect();
    let spans: Vec<(usize, usize)> = named.iter().map(|&b| (bands[b].first, bands[b].last)).collect();
    let closing = |l: usize| if spans.iter().any(|s| s.1 == l) { GROUP_PAD } else { 0.0 };
    let opening = |l: usize| if spans.iter().any(|s| s.0 == l) { GROUP_PAD + head_u } else { 0.0 };
    let sizes: Vec<Option<LabelSize>> = valid
        .iter()
        .map(|e| e.label.as_deref().filter(|l| !l.is_empty()).map(|l| label_size(l, axes.label_chars)))
        .collect();
    let gaps: Vec<f64> = (0..layer_count.saturating_sub(1))
        .map(|l| {
            let label = valid
                .iter()
                .enumerate()
                .filter(|(i, e)| {
                    sizes[*i].is_some()
                        && layer(&e.from).min(layer(&e.to)) == l
                        && (layer(&e.to) as i64 - layer(&e.from) as i64).abs() == 1
                })
                .map(|(i, _)| {
                    let s = sizes[i].as_ref().expect("size");
                    axes.label_u(s.width, s.height)
                })
                .fold(0.0, f64::max);
            let floor =
                if closing(l) > 0.0 || opening(l + 1) > 0.0 { axes.u_gap.max(BORDERED_GAP) } else { axes.u_gap };
            floor.max(
                closing(l)
                    + if label > 0.0 { label + 2.0 * LABEL_CLEAR } else { 0.0 }
                    + opening(l + 1).max(ARROW_CLEAR),
            ) + extra.get(l).copied().unwrap_or(0.0)
        })
        .collect();
    let mut u_start = vec![axes.u_pad + opening(0)];
    for (l, gap) in gaps.iter().enumerate() {
        let next = u_start[l] + u_sizes[l] + gap;
        u_start.push(next);
    }
    let u_of = |l: usize| u_start[l];
    let label_u = |l: usize| {
        if l + 1 >= u_start.len() {
            return 0.0;
        }
        (u_of(l) + u_sizes[l] + closing(l) + u_of(l + 1) - opening(l + 1)) / 2.0
    };

    let mut placed: Vec<Placed> = Vec::new();
    let mut place_ix: HashMap<usize, usize> = HashMap::new();
    for (l, col) in columns.iter().enumerate() {
        for (bi, band) in bands.iter().enumerate() {
            let members: Vec<usize> = col.iter().copied().filter(|&n| band_of(&bands, n) == bi).collect();
            for (i, &node) in members.iter().enumerate() {
                let (iu, iv) = insets(node, l);
                place_ix.insert(node, placed.len());
                placed.push(Placed {
                    layer: l,
                    u: u_of(l),
                    u_size: u_sizes[l],
                    v: band.v0
                        + (extent(band.size as f64) - extent(members.len() as f64)) / 2.0
                        + i as f64 * (v_size + v_gap),
                    iu,
                    iv,
                });
            }
        }
    }
    let ends_ix: Vec<(usize, usize)> =
        valid.iter().map(|e| (place_ix[&node_ix[e.from.as_str()]], place_ix[&node_ix[e.to.as_str()]])).collect();
    let ends: Vec<(Placed, Placed)> = ends_ix.iter().map(|&(a, b)| (placed[a], placed[b])).collect();
    let skipping: Vec<f64> = (0..valid.len())
        .filter(|&i| ends[i].1.layer > ends[i].0.layer + 1 && sizes[i].is_some())
        .map(|i| {
            let s = sizes[i].as_ref().expect("size");
            axes.label_v(s.width, s.height)
        })
        .collect();
    let raw =
        skip_lanes(&axes, &ends, &placed, skipping.iter().copied().fold(v_gap / 2.0, f64::max) + 2.0 * LABEL_CLEAR);
    let min_lane = raw.iter().flatten().copied().fold(f64::INFINITY, f64::min);
    let shift = (LANE_EDGE - min_lane).max(0.0);
    let lanes: Vec<Option<f64>> = raw.iter().map(|v| v.map(|v| v + shift)).collect();
    let max_lane = lanes.iter().flatten().copied().fold(f64::NEG_INFINITY, f64::max);
    for p in placed.iter_mut() {
        p.v += shift;
    }
    for b in bands.iter_mut() {
        b.v0 += shift;
    }
    cursor += shift;

    let groups: Vec<PlacedGroup> = named
        .iter()
        .map(|&bi| {
            let band = &bands[bi];
            let (first, last) = (band.first, band.last);
            let a = axes.xy(u_of(first) - GROUP_PAD - head_u, band.v0 - GROUP_PAD - head_v);
            let b = axes.xy(u_of(last) + u_sizes[last] + GROUP_PAD, band.v0 + extent(band.size as f64) + GROUP_PAD);
            let from: Vec<f64> = valid
                .iter()
                .filter(|e| {
                    let (t, f) = (&nodes[node_ix[e.to.as_str()]], &nodes[node_ix[e.from.as_str()]]);
                    t.group == band.name && layer(&e.to) == first && f.group != band.name
                })
                .map(|e| placed[place_ix[&node_ix[e.from.as_str()]]].v + v_size / 2.0)
                .collect();
            let enter_before = !from.is_empty()
                && (from.iter().sum::<f64>() / from.len() as f64) < band.v0 + extent(band.size as f64) / 2.0;
            let (bx, by, bw, bh) = (a.x, a.y, b.x - a.x, b.y - a.y);
            let label =
                fit_text(band.name.as_deref().unwrap_or(""), &Slot::named("groupName", group_name_max(bw, dir)));
            PlacedGroup {
                name: band.name.clone().unwrap_or_default(),
                x: bx,
                y: by,
                width: bw,
                height: bh,
                layer: first,
                name_left: !(dir == Dir::TB && enter_before),
                label,
            }
        })
        .collect();

    let shape_box = |p: &Placed| {
        let size = axes.xy(p.u_size - 2.0 * p.iu, v_size - 2.0 * p.iv);
        let at = axes.xy(p.u + p.iu, p.v + p.iv);
        Rect { x: at.x, y: at.y, width: size.x, height: size.y }
    };
    let mut obstacles: Vec<Rect> = placed.iter().map(|p| grow(shape_box(p), 6.0)).collect();
    obstacles.extend(groups.iter().flat_map(group_obstacles));
    let mut crowded: Vec<(usize, f64)> = Vec::new();
    let curves: Vec<Curve> = (0..valid.len())
        .map(|i| {
            let (a, b) = (&placed[ends_ix[i].0], &placed[ends_ix[i].1]);
            route(&axes, &gaps, a, b, &placed, lanes[i], &|| label_u(a.layer.min(b.layer)))
        })
        .collect();
    let others = |i: usize| -> Vec<Pt> {
        curves.iter().enumerate().filter(|(j, _)| *j != i).flat_map(|(_, c)| c.points.iter().copied()).collect()
    };
    let clear_spots = |i: usize, obstacles: &[Rect]| {
        let s = sizes[i].as_ref().expect("size");
        let o = others(i);
        label_spots(&curves[i])
            .into_iter()
            .filter(|&at| {
                let (cost, crossed) = label_cost(at, s.width, s.height, obstacles, &o);
                cost == 0.0 && crossed == 0
            })
            .count()
    };
    let mut labelled: Vec<(usize, usize)> =
        (0..valid.len()).filter(|&i| sizes[i].is_some()).map(|i| (i, clear_spots(i, &obstacles))).collect();
    labelled.sort_by_key(|&(_, spots)| spots);
    let mut labels: HashMap<usize, Pt> = HashMap::new();
    for (i, _) in labelled {
        let s = sizes[i].as_ref().expect("size");
        let (at, cost) = place_label(&curves[i], s.width, s.height, &obstacles, &others(i));
        let (la, lb) = (layer(&valid[i].from), layer(&valid[i].to));
        if cost > 0.0 && (la as i64 - lb as i64).abs() == 1 {
            let gap = la.min(lb);
            let want = axes.label_u(s.width, s.height) + LABEL_CLEAR;
            match crowded.iter_mut().find(|c| c.0 == gap) {
                Some(c) => c.1 = c.1.max(want),
                None => crowded.push((gap, want)),
            }
        }
        labels.insert(i, at);
        obstacles.push(grow(
            Rect { x: at.x - s.width / 2.0, y: at.y - s.height / 2.0, width: s.width, height: s.height },
            4.0,
        ));
    }
    let mut sizes = sizes;
    let routed: Vec<RoutedEdge> = valid_idx
        .iter()
        .enumerate()
        .map(|(i, &orig)| RoutedEdge {
            edge: orig,
            d: curves[i].d.clone(),
            label: labels.get(&i).map(|at| {
                let s = sizes[i].take().expect("size");
                EdgeLabelBox { text: s.text, x: at.x, y: at.y }
            }),
        })
        .collect();

    let has_same_layer = valid.iter().any(|e| layer(&e.to) == layer(&e.from));
    let u_size = u_of(layer_count - 1)
        + u_sizes[layer_count - 1]
        + closing(layer_count - 1)
        + axes.u_pad
        + if has_same_layer { 80.0 } else { 0.0 };
    let v_total = (cursor + PAD).max(max_lane + LANE_EDGE);
    let size = axes.xy(u_size, v_total);
    let layout = GraphLayout {
        nodes: (0..nodes.len())
            .map(|n| {
                let p = &placed[place_ix[&n]];
                let r = shape_box(p);
                PositionedNode { node: n, layer: p.layer, x: r.x, y: r.y, w: r.width, h: r.height }
            })
            .collect(),
        edges: routed,
        groups,
        layer_count,
        texts: HashMap::new(),
        width: size.x,
        height: size.y,
    };
    (layout, crowded)
}

fn fit_scale(layout: &GraphLayout, box_: (f64, f64)) -> f64 {
    (box_.0 / layout.width).min(box_.1 / layout.height).min(MAX_SCALE)
}

/// The layout that draws largest in `box_`: shapes widen while that draws the graph larger, or lets every title take a
/// larger font without drawing it smaller.
pub fn fit_graph(nodes: &[GraphNode], edges: &[GraphEdge], dir: Dir, box_: (f64, f64)) -> (GraphLayout, f64) {
    let base = layout_graph(nodes, edges, dir, NODE_W);
    let floor = fit_scale(&base, box_);
    let boxed = boxed_cards(nodes);
    let lowers = |w: f64| decision_height(nodes, w) < decision_height(nodes, NODE_W);
    let base_font = shared_title_size(&boxed, NODE_W, NODE_H);
    let mut best = (base, floor, base_font);
    let mut w = NODE_W + 8.0;
    while w <= NODE_W_MAX {
        let font = shared_title_size(&boxed, w, NODE_H);
        if font <= best.2 && !(dir == Dir::TB && lowers(w)) {
            w += 8.0;
            continue;
        }
        let layout = layout_graph(nodes, edges, dir, w);
        let scale = fit_scale(&layout, box_);
        if scale < floor * 0.995 {
            break;
        }
        if scale > best.1 * 1.005 || (font > best.2 && scale >= best.1 * 0.995) {
            let f = font.max(best.2);
            best = (layout, scale, f);
        }
        w += 8.0;
    }
    (best.0, best.1)
}
