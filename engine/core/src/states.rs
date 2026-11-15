//! Steps that change what a scene shows: `set`, `show`, `hide`, `tint`, `move`, `callout` and `sort` (a port of the
//! walk of shared/state-steps.mjs and of src/utils/stateTrack.ts and tint.ts). State keys are the item keys refs
//! resolve to. Each scene type that takes such steps implements [`StateModel`] (the type's entry in MODELS) and
//! calls [`walk_states`] once; [`StateFrame::at`] then gives the state at any frame.
//! Problem reports are `validate`'s, so the walk skips what it would report.

use crate::marks::{Refs, resolve_ref};
use crate::steps::{current_step, step_move};
use crate::timing::{STEP_SETTLE_FRAMES, Segment};
use serde_json::{Map, Value};
use std::collections::HashMap;

/// A scene's state at one step.
#[derive(Clone, Debug, Default)]
pub struct SceneState {
    /// Values by item key, such as a cell's text or a text scene's lead ("t:lead").
    pub values: HashMap<String, Value>,
    /// Places by item key, such as a pointer's index range, as the model's `move` writes them.
    pub places: HashMap<String, (f64, f64)>,
    /// Item keys hidden in this state.
    pub hidden: HashMap<String, bool>,
    /// Tints by item key: a tone, or "dim".
    pub tints: HashMap<String, String>,
    /// The header callout's text ("" for none).
    pub callout: String,
    /// Whether a sortable scene is sorted.
    pub sort: Option<bool>,
    /// Anything else a model keeps per state (svg transforms and shapes, traces, ...), by its own keys.
    pub extra: HashMap<String, Value>,
}

/// What a type's steps can change: the scene type's entry in MODELS of shared/state-steps.mjs.
pub trait StateModel: Refs {
    /// The state before any step.
    fn initial(&self, scene: &Value) -> SceneState;
    /// Key prefixes `set` takes; empty for none.
    fn set_prefixes(&self) -> &[&str];
    /// The entries a `set` of `r` to `value` writes, for types that set several keys at once (a chart series);
    /// None to set the one key `r` names.
    fn set_entries(&self, _scene: &Value, _r: &str, _value: &Value) -> Option<Vec<(String, Value)>> {
        None
    }
    /// Whether `value` is a value `key` can take.
    fn value_ok(&self, _value: &Value, _key: &str) -> bool {
        true
    }
    /// Key prefixes `show` and `hide` take; None when every part is drawn from the start.
    fn show_prefixes(&self) -> Option<&[&str]> {
        None
    }
    /// Key prefixes `tint` takes and the keys a tinted key expands to; None for no tint.
    fn tint_prefixes(&self) -> Option<&[&str]> {
        None
    }
    fn tint_expand(&self, _scene: &Value, key: &str) -> Vec<String> {
        vec![key.to_string()]
    }
    /// Whether the scene draws a header callout that steps can set.
    fn callout(&self) -> bool {
        false
    }
    /// Whether `sort` applies.
    fn sorts(&self, _scene: &Value) -> bool {
        false
    }
    /// A `move` of `name` to `value`: writes the new place into `next` and returns true, or false when it names
    /// nothing.
    fn apply_move(&self, _scene: &Value, _name: &str, _value: &Value, _next: &mut SceneState) -> bool {
        false
    }
    /// Anything else a step changes that this type knows (svg `trace` and `morph`, ...), applied last.
    fn apply_extra(&self, _scene: &Value, _step: &Value, _next: &mut SceneState) {}
}

/// Two values are the same when they read the same, or point at the same object (`sameValue`).
pub fn same_value(a: Option<&Value>, b: Option<&Value>) -> bool {
    let pointer = |v: Option<&Value>| v.and_then(|v| v.get("ref")).and_then(Value::as_str).map(str::to_string);
    if pointer(a).is_some() || pointer(b).is_some() {
        return pointer(a).is_some() && pointer(a) == pointer(b);
    }
    let change = |v: Option<&Value>| {
        let o = v?.as_object()?;
        (o.len() == 2 && o.get("before")?.is_string() && o.get("after")?.is_string())
            .then(|| (o["before"].clone(), o["after"].clone()))
    };
    if change(a).is_some() || change(b).is_some() {
        return change(a).is_some() && change(a) == change(b);
    }
    js_string(a) == js_string(b)
}

/// `String(v)` for the values states hold.
pub fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) => "null".into(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(_) => "[object Object]".into(),
    }
}

/// Entries of a record written as an object or as [key, value] pairs, in order (`orderedEntries`).
pub fn ordered_entries(v: Option<&Value>) -> Vec<(String, Value)> {
    match v {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|p| {
                let p = p.as_array()?;
                Some((p.first()?.as_str()?.to_string(), p.get(1).cloned().unwrap_or(Value::Null)))
            })
            .collect(),
        Some(Value::Object(o)) => o.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        _ => Vec::new(),
    }
}

const TINTS: [&str; 7] = ["neutral", "accent", "good", "bad", "warn", "dim", "clear"];

/// The one key `r` names, when it is of a kind in `prefixes` (`oneKey`).
pub fn one_key(model: &dyn StateModel, r: &Value, prefixes: &[&str]) -> Option<String> {
    let keys = resolve_ref(model, r)?;
    (keys.len() == 1 && prefixes.iter().any(|p| keys[0].starts_with(p))).then(|| keys[0].clone())
}

/// A ref as JSON: a record key that reads as a whole number is an index, as the JS resolves it.
fn ref_value(r: &str) -> Value {
    Value::String(r.to_string())
}

fn apply_tints(model: &dyn StateModel, scene: &Value, record: Option<&Value>, next: &mut SceneState) {
    let Some(prefixes) = model.tint_prefixes() else { return };
    for (r, tint) in ordered_entries(record) {
        let Some(keys) = resolve_ref(model, &ref_value(&r)) else { continue };
        if keys.is_empty() || !keys.iter().all(|k| prefixes.iter().any(|p| k.starts_with(p))) {
            continue;
        }
        let Some(tint) = tint.as_str().filter(|t| TINTS.contains(t)) else { continue };
        for key in keys.iter().flat_map(|k| model.tint_expand(scene, k)) {
            if tint == "clear" {
                next.tints.remove(&key);
            } else {
                next.tints.insert(key, tint.to_string());
            }
        }
    }
}

/// Every state of a scene: `states[0]` during the narration, `states[k + 1]` from step k's start (`sceneStates`).
pub fn walk_states(model: &dyn StateModel, scene: &Value) -> Vec<SceneState> {
    let mut state = model.initial(scene);
    state.callout = scene.get("callout").and_then(Value::as_str).unwrap_or("").to_string();
    if model.sorts(scene) {
        state.sort = Some(scene.get("sort") == Some(&Value::Bool(true)));
    }
    apply_tints(model, scene, scene.get("tint"), &mut state);
    let mut states = vec![state.clone()];
    let empty = Map::new();
    for step in scene.get("steps").and_then(Value::as_array).into_iter().flatten() {
        let mut next = SceneState { extra: HashMap::new(), ..state.clone() };
        // A trace draws during its own step only; models keep such things in `extra` and clear them there.
        next.extra = state.extra.clone();
        for (r, value) in step.get("set").and_then(Value::as_object).unwrap_or(&empty) {
            if let Some(entries) = model.set_entries(scene, r, value) {
                if entries.iter().all(|(k, v)| model.value_ok(v, k)) {
                    for (k, v) in entries {
                        next.values.insert(k, v);
                    }
                }
                continue;
            }
            let Some(key) = one_key(model, &ref_value(r), model.set_prefixes()) else { continue };
            if model.value_ok(value, &key) && !same_value(next.values.get(&key), Some(value)) {
                next.values.insert(key, value.clone());
            }
        }
        for (name, value) in step.get("move").and_then(Value::as_object).unwrap_or(&empty) {
            model.apply_move(scene, name, value, &mut next);
        }
        if let Some(prefixes) = model.show_prefixes() {
            for (field, hide) in [("show", false), ("hide", true)] {
                for r in step.get(field).and_then(Value::as_array).into_iter().flatten() {
                    if !(r.is_string() || r.as_u64().is_some()) {
                        continue;
                    }
                    let Some(key) = one_key(model, r, prefixes) else { continue };
                    if hide {
                        next.hidden.insert(key, true);
                    } else {
                        next.hidden.remove(&key);
                    }
                }
            }
        }
        apply_tints(model, scene, step.get("tint"), &mut next);
        model.apply_extra(scene, step, &mut next);
        if model.sorts(scene)
            && let Some(Value::Bool(b)) = step.get("sort")
        {
            next.sort = Some(*b);
        }
        if model.callout()
            && let Some(Value::String(c)) = step.get("callout")
        {
            next.callout = c.clone();
        }
        states.push(next.clone());
        state = next;
    }
    states
}

/// Frames a changed item stays lit once it has settled.
const LIT_FRAMES: f64 = 40.0;

/// Where a state scene is at a frame (`StateFrame`): the state of the current step and the one before its changes,
/// how far the changes have gone (`t`), and the glow on what the step changed.
pub struct StateFrame<'a> {
    pub before: &'a SceneState,
    pub now: &'a SceneState,
    pub t: f64,
    pub lit: f64,
}

impl<'a> StateFrame<'a> {
    /// `stateFrame`.
    pub fn at(states: &'a [SceneState], segments: &[Segment], frame: f64) -> StateFrame<'a> {
        match current_step(segments, frame) {
            Some(k) if states.get(k + 1).is_some() => {
                let from = segments[k + 1].from;
                let settled = from + STEP_SETTLE_FRAMES;
                StateFrame {
                    before: &states[k],
                    now: &states[k + 1],
                    t: step_move(frame, from),
                    lit: crate::anim::interpolate(
                        frame,
                        &[from, settled, settled + LIT_FRAMES],
                        &[0.0, 1.0, 0.0],
                        crate::anim::CLAMP,
                    ),
                }
            }
            _ => StateFrame { before: &states[0], now: &states[0], t: 1.0, lit: 0.0 },
        }
    }

    /// Whether the current step changed the value under `key` (`valueChanged`).
    pub fn changed(&self, key: &str) -> bool {
        !same_value(self.before.values.get(key), self.now.values.get(key))
    }

    /// How shown an item is, 0 to 1, fading with the step that shows or hides it (`shownOf`).
    pub fn shown(&self, key: &str) -> f64 {
        let was = if self.before.hidden.get(key).copied().unwrap_or(false) { 0.0 } else { 1.0 };
        let is = if self.now.hidden.get(key).copied().unwrap_or(false) { 0.0 } else { 1.0 };
        was + (is - was) * self.t
    }

    /// A place partway from where the step found it to where it puts it (`placeOf`).
    pub fn place(&self, key: &str) -> (f64, f64) {
        let now = self.now.places.get(key).copied().unwrap_or((0.0, 0.0));
        let was = self.before.places.get(key).copied().unwrap_or(now);
        (was.0 + (now.0 - was.0) * self.t, was.1 + (now.1 - was.1) * self.t)
    }

    /// The tint under `key` partway through the step (`tintMix`): each tone's share, and how far it has dimmed.
    pub fn tint(&self, key: &str) -> TintMix {
        let was = self.before.tints.get(key).map(String::as_str);
        let now = self.now.tints.get(key).map(String::as_str);
        let d = |t: Option<&str>| if t == Some("dim") { 1.0 } else { 0.0 };
        let dim = d(was) + (d(now) - d(was)) * self.t;
        let tone = |t: Option<&str>| t.filter(|t| *t != "dim").map(str::to_string);
        let (a, b) = (tone(was), tone(now));
        let tones = if a == b {
            a.map(|t| vec![(t, 1.0)]).unwrap_or_default()
        } else {
            a.map(|t| (t, 1.0 - self.t)).into_iter().chain(b.map(|t| (t, self.t))).collect()
        };
        TintMix { tones, dim }
    }
}

/// How a tinted item looks partway through a step (`TintMix`).
#[derive(Clone, Debug, PartialEq)]
pub struct TintMix {
    pub tones: Vec<(String, f64)>,
    pub dim: f64,
}

impl TintMix {
    /// The strongest tone, for a border or a label (`mainTone`).
    pub fn main_tone(&self) -> Option<&str> {
        self.tones
            .iter()
            .fold(None::<&(String, f64)>, |best, t| if best.is_none_or(|b| t.1 > b.1) { Some(t) } else { best })
            .map(|t| t.0.as_str())
    }
    /// Opacity a dimmed item keeps (`dimOpacity`).
    pub fn opacity(&self) -> f64 {
        1.0 - 0.5 * self.dim
    }
}

/// A tone's fill on a tinted item (`tintFill`: the colour at 0x40 alpha).
pub fn tint_fill(c: crate::color::Color) -> crate::color::Color {
    c.alpha(0x40 as f32 / 255.0)
}

/// Whether a step changes state at all (`changesState`), for scenes that light what changed.
pub fn changes_state(step: &Value) -> bool {
    ["set", "move", "show", "hide", "tint", "trace", "morph", "sort", "callout"].iter().any(|k| step.get(*k).is_some())
}

/// The frame a step's change settles, for a scene that times a pen or a glow after it.
pub fn settles_at(segments: &[Segment], k: usize) -> Option<f64> {
    segments.get(k + 1).map(|s| s.from + STEP_SETTLE_FRAMES)
}

/// How lit a value a step changed is at `frame`, 0 to 1 (the `lit` of a [`StateFrame`] for a changed key).
pub fn lit_of(frame: &StateFrame, key: &str) -> f64 {
    if frame.changed(key) { frame.lit } else { 0.0 }
}
