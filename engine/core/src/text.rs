//! The bundled fonts, shaping and line metrics. Text is shaped with swash, which applies the fonts' own
//! kerning and default features as Chrome does, at the weight and optical size Chrome picks: Inter is a
//! variable font with `wght` 400 to 800 and `opsz` 14 to 32, and `font-optical-sizing: auto` sets the
//! optical size to the font size in px.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use swash::shape::ShapeContext;
use swash::{FontRef, NormalizedCoord};

pub use crate::textfit::Family;

/// A face the engine draws text in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Face {
    /// Inter, the `fonts.sans` stack.
    Sans,
    /// JetBrains Mono, the `fonts.mono` stack.
    Mono,
    /// Caveat 600, the handwriting.
    Hand,
}

impl From<Family> for Face {
    fn from(f: Family) -> Self {
        match f {
            Family::Sans => Face::Sans,
            Family::Mono => Face::Mono,
        }
    }
}

/// Every bundled font, by its index in a glyph's `font`: the three faces' Latin files first (index = `Face`), then
/// the fallbacks a glyph they lack is drawn from, as Chrome falls back per character.
pub(crate) static FONT_DATA: [&[u8]; 8] = [
    include_bytes!("../../assets/fonts/inter-latin.ttf"),
    include_bytes!("../../assets/fonts/jetbrains-mono-latin.ttf"),
    include_bytes!("../../assets/fonts/caveat-latin-600.ttf"),
    // Inter and JetBrains Mono beyond Latin: Greek, Cyrillic, arrows, math operators, shapes, and (Inter) super- and
    // subscript letters (ᵏ ₙ).
    include_bytes!("../../assets/fonts/inter-extra.ttf"),
    include_bytes!("../../assets/fonts/jetbrains-mono-extra.ttf"),
    // Noto Sans Math and Noto Sans Symbols 2, subset to their symbol blocks, for what neither has (∀ ∃).
    include_bytes!("../../assets/fonts/noto-sans-math.ttf"),
    include_bytes!("../../assets/fonts/noto-sans-symbols-2.ttf"),
    // Noto Sans Symbols, which varies its weight, for the technical symbols (⌊ ⌋ ⌈ ⌉).
    include_bytes!("../../assets/fonts/noto-sans-symbols.ttf"),
];
const INTER_EXTRA: u8 = 3;
const MONO_EXTRA: u8 = 4;
const NOTO_MATH: u8 = 5;
const NOTO_SYMBOLS: u8 = 6;
const NOTO_TECHNICAL: u8 = 7;

/// The bundled font at `index` (see `FONT_DATA`).
pub fn font_at(index: u8) -> FontRef<'static> {
    static FONTS: OnceLock<Vec<FontRef<'static>>> = OnceLock::new();
    FONTS.get_or_init(|| FONT_DATA.iter().map(|d| FontRef::from_index(d, 0).expect("bundled font")).collect())
        [index as usize]
}

pub fn font_ref(face: Face) -> FontRef<'static> {
    font_at(face as u8)
}

/// The fonts a face's text is drawn from, in the order a character looks for its glyph.
pub(crate) fn chain(face: Face) -> &'static [u8] {
    match face {
        Face::Sans => &[Face::Sans as u8, INTER_EXTRA, NOTO_TECHNICAL, NOTO_MATH, NOTO_SYMBOLS],
        Face::Mono => &[Face::Mono as u8, MONO_EXTRA, INTER_EXTRA, NOTO_TECHNICAL, NOTO_MATH, NOTO_SYMBOLS],
        // The handwriting names no fallback, so Chrome draws what Caveat lacks in a plain regular face.
        Face::Hand => &[Face::Hand as u8, NOTO_MATH, NOTO_TECHNICAL, INTER_EXTRA, NOTO_SYMBOLS],
    }
}

/// The first font of `face`'s chain with a glyph for `c`, or the face's own when none has one.
fn font_for(face: Face, c: char) -> u8 {
    let fonts = chain(face);
    fonts.iter().copied().find(|&f| font_at(f).charmap().map(c) != 0).unwrap_or(fonts[0])
}

/// A text style: face, weight, size in px and CSS `letter-spacing` in px.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Style {
    pub face: Face,
    pub weight: f32,
    pub size: f32,
    pub letter_spacing: f32,
}

impl Style {
    pub fn new(face: Face, weight: f32, size: f32) -> Style {
        Style { face, weight, size, letter_spacing: 0.0 }
    }
    pub fn sans(weight: f32, size: f32) -> Style {
        Style::new(Face::Sans, weight, size)
    }
    pub fn mono(weight: f32, size: f32) -> Style {
        Style::new(Face::Mono, weight, size)
    }
    pub fn spacing(mut self, ls: f32) -> Style {
        self.letter_spacing = ls;
        self
    }
    fn key(&self) -> [u32; 4] {
        [self.face as u32, self.weight.to_bits(), self.size.to_bits(), self.letter_spacing.to_bits()]
    }
    /// The variation coordinates Chrome draws this style at.
    pub fn coords(&self) -> Vec<NormalizedCoord> {
        self.coords_in(self.face as u8)
    }

    /// The variation coordinates of this style in bundled font `index`: its weight and optical size where the font
    /// varies them.
    pub fn coords_in(&self, index: u8) -> Vec<NormalizedCoord> {
        let font = font_at(index);
        if font.variations().len() == 0 {
            return Vec::new();
        }
        font.variations().normalized_coords([("wght", self.weight), ("opsz", self.size.clamp(14.0, 32.0))]).collect()
    }
}

/// Vertical metrics of a face at a size, rounded as Blink rounds them.
#[derive(Clone, Copy, Debug)]
pub struct LineMetrics {
    pub ascent: f32,
    pub descent: f32,
    /// `line-height: normal`.
    pub normal: f32,
}

pub fn line_metrics(face: Face, size: f32) -> LineMetrics {
    let m = font_ref(face).metrics(&[]);
    let k = size / m.units_per_em as f32;
    let (ascent, descent) = ((m.ascent * k).round(), (m.descent * k).round());
    LineMetrics { ascent, descent, normal: ascent + descent + (m.leading * k).round() }
}

/// Where a line's baseline sits below the top of a line box `height` tall, as CSS centres the glyphs' ascent
/// and descent in it.
pub fn baseline_in(face: Face, size: f32, height: f32) -> f32 {
    let m = line_metrics(face, size);
    ((height - (m.ascent + m.descent)) / 2.0).floor() + m.ascent
}

#[derive(Clone, Copy, Debug)]
pub struct Glyph {
    pub id: u16,
    /// The bundled font it is drawn from (see `font_at`).
    pub font: u8,
    /// Pen position from the run's origin, in px.
    pub x: f32,
    pub y: f32,
}

/// A shaped run of text in one style.
#[derive(Debug)]
pub struct ShapedRun {
    pub style: Style,
    pub coords: Vec<NormalizedCoord>,
    pub glyphs: Vec<Glyph>,
    /// Advance of the whole run, letter spacing included.
    pub width: f32,
    /// A key unique to this text and style, for caches of what is drawn from it.
    pub key: u64,
    /// The text, so a look can draw it again in another face.
    pub text: Arc<str>,
}

fn hash_of(text: &str, style: &Style) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    style.key().hash(&mut h);
    h.finish()
}

/// Shaped runs by text and style.
type RunCache = HashMap<(String, [u32; 4]), Arc<ShapedRun>>;

thread_local! {
    static SHAPER: RefCell<ShapeContext> = RefCell::new(ShapeContext::new());
    static RUNS: RefCell<RunCache> = RefCell::new(HashMap::new());
}

/// Shapes `text` in `style`; runs are cached per thread, so a scene can shape what it draws every frame.
pub fn shape(text: &str, style: Style) -> Arc<ShapedRun> {
    let key = (text.to_string(), style.key());
    if let Some(run) = RUNS.with(|r| r.borrow().get(&key).cloned()) {
        return run;
    }
    let run = Arc::new(shape_uncached(text, style));
    RUNS.with(|r| {
        let mut r = r.borrow_mut();
        if r.len() > 50_000 {
            r.clear();
        }
        r.insert(key, run.clone());
    });
    run
}

/// A superscript or subscript character (² ⁵ ₂ ᵏ).
fn is_script(c: char) -> bool {
    matches!(c, '\u{b2}' | '\u{b3}' | '\u{b9}' | '\u{2b0}'..='\u{2b8}' | '\u{2e0}'..='\u{2e4}' | '\u{1d2c}'..='\u{1d6a}'
        | '\u{1d9b}'..='\u{1dbf}' | '\u{2070}'..='\u{209f}')
}

/// `text` in runs `(font, from, to)` of characters by the bundled font that draws them, as Chrome falls back per
/// character: a space stays in the run before it when that font has one, a combining mark always does. A run of
/// superscripts or subscripts the face has only some of (Caveat has ² but not ⁵) is drawn whole from the first fallback
/// that has them all, so its figures match and do not run into each other.
pub(crate) fn font_runs(face: Face, text: &str) -> Vec<(u8, usize, usize)> {
    let mut fonts: Vec<(usize, char, u8)> = Vec::new();
    for (i, c) in text.char_indices() {
        let mark = ('\u{300}'..='\u{36f}').contains(&c) || c == '\u{200d}' || c == '\u{fe0f}';
        let font = match fonts.last() {
            Some(&(_, _, f)) if mark || (c.is_whitespace() && font_at(f).charmap().map(c) != 0) => f,
            _ => font_for(face, c),
        };
        fonts.push((i, c, font));
    }
    let mut i = 0;
    while i < fonts.len() {
        let end = (i..fonts.len()).find(|&j| !is_script(fonts[j].1)).unwrap_or(fonts.len());
        let script = &mut fonts[i..end];
        if script.iter().any(|s| s.2 != script[0].2)
            && let Some(&f) = chain(face).iter().find(|&&f| script.iter().all(|s| font_at(f).charmap().map(s.1) != 0))
        {
            script.iter_mut().for_each(|s| s.2 = f);
        }
        i = end.max(i + 1);
    }
    let mut runs: Vec<(u8, usize, usize)> = Vec::new();
    for (i, c, font) in fonts {
        match runs.last_mut() {
            Some(r) if r.0 == font => r.2 = i + c.len_utf8(),
            _ => runs.push((font, i, i + c.len_utf8())),
        }
    }
    runs
}

fn shape_uncached(text: &str, style: Style) -> ShapedRun {
    let coords = style.coords();
    let mut glyphs = Vec::new();
    let mut x = 0.0f32;
    let runs = font_runs(style.face, text);
    SHAPER.with(|ctx| {
        let mut ctx = ctx.borrow_mut();
        for (font, from, to) in runs {
            let own = if font == style.face as u8 { coords.clone() } else { style.coords_in(font) };
            let mut builder = ctx.builder(font_at(font)).size(style.size).normalized_coords(own.iter().copied());
            // Chrome turns off optional ligatures when letters are spaced out.
            if style.letter_spacing != 0.0 {
                builder = builder.features([("liga", 0), ("clig", 0), ("calt", 0)]);
            }
            let mut shaper = builder.build();
            shaper.add_str(&text[from..to]);
            shaper.shape_with(|cluster| {
                for g in cluster.glyphs {
                    glyphs.push(Glyph { id: g.id, font, x: x + g.x, y: -g.y });
                    x += g.advance;
                }
                if !cluster.is_empty() || cluster.glyphs.is_empty() {
                    x += style.letter_spacing * cluster.components.len().max(1) as f32;
                }
            });
        }
    });
    ShapedRun { style, coords, glyphs, width: x, key: hash_of(text, &style), text: Arc::from(text) }
}

/// Advance of `text` in `style`, in px, as drawn.
pub fn width(text: &str, style: Style) -> f32 {
    shape(text, style).width
}
