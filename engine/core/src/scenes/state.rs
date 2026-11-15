//! Scenes whose steps change what they show: a port of shared/state-steps.mjs (the walk over a scene's steps,
//! without `validate`'s problem reports), src/utils/stateTrack.ts and src/utils/tint.ts, and `focusSpotlight` of
//! src/utils/spotlight.ts. A scene type supplies a [`Model`]: its initial state and how it names items.

use crate::anim::{CLAMP, clamped, interpolate};
use crate::steps::{Emphasis, Spotlight, current_step, step_move};
use crate::timing::{STEP_SETTLE_FRAMES, Segment};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// Frames a changed item stays lit once it has settled.
const LIT_FRAMES: f64 = 40.0;
/// The colours a `tint` takes: a tone, "dim", or "clear" to take the colour off.
pub const TINTS: [&str; 7] = ["neutral", "accent", "good", "bad", "warn", "dim", "clear"];

/// What a scene shows during the narration or from one step's start.
#[derive(Clone, Debug, Default)]
pub struct SceneState {
    pub values: BTreeMap<String, Value>,
    pub hidden: BTreeSet<String>,
    pub tints: BTreeMap<String, String>,
    pub callout: String,
    /// Lines this step draws on, by item key, with the `when` cue (a trace lasts only its own step).
    pub traces: BTreeMap<String, Option<String>>,
    pub sort: Option<bool>,
}

/// An item key and the value a `set` writes under it.
pub type SetEntry = (String, Value);

/// How a scene type takes part in the walk (the type's entry of `MODELS` and `TARGETS`).
pub struct Model {
    /// The state before any step: values, hidden items, `sort`.
    pub initial: fn(&Value) -> SceneState,
    /// The item keys a ref names (`TARGETS[type].resolve`), or None.
    pub resolve: fn(&Value, &Value) -> Option<Vec<String>>,
    /// What a step's `set` of `ref` to `value` writes, as [item key, value]; None when it is no valid set.
    pub set: fn(&Value, &str, &Value) -> Option<Vec<SetEntry>>,
    /// Key prefixes `show` and `hide` take; None when the type takes neither.
    pub show: Option<&'static [&'static str]>,
    /// Key prefixes a `tint` takes; None when the type takes none.
    pub tint: Option<&'static [&'static str]>,
    /// Whether the scene can be sorted by a step's `sort`.
    pub sortable: fn(&Value) -> bool,
    /// The item key `trace` takes a ref to; None when the type traces nothing.
    pub trace: Option<fn(&Value, &str) -> Option<String>>,
}

/// A JSON value as a list, or empty.
pub fn list(v: Option<&Value>) -> &[Value] {
    v.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn is_index(v: &Value, count: usize) -> bool {
    v.as_u64().is_some_and(|n| (n as usize) < count)
        || v.as_f64().is_some_and(|f| f >= 0.0 && f.fract() == 0.0 && (f as usize) < count)
}

/// `Number.isInteger(ref) && ref >= 0 && ref < count`, for a ref written as a number.
pub fn index_ref(v: &Value, count: usize) -> Option<usize> {
    is_index(v, count).then(|| v.as_f64().unwrap_or(0.0) as usize)
}

/// A ref's text: strings as they are, numbers as `String(n)`.
pub fn ref_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// A table cell that strikes an old value beside a new one: `{ before, after }`.
pub fn is_change(v: &Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.len() == 2 && o.get("before").is_some_and(Value::is_string) && o.get("after").is_some_and(Value::is_string)
    })
}

fn is_pointer(v: &Value) -> bool {
    v.as_object().is_some_and(|o| o.get("ref").is_some_and(Value::is_string))
}

fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        other => other.to_string(),
    }
}

/// Two values are the same when they read the same (`sameValue`).
pub fn same_value(a: &Value, b: &Value) -> bool {
    if is_pointer(a) || is_pointer(b) {
        return is_pointer(a) && is_pointer(b) && a["ref"] == b["ref"];
    }
    if is_change(a) || is_change(b) {
        return is_change(a) && is_change(b) && a == b;
    }
    js_string(a) == js_string(b)
}

/// A tint, or a record of tints, as [ref, tint] pairs in the order written (`tintEntries`).
pub fn tint_entries(v: Option<&Value>) -> Vec<(String, String)> {
    let pair = |k: &str, t: &Value| t.as_str().map(|t| (k.to_string(), t.to_string()));
    match v {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|p| match p.as_array().map(Vec::as_slice) {
                Some([Value::String(k), t]) => pair(k, t),
                _ => None,
            })
            .collect(),
        Some(Value::Object(o)) => o.iter().filter_map(|(k, t)| pair(k, t)).collect(),
        _ => Vec::new(),
    }
}

/// The item keys a ref lights in a scene. A string written as an index means the index when nothing in the
/// scene is named so (`resolveRef`).
pub fn resolve_ref(model: &Model, scene: &Value, r: &Value) -> Option<Vec<String>> {
    (model.resolve)(scene, r).or_else(|| {
        let t = r.as_str()?;
        let digits = t.trim();
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        (model.resolve)(scene, &Value::from(digits.parse::<u64>().ok()?))
    })
}

/// The one item key `r` names, when it is of a kind in `prefixes` (`oneKey`).
pub fn one_key(model: &Model, scene: &Value, r: &Value, prefixes: &[&str]) -> Option<String> {
    let keys = resolve_ref(model, scene, r)?;
    match keys.as_slice() {
        [k] if prefixes.iter().any(|p| k.starts_with(p)) => Some(k.clone()),
        _ => None,
    }
}

fn apply_tints(model: &Model, scene: &Value, record: Option<&Value>, next: &mut SceneState) {
    let Some(prefixes) = model.tint else { return };
    for (r, tint) in tint_entries(record) {
        let Some(keys) = resolve_ref(model, scene, &Value::String(r)) else { continue };
        if keys.is_empty() || !keys.iter().all(|k| prefixes.iter().any(|p| k.starts_with(p))) {
            continue;
        }
        if !TINTS.contains(&tint.as_str()) {
            continue;
        }
        for key in keys {
            if tint == "clear" {
                next.tints.remove(&key);
            } else {
                next.tints.insert(key, tint.clone());
            }
        }
    }
}

/// Every state of a scene: `[initial, during step 0, during step 1, ...]` (`sceneStates`).
pub fn scene_states(model: &Model, scene: &Value) -> Vec<SceneState> {
    let mut state = (model.initial)(scene);
    state.callout = scene.get("callout").and_then(Value::as_str).unwrap_or("").to_string();
    apply_tints(model, scene, scene.get("tint"), &mut state);
    let mut states = vec![state.clone()];
    for step in list(scene.get("steps")) {
        let mut next = SceneState { traces: BTreeMap::new(), ..state.clone() };
        if let Some(set) = step.get("set").and_then(Value::as_object) {
            for (r, value) in set {
                let Some(entries) = (model.set)(scene, r, value) else { continue };
                if entries.iter().all(|(k, v)| next.values.get(k).is_some_and(|old| same_value(old, v))) {
                    continue;
                }
                next.values.extend(entries);
            }
        }
        if let Some(prefixes) = model.show {
            for field in ["show", "hide"] {
                let Some(refs) = step.get(field).and_then(Value::as_array) else { continue };
                if !refs.iter().all(|r| r.is_string() || r.as_f64().is_some_and(|f| f.fract() == 0.0)) {
                    continue;
                }
                for r in refs {
                    let Some(key) = one_key(model, scene, r, prefixes) else { continue };
                    if field == "show" {
                        next.hidden.remove(&key);
                    } else {
                        next.hidden.insert(key);
                    }
                }
            }
        }
        apply_tints(model, scene, step.get("tint"), &mut next);
        if let (Some(trace), Some(entries)) = (model.trace, step.get("trace").and_then(Value::as_array)) {
            for entry in entries.iter().filter_map(Value::as_str) {
                if let Some(key) = trace(scene, entry) {
                    next.hidden.remove(&key);
                    next.traces.insert(key, None);
                }
            }
        }
        if let Some(sort) = step.get("sort").and_then(Value::as_bool)
            && (model.sortable)(scene)
        {
            next.sort = Some(sort);
        }
        if let Some(callout) = step.get("callout").and_then(Value::as_str) {
            next.callout = callout.to_string();
        }
        states.push(next.clone());
        state = next;
    }
    states
}

/// Where a state scene is at a frame (`StateFrame`): the state of the current step and the one before its
/// changes, how far the changes have gone (`t`), and the glow on what the step changed.
pub struct StateFrame<'a> {
    pub before: &'a SceneState,
    pub now: &'a SceneState,
    pub t: f64,
    pub lit: f64,
    /// The step shown, or None before the first.
    pub step: Option<usize>,
}

pub fn state_frame<'a>(states: &'a [SceneState], segments: &[Segment], frame: f64) -> StateFrame<'a> {
    let k = current_step(segments, frame);
    match k {
        Some(k) if states.get(k + 1).is_some() && segments.get(k + 1).is_some() => {
            let from = segments[k + 1].from;
            let settled = from + STEP_SETTLE_FRAMES;
            StateFrame {
                before: &states[k],
                now: &states[k + 1],
                t: step_move(frame, from),
                lit: interpolate(frame, &[from, settled, settled + LIT_FRAMES], &[0.0, 1.0, 0.0], CLAMP),
                step: Some(k),
            }
        }
        _ => StateFrame { before: &states[0], now: &states[0], t: 1.0, lit: 0.0, step: None },
    }
}

impl StateFrame<'_> {
    /// Whether the current step changed the value under `key`.
    pub fn value_changed(&self, key: &str) -> bool {
        match (self.before.values.get(key), self.now.values.get(key)) {
            (Some(a), Some(b)) => !same_value(a, b),
            (None, None) => false,
            _ => true,
        }
    }

    /// How shown an item is, 0 to 1 (`shownOf`).
    pub fn shown(&self, key: &str) -> f64 {
        let was = if self.before.hidden.contains(key) { 0.0 } else { 1.0 };
        let is = if self.now.hidden.contains(key) { 0.0 } else { 1.0 };
        was + (is - was) * self.t
    }

    /// How a tinted item looks partway through the step (`tintMix`).
    pub fn tint(&self, key: &str) -> TintMix {
        let (was, now) = (self.before.tints.get(key), self.now.tints.get(key));
        let dimmed = |t: Option<&String>| if t.is_some_and(|t| t == "dim") { 1.0 } else { 0.0 };
        let dim = dimmed(was) + (dimmed(now) - dimmed(was)) * self.t;
        let tone = |t: Option<&String>| t.filter(|t| *t != "dim").cloned();
        let (a, b) = (tone(was), tone(now));
        if a == b {
            return TintMix { tones: a.into_iter().map(|tone| (tone, 1.0)).collect(), dim };
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
    /// The strongest tone, for a border or a label (`mainTone`).
    pub fn main_tone(&self) -> Option<&str> {
        let mut best: Option<&(String, f64)> = None;
        for t in &self.tones {
            if best.is_none_or(|b| t.1 > b.1) {
                best = Some(t);
            }
        }
        best.map(|t| t.0.as_str())
    }

    /// Opacity a dimmed item keeps (`dimOpacity`).
    pub fn dim_opacity(&self) -> f64 {
        1.0 - 0.5 * self.dim
    }
}

/// A tone's fill on a tinted item: its colour at 0x40 alpha (`tintFill`).
pub fn tint_fill(color: crate::color::Color) -> crate::color::Color {
    color.alpha(0x40 as f32 / 255.0)
}

/// The step each item key is lit by (`targetSteps`): a step's `focus`, a ref or a list of them.
pub fn target_steps(model: &Model, scene: &Value) -> HashMap<String, Vec<usize>> {
    let mut out: HashMap<String, Vec<usize>> = HashMap::new();
    for (k, step) in list(scene.get("steps")).iter().enumerate() {
        let refs: Vec<&Value> = match step.get("focus") {
            Some(Value::Array(a)) => a.iter().collect(),
            Some(v) => vec![v],
            None => Vec::new(),
        };
        let mut keys: Vec<String> = Vec::new();
        for r in refs {
            for key in resolve_ref(model, scene, r).unwrap_or_default() {
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
        }
        for key in keys {
            out.entry(key).or_default().push(k);
        }
    }
    out
}

/// Emphasis by item key for a scene whose steps take `focus` (`focusSpotlight`).
pub struct Focus {
    steps: HashMap<String, Vec<usize>>,
    spotlight: Spotlight,
}

impl Focus {
    pub fn new(model: &Model, scene: &Value, segments: &[Segment], frame: f64) -> Focus {
        let starts: Vec<f64> = segments.iter().skip(1).map(|s| s.from).collect();
        Focus { steps: target_steps(model, scene), spotlight: Spotlight::new(frame, &starts) }
    }

    pub fn at(&self, key: &str) -> Emphasis {
        self.spotlight.emphasis(self.steps.get(key).map_or(&[], Vec::as_slice))
    }

    /// The steps that light `key`.
    pub fn steps(&self, key: &str) -> &[usize] {
        self.steps.get(key).map_or(&[], Vec::as_slice)
    }
}

/// The stronger of two emphases, part by part (`brighter`).
pub fn brighter(a: Emphasis, b: Emphasis) -> Emphasis {
    Emphasis { opacity: a.opacity.max(b.opacity), bar: a.bar.max(b.bar), glow: a.glow.max(b.glow) }
}

/// Fades `a` to `b` over a step's settle, for values that change (`was + (is - was) * t`).
pub fn lerp(was: f64, is: f64, t: f64) -> f64 {
    was + (is - was) * t
}

/// A convenience for a clamped 0..1 ramp between two frames.
pub fn ramp(frame: f64, a: f64, b: f64) -> f64 {
    clamped(frame, a, b, 0.0, 1.0)
}
