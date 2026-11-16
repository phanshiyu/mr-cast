//! Line refs and focus ranges of a code scene: a port of shared/focus.mjs.

use crate::model::{DiffLine, Hunk, LineType};
use serde_json::Value;
use std::collections::BTreeSet;

/// Line numbers named by refs like 12 or "12-18"; malformed refs are skipped.
pub fn expand_line_refs(refs: &[Value]) -> BTreeSet<i64> {
    let mut out = BTreeSet::new();
    for r in refs {
        if let Some(n) = r.as_f64() {
            out.insert(n as i64);
            continue;
        }
        let s = match r {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        let parts: Vec<&str> = s.split('-').collect();
        let num = |p: &str| js_parse_int(p);
        let (Some(a), b) = (num(parts[0]), parts.get(1).map(|p| num(p))) else { continue };
        let b = match b {
            None => a,
            Some(Some(b)) => b,
            Some(None) => continue,
        };
        for n in a.min(b)..=a.max(b) {
            out.insert(n);
        }
    }
    out
}

/// `parseInt(s, 10)`: leading spaces and sign, then digits, ignoring the rest.
fn js_parse_int(s: &str) -> Option<i64> {
    let t = s.trim_start();
    let (neg, rest) = match t.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    let n: i64 = digits.parse().ok()?;
    Some(if neg { -n } else { n })
}

/// The focus ranges named by refs, ascending (`focusRanges`).
pub fn focus_ranges(refs: &[Value]) -> Vec<(i64, i64)> {
    let mut numbers: Vec<i64> = refs.iter().filter_map(|r| r.as_f64().map(|n| n as i64)).collect();
    numbers.sort();
    let mut pieces: Vec<(i64, i64)> = Vec::new();
    for n in numbers {
        match pieces.last_mut() {
            Some(last) if n <= last.1 + 1 => last.1 = last.1.max(n),
            _ => pieces.push((n, n)),
        }
    }
    for r in refs.iter().filter(|r| !r.is_number()) {
        let lines = expand_line_refs(std::slice::from_ref(r));
        if let (Some(a), Some(b)) = (lines.first(), lines.last()) {
            pieces.push((*a, *b));
        }
    }
    pieces.sort_by_key(|p| p.0);
    let mut ranges: Vec<(i64, i64)> = Vec::new();
    for (a, b) in pieces {
        match ranges.last_mut() {
            Some(last) if a <= last.1 => last.1 = last.1.max(b),
            _ => ranges.push((a, b)),
        }
    }
    ranges
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Side {
    Old,
    New,
}

/// A step's one range on its side (`stepRange`).
pub fn step_range(step: &Value) -> (Side, (i64, i64)) {
    let lines = step.get("lines").filter(|v| !v.is_null());
    let old = step.get("oldLines").filter(|v| !v.is_null());
    let side = if lines.is_none() && old.is_some() { Side::Old } else { Side::New };
    let r = if side == Side::Old { old } else { lines };
    let refs: Vec<Value> = r.cloned().into_iter().collect();
    (side, focus_ranges(&refs).first().copied().unwrap_or((0, 0)))
}

fn line_no(line: &DiffLine, side: Side) -> Option<i64> {
    match side {
        Side::Old => line.old_line,
        Side::New => line.new_line,
    }
}

/// The scene's focus ranges: one per step, else focusLinesAfter then focusLinesBefore (`sceneFocusRanges`).
pub fn scene_focus_ranges(scene: &Value) -> Vec<(Side, (i64, i64))> {
    if let Some(steps) = scene.get("steps").and_then(Value::as_array).filter(|s| !s.is_empty()) {
        return steps.iter().map(step_range).collect();
    }
    let refs = |k: &str| scene.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
    focus_ranges(&refs("focusLinesAfter"))
        .into_iter()
        .map(|r| (Side::New, r))
        .chain(focus_ranges(&refs("focusLinesBefore")).into_iter().map(|r| (Side::Old, r)))
        .collect()
}

/// For each hunk line, the index of the focus range it falls in (`lineFocusRanges`).
pub fn line_focus_ranges(scene: &Value, hunk: &Hunk) -> Vec<Option<usize>> {
    let ranges = scene_focus_ranges(scene);
    let ids: Vec<Option<usize>> = hunk
        .lines
        .iter()
        .map(|line| ranges.iter().position(|(side, (a, b))| line_no(line, *side).is_some_and(|n| n >= *a && n <= *b)))
        .collect();
    if ids.iter().any(Option::is_some) {
        return ids;
    }
    let changed = hunk.lines.iter().any(|l| l.kind != LineType::Context);
    hunk.lines.iter().map(|l| if changed && l.kind == LineType::Context { None } else { Some(0) }).collect()
}
