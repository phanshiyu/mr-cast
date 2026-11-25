//! What a step's `focus` can point at: a port of shared/targets.mjs. A ref resolves to item keys such as "n:api",
//! "m:2" or "b:0"; a scene lights every item whose key a step's refs resolve to, and pen marks, ink and the camera
//! aim at the same keys. Each scene type's entry of TARGETS lives in a submodule here or, for types that resolve
//! through their own typed layout, in the scene's module; `scenes::refs::resolve_ref` dispatches on the scene's type.

pub mod diagrams;
pub mod graph;

use serde_json::Value;
use std::collections::HashMap;

/// `resolveRef` over any resolution.
pub fn with_fallback(r: &Value, resolve: impl Fn(&Value) -> Option<Vec<String>>) -> Option<Vec<String>> {
    resolve(r).or_else(|| {
        let t = r.as_str()?.trim();
        (!t.is_empty() && t.bytes().all(|b| b.is_ascii_digit()))
            .then(|| resolve(&Value::from(t.parse::<u64>().ok()?)))?
    })
}

/// A step's `focus` refs, one or a list (`focusRefs`).
pub fn focus_refs(step: &Value) -> Vec<&Value> {
    match step.get("focus") {
        Some(Value::Array(a)) => a.iter().collect(),
        None | Some(Value::Null) => Vec::new(),
        Some(v) => vec![v],
    }
}

/// Each step's focus as the item keys it lights, each once; refs that name nothing light nothing (`stepTargets`),
/// by any resolution with the index fallback.
pub fn step_targets_with(scene: &Value, resolve: impl Fn(&Value) -> Option<Vec<String>>) -> Vec<Vec<String>> {
    scene
        .get("steps")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice)
        .iter()
        .map(|step| {
            let mut keys: Vec<String> = Vec::new();
            for r in focus_refs(step) {
                for k in with_fallback(r, &resolve).unwrap_or_default() {
                    if !keys.contains(&k) {
                        keys.push(k);
                    }
                }
            }
            keys
        })
        .collect()
}

/// For each item key, the steps that light it, in order (`targetSteps`), by any resolution.
pub fn target_steps_with(
    scene: &Value,
    resolve: impl Fn(&Value) -> Option<Vec<String>>,
) -> HashMap<String, Vec<usize>> {
    let mut out: HashMap<String, Vec<usize>> = HashMap::new();
    for (k, keys) in step_targets_with(scene, resolve).into_iter().enumerate() {
        for key in keys {
            out.entry(key).or_default().push(k);
        }
    }
    out
}

/// `Number.isInteger(ref) && ref >= 0 && ref < count`, for a ref written as a number.
pub fn index_ref(v: &Value, count: usize) -> Option<usize> {
    v.as_f64().filter(|f| *f >= 0.0 && f.fract() == 0.0 && (*f as usize) < count).map(|f| f as usize)
}

/// A ref's text: strings as they are, numbers as `String(n)`.
pub fn ref_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}
