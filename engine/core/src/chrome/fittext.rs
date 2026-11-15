//! Draws a [`Fit`] line by line, exactly as text fitting wrapped it (src/components/FitText.tsx).

use crate::color::Color;
use crate::display::{BoxStyle, DisplayList};
use crate::markup::Run;
use crate::text::{Face, Style, baseline_in, line_metrics, shape};
use crate::textfit::{CODE_PAD, CODE_SCALE, Fit, bold_weight};
use crate::theme;

const MARK_BG: Color = Color::rgba8(255, 214, 92, 0.3);

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Align {
    Left,
    Center,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LineHeight {
    /// The fit's own line height, a multiple of its size.
    Fit,
    /// CSS `line-height: normal`: the font's ascent and descent.
    Normal,
    /// A multiple of the size.
    Times(f32),
}

/// How to draw a fit: colour, a lighter weight than measured, alignment in a box `width` wide, line height.
#[derive(Clone, Copy, Debug)]
pub struct TextOpts {
    pub color: Color,
    pub weight: Option<f64>,
    pub align: Align,
    pub width: f32,
    pub line_height: LineHeight,
}

impl TextOpts {
    pub fn new(color: Color) -> Self {
        TextOpts { color, weight: None, align: Align::Left, width: 0.0, line_height: LineHeight::Fit }
    }
    pub fn normal(mut self) -> Self {
        self.line_height = LineHeight::Normal;
        self
    }
    pub fn weight(mut self, w: f64) -> Self {
        self.weight = Some(w);
        self
    }
    pub fn line_height(mut self, lh: LineHeight) -> Self {
        self.line_height = lh;
        self
    }
    pub fn centered(mut self, width: f32) -> Self {
        self.align = Align::Center;
        self.width = width;
        self
    }
}

/// Height of one line box of a fit drawn with `lh`.
pub fn line_box(fit: &Fit, lh: LineHeight) -> f32 {
    let size = fit.size as f32;
    match lh {
        LineHeight::Fit => size * fit.line_height as f32,
        LineHeight::Times(k) => size * k,
        LineHeight::Normal => line_metrics(fit.font.family.into(), size).normal,
    }
}

/// Height of the whole fit drawn with `lh`.
pub fn fit_height(fit: &Fit, lh: LineHeight) -> f32 {
    line_box(fit, lh) * fit.lines.len().max(1) as f32
}

struct Piece<'a> {
    run: &'a Run,
    style: Style,
    text: String,
}

fn pieces<'a>(fit: &Fit, line: &'a [Run], weight: f64) -> Vec<Piece<'a>> {
    let f = &fit.font;
    line.iter()
        .map(|run| {
            if run.code {
                let w = if run.bold { 700.0 } else { weight.min(600.0) };
                return Piece {
                    run,
                    style: Style::new(Face::Mono, w as f32, (f.size * CODE_SCALE) as f32),
                    text: run.text.clone(),
                };
            }
            let w = if run.bold { bold_weight(weight) } else { weight };
            let text = if f.upper { run.text.to_uppercase() } else { run.text.clone() };
            Piece {
                run,
                style: Style::new(f.family.into(), w as f32, f.size as f32).spacing(f.letter_spacing as f32),
                text,
            }
        })
        .collect()
}

fn piece_width(p: &Piece, size: f32) -> f32 {
    let pad = if p.run.code { 2.0 * CODE_PAD as f32 * size } else { 0.0 };
    shape(&p.text, p.style).width + pad
}

/// Width of a fitted line as drawn.
pub fn drawn_width(fit: &Fit, line: &[Run], weight: Option<f64>) -> f32 {
    let w = weight.unwrap_or(fit.font.weight).min(fit.font.weight);
    pieces(fit, line, w).iter().map(|p| piece_width(p, fit.size as f32)).sum()
}

/// Draws `fit` with its first line box's top left at (x, y); returns the height drawn.
pub fn draw_fit(dl: &mut DisplayList, fit: &Fit, x: f32, y: f32, o: TextOpts) -> f32 {
    let weight = o.weight.unwrap_or(fit.font.weight).min(fit.font.weight);
    let size = fit.size as f32;
    let lh = line_box(fit, o.line_height);
    let face: Face = fit.font.family.into();
    for (i, line) in fit.lines.iter().enumerate() {
        let top = y + i as f32 * lh;
        let base = top + baseline_in(face, size, lh);
        let ps = pieces(fit, line, weight);
        let total: f32 = ps.iter().map(|p| piece_width(p, size)).sum();
        let mut pen = match o.align {
            Align::Left => x,
            Align::Center => x + (o.width - total) / 2.0,
            Align::Right => x + o.width - total,
        };
        for p in &ps {
            let run = shape(&p.text, p.style);
            let color = p.run.tone.as_deref().map_or(o.color, |t| theme::tone(t).0);
            if p.run.code {
                let pad = CODE_PAD as f32 * size;
                let m = line_metrics(Face::Mono, p.style.size);
                dl.rect(
                    pen,
                    base - m.ascent,
                    run.width + 2.0 * pad,
                    m.ascent + m.descent,
                    BoxStyle::fill(Color::rgba8(255, 255, 255, 0.1)).radius(0.3 * p.style.size),
                );
                dl.run(run.clone(), pen + pad, base, color);
                pen += run.width + 2.0 * pad;
                continue;
            }
            if p.run.mark {
                let m = line_metrics(face, size);
                dl.rect(
                    pen,
                    base - m.ascent,
                    run.width,
                    m.ascent + m.descent,
                    BoxStyle::fill(MARK_BG).radius(0.18 * size),
                );
            }
            dl.run(run.clone(), pen, base, color);
            pen += run.width;
        }
    }
    lh * fit.lines.len() as f32
}
