//! The `graph`, `er` and `state` entries of TARGETS in shared/targets.mjs, with their pair refs ("a->b").

use crate::markup::plain_text;
use serde_json::Value;
use std::collections::HashSet;

/// A focus ref as a storyboard writes it: text, or a number.
#[derive(Clone, Debug, PartialEq)]
pub enum Ref {
    Text(String),
    Num(f64),
}

impl Ref {
    pub fn from_value(v: &Value) -> Option<Ref> {
        match v {
            Value::String(s) => Some(Ref::Text(s.clone())),
            Value::Number(n) => n.as_f64().map(Ref::Num),
            _ => None,
        }
    }
    fn text(&self) -> Option<&str> {
        match self {
            Ref::Text(s) => Some(s),
            Ref::Num(_) => None,
        }
    }
}

fn list<'a>(v: &'a Value, field: &str) -> &'a [Value] {
    v.get(field).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn str_of<'a>(v: &'a Value, field: &str) -> Option<&'a str> {
    v.get(field).and_then(Value::as_str)
}

/// `Number.isInteger(ref) && ref >= 0 && ref < count`.
fn index(r: &Ref, count: usize) -> Option<usize> {
    match r {
        Ref::Num(n) if n.fract() == 0.0 && *n >= 0.0 && (*n as usize) < count => Some(*n as usize),
        _ => None,
    }
}

/// An edge of a ref's pair.
pub struct Edge<'a> {
    pub from: &'a str,
    pub to: &'a str,
    pub undirected: bool,
}

/// Edges a pair ref names (`pairEdges`). "a->b" is an edge from a to b, or from b to a when the edge is
/// undirected; "a-b" and "a<->b" are an edge between them either way. Ids may contain "-", so every split is tried.
pub fn pair_edges(r: &Ref, edges: &[Edge], ids: &HashSet<&str>) -> Option<Vec<usize>> {
    let text = r.text()?;
    let directed = text.contains("->") && !text.contains("<->");
    let sep = if directed {
        "->"
    } else if text.contains("<->") {
        "<->"
    } else {
        "-"
    };
    let mut pairs: Vec<(&str, &str)> = Vec::new();
    for (at, _) in text.match_indices(sep) {
        if at == 0 {
            continue;
        }
        let (a, b) = (text[..at].trim(), text[at + sep.len()..].trim());
        if ids.contains(a) && ids.contains(b) {
            pairs.push((a, b));
        }
    }
    if pairs.is_empty() {
        return None;
    }
    let hits: Vec<usize> = edges
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            pairs
                .iter()
                .any(|&(a, b)| (e.from == a && e.to == b) || ((!directed || e.undirected) && e.from == b && e.to == a))
        })
        .map(|(i, _)| i)
        .collect();
    (!hits.is_empty()).then_some(hits)
}

/// The text a table row is named by in refs: its first cell, or the new value of a changed one.
fn row_name(row: &Value) -> String {
    let first = list(row, "cells").first();
    let s = match first {
        Some(Value::Object(o)) => o.get("after").map(js_string).unwrap_or_default(),
        Some(v) => js_string(v),
        None => String::new(),
    };
    plain_text(&s).trim().to_string()
}

/// `String(v)` for a JSON scalar.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// A graph table's row by index or by its first cell.
fn aside_row(table: &Value, name: &str) -> Option<usize> {
    let text = name.trim();
    let rows = list(table, "rows");
    if !text.is_empty()
        && text.chars().all(|c| c.is_ascii_digit())
        && let Ok(n) = text.parse::<usize>()
        && n < rows.len()
    {
        return Some(n);
    }
    rows.iter().position(|r| row_name(r) == text)
}

/// What a ref names in the table beside a graph: a row "row:A" or "row:0" ("r:0"), a column "col:Header" ("c:1"), or a
/// cell "Header@row" ("x:0/1"). `Some(None)` when it reads as one but names nothing, `None` when it does not read as one.
fn aside_ref(table: Option<&Value>, r: &Ref) -> Option<Option<Vec<String>>> {
    let table = table?;
    let text = r.text()?;
    let columns: Vec<&str> = list(table, "columns").iter().filter_map(Value::as_str).collect();
    if let Some(name) = text.strip_prefix("row:") {
        return Some(aside_row(table, name).map(|row| vec![format!("r:{row}")]));
    }
    if let Some(name) = text.strip_prefix("col:") {
        return Some(columns.iter().position(|c| *c == name.trim()).map(|col| vec![format!("c:{col}")]));
    }
    let at = text.rfind('@').filter(|&at| at > 0)?;
    let col = columns.iter().position(|c| *c == text[..at].trim())?;
    Some(aside_row(table, &text[at + 1..]).map(|row| vec![format!("x:{row}/{col}")]))
}

fn resolve_graph(scene: &Value, r: &Ref) -> Option<Vec<String>> {
    let nodes = list(scene, "nodes");
    let ids: HashSet<&str> = nodes.iter().filter_map(|n| str_of(n, "id")).collect();
    let edges = list(scene, "edges");
    if let Some(t) = r.text()
        && ids.contains(t)
    {
        return Some(vec![format!("n:{t}")]);
    }
    if let Some(cell) = aside_ref(scene.get("table").filter(|t| !t.is_null()), r) {
        return cell;
    }
    if let Some(name) = r.text().and_then(|t| t.strip_prefix("group:")) {
        let name = name.trim();
        return nodes.iter().any(|n| str_of(n, "group") == Some(name)).then(|| vec![format!("g:{name}")]);
    }
    if let Some(i) = index(r, edges.len()) {
        return Some(vec![format!("e:{i}")]);
    }
    let es: Vec<Edge> = edges
        .iter()
        .map(|e| Edge {
            from: str_of(e, "from").unwrap_or(""),
            to: str_of(e, "to").unwrap_or(""),
            undirected: matches!(str_of(e, "direction"), Some("both" | "none")),
        })
        .collect();
    pair_edges(r, &es, &ids).map(|v| v.into_iter().map(|i| format!("e:{i}")).collect())
}

fn resolve_er(scene: &Value, r: &Ref) -> Option<Vec<String>> {
    let entities = list(scene, "entities");
    let ids: HashSet<&str> = entities.iter().filter_map(|e| str_of(e, "id")).collect();
    let relations = list(scene, "relations");
    if let Some(t) = r.text()
        && ids.contains(t)
    {
        return Some(vec![format!("e:{t}")]);
    }
    if let Some(i) = index(r, relations.len()) {
        return Some(vec![format!("r:{i}")]);
    }
    if let Some(t) = r.text() {
        for (at, _) in t.match_indices('.') {
            if at == 0 {
                continue;
            }
            let Some(entity) = entities.iter().find(|e| str_of(e, "id") == Some(&t[..at])) else { continue };
            let name = &t[at + 1..];
            if let Some(f) = list(entity, "fields").iter().position(|f| str_of(f, "name") == Some(name)) {
                return Some(vec![format!("f:{}/{f}", str_of(entity, "id").unwrap_or(""))]);
            }
        }
    }
    let es: Vec<Edge> = relations
        .iter()
        .map(|e| Edge { from: str_of(e, "from").unwrap_or(""), to: str_of(e, "to").unwrap_or(""), undirected: true })
        .collect();
    pair_edges(r, &es, &ids).map(|v| v.into_iter().map(|i| format!("r:{i}")).collect())
}

fn resolve_state(scene: &Value, r: &Ref) -> Option<Vec<String>> {
    let ids: HashSet<&str> = list(scene, "states").iter().filter_map(|s| str_of(s, "id")).collect();
    let transitions = list(scene, "transitions");
    if let Some(t) = r.text()
        && ids.contains(t)
    {
        return Some(vec![format!("s:{t}")]);
    }
    if let Some(i) = index(r, transitions.len()) {
        return Some(vec![format!("t:{i}")]);
    }
    let es: Vec<Edge> = transitions
        .iter()
        .map(|e| Edge { from: str_of(e, "from").unwrap_or(""), to: str_of(e, "to").unwrap_or(""), undirected: false })
        .collect();
    if let Some(pair) = pair_edges(r, &es, &ids) {
        return Some(pair.into_iter().map(|i| format!("t:{i}")).collect());
    }
    let t = r.text()?;
    let labelled: Vec<String> = transitions
        .iter()
        .enumerate()
        .filter(|(_, tr)| str_of(tr, "label") == Some(t))
        .map(|(i, _)| format!("t:{i}"))
        .collect();
    (!labelled.is_empty()).then_some(labelled)
}

/// The item keys a ref names in a graph, er or state scene.
pub fn resolve(scene: &Value, r: &Value) -> Option<Vec<String>> {
    let r = Ref::from_value(r)?;
    match str_of(scene, "type")? {
        "graph" => resolve_graph(scene, &r),
        "er" => resolve_er(scene, &r),
        "state" => resolve_state(scene, &r),
        _ => None,
    }
}

/// In a graph with a table beside it, a bare number is an edge index. When the table has a row of that index
/// too, this says how to name each one (`ambiguousIndex`).
pub fn ambiguous_index(scene: &Value, r: &Value) -> bool {
    let Some(r) = Ref::from_value(r) else { return false };
    if str_of(scene, "type") != Some("graph") {
        return false;
    }
    let Some(table) = scene.get("table").filter(|t| !t.is_null()) else { return false };
    let nodes = list(scene, "nodes");
    let n = match r {
        Ref::Text(ref t)
            if !t.trim().is_empty()
                && t.trim().chars().all(|c| c.is_ascii_digit())
                && !nodes.iter().any(|n| str_of(n, "id") == Some(t.as_str())) =>
        {
            Ref::Num(t.trim().parse().unwrap_or(f64::NAN))
        }
        other => other,
    };
    index(&n, list(scene, "edges").len()).is_some() && index(&n, list(table, "rows").len()).is_some()
}
