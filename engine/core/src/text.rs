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

static INTER: &[u8] = include_bytes!("../../assets/fonts/inter-latin.ttf");
static MONO: &[u8] = include_bytes!("../../assets/fonts/jetbrains-mono-latin.ttf");
static HAND: &[u8] = include_bytes!("../../assets/fonts/caveat-latin-600.ttf");

pub fn font_ref(face: Face) -> FontRef<'static> {
    static FONTS: OnceLock<[FontRef<'static>; 3]> = OnceLock::new();
    FONTS.get_or_init(|| {
        let f = |d: &'static [u8]| FontRef::from_index(d, 0).expect("bundled font");
        [f(INTER), f(MONO), f(HAND)]
    })[face as usize]
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
        let font = font_ref(self.face);
        match self.face {
            Face::Sans => font
                .variations()
                .normalized_coords([("wght", self.weight), ("opsz", self.size.clamp(14.0, 32.0))])
                .collect(),
            Face::Mono => font.variations().normalized_coords([("wght", self.weight)]).collect(),
            Face::Hand => Vec::new(),
        }
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

fn shape_uncached(text: &str, style: Style) -> ShapedRun {
    let coords = style.coords();
    let font = font_ref(style.face);
    let mut glyphs = Vec::new();
    let mut x = 0.0f32;
    SHAPER.with(|ctx| {
        let mut ctx = ctx.borrow_mut();
        let mut builder = ctx.builder(font).size(style.size).normalized_coords(coords.iter().copied());
        // Chrome turns off optional ligatures when letters are spaced out.
        if style.letter_spacing != 0.0 {
            builder = builder.features([("liga", 0), ("clig", 0), ("calt", 0)]);
        }
        let mut shaper = builder.build();
        shaper.add_str(text);
        shaper.shape_with(|cluster| {
            for g in cluster.glyphs {
                glyphs.push(Glyph { id: g.id, x: x + g.x, y: -g.y });
                x += g.advance;
            }
            if !cluster.is_empty() || cluster.glyphs.is_empty() {
                x += style.letter_spacing * cluster.components.len().max(1) as f32;
            }
        });
    });
    ShapedRun { style, coords, glyphs, width: x, key: hash_of(text, &style) }
}

/// Advance of `text` in `style`, in px, as drawn.
pub fn width(text: &str, style: Style) -> f32 {
    shape(text, style).width
}
