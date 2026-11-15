//! What the scenes whose steps change what they show share (`array` and `memory`): their state at each step
//! (shared/state-steps.mjs), what a step's `focus` names (shared/targets.mjs), where a frame is between two states
//! (src/utils/stateTrack.ts), a tint's blend (src/utils/tint.ts) and the callout box in the header
//! (src/components/HeaderCallout.tsx, src/fit/callout.ts).
//!
//! Only the models of `array` and `memory` are here. Validation problems are not reported: a change that names
//! nothing is skipped, as `walkStates` skips it.

use crate::anim::{CLAMP, interpolate};
use crate::chrome::fittext::{TextOpts, draw_fit, fit_height};
use crate::chrome::shell::Aside;
use crate::display::{BoxStyle, DisplayList, Shadow};
use crate::steps::{Emphasis, Spotlight, current_step, step_move};
use crate::textfit::{Fit, Slot, fit_text};
use crate::theme::{ACCENT_GLOW, ACCENT_SOFT, BORDER_STRONG, RAISED, TEXT, tone};
use crate::timing::{STEP_SETTLE_FRAMES, Segment, index_range};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/// `String(v)` for the values a scene holds.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.as_i64().map(|i| i.to_string()).unwrap_or_else(|| {
            let f = n.as_f64().unwrap_or(0.0);
            if f.fract() == 0.0 && f.abs() < 1e21 { format!("{}", f as i64) } else { format!("{f}") }
        }),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".into(),
        Value::Array(a) => a.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// A list field, empty when absent or not a list.
pub fn list<'a>(v: &'a Value, field: &str) -> &'a [Value] {
    v.get(field).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// A text or finite number.
pub fn is_text(v: &Value) -> bool {
    v.is_string() || v.is_number()
}

/// A memory value that points at an object: `{ "ref": "c1" }`.
pub fn is_pointer(v: &Value) -> bool {
    v.get("ref").is_some_and(Value::is_string) && v.is_object()
}

/// The `ref` of a pointer value.
pub fn pointer_ref(v: &Value) -> Option<&str> {
    if is_pointer(v) { v.get("ref").and_then(Value::as_str) } else { None }
}

/// Two values are the same when they read the same, or point at the same object (`sameValue`).
pub fn same_value(a: Option<&Value>, b: Option<&Value>) -> bool {
    let pa = a.is_some_and(is_pointer);
    let pb = b.is_some_and(is_pointer);
    if pa || pb {
        return pa && pb && pointer_ref(a.unwrap()) == pointer_ref(b.unwrap());
    }
    a.map(js_string).unwrap_or_else(|| "undefined".into()) == b.map(js_string).unwrap_or_else(|| "undefined".into())
}

/// A JSON object's entries or a list of [name, value] pairs, in order (`memoryMembers`, `tintEntries`). The
/// engine's props keep these as pairs, so the order written survives.
pub fn ordered_entries(v: &Value) -> Vec<(String, Value)> {
    match v {
        Value::Array(a) => a
            .iter()
            .filter_map(|p| {
                let p = p.as_array()?;
                Some((p.first()?.as_str()?.to_string(), p.get(1).cloned().unwrap_or(Value::Null)))
            })
            .collect(),
        Value::Object(m) => js_order(m),
        _ => Vec::new(),
    }
}

/// An object's entries as `Object.entries` lists them: names that read as array indexes first, ascending.
fn js_order(m: &Map<String, Value>) -> Vec<(String, Value)> {
    let index = |k: &str| k.parse::<u32>().ok().filter(|n| n.to_string() == k);
    let mut ints: Vec<_> = m.iter().filter(|(k, _)| index(k).is_some()).collect();
    ints.sort_by_key(|(k, _)| index(k));
    ints.into_iter().chain(m.iter().filter(|(k, _)| index(k).is_none())).map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// The key of cell `i` of the array named `name` (shared/arrays.mjs `cellKey`).
pub fn cell_key(name: &str, i: usize) -> String {
    if name.is_empty() { format!("c:{i}") } else { format!("c:{name}/{i}") }
}

/// The key of a whole named array.
pub fn row_key(name: &str) -> String {
    format!("a:{name}")
}

/// The key of a memory frame's variable (`kind` "v") or an object's field ("f").
pub fn member_key(kind: &str, owner: &str, name: &str) -> String {
    format!("{kind}:{}/{name}", owner.replace('%', "%25").replace('/', "%2F"))
}

/// A member key's owner, its owner's key, and its name.
pub fn split_member_key(key: &str) -> (String, String, String) {
    let slash = key.find('/').unwrap_or(key.len());
    let owner = key.get(2..slash).unwrap_or("").replace("%2F", "/").replace("%25", "%");
    let owner_key = format!("{}:{owner}", if key.starts_with("v:") { "fr" } else { "o" });
    (owner, owner_key, key.get(slash + 1..).unwrap_or("").to_string())
}

/// One array of an `array` scene (`arrayRows`).
pub struct ArrayRow {
    pub name: String,
    pub label: Option<String>,
    pub values: Vec<Value>,
    pub splits: Vec<i64>,
    pub hidden: bool,
}

/// The scene's arrays in order; the one array of `values` is named "".
pub fn array_rows(scene: &Value) -> Vec<ArrayRow> {
    let splits = |v: &Value| list(v, "splits").iter().filter_map(Value::as_i64).collect::<Vec<_>>();
    let text = |v: Option<&Value>| v.and_then(Value::as_str).map(str::to_string);
    if let Some(arrays) = scene.get("arrays").and_then(Value::as_array) {
        return arrays
            .iter()
            .map(|a| {
                let name = a.get("name").filter(|n| !n.is_null()).map(js_string).unwrap_or_default();
                ArrayRow {
                    label: text(a.get("label")).or_else(|| a.get("name").map(js_string)),
                    name,
                    values: list(a, "values").to_vec(),
                    splits: splits(a),
                    hidden: a.get("hidden") == Some(&Value::Bool(true)),
                }
            })
            .collect();
    }
    vec![ArrayRow {
        name: String::new(),
        label: text(scene.get("label")),
        values: list(scene, "values").to_vec(),
        splits: splits(scene),
        hidden: false,
    }]
}

/// The array a pointer or range sits on: its own `array`, else the first (`markerRow`).
pub fn marker_row(scene: &Value, marker: &Value) -> String {
    if scene.get("arrays").is_some_and(Value::is_array) {
        marker
            .get("array")
            .filter(|a| !a.is_null())
            .map(js_string)
            .unwrap_or_else(|| array_rows(scene).first().map(|r| r.name.clone()).unwrap_or_default())
    } else {
        String::new()
    }
}

/// Values by item key, in the order they were first set (a JS object's order).
#[derive(Clone, Debug, Default)]
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
    pub fn iter(&self) -> impl Iterator<Item = (&String, &Value)> {
        self.order.iter().map(|k| (k, &self.map[k]))
    }
}

/// A scene's state at one step (`SceneState`).
#[derive(Clone, Debug, Default)]
pub struct SceneState {
    pub values: Values,
    pub places: HashMap<String, (f64, f64)>,
    pub hidden: HashSet<String>,
    pub tints: HashMap<String, String>,
    pub callout: String,
}

fn initial(scene: &Value, ty: &str) -> SceneState {
    let mut st = SceneState::default();
    if ty == "array" {
        let marker = |kind: &str, item: &Value, from: &str, to: &str| {
            let name = item.get("name").map(js_string).unwrap_or_default();
            let num = |f: &str| item.get(f).and_then(Value::as_f64).unwrap_or(0.0);
            (format!("{kind}:{name}"), (num(from), num(to)), item.get("hidden") == Some(&Value::Bool(true)))
        };
        let markers: Vec<_> = list(scene, "pointers")
            .iter()
            .map(|p| marker("ptr", p, "at", "at"))
            .chain(list(scene, "ranges").iter().map(|r| marker("rg", r, "from", "to")))
            .collect();
        for a in array_rows(scene) {
            for (i, v) in a.values.iter().enumerate() {
                st.values.set(cell_key(&a.name, i), v.clone());
            }
            if a.hidden {
                st.hidden.insert(row_key(&a.name));
            }
        }
        for (key, place, hidden) in markers {
            st.places.insert(key.clone(), place);
            if hidden {
                st.hidden.insert(key);
            }
        }
    } else {
        let owners = list(scene, "frames")
            .iter()
            .map(|f| ("fr", "v", f.get("name"), f.get("vars"), f))
            .chain(list(scene, "objects").iter().map(|o| ("o", "f", o.get("id"), o.get("fields"), o)));
        for (prefix, kind, owner, members, item) in owners {
            let owner = owner.map(js_string).unwrap_or_default();
            for (name, value) in members.map(ordered_entries).unwrap_or_default() {
                st.values.set(member_key(kind, &owner, &name), value);
            }
            if item.get("hidden") == Some(&Value::Bool(true)) {
                st.hidden.insert(format!("{prefix}:{owner}"));
            }
        }
    }
    st.callout = scene.get("callout").and_then(Value::as_str).unwrap_or("").to_string();
    st
}

const TINTS: [&str; 7] = ["neutral", "accent", "good", "bad", "warn", "dim", "clear"];

/// The one item key `ref` names, when it is of a kind in `prefixes`.
fn one_key(scene: &Value, r: &Value, prefixes: &[&str]) -> Option<String> {
    let keys = resolve_ref(scene, r)?;
    (keys.len() == 1 && prefixes.iter().any(|p| keys[0].starts_with(p))).then(|| keys[0].clone())
}

fn apply_tints(scene: &Value, record: Option<&Value>, next: &mut SceneState) {
    // Only an array scene takes a tint.
    if scene.get("type").and_then(Value::as_str) != Some("array") {
        return;
    }
    let Some(record) = record else { return };
    for (r, tint) in ordered_entries(record) {
        let Some(keys) = resolve_ref(scene, &Value::String(r)) else { continue };
        if keys.is_empty() || !keys.iter().all(|k| k.starts_with("c:") || k.starts_with("a:")) {
            continue;
        }
        let named: Vec<String> = keys
            .into_iter()
            .flat_map(|k| match k.strip_prefix("a:") {
                Some(name) => array_rows(scene)
                    .iter()
                    .find(|a| a.name == name)
                    .map(|a| (0..a.values.len()).map(|i| cell_key(name, i)).collect())
                    .unwrap_or_default(),
                None => vec![k],
            })
            .collect();
        let Some(tint) = tint.as_str().filter(|t| TINTS.contains(t)) else { continue };
        for key in named {
            if tint == "clear" {
                next.tints.remove(&key);
            } else {
                next.tints.insert(key, tint.to_string());
            }
        }
    }
}

fn int_like(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64),
        _ => None,
    }
}

/// Where a step moves a pointer or range of an array scene to, as (key, place).
fn array_move(scene: &Value, name: &str, value: &Value) -> Option<(String, (f64, f64))> {
    let length = |marker: &Value| {
        let row = marker_row(scene, marker);
        array_rows(scene).iter().find(|a| a.name == row).map_or(0, |a| a.values.len()) as i64
    };
    if let Some(p) = list(scene, "pointers").iter().find(|p| p.get("name").and_then(Value::as_str) == Some(name)) {
        let n = length(p);
        let at = match value.as_str() {
            Some(s) if s.trim().parse::<i64>().is_ok() => s.trim().parse::<i64>().ok(),
            _ => int_like(value),
        }?;
        return (at >= -1 && at <= n).then(|| (format!("ptr:{name}"), (at as f64, at as f64)));
    }
    let r = list(scene, "ranges").iter().find(|r| r.get("name").and_then(Value::as_str) == Some(name))?;
    let n = length(r);
    let (a, b) = index_range(value)?;
    ((b as i64) < n).then(|| (format!("rg:{name}"), (a as f64, b as f64)))
}

/// A set value a scene accepts (`checkValue`).
fn check_value(scene: &Value, value: &Value) -> bool {
    if is_text(value) {
        return true;
    }
    if scene.get("type").and_then(Value::as_str) != Some("memory") {
        return false;
    }
    let Some(target) = pointer_ref(value).filter(|_| value.as_object().is_some_and(|o| o.len() == 1)) else {
        return false;
    };
    list(scene, "objects").iter().any(|o| o.get("id").and_then(Value::as_str) == Some(target))
}

/// Every state of an `array` or `memory` scene: `[initial, during step 0, during step 1, ...]`
/// (`sceneStates`). Any other type has none.
pub fn scene_states(scene: &Value) -> Vec<SceneState> {
    let ty = scene.get("type").and_then(Value::as_str).unwrap_or("");
    if ty != "array" && ty != "memory" {
        return Vec::new();
    }
    let mut state = initial(scene, ty);
    apply_tints(scene, scene.get("tint"), &mut state);
    let mut states = vec![state.clone()];
    for step in list(scene, "steps") {
        let mut next = state.clone();
        let record = |field: &str| step.get(field).and_then(Value::as_object).map(js_order).unwrap_or_default();
        let (set_prefixes, show_prefixes): (&[&str], &[&str]) =
            if ty == "array" { (&["c:"], &["ptr:", "rg:", "a:"]) } else { (&["v:", "f:"], &["fr:", "o:"]) };
        for (r, value) in record("set") {
            let Some(key) = one_key(scene, &Value::String(r), set_prefixes) else { continue };
            if check_value(scene, &value) && !same_value(next.values.get(&key), Some(&value)) {
                next.values.set(key, value);
            }
        }
        if ty == "array" {
            for (name, value) in record("move") {
                if let Some((key, place)) = array_move(scene, &name, &value) {
                    next.places.insert(key, place);
                }
            }
        }
        for field in ["show", "hide"] {
            let Some(refs) = step.get(field).and_then(Value::as_array) else { continue };
            if !refs.iter().all(|r| r.is_string() || int_like(r).is_some()) {
                continue;
            }
            for r in refs {
                let Some(key) = one_key(scene, r, show_prefixes) else { continue };
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

/// The item keys a ref lights in an `array` or `memory` scene, or None when it names nothing (`resolveRef`).
pub fn resolve_ref(scene: &Value, r: &Value) -> Option<Vec<String>> {
    let ty = scene.get("type").and_then(Value::as_str)?;
    let resolve = |r: &Value| match ty {
        "array" => resolve_array(scene, r),
        "memory" => resolve_memory(scene, r),
        _ => None,
    };
    resolve(r).or_else(|| {
        let s = r.as_str()?.trim();
        if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) {
            resolve(&Value::from(s.parse::<u64>().ok()?))
        } else {
            None
        }
    })
}

fn resolve_array(scene: &Value, r: &Value) -> Option<Vec<String>> {
    if let Some(s) = r.as_str() {
        for (prefix, items, key) in [("ptr:", "pointers", "ptr"), ("range:", "ranges", "rg"), ("array:", "arrays", "a")]
        {
            if let Some(rest) = s.strip_prefix(prefix) {
                let name = rest.trim();
                return list(scene, items)
                    .iter()
                    .any(|i| i.get("name").and_then(Value::as_str) == Some(name))
                    .then(|| vec![format!("{key}:{name}")]);
            }
        }
    }
    let rows = array_rows(scene);
    if !scene.get("arrays").is_some_and(Value::is_array) {
        let (a, b) = index_range(r)?;
        return (b < rows[0].values.len()).then(|| (a..=b).map(|i| cell_key("", i)).collect());
    }
    // "left[3]" or "left[0-1]": the array's name, then an index or a range in brackets.
    let s = r.as_str()?.trim_end();
    let body = s.strip_suffix(']')?;
    let at = body.rfind('[')?;
    let inner = &body[at + 1..];
    if inner.contains(']') {
        return None;
    }
    let row = rows.iter().find(|a| a.name == body[..at].trim())?;
    let inner_t = inner.trim();
    let range = if !inner_t.is_empty() && inner_t.bytes().all(|b| b.is_ascii_digit()) {
        index_range(&Value::from(inner_t.parse::<u64>().ok()?))
    } else {
        index_range(&Value::String(inner.to_string()))
    }?;
    (range.1 < row.values.len()).then(|| (range.0..=range.1).map(|i| cell_key(&row.name, i)).collect())
}

fn resolve_memory(scene: &Value, r: &Value) -> Option<Vec<String>> {
    let s = r.as_str()?;
    let frames = list(scene, "frames");
    let objects = list(scene, "objects");
    if let Some(name) = s.strip_prefix("frame:") {
        let name = name.trim();
        return frames
            .iter()
            .any(|f| f.get("name").and_then(Value::as_str) == Some(name))
            .then(|| vec![format!("fr:{name}")]);
    }
    if objects.iter().any(|o| o.get("id").and_then(Value::as_str) == Some(s)) {
        return Some(vec![format!("o:{s}")]);
    }
    let has = |members: Option<&Value>, key: &str| {
        members.map(ordered_entries).unwrap_or_default().iter().any(|(name, _)| name == key)
    };
    for (at, _) in s.match_indices('.') {
        if at == 0 {
            continue;
        }
        let (owner, name) = (&s[..at], &s[at + 1..]);
        if frames.iter().any(|f| f.get("name").and_then(Value::as_str) == Some(owner) && has(f.get("vars"), name)) {
            return Some(vec![member_key("v", owner, name)]);
        }
        if objects.iter().any(|o| o.get("id").and_then(Value::as_str) == Some(owner) && has(o.get("fields"), name)) {
            return Some(vec![member_key("f", owner, name)]);
        }
    }
    None
}

/// For each item key, the steps whose `focus` lights it, in order (`targetSteps`).
pub fn target_steps(scene: &Value) -> HashMap<String, Vec<usize>> {
    let mut out: HashMap<String, Vec<usize>> = HashMap::new();
    for (k, step) in list(scene, "steps").iter().enumerate() {
        let refs: Vec<Value> = match step.get("focus") {
            Some(Value::Array(a)) => a.clone(),
            Some(v) => vec![v.clone()],
            None => vec![Value::Null],
        };
        let mut seen: Vec<String> = Vec::new();
        for key in refs.iter().flat_map(|r| resolve_ref(scene, r).unwrap_or_default()) {
            if !seen.contains(&key) {
                seen.push(key);
            }
        }
        for key in seen {
            out.entry(key).or_default().push(k);
        }
    }
    out
}

/// Emphasis by item key for a scene whose steps take `focus` (`focusSpotlight`).
pub struct Focus<'a> {
    spot: Spotlight,
    steps: &'a HashMap<String, Vec<usize>>,
}

impl<'a> Focus<'a> {
    pub fn new(steps: &'a HashMap<String, Vec<usize>>, segments: &[Segment], frame: f64) -> Focus<'a> {
        let starts: Vec<f64> = segments.iter().skip(1).map(|s| s.from).collect();
        Focus { spot: Spotlight::new(frame, &starts), steps }
    }
    pub fn of(&self, key: &str) -> Emphasis {
        self.spot.emphasis(self.steps.get(key).map_or(&[][..], Vec::as_slice))
    }
}

/// The stronger of two emphases, part by part (`brighter`).
pub fn brighter(a: Emphasis, b: Emphasis) -> Emphasis {
    Emphasis { opacity: a.opacity.max(b.opacity), bar: a.bar.max(b.bar), glow: a.glow.max(b.glow) }
}

/// An item at least as bright as the brightest of `others` (`asBrightAs`).
pub fn as_bright_as(own: Emphasis, others: &[Emphasis]) -> Emphasis {
    Emphasis { opacity: others.iter().fold(own.opacity, |m, e| m.max(e.opacity)), ..own }
}

/// Frames a changed item stays lit once it has settled.
const LIT_FRAMES: f64 = 40.0;

/// Where a state scene is at a frame: the state before the current step's changes and the state after them,
/// how far they have gone (`t`), and the glow on what the step changed (`lit`).
pub struct StateFrame<'a> {
    pub before: &'a SceneState,
    pub now: &'a SceneState,
    pub t: f64,
    pub lit: f64,
}

pub fn state_frame<'a>(states: &'a [SceneState], segments: &[Segment], frame: f64) -> StateFrame<'a> {
    let Some(k) = current_step(segments, frame).filter(|&k| states.get(k + 1).is_some()) else {
        return StateFrame { before: &states[0], now: &states[0], t: 1.0, lit: 0.0 };
    };
    let from = segments[k + 1].from;
    let settled = from + STEP_SETTLE_FRAMES;
    StateFrame {
        before: &states[k],
        now: &states[k + 1],
        t: step_move(frame, from),
        lit: interpolate(frame, &[from, settled, settled + LIT_FRAMES], &[0.0, 1.0, 0.0], CLAMP),
    }
}

impl StateFrame<'_> {
    /// Whether the current step changed the value under `key`.
    pub fn value_changed(&self, key: &str) -> bool {
        !same_value(self.before.values.get(key), self.now.values.get(key))
    }
    /// How shown an item is, 0 to 1.
    pub fn shown_of(&self, key: &str) -> f64 {
        let (was, is) = (f64::from(!self.before.hidden.contains(key)), f64::from(!self.now.hidden.contains(key)));
        was + (is - was) * self.t
    }
    /// A place partway from where the step found it to where it puts it.
    pub fn place_of(&self, key: &str) -> (f64, f64) {
        let now = self.now.places.get(key).copied().unwrap_or((0.0, 0.0));
        let was = self.before.places.get(key).copied().unwrap_or(now);
        (was.0 + (now.0 - was.0) * self.t, was.1 + (now.1 - was.1) * self.t)
    }
}

/// How a tinted item looks partway through a step: each tone's share of its fill, and how far it has faded.
pub struct TintMix {
    pub tones: Vec<(String, f64)>,
    pub dim: f64,
}

pub fn tint_mix(s: &StateFrame, key: &str) -> TintMix {
    let (was, now) = (s.before.tints.get(key), s.now.tints.get(key));
    let is_dim = |t: Option<&String>| f64::from(t.is_some_and(|t| t == "dim"));
    let dim = is_dim(was) + (is_dim(now) - is_dim(was)) * s.t;
    let tone_of = |t: Option<&String>| t.filter(|t| *t != "dim").cloned();
    let (a, b) = (tone_of(was), tone_of(now));
    if a == b {
        return TintMix { tones: a.map(|a| vec![(a, 1.0)]).unwrap_or_default(), dim };
    }
    let mut tones = Vec::new();
    tones.extend(a.map(|a| (a, 1.0 - s.t)));
    tones.extend(b.map(|b| (b, s.t)));
    TintMix { tones, dim }
}

/// The strongest tone in a mix.
pub fn main_tone(mix: &TintMix) -> Option<&str> {
    let mut best: Option<&(String, f64)> = None;
    for t in &mix.tones {
        if best.is_none_or(|b| t.1 > b.1) {
            best = Some(t);
        }
    }
    best.map(|b| b.0.as_str())
}

/// Opacity a dimmed item keeps.
pub fn dim_opacity(mix: &TintMix) -> f64 {
    1.0 - 0.5 * mix.dim
}

/// A tone's fill on a tinted item (`tintFill`: the tone's colour at 0x40 alpha).
pub fn tint_fill(tone_name: &str) -> crate::color::Color {
    tone(tone_name).0.alpha(64.0 / 255.0)
}

const CALLOUT_W: f64 = 560.0;
const CALLOUT_PAD_X: f64 = 22.0;
const CALLOUT_PAD_Y: f64 = 12.0;

/// The scene's callout, fitted for the header: every text it ever shows, and the box's size.
pub struct HeaderCallout {
    fits: HashMap<String, Fit>,
    pub width: f32,
    pub height: f32,
}

impl HeaderCallout {
    /// None when no state shows a callout.
    pub fn new(scene: &Value) -> Option<HeaderCallout> {
        let texts = std::iter::once(scene.get("callout"))
            .chain(list(scene, "steps").iter().map(|s| s.get("callout")))
            .filter_map(|c| c.and_then(Value::as_str).filter(|c| !c.is_empty()));
        let mut fits = HashMap::new();
        for t in texts {
            fits.entry(t.to_string())
                .or_insert_with(|| fit_text(t, &Slot::named("headerCallout", CALLOUT_W - 2.0 * CALLOUT_PAD_X)));
        }
        if fits.is_empty() {
            return None;
        }
        let width = fits.values().map(|f| f.width).fold(0.0, f64::max) + 2.0 * CALLOUT_PAD_X;
        let height = fits.values().map(|f| f.height).fold(0.0, f64::max) + 2.0 * CALLOUT_PAD_Y;
        Some(HeaderCallout { fits, width: width as f32, height: height as f32 })
    }

    /// Draws the box with its right edge at `right` and its top at `top`.
    pub fn draw(&self, dl: &mut DisplayList, right: f32, top: f32, s: &StateFrame) {
        let (was, now) = (&s.before.callout, &s.now.callout);
        let shown = f64::from(!was.is_empty()) + (f64::from(!now.is_empty()) - f64::from(!was.is_empty())) * s.t;
        let changed = was != now;
        let glow = if changed { s.lit as f32 } else { 0.0 };
        let (w, h) = (self.width, self.height);
        let x = right - w;
        let mut style = BoxStyle::fill(RAISED)
            .radius(14.0)
            .border(if glow > 0.0 { crate::theme::ACCENT } else { BORDER_STRONG }, 1.5);
        if glow > 0.0 {
            let mut ring = Shadow::new(0.0, 0.0, 0.0, ACCENT_SOFT);
            ring.spread = 3.0 * glow;
            style = style.shadow(ring).shadow(Shadow::new(0.0, 0.0, 30.0 * glow, ACCENT_GLOW));
        } else {
            style = style.shadow(Shadow::new(0.0, 10.0, 26.0, crate::color::Color::rgba8(0, 0, 0, 0.35)));
        }
        let opacity = shown.clamp(0.0, 1.0) as f32;
        if opacity <= 0.0 {
            return;
        }
        let (iw, ih) = (w - 3.0, h - 3.0);
        let text = |dl: &mut DisplayList, value: &str, opacity: f64| {
            if value.is_empty() || opacity <= 0.0 {
                return;
            }
            let Some(fit) = self.fits.get(value) else { return };
            dl.group(|dl| {
                dl.fade(opacity as f32);
                let fh = fit_height(fit, crate::chrome::fittext::LineHeight::Fit);
                draw_fit(dl, fit, x + 1.5, top + 1.5 + (ih - fh) / 2.0, TextOpts::new(TEXT).centered(iw));
            });
        };
        let body = |dl: &mut DisplayList| {
            dl.rect(x, top, w, h, style.clone());
            if changed {
                text(dl, was, 1.0 - s.t);
                text(dl, now, s.t);
            } else {
                text(dl, now, 1.0);
            }
        };
        if opacity < 0.999 {
            dl.push_layer(opacity);
            body(dl);
            dl.pop_layer();
        } else {
            body(dl);
        }
    }

    /// The header's aside for `draw`: its height and a drawing function.
    pub fn aside<'a>(&'a self, draw: &'a dyn Fn(&mut DisplayList, f32, f32)) -> Aside<'a> {
        Aside { height: self.height, draw }
    }
}

/// An alpha as `#rrggbbaa` carries it: rounded to eight bits.
pub fn hex_alpha(alpha: f64) -> f32 {
    ((alpha.clamp(0.0, 1.0) * 255.0).round() / 255.0) as f32
}
