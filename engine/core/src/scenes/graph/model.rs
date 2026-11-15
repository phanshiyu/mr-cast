//! The `graph` entry of MODELS in shared/state-steps.mjs: a node's badge and a table cell are values a step sets, nodes,
//! edges and table rows show and hide, and nodes, edges, groups, rows and cells take tints.

use crate::marks::Refs;
use crate::states::{SceneState, StateModel, list};
use crate::targets::graph::{ambiguous_index, resolve};
use serde_json::Value;

/// A value a step sets: text, or a table cell that strikes an old value beside a new one.
#[derive(Clone, Debug, PartialEq)]
pub enum Val {
    Text(String),
    Change(String, String),
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

/// A state's value under `key` as a badge or a cell reads it.
pub fn val(st: &SceneState, key: &str) -> Option<Val> {
    let v = st.values.get(key)?;
    if key.starts_with("b:") { scalar(v).map(Val::Text) } else { cell_val(v) }
}

/// The graph model, bound to its scene.
pub struct Model<'a>(pub &'a Value);

impl Refs for Model<'_> {
    fn resolve(&self, r: &Value) -> Option<Vec<String>> {
        resolve(self.0, r)
    }
}

impl StateModel for Model<'_> {
    fn initial(&self, scene: &Value) -> SceneState {
        let mut state = SceneState::default();
        for n in list(scene, "nodes") {
            if let Some(id) = n.get("id").and_then(Value::as_str) {
                let badge = n.get("badge").and_then(scalar).unwrap_or_default();
                state.values.set(format!("b:{id}"), Value::String(badge));
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
        if let Some(t) = scene.get("table").filter(|t| !t.is_null()) {
            let columns = list(t, "columns").len();
            for (i, row) in list(t, "rows").iter().enumerate() {
                let cells = list(row, "cells");
                for c in 0..columns {
                    let v =
                        cells.get(c).filter(|v| cell_val(v).is_some()).cloned().unwrap_or(Value::String(String::new()));
                    state.values.set(format!("x:{i}/{c}"), v);
                }
                if row.get("hidden") == Some(&Value::Bool(true)) {
                    state.hidden.insert(format!("r:{i}"));
                }
            }
        }
        state
    }
    fn set_prefixes(&self) -> &[&str] {
        &["n:", "x:"]
    }
    fn set_key(&self, named: &str) -> String {
        named.strip_prefix("n:").map_or(named.to_string(), |id| format!("b:{id}"))
    }
    fn value_ok(&self, value: &Value, key: &str) -> bool {
        if key.starts_with("b:") { scalar(value).is_some() } else { cell_val(value).is_some() }
    }
    fn show_prefixes(&self) -> Option<&[&str]> {
        Some(&["n:", "e:", "r:"])
    }
    fn tint_prefixes(&self) -> Option<&[&str]> {
        Some(&["n:", "e:", "g:", "r:", "x:"])
    }
    fn tint_expand(&self, scene: &Value, key: &str) -> Vec<String> {
        if !key.starts_with("g:") {
            return vec![key.to_string()];
        }
        list(scene, "nodes")
            .iter()
            .filter(|n| n.get("group").and_then(Value::as_str).is_some_and(|g| format!("g:{g}") == key))
            .filter_map(|n| n.get("id").and_then(Value::as_str).map(|id| format!("n:{id}")))
            .collect()
    }
    fn ambiguous(&self, scene: &Value, r: &Value) -> bool {
        ambiguous_index(scene, r)
    }
    fn callout(&self) -> bool {
        true
    }
}
