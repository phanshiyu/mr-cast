//! The state diagram's layout: states in columns by distance from the start, transitions routed around them
//! (src/utils/stateLayout.ts).

use crate::marks::{Marks, badge_words, js_len};
use crate::textfit::{Fit, Slot, fit_text};
use crate::timing::js_round;
use serde::Deserialize;
use std::collections::{HashMap, HashSet, VecDeque};

const STATE_H: f64 = 72.0;
const STATE_FONT: f64 = 26.0;
pub const BADGE_FONT: f64 = 14.0;
const LABEL_FONT: f64 = 18.0;
const LABEL_LINE_H: f64 = 22.0;
const LABEL_PAD_Y: f64 = 6.0;
const LABEL_MAX_CHARS: f64 = 22.0;
const MONO_ADVANCE: f64 = 0.61;
pub const ARROW_LEN: f64 = 14.0;
const MIN_W: f64 = 170.0;
const MAX_W: f64 = 360.0;
const PAD_X: f64 = 28.0;
const MIN_COL_GAP: f64 = 150.0;
const ROW_GAP: f64 = 110.0;
const PAD: f64 = 36.0;
const LOOP_H: f64 = 92.0;
const LOOP_STEP: f64 = 46.0;
const ARC_CLEAR: f64 = 48.0;
const LANE_STEP: f64 = 46.0;
const CORNER: f64 = 20.0;
const CHANNEL: f64 = 34.0;
const SPREAD: f64 = 44.0;
const ENTRY_GAP: f64 = 74.0;

#[derive(Clone, Debug, Deserialize)]
pub struct StateNode {
    pub id: String,
    #[serde(default, deserialize_with = "crate::marks::text_or_number")]
    pub label: Option<String>,
    #[serde(default, rename = "final")]
    pub is_final: Option<bool>,
    #[serde(flatten)]
    pub marks: Marks,
}

impl StateNode {
    pub fn label(&self) -> &str {
        self.label.as_deref().unwrap_or("")
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct StateTransition {
    pub from: String,
    pub to: String,
    #[serde(default, deserialize_with = "crate::marks::text_or_number")]
    pub label: Option<String>,
    #[serde(flatten)]
    pub marks: Marks,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

fn pt(x: f64, y: f64) -> Pt {
    Pt { x, y }
}
fn add(a: Pt, b: Pt) -> Pt {
    pt(a.x + b.x, a.y + b.y)
}
fn sub(a: Pt, b: Pt) -> Pt {
    pt(a.x - b.x, a.y - b.y)
}
fn mul(a: Pt, k: f64) -> Pt {
    pt(a.x * k, a.y * k)
}
fn unit(a: Pt) -> Pt {
    let len = a.x.hypot(a.y);
    let len = if len == 0.0 { 1.0 } else { len };
    pt(a.x / len, a.y / len)
}

/// A transition label pill: its text and the pill's size, centred at (x, y).
#[derive(Clone)]
pub struct Label {
    pub text: Fit,
    pub w: f64,
    pub h: f64,
    pub x: f64,
    pub y: f64,
}

pub struct PlacedState {
    pub state: usize,
    pub label: Fit,
    pub layer: usize,
    pub row: usize,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub struct RoutedTransition {
    /// Index in the scene's `transitions`.
    pub transition: usize,
    pub d: String,
    pub tip: Pt,
    pub dir: Pt,
    pub label: Option<Label>,
}

pub struct Entry {
    pub dot: Pt,
    pub d: String,
    pub tip: Pt,
    pub dir: Pt,
}

pub struct StateLayout {
    pub states: Vec<PlacedState>,
    pub transitions: Vec<RoutedTransition>,
    pub entry: Option<Entry>,
    pub layer_of: HashMap<String, usize>,
    pub width: f64,
    pub height: f64,
}

fn badge_width(text: &str) -> f64 {
    (js_len(text) as f64 * (BADGE_FONT * 0.76 + 1.0) + 22.0).ceil()
}

fn label_height(lines: usize, size: f64) -> f64 {
    lines as f64 * LABEL_LINE_H * (size / LABEL_FONT) + 2.0 * LABEL_PAD_Y
}

fn label_box(t: &StateTransition) -> (Fit, f64, f64) {
    let text = format!(
        "{}{}",
        if t.marks.change.as_deref() == Some("added") { "+ " } else { "" },
        t.label.as_deref().unwrap_or("")
    );
    let fit = fit_text(&text, &Slot::named("transitionLabel", LABEL_MAX_CHARS * LABEL_FONT * MONO_ADVANCE));
    let cells = fit.lines.iter().map(|l| l.iter().map(|r| js_len(&r.text)).sum::<usize>()).max().unwrap_or(0) as f64;
    let w = ((cells * fit.size * MONO_ADVANCE).max(fit.width) + 26.0).ceil();
    let h = label_height(fit.lines.len(), fit.size);
    (fit, w, h)
}

fn badges_total(s: &StateNode) -> f64 {
    badge_words(&s.marks).iter().map(|w| badge_width(w) + 14.0).sum()
}

fn label_room(s: &StateNode, w: f64) -> f64 {
    w - 2.0 * PAD_X - badges_total(s)
}

fn state_width(s: &StateNode) -> f64 {
    let w = js_len(s.label()) as f64 * STATE_FONT * 0.6 + 2.0 * PAD_X + 8.0 + badges_total(s);
    js_round(MAX_W.min(MIN_W.max(w)))
}

#[derive(Clone, Copy)]
enum Seg {
    M(Pt),
    L(Pt),
    Q(Pt, Pt),
    C(Pt, Pt, Pt),
}

struct Route {
    segs: Vec<Seg>,
    tip: Pt,
    dir: Pt,
    label: Option<Label>,
}

fn assign_layers(
    states: &[StateNode],
    edges: &[&StateTransition],
    initial: Option<&str>,
) -> (HashMap<String, usize>, HashSet<String>) {
    let ids: HashSet<&str> = states.iter().map(|s| s.id.as_str()).collect();
    let has_incoming: HashSet<&str> = edges.iter().filter(|e| e.from != e.to).map(|e| e.to.as_str()).collect();
    let start = initial
        .filter(|i| ids.contains(i))
        .map(str::to_string)
        .or_else(|| states.iter().find(|s| !has_incoming.contains(s.id.as_str())).map(|s| s.id.clone()))
        .or_else(|| states.first().map(|s| s.id.clone()));
    let mut layer_of: HashMap<String, usize> = HashMap::new();
    if let Some(start) = start {
        layer_of.insert(start.clone(), 0);
        let mut queue = VecDeque::from([start]);
        while let Some(id) = queue.pop_front() {
            for e in edges {
                if e.from == id && !layer_of.contains_key(&e.to) {
                    let l = layer_of[&id] + 1;
                    layer_of.insert(e.to.clone(), l);
                    queue.push_back(e.to.clone());
                }
            }
        }
    }
    let unreachable: Vec<&StateNode> = states.iter().filter(|s| !layer_of.contains_key(&s.id)).collect();
    let mut changed = true;
    while changed {
        changed = false;
        for s in &unreachable {
            if layer_of.contains_key(&s.id) {
                continue;
            }
            let targets: Vec<usize> = edges
                .iter()
                .filter(|e| e.from == s.id && e.to != s.id && layer_of.contains_key(&e.to))
                .map(|e| layer_of[&e.to])
                .collect();
            if let Some(m) = targets.iter().min() {
                layer_of.insert(s.id.clone(), m.saturating_sub(1));
                changed = true;
            }
        }
    }
    let last = layer_of.values().max().map_or(0, |m| m + 1);
    let unreachable: HashSet<String> = unreachable.iter().map(|s| s.id.clone()).collect();
    for id in &unreachable {
        layer_of.entry(id.clone()).or_insert(last);
    }
    (layer_of, unreachable)
}

fn order_columns(
    states: &[StateNode],
    columns: &mut [Vec<usize>],
    edges: &[&StateTransition],
    layer_of: &HashMap<String, usize>,
    unreachable: &HashSet<String>,
) {
    let neighbours = |id: &str, layer: usize| -> Vec<String> {
        edges
            .iter()
            .filter_map(|e| {
                let other = if e.from == id {
                    &e.to
                } else if e.to == id {
                    &e.from
                } else {
                    return None;
                };
                (other != id && layer_of.get(other) == Some(&layer)).then(|| other.clone())
            })
            .collect()
    };
    let sweep = |columns: &mut [Vec<usize>], l: usize, r: usize| {
        let index: HashMap<&str, usize> =
            columns[r].iter().enumerate().map(|(i, &s)| (states[s].id.as_str(), i)).collect();
        let keys: HashMap<usize, f64> = columns[l]
            .iter()
            .enumerate()
            .map(|(i, &s)| {
                let ns: Vec<usize> = neighbours(&states[s].id, r).iter().map(|id| index[id.as_str()]).collect();
                (s, if ns.is_empty() { i as f64 } else { ns.iter().sum::<usize>() as f64 / ns.len() as f64 })
            })
            .collect();
        columns[l].sort_by(|a, b| keys[a].partial_cmp(&keys[b]).unwrap_or(std::cmp::Ordering::Equal));
    };
    for _ in 0..2 {
        for l in 1..columns.len() {
            if !columns[l - 1].is_empty() {
                sweep(columns, l, l - 1);
            }
        }
        for l in (0..columns.len().saturating_sub(1)).rev() {
            if !columns[l + 1].is_empty() {
                sweep(columns, l, l + 1);
            }
        }
    }
    for col in columns.iter_mut() {
        col.sort_by_key(|&s| unreachable.contains(&states[s].id));
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Side {
    Left,
    Right,
}

enum Plan {
    Loop { nth: usize },
    Gap { offset: f64 },
    Vertical { offset: f64, size: usize },
    Channel { side: Side, offset: f64 },
    Arc { above: bool, level: usize, top_a: bool, top_b: bool },
}

struct P {
    t: usize,
    a: usize,
    b: usize,
    plan: Plan,
}

fn pill_inset(h: f64, dy: f64) -> f64 {
    let r = h / 2.0;
    let d = dy.abs().min(r);
    r - (r * r - d * d).sqrt()
}

fn orth(points: &[Pt], label: Option<Label>) -> Route {
    let tip = points[points.len() - 1];
    let dir = unit(sub(tip, points[points.len() - 2]));
    let mut pts: Vec<Pt> = points[..points.len() - 1].to_vec();
    pts.push(sub(tip, mul(dir, ARROW_LEN)));
    let mut segs = vec![Seg::M(pts[0])];
    for i in 1..pts.len() - 1 {
        let (prev, corner, next) = (pts[i - 1], pts[i], pts[i + 1]);
        let in_dir = unit(sub(corner, prev));
        let out_dir = unit(sub(next, corner));
        let r = CORNER
            .min((corner.x - prev.x).hypot(corner.y - prev.y) / 2.0)
            .min((next.x - corner.x).hypot(next.y - corner.y) / 2.0);
        segs.push(Seg::L(sub(corner, mul(in_dir, r))));
        segs.push(Seg::Q(corner, add(corner, mul(out_dir, r))));
    }
    segs.push(Seg::L(pts[pts.len() - 1]));
    Route { segs, tip, dir, label }
}

fn cubic_route(p0: Pt, c1: Pt, c2: Pt, tip: Pt, box_: Option<(&Fit, f64, f64)>) -> Route {
    let dir = unit(sub(tip, c2));
    let p3 = sub(tip, mul(dir, ARROW_LEN));
    let mid = pt((p0.x + 3.0 * c1.x + 3.0 * c2.x + p3.x) / 8.0, (p0.y + 3.0 * c1.y + 3.0 * c2.y + p3.y) / 8.0);
    Route {
        segs: vec![Seg::M(p0), Seg::C(c1, c2, p3)],
        tip,
        dir,
        label: box_.map(|(t, w, h)| Label { text: t.clone(), w, h, x: mid.x, y: mid.y }),
    }
}

pub fn layout_state(states: &[StateNode], transitions: &[StateTransition], initial: Option<&str>) -> StateLayout {
    let ids: HashSet<&str> = states.iter().map(|s| s.id.as_str()).collect();
    let edge_idx: Vec<usize> = (0..transitions.len())
        .filter(|&i| ids.contains(transitions[i].from.as_str()) && ids.contains(transitions[i].to.as_str()))
        .collect();
    let edges: Vec<&StateTransition> = edge_idx.iter().map(|&i| &transitions[i]).collect();
    let labels: Vec<(Fit, f64, f64)> = edges.iter().map(|t| label_box(t)).collect();
    let has_label = |e: usize| edges[e].label.as_deref().is_some_and(|l| !l.is_empty());
    let (layer_of, unreachable) = assign_layers(states, &edges, initial);
    let layer_count = layer_of.values().map(|l| l + 1).max().unwrap_or(1).max(1);
    let mut columns: Vec<Vec<usize>> = vec![Vec::new(); layer_count];
    for (i, s) in states.iter().enumerate() {
        columns[layer_of[&s.id]].push(i);
    }
    order_columns(states, &mut columns, &edges, &layer_of, &unreachable);
    let st_ix: HashMap<&str, usize> = states.iter().enumerate().map(|(i, s)| (s.id.as_str(), i)).collect();

    let loop_count = |id: &str| edges.iter().filter(|e| e.from == id && e.to == id).count();
    let loop_reserve = |id: &str| {
        let loops: Vec<usize> = (0..edges.len()).filter(|&i| edges[i].from == id && edges[i].to == id).collect();
        let label_h = loops
            .iter()
            .map(|&e| if has_label(e) { labels[e].2 } else { 0.0 })
            .fold(label_height(1, LABEL_FONT), f64::max);
        if loops.is_empty() { 0.0 } else { 0.75 * (LOOP_H + (loops.len() as f64 - 1.0) * LOOP_STEP) + label_h + 10.0 }
    };

    let mut placed: Vec<PlacedState> = Vec::new();
    let mut place_of: HashMap<usize, usize> = HashMap::new();
    for (layer, col) in columns.iter().enumerate() {
        let gaps: Vec<f64> = col
            .iter()
            .enumerate()
            .map(|(i, &s)| if i == 0 { 0.0 } else { ROW_GAP + loop_reserve(&states[s].id) })
            .collect();
        let body_h = col.len() as f64 * STATE_H + gaps.iter().sum::<f64>();
        let mut y = -body_h / 2.0;
        for (row, &s) in col.iter().enumerate() {
            y += gaps[row];
            let w = state_width(&states[s]);
            let label = fit_text(states[s].label(), &Slot::named("stateLabel", label_room(&states[s], w)));
            place_of.insert(s, placed.len());
            placed.push(PlacedState { state: s, label, layer, row, x: 0.0, y, w, h: STATE_H });
            y += STATE_H;
        }
    }
    let at = |id: &str| place_of[&st_ix[id]];
    let is_top = |p: &PlacedState| p.row == 0;
    let col_len = |l: usize| columns[l].len();
    let is_bottom = |p: &PlacedState| p.row == col_len(p.layer) - 1;
    let cy = |p: &PlacedState| p.y + p.h / 2.0;
    let cx = |p: &PlacedState| p.x + p.w / 2.0;

    let pair_key = |t: &StateTransition| {
        let mut v = [t.from.as_str(), t.to.as_str()];
        v.sort();
        v.join("\u{0}")
    };
    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, t) in edges.iter().enumerate() {
        if t.from != t.to {
            groups.entry(pair_key(t)).or_default().push(i);
        }
    }
    let spread = |i: usize| {
        let g = &groups[&pair_key(edges[i])];
        let k = g.iter().position(|&x| x == i).unwrap_or(0) as f64;
        ((k - (g.len() as f64 - 1.0) / 2.0) * SPREAD, g.len())
    };

    let layer_of_e = |id: &str| layer_of[id];
    let span = |i: usize| (layer_of_e(&edges[i].from) as i64 - layer_of_e(&edges[i].to) as i64).unsigned_abs() as usize;
    let mut arc_plans: HashMap<usize, (bool, usize, bool, bool)> = HashMap::new();
    let mut arc_list: Vec<(usize, usize, usize, bool, usize)> = Vec::new(); // edge, lo, hi, above, level
    let mut balance = 0i64;
    let mut wide: Vec<usize> = (0..edges.len()).filter(|&i| span(i) >= 2).collect();
    wide.sort_by_key(|&i| span(i));
    for i in wide {
        let a = &placed[at(&edges[i].from)];
        let b = &placed[at(&edges[i].to)];
        let above = if is_top(a) && is_top(b) {
            true
        } else if is_bottom(a) && is_bottom(b) {
            false
        } else {
            cy(a) + cy(b) < 0.0 || (cy(a) + cy(b) == 0.0 && balance <= 0)
        };
        balance += if above { 1 } else { -1 };
        let (lo, hi) = (a.layer.min(b.layer), a.layer.max(b.layer));
        let level =
            arc_list.iter().filter(|o| o.3 == above && o.1 <= hi && lo <= o.2).map(|o| o.4 as i64).fold(-1, i64::max)
                + 1;
        arc_list.push((i, lo, hi, above, level as usize));
        let free = |p: &PlacedState| {
            if above { is_top(p) && loop_count(&states[p.state].id) == 0 } else { is_bottom(p) }
        };
        arc_plans.insert(i, (above, level as usize, free(a), free(b)));
    }

    let mut loops_seen: HashMap<&str, usize> = HashMap::new();
    let plans: Vec<P> = (0..edges.len())
        .map(|i| {
            let t = edges[i];
            let (a, b) = (at(&t.from), at(&t.to));
            let (pa, pb) = (&placed[a], &placed[b]);
            let plan = if t.from == t.to {
                let nth = *loops_seen.get(t.from.as_str()).unwrap_or(&0);
                loops_seen.insert(t.from.as_str(), nth + 1);
                Plan::Loop { nth }
            } else if (pb.layer as i64 - pa.layer as i64).abs() == 1 {
                Plan::Gap { offset: spread(i).0 }
            } else if pa.layer == pb.layer {
                let lower = if pb.row > pa.row { pb } else { pa };
                if (pb.row as i64 - pa.row as i64).abs() == 1 && loop_count(&states[lower.state].id) == 0 {
                    let (offset, size) = spread(i);
                    Plan::Vertical { offset, size }
                } else {
                    Plan::Channel { side: if pb.row > pa.row { Side::Right } else { Side::Left }, offset: spread(i).0 }
                }
            } else {
                let (above, level, top_a, top_b) = arc_plans[&i];
                Plan::Arc { above, level, top_a, top_b }
            };
            P { t: i, a, b, plan }
        })
        .collect();

    // Ports.
    let mut port_dy: HashMap<String, f64> = HashMap::new();
    let mut side_ports: Vec<(String, Vec<(String, f64)>)> = Vec::new();
    let mut port = |key: String, node: usize, side: Side, order: f64, placed: &[PlacedState]| {
        let k = format!("{}\u{0}{}", states[placed[node].state].id, if side == Side::Left { "left" } else { "right" });
        match side_ports.iter_mut().find(|s| s.0 == k) {
            Some(s) => s.1.push((key, order)),
            None => side_ports.push((k, vec![(key, order)])),
        }
    };
    for (i, p) in plans.iter().enumerate() {
        let (a, b) = (&placed[p.a], &placed[p.b]);
        match &p.plan {
            Plan::Gap { .. } => {
                let forward = b.layer > a.layer;
                port(format!("{i}:from"), p.a, if forward { Side::Right } else { Side::Left }, cy(b), &placed);
                port(format!("{i}:to"), p.b, if forward { Side::Left } else { Side::Right }, cy(a), &placed);
            }
            Plan::Channel { side, .. } => {
                port(format!("{i}:from"), p.a, *side, cy(b), &placed);
                port(format!("{i}:to"), p.b, *side, cy(a), &placed);
            }
            Plan::Arc { above, top_a, top_b, .. } => {
                let lane = if *above { -1e6 } else { 1e6 };
                let back = a.layer > b.layer;
                if !top_a {
                    port(format!("{i}:from"), p.a, if back { Side::Left } else { Side::Right }, lane, &placed);
                }
                if !top_b {
                    port(format!("{i}:to"), p.b, if back { Side::Right } else { Side::Left }, lane, &placed);
                }
            }
            _ => {}
        }
    }
    for (_, list) in side_ports.iter_mut() {
        list.sort_by(|x, y| x.1.partial_cmp(&y.1).unwrap_or(std::cmp::Ordering::Equal));
        let step = 18f64.min(STATE_H * 0.6 / ((list.len() as f64) - 1.0).max(1.0));
        for (i, (key, _)) in list.iter().enumerate() {
            port_dy.insert(key.clone(), (i as f64 - (list.len() as f64 - 1.0) / 2.0) * step);
        }
    }

    // Column gaps.
    let mut gap_w = vec![MIN_COL_GAP; layer_count.saturating_sub(1)];
    let mut widen = |gap: i64, w: f64| {
        if gap >= 0 && (gap as usize) < gap_w.len() {
            gap_w[gap as usize] = gap_w[gap as usize].max(w);
        }
    };
    for p in &plans {
        let lw = if has_label(p.t) { labels[p.t].1 } else { 0.0 };
        let (a, b) = (&placed[p.a], &placed[p.b]);
        match &p.plan {
            Plan::Gap { .. } => widen(a.layer.min(b.layer) as i64, lw + 64.0),
            Plan::Channel { side, offset } => widen(
                if *side == Side::Right { a.layer as i64 } else { a.layer as i64 - 1 },
                CHANNEL + offset.abs() / 2.0 + lw + 40.0,
            ),
            _ => {}
        }
    }
    let col_w: Vec<f64> =
        columns.iter().map(|col| col.iter().map(|&s| state_width(&states[s])).fold(MIN_W, f64::max)).collect();
    let mut col_x: Vec<f64> = Vec::new();
    for i in 0..col_w.len() {
        col_x.push(if i == 0 { 0.0 } else { col_x[i - 1] + col_w[i - 1] + gap_w[i - 1] });
    }
    for p in placed.iter_mut() {
        p.x = col_x[p.layer] + (col_w[p.layer] - p.w) / 2.0;
    }
    let col_top = |l: usize| {
        columns[l].iter().map(|&s| placed[place_of[&s]].y - loop_reserve(&states[s].id)).fold(f64::INFINITY, f64::min)
    };
    let col_bottom =
        |l: usize| columns[l].iter().map(|&s| placed[place_of[&s]].y + STATE_H).fold(f64::NEG_INFINITY, f64::max);

    let side_tip = |p: &PlacedState, side: Side, dy: f64| {
        let inset = pill_inset(p.h, dy);
        pt(if side == Side::Left { p.x + inset } else { p.x + p.w - inset }, cy(p) + dy)
    };
    let route = |p: &P, i: usize| -> Route {
        let (a, b) = (&placed[p.a], &placed[p.b]);
        let t = edges[p.t];
        let box_ = has_label(p.t).then(|| (&labels[p.t].0, labels[p.t].1, labels[p.t].2));
        let lw = box_.map(|b| b.1);
        let label_at = |pt: Pt| box_.map(|(f, w, h)| Label { text: f.clone(), w, h, x: pt.x, y: pt.y });
        let dy = |end: &str| port_dy.get(&format!("{i}:{end}")).copied().unwrap_or(0.0);
        let _ = t;
        match &p.plan {
            Plan::Loop { nth } => {
                let h = LOOP_H + *nth as f64 * LOOP_STEP;
                let span_x = 24.0 + *nth as f64 * 10.0;
                let p0 = pt(cx(a) - span_x, a.y);
                let tip = pt(cx(a) + span_x, a.y);
                let mut r = cubic_route(p0, pt(p0.x - 44.0, a.y - h), pt(tip.x + 44.0, a.y - h), tip, None);
                r.label = label_at(pt(cx(a), a.y - 0.75 * h - box_.map_or(0.0, |b| b.2) / 2.0 - 4.0));
                r
            }
            Plan::Gap { offset } => {
                let forward = b.layer > a.layer;
                let p0 = side_tip(a, if forward { Side::Right } else { Side::Left }, dy("from"));
                let tip = side_tip(b, if forward { Side::Left } else { Side::Right }, dy("to"));
                let dx = (tip.x - p0.x) / 2.0;
                cubic_route(p0, pt(p0.x + dx, p0.y + offset), pt(tip.x - dx, tip.y + offset), tip, box_)
            }
            Plan::Vertical { offset, size } => {
                let down = b.row > a.row;
                let x = cx(a) + offset;
                let p0 = pt(x, if down { a.y + STATE_H } else { a.y });
                let tip = pt(x, if down { b.y } else { b.y + STATE_H });
                let lx = match lw {
                    Some(lw) if *size != 1 => x + offset.signum() * (lw / 2.0 + 10.0),
                    _ => x,
                };
                orth(&[p0, tip], label_at(pt(lx, (p0.y + tip.y) / 2.0)))
            }
            Plan::Channel { side, offset } => {
                let sign = if *side == Side::Right { 1.0 } else { -1.0 };
                let edge_x = if *side == Side::Right { col_x[a.layer] + col_w[a.layer] } else { col_x[a.layer] };
                let x = edge_x + sign * (CHANNEL + offset.abs() / 2.0);
                let p0 = side_tip(a, *side, dy("from"));
                let tip = side_tip(b, *side, dy("to"));
                orth(
                    &[p0, pt(x, p0.y), pt(x, tip.y), tip],
                    label_at(pt(x + sign * (lw.unwrap_or(0.0) / 2.0 + 10.0), (p0.y + tip.y) / 2.0)),
                )
            }
            Plan::Arc { above, level, top_a, top_b } => {
                let sign = if *above { -1.0 } else { 1.0 };
                let back = a.layer > b.layer;
                let lo = a.layer.min(b.layer);
                let n = (a.layer as i64 - b.layer as i64).unsigned_abs() as usize + 1;
                let edge_y = if *above {
                    (0..n).map(|k| col_top(lo + k)).fold(f64::INFINITY, f64::min)
                } else {
                    (0..n).map(|k| col_bottom(lo + k)).fold(f64::NEG_INFINITY, f64::max)
                };
                let lane = edge_y + sign * (ARC_CLEAR + *level as f64 * LANE_STEP);
                let port_y = |s: &PlacedState| if *above { s.y } else { s.y + STATE_H };
                let channel_x = |s: &PlacedState, side: Side| {
                    if side == Side::Left {
                        col_x[s.layer] - CHANNEL
                    } else {
                        col_x[s.layer] + col_w[s.layer] + CHANNEL
                    }
                };
                let (out_side, in_side) = if back { (Side::Left, Side::Right) } else { (Side::Right, Side::Left) };
                let start: Vec<Pt> = if *top_a {
                    vec![pt(a.x + a.w * if back { 0.3 } else { 0.7 }, port_y(a))]
                } else {
                    let s = side_tip(a, out_side, dy("from"));
                    vec![s, pt(channel_x(a, out_side), s.y)]
                };
                let end: Vec<Pt> = if *top_b {
                    vec![pt(b.x + b.w * if back { 0.7 } else { 0.3 }, port_y(b))]
                } else {
                    let e = side_tip(b, in_side, dy("to"));
                    vec![pt(channel_x(b, in_side), e.y), e]
                };
                let s = start[start.len() - 1];
                let e = end[0];
                let mut pts = start.clone();
                pts.push(pt(s.x, lane));
                pts.push(pt(e.x, lane));
                pts.extend(end.iter());
                orth(&pts, label_at(pt((s.x + e.x) / 2.0, lane)))
            }
        }
    };

    let mut routes: Vec<Route> = plans.iter().enumerate().map(|(i, p)| route(p, i)).collect();
    let entry_route = initial.and_then(|i| st_ix.get(i)).map(|&s| {
        let p = &placed[place_of[&s]];
        let tip = side_tip(p, Side::Left, 0.0);
        let dot = pt(tip.x - ENTRY_GAP, tip.y);
        (dot, orth(&[pt(dot.x + 12.0, dot.y), tip], None))
    });

    separate_labels(&mut routes, &placed);

    let mut xs: Vec<f64> = Vec::new();
    let mut ys: Vec<f64> = Vec::new();
    let mut grow = |p: Pt, rx: f64, ry: f64| {
        xs.push(p.x - rx);
        xs.push(p.x + rx);
        ys.push(p.y - ry);
        ys.push(p.y + ry);
    };
    for p in &placed {
        grow(pt(p.x, p.y), 0.0, 0.0);
        grow(pt(p.x + p.w, p.y + p.h), 0.0, 0.0);
    }
    for r in &routes {
        for seg in &r.segs {
            match *seg {
                Seg::M(_) => {}
                Seg::L(a) => grow(a, 0.0, 0.0),
                Seg::Q(a, b) => {
                    grow(a, 0.0, 0.0);
                    grow(b, 0.0, 0.0);
                }
                Seg::C(a, b, c) => {
                    grow(a, 0.0, 0.0);
                    grow(b, 0.0, 0.0);
                    grow(c, 0.0, 0.0);
                }
            }
        }
        grow(r.tip, ARROW_LEN, ARROW_LEN);
        if let Some(l) = &r.label {
            grow(pt(l.x, l.y), l.w / 2.0, l.h / 2.0);
        }
    }
    if let Some((dot, _)) = &entry_route {
        grow(*dot, 14.0, 14.0);
    }
    let min_x = xs.iter().copied().fold(f64::INFINITY, f64::min) - PAD;
    let min_y = ys.iter().copied().fold(f64::INFINITY, f64::min) - PAD;
    let r1 = |v: f64| (v * 10.0 + 0.5).floor() / 10.0;
    let shift = |p: Pt| pt(r1(p.x - min_x), r1(p.y - min_y));
    let path = |segs: &[Seg]| {
        segs.iter()
            .map(|s| match *s {
                Seg::M(a) => format!("M {} {}", shift(a).x, shift(a).y),
                Seg::L(a) => format!("L {} {}", shift(a).x, shift(a).y),
                Seg::Q(a, b) => format!("Q {} {}, {} {}", shift(a).x, shift(a).y, shift(b).x, shift(b).y),
                Seg::C(a, b, c) => format!(
                    "C {} {}, {} {}, {} {}",
                    shift(a).x,
                    shift(a).y,
                    shift(b).x,
                    shift(b).y,
                    shift(c).x,
                    shift(c).y
                ),
            })
            .collect::<Vec<_>>()
            .join(" ")
    };
    let out_states: Vec<PlacedState> = (0..states.len())
        .map(|s| {
            let p = &placed[place_of[&s]];
            let at = shift(pt(p.x, p.y));
            PlacedState {
                state: s,
                label: p.label.clone(),
                layer: p.layer,
                row: p.row,
                x: at.x,
                y: at.y,
                w: p.w,
                h: p.h,
            }
        })
        .collect();
    let out_trans: Vec<RoutedTransition> = routes
        .iter()
        .enumerate()
        .map(|(i, r)| RoutedTransition {
            transition: edge_idx[i],
            d: path(&r.segs),
            tip: shift(r.tip),
            dir: r.dir,
            label: r.label.as_ref().map(|l| {
                let at = shift(pt(l.x, l.y));
                Label { x: at.x, y: at.y, ..l.clone() }
            }),
        })
        .collect();
    let entry = entry_route.map(|(dot, r)| Entry { dot: shift(dot), d: path(&r.segs), tip: shift(r.tip), dir: r.dir });
    let width = xs.iter().copied().fold(f64::NEG_INFINITY, f64::max) - min_x + PAD;
    let height = ys.iter().copied().fold(f64::NEG_INFINITY, f64::max) - min_y + PAD;
    StateLayout { states: out_states, transitions: out_trans, entry, layer_of, width, height }
}

/// Nudges label pills vertically until none overlap each other or a state.
fn separate_labels(routes: &mut [Route], states: &[PlacedState]) {
    let idx: Vec<usize> = (0..routes.len()).filter(|&i| routes[i].label.is_some()).collect();
    let m = 6.0;
    let overlap_y = |a: &Label, bx: f64, by: f64, bw: f64, bh: f64| {
        let ox = (a.x + a.w / 2.0).min(bx + bw / 2.0) - (a.x - a.w / 2.0).max(bx - bw / 2.0);
        let oy = (a.y + a.h / 2.0).min(by + bh / 2.0) - (a.y - a.h / 2.0).max(by - bh / 2.0);
        if ox > -m && oy > -m { oy + m } else { 0.0 }
    };
    for _ in 0..40 {
        let mut moved = false;
        for i in 0..idx.len() {
            for j in i + 1..idx.len() {
                let (a, b) =
                    (routes[idx[i]].label.clone().expect("label"), routes[idx[j]].label.clone().expect("label"));
                let o = overlap_y(&a, b.x, b.y, b.w, b.h);
                if o > 0.0 {
                    let dir = if b.y >= a.y { 1.0 } else { -1.0 };
                    routes[idx[i]].label.as_mut().expect("label").y -= dir * o / 2.0;
                    routes[idx[j]].label.as_mut().expect("label").y += dir * o / 2.0;
                    moved = true;
                }
            }
            for s in states {
                let a = routes[idx[i]].label.clone().expect("label");
                let o = overlap_y(&a, s.x + s.w / 2.0, s.y + s.h / 2.0, s.w, s.h);
                if o > 0.0 {
                    let l = routes[idx[i]].label.as_mut().expect("label");
                    l.y += if a.y >= s.y + s.h / 2.0 { o } else { -o };
                    moved = true;
                }
            }
        }
        if !moved {
            break;
        }
    }
}

/// The scale a state diagram draws at in `box_`: as large as fits, up to 1.25.
pub fn state_scale(layout: &StateLayout, box_: (f64, f64)) -> f64 {
    (box_.0 / layout.width).min(box_.1 / layout.height).min(1.25)
}
