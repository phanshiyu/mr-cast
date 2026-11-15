//! The arrays of an `array` scene and the frames and objects of a `memory` scene: their item keys (shared/arrays.mjs and
//! the memory keys of shared/targets.mjs), what refs name in them (TARGETS), and how their steps change them (the
//! `array` and `memory` entries of MODELS in shared/state-steps.mjs).

use crate::marks::Refs;
use crate::states::{SceneState, StateModel, js_string, list, ordered_entries};
use crate::timing::index_range;
use serde_json::Value;

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

/// The item keys a ref names in an `array` or `memory` scene (`TARGETS.array` and `TARGETS.memory`).
pub fn resolve(scene: &Value, r: &Value) -> Option<Vec<String>> {
    match scene.get("type").and_then(Value::as_str)? {
        "array" => resolve_array(scene, r),
        "memory" => resolve_memory(scene, r),
        _ => None,
    }
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
    let has = |members: Option<&Value>, key: &str| ordered_entries(members).iter().any(|(name, _)| name == key);
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
            for (name, value) in ordered_entries(members) {
                st.values.set(member_key(kind, &owner, &name), value);
            }
            if item.get("hidden") == Some(&Value::Bool(true)) {
                st.hidden.insert(format!("{prefix}:{owner}"));
            }
        }
    }
    st
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

/// The `array` or `memory` entry of MODELS, bound to its scene.
pub struct Model<'a>(pub &'a Value);

impl Model<'_> {
    fn array(&self) -> bool {
        self.0.get("type").and_then(Value::as_str) == Some("array")
    }
}

impl Refs for Model<'_> {
    fn resolve(&self, r: &Value) -> Option<Vec<String>> {
        resolve(self.0, r)
    }
}

impl StateModel for Model<'_> {
    fn initial(&self, scene: &Value) -> SceneState {
        initial(scene, if self.array() { "array" } else { "memory" })
    }
    fn set_prefixes(&self) -> &[&str] {
        if self.array() { &["c:"] } else { &["v:", "f:"] }
    }
    fn value_ok(&self, value: &Value, _key: &str) -> bool {
        check_value(self.0, value)
    }
    fn show_prefixes(&self) -> Option<&[&str]> {
        Some(if self.array() { &["ptr:", "rg:", "a:"] } else { &["fr:", "o:"] })
    }
    fn tint_prefixes(&self) -> Option<&[&str]> {
        self.array().then_some(&["c:", "a:"][..])
    }
    fn tint_expand(&self, scene: &Value, key: &str) -> Vec<String> {
        match key.strip_prefix("a:") {
            Some(name) => array_rows(scene)
                .iter()
                .find(|a| a.name == name)
                .map(|a| (0..a.values.len()).map(|i| cell_key(name, i)).collect())
                .unwrap_or_default(),
            None => vec![key.to_string()],
        }
    }
    fn callout(&self) -> bool {
        true
    }
    fn apply_move(&self, scene: &Value, name: &str, value: &Value) -> Option<(String, (f64, f64))> {
        if self.array() { array_move(scene, name, value) } else { None }
    }
}
