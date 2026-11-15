//! A graph scene's states: its initial state with the changes of steps 0 to k applied in order (the `graph` model of
//! shared/state-steps.mjs), where a scene is, between states, at a frame (src/utils/stateTrack.ts), and how a tinted
//! item looks partway through a step (src/utils/tint.ts).

use crate::anim::{CLAMP, interpolate};
use crate::color::Color;
use crate::graph_targets::{Ref, ambiguous_index, resolve_ref};
use crate::steps::{current_step, step_move};
use crate::theme::tone;
use crate::timing::{STEP_SETTLE_FRAMES, Segment};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Frames a changed item stays lit once it has settled, fading out as the step's words go on.
const LIT_FRAMES: f64 = 40.0;

/// A value a step sets: text, or a table cell that strikes an old value beside a new one.
#[derive(Clone, Debug, PartialEq)]
pub enum Val {
    Text(String),
    Change(String, String),
}

/// The colours a `tint` takes: a tone, "dim", or "clear" to take the colour off.
const TINTS: [&str; 7] = ["neutral", "accent", "good", "bad", "warn", "dim", "clear"];

#[derive(Clone, Debug, Default)]
pub struct SceneState {
    pub values: HashMap<String, Val>,
    pub hidden: HashSet<String>,
    pub tints: HashMap<String, String>,
    pub callout: String,
}

fn list<'a>(v: &'a Value, field: &str) -> &'a [Value] {
    v.get(field).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// A JS scalar as text, `String(v)`.
fn scalar(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// A table cell as a value: text, or `{ before, after }`.
pub fn cell_val(v: &Value) -> Option<Val> {
    match v {
        Value::Object(o) if o.len() == 2 => match (o.get("before"), o.get("after")) {
            (Some(Value::String(a)), Some(Value::String(b))) => Some(Val::Change(a.clone(), b.clone())),
            _ => None,
        },
        Value::String(s) => Some(Val::Text(s.clone())),
        _ => None,
    }
}

/// A `tint` as [ref, tint] pairs in the order written, from pairs or an object (`tintEntries`).
pub fn tint_entries(v: Option<&Value>) -> Vec<(String, String)> {
    match v {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|p| {
                let p = p.as_array()?;
                Some((p.first()?.as_str()?.to_string(), scalar(p.get(1)?)?))
            })
            .collect(),
        Some(Value::Object(o)) => o.iter().filter_map(|(k, v)| Some((k.clone(), scalar(v)?))).collect(),
        _ => Vec::new(),
    }
}

/// The one item key `r` names, when it is of a kind in `prefixes`.
fn one_key(scene: &Value, r: &Ref, prefixes: &[&str]) -> Option<String> {
    let keys = resolve_ref(scene, r)?;
    (keys.len() == 1 && prefixes.iter().any(|p| keys[0].starts_with(p))).then(|| keys[0].clone())
}

fn apply_tints(scene: &Value, record: Option<&Value>, next: &mut SceneState) {
    const PREFIXES: [&str; 5] = ["n:", "e:", "g:", "r:", "x:"];
    for (r, tint) in tint_entries(record) {
        let rf = Ref::Text(r);
        if ambiguous_index(scene, &rf) {
            continue;
        }
        let Some(keys) = resolve_ref(scene, &rf).filter(|k| !k.is_empty()) else { continue };
        if !keys.iter().all(|k| PREFIXES.iter().any(|p| k.starts_with(p))) || !TINTS.contains(&tint.as_str()) {
            continue;
        }
        let expanded: Vec<String> = keys
            .into_iter()
            .flat_map(|k| {
                if k.starts_with("g:") {
                    list(scene, "nodes")
                        .iter()
                        .filter(|n| n.get("group").and_then(Value::as_str).is_some_and(|g| format!("g:{g}") == k))
                        .filter_map(|n| n.get("id").and_then(Value::as_str).map(|id| format!("n:{id}")))
                        .collect()
                } else {
                    vec![k]
                }
            })
            .collect();
        for key in expanded {
            if tint == "clear" {
                next.tints.remove(&key);
            } else {
                next.tints.insert(key, tint.clone());
            }
        }
    }
}

/// Every state of a graph scene: `[initial, during step 0, during step 1, ...]`.
pub fn graph_states(scene: &Value) -> Vec<SceneState> {
    let nodes = list(scene, "nodes");
    let table = scene.get("table").filter(|t| !t.is_null());
    let mut state = SceneState {
        callout: scene.get("callout").and_then(Value::as_str).unwrap_or("").to_string(),
        ..Default::default()
    };
    for n in nodes {
        if let Some(id) = n.get("id").and_then(Value::as_str) {
            let badge = n.get("badge").and_then(scalar).unwrap_or_default();
            state.values.insert(format!("b:{id}"), Val::Text(badge));
            if n.get("hidden") == Some(&Value::Bool(true)) {
                state.hidden.insert(format!("n:{id}"));
            }
        }
    }
    for (i, e) in list(scene, "edges").iter().enumerate() {
        if e.get("hidden") == Some(&Value::Bool(true)) {
            state.hidden.insert(format!("e:{i}"));
        }
    }
    if let Some(t) = table {
        let columns = list(t, "columns").len();
        for (i, row) in list(t, "rows").iter().enumerate() {
            let cells = list(row, "cells");
            for c in 0..columns {
                let v = cells.get(c).and_then(cell_val).unwrap_or(Val::Text(String::new()));
                state.values.insert(format!("x:{i}/{c}"), v);
            }
            if row.get("hidden") == Some(&Value::Bool(true)) {
                state.hidden.insert(format!("r:{i}"));
            }
        }
    }
    apply_tints(scene, scene.get("tint"), &mut state);
    let mut states = vec![state.clone()];
    for step in list(scene, "steps") {
        let mut next = state.clone();
        if let Some(Value::Object(set)) = step.get("set") {
            for (r, value) in set {
                let Some(named) = one_key(scene, &Ref::Text(r.clone()), &["n:", "x:"]) else { continue };
                let key = named.strip_prefix("n:").map_or(named.clone(), |id| format!("b:{id}"));
                let ok = if key.starts_with("b:") { scalar(value).map(Val::Text) } else { cell_val(value) };
                if let Some(v) = ok {
                    next.values.insert(key, v);
                }
            }
        }
        for field in ["show", "hide"] {
            let Some(Value::Array(refs)) = step.get(field) else { continue };
            for r in refs.iter().filter_map(Ref::from_value) {
                if ambiguous_index(scene, &r) {
                    continue;
                }
                let Some(key) = one_key(scene, &r, &["n:", "e:", "r:"]) else { continue };
                if field == "show" {
                    next.hidden.remove(&key);
                } else {
                    next.hidden.insert(key);
                }
            }
        }
        apply_tints(scene, step.get("tint"), &mut next);
        if let Some(c) = step.get("callout").and_then(Value::as_str) {
            next.callout = c.to_string();
        }
        states.push(next.clone());
        state = next;
    }
    states
}

/// Where a state scene is at a frame: the state of the current step and the one before its changes, how far the
/// changes have gone (`t`, 1 once settled), and the glow on what the step changed, brightest as it settles.
pub struct StateFrame<'a> {
    pub before: &'a SceneState,
    pub now: &'a SceneState,
    pub before_index: usize,
    pub now_index: usize,
    pub t: f64,
    pub lit: f64,
}

pub fn state_frame<'a>(states: &'a [SceneState], segments: &[Segment], frame: f64) -> StateFrame<'a> {
    match current_step(segments, frame) {
        Some(k) if k + 1 < states.len() => {
            let from = segments[k + 1].from;
            let settled = from + STEP_SETTLE_FRAMES;
            StateFrame {
                before: &states[k],
                now: &states[k + 1],
                before_index: k,
                now_index: k + 1,
                t: step_move(frame, from),
                lit: interpolate(frame, &[from, settled, settled + LIT_FRAMES], &[0.0, 1.0, 0.0], CLAMP),
            }
        }
        _ => StateFrame { before: &states[0], now: &states[0], before_index: 0, now_index: 0, t: 1.0, lit: 0.0 },
    }
}

impl StateFrame<'_> {
    /// How shown an item is, 0 to 1, fading in or out with the step that shows or hides it (`shownOf`).
    pub fn shown(&self, key: &str) -> f64 {
        let was = if self.before.hidden.contains(key) { 0.0 } else { 1.0 };
        let is = if self.now.hidden.contains(key) { 0.0 } else { 1.0 };
        was + (is - was) * self.t
    }

    /// Whether the current step changed the value under `key` (`valueChanged`).
    pub fn value_changed(&self, key: &str) -> bool {
        self.before.values.get(key) != self.now.values.get(key)
    }

    /// The tint under `key`, blending from the one before the step to the one it sets (`tintMix`).
    pub fn tint(&self, key: &str) -> TintMix {
        let (was, now) = (self.before.tints.get(key), self.now.tints.get(key));
        let dim_of = |t: Option<&String>| if t.is_some_and(|t| t == "dim") { 1.0 } else { 0.0 };
        let dim = dim_of(was) + (dim_of(now) - dim_of(was)) * self.t;
        let tone_of = |t: Option<&String>| t.filter(|t| *t != "dim").cloned();
        let (a, b) = (tone_of(was), tone_of(now));
        if a == b {
            return TintMix { tones: a.into_iter().map(|t| (t, 1.0)).collect(), dim };
        }
        let mut tones = Vec::new();
        if let Some(a) = a {
            tones.push((a, 1.0 - self.t));
        }
        if let Some(b) = b {
            tones.push((b, self.t));
        }
        TintMix { tones, dim }
    }
}

/// How a tinted item looks partway through a step: each tone's share of its fill, and how far it has faded as ruled out.
#[derive(Clone, Debug, Default)]
pub struct TintMix {
    pub tones: Vec<(String, f64)>,
    pub dim: f64,
}

impl TintMix {
    /// The strongest tone in a mix, for a border or a label (`mainTone`).
    pub fn main(&self) -> Option<&str> {
        let mut best: Option<&(String, f64)> = None;
        for t in &self.tones {
            if best.is_none_or(|b| t.1 > b.1) {
                best = Some(t);
            }
        }
        best.map(|t| t.0.as_str())
    }

    /// Opacity a dimmed item keeps (`dimOpacity`): ruled out, it recedes but stays readable.
    pub fn dim_opacity(&self) -> f64 {
        1.0 - 0.5 * self.dim
    }
}

/// A tone's fill on a tinted item (`tintFill`: its colour at 0x40 alpha).
pub fn tint_fill(name: &str) -> Color {
    tone(name).0.alpha(64.0 / 255.0)
}
