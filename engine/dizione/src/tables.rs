//! The hand-written tables that ship with the source (dizione/tables.py, data/*.txt, Apache-2.0).
//!
//! One entry per line, columns separated by tabs or by two or more spaces, `#` starts a comment line.
//! Pronunciations are phones with stress marks or CMUdict notation; the reader tells them apart.

use std::collections::HashMap;

use crate::convert::{from_text, is_arpabet, phones};
use crate::py;
use crate::symbols::Phones;

pub const ABBREVIATIONS: &str = include_str!("../data/abbreviations.txt");
pub const CHAT: &str = include_str!("../data/chat.txt");
pub const ENDINGS: &str = include_str!("../data/endings.txt");
pub const EXCEPTIONS: &str = include_str!("../data/exceptions.txt");
pub const FUNCTION_WORDS: &str = include_str!("../data/function_words.txt");
pub const HOMOGRAPH_RULES: &str = include_str!("../data/homograph_rules.txt");
pub const LETTERS: &str = include_str!("../data/letters.txt");
pub const PHRASES: &str = include_str!("../data/phrases.txt");
pub const UNITS: &str = include_str!("../data/units.txt");

const STRESS_CLASSES: [&str; 8] = ["u", "uf", "ur", "s", "ss", "si", "pf", "p"];

/// Splits a line on a tab run or on two or more spaces, as `re.split(r"\t+| {2,}", line)`.
fn columns(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let chars: Vec<char> = line.chars().collect();
    let mut current = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\t' || (c == ' ' && chars.get(i + 1) == Some(&' ')) {
            let mut j = i;
            if c == '\t' {
                while j < chars.len() && chars[j] == '\t' {
                    j += 1;
                }
            } else {
                while j < chars.len() && chars[j] == ' ' {
                    j += 1;
                }
            }
            out.push(py::strip(&current).to_string());
            current.clear();
            i = j;
            continue;
        }
        current.push(c);
        i += 1;
    }
    out.push(py::strip(&current).to_string());
    out
}

/// The rows of a table: (line number, columns).
pub fn rows(text: &str) -> Vec<(usize, Vec<String>)> {
    let mut out = Vec::new();
    // str.splitlines: \n, \r\n and \r (the tables use \n).
    for (number, line) in text.lines().enumerate() {
        let line = py::strip(line);
        if !line.is_empty() && !line.starts_with('#') {
            out.push((number + 1, columns(line)));
        }
    }
    out
}

/// A function word's stress class, its form, and its form when promoted.
#[derive(Clone, Debug)]
pub struct Function {
    pub class: String,
    pub form: Phones,
    pub last: Option<Phones>,
}

/// word -> (class, form, final form or None).
pub fn function_words() -> HashMap<String, Function> {
    let mut table = HashMap::new();
    for (number, c) in rows(FUNCTION_WORDS) {
        assert!(
            (c.len() == 3 || c.len() == 4) && STRESS_CLASSES.contains(&c[1].as_str()),
            "function_words.txt line {number}"
        );
        let last = (c.len() == 4).then(|| phones(&c[3]));
        table.insert(c[0].clone(), Function { class: c[1].clone(), form: phones(&c[2]), last });
    }
    table
}

/// A group of words said together: its class, one form per spoken word, and its promoted form.
#[derive(Clone, Debug)]
pub struct Phrase {
    pub class: String,
    pub forms: Vec<Phones>,
    pub last: Option<Phones>,
}

pub fn phrases() -> HashMap<Vec<String>, Phrase> {
    let mut table = HashMap::new();
    for (number, c) in rows(PHRASES) {
        assert!((c.len() == 3 || c.len() == 4) && STRESS_CLASSES.contains(&c[1].as_str()), "phrases.txt line {number}");
        let forms: Vec<Phones> = c[2].split('|').map(phones).collect();
        let key: Vec<String> = c[0].split(py::is_space).filter(|w| !w.is_empty()).map(String::from).collect();
        assert!(forms.len() == 1 || (c[1] == "p" && forms.len() == key.len()), "phrases.txt line {number}");
        let last = (c.len() == 4).then(|| phones(&c[3]));
        table.insert(key, Phrase { class: c[1].clone(), forms, last });
    }
    table
}

/// A pronunciation as written in a table: CMUdict symbols, or phones.
#[derive(Clone, Debug)]
pub enum Pronunciation {
    Arpabet(Vec<String>),
    Phones(Phones),
}

fn pronunciation(text: &str) -> Result<Pronunciation, String> {
    let symbols: Vec<String> = text.split(py::is_space).filter(|s| !s.is_empty()).map(String::from).collect();
    if is_arpabet(&symbols) { Ok(Pronunciation::Arpabet(symbols)) } else { from_text(text).map(Pronunciation::Phones) }
}

fn entries(text: &str) -> Vec<(String, Vec<String>)> {
    rows(text).into_iter().map(|(n, c)| (format!("line {n}"), c)).collect()
}

/// word -> pronunciation, for the rows whose first column is one word.
pub fn pronunciations(source: &str) -> Result<HashMap<String, Pronunciation>, String> {
    let mut table = HashMap::new();
    for (where_, c) in entries(source) {
        if c.len() != 2 {
            return Err(format!("{where_}: expected a word and its pronunciation"));
        }
        if c[0].split(py::is_space).filter(|w| !w.is_empty()).count() == 1 {
            table.insert(py::lower(&c[0]), pronunciation(&c[1])?);
        }
    }
    Ok(table)
}

/// (word, word, ...) -> one pronunciation per word, for a name of several words whose rhythm matters.
pub fn names(source: &str) -> Result<HashMap<Vec<String>, Vec<Pronunciation>>, String> {
    let mut table = HashMap::new();
    for (where_, c) in entries(source) {
        let words: Vec<String> =
            py::lower(&c[0]).split(py::is_space).filter(|w| !w.is_empty()).map(String::from).collect();
        if c.len() != 2 || words.len() < 2 {
            continue;
        }
        let parts: Vec<&str> = c[1].split('|').map(py::strip).collect();
        if parts.len() != words.len() {
            return Err(format!("{where_}: {:?} has {} words and {} pronunciations", c[0], words.len(), parts.len()));
        }
        table.insert(words, parts.into_iter().map(pronunciation).collect::<Result<Vec<_>, _>>()?);
    }
    Ok(table)
}

/// A two-column table as a map (the second column may be empty).
pub fn mapping(text: &str) -> HashMap<String, String> {
    rows(text).into_iter().map(|(_, c)| (c[0].clone(), c.get(1).cloned().unwrap_or_default())).collect()
}
