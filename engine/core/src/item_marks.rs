//! How scenes mark an item: what a diff does to it, a highlight, a badge of its own. A port of
//! src/components/marks.tsx and src/utils/marks.ts.

use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint};
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::theme::{ACCENT, ACCENT_SOFT, ADD, ADD_BG, DEL, DEL_BG, tone};
use serde::{Deserialize, Deserializer};

/// A string field a storyboard may write as a number.
pub fn text_or_number<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum T {
        S(String),
        N(serde_json::Number),
        B(bool),
        Null(()),
    }
    Ok(match T::deserialize(d)? {
        T::S(s) => Some(s),
        T::N(n) => Some(n.to_string()),
        T::B(b) => Some(b.to_string()),
        T::Null(()) => None,
    })
}

/// `Marks` of src/types.ts: `change`, `highlight`, `badge` and `tone`, flattened into an item.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Marks {
    #[serde(default)]
    pub change: Option<String>,
    #[serde(default)]
    pub highlight: Option<bool>,
    #[serde(default, deserialize_with = "text_or_number")]
    pub badge: Option<String>,
    #[serde(default)]
    pub tone: Option<String>,
}

impl Marks {
    pub fn highlighted(&self) -> bool {
        self.highlight == Some(true)
    }
}

/// `changeTone`: the ink, background and marker of an added, removed or modified item.
#[derive(Clone, Copy, Debug)]
pub struct ChangeTone {
    pub color: Color,
    pub bg: Color,
    pub marker: &'static str,
}

pub fn change_tone(change: &str) -> Option<ChangeTone> {
    match change {
        "added" => Some(ChangeTone { color: ADD, bg: ADD_BG, marker: "+" }),
        "removed" => Some(ChangeTone { color: DEL, bg: DEL_BG, marker: "\u{2212}" }),
        "modified" => Some(ChangeTone { color: ACCENT, bg: ACCENT_SOFT, marker: "~" }),
        _ => None,
    }
}

/// The one set of words for what a diff does to something.
pub fn change_word(change: &str) -> &'static str {
    match change {
        "added" => "new",
        "modified" => "changed",
        _ => "removed",
    }
}

/// "Look here": white light on the part, a colour no change uses (`EMPHASIS`).
pub const EMPHASIS: Color = Color::rgba8(0xf4, 0xf1, 0xe8, 1.0);
pub const EMPHASIS_SOFT: Color = Color::rgba8(255, 250, 236, 0.12);
pub const EMPHASIS_GLOW: Color = Color::rgba8(255, 250, 236, 0.5);

/// `EMPHASIS.card`: a lift on the raised colour, over a box `h` tall.
pub fn emphasis_card(h: f32) -> Paint {
    Paint::vertical(0.0, h, Color::css("#24262d"), Color::css("#1b1d24"))
}

/// A tone's ink colour (`tones[tone].color`), neutral for none.
pub fn tone_color(name: Option<&str>) -> Color {
    tone(name.unwrap_or("neutral")).0
}

/// One badge: its word and colour.
#[derive(Clone, Debug)]
pub struct BadgeSpec {
    pub text: String,
    pub color: Color,
}

/// The badges an item shows: its change first, when `with_change`, then its own badge (`badgesOf`).
pub fn badges_of(m: &Marks, with_change: bool) -> Vec<BadgeSpec> {
    let mut out = Vec::new();
    if with_change && let Some(c) = m.change.as_deref().and_then(|c| change_tone(c).map(|t| (c, t))) {
        out.push(BadgeSpec { text: change_word(c.0).into(), color: c.1.color });
    }
    if let Some(b) = m.badge.as_deref().filter(|b| !b.is_empty()) {
        out.push(BadgeSpec { text: b.into(), color: tone_color(m.tone.as_deref()) });
    }
    out
}

/// The words of an item's badges, change first, so a layout can size them (`badgeWords`).
pub fn badge_words(m: &Marks) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(c) = m.change.as_deref().filter(|c| change_tone(c).is_some()) {
        out.push(change_word(c).to_string());
    }
    if let Some(b) = m.badge.as_deref().filter(|b| !b.is_empty()) {
        out.push(b.to_string());
    }
    out
}

/// JS `String.length`: UTF-16 code units.
pub fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Width a run of uppercase badges at `size` takes, gaps included, estimated from character counts (`badgesWidth`).
pub fn badges_width(words: &[String], size: f64) -> f64 {
    words
        .iter()
        .enumerate()
        .map(|(i, w)| {
            (if i > 0 { 6.0 } else { 0.0 })
                + (js_len(w) as f64 * (size * 0.76 + 1.0) + 2.0 * (size * 0.75).floor() + 2.0).ceil()
        })
        .sum()
}

/// The size of a drawn badge pill (`Badge`): `pad_x` and `pad_y` default to the TSX's.
pub struct Pill {
    pub w: f32,
    pub h: f32,
    pub pad_x: f32,
    pub pad_y: f32,
    pub style: Style,
    pub text: String,
}

pub fn pill(text: &str, size: f32, pad: Option<(f32, f32)>) -> Pill {
    let (pad_x, pad_y) = pad.unwrap_or(((size * 0.75).floor(), (size / 4.0).floor()));
    let style = Style::sans(800.0, size).spacing(1.0);
    let text = text.to_uppercase();
    let line = line_metrics(Face::Sans, size).normal;
    Pill { w: width(&text, style) + 2.0 * pad_x, h: line + 2.0 * pad_y, pad_x, pad_y, style, text }
}

/// Draws a pill with its top left at (x, y), scaled about its centre by `scale`; returns its width.
pub fn draw_pill(dl: &mut DisplayList, p: &Pill, color: Color, x: f32, y: f32, scale: f32) -> f32 {
    // `scale(0)` draws nothing; a singular transform must not reach the rasterizer.
    if scale.abs() < 1e-4 {
        return p.w;
    }
    dl.group(|dl| {
        if scale != 1.0 {
            dl.scale_about(scale, x + p.w / 2.0, y + p.h / 2.0);
        }
        dl.rect(x, y, p.w, p.h, BoxStyle::fill(color).radius(p.h / 2.0));
        let line = line_metrics(Face::Sans, p.style.size).normal;
        let base = y + p.pad_y + baseline_in(Face::Sans, p.style.size, line);
        dl.text(&p.text, p.style, x + p.pad_x, base, Color::css("#0b0d18"));
    });
    p.w
}

/// A `Badge` row's pills sized for `size`, with the gap `CornerBadges` puts between them.
pub fn pills(badges: &[BadgeSpec], size: f32, pad: Option<(f32, f32)>) -> Vec<(Pill, Color)> {
    badges.iter().map(|b| (pill(&b.text, size, pad), b.color)).collect()
}

/// Total width of badges laid in a row with `gap` between.
pub fn row_width(pills: &[(Pill, Color)], gap: f32) -> f32 {
    pills.iter().map(|(p, _)| p.w).sum::<f32>() + gap * pills.len().saturating_sub(1) as f32
}

/// `CornerBadges`: badges in a row (gap 6) whose top right is at (right_x, top), as `position: absolute; top; right`
/// puts them in a box whose padding edge is at `right_x`. `scale` scales the whole row about its centre.
pub fn corner_badges(dl: &mut DisplayList, badges: &[BadgeSpec], size: f32, right_x: f32, top: f32, scale: f32) {
    if badges.is_empty() {
        return;
    }
    let ps = pills(badges, size, None);
    let total = row_width(&ps, 6.0);
    let h = ps.iter().map(|(p, _)| p.h).fold(0.0, f32::max);
    dl.group(|dl| {
        if scale != 1.0 {
            dl.scale_about(scale, right_x - total / 2.0, top + h / 2.0);
        }
        let mut x = right_x - total;
        for (p, c) in &ps {
            draw_pill(dl, p, *c, x, top, 1.0);
            x += p.w + 6.0;
        }
    });
}
