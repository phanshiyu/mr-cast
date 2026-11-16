//! Words the dictionary lacks but can be built from words it has (dizione/morphology.py): regular endings, a few
//! prefixes, compounds of two dictionary words and British spellings, with the adjustments English makes at the seam.

use crate::py;
use crate::symbols::{Phone, Phones, is_vowel, p};

fn ph(list: &[&str]) -> Phones {
    list.iter().map(|s| (p(s), 0)).collect()
}

fn st(list: &[(&str, u8)]) -> Phones {
    list.iter().map(|&(s, k)| (p(s), k)).collect()
}

const SIBILANT: [&str; 6] = ["s", "z", "ʃ", "ʒ", "tʃ", "dʒ"];
const VOICELESS: [&str; 6] = ["p", "t", "k", "f", "θ", "ʔ"];
const SPLIT: [(&str, &str); 5] = [("ɑːɹ", "ɑː"), ("ɔːɹ", "ɔː"), ("oːɹ", "oː"), ("ɪɹ", "ɪ"), ("ɛɹ", "ɛ")];
const RHOTIC: [&str; 4] = ["ɚ", "ɜː", "aɪɚ", "ʊɹ"];
const CONSONANT_LETTERS: &str = "bcdfghjklmnpqrstvwxz";

fn is_in(id: u8, set: &[&str]) -> bool {
    set.iter().any(|s| p(s) == id)
}

fn endings() -> Vec<(&'static str, Phones)> {
    vec![
        ("fully", ph(&["f", "əl", "i"])),
        ("lessly", ph(&["l", "ə", "s", "l", "i"])),
        ("ness", ph(&["n", "ə", "s"])),
        ("less", ph(&["l", "ə", "s"])),
        ("ments", ph(&["m", "ə", "n", "t", "s"])),
        ("ment", ph(&["m", "ə", "n", "t"])),
        ("ful", ph(&["f", "əl"])),
        ("ship", st(&[("ʃ", 0), ("ɪ", 2), ("p", 0)])),
        ("hood", st(&[("h", 0), ("ʊ", 2), ("d", 0)])),
        ("like", st(&[("l", 0), ("aɪ", 2), ("k", 0)])),
        ("dom", ph(&["d", "ə", "m"])),
        ("ish", ph(&["ɪ", "ʃ"])),
        ("able", ph(&["ə", "b", "əl"])),
        ("ism", ph(&["ɪ", "z", "ə", "m"])),
        ("ist", ph(&["ɪ", "s", "t"])),
        ("wards", ph(&["w", "ɚ", "d", "z"])),
        ("ward", ph(&["w", "ɚ", "d"])),
        ("age", ph(&["ɪ", "dʒ"])),
        ("ers", ph(&["ɚ", "z"])),
        ("er", ph(&["ɚ"])),
        ("est", ph(&["ɪ", "s", "t"])),
        ("y", ph(&["i"])),
    ]
}

/// Prefix spelling -> (form before a stem stressed on its first syllable, form otherwise).
fn prefixes() -> Vec<(&'static str, Phones, Phones)> {
    let same = |s: &'static str, f: Phones| (s, f.clone(), f);
    vec![
        same("under", st(&[("ʌ", 2), ("n", 0), ("d", 0), ("ɚ", 0)])),
        same("over", st(&[("oʊ", 2), ("v", 0), ("ɚ", 0)])),
        same("anti", st(&[("æ", 2), ("n", 0), ("t", 0), ("i", 0)])),
        same("semi", st(&[("s", 0), ("ɛ", 2), ("m", 0), ("i", 0)])),
        same("non", st(&[("n", 0), ("ɑː", 2), ("n", 0)])),
        same("out", st(&[("aʊ", 2), ("t", 0)])),
        ("dis", ph(&["d", "ɪ", "s"]), st(&[("d", 0), ("ɪ", 2), ("s", 0)])),
        ("mis", ph(&["m", "ɪ", "s"]), st(&[("m", 0), ("ɪ", 2), ("s", 0)])),
        ("un", ph(&["ʌ", "n"]), st(&[("ʌ", 2), ("n", 0)])),
        ("in", ph(&["ɪ", "n"]), st(&[("ɪ", 2), ("n", 0)])),
        ("re", ph(&["ɹ", "ᵻ"]), st(&[("ɹ", 0), ("iː", 2)])),
        same("pre", st(&[("p", 0), ("ɹ", 0), ("iː", 2)])),
    ]
}

const BRITISH: [(&str, &str); 23] = [
    ("isation", "ization"),
    ("ising", "izing"),
    ("ised", "ized"),
    ("ises", "izes"),
    ("ise", "ize"),
    ("yse", "yze"),
    ("our", "or"),
    ("ourable", "orable"),
    ("ours", "ors"),
    ("oured", "ored"),
    ("ouring", "oring"),
    ("tre", "ter"),
    ("tres", "ters"),
    ("bre", "ber"),
    ("ence", "ense"),
    ("ogue", "og"),
    ("mme", "m"),
    ("lled", "led"),
    ("lling", "ling"),
    ("ller", "ler"),
    ("oul", "ol"),
    ("ae", "e"),
    ("enqui", "inqui"),
];

/// Stem + ending, adjusted at the seam.
pub fn join(stem: &[Phone], ending: &[Phone]) -> Phones {
    let mut stem = stem.to_vec();
    if stem.is_empty() || ending.is_empty() {
        stem.extend_from_slice(ending);
        return stem;
    }
    let (last, stress) = *stem.last().unwrap();
    let (first, first_stress) = ending[0];
    let n = stem.len();
    if is_vowel(first) {
        if let Some((_, to)) = SPLIT.iter().find(|(from, _)| p(from) == last) {
            stem.pop();
            stem.push((p(to), stress));
            stem.push((p("ɹ"), 0));
        } else if is_in(last, &RHOTIC) {
            stem.push((p("ɹ"), 0));
        } else if last == p("t")
            && n > 1
            && (is_vowel(stem[n - 2].0) || stem[n - 2].0 == p("ɹ"))
            && first_stress == 0
            && !(first == p("ə") && ending.len() > 1 && ending[1].0 == p("n"))
        {
            stem[n - 1] = (p("ɾ"), 0);
        } else if last == p("i") {
            stem[n - 1] = if first != p("ɪ") { (p("ɪ"), stress) } else { (p("i"), stress) };
        }
    } else if last == p("i") && is_in(first, &["n", "l", "f", "m"]) {
        stem[n - 1] = (p("ɪ"), stress);
    } else if last == p("n") && is_in(first, &["k", "ɡ"]) {
        stem[n - 1] = (p("ŋ"), 0);
    }
    stem.extend_from_slice(ending);
    stem
}

pub fn plural(stem: &[Phone]) -> Phones {
    let last = stem.last().unwrap().0;
    let ending = if is_in(last, &SIBILANT) {
        ph(&["ᵻ", "z"])
    } else if is_in(last, &VOICELESS) {
        ph(&["s"])
    } else {
        ph(&["z"])
    };
    join(stem, &ending)
}

pub fn past(stem: &[Phone]) -> Phones {
    let last = stem.last().unwrap().0;
    if is_in(last, &["t", "d", "ɾ"]) {
        return join(stem, &ph(&["ᵻ", "d"]));
    }
    join(stem, &if is_in(last, &VOICELESS) || is_in(last, &["s", "ʃ", "tʃ"]) { ph(&["t"]) } else { ph(&["d"]) })
}

pub fn adverb(stem: &[Phone]) -> Phones {
    let last = stem.last().unwrap().0;
    join(stem, &if is_in(last, &["əl", "l"]) { ph(&["i"]) } else { ph(&["l", "i"]) })
}

/// `(?:^|[^aeiou])[aeiou](?:[bcdfgklmnprstvz]|th)$`
fn short_stem(body: &str) -> bool {
    let c: Vec<char> = body.chars().collect();
    let vowel = |x: char| "aeiou".contains(x);
    let check = |v: usize| vowel(c[v]) && (v == 0 || !vowel(c[v - 1]));
    let n = c.len();
    if n >= 2 && "bcdfgklmnprstvz".contains(c[n - 1]) && check(n - 2) {
        return true;
    }
    n >= 3 && c[n - 2] == 't' && c[n - 1] == 'h' && check(n - 3)
}

fn stems(body: &str) -> Vec<String> {
    let c: Vec<char> = body.chars().collect();
    let mut out = vec![body.to_string()];
    let n = c.len();
    if n > 2 && c[n - 1] == c[n - 2] && CONSONANT_LETTERS.contains(c[n - 1]) {
        out.push(c[..n - 1].iter().collect());
    }
    if n > 0 && (CONSONANT_LETTERS.contains(c[n - 1]) || c[n - 1] == 'u') {
        let with_e = format!("{body}e");
        if short_stem(body) {
            out.insert(0, with_e);
        } else {
            out.push(with_e);
        }
    }
    if body.ends_with('i') && n > 2 {
        out.push(format!("{}y", py::drop_last(body, 1)));
    }
    out
}

fn secondary(phones: &[Phone]) -> Phones {
    phones.iter().map(|&(ph, s)| (ph, if s == 1 { 2 } else { s })).collect()
}

/// Two words said as one: the second keeps only a lesser stress.
pub fn compound(first: &[Phone], second: &[Phone]) -> Phones {
    join(first, &secondary(second))
}

/// Pronunciation of `word` from a shorter dictionary word. `lookup` finds a dictionary word, `part` a word that
/// may be half of a compound.
pub fn derive(
    word: &str,
    lookup: &dyn Fn(&str) -> Option<Phones>,
    part: &dyn Fn(&str) -> Option<Phones>,
    depth: usize,
) -> Option<Phones> {
    let wl = py::len(word);
    let stem = |spelling: &str| -> Option<Phones> {
        if py::len(spelling) < 2 {
            return None;
        }
        lookup(spelling)
            .filter(|f| !f.is_empty())
            .or_else(|| if depth < 2 { derive(spelling, lookup, part, depth + 1) } else { None })
    };
    let first = |candidates: &[String], build: &dyn Fn(Phones) -> Option<Phones>| -> Option<Phones> {
        for spelling in candidates {
            if let Some(found) = stem(spelling).filter(|f| !f.is_empty()) {
                return build(found);
            }
        }
        None
    };
    let cut = |n: usize| py::drop_last(word, n).to_string();
    if word.ends_with("'s") {
        return first(&[cut(2)], &|f| Some(plural(&f)));
    }
    if word.ends_with("s'") {
        return first(&[cut(1)], &Some);
    }
    if word.ends_with("ies")
        && wl > 4
        && let Some(f) = first(&[format!("{}y", cut(3))], &|f| Some(plural(&f)))
    {
        return Some(f);
    }
    if word.ends_with("ves") && wl > 4 {
        let body = cut(3);
        let found = first(&[format!("{body}f"), format!("{body}fe")], &|f| {
            if f.last().unwrap().0 == p("f") {
                let mut s = f[..f.len() - 1].to_vec();
                s.push((p("v"), 0));
                Some(join(&s, &ph(&["z"])))
            } else {
                None
            }
        });
        if found.is_some() {
            return found;
        }
    }
    if word.ends_with("es") && wl > 3 {
        let third = py::char_at(word, wl - 3).unwrap();
        let candidates = if "sxzh".contains(third) { vec![cut(2)] } else { vec![] };
        if let Some(f) = first(&candidates, &|f| Some(plural(&f))) {
            return Some(f);
        }
    }
    if word.ends_with('s')
        && !(word.ends_with("ss") || word.ends_with("us") || word.ends_with("is"))
        && wl > 3
        && let Some(f) = first(&[cut(1)], &|f| Some(plural(&f)))
    {
        return Some(f);
    }
    if word.ends_with("ied")
        && wl > 4
        && let Some(f) = first(&[format!("{}y", cut(3))], &|f| Some(past(&f)))
    {
        return Some(f);
    }
    if word.ends_with("ed")
        && wl > 3
        && let Some(f) = first(&stems(&cut(2)), &|f| Some(past(&f)))
    {
        return Some(f);
    }
    if word.ends_with("ing")
        && wl > 4
        && let Some(f) = first(&stems(&cut(3)), &|f| Some(join(&f, &ph(&["ɪ", "ŋ"]))))
    {
        return Some(f);
    }
    if word.ends_with("ily")
        && wl > 4
        && let Some(f) = first(&[format!("{}y", cut(3))], &|f| Some(adverb(&f)))
    {
        return Some(f);
    }
    if word.ends_with("ly") && wl > 3 {
        let candidates = if word.ends_with("bly") || word.ends_with("ply") {
            vec![cut(2), format!("{}le", cut(2)), format!("{}e", cut(1))]
        } else {
            vec![cut(2)]
        };
        if let Some(f) = first(&candidates, &|f| Some(adverb(&f))) {
            return Some(f);
        }
    }
    for (spelling, phones) in endings() {
        let sl = spelling.len();
        if word.ends_with(spelling) && wl - sl > 2 {
            let body = cut(sl);
            let last = body.chars().next_back().unwrap();
            if spelling == "y" && !CONSONANT_LETTERS.contains(last) {
                continue;
            }
            let vowel_first = is_vowel(phones[0].0);
            let candidates = if vowel_first {
                stems(&body)
            } else if body.ends_with('i') {
                vec![format!("{}y", py::drop_last(&body, 1)), body.clone()]
            } else {
                vec![body.clone()]
            };
            if let Some(f) = first(&candidates, &|f| Some(join(&f, &phones))) {
                return Some(f);
            }
        }
    }
    for (spelling, plain, stressed) in prefixes() {
        if word.starts_with(spelling)
            && wl - spelling.len() > 2
            && let Some(found) = stem(py::drop_first(word, spelling.len())).filter(|f| !f.is_empty())
        {
            let vowels: Vec<u8> = found.iter().filter(|(ph, _)| is_vowel(*ph)).map(|&(_, s)| s).collect();
            let head = if vowels.first() == Some(&1) { plain } else { stressed };
            return Some(join(&head, &found));
        }
    }
    for (old, new) in BRITISH {
        if word.contains(old)
            && let Some(found) = stem(&word.replacen(old, new, 1)).filter(|f| !f.is_empty())
        {
            return Some(found);
        }
    }
    if depth == 0 {
        let mut best: Option<(usize, Phones, Phones)> = None;
        for cut_at in 4..wl.saturating_sub(3) {
            let (left, right) = (part(py::slice(word, 0, cut_at)), part(py::drop_first(word, cut_at)));
            if let (Some(left), Some(right)) = (left, right)
                && !left.is_empty()
                && !right.is_empty()
            {
                let score = cut_at.min(wl - cut_at);
                if best.as_ref().is_none_or(|b| score > b.0) {
                    best = Some((score, left, right));
                }
            }
        }
        if let Some((_, left, right)) = best {
            return Some(compound(&left, &right));
        }
    }
    None
}
