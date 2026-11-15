//! Change colours, the "look here" emphasis and badges: src/components/marks.tsx and src/utils/marks.ts.

use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint, Shadow};
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::theme::{ACCENT, ACCENT_SOFT, ADD, ADD_BG, DEL, DEL_BG, tone};
use serde::Deserialize;

/// `Marks` of src/types.ts: what an item says about itself.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Marks {
    pub change: Option<String>,
    pub highlight: Option<bool>,
    pub badge: Option<String>,
    pub tone: Option<String>,
}

impl Marks {
    pub fn highlighted(&self) -> bool {
        self.highlight == Some(true)
    }
}

/// `changeTone`: ink and background of a change.
pub fn change_tone(change: &str) -> (Color, Color) {
    match change {
        "added" => (ADD, ADD_BG),
        "removed" => (DEL, DEL_BG),
        _ => (ACCENT, ACCENT_SOFT),
    }
}

/// `EMPHASIS`: white light on the part, a colour no change uses.
pub const EMPHASIS_COLOR: Color = Color::rgba8(0xf4, 0xf1, 0xe8, 1.0);
pub const EMPHASIS_SOFT: Color = Color::rgba8(255, 250, 236, 0.12);
pub const EMPHASIS_GLOW: Color = Color::rgba8(255, 250, 236, 0.5);

/// `EMPHASIS.card`, a lift on the raised background, over a box from `y` to `y + h`.
pub fn emphasis_card(y: f32, h: f32) -> Paint {
    Paint::vertical(y, y + h, Color::css("#24262d"), Color::css("#1b1d24"))
}

/// `emphasisRing(ring, blur)`: a soft white ring and glow.
pub fn emphasis_ring(ring: f32, blur: f32) -> [Shadow; 2] {
    [
        Shadow { dx: 0.0, dy: 0.0, blur: 0.0, spread: ring, color: EMPHASIS_SOFT },
        Shadow::new(0.0, 0.0, blur, EMPHASIS_GLOW),
    ]
}

/// A ring (`0 0 0 <spread>px color`) as a shadow.
pub fn ring(spread: f32, color: Color) -> Shadow {
    Shadow { dx: 0.0, dy: 0.0, blur: 0.0, spread, color }
}

/// A pill with an uppercase word: a change or an author's badge.
#[derive(Clone, Debug)]
pub struct BadgeSpec {
    pub text: String,
    pub color: Color,
}

/// The badges an item shows: its change first, in words (`badgesOf`), then its own badge.
pub fn badges_of(m: &Marks) -> Vec<BadgeSpec> {
    let mut out = Vec::new();
    if let Some(c) = &m.change {
        let word = match c.as_str() {
            "added" => "new",
            "modified" => "changed",
            _ => "removed",
        };
        out.push(BadgeSpec { text: word.into(), color: change_tone(c).0 });
    }
    if let Some(b) = m.badge.as_ref().filter(|b| !b.is_empty()) {
        out.push(BadgeSpec { text: b.clone(), color: tone(m.tone.as_deref().unwrap_or("neutral")).0 });
    }
    out
}

fn badge_style(size: f32) -> Style {
    Style::sans(800.0, size).spacing(1.0)
}

fn pads(size: f32) -> (f32, f32) {
    ((size / 4.0).floor(), (size * 0.75).floor())
}

/// A badge's size.
pub fn badge_box(b: &BadgeSpec, size: f32) -> (f32, f32) {
    let (py, px) = pads(size);
    (width(&b.text.to_uppercase(), badge_style(size)) + 2.0 * px, line_metrics(Face::Sans, size).normal + 2.0 * py)
}

/// Draws a badge with its top left at (x, y); returns its width.
pub fn draw_badge(dl: &mut DisplayList, b: &BadgeSpec, size: f32, x: f32, y: f32) -> f32 {
    let (w, h) = badge_box(b, size);
    let (py, px) = pads(size);
    dl.rect(x, y, w, h, BoxStyle::fill(b.color).radius(999.0));
    let lh = line_metrics(Face::Sans, size).normal;
    dl.text(
        &b.text.to_uppercase(),
        badge_style(size),
        x + px,
        y + py + baseline_in(Face::Sans, size, lh),
        Color::css("#0b0d18"),
    );
    w
}

/// Width of a row of badges, 6px apart.
pub fn badges_width(badges: &[BadgeSpec], size: f32) -> f32 {
    badges.iter().map(|b| badge_box(b, size).0).sum::<f32>() + 6.0 * badges.len().saturating_sub(1) as f32
}

/// Badges on the top edge of a box (`CornerBadges`): `right_edge` is the right edge of the box's padding box less
/// `right`, `top` the padding box's top plus `top`.
pub fn draw_corner_badges(dl: &mut DisplayList, badges: &[BadgeSpec], size: f32, right_edge: f32, top: f32) {
    let mut x = right_edge - badges_width(badges, size);
    for b in badges {
        x += draw_badge(dl, b, size, x, top) + 6.0;
    }
}
