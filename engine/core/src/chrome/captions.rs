//! Burned-in captions: the current page of the spoken text, the current word lit (src/components/Captions.tsx,
//! src/utils/captions.ts).

use crate::anim::{CLAMP, interpolate};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint};
use crate::text::{Style, baseline_in, shape, width};
use crate::theme::{ACCENT_GLOW, CAPTION_BAND, TEXT};
use crate::timing::{Segment, spoken_at};

const MAX_CHARS: usize = 72;
const SIZE: f32 = 36.0;
/// On the board: the captions' size, and how far their last line sits above the bottom.
const BOARD_SIZE: f32 = 26.0;
const BOARD_BOTTOM: f32 = 34.0;

/// Greedy word wrap by character budget; each line holds the indices of its words.
fn wrap_words(words: &[&str], max: usize) -> Vec<Vec<usize>> {
    let mut lines = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let mut length = 0;
    for (i, w) in words.iter().enumerate() {
        let n = w.chars().count();
        if !current.is_empty() && length + 1 + n > max {
            lines.push(std::mem::take(&mut current));
            length = 0;
        }
        length += if current.is_empty() { 0 } else { 1 } + n;
        current.push(i);
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

pub fn draw(dl: &mut DisplayList, segments: &[Segment], frame: f64, duration: f64) {
    let (index, word) = spoken_at(segments, frame);
    let text = &segments[index].text;
    let words: Vec<&str> = text.split_whitespace().collect();
    let lines = wrap_words(&words, MAX_CHARS);
    let current = word.min(words.len().saturating_sub(1));
    let line_index = lines.iter().position(|l| l.contains(&current)).unwrap_or(0);
    let start = line_index / 2 * 2;
    let page = &lines[start.min(lines.len())..(start + 2).min(lines.len())];
    let opacity = interpolate(frame, &[0.0, 8.0, duration - 6.0, duration], &[0.0, 1.0, 1.0, 0.0], CLAMP) as f32;
    // On the board the captions step back for the drawing (ADR 49): smaller, dim, with no band or glow.
    let board = crate::look::board();
    let size = if board { BOARD_SIZE } else { SIZE };
    let line_h = size * 1.4;
    dl.save();
    dl.fade(opacity);
    let top = 1080.0 - CAPTION_BAND;
    if !board {
        let band = Color::rgba8(5, 6, 10, 0.92);
        dl.rect(
            0.0,
            top,
            1920.0,
            CAPTION_BAND,
            BoxStyle::fill(Paint::Linear {
                start: (0.0, 1080.0),
                end: (0.0, top),
                stops: vec![(0.3, band), (1.0, band.alpha(0.0))],
            }),
        );
    }
    let style = Style::sans(500.0, size);
    let space = width(" ", style);
    let block = line_h * page.len() as f32;
    let mut y = if board { 1080.0 - BOARD_BOTTOM - block } else { top + (CAPTION_BAND - block) / 2.0 };
    for line in page {
        let base = y + baseline_in(style.face, size, line_h);
        let total: f32 =
            line.iter().map(|&wi| width(words[wi], style)).sum::<f32>() + space * (line.len() as f32 - 1.0);
        let mut x = (1920.0 - total) / 2.0;
        for &wi in line {
            let run = shape(words[wi], style);
            let w = run.width;
            if board {
                let a = if wi == word {
                    0.7
                } else if wi < word {
                    0.5
                } else {
                    0.22
                };
                dl.run(run, x, base, TEXT.alpha(a));
            } else if wi == word {
                dl.run_glow(run, x, base, TEXT, (18.0, ACCENT_GLOW));
            } else {
                let a = if wi < word { 0.92 } else { 0.38 };
                dl.run(run, x, base, TEXT.alpha(a));
            }
            x += w + space;
        }
        y += line_h;
    }
    dl.restore();
}
