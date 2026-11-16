//! Sentence rules (dizione/sentence.py): what a word's pronunciation owes to its neighbours in its clause.
//! Sentence stress, "the" and "to" before a vowel, linking r, and the flap at the end of "it" and "at".

use crate::symbols::{Phone, Phones, is_vowel, p};

/// One word, or a group of words said as one, in a clause.
#[derive(Clone, Debug)]
pub struct Unit {
    /// Spelling in lower case; several words for a phrase.
    pub word: String,
    pub phones: Phones,
    /// The stress class of function_words.txt; "c" is stress as given.
    pub kind: &'static str,
    /// The form used when the word is promoted.
    pub last: Option<Phones>,
    /// No word boundary before this unit (a hyphenated compound).
    pub attach: bool,
}

impl Unit {
    pub fn new(word: &str, phones: Phones, kind: &'static str, attach: bool) -> Unit {
        Unit { word: word.to_string(), phones, kind, last: None, attach }
    }

    fn last_word(&self) -> &str {
        self.word.rsplit(' ').next().unwrap_or("")
    }

    fn first_word(&self) -> &str {
        self.word.split(' ').next().unwrap_or("")
    }
}

fn unstress(phones: &[Phone]) -> Phones {
    phones.iter().map(|&(ph, _)| (ph, 0)).collect()
}

/// Give the word a primary stress: on its marked vowel, else on the first vowel.
pub fn promote(phones: &[Phone]) -> Phones {
    if phones.iter().any(|&(_, s)| s == 1) {
        return phones.to_vec();
    }
    let target = if let Some(k) = phones.iter().rposition(|&(_, s)| s == 2) {
        Some(k)
    } else {
        phones.iter().position(|&(ph, _)| is_vowel(ph))
    };
    phones.iter().enumerate().map(|(i, &(ph, s))| (ph, if Some(i) == target { 1 } else { s })).collect()
}

/// Resolve the stress class of every unit of a clause, right to left.
pub fn stress_clause(units: &mut [Unit]) {
    let mut primary_follows = false;
    let n = units.len();
    for index in (0..n).rev() {
        let unit = &units[index];
        let promoted = || unit.last.clone().unwrap_or_else(|| promote(&unit.phones));
        let phones = match unit.kind {
            "u" => unstress(&unit.phones),
            "uf" => {
                if index == n - 1 {
                    promoted()
                } else {
                    unstress(&unit.phones)
                }
            }
            "ur" => {
                if primary_follows {
                    unstress(&unit.phones)
                } else {
                    promoted()
                }
            }
            "s" => {
                if primary_follows {
                    unit.phones.clone()
                } else {
                    promoted()
                }
            }
            "si" => {
                if !primary_follows {
                    promoted()
                } else if index == 0 {
                    unit.phones.clone()
                } else {
                    unstress(&unit.phones)
                }
            }
            "pf" => {
                if index == n - 1 {
                    promoted()
                } else {
                    unit.phones.clone()
                }
            }
            _ => unit.phones.clone(),
        };
        units[index].phones = phones;
        primary_follows = primary_follows || units[index].phones.iter().any(|&(_, s)| s == 1);
    }
    if !units.is_empty() && !units.iter().any(|u| u.phones.iter().any(|&(_, s)| s != 0)) {
        for unit in units.iter_mut().rev() {
            if unit.phones.iter().any(|&(ph, _)| is_vowel(ph)) {
                unit.phones = promote(&unit.phones);
                break;
            }
        }
    }
}

const SPLIT: [(&str, &str); 6] = [("ɑːɹ", "ɑː"), ("ɔːɹ", "ɔː"), ("oːɹ", "oː"), ("ɪɹ", "ɪ"), ("ɛɹ", "ɛ"), ("ʊɹ", "ʊ")];
const RHOTIC: [&str; 3] = ["ɚ", "ɜː", "aɪɚ"];
const NO_LINK_BEFORE: [&str; 3] = ["and", "or", "if"];
const FLAP_BEFORE_VOWEL: [&str; 2] = ["it", "at"];

/// Adjust the end of each word to the beginning of the next.
pub fn join_clause(units: &mut [Unit]) {
    for k in 0..units.len().saturating_sub(1) {
        let (head, tail) = units.split_at_mut(k + 1);
        let unit = &mut head[k];
        let following = &tail[0];
        if unit.phones.is_empty() || following.phones.is_empty() || !is_vowel(following.phones[0].0) {
            continue;
        }
        let (last, stress) = *unit.phones.last().unwrap();
        let n = unit.phones.len();
        if unit.last_word() == "the" && last == p("ə") {
            unit.phones[n - 1] = (p("ɪ"), stress);
        } else if unit.last_word() == "to" && last == p("ə") {
            unit.phones[n - 1] = (p("ʊ"), stress);
        } else if NO_LINK_BEFORE.contains(&following.first_word()) {
            continue;
        } else if let Some((_, to)) = SPLIT.iter().find(|(from, _)| p(from) == last) {
            unit.phones[n - 1] = (p(to), stress);
            unit.phones.push((p("ɹ"), 0));
        } else if RHOTIC.iter().any(|r| p(r) == last) {
            unit.phones.push((p("ɹ"), 0));
        } else if last == p("t")
            && FLAP_BEFORE_VOWEL.contains(&unit.word.as_str())
            && n > 1
            && is_vowel(unit.phones[n - 2].0)
        {
            unit.phones[n - 1] = (p("ɾ"), 0);
        }
    }
}

/// The units of a clause as spoken words: an attached unit continues the one before.
pub fn groups(units: &[Unit]) -> Vec<Phones> {
    let mut out: Vec<Phones> = Vec::new();
    for unit in units {
        if unit.attach && !out.is_empty() {
            out.last_mut().unwrap().extend_from_slice(&unit.phones);
        } else {
            out.push(unit.phones.clone());
        }
    }
    out.retain(|g| !g.is_empty());
    out
}
