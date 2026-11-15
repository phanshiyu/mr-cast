//! Review mode's shared pieces (shared/review.mjs): severities, a finding's place, and line references.

use crate::color::Color;
use serde::Deserialize;
use serde_json::Value;

/// Severities, worst first: the order the review scene lists them in.
pub const SEVERITIES: [&str; 3] = ["bug", "risk", "nit"];

/// One thing in the diff that looks wrong.
#[derive(Clone, Debug, Deserialize)]
pub struct Finding {
    pub id: String,
    pub severity: String,
    pub file: String,
    #[serde(default)]
    pub line: Value,
    #[serde(default)]
    pub claim: String,
}

/// The findings of a storyboard (empty when it has none).
pub fn findings(storyboard: &crate::model::Storyboard) -> Vec<Finding> {
    storyboard
        .findings
        .as_ref()
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|f| serde_json::from_value(f.clone()).ok()).collect())
        .unwrap_or_default()
}

/// Ink of a finding's severity (`severityInk`), as a CSS colour.
pub fn severity_ink(severity: &str) -> &'static str {
    match severity {
        "bug" => "#ff6b7a",
        "risk" => "#ff9f43",
        _ => "#8fa0ff",
    }
}

/// `severity_ink` with its alpha as two hex digits appended, as the TSX writes `${ink}99`.
pub fn ink_alpha(severity: &str, alpha_hex: &str) -> Color {
    Color::css(&format!("{}{alpha_hex}", severity_ink(severity)))
}

/// A line number or "a-b" range as (first, last), or None when it is neither (`lineSpan`).
pub fn line_span(r: &Value) -> Option<(i64, i64)> {
    if let Some(n) = r.as_i64().or_else(|| r.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64)) {
        return (n > 0).then_some((n, n));
    }
    let s = r.as_str()?.trim();
    let (a, b) = match s.split_once('-') {
        Some((a, b)) => (a.trim_end(), Some(b.trim_start())),
        None => (s, None),
    };
    let digits = |t: &str| !t.is_empty() && t.bytes().all(|c| c.is_ascii_digit());
    if !digits(a) || b.is_some_and(|b| !digits(b)) {
        return None;
    }
    let (a, b) = (a.parse::<i64>().ok()?, b.map_or(a.parse::<i64>().ok(), |b| b.parse::<i64>().ok())?);
    Some((a.min(b), a.max(b)))
}

/// "src/a.ts:12" or "src/a.ts:12-14" (`findingLocation`).
pub fn finding_location(f: &Finding) -> String {
    match line_span(&f.line) {
        None => f.file.clone(),
        Some((a, b)) if a == b => format!("{}:{a}", f.file),
        Some((a, b)) => format!("{}:{a}-{b}", f.file),
    }
}

/// The findings worst first, keeping the written order within a severity (`bySeverity`).
pub fn by_severity(findings: &[Finding]) -> Vec<&Finding> {
    SEVERITIES.iter().flat_map(|s| findings.iter().filter(move |f| f.severity == *s)).collect()
}
