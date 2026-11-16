//! Words spelled alike and pronounced differently (dizione/homographs.py): hand rules first, then a small linear
//! classifier over the neighbouring words, with the weights of `homographs.json`.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::Deserialize;

use crate::py;
use crate::tables::{HOMOGRAPH_RULES, rows};

const CLASSES: [(&str, &str); 13] = [
    ("TO", "to"),
    ("DET", "the a an this that these those every each no some any another such what which whose"),
    ("POSS", "my your his her its our their"),
    ("SUBJ", "i you he she it we they who"),
    ("OBJ", "me him us them"),
    (
        "MODAL",
        "will would shall should can could may might must 'll 'd won't can't cannot couldn't shouldn't wouldn't let's please",
    ),
    ("DO", "do does did don't doesn't didn't"),
    (
        "BE",
        "am is are was were be been being isn't aren't wasn't weren't i'm you're we're they're he's she's it's that's there's",
    ),
    ("HAVE", "have has had having haven't hasn't hadn't i've you've we've they've"),
    ("NEG", "not never"),
    (
        "PREP",
        "of in on at by for from with into onto over under about after before between through during without within \
         against among around across behind beside near upon toward towards as than like",
    ),
    ("CONJ", "and or but nor so yet if because although though while when where unless until since whether"),
    (
        "ADV",
        "very too quite rather more most less least also just only even still always often sometimes usually again \
         now then here there soon already almost",
    ),
];
const WINDOW: usize = 6;

#[derive(Deserialize, Clone)]
pub struct Sense {
    pub id: String,
    pub role: String,
    pub phones: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Bias {
    One(f64),
    Many(Vec<f64>),
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Weights {
    One(HashMap<String, f64>),
    Many(Vec<HashMap<String, f64>>),
}

#[derive(Deserialize)]
struct WordModel {
    kind: String,
    bias: Bias,
    weights: Weights,
}

#[derive(Deserialize)]
struct Entry {
    senses: Vec<Sense>,
    model: WordModel,
}

#[derive(Deserialize)]
struct Pooled {
    bias: f64,
    weights: HashMap<String, f64>,
}

#[derive(Deserialize)]
struct Data {
    words: HashMap<String, Entry>,
    pooled: Pooled,
    #[serde(default)]
    plural_bases: Vec<String>,
}

enum Condition {
    Aux(HashSet<String>),
    Before(HashSet<String>),
    Next(HashSet<String>),
    Near(HashSet<String>),
    First,
    Joined(HashSet<String>),
}

pub struct Homographs {
    words: HashMap<String, Entry>,
    pooled: Pooled,
    plural_bases: HashSet<String>,
    rules: HashMap<String, Vec<(String, Vec<Condition>)>>,
    tags: HashMap<&'static str, &'static str>,
}

fn starts_alpha(t: &str) -> bool {
    py::is_alpha(py::first(t))
}

impl Homographs {
    pub fn from_json(text: &str) -> Result<Homographs, String> {
        let data: Data = serde_json::from_str(text).map_err(|e| format!("homographs.json: {e}"))?;
        let mut rules: HashMap<String, Vec<(String, Vec<Condition>)>> = HashMap::new();
        for (number, c) in rows(HOMOGRAPH_RULES) {
            if c.len() != 3 {
                return Err(format!("homograph_rules.txt line {number}"));
            }
            let mut conditions = Vec::new();
            for part in c[2].split(';') {
                let part = py::strip(part);
                let (name, words) = part.split_once(':').unwrap_or((part, ""));
                let set: HashSet<String> =
                    words.split(py::is_space).filter(|w| !w.is_empty()).map(String::from).collect();
                conditions.push(match name {
                    "aux" => Condition::Aux(set),
                    "before" => Condition::Before(set),
                    "next" => Condition::Next(set),
                    "near" => Condition::Near(set),
                    "first" => Condition::First,
                    "joined" => Condition::Joined(set),
                    _ => return Err(format!("homograph_rules.txt line {number}: bad condition {part:?}")),
                });
            }
            rules.entry(c[0].clone()).or_default().push((c[1].clone(), conditions));
        }
        for (word, word_rules) in &rules {
            for (sense, _) in word_rules {
                if !data.words.get(word).is_some_and(|e| e.senses.iter().any(|s| &s.id == sense)) {
                    return Err(format!("homograph rule for {word:?} names the unknown sense {sense:?}"));
                }
            }
        }
        let tags = CLASSES.iter().flat_map(|(name, words)| words.split(' ').map(move |w| (w, *name))).collect();
        Ok(Homographs {
            words: data.words,
            pooled: data.pooled,
            plural_bases: data.plural_bases.into_iter().collect(),
            rules,
            tags,
        })
    }

    /// True for a homograph and for the regular -s form of a noun-or-verb one.
    pub fn covers(&self, word: &str) -> bool {
        self.words.contains_key(word) || (word.ends_with('s') && self.plural_bases.contains(py::drop_last(word, 1)))
    }

    fn tag(&self, token: &str) -> String {
        if token == "<s>" || token == "</s>" {
            return token.to_string();
        }
        let first = py::first(token);
        if !py::is_alpha(first) {
            return if py::is_digit(first) { "NUM" } else { "PUNCT" }.into();
        }
        let lower = py::lower(token);
        if let Some(t) = self.tags.get(lower.as_str()) {
            return t.to_string();
        }
        let ll = py::len(&lower);
        for (ending, name) in [("'s", "POS"), ("ly", "LY"), ("ing", "ING"), ("ed", "ED")] {
            if lower.ends_with(ending) && ll > ending.len() + 1 {
                return name.into();
            }
        }
        if lower.ends_with('s') && !lower.ends_with("ss") && ll > 3 {
            return "S".into();
        }
        if py::is_upper(first) { "CAP" } else { "W" }.into()
    }

    fn features(&self, tokens: &[String], index: usize) -> Vec<String> {
        let at = |offset: isize| -> String {
            let position = index as isize + offset;
            if position >= 0 && (position as usize) < tokens.len() {
                tokens[position as usize].clone()
            } else if offset < 0 {
                "<s>".into()
            } else {
                "</s>".into()
            }
        };
        let (p2, p1, n1, n2) = (at(-2), at(-1), at(1), at(2));
        let (tp2, tp1, tn1, tn2) = (self.tag(&p2), self.tag(&p1), self.tag(&n1), self.tag(&n2));
        let mut out = vec![
            format!("tp1={tp1}"),
            format!("tp2={tp2}"),
            format!("tn1={tn1}"),
            format!("tn2={tn2}"),
            format!("tp2p1={tp2}+{tp1}"),
            format!("tp1n1={tp1}+{tn1}"),
            format!("tn1n2={tn1}+{tn2}"),
        ];
        if index == 0 {
            out.push("first".into());
        } else if py::is_upper(py::first(&tokens[index])) {
            out.push("cap".into());
        }
        out.extend([
            format!("p1={}", py::lower(&p1)),
            format!("p2={}", py::lower(&p2)),
            format!("n1={}", py::lower(&n1)),
            format!("n2={}", py::lower(&n2)),
        ]);
        let target = py::lower(&tokens[index]);
        let lo = index.saturating_sub(WINDOW);
        let hi = (index + WINDOW + 1).min(tokens.len());
        let nearby: BTreeSet<String> =
            tokens[lo..hi].iter().filter(|t| starts_alpha(t)).map(|t| py::lower(t)).filter(|t| *t != target).collect();
        out.extend(nearby.into_iter().map(|w| format!("w={w}")));
        out
    }

    fn sentence_of(tokens: &[String], index: usize) -> (&[String], usize) {
        let end_mark = |t: &String| t == "." || t == "?" || t == "!";
        let mut start = index;
        while start > 0 && !end_mark(&tokens[start - 1]) {
            start -= 1;
        }
        let mut end = index;
        while end < tokens.len() && !end_mark(&tokens[end]) {
            end += 1;
        }
        (&tokens[start..(end + 1).min(tokens.len())], index - start)
    }

    fn left(&self, tokens: &[String], index: usize, skip: &[&str]) -> String {
        // range(index - 1, max(index - 6, -1), -1)
        let lowest = index.saturating_sub(5);
        for position in (lowest..index).rev() {
            let token = &tokens[position];
            if skip.contains(&self.tag(token).as_str()) {
                continue;
            }
            let lower = py::lower(token);
            return if lower.ends_with("'ll") {
                "will".into()
            } else if lower.ends_with("'ve") {
                "have".into()
            } else {
                lower
            };
        }
        "<s>".into()
    }

    fn holds(&self, condition: &Condition, tokens: &[String], index: usize, joined: bool) -> bool {
        const BEFORE: [&str; 3] = ["ADV", "NEG", "LY"];
        const AUX: [&str; 7] = ["ADV", "NEG", "LY", "SUBJ", "OBJ", "DET", "POSS"];
        match condition {
            Condition::First => index == 0,
            Condition::Joined(words) => joined && index > 0 && words.contains(&py::lower(&tokens[index - 1])),
            Condition::Aux(words) => words.contains(&self.left(tokens, index, &AUX)),
            Condition::Before(words) => words.contains(&self.left(tokens, index, &BEFORE)),
            Condition::Next(words) => {
                words.contains(&if index + 1 < tokens.len() { py::lower(&tokens[index + 1]) } else { "</s>".into() })
            }
            Condition::Near(words) => {
                let lo = index.saturating_sub(WINDOW);
                let hi = (index + WINDOW + 1).min(tokens.len());
                tokens[lo..hi].iter().any(|t| words.contains(&py::lower(t)))
            }
        }
    }

    fn scores(&self, word: &str, tokens: &[String], index: usize) -> Vec<f64> {
        let entry = &self.words[word];
        let (sentence, position) = Self::sentence_of(tokens, index);
        let names = self.features(sentence, position);
        match (&entry.model.bias, &entry.model.weights) {
            (Bias::One(bias), Weights::One(weights)) if entry.model.kind == "noun-verb" => {
                let shared = names.iter().filter(|n| n.starts_with('t') || *n == "first" || *n == "cap");
                let mut pooled = 0.0;
                for name in shared {
                    pooled += self.pooled.weights.get(name).copied().unwrap_or(0.0);
                }
                let mut own = 0.0;
                for name in &names {
                    own += weights.get(name).copied().unwrap_or(0.0);
                }
                let mut verb = self.pooled.bias + pooled;
                verb += bias + own;
                entry.senses.iter().map(|s| if s.role == "v" { verb } else { -verb }).collect()
            }
            (Bias::Many(biases), Weights::Many(weights)) => biases
                .iter()
                .zip(weights)
                .map(|(b, w)| {
                    let mut sum = 0.0;
                    for name in &names {
                        sum += w.get(name).copied().unwrap_or(0.0);
                    }
                    b + sum
                })
                .collect(),
            _ => vec![0.0; entry.senses.len()],
        }
    }

    fn choose(&self, word: &str, tokens: &[String], index: usize, joined: bool) -> &Sense {
        let entry = &self.words[word];
        let (sentence, position) = Self::sentence_of(tokens, index);
        for (sense, conditions) in self.rules.get(word).into_iter().flatten() {
            if conditions.iter().all(|c| self.holds(c, sentence, position, joined)) {
                return entry.senses.iter().find(|s| &s.id == sense).unwrap();
            }
        }
        let scores = self.scores(word, tokens, index);
        let mut best = 0;
        for (k, s) in scores.iter().enumerate() {
            if *s > scores[best] {
                best = k;
            }
        }
        &entry.senses[best]
    }

    /// The phones (as text) of `tokens[index]`, and whether it needs the -s ending.
    pub fn pronounce(&self, word: &str, tokens: &[String], index: usize, joined: bool) -> (String, bool) {
        if self.words.contains_key(word) {
            return (self.choose(word, tokens, index, joined).phones.clone(), false);
        }
        let base = py::drop_last(word, 1);
        let entry = &self.words[base];
        let adjective = entry.senses.iter().find(|s| s.role == "n");
        if adjective.is_some_and(|a| a.id == "adj") {
            return (entry.senses.iter().find(|s| s.role == "v").unwrap().phones.clone(), true);
        }
        (self.choose(base, tokens, index, joined).phones.clone(), true)
    }
}
