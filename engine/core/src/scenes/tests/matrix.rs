//! The tests scene's matrix (shared/tests.mjs): situations as rows, outcomes as columns, the tests that check cells,
//! and the item keys a step's `focus` lights.

use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Test {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub checks: Vec<String>,
    #[serde(default)]
    pub was: Option<String>,
}

impl Test {
    pub fn status(&self) -> &str {
        self.status.as_deref().unwrap_or("added")
    }
    /// What a test is called where the scene draws it (`testLabel`).
    pub fn label(&self) -> String {
        match self.label.as_deref().map(str::trim) {
            Some(l) if !l.is_empty() => l.to_string(),
            _ => self.name.clone(),
        }
    }
    /// A removed test no longer checks anything (`isLive`).
    pub fn live(&self) -> bool {
        self.status() != "removed"
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Situation {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub when: Option<String>,
    #[serde(default)]
    pub gap: Option<String>,
    #[serde(default)]
    pub expect: Option<Value>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum State {
    Checked,
    Unchecked,
    Removed,
    None,
}

pub struct Cell {
    pub key: String,
    pub value: Option<String>,
    pub tests: Vec<usize>,
    pub state: State,
    /// "added" or "modified" when a live test checking the cell is new or changed.
    pub status: Option<&'static str>,
    pub was: Vec<String>,
}

pub struct Row {
    pub key: String,
    pub situation: Situation,
    pub gap: bool,
    pub cells: Vec<Cell>,
    pub tests: Vec<usize>,
}

#[derive(Default)]
pub struct Counts {
    pub tests: usize,
    pub added: usize,
    pub modified: usize,
    pub removed: usize,
    pub existing: usize,
    pub gaps: usize,
    pub unchecked: usize,
}

pub struct Matrix {
    pub outcomes: Vec<String>,
    pub rows: Vec<Row>,
    pub counts: Counts,
}

/// A situation with no promises and a `gap`, drawn as one bar (`isGapRow`).
fn is_gap_row(s: &Situation) -> bool {
    s.gap.is_some() && !s.expect.as_ref().is_some_and(Value::is_object)
}

/// The cell a ref such as "retry.Calls" names, as its row and column (`cellOf`).
fn cell_of(situations: &[Situation], outcomes: &[String], r: &str) -> Option<(usize, usize)> {
    let row = situations.iter().position(|s| {
        s.id.as_deref().is_some_and(|id| {
            r.strip_prefix(id).and_then(|t| t.strip_prefix('.')).is_some_and(|o| outcomes.iter().any(|x| x == o))
        })
    })?;
    let id = situations[row].id.as_deref()?;
    let outcome = &r[id.len() + 1..];
    Some((row, outcomes.iter().position(|o| o == outcome)?))
}

pub fn matrix(outcomes: &[String], situations: &[Situation], tests: &[Test]) -> Matrix {
    let mut checking: std::collections::HashMap<String, Vec<usize>> = Default::default();
    for (n, test) in tests.iter().enumerate() {
        for r in &test.checks {
            let Some((row, col)) = cell_of(situations, outcomes, r) else { continue };
            let by = checking.entry(format!("x:{row}/{col}")).or_default();
            if !by.contains(&n) {
                by.push(n);
            }
        }
    }
    let rows: Vec<Row> = situations
        .iter()
        .enumerate()
        .map(|(row, situation)| {
            let cells: Vec<Cell> = outcomes
                .iter()
                .enumerate()
                .map(|(col, outcome)| {
                    let key = format!("x:{row}/{col}");
                    let by = checking.get(&key).cloned().unwrap_or_default();
                    let live: Vec<usize> = by.iter().copied().filter(|&n| tests[n].live()).collect();
                    let value = situation
                        .expect
                        .as_ref()
                        .and_then(|e| e.get(outcome))
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    let mut was: Vec<String> = Vec::new();
                    for w in by.iter().filter_map(|&n| tests[n].was.clone()).filter(|w| !w.is_empty()) {
                        if !was.contains(&w) {
                            was.push(w);
                        }
                    }
                    let removed = by.len() > live.len();
                    let state = if !live.is_empty() {
                        State::Checked
                    } else if value.is_some() {
                        State::Unchecked
                    } else if removed {
                        State::Removed
                    } else {
                        State::None
                    };
                    let statuses: Vec<&str> = live.iter().map(|&n| tests[n].status()).collect();
                    let status = if statuses.contains(&"added") {
                        Some("added")
                    } else if statuses.contains(&"modified") {
                        Some("modified")
                    } else {
                        None
                    };
                    Cell { key, value, tests: by, state, status, was }
                })
                .collect();
            let mut row_tests: Vec<usize> = Vec::new();
            for c in &cells {
                for &n in &c.tests {
                    if !row_tests.contains(&n) {
                        row_tests.push(n);
                    }
                }
            }
            Row {
                key: format!("s:{}", situation.id.as_deref().unwrap_or("undefined")),
                situation: situation.clone(),
                gap: is_gap_row(situation),
                cells,
                tests: row_tests,
            }
        })
        .collect();
    let status = |s: &str| tests.iter().filter(|t| t.status() == s).count();
    let unchecked =
        rows.iter().filter(|r| !r.gap).flat_map(|r| &r.cells).filter(|c| c.state == State::Unchecked).count();
    let counts = Counts {
        tests: tests.len(),
        added: status("added"),
        modified: status("modified"),
        removed: status("removed"),
        existing: status("existing"),
        gaps: rows.iter().filter(|r| r.gap).count(),
        unchecked,
    };
    Matrix { outcomes: outcomes.to_vec(), rows, counts }
}

/// The item keys a test lights: its own, and every cell it checks (`testKeys`).
fn test_keys(situations: &[Situation], outcomes: &[String], tests: &[Test], n: usize) -> Vec<String> {
    let mut keys = vec![format!("t:{n}")];
    for r in &tests[n].checks {
        if let Some((row, col)) = cell_of(situations, outcomes, r) {
            keys.push(format!("x:{row}/{col}"));
        }
    }
    keys
}

/// The item keys a ref lights: a situation id, a cell "id.Outcome", an outcome, or a test's name (`resolveTestsRef`).
pub fn resolve_ref(situations: &[Situation], outcomes: &[String], tests: &[Test], r: &Value) -> Option<Vec<String>> {
    let r = r.as_str()?;
    if let Some(row) = situations.iter().position(|s| s.id.as_deref() == Some(r)) {
        let mut keys = vec![format!("s:{r}")];
        if !is_gap_row(&situations[row]) {
            keys.extend((0..outcomes.len()).map(|col| format!("x:{row}/{col}")));
        }
        return Some(keys);
    }
    if let Some((row, col)) = cell_of(situations, outcomes, r) {
        return Some(vec![format!("x:{row}/{col}")]);
    }
    if let Some(col) = outcomes.iter().position(|o| o == r) {
        let mut keys = vec![format!("o:{col}")];
        for (row, s) in situations.iter().enumerate() {
            if !is_gap_row(s) {
                keys.push(format!("x:{row}/{col}"));
            }
        }
        return Some(keys);
    }
    let named: Vec<String> = tests
        .iter()
        .enumerate()
        .filter(|(_, t)| t.name == r || t.label.as_deref() == Some(r))
        .flat_map(|(n, _)| test_keys(situations, outcomes, tests, n))
        .collect();
    (!named.is_empty()).then_some(named)
}
