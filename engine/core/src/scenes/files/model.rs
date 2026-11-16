//! The file list a files scene shows and its parts (shared/files.mjs). Brief parts are already expanded in the
//! props the engine reads (shared/normalize.mjs), so only plain `parts` arrive here.

use crate::model::{Hunk, HunkStatus};
use crate::scenes::tests::names::is_test_file;
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Change {
    Added,
    Removed,
    Modified,
}

fn change_of(s: &str) -> Option<Change> {
    match s {
        "added" => Some(Change::Added),
        "removed" => Some(Change::Removed),
        "modified" => Some(Change::Modified),
        _ => None,
    }
}

#[derive(Clone, Debug)]
pub struct ShownFile {
    pub path: String,
    pub change: Option<Change>,
    pub additions: Option<i64>,
    pub deletions: Option<i64>,
    pub badge: Option<String>,
    pub tone: Option<String>,
    pub part: Option<String>,
    pub test: bool,
}

/// Ids compared as a person reads them: "h2" before "h10". The diff lists hunks in id order.
fn natural(a: &str, b: &str) -> Ordering {
    let split = |s: &str| -> (String, Option<u64>) {
        let digits: String = s.chars().skip_while(|c| !c.is_ascii_digit()).collect();
        let head: String = s.chars().take_while(|c| !c.is_ascii_digit()).collect();
        (head, digits.parse().ok())
    };
    let (ha, na) = split(a);
    let (hb, nb) = split(b);
    ha.cmp(&hb).then(na.cmp(&nb)).then(a.cmp(b))
}

/// Changed files in the diff, in diff order, with summed line counts (`diffFiles`).
fn diff_files(hunks: &HashMap<String, Hunk>) -> Vec<ShownFile> {
    let mut ids: Vec<&String> = hunks.keys().collect();
    ids.sort_by(|a, b| natural(a, b));
    let mut out: Vec<ShownFile> = Vec::new();
    for id in ids {
        let h = &hunks[id];
        if h.status == HunkStatus::Source {
            continue;
        }
        let change = match h.status {
            HunkStatus::Added => Change::Added,
            HunkStatus::Deleted => Change::Removed,
            _ => Change::Modified,
        };
        let at = match out.iter().position(|f| f.path == h.file) {
            Some(i) => i,
            None => {
                out.push(ShownFile {
                    path: h.file.clone(),
                    change: Some(change),
                    additions: Some(0),
                    deletions: Some(0),
                    badge: None,
                    tone: None,
                    part: None,
                    test: false,
                });
                out.len() - 1
            }
        };
        out[at].additions = Some(out[at].additions.unwrap_or(0) + h.additions);
        out[at].deletions = Some(out[at].deletions.unwrap_or(0) + h.deletions);
    }
    out
}

/// The scene's files: its own, with change and counts filled in from the diff, else every changed file (`sceneFiles`).
pub fn scene_files(scene: &Value, hunks: &HashMap<String, Hunk>) -> Vec<ShownFile> {
    let diff = diff_files(hunks);
    let mut files: Vec<ShownFile> = match scene.get("files").and_then(Value::as_array) {
        Some(entries) => entries
            .iter()
            .map(|f| {
                let path = f.get("path").and_then(Value::as_str).unwrap_or("").to_string();
                let known = diff.iter().find(|d| d.path == path);
                let text = |k: &str| f.get(k).and_then(Value::as_str).map(str::to_string);
                ShownFile {
                    change: f
                        .get("change")
                        .and_then(Value::as_str)
                        .and_then(change_of)
                        .or(known.and_then(|k| k.change)),
                    additions: f.get("additions").and_then(Value::as_i64).or(known.and_then(|k| k.additions)),
                    deletions: f.get("deletions").and_then(Value::as_i64).or(known.and_then(|k| k.deletions)),
                    badge: text("badge"),
                    tone: text("tone"),
                    part: text("part"),
                    test: false,
                    path,
                }
            })
            .collect(),
        None => diff,
    };
    for f in &mut files {
        f.test = is_test_file(&f.path);
    }
    files
}

#[derive(Clone, Debug)]
pub struct Part {
    pub name: String,
    pub weight: &'static str,
    pub does: Option<String>,
    pub after: Vec<String>,
    pub check: bool,
    pub risk: Option<String>,
    pub risk_more: i64,
    pub files: Vec<ShownFile>,
    pub additions: i64,
    pub deletions: i64,
}

pub const PART_WEIGHTS: [&str; 3] = ["core", "support", "routine"];

/// The parts a files scene groups its files under, in drawing order (`sceneParts`); None without `parts`.
pub fn scene_parts(scene: &Value, files: &[ShownFile]) -> Option<Vec<Part>> {
    let parts = scene.get("parts")?.as_array()?;
    let named: Vec<(&Value, &str, &'static str)> = parts
        .iter()
        .filter_map(|p| {
            let name = p.get("name")?.as_str()?;
            let w = p.get("weight")?.as_str()?;
            PART_WEIGHTS.iter().find(|x| **x == w).map(|w| (p, name, *w))
        })
        .collect();
    let mut groups: Vec<Part> = named
        .iter()
        .map(|(p, name, weight)| {
            let does = p.get("does").and_then(Value::as_str).map(str::trim).filter(|d| !d.is_empty());
            let risk = p.get("risk").and_then(Value::as_str).map(str::trim).filter(|d| !d.is_empty());
            Part {
                name: name.to_string(),
                weight,
                does: does.map(str::to_string),
                after: p
                    .get("after")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(|n| n.as_str().map(str::to_string)).collect())
                    .unwrap_or_default(),
                check: p.get("check") == Some(&Value::Bool(true)),
                risk: risk.map(str::to_string),
                risk_more: if risk.is_some() {
                    p.get("riskMore").and_then(Value::as_i64).filter(|n| *n > 0).unwrap_or(0)
                } else {
                    0
                },
                files: files.iter().filter(|f| f.part.as_deref() == Some(name)).cloned().collect(),
                additions: 0,
                deletions: 0,
            }
        })
        .collect();
    let rest: Vec<ShownFile> =
        files.iter().filter(|f| !named.iter().any(|(_, n, _)| Some(*n) == f.part.as_deref())).cloned().collect();
    if !rest.is_empty() {
        groups.push(Part {
            name: "Other files".into(),
            weight: "routine",
            does: None,
            after: Vec::new(),
            check: false,
            risk: None,
            risk_more: 0,
            files: rest,
            additions: 0,
            deletions: 0,
        });
    }
    let mut out: Vec<Part> = Vec::new();
    for w in PART_WEIGHTS {
        out.extend(groups.iter().filter(|g| g.weight == w && !g.files.is_empty()).cloned());
    }
    for g in &mut out {
        g.additions = g.files.iter().map(|f| f.additions.unwrap_or(0)).sum();
        g.deletions = g.files.iter().map(|f| f.deletions.unwrap_or(0)).sum();
    }
    Some(out)
}

/// The item keys a ref lights: a file's path, or a part's name (`files` entry of shared/targets.mjs).
pub fn resolve_ref(files: &[ShownFile], parts: Option<&[Part]>, r: &Value) -> Option<Vec<String>> {
    let r = r.as_str()?;
    if files.iter().any(|f| f.path == r) {
        return Some(vec![format!("f:{r}")]);
    }
    let name = r.strip_prefix("part:").map_or(r, str::trim);
    let part = parts?.iter().find(|g| g.name == name)?;
    let mut keys = vec![format!("p:{}", part.name)];
    keys.extend(part.files.iter().map(|f| format!("f:{}", f.path)));
    Some(keys)
}

/// `String.prototype.localeCompare` for paths: letters ignoring case first, then lower case before upper.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    // The order of the root collation: punctuation, then digits, then letters.
    const PUNCT: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
    fn rank(c: char) -> (u8, u32) {
        if c.is_alphabetic() {
            (2, c.to_lowercase().next().unwrap_or(c) as u32)
        } else if c.is_ascii_digit() {
            (1, c as u32)
        } else {
            (0, PUNCT.find(c).map_or(100 + c as u32, |i| i as u32))
        }
    }
    let primary = a.chars().map(rank).cmp(b.chars().map(rank));
    primary.then_with(|| {
        for (x, y) in a.chars().zip(b.chars()) {
            if x != y {
                return if x.is_lowercase() { Ordering::Less } else { Ordering::Greater };
            }
        }
        Ordering::Equal
    })
}
