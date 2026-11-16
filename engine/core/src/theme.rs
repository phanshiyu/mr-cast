//! The palette and frame geometry of src/components/theme.ts and tones.ts.

use crate::color::Color;

pub const WIDTH: f32 = 1920.0;
pub const HEIGHT: f32 = 1080.0;

pub const BG: Color = Color::rgba8(0x07, 0x08, 0x0c, 1.0);
pub const SURFACE: Color = Color::rgba8(22, 25, 34, 0.86);
pub const RAISED: Color = Color::rgba8(0x1a, 0x1d, 0x28, 1.0);
pub const BORDER: Color = Color::rgba8(255, 255, 255, 0.08);
pub const BORDER_STRONG: Color = Color::rgba8(255, 255, 255, 0.16);
pub const TEXT: Color = Color::rgba8(0xf2, 0xf4, 0xf8, 1.0);
pub const MUTED: Color = Color::rgba8(0x90, 0x97, 0xa8, 1.0);
pub const FAINT: Color = Color::rgba8(0x5b, 0x61, 0x72, 1.0);
pub const ACCENT: Color = Color::rgba8(0x7c, 0x8c, 0xff, 1.0);
pub const ACCENT_SOFT: Color = Color::rgba8(124, 140, 255, 0.14);
pub const ACCENT_GLOW: Color = Color::rgba8(124, 140, 255, 0.45);
pub const ADD: Color = Color::rgba8(0x3d, 0xdc, 0x97, 1.0);
pub const ADD_BG: Color = Color::rgba8(61, 220, 151, 0.12);
pub const DEL: Color = Color::rgba8(0xff, 0x6b, 0x7a, 1.0);
pub const DEL_BG: Color = Color::rgba8(255, 107, 122, 0.13);
pub const WARN: Color = Color::rgba8(0xfb, 0xbf, 0x24, 1.0);

/// `riskColors`.
pub fn risk_color(risk: &str) -> Color {
    match risk {
        "low" => ADD,
        "high" => DEL,
        _ => WARN,
    }
}

/// A tone's ink and background (src/components/tones.ts).
pub fn tone(name: &str) -> (Color, Color) {
    match name {
        "accent" => (ACCENT, ACCENT_SOFT),
        "good" => (ADD, ADD_BG),
        "bad" => (DEL, DEL_BG),
        "warn" => (WARN, Color::rgba8(251, 191, 36, 0.13)),
        _ => (Color::rgba8(0x8f, 0x98, 0xad, 1.0), Color::rgba8(144, 151, 168, 0.14)),
    }
}

/// The composition reserves this band at the bottom for burned-in captions.
pub const CAPTION_BAND: f32 = 150.0;
pub struct Safe {
    pub left: f32,
    pub right: f32,
    pub top: f32,
    pub bottom: f32,
}
pub const SAFE: Safe = Safe { left: 104.0, right: 104.0, top: 64.0, bottom: CAPTION_BAND };

pub const CODE_TAB_SIZE: usize = 2;
pub const CODE_READABLE_MIN: f64 = 15.0;

/// Display width of a code line in character cells, tabs expanded to CODE_TAB_SIZE stops.
pub fn code_columns(text: &str) -> usize {
    let mut col = 0;
    for ch in text.chars() {
        col = if ch == '\t' { col + CODE_TAB_SIZE - (col % CODE_TAB_SIZE) } else { col + 1 };
    }
    col
}

const HEADER_EYEBROW: f64 = 26.0 + 36.0;
const HEADER_TITLE: f64 = 70.0;

/// Size of SceneShell's content box as the layout code assumes it (`contentBox`).
pub fn content_box(has_title: bool) -> (f64, f64) {
    (1920.0 - 104.0 - 104.0, 1080.0 - 64.0 - 150.0 - HEADER_EYEBROW - if has_title { HEADER_TITLE } else { 0.0 })
}
