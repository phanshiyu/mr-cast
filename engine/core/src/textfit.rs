//! Text fitting: a port of shared/textfit.mjs over the glyph advances in shared/font-metrics.mjs (dumped to
//! data/font-metrics.json by scripts/engine-dump.mjs). `validate` fits text with the JS, so the engine must
//! break lines and pick sizes exactly as it does; tests/textfit.rs checks that against the JS's own output.

use crate::markup::{Run, parse_markup};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Family {
    Sans,
    Mono,
}

/// A font as text fitting measures it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Font {
    pub family: Family,
    pub weight: f64,
    pub size: f64,
    pub letter_spacing: f64,
    pub upper: bool,
}

impl Font {
    pub fn new(family: Family, weight: f64, size: f64) -> Self {
        Font { family, weight, size, letter_spacing: 0.0, upper: false }
    }
    pub fn spacing(mut self, ls: f64) -> Self {
        self.letter_spacing = ls;
        self
    }
    pub fn upper(mut self) -> Self {
        self.upper = true;
        self
    }
}

/// A code chip is drawn this much smaller than the text around it, with this much padding each side (em).
pub const CODE_SCALE: f64 = 0.9;
pub const CODE_PAD: f64 = 0.22;
pub const READABLE_PX: f64 = 15.0;

/// The weight `**bold**` draws at, over text of `weight`.
pub fn bold_weight(weight: f64) -> f64 {
    if weight >= 700.0 { 800.0 } else { 700.0 }
}

#[derive(Deserialize)]
struct MetricsJson {
    chars: String,
    sizes: Vec<f64>,
    weights: Vec<f64>,
    advances: HashMap<String, HashMap<String, Vec<Vec<f64>>>>,
    kerning: HashMap<String, HashMap<String, HashMap<String, String>>>,
}

struct Metrics {
    index: HashMap<char, usize>,
    sizes: Vec<f64>,
    weights: Vec<f64>,
    /// [family][weight index][size row][char index], in em.
    advances: [Vec<Vec<Vec<f64>>>; 2],
    /// [weight index][band]: pair -> em, for the sans.
    kerning: Vec<[HashMap<(char, char), f64>; 2]>,
}

fn metrics() -> &'static Metrics {
    static M: OnceLock<Metrics> = OnceLock::new();
    M.get_or_init(|| {
        let j: MetricsJson = serde_json::from_str(include_str!("../data/font-metrics.json")).expect("font metrics");
        let index = j.chars.chars().enumerate().map(|(i, c)| (c, i)).collect();
        let fam = |name: &str| j.weights.iter().map(|w| j.advances[name][&format!("{w}")].clone()).collect();
        let kerning = j
            .weights
            .iter()
            .map(|w| {
                let band = |b: &str| {
                    j.kerning
                        .get("sans")
                        .and_then(|k| k.get(&format!("{w}")))
                        .and_then(|k| k.get(b))
                        .map(|list| {
                            list.split('\n')
                                .filter_map(|e| {
                                    let mut cs = e.chars();
                                    let (a, b) = (cs.next()?, cs.next()?);
                                    Some(((a, b), cs.as_str().parse::<f64>().ok()? / 1000.0))
                                })
                                .collect()
                        })
                        .unwrap_or_default()
                };
                [band("text"), band("display")]
            })
            .collect();
        Metrics { index, sizes: j.sizes, weights: j.weights.clone(), advances: [fam("sans"), fam("mono")], kerning }
    })
}

fn index_of(ch: char) -> Option<usize> {
    let m = metrics();
    m.index.get(&ch).copied().or_else(|| ch.to_string().nfd().next().and_then(|b| m.index.get(&b).copied()))
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Where `value` falls in an ascending list: the index below it and how far towards the next.
fn bracket(list: &[f64], value: f64) -> (usize, f64) {
    if value <= list[0] {
        return (0, 0.0);
    }
    for k in 0..list.len() - 1 {
        if value <= list[k + 1] {
            return (k, (value - list[k]) / (list[k + 1] - list[k]));
        }
    }
    (list.len() - 1, 0.0)
}

fn is_cjk(ch: char) -> bool {
    ('\u{2E80}'..='\u{FFEF}').contains(&ch)
}

/// Advance of one character, in px, without letter spacing.
fn char_width(ch: char, family: Family, weight: f64, size: f64) -> f64 {
    let Some(i) = index_of(ch) else {
        return if is_cjk(ch) { 1.0 } else { 0.62 } * size;
    };
    let m = metrics();
    let by_weight = &m.advances[family as usize];
    let (w, tw) = bracket(&m.weights, weight);
    let at = |wk: usize| {
        let rows = &by_weight[wk.min(m.weights.len() - 1)];
        if rows.len() == 1 {
            return rows[0][i];
        }
        let (s, ts) = bracket(&m.sizes, size);
        lerp(rows[s][i], rows[(s + 1).min(rows.len() - 1)][i], ts)
    };
    lerp(at(w), at(w + 1), tw) * size
}

/// What the pair `a` then `b` takes off their advances, in px.
fn kerning(a: Option<char>, b: char, family: Family, weight: f64, size: f64) -> f64 {
    let Some(a) = a else { return 0.0 };
    if family == Family::Mono {
        return 0.0;
    }
    let m = metrics();
    let (w, tw) = bracket(&m.weights, weight);
    let ws: &[usize] = if tw == 0.0 { &[w, w] } else { &[w, (w + 1).min(m.weights.len() - 1)] };
    let bands: &[usize] = if size <= 20.0 {
        &[0]
    } else if size >= 28.0 {
        &[1]
    } else {
        &[0, 1]
    };
    let mut k = f64::NEG_INFINITY;
    for &wk in ws {
        for &band in bands {
            k = k.max(m.kerning[wk][band].get(&(a, b)).copied().unwrap_or(0.0));
        }
    }
    k * size
}

fn upper(text: &str) -> String {
    text.to_uppercase()
}

/// Width of plain text in `font`, in px.
pub fn measure(text: &str, font: &Font) -> f64 {
    let shown = if font.upper { upper(text) } else { text.to_string() };
    let mut width = 0.0;
    let mut prev = None;
    for ch in shown.chars() {
        width += char_width(ch, font.family, font.weight, font.size)
            + kerning(prev, ch, font.family, font.weight, font.size)
            + font.letter_spacing;
        prev = Some(ch);
    }
    width
}

/// The font a run draws in over a base font.
pub fn run_font(run: &Run, font: &Font) -> Font {
    if run.code {
        let weight = if run.bold { 700.0 } else { font.weight.min(600.0) };
        return Font::new(Family::Mono, weight, font.size * CODE_SCALE);
    }
    if run.bold { Font { weight: bold_weight(font.weight), ..*font } } else { *font }
}

struct Ch {
    ch: char,
    run: usize,
    w: f64,
}

fn layout_chars(runs: &[Run], font: &Font) -> Vec<Ch> {
    let mut chars = Vec::new();
    for (r, run) in runs.iter().enumerate() {
        let f = run_font(run, font);
        let shown = if font.upper && !run.code { upper(&run.text) } else { run.text.clone() };
        let list: Vec<char> = shown.chars().collect();
        for (k, &ch) in list.iter().enumerate() {
            let mut w = char_width(ch, f.family, f.weight, f.size)
                + kerning(if k > 0 { Some(list[k - 1]) } else { None }, ch, f.family, f.weight, f.size)
                + if run.code { 0.0 } else { font.letter_spacing };
            if run.code && k == 0 {
                w += CODE_PAD * font.size;
            }
            if run.code && k == list.len() - 1 {
                w += CODE_PAD * font.size;
            }
            chars.push(Ch { ch, run: r, w });
        }
    }
    chars
}

fn breaks_after(chars: &[Ch], runs: &[Run]) -> Vec<u8> {
    (0..chars.len())
        .map(|i| {
            let c = &chars[i];
            let Some(next) = chars.get(i + 1) else { return 0 };
            if next.ch.is_whitespace() {
                return 0;
            }
            if c.ch.is_whitespace() {
                return 1;
            }
            if runs[c.run].code || runs[next.run].code {
                return 0;
            }
            if "/_-:.".contains(c.ch) && next.ch.is_alphabetic() {
                return 2;
            }
            if (c.ch.is_ascii_lowercase() || c.ch.is_ascii_digit()) && next.ch.is_ascii_uppercase() { 2 } else { 0 }
        })
        .collect()
}

fn trimmed_end(chars: &[Ch], a: usize, b: usize) -> usize {
    let mut end = b;
    while end > a && chars[end].ch.is_whitespace() {
        end -= 1;
    }
    end
}

fn span(chars: &[Ch], a: usize, b: usize) -> f64 {
    let end = trimmed_end(chars, a, b);
    chars[a..=end].iter().map(|c| c.w).sum()
}

/// Greedy wrap: each line takes as many words as fit; a written "\n" always ends one.
fn greedy(chars: &[Ch], breaks: &[u8], width: f64, force: bool) -> (Vec<(usize, usize)>, bool) {
    let mut lines = Vec::new();
    let mut ok = true;
    let n = chars.len();
    let piece_end = |from: usize, level: u8| {
        let mut i = from;
        while i < n - 1 && !(breaks[i] != 0 && breaks[i] <= level) {
            i += 1;
        }
        i
    };
    let broken = |a: usize, b: usize| chars[a..=b].iter().any(|c| c.ch == '\n');
    let fits = |a: usize, b: usize| span(chars, a, b) <= width + 0.01;
    let mut start = 0;
    while start < n {
        while start < n && chars[start].ch.is_whitespace() {
            start += 1;
        }
        if start >= n {
            break;
        }
        let mut end = piece_end(start, 1);
        if fits(start, end) {
            while end < n - 1 && !broken(start, end) {
                let next = piece_end(end + 1, 1);
                if !fits(start, next) {
                    break;
                }
                end = next;
            }
        } else {
            let word = end;
            end = piece_end(start, 2);
            if end < word && fits(start, end) {
                while end < word {
                    let next = piece_end(end + 1, 2);
                    if !fits(start, next) {
                        break;
                    }
                    end = next;
                }
            } else if !fits(start, end) {
                ok = false;
                if force {
                    let mut w = 0.0;
                    let mut i = start;
                    while i <= end && w + chars[i].w <= width + 0.01 {
                        w += chars[i].w;
                        i += 1;
                    }
                    end = start.max(i.saturating_sub(1));
                }
            }
        }
        lines.push((start, end));
        start = end + 1;
    }
    (lines, ok)
}

fn line_runs(chars: &[Ch], runs: &[Run], (a, b): (usize, usize)) -> Vec<Run> {
    let end = trimmed_end(chars, a, b);
    let mut out: Vec<(usize, Run)> = Vec::new();
    for c in &chars[a..=end] {
        match out.last_mut() {
            Some((src, run)) if *src == c.run => run.text.push(c.ch),
            _ => out.push((c.run, Run { text: c.ch.to_string(), ..runs[c.run].clone() })),
        }
    }
    out.into_iter().map(|(_, r)| r).collect()
}

/// Runs wrapped into lines.
#[derive(Clone, Debug)]
pub struct Wrapped {
    pub lines: Vec<Vec<Run>>,
    pub widths: Vec<f64>,
    pub ok: bool,
}

/// Wraps runs into lines no wider than `width`; `balanced` evens out the lengths of the lines it takes.
pub fn wrap_runs(runs: &[Run], font: &Font, width: f64, balanced: bool, force: bool) -> Wrapped {
    let chars = layout_chars(runs, font);
    if chars.is_empty() {
        return Wrapped { lines: vec![vec![]], widths: vec![0.0], ok: true };
    }
    let breaks = breaks_after(&chars, runs);
    let (mut lines, ok) = greedy(&chars, &breaks, width, force);
    if balanced && lines.len() > 1 && ok {
        let (mut lo, mut hi) = (0.0, width);
        for _ in 0..18 {
            let mid = (lo + hi) / 2.0;
            let (trial, tok) = greedy(&chars, &breaks, mid, false);
            if tok && trial.len() <= lines.len() {
                hi = mid;
            } else {
                lo = mid;
            }
        }
        lines = greedy(&chars, &breaks, hi, false).0;
    }
    Wrapped {
        widths: lines.iter().map(|&(a, b)| span(&chars, a, b)).collect(),
        lines: lines.iter().map(|&l| line_runs(&chars, runs, l)).collect(),
        ok,
    }
}

/// A place a scene draws text (src/fit/slots.ts): its font, width, lines and the smallest size it reads at.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub name: String,
    pub family: Family,
    pub weight: f64,
    pub size: f64,
    pub min: f64,
    pub lines: usize,
    pub line_height: f64,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub letter_spacing: Option<f64>,
    #[serde(default)]
    pub upper: Option<bool>,
    #[serde(default)]
    pub balanced: Option<bool>,
    #[serde(default)]
    pub markup: Option<bool>,
    #[serde(default)]
    pub one_line_min: Option<f64>,
}

impl Slot {
    /// A slot from src/fit/slots.ts by name, with its width set (`sized`).
    pub fn named(name: &str, width: f64) -> Slot {
        static SLOTS: OnceLock<HashMap<String, Slot>> = OnceLock::new();
        let slots = SLOTS.get_or_init(|| serde_json::from_str(include_str!("../data/slots.json")).expect("slots"));
        let mut s = slots.get(name).unwrap_or_else(|| panic!("no slot {name}")).clone();
        s.width = width;
        s
    }
    fn font(&self, size: f64) -> Font {
        Font {
            family: self.family,
            weight: self.weight,
            size,
            letter_spacing: self.letter_spacing.unwrap_or(0.0),
            upper: self.upper.unwrap_or(false),
        }
    }
}

/// A text fitted into its slot: the lines a scene draws, exactly as `validate` wrapped them.
#[derive(Clone, Debug)]
pub struct Fit {
    pub text: String,
    pub size: f64,
    pub font: Font,
    pub lines: Vec<Vec<Run>>,
    pub widths: Vec<f64>,
    pub width: f64,
    pub height: f64,
    pub line_height: f64,
    pub fits: bool,
}

fn done(text: &str, slot: &Slot, w: Wrapped, size: f64, fits: bool) -> Fit {
    Fit {
        text: text.to_string(),
        size,
        font: slot.font(size),
        width: w.widths.iter().copied().fold(0.0, f64::max),
        height: w.lines.len() as f64 * size * slot.line_height,
        lines: w.lines,
        widths: w.widths,
        line_height: slot.line_height,
        fits,
    }
}

fn attempt(runs: &[Run], slot: &Slot, size: f64, max_lines: usize) -> Option<Wrapped> {
    // The JS tries 1..=max_lines lines at a width that may depend on the count; every slot here has one width.
    let w = wrap_runs(runs, &slot.font(size), slot.width, slot.balanced.unwrap_or(false), false);
    (w.ok && w.lines.len() <= max_lines).then_some(w)
}

/// Fits `text` into `slot`, at the largest size whose wrap takes at most `slot.lines` lines (`fitText`).
pub fn fit_text(text: &str, slot: &Slot) -> Fit {
    let runs = if slot.markup == Some(false) { vec![Run::plain(text)] } else { parse_markup(text) };
    if let Some(one) = slot.one_line_min {
        let mut size = slot.size;
        while size >= one {
            if let Some(w) = attempt(&runs, slot, size, 1) {
                return done(text, slot, w, size, true);
            }
            size -= 1.0;
        }
    }
    let mut size = slot.size;
    while size >= slot.min {
        if let Some(w) = attempt(&runs, slot, size, slot.lines) {
            return done(text, slot, w, size, true);
        }
        size -= 1.0;
    }
    let w = wrap_runs(&runs, &slot.font(slot.min), slot.width, false, true);
    done(text, slot, w, slot.min, false)
}

/// The same text and slot at a size of the caller's choosing (`fitTextAt`).
pub fn fit_text_at(text: &str, slot: &Slot, size: f64) -> Fit {
    fit_text(text, &Slot { size, min: size, one_line_min: None, ..slot.clone() })
}

/// Lines that must not wrap, such as code, at the largest size where all fit `slot.width` and `height` (`fitLines`).
pub fn fit_lines(lines: &[String], slot: &Slot, height: f64) -> Fit {
    let widths_at = |size: f64| lines.iter().map(|l| measure(l, &slot.font(size))).collect::<Vec<_>>();
    let max = |w: &[f64]| w.iter().copied().fold(0.0, f64::max);
    let too_big = |size: f64| {
        max(&widths_at(size)) > slot.width + 0.01 || lines.len() as f64 * size * slot.line_height > height + 0.01
    };
    let mut size = slot.size;
    while size > slot.min && too_big(size) {
        size -= 1.0;
    }
    let widths = widths_at(size);
    let widest = widths.iter().position(|&w| w == max(&widths)).unwrap_or(0);
    Fit {
        text: lines.get(widest).cloned().unwrap_or_default(),
        size,
        font: slot.font(size),
        lines: lines.iter().map(|t| vec![Run::plain(t.clone())]).collect(),
        width: max(&widths),
        fits: !too_big(size),
        widths,
        height: lines.len() as f64 * size * slot.line_height,
        line_height: slot.line_height,
    }
}

/// `fitText` for a slot whose width depends on the line count and size, as the JS lets `slot.width` be a function
/// `(lines, size) => width`: a decision's diamond is narrower the more lines its question takes.
pub fn fit_text_fn(text: &str, slot: &Slot, width: &dyn Fn(usize, f64) -> f64) -> Fit {
    let runs = if slot.markup == Some(false) { vec![Run::plain(text)] } else { parse_markup(text) };
    let attempt = |size: f64, max_lines: usize| -> Option<Wrapped> {
        (1..=max_lines).find_map(|n| {
            let w = wrap_runs(&runs, &slot.font(size), width(n, size), slot.balanced.unwrap_or(false), false);
            (w.ok && w.lines.len() <= n).then_some(w)
        })
    };
    if let Some(one) = slot.one_line_min {
        let mut size = slot.size;
        while size >= one {
            if let Some(w) = attempt(size, 1) {
                return done(text, slot, w, size, true);
            }
            size -= 1.0;
        }
    }
    let mut size = slot.size;
    while size >= slot.min {
        if let Some(w) = attempt(size, slot.lines) {
            return done(text, slot, w, size, true);
        }
        size -= 1.0;
    }
    let w = wrap_runs(&runs, &slot.font(slot.min), width(slot.lines, slot.min), false, true);
    done(text, slot, w, slot.min, false)
}
