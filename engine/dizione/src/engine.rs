//! The phonemizer (dizione/engine.py): text -> spoken words of phones, clause by clause.
//!
//! Order of authority for one word: a pronunciation written inline, the exception list (a name of several words
//! listed there is spoken with the stress written), function words and groups of them, the dictionary built from
//! CMUdict, regular endings, prefixes and compounds of dictionary words, names in "-leigh" and words in "-virus",
//! and last the unknown-word model.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use crate::align::Aligner;
use crate::convert::{convert, from_text, phones, settle_stress};
use crate::g2p::Model;
use crate::homographs::Homographs;
use crate::morphology;
use crate::normalize::{Normalizer, Token, Word};
use crate::py;
use crate::rx::{Re, re};
use crate::sentence::{Unit, groups, join_clause, promote, stress_clause};
use crate::symbols::{NothingToPronounce, Phonemized, Phones, Piece, mark_id, tokenize};
use crate::tables::{self, Function, Phrase, Pronunciation};

/// The files the phonemizer reads from its data directory; they come with the model.
pub const DATA_FILES: [&str; 5] = ["lexicon.tsv", "align.json", "g2p.json", "g2p.npz", "homographs.json"];

static LEIGH: LazyLock<Re> = LazyLock::new(|| re(r"(?<=[a-z]{2})leigh(?=s?$)"));

fn class(name: &str) -> &'static str {
    match name {
        "u" => "u",
        "uf" => "uf",
        "ur" => "ur",
        "s" => "s",
        "ss" => "ss",
        "si" => "si",
        "pf" => "pf",
        "p" => "p",
        _ => "c",
    }
}

pub struct Phonemizer {
    lexicon: HashMap<String, String>,
    aligner: Aligner,
    model: Model,
    homographs: Homographs,
    functions: HashMap<String, Function>,
    phrases: HashMap<Vec<String>, Phrase>,
    phrase_length: usize,
    exceptions: HashMap<String, Pronunciation>,
    names: HashMap<Vec<String>, Vec<Pronunciation>>,
    name_starts: HashSet<String>,
    name_length: usize,
    letter_names: HashMap<char, Phones>,
    normalizer: Normalizer,
    cache: Mutex<HashMap<String, (Phones, &'static str)>>,
}

impl Phonemizer {
    /// Loads the built data in `dir` (the files of [`DATA_FILES`]).
    pub fn load(dir: &Path) -> Result<Phonemizer, String> {
        let read = |name: &str| {
            std::fs::read_to_string(dir.join(name)).map_err(|e| format!("{}: {e}", dir.join(name).display()))
        };
        let npz = std::fs::read(dir.join("g2p.npz")).map_err(|e| format!("{}: {e}", dir.join("g2p.npz").display()))?;
        Self::from_data(
            &read("lexicon.tsv")?,
            &read("align.json")?,
            &read("g2p.json")?,
            &npz,
            &read("homographs.json")?,
        )
    }

    pub fn from_data(
        lexicon: &str,
        align: &str,
        g2p: &str,
        npz: &[u8],
        homographs: &str,
    ) -> Result<Phonemizer, String> {
        let lexicon = lexicon
            .lines()
            .filter(|l| !l.is_empty())
            .filter_map(|l| l.split_once('\t').map(|(w, p)| (w.to_string(), p.to_string())))
            .collect();
        let phrases = tables::phrases();
        let phrase_length = phrases.keys().map(Vec::len).max().unwrap_or(1);
        let names = tables::names(tables::EXCEPTIONS)?;
        let name_starts = names.keys().map(|k| k[0].clone()).collect();
        let name_length = names.keys().map(Vec::len).max().unwrap_or(1);
        let letter_names = tables::mapping(tables::LETTERS)
            .into_iter()
            .filter_map(|(k, v)| k.chars().next().map(|c| (c, phones(&v))))
            .collect();
        Ok(Phonemizer {
            lexicon,
            aligner: Aligner::from_json(align)?,
            model: Model::load(g2p, npz)?,
            homographs: Homographs::from_json(homographs)?,
            functions: tables::function_words(),
            phrases,
            phrase_length,
            exceptions: tables::pronunciations(tables::EXCEPTIONS)?,
            names,
            name_starts,
            name_length,
            letter_names,
            normalizer: Normalizer::new(),
            cache: Mutex::new(HashMap::new()),
        })
    }

    // ---- single words ----

    fn entry(&self, word: &str, entry: &Pronunciation) -> Phones {
        match entry {
            Pronunciation::Phones(p) => p.clone(),
            Pronunciation::Arpabet(symbols) => {
                let runs = self.aligner.align(word, symbols);
                convert(word, symbols, runs.as_deref()).unwrap_or_default()
            }
        }
    }

    /// The pronunciation from the exceptions or the dictionary.
    fn known(&self, word: &str) -> Option<Phones> {
        if let Some(e) = self.exceptions.get(word) {
            return Some(self.entry(word, e));
        }
        self.lexicon.get(word).map(|t| from_text(t).unwrap_or_default())
    }

    /// A dictionary word that may be half of a compound: one also listed with a regular ending.
    fn ordinary(&self, word: &str) -> Option<Phones> {
        if py::len(word) < 3
            || !["s", "es", "ed", "ing"].iter().any(|e| self.lexicon.contains_key(&format!("{word}{e}")))
        {
            return None;
        }
        self.known(word)
    }

    /// The unknown-word model, then the conversion rules, on one spelling.
    fn guess(&self, word: &str) -> Phones {
        let spelling = self.model.spellable(word);
        let mut symbols = self.model.predict(&spelling);
        let stressed = |s: &String| matches!(s.as_bytes().last(), Some(b'0'..=b'2'));
        for k in 0..symbols.len() {
            if symbols[k] == "R"
                && ![k.checked_sub(1), Some(k + 1)]
                    .iter()
                    .flatten()
                    .any(|&j| j < symbols.len() && stressed(&symbols[j]))
            {
                symbols[k] = "ER0".into();
            }
        }
        if !symbols.iter().any(stressed) {
            return self.spell(word);
        }
        let runs = self.aligner.align(&spelling, &symbols);
        promote(&convert(&spelling, &symbols, runs.as_deref()).unwrap_or_default())
    }

    /// Letter names, joined: the last letter carries the main stress.
    fn spell(&self, letters: &str) -> Phones {
        let lower = py::lower(letters);
        let possessive = lower.ends_with("'s");
        let body = if possessive { py::drop_last(letters, 2) } else { letters };
        let names: Vec<&Phones> = py::lower(body).chars().filter_map(|c| self.letter_names.get(&c)).collect();
        let mut out = Vec::new();
        for (index, name) in names.iter().enumerate() {
            for &(ph, s) in name.iter() {
                out.push((ph, if s != 0 && index < names.len() - 1 { 2 } else { s }));
            }
        }
        if possessive && !out.is_empty() { morphology::plural(&out) } else { out }
    }

    /// True for a spelling the tables or the dictionary know.
    pub fn is_word(&self, word: &str) -> bool {
        self.lexicon.contains_key(word) || self.functions.contains_key(word) || self.exceptions.contains_key(word)
    }

    fn built_from_parts(&self, word: &str) -> Option<(Phones, &'static str)> {
        if word.ends_with("'s") && py::len(word) > 3 {
            let (phones, source) = self.built_from_parts(py::drop_last(word, 2))?;
            return Some((morphology::plural(&phones), source));
        }
        if LEIGH.is_match(word) {
            let replaced = LEIGH.sub(word, |_| "ley".into());
            return Some(self.word(&replaced));
        }
        for tail in ["viruses", "virus"] {
            let second = if word.ends_with(tail) && py::len(word) - tail.len() > 2 { self.known(tail) } else { None };
            if let Some(second) = second {
                let (first, source) = self.word(py::drop_last(word, tail.len()));
                let phones = promote(&settle_stress(&morphology::compound(&first, &second)));
                return Some((phones, if source == "model" { "model" } else { "ending" }));
            }
        }
        None
    }

    /// The phones of one spelling in lower case, and where they came from.
    fn word(&self, word: &str) -> (Phones, &'static str) {
        if let Some(hit) = self.cache.lock().unwrap().get(word) {
            return hit.clone();
        }
        let found = self.word_uncached(word);
        self.cache.lock().unwrap().insert(word.to_string(), found.clone());
        found
    }

    fn word_uncached(&self, word: &str) -> (Phones, &'static str) {
        if let Some(phones) = self.known(word) {
            return (phones, "dictionary");
        }
        let lookup = |s: &str| self.known(s);
        let part = |s: &str| self.ordinary(s);
        if let Some(phones) = morphology::derive(word, &lookup, &part, 0) {
            return (settle_stress(&phones), "ending");
        }
        if let Some(found) = self.built_from_parts(word) {
            return found;
        }
        if word.ends_with("'s") && py::len(word) > 3 {
            return (morphology::plural(&self.guess(py::drop_last(word, 2))), "model");
        }
        (self.guess(word), "model")
    }

    // ---- sentences ----

    fn units(&self, words: &[Word], places: &[usize], written: &[String]) -> Vec<Unit> {
        let mut units = Vec::new();
        let mut index = 0;
        while index < words.len() {
            let token = &words[index];
            if let Some(ph) = &token.phones {
                units.push(Unit::new(&token.text, ph.clone(), "p", token.attach));
            } else if token.spell {
                units.push(Unit::new(&token.text, self.spell(&token.text), "p", token.attach));
            } else {
                let size = if self.name_starts.contains(&token.text) { self.name(words, index) } else { 0 };
                if size > 0 {
                    let key: Vec<String> = words[index..index + size].iter().map(|w| w.text.clone()).collect();
                    for (position, (text, entry)) in key.iter().zip(&self.names[&key]).enumerate() {
                        units.push(Unit::new(text, self.entry(text, entry), "p", token.attach && position == 0));
                    }
                    index += size;
                    continue;
                }
                let size = self.phrase(words, index);
                if size > 0 {
                    let key: Vec<String> = words[index..index + size].iter().map(|w| w.text.clone()).collect();
                    let phrase = &self.phrases[&key];
                    if phrase.forms.len() == 1 {
                        let mut unit =
                            Unit::new(&key.join(" "), phrase.forms[0].clone(), class(&phrase.class), token.attach);
                        unit.last = phrase.last.clone();
                        units.push(unit);
                    } else {
                        for (position, (text, form)) in key.iter().zip(&phrase.forms).enumerate() {
                            units.push(Unit::new(
                                text,
                                form.clone(),
                                class(&phrase.class),
                                token.attach && position == 0,
                            ));
                        }
                    }
                    index += size;
                    continue;
                }
                if !written.is_empty()
                    && self.homographs.covers(&token.text)
                    && !self.exceptions.contains_key(&token.text)
                {
                    let (text, ending) = self.homographs.pronounce(&token.text, written, places[index], token.attach);
                    let ph = phones(&text);
                    let ph = if ending { morphology::plural(&ph) } else { ph };
                    units.push(Unit::new(&token.text, ph, "c", token.attach));
                } else if let Some(f) = self.functions.get(&token.text) {
                    let mut unit = Unit::new(&token.text, f.form.clone(), class(&f.class), token.attach);
                    unit.last = f.last.clone();
                    units.push(unit);
                } else {
                    let (ph, _) = self.word(&token.text);
                    units.push(Unit::new(&token.text, ph, "c", token.attach));
                }
            }
            index += 1;
        }
        units
    }

    fn name(&self, words: &[Word], index: usize) -> usize {
        for size in (2..=self.name_length.min(words.len() - index)).rev() {
            let span = &words[index..index + size];
            let key: Vec<String> = span.iter().map(|w| w.text.clone()).collect();
            if self.names.contains_key(&key)
                && span.iter().all(|w| w.phones.is_none() && !w.spell)
                && !span[1..].iter().any(|w| w.attach)
            {
                return size;
            }
        }
        0
    }

    fn phrase(&self, words: &[Word], index: usize) -> usize {
        for size in (2..=self.phrase_length.min(words.len() - index)).rev() {
            let span = &words[index..index + size];
            if span[1..].iter().all(|w| w.phones.is_none() && !w.spell && !w.attach)
                && span[0].phones.is_none()
                && !span[0].spell
                && self.phrases.contains_key(&span.iter().map(|w| w.text.clone()).collect::<Vec<_>>())
            {
                return size;
            }
        }
        0
    }

    /// Clauses and marks in order, as `symbols::tokenize` takes them.
    pub fn pieces(&self, text: &str) -> Vec<Piece> {
        let stream = self.normalizer.tokens(text, &|w| self.is_word(w));
        let written: Vec<String> = stream
            .iter()
            .map(|t| match t {
                Token::Punct(m) => m.clone(),
                Token::Word(w) => {
                    if !w.raw.is_empty() {
                        w.raw.clone()
                    } else if !w.text.is_empty() {
                        w.text.clone()
                    } else {
                        "x".into()
                    }
                }
            })
            .collect();
        let mut out = Vec::new();
        let mut words: Vec<Word> = Vec::new();
        let mut places = Vec::new();
        let flush = |words: &mut Vec<Word>, places: &mut Vec<usize>, out: &mut Vec<Piece>| {
            if !words.is_empty() {
                let mut units = self.units(words, places, &written);
                stress_clause(&mut units);
                join_clause(&mut units);
                out.push(Piece::Words(groups(&units)));
                words.clear();
                places.clear();
            }
        };
        for (place, token) in stream.iter().enumerate() {
            match token {
                Token::Punct(m) => {
                    flush(&mut words, &mut places, &mut out);
                    out.push(Piece::Mark(mark_id(m).expect("a punctuation mark")));
                }
                Token::Word(w) => {
                    words.push(w.clone());
                    places.push(place);
                }
            }
        }
        flush(&mut words, &mut places, &mut out);
        out
    }

    /// Text -> the model's tokens.
    pub fn phonemize(&self, text: &str) -> Result<Phonemized, NothingToPronounce> {
        if py::strip(text).is_empty() {
            return Err(NothingToPronounce);
        }
        tokenize(&self.pieces(text))
    }
}
