//! A scene's state at each step: its initial state with the changes of steps 0 to k applied in order. A port of
//! `walkStates` in shared/state-steps.mjs for the scenes that draw it here (svg, map), without the problem reports.
//! State keys are the item keys of shared/targets.mjs, so the item a step changes and the item it focuses share a name.

#![allow(clippy::type_complexity)]

use crate::timing::{STEP_SETTLE_FRAMES, Segment};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// The colours a `tint` takes: a tone, "dim", or "clear" to take the colour off.
pub const TINTS: &[&str] = &["neutral", "accent", "good", "bad", "warn", "dim", "clear"];

#[derive(Clone, Debug, Default)]
pub struct SceneState {
    pub values: HashMap<String, Value>,
    pub hidden: HashSet<String>,
    pub tints: HashMap<String, String>,
    pub callout: String,
    /// A moved element's transform, by item key.
    pub transforms: HashMap<String, String>,
    /// A morphed path's target id, by item key.
    pub shapes: HashMap<String, String>,
    /// The lines this step traces, by item key, with the words they start or end on.
    pub traces: HashMap<String, Option<String>>,
    /// The moves this step plays across its words, with the words they start on.
    pub spans: HashMap<String, Option<String>>,
}

/// What a scene type tells the walker about its items.
pub struct StateModel<'a> {
    pub initial_values: HashMap<String, Value>,
    pub initial_hidden: HashSet<String>,
    /// The item keys a ref names.
    pub resolve: &'a dyn Fn(&Value) -> Vec<String>,
    pub set_prefixes: &'a [&'a str],
    pub show_prefixes: &'a [&'a str],
    pub tint_prefixes: &'a [&'a str],
    /// Whether a set value is acceptable for a key.
    pub check_value: &'a dyn Fn(&str, &Value) -> bool,
    /// The key a trace ref draws, when it can be traced.
    pub trace_key: &'a dyn Fn(&Value) -> Option<String>,
    /// For an svg scene: the key a move names, or None.
    pub move_key: Option<&'a dyn Fn(&str) -> Option<String>>,
    /// For an svg scene: a morph's own d and a target's d, by id, so a pair that cannot morph is skipped.
    pub morph: Option<&'a dyn Fn(&SceneState, &str, &str) -> bool>,
}

fn one_key(model: &StateModel, r: &Value, prefixes: &[&str]) -> Option<String> {
    let keys = (model.resolve)(r);
    (keys.len() == 1 && prefixes.iter().any(|p| keys[0].starts_with(p))).then(|| keys[0].clone())
}

fn same(a: Option<&Value>, b: &Value) -> bool {
    let text = |v: &Value| match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    a.is_some_and(|a| text(a) == text(b))
}

fn entries(v: &Value) -> Vec<(String, Value)> {
    match v {
        Value::Object(o) => o.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        Value::Array(a) => a
            .iter()
            .filter_map(|p| match p.as_array().map(Vec::as_slice) {
                Some([Value::String(k), v]) => Some((k.clone(), v.clone())),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn apply_tints(model: &StateModel, record: &Value, next: &mut SceneState) {
    for (r, tint) in entries(record) {
        let keys = (model.resolve)(&Value::String(r));
        if keys.is_empty() || !keys.iter().all(|k| model.tint_prefixes.iter().any(|p| k.starts_with(p))) {
            continue;
        }
        let Some(tint) = tint.as_str().filter(|t| TINTS.contains(t)) else { continue };
        for key in keys {
            if tint == "clear" {
                next.tints.remove(&key);
            } else {
                next.tints.insert(key, tint.to_string());
            }
        }
    }
}

/// Every state of a scene: `[initial, during step 0, during step 1, ...]`.
pub fn walk_states(scene: &Value, model: &StateModel) -> Vec<SceneState> {
    let mut state = SceneState {
        values: model.initial_values.clone(),
        hidden: model.initial_hidden.clone(),
        callout: scene.get("callout").and_then(Value::as_str).unwrap_or("").to_string(),
        ..Default::default()
    };
    if let Some(t) = scene.get("tint") {
        apply_tints(model, t, &mut state);
    }
    let mut states = vec![state.clone()];
    let steps = scene.get("steps").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    for step in steps {
        let mut next = SceneState { traces: HashMap::new(), spans: HashMap::new(), ..state.clone() };
        if let Some(set) = step.get("set") {
            for (r, value) in entries(set) {
                let Some(named) = one_key(model, &Value::String(r), model.set_prefixes) else { continue };
                if (model.check_value)(&named, &value) && !same(next.values.get(&named), &value) {
                    next.values.insert(named, value);
                }
            }
        }
        if let (Some(mv), Some(move_key)) = (step.get("move").and_then(Value::as_object), model.move_key) {
            for (name, value) in mv {
                let Some(key) = move_key(name) else { continue };
                let (to, when) = match value {
                    Value::Object(o) => (
                        o.get("to").and_then(Value::as_str),
                        Some(o.get("when").and_then(Value::as_str).map(String::from)),
                    ),
                    Value::String(s) => (Some(s.as_str()), None),
                    _ => (None, None),
                };
                let Some(to) = to else { continue };
                if crate::scenes::svg::motion::parse_transform(to).is_some() {
                    next.transforms.insert(key.clone(), to.trim().to_string());
                    if let Some(w) = when {
                        next.spans.insert(key, w);
                    }
                }
            }
        }
        for field in ["show", "hide"] {
            for r in step.get(field).and_then(Value::as_array).into_iter().flatten() {
                if let Some(key) = one_key(model, r, model.show_prefixes) {
                    if field == "show" {
                        next.hidden.remove(&key);
                    } else {
                        next.hidden.insert(key);
                    }
                }
            }
        }
        if let Some(t) = step.get("tint") {
            apply_tints(model, t, &mut next);
        }
        for entry in step.get("trace").and_then(Value::as_array).into_iter().flatten() {
            let (r, when) = match entry {
                Value::Object(o) => (
                    o.get("ref").cloned().unwrap_or(Value::Null),
                    o.get("when").and_then(Value::as_str).map(String::from),
                ),
                v => (v.clone(), None),
            };
            if let Some(key) = (model.trace_key)(&r) {
                next.hidden.remove(&key);
                next.traces.insert(key, when);
            }
        }
        if let (Some(morph), Some(check)) = (step.get("morph").and_then(Value::as_object), model.morph) {
            for (id, target) in morph {
                let Some(target) = target.as_str() else { continue };
                if check(&next, id, target) {
                    let key = format!("s:{id}");
                    if target == id {
                        next.shapes.remove(&key);
                    } else {
                        next.shapes.insert(key, target.to_string());
                    }
                }
            }
        }
        if let Some(c) = step.get("callout").and_then(Value::as_str) {
            next.callout = c.to_string();
        }
        states.push(next.clone());
        state = next;
    }
    states
}

/// Frames a changed item stays lit once it has settled, fading out as the step's words go on.
const LIT_FRAMES: f64 = 40.0;

/// Where a state scene is at a frame (`stateFrame`): the state of the current step and the one before its changes,
/// how far the changes have gone (`t`), and the glow on what the step changed.
pub struct StateFrame<'a> {
    pub before: &'a SceneState,
    pub now: &'a SceneState,
    pub t: f64,
    pub lit: f64,
}

pub fn state_frame<'a>(states: &'a [SceneState], segments: &[Segment], frame: f64) -> StateFrame<'a> {
    use crate::anim::{CLAMP, interpolate};
    use crate::steps::{current_step, step_move};
    match current_step(segments, frame) {
        Some(k) if states.get(k + 1).is_some() => {
            let from = segments[k + 1].from;
            let settled = from + STEP_SETTLE_FRAMES;
            StateFrame {
                before: &states[k],
                now: &states[k + 1],
                t: step_move(frame, from),
                lit: interpolate(frame, &[from, settled, settled + LIT_FRAMES], &[0.0, 1.0, 0.0], CLAMP),
            }
        }
        _ => StateFrame { before: &states[0], now: &states[0], t: 1.0, lit: 0.0 },
    }
}

impl StateFrame<'_> {
    /// How shown an item is, 0 to 1 (`shownOf`).
    pub fn shown(&self, key: &str) -> f64 {
        let (was, is) = (
            if self.before.hidden.contains(key) { 0.0 } else { 1.0 },
            if self.now.hidden.contains(key) { 0.0 } else { 1.0 },
        );
        was + (is - was) * self.t
    }
}

/// How a tinted item looks partway through a step (`tintMix`): each tone's share of its fill, and how far it has
/// faded as ruled out.
pub struct TintMix {
    pub tones: Vec<(String, f64)>,
    pub dim: f64,
}

impl StateFrame<'_> {
    pub fn tint_mix(&self, key: &str) -> TintMix {
        let (was, now) = (self.before.tints.get(key).map(String::as_str), self.now.tints.get(key).map(String::as_str));
        let d = |t: Option<&str>| if t == Some("dim") { 1.0 } else { 0.0 };
        let dim = d(was) + (d(now) - d(was)) * self.t;
        let tone = |t: Option<&str>| t.filter(|t| *t != "dim").map(String::from);
        let (a, b) = (tone(was), tone(now));
        if a == b {
            return TintMix { tones: a.map(|t| (t, 1.0)).into_iter().collect(), dim };
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

impl TintMix {
    /// The strongest tone in the mix (`mainTone`).
    pub fn main_tone(&self) -> Option<&str> {
        let mut best: Option<&(String, f64)> = None;
        for t in &self.tones {
            if best.is_none_or(|b| t.1 > b.1) {
                best = Some(t);
            }
        }
        best.map(|b| b.0.as_str())
    }
    /// Opacity a dimmed item keeps (`dimOpacity`).
    pub fn dim_opacity(&self) -> f64 {
        1.0 - (1.0 - 0.5) * self.dim
    }
}
