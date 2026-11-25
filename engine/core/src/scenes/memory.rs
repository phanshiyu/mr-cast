//! The memory scene: call frames at the left, objects in columns at the right, and an arrow from every variable or
//! field that holds a reference to the object it points at. A port of src/components/MemoryDiagram.tsx and
//! src/utils/memoryLayout.ts.

use super::{Frame, SceneInput, SceneView};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::arrays::{self, is_pointer, member_key, pointer_ref, split_member_key};
use crate::camera::Camera;
use crate::chrome::callout::{HeaderCallout, header_box};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, fit_height};
use crate::chrome::shell::Shell;
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint, PathBuilder, Shadow, Stroke};
use crate::marks::geometry::{Bx, Pt as MPt};
use crate::marks::{Board, LayoutBoxes, MarkTargets, Stage, StepRefs};
use crate::scenes::refs::target_steps;
use crate::states::{SceneState, StateFrame, hex_alpha, js_string, list, ordered_entries, walk_states};
use crate::steps::{FocusSpotlight, as_bright_as, brighter};

use crate::steps::Emphasis;
use crate::textfit::{Fit, Slot, fit_text};
use crate::theme::{ACCENT, ACCENT_GLOW, BG, BORDER, BORDER_STRONG, FAINT, MUTED, RAISED, TEXT};
use crate::timing::FPS;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

const ROW_H: f64 = 48.0;
const HEAD_H: f64 = 50.0;
const PAD: f64 = 18.0;
const NAME_GAP: f64 = 20.0;
const CARD_GAP: f64 = 24.0;
const PANEL_H: f64 = 46.0;
const MAIN_GAP: f64 = 190.0;
const COL_GAP: f64 = 150.0;
const COLUMNS_MAX: usize = 3;
const VALUE_PAD: f64 = 14.0;
const REF_W: f64 = 58.0;
const VALUE_MAX: f64 = 320.0;
const SCALE_MAX: f64 = 1.3;
const END_GAP: f64 = 10.0;
const LANE_GAP: f64 = 34.0;
const LANE_ROOM: f64 = 16.0;
const ROUTE_STEP: f64 = 12.0;
const ROUTE_GAP: f64 = 18.0;
const ROUTES_PER_GAP: usize = 5;
const CORNER: f64 = 14.0;
const SEGMENTS: usize = 9;

const START: f64 = 6.0;
const CARD_STAGGER: f64 = 4.0;
const ARROWS_AT: f64 = 28.0;
const ARROW_FRAMES: f64 = 12.0;

fn arrow_color() -> Color {
    Color::css("#aab1c2")
}

struct Row {
    key: String,
    name: Fit,
    y: f64,
}

struct Card {
    key: String,
    title: Fit,
    column: i64,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    rows: Vec<Row>,
    value_x: f64,
    value_w: f64,
}

#[derive(Clone, Copy, PartialEq)]
enum RouteKind {
    Next,
    Same,
    Skip,
    Back,
}

#[derive(Clone, Copy)]
struct Pt {
    x: f64,
    y: f64,
}

#[derive(Clone)]
struct Arrow {
    points: Vec<Pt>,
}

struct Layout {
    cards: Vec<Card>,
    card_at: HashMap<String, usize>,
    row_at: HashMap<String, (usize, usize)>,
    values: HashMap<String, Fit>,
    frames_panel: Option<Fit>,
    objects_panel: Option<Fit>,
    objects_x: f64,
    routes: HashMap<String, (usize, i64)>,
    lane_y: f64,
    width: f64,
    height: f64,
    scale: f64,
}

fn owner_of(key: &str) -> String {
    split_member_key(key).1
}

/// Each object's column (`columns`).
fn columns(scene: &Value, states: &[SceneState]) -> HashMap<String, usize> {
    let keys: Vec<String> = list(scene, "objects").iter().map(|o| format!("o:{}", js_string(&o["id"]))).collect();
    let mut out: HashMap<String, Vec<String>> = keys.iter().map(|k| (k.clone(), Vec::new())).collect();
    for s in states {
        for (key, v) in s.values.iter() {
            if key.starts_with("f:")
                && let Some(r) = pointer_ref(v)
            {
                let target = format!("o:{r}");
                let owner = owner_of(key);
                if owner != target
                    && let Some(set) = out.get_mut(&owner)
                    && !set.contains(&target)
                {
                    set.push(target);
                }
            }
        }
    }
    let pointed: HashSet<&String> = out.values().flatten().collect();
    let mut order: Vec<String> = Vec::new();
    let mut state: HashMap<String, bool> = HashMap::new(); // true = open
    let mut forward: HashMap<String, Vec<String>> = keys.iter().map(|k| (k.clone(), Vec::new())).collect();
    fn visit(
        k: &str,
        out: &HashMap<String, Vec<String>>,
        state: &mut HashMap<String, bool>,
        forward: &mut HashMap<String, Vec<String>>,
        order: &mut Vec<String>,
    ) {
        state.insert(k.to_string(), true);
        for t in out.get(k).into_iter().flatten() {
            if state.get(t) == Some(&true) {
                continue;
            }
            forward.entry(k.to_string()).or_default().push(t.clone());
            if !state.contains_key(t) {
                visit(t, out, state, forward, order);
            }
        }
        state.insert(k.to_string(), false);
        order.insert(0, k.to_string());
    }
    let starts: Vec<String> = keys.iter().filter(|k| !pointed.contains(k)).chain(keys.iter()).cloned().collect();
    for k in &starts {
        if !state.contains_key(k) {
            visit(k, &out, &mut state, &mut forward, &mut order);
        }
    }
    let mut column: HashMap<String, usize> = keys.iter().map(|k| (k.clone(), 0)).collect();
    for k in &order {
        for t in forward.get(k).into_iter().flatten() {
            let next = column[k] + 1;
            let e = column.entry(t.clone()).or_insert(0);
            *e = (*e).max(next);
        }
    }
    column.into_iter().map(|(k, c)| (k, c.min(COLUMNS_MAX - 1))).collect()
}

fn route_kind(from: &Card, to: &Card) -> RouteKind {
    if to.column == from.column + 1 {
        RouteKind::Next
    } else if to.column == from.column {
        RouteKind::Same
    } else if to.column > from.column {
        RouteKind::Skip
    } else {
        RouteKind::Back
    }
}

fn layout_memory(scene: &Value, states: &[SceneState], (bw, bh): (f64, f64)) -> Result<Layout, String> {
    let mut texts: Vec<String> = Vec::new();
    let mut note = |v: &Value| {
        if !is_pointer(v) {
            let t = js_string(v);
            if !texts.contains(&t) {
                texts.push(t);
            }
        }
    };
    for f in list(scene, "frames") {
        ordered_entries(f.get("vars")).iter().for_each(|(_, v)| note(v));
    }
    for o in list(scene, "objects") {
        ordered_entries(o.get("fields")).iter().for_each(|(_, v)| note(v));
    }
    for step in list(scene, "steps") {
        if let Some(set) = step.get("set") {
            ordered_entries(Some(set)).iter().for_each(|(_, v)| note(v));
        }
    }
    let values: HashMap<String, Fit> = texts
        .iter()
        .map(|t| (t.clone(), fit_text(t, &Slot::named("memoryValue", VALUE_MAX - 2.0 * VALUE_PAD))))
        .collect();
    let value_width = |key: &str| -> f64 {
        states
            .iter()
            .filter_map(|s| s.values.get(key))
            .map(|v| {
                if is_pointer(v) {
                    REF_W
                } else {
                    values.get(&js_string(v)).map_or(REF_W, |f| f.width + 2.0 * VALUE_PAD)
                }
            })
            .fold(REF_W, f64::max)
    };
    let card = |key: String, title: Fit, members: Option<&Value>, kind: &str, owner: &str| -> Card {
        let rows: Vec<Row> = ordered_entries(members)
            .iter()
            .enumerate()
            .map(|(i, (name, _))| Row {
                key: member_key(kind, owner, name),
                name: fit_text(name, &Slot::named("memoryName", 260.0)),
                y: HEAD_H + i as f64 * ROW_H,
            })
            .collect();
        let name_w = rows.iter().map(|r| r.name.width).fold(0.0, f64::max);
        let value_w = rows.iter().map(|r| value_width(&r.key)).fold(0.0, f64::max);
        let w = (title.width + 2.0 * PAD).max(PAD + name_w + NAME_GAP + value_w + PAD);
        Card {
            key,
            title,
            column: -1,
            x: 0.0,
            y: 0.0,
            w,
            h: HEAD_H + rows.len() as f64 * ROW_H + if rows.is_empty() { 0.0 } else { 10.0 },
            value_x: w - PAD - value_w,
            value_w,
            rows,
        }
    };
    let mut frames: Vec<Card> = list(scene, "frames")
        .iter()
        .map(|f| {
            let name = js_string(&f["name"]);
            card(format!("fr:{name}"), fit_text(&name, &Slot::named("frameName", 420.0)), f.get("vars"), "v", &name)
        })
        .collect();
    let mut objects: Vec<Card> = list(scene, "objects")
        .iter()
        .map(|o| {
            let id = js_string(&o["id"]);
            let title = o.get("type").and_then(Value::as_str).filter(|t| !t.is_empty()).unwrap_or(&id).to_string();
            card(format!("o:{id}"), fit_text(&title, &Slot::named("objectType", 360.0)), o.get("fields"), "f", &id)
        })
        .collect();

    let frames_w = frames.iter().map(|c| c.w).fold(0.0, f64::max);
    let mut y = PANEL_H;
    for c in &mut frames {
        let grow = frames_w - c.w;
        c.x = 0.0;
        c.y = y;
        c.w = frames_w;
        c.value_x += grow;
        y += c.h + CARD_GAP;
    }
    let column = columns(scene, states);
    let mut row_y: HashMap<String, f64> = HashMap::new();
    for c in &frames {
        for r in &c.rows {
            row_y.insert(r.key.clone(), c.y + r.y + ROW_H / 2.0);
        }
    }
    let objects_x = frames_w + if frames.is_empty() { 0.0 } else { MAIN_GAP };
    let mut x = objects_x;
    for col in 0..COLUMNS_MAX {
        let here: Vec<usize> = (0..objects.len()).filter(|&i| column[&objects[i].key] == col).collect();
        if here.is_empty() {
            continue;
        }
        let mean = |c: &Card| -> f64 {
            let ys: Vec<f64> = states
                .iter()
                .flat_map(|s| {
                    s.values
                        .iter()
                        .filter(|(key, v)| {
                            pointer_ref(v).is_some_and(|r| format!("o:{r}") == c.key) && row_y.contains_key(*key)
                        })
                        .map(|(key, _)| row_y[key])
                        .collect::<Vec<_>>()
                })
                .collect();
            if ys.is_empty() { f64::INFINITY } else { ys.iter().sum::<f64>() / ys.len() as f64 }
        };
        let mut order: Vec<(usize, usize, f64)> =
            here.iter().enumerate().map(|(i, &o)| (o, i, mean(&objects[o]))).collect();
        order.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
        let w = here.iter().map(|&i| objects[i].w).fold(0.0, f64::max);
        let mut top = PANEL_H;
        for (o, _, _) in order {
            let c = &mut objects[o];
            c.column = col as i64;
            c.x = x;
            c.y = top;
            c.value_x += w - c.w;
            c.w = w;
            top += c.h + CARD_GAP;
            for r in &c.rows {
                row_y.insert(r.key.clone(), c.y + r.y + ROW_H / 2.0);
            }
        }
        x += w + COL_GAP;
    }
    let cards: Vec<Card> = frames.into_iter().chain(objects).collect();
    let card_at: HashMap<String, usize> = cards.iter().enumerate().map(|(i, c)| (c.key.clone(), i)).collect();
    let cards_bottom = cards.iter().map(|c| c.y + c.h).fold(f64::MIN, f64::max);

    // Every reference any state shows that does not run straight into the next column gets a place of its own.
    let mut found: Vec<(String, String, String, RouteKind)> = Vec::new();
    for s in states {
        for (key, v) in s.values.iter() {
            let Some(r) = pointer_ref(v) else { continue };
            let target = format!("o:{r}");
            let (Some(&from), Some(&to)) = (card_at.get(&owner_of(key)), card_at.get(&target)) else {
                return Err(format!("{key} points at {r}, which is no object"));
            };
            let kind = route_kind(&cards[from], &cards[to]);
            let id = format!("{key}>{target}");
            if kind != RouteKind::Next && !found.iter().any(|f| f.0 == id) {
                found.push((id, key.clone(), target, kind));
            }
        }
    }
    let span = |key: &str, target: &str| (cards[card_at[&owner_of(key)]].x - cards[card_at[target]].x).abs();
    let mut routed = found;
    routed.sort_by(|a, b| span(&a.1, &a.2).partial_cmp(&span(&b.1, &b.2)).unwrap_or(std::cmp::Ordering::Equal));
    let mut lanes = 0i64;
    let mut routes = HashMap::new();
    for (place, (id, _, _, kind)) in routed.iter().enumerate() {
        let lane = if *kind == RouteKind::Same {
            -1
        } else {
            lanes += 1;
            lanes - 1
        };
        routes.insert(id.clone(), (place, lane));
    }
    let lane_y = cards_bottom + LANE_GAP;
    let height = if lanes > 0 { lane_y + (lanes - 1) as f64 * ROUTE_STEP + LANE_ROOM } else { cards_bottom };
    let rightmost = cards.iter().map(|c| c.x + c.w).fold(f64::MIN, f64::max);
    let width = frames_w.max(x - if objects_len(&cards) > 0 { COL_GAP } else { 0.0 }).max(if routed.is_empty() {
        0.0
    } else {
        rightmost + ROUTE_GAP + routed.len().min(ROUTES_PER_GAP) as f64 * ROUTE_STEP
    });
    let scale = SCALE_MAX.min(bw / width).min(bh / height);
    let row_at = cards
        .iter()
        .enumerate()
        .flat_map(|(ci, c)| c.rows.iter().enumerate().map(move |(ri, r)| (r.key.clone(), (ci, ri))))
        .collect();
    let has_frames = cards.iter().any(|c| c.column < 0);
    let has_objects = cards.iter().any(|c| c.column >= 0);
    Ok(Layout {
        frames_panel: has_frames.then(|| fit_text("Frames", &Slot::named("panelTitle", frames_w))),
        objects_panel: has_objects.then(|| fit_text("Objects", &Slot::named("panelTitle", 400.0))),
        objects_x,
        cards,
        card_at,
        row_at,
        values,
        routes,
        lane_y,
        width,
        height,
        scale,
    })
}

fn objects_len(cards: &[Card]) -> usize {
    cards.iter().filter(|c| c.column >= 0).count()
}

impl Layout {
    /// A row's value box: x, y, w, h.
    fn value_box(&self, key: &str) -> (f64, f64, f64, f64) {
        let (ci, ri) = self.row_at[key];
        let (c, r) = (&self.cards[ci], &self.cards[ci].rows[ri]);
        (c.x + c.value_x, c.y + r.y + 7.0, c.value_w, ROW_H - 14.0)
    }

    /// The arrow of each reference `state` shows, by its row key, from the dot in its value box.
    fn arrows_of(&self, state: &SceneState) -> Vec<(String, Arrow)> {
        struct Ref<'a> {
            key: &'a str,
            from: &'a Card,
            to: &'a Card,
            kind: RouteKind,
            side: &'static str,
            route: Option<(usize, i64)>,
        }
        let refs: Vec<Ref> = state
            .values
            .iter()
            .filter_map(|(key, v)| {
                let r = pointer_ref(v)?;
                let (ci, _) = *self.row_at.get(key)?;
                let from = &self.cards[ci];
                let to = &self.cards[*self.card_at.get(&format!("o:{r}"))?];
                let kind = route_kind(from, to);
                let lowest = !self.cards.iter().any(|c| !std::ptr::eq(c, to) && c.column == to.column && c.y > to.y);
                let side = if matches!(kind, RouteKind::Next | RouteKind::Skip) {
                    "left"
                } else if kind == RouteKind::Back && lowest {
                    "bottom"
                } else {
                    "right"
                };
                Some(Ref { key, from, to, kind, side, route: self.routes.get(&format!("{key}>{}", to.key)).copied() })
            })
            .collect();
        let dot = |key: &str| {
            let b = self.value_box(key);
            Pt { x: b.0 + b.2 / 2.0, y: b.1 + b.3 / 2.0 }
        };
        let mut out = Vec::new();
        for r in &refs {
            let start = dot(r.key);
            let mut peers: Vec<&str> =
                refs.iter().filter(|o| std::ptr::eq(o.to, r.to) && o.side == r.side).map(|o| o.key).collect();
            if r.side == "bottom" {
                peers.sort_by(|a, b| dot(b).x.partial_cmp(&dot(a).x).unwrap());
            } else {
                peers.sort_by(|a, b| dot(a).y.partial_cmp(&dot(b).y).unwrap());
            }
            let spread = peers.iter().position(|k| *k == r.key).unwrap_or(0) as f64 - (peers.len() as f64 - 1.0) / 2.0;
            let ty = r.to.y + HEAD_H / 2.0 + spread * END_GAP;
            let (from, to) = (r.from, r.to);
            if r.kind == RouteKind::Next {
                let reach = 60f64.max((to.x - start.x) * 0.5);
                out.push((
                    r.key.to_string(),
                    Arrow {
                        points: padded(vec![
                            start,
                            Pt { x: start.x + reach, y: start.y },
                            Pt { x: to.x - reach, y: ty },
                            Pt { x: to.x, y: ty },
                        ]),
                    },
                ));
                continue;
            }
            let (place, lane_no) = r.route.unwrap_or((0, 0));
            let offset = ROUTE_GAP + (place % ROUTES_PER_GAP) as f64 * ROUTE_STEP;
            let gx = from.x + from.w + offset;
            let lane = self.lane_y + lane_no as f64 * ROUTE_STEP;
            let tx = to.x + to.w / 2.0 + spread * 2.0 * END_GAP;
            let turns: Vec<Pt> = if r.kind == RouteKind::Same {
                vec![start, Pt { x: gx, y: start.y }, Pt { x: gx, y: ty }, Pt { x: to.x + to.w, y: ty }]
            } else if r.side == "bottom" {
                vec![
                    start,
                    Pt { x: gx, y: start.y },
                    Pt { x: gx, y: lane },
                    Pt { x: tx, y: lane },
                    Pt { x: tx, y: to.y + to.h },
                ]
            } else {
                let mut t = vec![start, Pt { x: gx, y: start.y }, Pt { x: gx, y: lane }];
                let (edge, x) =
                    if r.side == "left" { (to.x, to.x - offset) } else { (to.x + to.w, to.x + to.w + offset) };
                t.extend([Pt { x, y: lane }, Pt { x, y: ty }, Pt { x: edge, y: ty }]);
                t
            };
            out.push((r.key.to_string(), Arrow { points: padded(rounded(&turns)) }));
        }
        out
    }
}

fn mix(a: Pt, b: Pt, t: f64) -> Pt {
    Pt { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

fn dist(a: Pt, b: Pt) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}

/// Straight runs through `turns`, each corner rounded, as an arrow's points.
fn rounded(turns: &[Pt]) -> Vec<Pt> {
    let mut out = vec![turns[0]];
    let line = |out: &mut Vec<Pt>, a: Pt, b: Pt| out.extend([mix(a, b, 1.0 / 3.0), mix(a, b, 2.0 / 3.0), b]);
    let mut at = turns[0];
    for i in 1..turns.len() - 1 {
        let (prev, corner, next) = (turns[i - 1], turns[i], turns[i + 1]);
        let r = CORNER.min(dist(prev, corner) / 2.0).min(dist(corner, next) / 2.0);
        let a = mix(corner, prev, r / if dist(prev, corner) == 0.0 { 1.0 } else { dist(prev, corner) });
        let b = mix(corner, next, r / if dist(corner, next) == 0.0 { 1.0 } else { dist(corner, next) });
        line(&mut out, at, a);
        out.extend([mix(a, corner, 0.55), mix(b, corner, 0.55), b]);
        at = b;
    }
    line(&mut out, at, *turns.last().unwrap());
    out
}

/// `points` with still segments at its start, up to SEGMENTS.
fn padded(points: Vec<Pt>) -> Vec<Pt> {
    let still = 3 * (SEGMENTS - (points.len() - 1) / 3);
    let mut out = vec![points[0]];
    out.extend(std::iter::repeat_n(points[0], still));
    out.extend(points.into_iter().skip(1));
    out
}

/// Points along an arrow's curves, which a note should rather not cross (`arrowSamples`).
fn arrow_samples(a: &Arrow) -> Vec<MPt> {
    let mut out = Vec::new();
    let p = &a.points;
    let mut i = 0;
    while i + 3 < p.len() {
        let (p0, c1, c2, p1) = (p[i], p[i + 1], p[i + 2], p[i + 3]);
        i += 3;
        let same = |a: Pt, b: Pt| a.x == b.x && a.y == b.y;
        if same(p0, p1) && same(p0, c1) {
            continue;
        }
        for t in [0.25, 0.5, 0.75, 1.0] {
            let u = 1.0 - t;
            let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
            out.push(MPt {
                x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
                y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
            });
        }
    }
    out
}

impl Layout {
    /// The box of each item a step can focus, as `state` shows it: a frame's or object's card and a variable's or
    /// field's row. A note keeps off the cards and the arrows (`memoryBoxes`).
    fn boxes(&self, state: &SceneState) -> LayoutBoxes {
        let mut out = LayoutBoxes::default();
        let shown: Vec<&Card> = self.cards.iter().filter(|c| !state.hidden.contains(&c.key)).collect();
        for c in &shown {
            out.add(c.key.clone(), Bx::new(c.x, c.y, c.w, c.h));
            for r in &c.rows {
                out.add(r.key.clone(), Bx::new(c.x + 6.0, c.y + r.y, c.w - 12.0, ROW_H));
            }
        }
        out.lines = self
            .arrows_of(state)
            .iter()
            .filter(|(k, _)| out.boxes.iter().any(|(b, _)| b == k))
            .flat_map(|(_, a)| arrow_samples(a))
            .collect();
        out.obstacles = Some(shown.iter().map(|c| Bx::new(c.x, c.y, c.w, c.h)).collect());
        out
    }
}

struct MemoryView {
    shell: Shell,
    layout: Layout,
    states: Vec<SceneState>,
    targets: HashMap<String, Vec<usize>>,
    callout: Option<HeaderCallout>,
    box_size: (f64, f64),
    marks: Vec<MarkTargets>,
    board: Board,
    camera: Camera,
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene = input.scene;
    let shell = Shell::new(scene);
    let box_size = header_box(scene);
    let states = walk_states(&arrays::Model(scene), scene);
    let layout = layout_memory(scene, &states, box_size)?;
    let stage = Stage::centred(box_size, (layout.width, layout.height), layout.scale);
    let marks: Vec<MarkTargets> = states[1..].iter().map(|st| stage.targets(&layout.boxes(st), box_size)).collect();
    let refs = crate::scenes::refs::SceneRefs(scene);
    let step_refs = StepRefs::Scene(&refs);
    let board = Board::new(scene, input.segments, &step_refs, &|k| marks.get(k).cloned(), &|_| None);
    let camera = Camera::new(scene, &step_refs, box_size);
    Ok(Box::new(MemoryView {
        marks,
        board,
        camera,
        targets: target_steps(scene),
        callout: HeaderCallout::new(scene),
        shell,
        layout,
        states,
        box_size,
    }))
}

fn rgba(r: u8, g: u8, b: u8, a: f64) -> Color {
    Color::rgba8(r, g, b, a as f32)
}

/// A drawn arrow: where, how much of it, how bright, which colour.
struct Drawn {
    key: String,
    points: Vec<Pt>,
    progress: f64,
    opacity: f64,
    color: Color,
    width: f64,
    glow: f64,
}

/// The arrow's curve flattened, cut at `progress` of its length.
fn cut_path(points: &[Pt], progress: f64) -> Option<crate::display::Path> {
    let mut poly = vec![points[0]];
    for seg in points[1..].chunks(3) {
        if seg.len() < 3 {
            break;
        }
        let p0 = *poly.last().unwrap();
        for i in 1..=24 {
            let t = f64::from(i) / 24.0;
            let u = 1.0 - t;
            poly.push(Pt {
                x: u * u * u * p0.x + 3.0 * u * u * t * seg[0].x + 3.0 * u * t * t * seg[1].x + t * t * t * seg[2].x,
                y: u * u * u * p0.y + 3.0 * u * u * t * seg[0].y + 3.0 * u * t * t * seg[1].y + t * t * t * seg[2].y,
            });
        }
    }
    let total: f64 = poly.windows(2).map(|w| dist(w[0], w[1])).sum();
    let limit = total * progress.clamp(0.0, 1.0);
    let mut pb = PathBuilder::new();
    pb.move_to(poly[0].x as f32, poly[0].y as f32);
    let mut run = 0.0;
    for w in poly.windows(2) {
        let d = dist(w[0], w[1]);
        if run + d >= limit {
            let end = if d == 0.0 { w[1] } else { mix(w[0], w[1], (limit - run) / d) };
            pb.line_to(end.x as f32, end.y as f32);
            return pb.finish();
        }
        run += d;
        pb.line_to(w[1].x as f32, w[1].y as f32);
    }
    pb.finish()
}

impl MemoryView {
    fn line(&self, dl: &mut DisplayList, d: &Drawn) {
        let Some(path) = cut_path(&d.points, d.progress) else { return };
        if d.glow > 0.0 {
            // drop-shadow(0 0 6px accentGlow)
            for (extra, a) in [(9.0, 0.25), (5.0, 0.35)] {
                dl.path(
                    path.clone(),
                    None,
                    Some(Stroke::solid(ACCENT_GLOW.fade(a), (d.width + extra) as f32).rounded()),
                );
            }
        }
        dl.path(path, None, Some(Stroke::solid(d.color, d.width as f32).rounded()));
    }

    fn row(&self, dl: &mut DisplayList, ci: usize, ri: usize, s: &StateFrame, e: Emphasis) {
        let l = &self.layout;
        let card = &l.cards[ci];
        let row = &card.rows[ri];
        let changed = s.value_changed(&row.key);
        let lit = if changed { s.lit } else { 0.0 };
        let (vx, vy, vw, vh) = l.value_box(&row.key);
        // Everything inside a card is placed from its padding box, 1.5px in from the border.
        let (ox, oy) = (card.x + 1.5, card.y + 1.5);
        let (was, now) = (s.before.values.get(&row.key), s.now.values.get(&row.key));
        let dot = if e.glow > 0.0 {
            ACCENT
        } else if lit > 0.0 {
            TEXT
        } else {
            arrow_color()
        };
        if e.glow > 0.0 {
            dl.rect(
                (ox + 6.0) as f32,
                (oy + row.y) as f32,
                (card.w - 3.0 - 12.0) as f32,
                ROW_H as f32,
                BoxStyle::fill(rgba(124, 140, 255, 0.14 * e.glow))
                    .radius(10.0)
                    .border(ACCENT.alpha(hex_alpha(0.8 * e.glow)), 2.0),
            );
        }
        let nh = f64::from(fit_height(&row.name, LineHeight::Fit));
        let _ = nh;
        draw_fit(
            dl,
            &row.name,
            (ox + 18.0) as f32,
            (oy + row.y + (ROW_H - row.name.height) / 2.0) as f32,
            TextOpts::new(if e.glow > 0.0 { TEXT } else { MUTED }),
        );
        let (bx, by) = (ox + card.value_x, oy + row.y + 7.0);
        debug_assert!((bx - 1.5 - vx).abs() < 1e-6 && (by - 1.5 - vy).abs() < 1e-6);
        let mut style = BoxStyle::fill(rgba(255, 255, 255, 0.045 + 0.12 * lit))
            .radius(8.0)
            .border(if lit > 0.0 { rgba(242, 244, 248, 0.3 + 0.6 * lit) } else { BORDER }, 1.5);
        if lit > 0.0 {
            style = style.shadow(Shadow::new(0.0, 0.0, (30.0 * lit) as f32, rgba(242, 244, 248, 0.35 * lit)));
        }
        dl.rect(bx as f32, by as f32, vw as f32, vh as f32, style);
        dl.push_clip((bx + 1.5) as f32, (by + 1.5) as f32, (vw - 3.0) as f32, (vh - 3.0) as f32, 6.5);
        let inner = (bx + 1.5, by + 1.5, vw - 3.0, vh - 3.0);
        let content = |dl: &mut DisplayList, v: Option<&Value>, opacity: f64, shift: f64| {
            let Some(v) = v else { return };
            if opacity <= 0.0 {
                return;
            }
            if is_pointer(v) {
                dl.group(|dl| {
                    dl.fade(opacity as f32);
                    dl.circle((inner.0 + inner.2 / 2.0) as f32, (inner.1 + inner.3 / 2.0) as f32, 7.0, dot);
                });
            } else if let Some(fit) = l.values.get(&js_string(v)) {
                dl.group(|dl| {
                    dl.fade(opacity as f32);
                    dl.translate(0.0, (shift * ROW_H) as f32);
                    let fh = f64::from(fit_height(fit, LineHeight::Fit));
                    // A flex-centred block: a line left aligned in it ends up centred on the box.
                    draw_fit(
                        dl,
                        fit,
                        (inner.0 + (inner.2 - fit.width) / 2.0) as f32,
                        (inner.1 + (inner.3 - fh) / 2.0) as f32,
                        TextOpts::new(TEXT),
                    );
                });
            }
        };
        if changed {
            content(dl, was, 1.0 - s.t, -0.5 * s.t);
            content(dl, now, s.t, 0.5 * (1.0 - s.t));
        } else {
            content(dl, now, 1.0, 0.0);
        }
        dl.pop_clip();
    }

    #[allow(clippy::too_many_arguments)]
    fn card(
        &self,
        dl: &mut DisplayList,
        ci: usize,
        s: &StateFrame,
        shown: f64,
        e: Emphasis,
        row_emphasis: &dyn Fn(&str) -> Emphasis,
    ) {
        if shown <= 0.0 {
            return;
        }
        let c = &self.layout.cards[ci];
        let frame = c.column < 0;
        let accent = if frame { ACCENT } else { Color::css("#c9a8ff") };
        let (x, y, w, h) = (c.x as f32, c.y as f32, c.w as f32, c.h as f32);
        dl.group(|dl| {
            dl.fade((shown * e.opacity) as f32);
            dl.translate(0.0, ((1.0 - shown) * 20.0) as f32);
            dl.scale_about((1.0 + 0.015 * e.glow) as f32, x + w / 2.0, y + h / 2.0);
            let mut style = BoxStyle::fill(RAISED)
                .radius(16.0)
                .border(if e.glow > 0.0 { accent } else { BORDER_STRONG }, 1.5)
                .shadow(Shadow::new(0.0, 14.0, 36.0, rgba(0, 0, 0, 0.45)));
            if e.glow > 0.0 {
                let mut ring = Shadow::new(0.0, 0.0, 0.0, accent);
                ring.spread = (3.0 * e.glow) as f32;
                style = style.shadow(ring).shadow(Shadow::new(
                    0.0,
                    0.0,
                    (40.0 * e.glow) as f32,
                    accent.alpha(hex_alpha(0.4 * e.glow)),
                ));
            }
            dl.rect(x, y, w, h, style);
            // The header: a background rounded at the top, and a line under it.
            let head = if frame { rgba(124, 140, 255, 0.1) } else { rgba(201, 168, 255, 0.1) };
            dl.push_clip(x + 1.5, y + 1.5, w - 3.0, HEAD_H as f32, 0.0);
            dl.rect(x + 1.5, y + 1.5, w - 3.0, HEAD_H as f32 + 20.0, BoxStyle::fill(head).radius(16.0));
            dl.pop_clip();
            dl.fill_rect(x + 1.5, y + 1.5 + HEAD_H as f32, w - 3.0, 1.0, BORDER);
            draw_fit(
                dl,
                &c.title,
                x + 1.5 + 18.0,
                y + 1.5 + ((HEAD_H - c.title.height) / 2.0) as f32,
                TextOpts::new(accent),
            );
            for ri in 0..c.rows.len() {
                self.row(dl, ci, ri, s, row_emphasis(&c.rows[ri].key));
            }
        });
    }
}

impl SceneView for MemoryView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let l = &self.layout;
        let s = StateFrame::at(&self.states, f.segments, frame);
        let focus = FocusSpotlight::borrowed(&self.targets, f.segments, frame);
        let (bw, bh) = self.box_size;
        let stage = ((bw - l.width * l.scale) / 2.0, (bh - l.height * l.scale) / 2.0);

        let landed = |key: &str| {
            spring(
                frame - START - l.card_at[key] as f64 * CARD_STAGGER,
                FPS,
                Spring::damping(17.0).with_stiffness(130.0),
            )
        };
        let shown = |key: &str| s.shown(key) * landed(key);
        let row_emphasis = |key: &str| brighter(focus.emphasis(key), focus.emphasis(&owner_of(key)));

        // Where each arrow is drawn: between its old and new object while the step re-routes it.
        let before = l.arrows_of(s.before);
        let now = l.arrows_of(s.now);
        let mut keys: Vec<&String> = before.iter().map(|(k, _)| k).collect();
        for (k, _) in &now {
            if !keys.contains(&k) {
                keys.push(k);
            }
        }
        let target =
            |st: &SceneState, key: &str| format!("o:{}", st.values.get(key).and_then(pointer_ref).unwrap_or_default());
        struct Raw {
            key: String,
            points: Vec<Pt>,
            progress: f64,
            opacity: f64,
            target: String,
        }
        let raws: Vec<Raw> = keys
            .iter()
            .map(|key| {
                let a = before.iter().find(|(k, _)| k == *key).map(|(_, a)| a);
                let b = now.iter().find(|(k, _)| k == *key).map(|(_, a)| a);
                let owner = shown(&owner_of(key));
                match (a, b) {
                    (Some(a), Some(b)) => {
                        let (ta, tb) = (target(s.before, key), target(s.now, key));
                        let seen = shown(&ta) * (1.0 - s.t) + shown(&tb) * s.t;
                        Raw {
                            key: (*key).clone(),
                            points: a.points.iter().zip(&b.points).map(|(p, q)| mix(*p, *q, s.t)).collect(),
                            progress: 1.0,
                            opacity: owner * if ta == tb { shown(&tb) } else { seen.max(0.6) },
                            target: tb,
                        }
                    }
                    (None, Some(b)) => Raw {
                        key: (*key).clone(),
                        points: b.points.clone(),
                        progress: s.t,
                        opacity: owner * shown(&target(s.now, key)),
                        target: target(s.now, key),
                    },
                    (a, None) => Raw {
                        key: (*key).clone(),
                        points: a.expect("an arrow").points.clone(),
                        progress: 1.0,
                        opacity: owner * (1.0 - s.t),
                        target: target(s.before, key),
                    },
                }
            })
            .collect();
        let draw_in = interpolate(frame, &[ARROWS_AT, ARROWS_AT + ARROW_FRAMES], &[0.0, 1.0], CLAMP);
        let card_emphasis = |ci: usize| -> Emphasis {
            let c = &l.cards[ci];
            let mut others: Vec<Emphasis> = c.rows.iter().map(|r| focus.emphasis(&r.key)).collect();
            others.extend(raws.iter().filter(|a| a.target == c.key).map(|a| row_emphasis(&a.key)));
            as_bright_as(focus.emphasis(&c.key), &others)
        };
        let drawn: Vec<Drawn> = raws
            .iter()
            .filter_map(|d| {
                let e = brighter(row_emphasis(&d.key), Emphasis { opacity: 0.0, ..focus.emphasis(&d.target) });
                let changed = if s.value_changed(&d.key) { s.lit } else { 0.0 };
                let out = Drawn {
                    progress: d.progress * draw_in,
                    opacity: d.opacity * e.opacity,
                    color: if e.glow > 0.0 {
                        ACCENT
                    } else if changed > 0.0 {
                        TEXT
                    } else {
                        arrow_color()
                    },
                    width: 2.5 + 1.5 * e.glow.max(changed),
                    glow: e.glow,
                    key: d.key.clone(),
                    points: d.points.clone(),
                };
                (out.progress > 0.0 && out.opacity > 0.0).then_some(out)
            })
            .collect();
        let panel_in = interpolate(frame, &[START, START + 10.0], &[0.0, 1.0], CLAMP);

        let aside_draw = |dl: &mut DisplayList, right: f32, top: f32| {
            if let Some(c) = &self.callout {
                c.draw(dl, right, top, &s);
            }
        };
        let aside = self.callout.as_ref().map(|c| c.aside(&aside_draw));
        let view = self.camera.view(frame, f.segments, &|k| self.marks.get(k).cloned());
        self.shell.draw(dl, frame, f.duration, aside, |dl, _| {
            self.camera.draw(dl, view, |dl| {
                dl.save();
                dl.translate(stage.0 as f32, stage.1 as f32);
                dl.scale_about(l.scale as f32, 0.0, 0.0);
                if let Some(p) = &l.frames_panel {
                    dl.group(|dl| {
                        dl.fade(panel_in as f32);
                        draw_fit(dl, p, 4.0, 4.0, TextOpts::new(FAINT));
                    });
                }
                if let Some(p) = &l.objects_panel {
                    dl.group(|dl| {
                        dl.fade(panel_in as f32);
                        draw_fit(dl, p, (l.objects_x + 4.0) as f32, 4.0, TextOpts::new(FAINT));
                    });
                }
                // Arrows run under the cards, with a dark halo so they read against what they cross.
                for d in &drawn {
                    dl.group(|dl| {
                        dl.fade(d.opacity as f32);
                        if let Some(p) = cut_path(&d.points, d.progress) {
                            dl.path(p, None, Some(Stroke::solid(BG.fade(0.7), 7.0)));
                        }
                        self.line(dl, d);
                    });
                }
                for c in &l.cards {
                    let amount = shown(&c.key);
                    if amount > 0.0 {
                        dl.group(|dl| {
                            dl.fade(amount as f32);
                            dl.translate(0.0, ((1.0 - amount) * 20.0) as f32);
                            dl.rect(c.x as f32, c.y as f32, c.w as f32, c.h as f32, BoxStyle::fill(BG).radius(16.0));
                        });
                    }
                }
                for ci in 0..l.cards.len() {
                    self.card(dl, ci, &s, shown(&l.cards[ci].key), card_emphasis(ci), &row_emphasis);
                }
                // Over the cards again: the stub of each arrow inside the card it leaves, and its head.
                for d in &drawn {
                    let (ci, _) = l.row_at[&d.key];
                    let src = &l.cards[ci];
                    dl.group(|dl| {
                        dl.fade(d.opacity as f32);
                        dl.push_clip(src.x as f32, src.y as f32, src.w as f32, src.h as f32, 0.0);
                        self.line(dl, d);
                        dl.pop_clip();
                        if d.progress >= 0.98 {
                            let n = d.points.len();
                            let (c2, to) = (d.points[n - 2], d.points[n - 1]);
                            let angle = (to.y - c2.y).atan2(to.x - c2.x);
                            let head = |side: f64| {
                                (
                                    (to.x - 14.0 * (angle + side * 0.45).cos()) as f32,
                                    (to.y - 14.0 * (angle + side * 0.45).sin()) as f32,
                                )
                            };
                            let mut pb = PathBuilder::new();
                            let (a, b) = (head(1.0), head(-1.0));
                            pb.move_to(a.0, a.1);
                            pb.line_to(to.x as f32, to.y as f32);
                            pb.line_to(b.0, b.1);
                            pb.close();
                            if let Some(p) = pb.finish() {
                                dl.path(p, Some(Paint::from(d.color)), Some(Stroke::solid(d.color, 1.5).rounded()));
                            }
                        }
                    });
                }
                dl.restore();
                self.board.draw(dl, frame, f.segments, &|_| None);
            })
        });
    }
}
