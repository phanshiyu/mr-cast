//! A graph node drawn as a card (`NodeCard`) or a flowchart shape (`ShapeNode`).

use super::layout::{GraphNode, Shape};
use super::text::{self, CardText};
use crate::chrome::fittext::{Align, LineHeight, TextOpts, draw_fit, drawn_width, fit_height};
use crate::color::Color;
use crate::diagram::strike;
use crate::display::{BoxStyle, DisplayList, Paint, PathBuilder, Shadow, Stroke};
use crate::graph_states::{TintMix, tint_fill};
use crate::icons;
use crate::item_marks::{
    EMPHASIS, EMPHASIS_GLOW, EMPHASIS_SOFT, badges_of, change_tone, corner_badges, emphasis_card, tone_color,
};
use crate::steps::Emphasis;
use crate::text::{Face, Style, baseline_in};
use crate::textfit::Fit;
use crate::theme::{
    ACCENT, ACCENT_GLOW, ACCENT_SOFT, ADD, ADD_BG, BORDER_STRONG, DEL, FAINT, MUTED, RAISED, TEXT, tone,
};

fn alpha(c: Color, a: u8) -> Color {
    c.alpha(a as f32 / 255.0)
}

/// How a node is coloured: by what the diff does to it, else as highlighted, else not at all (`nodeMark`).
fn mark_color(node: &GraphNode) -> Option<Color> {
    if let Some(t) = node.marks.change.as_deref().and_then(change_tone) {
        return Some(t.color);
    }
    node.marks.highlighted().then_some(EMPHASIS)
}

/// What a node draws with at one frame.
pub struct NodeState<'a> {
    pub node: &'a GraphNode,
    pub badges: Vec<crate::item_marks::BadgeSpec>,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub text: &'a CardText,
    pub emphasis: Emphasis,
    pub appear: f64,
    pub tint: TintMix,
}

/// A line struck through by `text-decoration: line-through`, over each line of a fit drawn at (x, top).
fn strike_fit(dl: &mut DisplayList, fit: &Fit, x: f32, top: f32, center: Option<f32>) {
    let face: Face = fit.font.family.into();
    let lh = fit.size as f32 * fit.line_height as f32;
    for (i, line) in fit.lines.iter().enumerate() {
        let w = drawn_width(fit, line, None);
        let left = center.map_or(x, |c| c - w / 2.0);
        let base = top + i as f32 * lh + baseline_in(face, fit.size as f32, lh);
        strike(dl, Style::new(face, fit.font.weight as f32, fit.size as f32), left, base, w, DEL, Some(3.0));
    }
}

fn common(dl: &mut DisplayList, n: &NodeState, body: impl FnOnce(&mut DisplayList)) {
    let removed = n.node.marks.change.as_deref() == Some("removed");
    let opacity = n.appear * if removed { 0.62 } else { 1.0 } * n.emphasis.opacity * n.tint.dim_opacity();
    let layered = opacity < 0.999;
    dl.group(|dl| {
        dl.translate(n.x, n.y);
        dl.translate(0.0, ((1.0 - n.appear) * 20.0) as f32);
        dl.scale_about(((0.92 + 0.08 * n.appear) * (1.0 + 0.03 * n.emphasis.glow)) as f32, n.w / 2.0, n.h / 2.0);
        if layered {
            // Opacity on the element fades what it holds as one picture, so overlapping parts do not show through.
            dl.push_layer(opacity as f32);
            body(dl);
            dl.pop_layer();
        } else {
            body(dl);
        }
    });
}

/// `NodeCard`, size large.
pub fn draw_card(dl: &mut DisplayList, n: &NodeState) {
    let node = n.node;
    let removed = node.marks.change.as_deref() == Some("removed");
    let change = node.marks.change.as_deref().and_then(change_tone);
    let tinted = n.tint.main();
    let tone_c = node.marks.tone.as_deref().map(tone);
    let (w, h) = (n.w, n.h);
    common(dl, n, |dl| {
        let highlight = node.marks.highlighted() && change.is_none();
        let paint = match node.marks.change.as_deref() {
            Some("added") => Paint::vertical(0.0, h, Color::css("#14231f"), Color::css("#121a1a")),
            Some("modified") => Paint::vertical(0.0, h, Color::css("#1c2033"), Color::css("#151826")),
            _ if highlight => emphasis_card(h),
            _ => RAISED.into(),
        };
        let border = if removed {
            alpha(DEL, 0xcc)
        } else if let Some(t) = tinted {
            tone(t).0
        } else {
            mark_color(node).unwrap_or(BORDER_STRONG)
        };
        let g = n.emphasis.glow as f32;
        let (ring, blur) = text::RING;
        let mut style = BoxStyle::fill(paint).radius(text::RADIUS);
        if g > 0.0 {
            style = style.shadow(Shadow::new(0.0, 0.0, 44.0 * g, ACCENT_GLOW));
            let mut r = Shadow::new(0.0, 0.0, 0.0, ACCENT);
            r.spread = 4.0 * g;
            style = style.shadow(r);
        }
        match node.marks.change.as_deref() {
            Some("added") => {
                style = style.shadow(Shadow::new(0.0, 0.0, blur, Color::rgba8(61, 220, 151, 0.3)));
                let mut r = Shadow::new(0.0, 0.0, 0.0, ADD_BG);
                r.spread = ring;
                style = style.shadow(r);
            }
            Some("modified") => {
                style = style.shadow(Shadow::new(0.0, 0.0, blur, ACCENT_GLOW));
                let mut r = Shadow::new(0.0, 0.0, 0.0, ACCENT_SOFT);
                r.spread = ring;
                style = style.shadow(r);
            }
            _ if highlight => {
                style = style.shadow(Shadow::new(0.0, 0.0, blur, EMPHASIS_GLOW));
                let mut r = Shadow::new(0.0, 0.0, 0.0, EMPHASIS_SOFT);
                r.spread = ring;
                style = style.shadow(r);
            }
            _ => style = style.shadow(Shadow::new(0.0, 12.0, 32.0, Color::rgba8(0, 0, 0, 0.4))),
        }
        if removed {
            style = style.border_stroke(Stroke::dashed(border, 2.0, 6.0, 6.0));
        } else {
            style = style.border(border, 2.0);
        }
        dl.rect(0.0, 0.0, w, h, style);
        for (name, amount) in &n.tint.tones {
            if *amount > 0.0 {
                dl.group(|dl| {
                    dl.fade(*amount as f32);
                    dl.rect(2.0, 2.0, w - 4.0, h - 4.0, BoxStyle::fill(tint_fill(name)).radius(text::RADIUS - 2.0));
                });
            }
        }
        let mut x = 2.0 + text::PAD as f32;
        let has_icon = node.icon.as_deref().is_some_and(icons::has_lucide);
        if has_icon {
            let icon_color = change.map(|c| c.color).or(tone_c.map(|t| t.0)).unwrap_or(if node.marks.highlighted() {
                EMPHASIS
            } else {
                MUTED
            });
            let icon_bg = change.map(|c| c.bg).or(tone_c.map(|t| t.1)).unwrap_or(if node.marks.highlighted() {
                EMPHASIS_SOFT
            } else {
                Color::rgba8(255, 255, 255, 0.05)
            });
            let ty = (h - text::ICON as f32) / 2.0;
            dl.rect(x, ty, text::ICON as f32, text::ICON as f32, BoxStyle::fill(icon_bg).radius(text::ICON_RADIUS));
            let size = (text::ICON * 0.536).round() as f32;
            icons::draw_lucide(
                dl,
                node.icon.as_deref().unwrap_or(""),
                x + (text::ICON as f32 - size) / 2.0,
                ty + (text::ICON as f32 - size) / 2.0,
                size,
                icon_color,
                2.0,
            );
            x += (text::ICON + text::GAP) as f32;
        }
        let title = &n.text.title;
        let th = fit_height(title, LineHeight::Fit);
        let ch = n.text.caption.as_ref().map_or(0.0, |c| 4.0 + fit_height(c, LineHeight::Fit));
        let top = 2.0 + (h - 4.0 - th - ch) / 2.0;
        let color = if removed { MUTED } else { TEXT };
        draw_fit(dl, title, x, top, TextOpts::new(color));
        if removed {
            strike_fit(dl, title, x, top, None);
        }
        if let Some(c) = &n.text.caption {
            draw_fit(dl, c, x, top + th + 4.0, TextOpts::new(FAINT));
        }
        corner_badges(dl, &n.badges, text::BADGE, w - 2.0 - text::BADGE_AT.1, 2.0 + text::BADGE_AT.0, 1.0);
    });
}

fn fill_of(node: &GraphNode) -> Color {
    match node.marks.change.as_deref() {
        Some("added") => Color::css("#14231f"),
        Some("modified") => Color::css("#1c2033"),
        None if node.marks.highlighted() => Color::css("#22242b"),
        _ => RAISED,
    }
}

/// The glow around a shape: CSS drop shadows, listed top first as `glowOf` writes them.
fn glow_of(node: &GraphNode, e: &Emphasis) -> Vec<(f32, f32, f32, Color)> {
    let mut s = Vec::new();
    let change = node.marks.change.as_deref();
    if change == Some("added") {
        s.push((0.0, 0.0, 18.0, Color::rgba8(61, 220, 151, 0.35)));
    }
    if change == Some("modified") {
        s.push((0.0, 0.0, 18.0, ACCENT_GLOW));
    }
    if change.is_none() && node.marks.highlighted() {
        s.push((0.0, 0.0, 16.0, EMPHASIS_GLOW));
    }
    if change.is_none() && !node.marks.highlighted() {
        s.push((0.0, 12.0, 24.0, Color::rgba8(0, 0, 0, 0.4)));
    }
    if e.glow > 0.0 {
        s.push((0.0, 0.0, 18.0 * e.glow as f32, ACCENT_GLOW));
        // The next drop shadow shades this glow too.
        s.push((0.0, 0.0, 18.0 * e.glow as f32, ACCENT_GLOW));
        s.push((0.0, 0.0, 4.0 * e.glow as f32, ACCENT));
    }
    s
}

/// `ShapeNode`: a decision's diamond, a terminal's pill or a step's plain box.
pub fn draw_shape(dl: &mut DisplayList, n: &NodeState, shape: Shape) {
    let node = n.node;
    let removed = node.marks.change.as_deref() == Some("removed");
    let (w, h) = (n.w, n.h);
    let g = n.emphasis.glow as f32;
    let stroke = if removed {
        alpha(DEL, 0xcc)
    } else if g > 0.0 {
        ACCENT
    } else if let Some(t) = n.tint.main() {
        tone(t).0
    } else {
        mark_color(node).unwrap_or(BORDER_STRONG)
    };
    let sw = 2.0 + 2.0 * g;
    let glows = glow_of(node, &n.emphasis);
    common(dl, n, |dl| {
        if shape == Shape::Decision {
            let mut pb = PathBuilder::new();
            pb.move_to(w / 2.0, 1.0);
            pb.line_to(w - 1.0, h / 2.0);
            pb.line_to(w / 2.0, h - 1.0);
            pb.line_to(1.0, h / 2.0);
            pb.close();
            let Some(path) = pb.finish() else { return };
            // A drop shadow follows the outline: stand in for its blur with widening, fainter strokes.
            for (dx, dy, blur, c) in glows.iter().rev() {
                for i in (1..=6).rev() {
                    let k = i as f32 / 6.0;
                    let mut cc = *c;
                    cc.a *= 0.16 * (1.0 - k * 0.8);
                    dl.group(|dl| {
                        dl.translate(*dx, *dy);
                        dl.path(path.clone(), Some(cc.into()), Some(Stroke::solid(cc, blur * 2.0 * k * 1.6).rounded()));
                    });
                }
            }
            let mut st = if removed { Stroke::dashed(stroke, sw, 9.0, 7.0) } else { Stroke::solid(stroke, sw) };
            st.round = true;
            dl.path(path.clone(), Some(fill_of(node).into()), Some(st));
            for (name, amount) in &n.tint.tones {
                if *amount > 0.0 {
                    dl.group(|dl| {
                        dl.fade(*amount as f32);
                        dl.path(path.clone(), Some(tint_fill(name).into()), None);
                    });
                }
            }
        } else {
            let radius = if shape == Shape::Terminal { h / 2.0 } else { 14.0 };
            let mut style = BoxStyle::fill(fill_of(node)).radius(radius);
            for (dx, dy, blur, c) in glows.iter().rev() {
                style = style.shadow(Shadow::new(*dx, *dy, *blur * 2.0, *c));
            }
            style = if removed {
                style.border_stroke(Stroke::dashed(stroke, sw, 6.0, 6.0))
            } else {
                style.border(stroke, sw)
            };
            dl.rect(0.0, 0.0, w, h, style);
            for (name, amount) in &n.tint.tones {
                if *amount > 0.0 {
                    dl.group(|dl| {
                        dl.fade(*amount as f32);
                        dl.rect(0.0, 0.0, w, h, BoxStyle::fill(tint_fill(name)).radius(radius));
                    });
                }
            }
        }
        let title = &n.text.title;
        let th = fit_height(title, LineHeight::Fit);
        let ch = n.text.caption.as_ref().map_or(0.0, |c| 4.0 + fit_height(c, LineHeight::Fit));
        let bw = title.width.max(n.text.caption.as_ref().map_or(0.0, |c| c.width)) as f32;
        let top = (h - th - ch) / 2.0;
        let left = (w - bw) / 2.0;
        draw_fit(dl, title, left, top, TextOpts::new(if removed { MUTED } else { TEXT }).centered(bw));
        if removed {
            strike_fit(dl, title, left, top, Some(w / 2.0));
        }
        if let Some(c) = &n.text.caption {
            draw_fit(dl, c, left, top + th + 4.0, TextOpts::new(FAINT).centered(bw));
        }
        let (top_b, right_b) = if shape == Shape::Decision { (h * 0.12 - 16.0, w * 0.22) } else { (-16.0, 18.0) };
        corner_badges(dl, &n.badges, 16.0, w - right_b, top_b, 1.0);
    });
    let _ = (Align::Left, badges_of, tone_color, ADD);
}
