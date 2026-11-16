//! One word: CMUdict pronunciation -> phones of the inventory (dizione/convert.py).
//!
//! The rules that depend on how a vowel is written work on the pronunciation aligned to the spelling; without an
//! alignment they fall back to their default.

use crate::align::base;
use crate::py;
use crate::symbols::{Phone, Phones, is_vowel, p};

const ARPA_VOWELS: [&str; 15] =
    ["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"];
const CONSONANTS: [(&str, &str); 24] = [
    ("B", "b"),
    ("CH", "tʃ"),
    ("D", "d"),
    ("DH", "ð"),
    ("F", "f"),
    ("G", "ɡ"),
    ("HH", "h"),
    ("JH", "dʒ"),
    ("K", "k"),
    ("L", "l"),
    ("M", "m"),
    ("N", "n"),
    ("NG", "ŋ"),
    ("P", "p"),
    ("R", "ɹ"),
    ("S", "s"),
    ("SH", "ʃ"),
    ("T", "t"),
    ("TH", "θ"),
    ("V", "v"),
    ("W", "w"),
    ("Y", "j"),
    ("Z", "z"),
    ("ZH", "ʒ"),
];
const FULL_VOWELS: [(&str, &str); 15] = [
    ("AA", "ɑː"),
    ("AE", "æ"),
    ("AH", "ʌ"),
    ("AO", "ɔː"),
    ("AW", "aʊ"),
    ("AY", "aɪ"),
    ("EH", "ɛ"),
    ("ER", "ɜː"),
    ("EY", "eɪ"),
    ("IH", "ɪ"),
    ("IY", "iː"),
    ("OW", "oʊ"),
    ("OY", "ɔɪ"),
    ("UH", "ʊ"),
    ("UW", "uː"),
];
const SIBILANTS: [&str; 6] = ["S", "Z", "SH", "ZH", "CH", "JH"];
const VOWEL_LETTERS: &str = "aeiouy";
const FORCE_SPELLINGS: [&str; 10] =
    ["forc", "ford", "sword", "worn", "torn", "sworn", "borne", "shorn", "pork", "divorc"];
const PREFIXES: [&str; 8] = ["dis", "mis", "un", "in", "re", "non", "over", "pre"];
const WEAK_PREFIXES: [&str; 4] = ["be", "de", "re", "pre"];
const IRE_ENDINGS: [&str; 8] = ["ing", "ings", "ingly", "able", "y", "er", "ers", "est"];

fn is_arpa_vowel(name: &str) -> bool {
    ARPA_VOWELS.contains(&name)
}

fn consonant(name: &str) -> Option<&'static str> {
    CONSONANTS.iter().find(|(k, _)| *k == name).map(|(_, v)| *v)
}

fn full_vowel(name: &str) -> &'static str {
    FULL_VOWELS.iter().find(|(k, _)| *k == name).map(|(_, v)| *v).unwrap()
}

/// True when every symbol is ARPABET (a consonant, or a vowel with a stress digit).
pub fn is_arpabet<S: AsRef<str>>(symbols: &[S]) -> bool {
    !symbols.is_empty()
        && symbols.iter().all(|s| {
            let s = s.as_ref();
            consonant(s).is_some()
                || (s.len() == 3 && is_arpa_vowel(&s[..2]) && matches!(s.as_bytes()[2], b'0' | b'1' | b'2'))
        })
}

fn vowel_letters(run: &str) -> String {
    run.chars().filter(|c| VOWEL_LETTERS.contains(*c)).collect()
}

/// `"h ə l ˈoʊ"` -> phones; an error on a symbol outside the inventory or a stressed consonant.
pub fn from_text(text: &str) -> Result<Phones, String> {
    let mut phones = Vec::new();
    for unit in text.split(py::is_space).filter(|u| !u.is_empty()) {
        let (stress, phone) = if let Some(rest) = unit.strip_prefix('ˈ') {
            (1, rest)
        } else if let Some(rest) = unit.strip_prefix('ˌ') {
            (2, rest)
        } else {
            (0, unit)
        };
        let id = crate::symbols::id(phone)
            .filter(|&i| crate::symbols::is_phone(i))
            .ok_or_else(|| format!("{phone:?} is not a phone of the inventory"))?;
        if stress != 0 && !is_vowel(id) {
            return Err(format!("stress mark on the consonant {phone:?}"));
        }
        phones.push((id, stress));
    }
    Ok(phones)
}

/// `from_text` of a table's own text, which is known to be valid.
pub fn phones(text: &str) -> Phones {
    from_text(text).unwrap_or_else(|e| panic!("{text:?}: {e}"))
}

struct Word<'a> {
    word: &'a str,
    bases: Vec<String>,
    stress: Vec<Option<u8>>,
    aligned: bool,
    runs: Vec<String>,
    starts: Vec<usize>,
    count: usize,
}

impl<'a> Word<'a> {
    fn new(word: &'a str, arpabet: &[String], runs: Option<&[String]>) -> Result<Word<'a>, String> {
        let bases: Vec<String> = arpabet.iter().map(|s| base(s).to_string()).collect();
        let stress = arpabet
            .iter()
            .map(|s| match s.as_bytes().last() {
                Some(b @ b'0'..=b'2') => Some(b - b'0'),
                _ => None,
            })
            .collect();
        for (symbol, name) in arpabet.iter().zip(&bases) {
            if consonant(name).is_none() && !is_arpa_vowel(name) {
                return Err(format!("{symbol:?} is not an ARPABET symbol"));
            }
        }
        let aligned = runs.is_some();
        let runs: Vec<String> = match runs {
            Some(r) => r.to_vec(),
            None => vec![String::new(); arpabet.len()],
        };
        let mut starts = Vec::with_capacity(runs.len());
        let mut position = 0;
        for run in &runs {
            starts.push(position);
            position += py::len(run);
        }
        let count = bases.len();
        Ok(Word { word, bases, stress, aligned, runs, starts, count })
    }

    fn base(&self, i: isize) -> Option<&str> {
        if i >= 0 && (i as usize) < self.count { Some(&self.bases[i as usize]) } else { None }
    }

    fn vowel(&self, i: usize) -> bool {
        i < self.count && is_arpa_vowel(&self.bases[i])
    }

    fn unstressed(&self, i: usize) -> bool {
        self.vowel(i) && !matches!(self.stress[i], Some(s) if s != 0)
    }

    fn letters(&self, i: usize) -> String {
        vowel_letters(&self.runs[i])
    }

    fn before(&self, i: usize) -> &str {
        if self.aligned { py::slice(self.word, 0, self.starts[i]) } else { "" }
    }

    fn after(&self, i: usize) -> &str {
        if self.aligned { py::drop_first(self.word, self.starts[i] + py::len(&self.runs[i])) } else { "" }
    }

    fn ends_with(&self, i: usize, symbols: &[&str]) -> bool {
        let rest = if i < self.count { &self.bases[i + 1..] } else { &[][..] };
        rest.len() == symbols.len() && rest.iter().zip(symbols).all(|(a, b)| a == b)
    }

    fn first_vowel(&self, i: usize) -> bool {
        !self.bases[..i].iter().any(|b| is_arpa_vowel(b))
    }

    fn next_vowel_stress(&self, i: usize) -> Option<u8> {
        for j in i + 1..self.count {
            if is_arpa_vowel(&self.bases[j]) {
                return Some(self.stress[j].unwrap_or(0));
            }
        }
        None
    }

    fn weak_prefix(&self, i: usize) -> bool {
        self.aligned
            && self.first_vowel(i)
            && self.letters(i) == "e"
            && WEAK_PREFIXES.iter().any(|p| self.word.starts_with(p))
            && ["b", "d", "r", "pr"].contains(&self.before(i))
    }
}

fn truthy(stress: Option<u8>) -> bool {
    matches!(stress, Some(s) if s != 0)
}

fn north_or_force(w: &Word, i: usize, before_vowel: bool) -> &'static str {
    if !w.aligned {
        return "ɔː";
    }
    let spelled = w.letters(i);
    if ["oa", "oo", "ou"].contains(&spelled.as_str()) {
        return "oː";
    }
    if spelled != "o" {
        return "ɔː";
    }
    let run = &w.runs[i];
    // run.find("o") + 1: -1 + 1 = 0 when there is no "o", as in Python.
    let from = run.find('o').map_or(0, |b| b + 1);
    let tail = format!("{}{}", &run[from..], w.after(i));
    let rest = py::drop_first(&tail, 1);
    if !before_vowel {
        if rest.starts_with('e') {
            return "oː";
        }
        if w.before(i).ends_with('p') && rest.starts_with('t') {
            return "oː";
        }
        return if FORCE_SPELLINGS.iter().any(|s| w.word.contains(s)) { "oː" } else { "ɔː" };
    }
    if rest.starts_with('r') {
        return "ɔː";
    }
    if ["y", "ies", "ied", "a", "as", "ah", "er", "ers"].contains(&rest)
        || ["ia", "io", "iu", "ing", "age"].iter().any(|p| rest.starts_with(p))
    {
        return "oː";
    }
    "ɔː"
}

fn weak_i(w: &Word, i: usize) -> &'static str {
    let ii = i as isize;
    let (nxt, nxt2) = (w.base(ii + 1), w.base(ii + 2));
    if nxt == Some("F") && nxt2 == Some("AH") && w.base(ii + 3) == Some("L") {
        return "i";
    }
    if (nxt == Some("T") && nxt2 == Some("IY"))
        || (nxt == Some("B") && matches!(nxt2, Some("AH") | Some("L")))
        || (nxt == Some("F") && nxt2 == Some("AY"))
    {
        return "ᵻ";
    }
    if nxt == Some("T")
        && w.ends_with(i, &["T"])
        && matches!(w.base(ii - 1), Some("R") | Some("ER"))
        && w.word.ends_with("ite")
    {
        return "ᵻ";
    }
    "ɪ"
}

fn weak_e(w: &Word, i: usize) -> &'static str {
    let ii = i as isize;
    let (nxt, prev) = (w.base(ii + 1), w.base(ii - 1));
    if nxt == Some("T") && (w.ends_with(i, &["T"]) || w.ends_with(i, &["T", "S"])) {
        return if prev == Some("L") {
            "ə"
        } else if prev == Some("R") {
            "ᵻ"
        } else {
            "ɪ"
        };
    }
    if nxt == Some("S") && (w.ends_with(i, &["S", "T"]) || w.ends_with(i, &["S", "T", "L", "IY"])) {
        return "ɪ";
    }
    if nxt == Some("JH") {
        return "ɪ";
    }
    if nxt == Some("K") && w.base(ii + 2) == Some("T") {
        return "ɛ";
    }
    if nxt == Some("D") && w.ends_with(i, &["D"]) {
        return "ɪ";
    }
    "ə"
}

fn inflection(w: &Word, i: usize) -> bool {
    if i + 1 >= w.count || (w.aligned && !format!("{}{}", w.runs[i], w.runs[i + 1]).contains('e')) {
        return false;
    }
    let ii = i as isize;
    let (nxt, prev) = (w.base(ii + 1), w.base(ii - 1));
    if nxt == Some("D")
        && matches!(prev, Some("T") | Some("D"))
        && (w.ends_with(i, &["D"]) || w.ends_with(i, &["D", "L", "IY"]))
    {
        return true;
    }
    nxt == Some("Z") && prev.is_some_and(|p| SIBILANTS.contains(&p)) && w.ends_with(i, &["Z"])
}

fn first_syllable(w: &Word, i: usize) -> Option<&'static str> {
    if !w.aligned || !w.first_vowel(i) || !truthy(w.next_vowel_stress(i)) {
        return None;
    }
    let word: Vec<char> = w.word.chars().collect();
    let is_vl = |c: char| VOWEL_LETTERS.contains(c);
    if i == 0 && w.word.starts_with('e') {
        if w.word.starts_with("ex") {
            return Some("ɛ");
        }
        if word.len() > 2 && matches!(word[1], 'n' | 'm' | 's') && !is_vl(word[2]) && word[2] != word[1] {
            return Some("ɛ");
        }
        return Some("ɪ");
    }
    if w.weak_prefix(i) {
        if w.word.starts_with("pre") || (w.word.starts_with("be") && word.len() > 2 && matches!(word[2], 'c' | 'g')) {
            return Some("ɪ");
        }
        return Some("ᵻ");
    }
    if w.letters(i) == "i"
        && w.word.starts_with("di")
        && word.len() > 3
        && !is_vl(word[2])
        && word[2] != 's'
        && is_vl(word[3])
    {
        return Some("ᵻ");
    }
    None
}

fn reduced(w: &Word, i: usize) -> &'static str {
    let ii = i as isize;
    let name = w.bases[i].as_str();
    let spelled = w.letters(i);
    let (nxt, prev) = (w.base(ii + 1), w.base(ii - 1));
    if name == "IH" && nxt == Some("NG") {
        return "ɪ";
    }
    if inflection(w, i) {
        return "ᵻ";
    }
    if name == "AH" {
        if prev == Some("Y") && format!("{}{}", w.runs[i - 1], w.runs[i]).contains('u') {
            return "ʊ";
        }
        if i == 0 && w.word.starts_with('a') {
            return "ɐ";
        }
        if i == 0 && nxt == Some("N") && w.word.starts_with("un") {
            return "ʌ";
        }
        if spelled == "a" && PREFIXES.contains(&w.before(i)) && w.runs[i].starts_with('a') {
            return "ɐ";
        }
    }
    if let Some(prefix) = first_syllable(w, i) {
        return prefix;
    }
    if spelled == "e"
        && matches!(nxt, Some("K") | Some("G"))
        && w.runs[i + 1].starts_with('x')
        && truthy(w.next_vowel_stress(i))
    {
        return "ɛ";
    }
    if ["i", "ai", "ui", "y"].contains(&spelled.as_str()) {
        return weak_i(w, i);
    }
    if spelled == "e" {
        return weak_e(w, i);
    }
    if spelled == "a" {
        if nxt == Some("JH") || (nxt == Some("N") && w.base(ii + 2) == Some("JH")) {
            return "ɪ";
        }
        if nxt == Some("S") && w.ends_with(i, &["S"]) && w.word.ends_with("ace") {
            return "ɪ";
        }
        if name == "IH" && !(nxt == Some("T") && w.ends_with(i, &["T"])) {
            return "ɪ";
        }
        return "ə";
    }
    if name == "AH" && nxt == Some("M") && w.ends_with(i, &["M"]) && w.word.ends_with("ome") {
        return "ʌ";
    }
    if name == "IH" && !["o", "u", "ou"].contains(&spelled.as_str()) { "ɪ" } else { "ə" }
}

fn unstressed_iy(w: &Word, i: usize) -> (&'static str, u8) {
    let ii = i as isize;
    let nxt = w.base(ii + 1);
    if nxt.is_none() || w.ends_with(i, &["Z"]) || w.ends_with(i, &["D"]) {
        return ("i", 0);
    }
    if w.vowel(i + 1) {
        return (if nxt == Some("IH") && w.base(ii + 2) == Some("NG") { "i" } else { "ɪ" }, 0);
    }
    if w.weak_prefix(i) {
        return if w.next_vowel_stress(i) == Some(1) { ("ᵻ", 0) } else { ("iː", 2) };
    }
    ("ɪ", 0)
}

/// Citation form of `word` from a CMUdict pronunciation and, when known, the letters aligned to each symbol.
pub fn convert(word: &str, arpabet: &[String], runs: Option<&[String]>) -> Result<Phones, String> {
    let w = Word::new(word, arpabet, runs)?;
    let mut out: Vec<(u8, u8)> = Vec::new();
    let emit = |out: &mut Vec<(u8, u8)>, phone: &str, stress: u8| out.push((p(phone), stress));
    let mut i = 0;
    while i < w.count {
        let ii = i as isize;
        let name = w.bases[i].as_str();
        let stress = w.stress[i].unwrap_or(0);
        let nxt = w.base(ii + 1);
        if !is_arpa_vowel(name) {
            if name == "Y"
                && nxt == Some("AH")
                && w.unstressed(i + 1)
                && matches!(w.base(ii - 1), Some("N") | Some("L"))
                && w.base(ii + 2) != Some("L")
                && (!w.aligned || format!("{}{}", w.runs[i], w.runs[i + 1]).contains('i'))
            {
                emit(&mut out, "iə", 0);
                i += 2;
                continue;
            }
            emit(&mut out, consonant(name).unwrap(), 0);
            i += 1;
            continue;
        }
        let before_vowel = w.vowel(i + 2);
        if name == "ER" {
            emit(&mut out, if stress != 0 { "ɜː" } else { "ɚ" }, stress);
            if nxt == Some("R") {
                i += 1;
            }
            if w.vowel(i + 1) {
                emit(&mut out, "ɹ", 0);
            }
        } else if nxt == Some("R") && name == "AW" {
            emit(&mut out, "aʊ", stress);
            emit(&mut out, "ɚ", 0);
            if before_vowel {
                emit(&mut out, "ɹ", 0);
            }
            i += 1;
        } else if nxt == Some("R") && ["AA", "AO", "IH", "IY", "EH", "UH", "UW", "AY"].contains(&name) {
            let (quality, single): (String, String) = match name {
                "AA" => ("ɑː".into(), "ɑːɹ".into()),
                "AO" => {
                    let q = north_or_force(&w, i, before_vowel);
                    (q.into(), format!("{q}ɹ"))
                }
                "IH" | "IY" => (
                    if stress != 0 && ["e", "eo"].contains(&w.letters(i).as_str()) { "iə" } else { "ɪ" }.into(),
                    "ɪɹ".into(),
                ),
                "EH" => {
                    let doubled = format!("{}{}", w.runs[i + 1], w.after(i + 1)).starts_with("rr")
                        || (w.runs[i].ends_with('r') && w.runs[i + 1].starts_with('r'));
                    (if w.letters(i) == "a" && doubled { "æ" } else { "ɛ" }.into(), "ɛɹ".into())
                }
                "UH" | "UW" => ("ʊɹ".into(), "ʊɹ".into()),
                _ => (
                    if !w.aligned || IRE_ENDINGS.contains(&w.after(i + 1)) { "aɪɚ" } else { "aɪ" }.into(),
                    "aɪɚ".into(),
                ),
            };
            if before_vowel {
                emit(&mut out, &quality, stress);
                emit(&mut out, "ɹ", 0);
            } else {
                emit(&mut out, &single, stress);
            }
            i += 1;
        } else if name == "AY" && nxt == Some("ER") && w.unstressed(i + 1) && w.runs[i + 1] == "er" && w.runs[i] != "i"
        {
            emit(&mut out, "aɪ", stress);
        } else if name == "AY" && nxt == Some("ER") && w.unstressed(i + 1) {
            emit(&mut out, "aɪɚ", stress);
            i += 1;
            if w.vowel(i + 1) {
                emit(&mut out, "ɹ", 0);
            }
        } else if name == "AY" && nxt == Some("AH") && w.unstressed(i + 1) {
            emit(&mut out, "aɪə", stress);
            i += 1;
        } else if name == "IY" && nxt == Some("AH") && w.unstressed(i + 1) && !w.weak_prefix(i) {
            let after = w.base(ii + 2);
            if stress != 1
                && (matches!(after, Some("L") | Some("D") | Some("T"))
                    || (after == Some("N") && w.base(ii + 3) == Some("S")))
            {
                emit(&mut out, "ɪ", 0);
            } else {
                emit(&mut out, "iə", stress);
                i += 1;
            }
        } else if stress == 0
            && name == "AH"
            && nxt == Some("N")
            && w.base(ii - 1) == Some("T")
            && w.base(ii + 2) != Some("T")
            && out.len() >= 2
            && out[out.len() - 1].0 == p("t")
            && is_vowel(out[out.len() - 2].0)
            && out[out.len() - 2].1 != 0
        {
            let last = out.len() - 1;
            out[last].0 = p("ʔ");
            emit(&mut out, "n̩", 0);
            i += 1;
        } else if stress == 0
            && name == "AH"
            && nxt == Some("W")
            && w.base(ii + 2) == Some("AH")
            && w.unstressed(i + 2)
            && format!("{}{}", w.runs[i], w.runs[i + 1]).contains('u')
        {
            emit(&mut out, "uː", 0);
            i += 1;
        } else if stress == 0
            && name == "AH"
            && nxt == Some("L")
            && i > 0
            && !(w.vowel(i + 2) && truthy(w.stress[i + 2]))
        {
            if w.letters(i) == "i" && w.vowel(i + 2) {
                emit(&mut out, "ɪ", 0);
            } else if w.base(ii - 1) == Some("Y") && format!("{}{}", w.runs[i - 1], w.runs[i]).contains('u') {
                emit(&mut out, "ʊ", 0);
            } else {
                emit(&mut out, "əl", 0);
                i += 1;
            }
        } else if stress == 0 && (name == "AH" || name == "IH") {
            emit(&mut out, reduced(&w, i), 0);
        } else if name == "IY" && (stress == 0 || (stress == 2 && nxt.is_none())) {
            let (ph, s) = unstressed_iy(&w, i);
            emit(&mut out, ph, s);
        } else if stress == 0
            && name == "AE"
            && i == 0
            && (w.word.starts_with("ad") || w.word.starts_with("acc"))
            && matches!(nxt, Some("D") | Some("K"))
        {
            emit(&mut out, "ɐ", 0);
        } else if stress == 0 && name == "ER" {
            emit(&mut out, "ɚ", 0);
        } else if ((name == "AA" || name == "AO")
            && w.letters(i) == "a"
            && (w.before(i).ends_with('w') || w.before(i).ends_with("qu"))
            && nxt == Some("N"))
            || (name == "AO" && w.letters(i) == "o")
        {
            // want, quantity; long, off, lost
            emit(&mut out, "ɔ", stress);
        } else {
            emit(&mut out, full_vowel(name), stress);
        }
        i += 1;
    }
    flap(&mut out);
    for k in 0..out.len().saturating_sub(1) {
        if out[k].0 == p("n") && (out[k + 1].0 == p("k") || out[k + 1].0 == p("ɡ")) {
            out[k].0 = p("ŋ");
        }
    }
    settle(&mut out);
    Ok(out)
}

fn flap(out: &mut [(u8, u8)]) {
    let (t, r) = (p("t"), p("ɹ"));
    for k in 1..out.len().saturating_sub(1) {
        if out[k].0 != t {
            continue;
        }
        let before = out[k - 1].0;
        let (after, stress) = out[k + 1];
        if (!is_vowel(before) && before != r)
            || before == p("n̩")
            || before == p("əl")
            || !is_vowel(after)
            || after == p("n̩")
        {
            continue;
        }
        let final_o = after == p("oʊ") && (k + 2 == out.len() || (k + 3 == out.len() && out[k + 2].0 == p("z")));
        if stress != 0 && !final_o {
            continue;
        }
        if (after == p("ə") || after == p("ɚ")) && k + 2 < out.len() && out[k + 2].0 == p("n") {
            continue;
        }
        out[k].0 = p("ɾ");
    }
}

/// `_settle_stress` for a finished pronunciation (compounds, prefixed words).
pub fn settle_stress(phones: &[Phone]) -> Phones {
    let mut out = phones.to_vec();
    settle(&mut out);
    out
}

/// One primary stress per word, and no secondary stress on a syllable next to the primary one.
fn settle(out: &mut [(u8, u8)]) {
    let vowels: Vec<usize> = (0..out.len()).filter(|&k| is_vowel(out[k].0)).collect();
    let primaries: Vec<usize> = vowels.iter().copied().filter(|&k| out[k].1 == 1).collect();
    if primaries.len() > 1 {
        for &k in &primaries[..primaries.len() - 1] {
            out[k].1 = 2;
        }
    }
    for (position, &k) in vowels.iter().enumerate() {
        if out[k].1 != 2 {
            continue;
        }
        let near = [position.checked_sub(1), Some(position + 1)];
        if near.iter().flatten().filter(|&&q| q < vowels.len()).any(|&q| out[vowels[q]].1 == 1) {
            out[k].1 = 0;
        }
    }
}
