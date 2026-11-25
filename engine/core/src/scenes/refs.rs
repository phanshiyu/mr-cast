//! Dispatch from a scene's type to its refs resolution (`TARGETS[type].resolve`). It lives in scenes, above the
//! `targets` it dispatches to, so that `targets` imports no scene module.

use crate::marks::Refs;
use crate::targets;
use serde_json::Value;
use std::collections::HashMap;

/// A type's own resolution (`TARGETS[type].resolve`), without the index-as-text fallback.
pub fn resolve(scene: &Value, r: &Value) -> Option<Vec<String>> {
    match scene.get("type").and_then(Value::as_str)? {
        "graph" | "er" | "state" => targets::graph::resolve(scene, r),
        "sequence" | "timeline" | "layers" => targets::diagrams::resolve(scene, r),
        "array" | "memory" => crate::arrays::resolve(scene, r),
        "text" => super::text::resolve_value(scene, r),
        "table" => super::table::resolve(scene, r),
        "chart" => super::chart::resolve(scene, r),
        _ => None,
    }
}

/// The item keys a ref names, or None when the scene has nothing it names (`resolveRef`): an index written as text,
/// "2", means the index when nothing in the scene is named "2".
pub fn resolve_ref(scene: &Value, r: &Value) -> Option<Vec<String>> {
    targets::with_fallback(r, |r| resolve(scene, r))
}

/// A scene's refs, for pen marks, ink and the camera (`marks::Refs`), by its type's entry here.
pub struct SceneRefs<'a>(pub &'a Value);

impl Refs for SceneRefs<'_> {
    fn resolve(&self, r: &Value) -> Option<Vec<String>> {
        resolve(self.0, r)
    }
}

/// `stepTargets` by the scene type's entry.
pub fn step_targets(scene: &Value) -> Vec<Vec<String>> {
    targets::step_targets_with(scene, |r| resolve(scene, r))
}

/// `targetSteps` by the scene type's entry.
pub fn target_steps(scene: &Value) -> HashMap<String, Vec<usize>> {
    targets::target_steps_with(scene, |r| resolve(scene, r))
}
