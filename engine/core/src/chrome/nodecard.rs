//! A node of a graph, sequence or layers scene: icon, label and caption, marked by its change or as a key part
//! (src/components/NodeCard.tsx and src/utils/nodeText.ts).

use super::fittext::{Align, TextOpts, draw_fit};
use super::marks::{EMPHASIS, Marks, badges_of, change_colors, draw_corner_badges, emphasis_card, emphasis_ring, ring};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint, Shadow, Stroke};
use crate::icons;
use crate::steps::Emphasis;
use crate::text::{Face, baseline_in, line_metrics};
use crate::textfit::{Fit, Slot, fit_text, fit_text_at};
use crate::theme::{ACCENT, ACCENT_GLOW, ACCENT_SOFT, ADD_BG, BORDER_STRONG, DEL, FAINT, MUTED, RAISED, TEXT, tone};
use serde::Deserialize;

/// Card proportions: a graph node is a large card, a sequence participant a smaller one, compact when narrow.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CardSize {
    Large,
    Small,
    Compact,
}

pub struct Metrics {
    pub icon: f32,
    pub icon_radius: f32,
    pub pad: f32,
    pub gap: f32,
    pub radius: f32,
    pub badge: f32,
    pub badge_at: (f32, f32),
    pub ring: (f32, f32),
}

pub fn metrics(size: CardSize) -> Metrics {
    match size {
        CardSize::Large => Metrics {
            icon: 56.0,
            icon_radius: 14.0,
            pad: 22.0,
            gap: 18.0,
            radius: 20.0,
            badge: 16.0,
            badge_at: (-16.0, 18.0),
            ring: (6.0, 48.0),
        },
        CardSize::Small => Metrics {
            icon: 48.0,
            icon_radius: 12.0,
            pad: 16.0,
            gap: 14.0,
            radius: 18.0,
            badge: 14.0,
            badge_at: (-14.0, 14.0),
            ring: (5.0, 40.0),
        },
        CardSize::Compact => Metrics {
            icon: 40.0,
            icon_radius: 12.0,
            pad: 14.0,
            gap: 12.0,
            radius: 18.0,
            badge: 14.0,
            badge_at: (-14.0, 14.0),
            ring: (5.0, 40.0),
        },
    }
}

/// `DiagramNode`.
#[derive(Clone, Debug, Deserialize)]
pub struct Node {
    pub id: String,
    pub label: String,
    pub icon: Option<String>,
    pub caption: Option<String>,
    #[serde(flatten)]
    pub marks: Marks,
}

impl Node {
    fn has_icon(&self) -> bool {
        self.icon.as_deref().is_some_and(|i| !i.is_empty())
    }
    fn has_caption(&self) -> bool {
        self.caption.as_deref().is_some_and(|c| !c.is_empty())
    }
}

/// A card's title and caption, fitted to its card.
#[derive(Clone, Debug)]
pub struct CardText {
    pub title: Fit,
    pub caption: Option<Fit>,
}

fn text_width(node: &Node, width: f64, size: CardSize) -> f64 {
    let m = metrics(size);
    width - 2.0 * m.pad as f64 - if node.has_icon() { (m.icon + m.gap) as f64 } else { 0.0 } - 4.0
}

fn title_slot(size: CardSize, w: f64) -> Slot {
    Slot::named(if size == CardSize::Large { "cardTitle" } else { "smallCardTitle" }, w)
}

fn caption_gap(size: CardSize) -> f64 {
    if size == CardSize::Large { 4.0 } else { 3.0 }
}

const CARD_V_PAD: f64 = 8.0;

fn caption_of(n: &Node, width: f64, size: CardSize) -> Option<Fit> {
    let slot = Slot::named(
        if size == CardSize::Large { "cardCaption" } else { "smallCardCaption" },
        text_width(n, width, size),
    );
    n.has_caption().then(|| fit_text(n.caption.as_deref().unwrap_or(""), &slot))
}

fn own_title(n: &Node, width: f64, height: f64, size: CardSize, caption: Option<&Fit>) -> Fit {
    let slot = title_slot(size, text_width(n, width, size));
    let room = height - 2.0 * CARD_V_PAD - caption.map_or(0.0, |c| c.height + caption_gap(size));
    let mut s = slot.size;
    loop {
        let mut at = slot.clone();
        at.size = s;
        at.one_line_min = Some(slot.one_line_min.unwrap_or(s).min(s));
        let fit = fit_text(&n.label, &at);
        if fit.height <= room || s <= slot.min || !fit.fits {
            return fit;
        }
        s -= 1.0;
    }
}

/// One title size for every card of a diagram: the largest at which each title fits its card.
pub fn shared_title_size(nodes: &[Node], width: f64, height: f64, size: CardSize) -> f64 {
    nodes.iter().fold(title_slot(size, 0.0).size, |m, n| {
        m.min(own_title(n, width, height, size, caption_of(n, width, size).as_ref()).size)
    })
}

/// Each card's title, at one size shared by every card or at its own, and its caption (`cardTexts`).
pub fn card_texts(nodes: &[Node], width: f64, height: f64, size: CardSize, shared: bool) -> Vec<CardText> {
    let one = if shared { shared_title_size(nodes, width, height, size) } else { f64::INFINITY };
    nodes
        .iter()
        .map(|n| {
            let caption = caption_of(n, width, size);
            let own = own_title(n, width, height, size, caption.as_ref());
            let title = if one < own.size {
                fit_text_at(&n.label, &title_slot(size, text_width(n, width, size)), one)
            } else {
                own.clone()
            };
            CardText { title: if title.fits { title } else { own }, caption }
        })
        .collect()
}

/// A node's colour: by what the diff does to it, else as highlighted, else none (`nodeMark`): (colour, background).
pub fn node_mark(n: &Marks) -> Option<(Color, Color)> {
    if let Some(c) = &n.change {
        return Some(change_colors(c));
    }
    n.highlighted().then_some((EMPHASIS, super::marks::EMPHASIS_SOFT))
}

/// `colors.del` with `cc` alpha.
const DEL_CC: Color = Color::rgba8(0xff, 0x6b, 0x7a, 0xcc as f32 / 255.0);

/// Draws a card with its box at (x, y), `w` by `h`, as it is at `appear` (a spring, 0 to 1) and `emphasis`.
#[allow(clippy::too_many_arguments)]
pub fn draw(
    dl: &mut DisplayList,
    node: &Node,
    (x, y, w, h): (f32, f32, f32, f32),
    size: CardSize,
    appear: f64,
    emphasis: Emphasis,
    text: &CardText,
) {
    let m = metrics(size);
    let marks = &node.marks;
    let removed = marks.change.as_deref() == Some("removed");
    let t = marks.tone.as_deref().map(tone);
    let changed = marks.change.as_deref().map(change_colors);
    let mark = node_mark(marks);
    let highlight = marks.change.is_none() && marks.highlighted();
    let icon_color =
        changed.map(|c| c.0).or(t.map(|t| t.0)).unwrap_or(if marks.highlighted() { EMPHASIS } else { MUTED });
    let icon_bg = changed.map(|c| c.1).or(t.map(|t| t.1)).unwrap_or(if marks.highlighted() {
        super::marks::EMPHASIS_SOFT
    } else {
        Color::rgba8(255, 255, 255, 0.05)
    });
    let fill: Paint = match marks.change.as_deref() {
        Some("added") => Paint::vertical(y, y + h, Color::css("#14231f"), Color::css("#121a1a")),
        Some("modified") => Paint::vertical(y, y + h, Color::css("#1c2033"), Color::css("#151826")),
        _ if highlight => emphasis_card(y, h),
        _ => RAISED.into(),
    };
    let mut shadows: Vec<Shadow> = match marks.change.as_deref() {
        Some("added") => vec![ring(m.ring.0, ADD_BG), Shadow::new(0.0, 0.0, m.ring.1, Color::rgba8(61, 220, 151, 0.3))],
        Some("modified") => vec![ring(m.ring.0, ACCENT_SOFT), Shadow::new(0.0, 0.0, m.ring.1, ACCENT_GLOW)],
        _ if highlight => emphasis_ring(m.ring.0, m.ring.1).to_vec(),
        _ => vec![Shadow::new(0.0, 12.0, 32.0, Color::rgba8(0, 0, 0, 0.4))],
    };
    let g = emphasis.glow as f32;
    if g > 0.0 {
        shadows.push(ring(4.0 * g, ACCENT));
        shadows.push(Shadow::new(0.0, 0.0, 44.0 * g, ACCENT_GLOW));
    }
    let border = if removed { DEL_CC } else { mark.map_or(BORDER_STRONG, |c| c.0) };
    let appear_f = appear as f32;
    let opacity = (appear_f * if removed { 0.62 } else { 1.0 } * emphasis.opacity as f32).clamp(0.0, 1.0);
    // CSS opacity on the card fades it as one piece, so overlapping parts do not show through each other.
    let layered = opacity < 1.0;
    dl.group(|dl| {
        if layered {
            dl.push_layer(opacity);
        }
        dl.translate(0.0, (1.0 - appear_f) * if size == CardSize::Large { 20.0 } else { 18.0 });
        dl.scale_about((0.92 + 0.08 * appear_f) * (1.0 + 0.03 * g), x + w / 2.0, y + h / 2.0);
        let mut style = BoxStyle::fill(fill).radius(m.radius);
        style.border = Some(if removed { Stroke::dashed(border, 2.0, 6.0, 6.0) } else { Stroke::solid(border, 2.0) });
        style.shadows = shadows;
        dl.rect(x, y, w, h, style);
        let (mut cx, inner_h) = (x + 2.0 + m.pad, h - 4.0);
        if node.has_icon() {
            let ty = y + 2.0 + (inner_h - m.icon) / 2.0;
            dl.rect(cx, ty, m.icon, m.icon, BoxStyle::fill(icon_bg).radius(m.icon_radius));
            let glyph = (m.icon * if size == CardSize::Large { 0.536 } else { 0.55 }).round();
            let at = (m.icon - glyph) / 2.0;
            icons::draw_named(dl, node.icon.as_deref().unwrap_or(""), cx + at, ty + at, glyph, icon_color, 2.0);
            cx += m.icon + m.gap;
        }
        let gap = caption_gap(size) as f32;
        let col_h = text.title.height as f32 + text.caption.as_ref().map_or(0.0, |c| gap + c.height as f32);
        let top = y + 2.0 + (inner_h - col_h) / 2.0;
        let color = if removed { MUTED } else { TEXT };
        draw_fit(dl, &text.title, cx, top, TextOpts::new(color));
        if removed {
            strike(dl, &text.title, cx, top);
        }
        if let Some(c) = &text.caption {
            draw_fit(dl, c, cx, top + text.title.height as f32 + gap, TextOpts::new(FAINT));
        }
        let badges = badges_of(marks, true);
        draw_corner_badges(dl, &badges, m.badge, x + w - 2.0 - m.badge_at.1, y + 2.0 + m.badge_at.0);
        if layered {
            dl.pop_layer();
        }
    });
}

/// `text-decoration: line-through` in `colors.del`, 3px thick, over each line of a fit drawn at (x, top).
pub fn strike(dl: &mut DisplayList, fit: &Fit, x: f32, top: f32) {
    strike_with(dl, fit, x, top, Some(3.0), Align::Left, 0.0);
}

/// Line-through over each line of a fit drawn at (x, top) with `align` in a box `width` wide; `thickness` None is
/// the font's own (`text-decoration-thickness: auto`).
pub fn strike_with(
    dl: &mut DisplayList,
    fit: &Fit,
    x: f32,
    top: f32,
    thickness: Option<f32>,
    align: Align,
    width: f32,
) {
    let size = fit.size as f32;
    let face: Face = fit.font.family.into();
    let lh = size * fit.line_height as f32;
    let base_off = baseline_in(face, size, lh);
    let metrics = line_metrics(face, size);
    let t = thickness.unwrap_or_else(|| (size * 0.07).round().max(1.0));
    for (i, wd) in fit.widths.iter().enumerate() {
        let base = top + i as f32 * lh + base_off;
        let wd = *wd as f32;
        let left = match align {
            Align::Left => x,
            Align::Center => x + (width - wd) / 2.0,
            Align::Right => x + width - wd,
        };
        dl.fill_rect(left, base - metrics.ascent / 3.0 - t / 2.0, wd, t, DEL);
    }
}
