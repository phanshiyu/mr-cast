//! The names of the tests a branch adds, read from the added lines of its test files (shared/test-names.mjs and
//! shared/test-files.mjs). The tests scene's footer counts them from the hunks.

use crate::model::{DiffLine, Hunk, HunkStatus, LineType};
use fancy_regex::Regex;
use std::sync::OnceLock;

const QUOTED: &str = r#"('|"|`)(.+?)\1"#;
const MODS: &str = r"(?:\.(?:only|skip|todo|concurrent|failing|sequential))*";

struct Patterns {
    tests: Vec<Regex>,
    groups: Vec<Regex>,
    mark: Regex,
    marked_fn: Regex,
    mark_gap: Regex,
    files: Vec<Regex>,
}

fn re(s: &str) -> Regex {
    Regex::new(s).unwrap_or_else(|e| panic!("{s}: {e}"))
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        tests: vec![
            re(&format!(r"\b(?:test|it){MODS}\s*\(\s*{QUOTED}")),
            re(&format!(r"\b(?:test|it)(?:\.\w+)*\.each\b.*?\)\s*\(\s*{QUOTED}")),
            re(&format!(r"\b(?:test|it)(?:\.\w+)*\.each\s*`[^`]*`\s*\(\s*{QUOTED}")),
            re(r#"\b(?:it|test)\s+(['"])(.+?)\1"#),
            re(r"\bdef\s+(test_\w+)"),
            re(r"\bfunc\s+(Test\w+)"),
            re(r"\bvoid\s+(test\w+)\s*\("),
        ],
        groups: vec![
            re(&format!(r"\b(?:describe|context|suite)(?:\.\w+)*(?:\.each\b.*?\))?\s*\(\s*{QUOTED}")),
            re(r#"\b(?:describe|context)\s+(['"])(.+?)\1"#),
            re(r"\bRSpec\.describe\s+([\w:]+)"),
            re(r"^\s*class\s+(Test\w*)"),
        ],
        mark: re(r"#\[(?:\w+::)*test(?:\(.*)?\]|@Test\b"),
        marked_fn: re(r"\b(?:fn|void)\s+(\w+)\s*\(|\bfun\s+(?:`([^`]+)`|(\w+))\s*\("),
        mark_gap: re(r"^\s*(?:$|@|#\[|//)"),
        files: [
            r"(^|/)(tests?|__tests__|spec|specs)/",
            r"\.(test|spec)\.[^/]+$",
            r"_test\.(go|py|rb|exs?|dart|cc|cpp|c)$",
            r"(^|/)test_[^/]+\.py$",
            r"_spec\.rb$",
            r"(Test|Tests|IT)\.(java|kt|scala|groovy)$",
            r"Tests?\.(cs|fs|vb|swift)$",
            r"Spec\.(scala|groovy|kt|swift)$",
        ]
        .iter()
        .map(|p| re(p))
        .collect(),
    })
}

/// The last capture group of the first pattern that matches, as the JS reads `m[m.length - 1]`.
fn first(patterns: &[Regex], text: &str) -> Option<String> {
    for p in patterns {
        if let Ok(Some(c)) = p.captures(text) {
            return c.get(c.len() - 1).map(|m| m.as_str().to_string());
        }
    }
    None
}

fn matches(p: &Regex, text: &str) -> bool {
    p.is_match(text).unwrap_or(false)
}

/// The test names on the added lines of a hunk.
fn test_names(lines: &[DiffLine]) -> Vec<String> {
    let p = patterns();
    let mut tests = Vec::new();
    let mut marked = false;
    for l in lines {
        // shared/test-names.mjs skips lines of type "remove", which the diff never writes (a removed line is "del").
        let add = l.kind == LineType::Add;
        if marked || matches(&p.mark, &l.text) {
            if let Ok(Some(c)) = p.marked_fn.captures(&l.text) {
                if add {
                    let name = (1..=3).find_map(|i| c.get(i)).map(|m| m.as_str().to_string());
                    tests.extend(name);
                }
                marked = false;
                continue;
            }
            marked = matches(&p.mark, &l.text) || (marked && matches(&p.mark_gap, &l.text));
        }
        if !add {
            continue;
        }
        if first(&p.groups, &l.text).is_some() {
            continue;
        }
        if let Some(name) = first(&p.tests, &l.text) {
            tests.push(name);
        }
    }
    tests
}

fn is_test_file(file: &str) -> bool {
    patterns().files.iter().any(|p| matches(p, file))
}

/// How many test names the changed test files of the hunks add.
pub fn added_test_count<'a>(hunks: impl IntoIterator<Item = &'a Hunk>) -> usize {
    hunks
        .into_iter()
        .filter(|h| !matches!(h.status, HunkStatus::Source | HunkStatus::Deleted) && is_test_file(&h.file))
        .map(|h| test_names(&h.lines).len())
        .sum()
}
