//! The storyboard's `look` (ADR 48): the default, or `board`, a hand-drawn look on a dark board with two colours.
//! The board recolours what the scenes draw rather than each scene choosing colours: the palette's own colours are
//! swapped in a frame's display list and in svg markup, so every scene type takes the look.

use crate::color::Color;
use crate::display::{DisplayList, Item, Paint};
use crate::text::{Face, ShapedRun, Style, shape};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

static BOARD: AtomicBool = AtomicBool::new(false);

/// Sets the look for what is drawn from now on; a project sets it from its storyboard.
pub fn set_board(on: bool) {
    BOARD.store(on, Ordering::Relaxed);
}

/// Whether the board look is on.
pub fn board() -> bool {
    BOARD.load(Ordering::Relaxed)
}

/// The board itself.
pub const BOARD_BG: Color = Color::rgba8(0x16, 0x17, 0x14, 1.0);
pub const GREEN: Color = Color::rgba8(0x52, 0xd2, 0x8a, 1.0);
pub const ORANGE: Color = Color::rgba8(0xf0, 0x7b, 0x4c, 1.0);
const AMBER: Color = Color::rgba8(0xf2, 0xb6, 0x5a, 1.0);
pub const CHALK: Color = Color::rgba8(0xec, 0xe9, 0xe0, 1.0);
const CHALK_MUTED: Color = Color::rgba8(0xa6, 0xa3, 0x97, 1.0);
const CHALK_FAINT: Color = Color::rgba8(0x6e, 0x6d, 0x66, 1.0);
const PANEL: Color = Color::rgba8(0x20, 0x21, 0x1d, 1.0);

/// Each palette colour (src/components/theme.ts, tones.ts) and its colour on the board, by RGB.
const SWAPS: &[([u8; 3], Color)] = &[
    ([0x7c, 0x8c, 0xff], GREEN),
    ([0x3d, 0xdc, 0x97], GREEN),
    ([0xff, 0x6b, 0x7a], ORANGE),
    ([0xfb, 0xbf, 0x24], AMBER),
    // The pen's own yellow: labels are written in green, as what is normal is.
    ([0xff, 0xe0, 0x66], GREEN),
    ([0xf2, 0xf4, 0xf8], CHALK),
    ([0x90, 0x97, 0xa8], CHALK_MUTED),
    ([0x8f, 0x98, 0xad], CHALK_MUTED),
    ([0x5b, 0x61, 0x72], CHALK_FAINT),
    ([0x07, 0x08, 0x0c], BOARD_BG),
    ([22, 25, 34], PANEL),
    ([0x1a, 0x1d, 0x28], PANEL),
];

fn rgb8(c: Color) -> [u8; 3] {
    [(c.r * 255.0).round() as u8, (c.g * 255.0).round() as u8, (c.b * 255.0).round() as u8]
}

/// A palette colour as the board draws it, keeping its alpha; any other colour as it is.
pub fn swap(c: Color) -> Color {
    let key = rgb8(c);
    SWAPS.iter().find(|(k, _)| *k == key).map_or(c, |(_, to)| to.alpha(c.a))
}

fn swap_paint(p: &mut Paint) {
    match p {
        Paint::Solid(c) => *c = swap(*c),
        Paint::Linear { stops, .. } | Paint::Radial { stops, .. } => {
            for (_, c) in stops {
                *c = swap(*c);
            }
        }
    }
}

/// Recolours a frame's display list for the board.
pub fn swap_list(dl: &mut DisplayList) {
    for cmd in &mut dl.cmds {
        match &mut cmd.item {
            Item::Box { style, .. } => {
                if let Some(f) = &mut style.fill {
                    swap_paint(f);
                }
                if let Some(b) = &mut style.border {
                    b.color = swap(b.color);
                }
                for s in &mut style.shadows {
                    s.color = swap(s.color);
                }
            }
            Item::Path { fill, stroke, .. } => {
                if let Some(f) = fill {
                    swap_paint(f);
                }
                if let Some(s) = stroke {
                    s.color = swap(s.color);
                }
            }
            Item::Text { run, color, glow, .. } => {
                *run = by_hand(run);
                *color = swap(*color);
                if let Some((_, g)) = glow {
                    *g = swap(*g);
                }
            }
            Item::TextPaint { run, paint, .. } => {
                *run = by_hand(run);
                swap_paint(paint);
            }
            _ => {}
        }
    }
}

/// The handwriting face is smaller for its size than the sans.
const HAND_SCALE: f32 = 1.22;

/// Sans text written by hand: the same words in the handwriting face, a little larger. Code stays in its mono face.
fn by_hand(run: &Arc<ShapedRun>) -> Arc<ShapedRun> {
    if run.style.face != Face::Sans || run.text.is_empty() {
        return run.clone();
    }
    let weight = if run.style.weight >= 600.0 { 700.0 } else { 600.0 };
    shape(&run.text, Style::new(Face::Hand, weight, run.style.size * HAND_SCALE))
}

fn hex(c: Color) -> String {
    let [r, g, b] = rgb8(c);
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Svg markup with the palette's hex colours swapped for the board's.
pub fn swap_markup(svg: &str) -> String {
    let mut out = svg.to_string();
    for (k, to) in SWAPS {
        let from = format!("#{:02x}{:02x}{:02x}", k[0], k[1], k[2]);
        if out.contains(&from) {
            out = out.replace(&from, &hex(*to));
        }
    }
    out
}
