//! Steps that change what a scene shows: `set`, `move`, `show`, `hide`, `tint`, `trace`, `sort` and `callout` (a port
//! of the walk of shared/state-steps.mjs, of src/utils/stateTrack.ts and of src/utils/tint.ts). State keys are the item
//! keys refs resolve to (crate::targets). Each scene type that takes such steps supplies a [`StateModel`] (its entry
//! in MODELS) and calls [`walk_states`] once; [`StateFrame::at`] then gives the state at any frame.
//! Problem reports are `validate`'s, so the walk skips what it would report.

use crate::anim::{CLAMP, interpolate};
use crate::color::Color;
use crate::marks::{Refs, resolve_ref};
use crate::steps::{current_step, step_move};
use crate::timing::{STEP_SETTLE_FRAMES, Segment};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};

/// Values by item key, in the order they were first set (a JS object's order).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Values {
    order: Vec<String>,
    map: HashMap<String, Value>,
}

impl Values {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.map.get(key)
    }
    pub fn set(&mut self, key: String, v: Value) {
        if self.map.insert(key.clone(), v).is_none() {
            self.order.push(key);
        }
    }
    pub fn insert(&mut self, key: String, v: Value) {
        self.set(key, v);
    }
    pub fn extend(&mut self, entries: impl IntoIterator<Item = (String, Value)>) {
        for (k, v) in entries {
            self.set(k, v);
        }
    }
    pub fn contains_key(&self, key: &str) -> bool {
        self.map.contains_key(key)
    }
    pub fn iter(&self) -> impl Iterator<Item = (&String, &Value)> {
        self.order.iter().map(|k| (k, &self.map[k]))
    }
    pub fn len(&self) -> usize {
        self.order.len()
    }
    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }
}

/// A scene's state at one step (`SceneState`).
#[derive(Clone, Debug, Default)]
pub struct SceneState {
    /// Values by item key, such as a cell's text or a text scene's lead ("t:lead").
    pub values: Values,
    /// Places by item key, such as a pointer's index range, as the model's `move` writes them.
    pub places: HashMap<String, (f64, f64)>,
    /// Item keys hidden in this state.
    pub hidden: HashSet<String>,
    /// Tints by item key: a tone, or "dim".
    pub tints: BTreeMap<String, String>,
    /// The header callout's text ("" for none).
    pub callout: String,
    /// Lines this step draws on, by item key, with the `when` cue; a trace lasts only its own step.
    pub traces: BTreeMap<String, Option<String>>,
    /// Whether a sortable scene is sorted.
    pub sort: Option<bool>,
    /// A moved svg element's transform, by item key.
    pub transforms: HashMap<String, String>,
    /// A morphed svg path's target id, by item key.
    pub shapes: HashMap<String, String>,
    /// The moves this step plays across its words, with the words they start on; a span lasts only its own step.
    pub spans: HashMap<String, Option<String>>,
}

/// What a type's steps can change: the scene type's entry in MODELS of shared/state-steps.mjs. Its refs are the
/// type's `resolve` (crate::targets).
pub trait StateModel: Refs {
    /// The state before any step (the walk adds the scene's `callout`, `tint` and `sort`).
    fn initial(&self, scene: &Value) -> SceneState;
    /// Key prefixes `set` takes; empty for none.
    fn set_prefixes(&self) -> &[&str] {
        &[]
    }
    /// The key a set of a named item writes (a graph node's badge: "n:id" writes "b:id").
    fn set_key(&self, named: &str) -> String {
        named.to_string()
    }
    /// The entries a `set` of `r` to `value` writes, for a type that resolves sets itself (a chart series, a table
    /// cell); empty when it is no valid set; None to set the one key `r` names.
    fn set_entries(&self, _scene: &Value, _r: &str, _value: &Value) -> Option<Vec<(String, Value)>> {
        None
    }
    /// Whether `value` is a value `key` can take (`checkValue`).
    fn value_ok(&self, _value: &Value, _key: &str) -> bool {
        true
    }
    /// Key prefixes `show` and `hide` take; None when every part is drawn from the start.
    fn show_prefixes(&self) -> Option<&[&str]> {
        None
    }
    /// Key prefixes `tint` takes; None for no tint.
    fn tint_prefixes(&self) -> Option<&[&str]> {
        None
    }
    /// The keys a tinted key expands to (a group to its nodes, a row to its cells).
    fn tint_expand(&self, _scene: &Value, key: &str) -> Vec<String> {
        vec![key.to_string()]
    }
    /// Whether a ref is ambiguous in this scene (`ambiguousIndex`), so a step's show, hide or tint skips it.
    fn ambiguous(&self, _scene: &Value, _r: &Value) -> bool {
        false
    }
    /// Whether the scene draws a header callout that steps can set.
    fn callout(&self) -> bool {
        false
    }
    /// Whether `sort` applies.
    fn sorts(&self, _scene: &Value) -> bool {
        false
    }
    /// A `move` of `name` to `value`: the key and its new place, or None when it names nothing.
    fn apply_move(&self, _scene: &Value, _name: &str, _value: &Value) -> Option<(String, (f64, f64))> {
        None
    }
    /// The key a `trace` entry draws on, or None when the type traces nothing.
    fn trace_key(&self, _scene: &Value, _entry: &str) -> Option<String> {
        None
    }
    /// Anything else a step changes that this type knows (svg `morph`, ...), applied last.
    fn apply_extra(&self, _scene: &Value, _step: &Value, _next: &mut SceneState) {}
}

/// A model built from functions, for a type whose MODELS entry is easiest written as data.
pub struct FnModel {
    /// The state before any step: values, hidden items, `sort`.
    pub initial: fn(&Value) -> SceneState,
    /// The item keys a ref names (`TARGETS[type].resolve`), or None.
    pub resolve: fn(&Value, &Value) -> Option<Vec<String>>,
    /// What a step's `set` of `ref` to `value` writes; None (or empty) when it is no valid set.
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

/// A [`FnModel`] bound to its scene, so it can resolve refs.
pub struct BoundModel<'a> {
    pub model: &'a FnModel,
    pub scene: &'a Value,
}

impl Refs for BoundModel<'_> {
    fn resolve(&self, r: &Value) -> Option<Vec<String>> {
        (self.model.resolve)(self.scene, r)
    }
}

impl StateModel for BoundModel<'_> {
    fn initial(&self, scene: &Value) -> SceneState {
        (self.model.initial)(scene)
    }
    fn set_entries(&self, scene: &Value, r: &str, value: &Value) -> Option<Vec<(String, Value)>> {
        Some((self.model.set)(scene, r, value).unwrap_or_default())
    }
    fn show_prefixes(&self) -> Option<&[&str]> {
        self.model.show
    }
    fn tint_prefixes(&self) -> Option<&[&str]> {
        self.model.tint
    }
    fn sorts(&self, scene: &Value) -> bool {
        (self.model.sortable)(scene)
    }
    fn trace_key(&self, scene: &Value, entry: &str) -> Option<String> {
        self.model.trace.and_then(|f| f(scene, entry))
    }
    fn callout(&self) -> bool {
        true
    }
}

/// `String(v)` for the values states hold.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        Value::Number(n) => n.as_i64().map(|i| i.to_string()).unwrap_or_else(|| {
            let f = n.as_f64().unwrap_or(0.0);
            if f.fract() == 0.0 && f.abs() < 1e21 { format!("{}", f as i64) } else { format!("{f}") }
        }),
        Value::Bool(b) => b.to_string(),
        Value::Array(a) => a.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// A JSON array field, or empty.
pub fn list<'a>(v: &'a Value, field: &str) -> &'a [Value] {
    v.get(field).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// A JSON value as a list, or empty.
pub fn items(v: Option<&Value>) -> &[Value] {
    v.and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// An item key and the value a `set` writes under it.
pub type SetEntry = (String, Value);

/// A memory value that points at an object: `{ "ref": "c1" }` (`isPointer`).
pub fn is_pointer(v: &Value) -> bool {
    v.as_object().is_some_and(|o| o.get("ref").is_some_and(Value::is_string))
}

/// A table cell that strikes an old value beside a new one: `{ before, after }` (`isChange`).
pub fn is_change(v: &Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.len() == 2 && o.get("before").is_some_and(Value::is_string) && o.get("after").is_some_and(Value::is_string)
    })
}

/// Two values are the same when they read the same, or point at the same object (`sameValue`).
pub fn same_value(a: Option<&Value>, b: Option<&Value>) -> bool {
    let (Some(a), Some(b)) = (a, b) else { return a.is_none() && b.is_none() };
    if is_pointer(a) || is_pointer(b) {
        return is_pointer(a) && is_pointer(b) && a["ref"] == b["ref"];
    }
    if is_change(a) || is_change(b) {
        return is_change(a) && is_change(b) && a["before"] == b["before"] && a["after"] == b["after"];
    }
    js_string(a) == js_string(b)
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
        Some(Value::Object(o)) => js_order(o),
        _ => Vec::new(),
    }
}

/// An object's entries as `Object.entries` lists them: names that read as array indexes first, ascending.
fn js_order(m: &serde_json::Map<String, Value>) -> Vec<(String, Value)> {
    let index = |k: &str| k.parse::<u32>().ok().filter(|n| n.to_string() == k);
    let mut ints: Vec<_> = m.iter().filter(|(k, _)| index(k).is_some()).collect();
    ints.sort_by_key(|(k, _)| index(k));
    ints.into_iter().chain(m.iter().filter(|(k, _)| index(k).is_none())).map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// A `tint` as [ref, tint] pairs in the order written, from pairs or an object (`tintEntries`).
pub fn tint_entries(v: Option<&Value>) -> Vec<(String, String)> {
    ordered_entries(v)
        .into_iter()
        .filter_map(|(k, t)| match t {
            Value::String(s) => Some((k, s)),
            Value::Number(n) => Some((k, n.to_string())),
            _ => None,
        })
        .collect()
}

/// The colours a `tint` takes: a tone, "dim", or "clear" to take the colour off.
pub const TINTS: [&str; 7] = ["neutral", "accent", "good", "bad", "warn", "dim", "clear"];

/// The one key `r` names, when it is of a kind in `prefixes` (`oneKey`).
pub fn one_key(model: &dyn StateModel, r: &Value, prefixes: &[&str]) -> Option<String> {
    let keys = resolve_ref(model, r)?;
    (keys.len() == 1 && prefixes.iter().any(|p| keys[0].starts_with(p))).then(|| keys[0].clone())
}

fn apply_tints(model: &dyn StateModel, scene: &Value, record: Option<&Value>, next: &mut SceneState) {
    let Some(prefixes) = model.tint_prefixes() else { return };
    for (r, tint) in tint_entries(record) {
        let rv = Value::String(r);
        if model.ambiguous(scene, &rv) {
            continue;
        }
        let Some(keys) = resolve_ref(model, &rv) else { continue };
        if keys.is_empty() || !keys.iter().all(|k| prefixes.iter().any(|p| k.starts_with(p))) {
            continue;
        }
        if !TINTS.contains(&tint.as_str()) {
            continue;
        }
        for key in keys.iter().flat_map(|k| model.tint_expand(scene, k)) {
            if tint == "clear" {
                next.tints.remove(&key);
            } else {
                next.tints.insert(key, tint.clone());
            }
        }
    }
}

fn is_integer(v: &Value) -> bool {
    v.as_f64().is_some_and(|f| f.fract() == 0.0)
}

/// Every state of a scene: `states[0]` during the narration, `states[k + 1]` from step k's start (`sceneStates`).
pub fn walk_states(model: &dyn StateModel, scene: &Value) -> Vec<SceneState> {
    let mut state = model.initial(scene);
    state.callout = scene.get("callout").and_then(Value::as_str).unwrap_or("").to_string();
    if model.sorts(scene) && state.sort.is_none() {
        state.sort = Some(scene.get("sort") == Some(&Value::Bool(true)));
    }
    apply_tints(model, scene, scene.get("tint"), &mut state);
    let mut states = vec![state.clone()];
    for step in list(scene, "steps") {
        let mut next = SceneState { traces: BTreeMap::new(), spans: HashMap::new(), ..state.clone() };
        for (r, value) in ordered_entries(step.get("set").filter(|v| v.is_object())) {
            if let Some(entries) = model.set_entries(scene, &r, &value) {
                if entries.is_empty() || entries.iter().all(|(k, v)| same_value(next.values.get(k), Some(v))) {
                    continue;
                }
                next.values.extend(entries);
                continue;
            }
            let Some(named) = one_key(model, &Value::String(r), model.set_prefixes()) else { continue };
            let key = model.set_key(&named);
            if model.value_ok(&value, &key) && !same_value(next.values.get(&key), Some(&value)) {
                next.values.set(key, value);
            }
        }
        for (name, value) in ordered_entries(step.get("move").filter(|v| v.is_object())) {
            if let Some((key, place)) = model.apply_move(scene, &name, &value) {
                next.places.insert(key, place);
            }
        }
        if let Some(prefixes) = model.show_prefixes() {
            for field in ["show", "hide"] {
                let Some(refs) = step.get(field).and_then(Value::as_array) else { continue };
                // A list with anything but refs in it is reported, and changes nothing.
                if !refs.iter().all(|r| r.is_string() || is_integer(r)) {
                    continue;
                }
                for r in refs {
                    if model.ambiguous(scene, r) {
                        continue;
                    }
                    let Some(key) = one_key(model, r, prefixes) else { continue };
                    if field == "show" {
                        next.hidden.remove(&key);
                    } else {
                        next.hidden.insert(key);
                    }
                }
            }
        }
        apply_tints(model, scene, step.get("tint"), &mut next);
        for entry in list(step, "trace") {
            let (r, when) = match entry {
                Value::String(s) => (s.clone(), None),
                Value::Object(o) => match o.get("ref").and_then(Value::as_str) {
                    Some(s) => (s.to_string(), o.get("when").and_then(Value::as_str).map(str::to_string)),
                    None => continue,
                },
                _ => continue,
            };
            if let Some(key) = model.trace_key(scene, &r) {
                next.hidden.remove(&key);
                next.traces.insert(key, when);
            }
        }
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
/// how far the changes have gone (`t`, 1 once settled), and the glow on what the step changed.
pub struct StateFrame<'a> {
    pub before: &'a SceneState,
    pub now: &'a SceneState,
    /// Indexes of `before` and `now` in the states.
    pub before_index: usize,
    pub now_index: usize,
    pub t: f64,
    pub lit: f64,
    /// The step shown, or None before the first.
    pub step: Option<usize>,
}

impl<'a> StateFrame<'a> {
    /// `stateFrame`.
    pub fn at(states: &'a [SceneState], segments: &[Segment], frame: f64) -> StateFrame<'a> {
        match current_step(segments, frame) {
            Some(k) if states.get(k + 1).is_some() && segments.get(k + 1).is_some() => {
                let from = segments[k + 1].from;
                let settled = from + STEP_SETTLE_FRAMES;
                StateFrame {
                    before: &states[k],
                    now: &states[k + 1],
                    before_index: k,
                    now_index: k + 1,
                    t: step_move(frame, from),
                    lit: interpolate(frame, &[from, settled, settled + LIT_FRAMES], &[0.0, 1.0, 0.0], CLAMP),
                    step: Some(k),
                }
            }
            _ => StateFrame {
                before: &states[0],
                now: &states[0],
                before_index: 0,
                now_index: 0,
                t: 1.0,
                lit: 0.0,
                step: None,
            },
        }
    }

    /// Whether the current step changed the value under `key` (`valueChanged`).
    pub fn value_changed(&self, key: &str) -> bool {
        !same_value(self.before.values.get(key), self.now.values.get(key))
    }

    /// How shown an item is, 0 to 1, fading with the step that shows or hides it (`shownOf`).
    pub fn shown(&self, key: &str) -> f64 {
        let was = if self.before.hidden.contains(key) { 0.0 } else { 1.0 };
        let is = if self.now.hidden.contains(key) { 0.0 } else { 1.0 };
        was + (is - was) * self.t
    }

    /// A place partway from where the step found it to where it puts it (`placeOf`).
    pub fn place(&self, key: &str) -> (f64, f64) {
        let now = self.now.places.get(key).copied().unwrap_or((0.0, 0.0));
        let was = self.before.places.get(key).copied().unwrap_or(now);
        (was.0 + (now.0 - was.0) * self.t, was.1 + (now.1 - was.1) * self.t)
    }

    /// The tint under `key` partway through the step (`tintMix`).
    pub fn tint(&self, key: &str) -> TintMix {
        let (was, now) = (self.before.tints.get(key), self.now.tints.get(key));
        let dimmed = |t: Option<&String>| if t.is_some_and(|t| t == "dim") { 1.0 } else { 0.0 };
        let dim = dimmed(was) + (dimmed(now) - dimmed(was)) * self.t;
        let tone = |t: Option<&String>| t.filter(|t| *t != "dim").cloned();
        let (a, b) = (tone(was), tone(now));
        if a == b {
            return TintMix { tones: a.into_iter().map(|t| (t, 1.0)).collect(), dim };
        }
        let mut tones = Vec::new();
        tones.extend(a.map(|a| (a, 1.0 - self.t)));
        tones.extend(b.map(|b| (b, self.t)));
        TintMix { tones, dim }
    }
}

/// How a tinted item looks partway through a step (`TintMix`): each tone's share, and how far it has dimmed.
#[derive(Clone, Debug, Default, PartialEq)]
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
    /// Opacity a dimmed item keeps (`dimOpacity`): ruled out, it recedes but stays readable.
    pub fn dim_opacity(&self) -> f64 {
        1.0 - 0.5 * self.dim
    }
}

/// A tone's fill on a tinted item (`tintFill`: its colour at 0x40 alpha).
pub fn tint_fill(c: Color) -> Color {
    c.alpha(0x40 as f32 / 255.0)
}

/// An alpha as `#rrggbbaa` carries it: rounded to eight bits.
pub fn hex_alpha(alpha: f64) -> f32 {
    ((alpha.clamp(0.0, 1.0) * 255.0).round() / 255.0) as f32
}

/// The key an svg `move` names, or None.
pub type MoveKey<'a> = dyn Fn(&str) -> Option<String> + Sync + 'a;
/// Whether an svg `move` target parses as a transform.
pub type TransformCheck<'a> = dyn Fn(&str) -> bool + Sync + 'a;
/// Whether path `id` can morph into `target` from a state.
pub type MorphCheck<'a> = dyn Fn(&SceneState, &str, &str) -> bool + Sync + 'a;

/// A model given as data and closures over a scene's own parse, for a type that resolves refs through what it has
/// parsed (an svg's elements, a map's items) rather than its JSON alone.
pub struct ClosureModel<'a> {
    pub initial_values: Vec<(String, Value)>,
    pub initial_hidden: HashSet<String>,
    /// The item keys a ref names; empty for none.
    pub resolve: &'a (dyn Fn(&Value) -> Vec<String> + Sync),
    pub set_prefixes: &'a [&'a str],
    pub show_prefixes: &'a [&'a str],
    pub tint_prefixes: &'a [&'a str],
    /// Whether a set value is acceptable for a key.
    pub check_value: &'a (dyn Fn(&str, &Value) -> bool + Sync),
    /// The key a trace ref draws, when it can be traced.
    pub trace_key: &'a (dyn Fn(&Value) -> Option<String> + Sync),
    /// An svg's moves: the key a move names, or None.
    pub move_key: Option<&'a MoveKey<'a>>,
    /// An svg's moves: whether a move's target is a transform it can play.
    pub move_valid: Option<&'a TransformCheck<'a>>,
    /// An svg's morphs: whether path `id` can morph into `target` from this state.
    pub morph: Option<&'a MorphCheck<'a>>,
    /// An svg's moves and morphs before any step: those a continued picture carries from the scene before.
    pub initial_transforms: HashMap<String, String>,
    pub initial_shapes: HashMap<String, String>,
}

impl Refs for ClosureModel<'_> {
    fn resolve(&self, r: &Value) -> Option<Vec<String>> {
        Some((self.resolve)(r)).filter(|k| !k.is_empty())
    }
}

impl StateModel for ClosureModel<'_> {
    fn initial(&self, _scene: &Value) -> SceneState {
        let mut s = SceneState {
            hidden: self.initial_hidden.clone(),
            transforms: self.initial_transforms.clone(),
            shapes: self.initial_shapes.clone(),
            ..SceneState::default()
        };
        s.values.extend(self.initial_values.iter().cloned());
        s
    }
    fn set_prefixes(&self) -> &[&str] {
        self.set_prefixes
    }
    fn value_ok(&self, value: &Value, key: &str) -> bool {
        (self.check_value)(key, value)
    }
    fn show_prefixes(&self) -> Option<&[&str]> {
        Some(self.show_prefixes)
    }
    fn tint_prefixes(&self) -> Option<&[&str]> {
        Some(self.tint_prefixes)
    }
    fn callout(&self) -> bool {
        true
    }
    fn trace_key(&self, _scene: &Value, entry: &str) -> Option<String> {
        (self.trace_key)(&Value::String(entry.to_string()))
    }
    /// An svg step's `move` (a transform, played across its `when` words) and `morph` (a path into another's shape).
    fn apply_extra(&self, _scene: &Value, step: &Value, next: &mut SceneState) {
        if let (Some(mv), Some(move_key), Some(move_valid)) =
            (step.get("move").and_then(Value::as_object), self.move_key, self.move_valid)
        {
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
                if move_valid(to) {
                    next.transforms.insert(key.clone(), to.trim().to_string());
                    if let Some(w) = when {
                        next.spans.insert(key, w);
                    }
                }
            }
        }
        if let (Some(morph), Some(check)) = (step.get("morph").and_then(Value::as_object), self.morph) {
            for (id, target) in morph {
                let Some(target) = target.as_str() else { continue };
                if check(next, id, target) {
                    let key = format!("s:{id}");
                    if target == id {
                        next.shapes.remove(&key);
                    } else {
                        next.shapes.insert(key, target.to_string());
                    }
                }
            }
        }
    }
}
