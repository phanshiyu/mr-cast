//! A table's headers and rows at one moment of a step (`TableView` of src/components/DataTable.tsx): the table scene
//! draws one, and a graph draws one beside it.

use super::layout::{COL_GAP, Change, Layout, PAD_X, Placed, ROW_BADGE};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, drawn_width};
use crate::chrome::marks::{Marks, badges_of, draw_pill, pills, row_width};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Shadow};
use crate::states::{self as state, StateFrame};
use crate::steps::Emphasis;
use crate::text::{Face, Style, baseline_in, line_metrics};
use crate::textfit::Fit;
use crate::theme::{ACCENT, ACCENT_GLOW, ADD, ADD_BG, BORDER, DEL, DEL_BG, FAINT, MUTED, TEXT};
use crate::timing::FPS;

const STRUCK: &str = "#c98a93";

/// What `TableView` needs to draw a table at one moment of a step.
pub struct TableDraw<'a> {
    pub layout: &'a Layout,
    pub before: &'a Layout,
    pub s: &'a StateFrame<'a>,
    pub left: f32,
    pub top: f32,
    pub frame: f64,
    pub header_in: f64,
    pub row_at: &'a dyn Fn(usize) -> f64,
    pub row_emphasis: &'a dyn Fn(usize) -> Emphasis,
    pub cell_emphasis: &'a dyn Fn(usize, usize) -> Emphasis,
    pub header_glow: &'a dyn Fn(usize) -> f64,
}

/// A change's colour, its row's fill and its marker.
pub fn change_tone(change: Change) -> (Color, Color, &'static str) {
    match change {
        Change::Added => (ADD, ADD_BG, "+"),
        Change::Removed => (DEL, DEL_BG, "\u{2212}"),
        Change::Modified => (ACCENT, crate::theme::ACCENT_SOFT, "~"),
    }
}

pub fn hex_alpha(c: Color, a: u32) -> Color {
    c.alpha(a.min(255) as f32 / 255.0)
}

fn tone_color(name: &str) -> Color {
    crate::theme::tone(name).0
}

/// Draws the table at `left`, `top`.
pub fn draw_table(dl: &mut DisplayList, t: &TableDraw) {
    let layout = t.layout;
    dl.save();
    dl.translate(t.left, t.top);
    dl.scale_about(layout.scale as f32, 0.0, 0.0);
    dl.group(|dl| {
        dl.fade(t.header_in as f32);
        for (i, header) in layout.headers.iter().enumerate() {
            let color = if (t.header_glow)(i) > 0.0 { ACCENT } else { FAINT };
            draw_fit(dl, header, layout.cols[i].0 as f32, 8.0, TextOpts::new(color).normal());
        }
    });
    for i in 0..layout.rows.len() {
        draw_row(dl, t, i);
    }
    dl.restore();
}

/// Draws a line of `w` through text at `baseline`: Chrome's `line-through` in `color`, 2.5 thick.
fn strike(dl: &mut DisplayList, x: f32, baseline: f32, w: f32, face: Face, size: f32) {
    let m = line_metrics(face, size);
    let y = baseline - m.ascent * 0.3;
    dl.fill_rect(x, y - 1.25, w, 2.5, DEL);
}

/// A fit drawn with its lines `lh` apart, each struck through when `struck`.
fn draw_cell_text(dl: &mut DisplayList, fit: &Fit, x: f32, y: f32, lh: f32, color: Color, struck: bool) {
    let size = fit.size as f32;
    draw_fit(dl, fit, x, y, TextOpts::new(color).line_height(LineHeight::Times(lh / size)));
    if struck {
        let face: Face = fit.font.family.into();
        for (i, line) in fit.lines.iter().enumerate() {
            let base = y + i as f32 * lh + baseline_in(face, size, lh);
            strike(dl, x, base, drawn_width(fit, line, None), face, size);
        }
    }
}

/// One cell's content in its column, centred in the row (`Cell`).
#[allow(clippy::too_many_arguments)]
fn draw_cell(
    dl: &mut DisplayList,
    cell: &Placed,
    x: f32,
    top: f32,
    h: f32,
    first: bool,
    removed: bool,
    lh: f32,
    ink: Option<Color>,
) {
    let base_color = if removed {
        MUTED
    } else if first {
        TEXT
    } else {
        Color::css("#d5d9e3")
    };
    let lines = |c: &Placed| match c {
        Placed::Text { text, .. } => text.lines.len(),
        Placed::Change { inline: true, .. } => 1,
        Placed::Change { before, after, .. } => before.lines.len() + after.lines.len(),
    };
    let content = lines(cell) as f32 * lh;
    let y = top + (h - content) / 2.0;
    let struck_color = Color::css(STRUCK);
    match cell {
        Placed::Text { text, .. } => draw_cell_text(dl, text, x, y, lh, base_color, removed),
        Placed::Change { mono, inline: true, before, after } => {
            let gap = 0.4 * after.size as f32;
            draw_cell_text(dl, before, x, y, lh, struck_color, true);
            let mut px = x + drawn_width(before, &before.lines[0], None) + gap;
            let face = if *mono { Face::Mono } else { Face::Sans };
            let st = Style::new(face, 400.0, after.size as f32);
            px += dl.text("\u{2192}", st, px, y + baseline_in(face, after.size as f32, lh), FAINT) + gap;
            draw_cell_text(dl, after, px, y, lh, ink.unwrap_or(ADD), false);
        }
        Placed::Change { before, after, .. } => {
            draw_cell_text(dl, before, x, y, lh, struck_color, true);
            draw_cell_text(dl, after, x, y + before.lines.len() as f32 * lh, lh, ink.unwrap_or(ADD), false);
        }
    }
}

fn draw_row(dl: &mut DisplayList, t: &TableDraw, index: usize) {
    let (layout, was, at) = (t.layout, &t.before.rows[index], (t.row_at)(index));
    let s = t.s;
    let placed = &layout.rows[index];
    let shown = s.shown(&format!("r:{index}"));
    let land = spring(t.frame - at, FPS, Spring::damping(17.0).with_stiffness(120.0));
    let flash = interpolate(t.frame, &[at + 4.0, at + 10.0, at + 30.0], &[0.0, 1.0, 0.0], CLAMP);
    let emphasis = (t.row_emphasis)(index);
    let tone = placed.change.map(change_tone);
    let removed = placed.change == Some(Change::Removed);
    let pad = crate::timing::js_round(layout.font as f64 * 0.5) as f32;
    let mix = s.tint(&format!("r:{index}"));
    let tinted = mix.main_tone().map(str::to_string);
    let tint = match tone {
        Some((_, bg, _)) if placed.change != Some(Change::Modified) => bg,
        _ => Color::rgba8(255, 255, 255, (0.025 + 0.05 * flash) as f32),
    };
    let (ring, ring_w) = match (&tinted, tone) {
        (Some(t), _) => (hex_alpha(tone_color(t), 0xaa), 1.5),
        (None, Some((c, _, _))) => {
            (hex_alpha(c, if placed.change == Some(Change::Modified) { 0x44 } else { 0x55 }), 1.0)
        }
        (None, None) => (BORDER, 1.0),
    };
    let st = s.t;
    let y = (was.y + (placed.y - was.y) * st) as f32;
    let h = (was.h + (placed.h - was.h) * st) as f32;
    let w = layout.width as f32;
    let opacity = land * shown * emphasis.opacity * mix.dim_opacity() * if removed { 0.85 } else { 1.0 };
    let glow_blur = (26.0 * flash + 34.0 * emphasis.glow) as f32;
    let glow_color = tone.map_or(ACCENT, |(c, _, _)| c);

    dl.save();
    dl.translate(0.0, y);
    dl.translate(((1.0 - land * shown) * -40.0) as f32, 0.0);
    let k = (1.0 + 0.008 * emphasis.glow) as f32;
    if k != 1.0 {
        dl.scale_about(k, w / 2.0, h / 2.0);
    }
    let layer = opacity < 0.999;
    if layer {
        dl.push_layer(opacity.max(0.0) as f32);
    }
    let mut style = BoxStyle::fill(tint).radius(14.0).border(ring, ring_w);
    if glow_blur > 0.0 {
        style = style.shadow(Shadow::new(0.0, 0.0, glow_blur, hex_alpha(glow_color, 0x44)));
    }
    dl.rect(0.0, 0.0, w, h, style);
    for (name, amount) in &mix.tones {
        if *amount > 0.0 {
            dl.group(|dl| {
                dl.fade(*amount as f32);
                dl.rect(0.0, 0.0, w, h, BoxStyle::fill(state::tint_fill(tone_color(name))).radius(14.0));
            });
        }
    }
    let col_x = |i: usize| (layout.cols[i].0 - COL_GAP / 3.0) as f32;
    let col_w = |i: usize| (layout.cols[i].1 + 2.0 * COL_GAP / 3.0) as f32;
    for i in 0..placed.cells.len() {
        let cell = s.tint(&format!("x:{index}/{i}"));
        for (name, amount) in &cell.tones {
            if *amount > 0.0 {
                dl.group(|dl| {
                    dl.fade(*amount as f32);
                    dl.rect(
                        col_x(i),
                        4.0,
                        col_w(i),
                        h - 8.0,
                        BoxStyle::fill(state::tint_fill(tone_color(name)))
                            .radius(10.0)
                            .border(hex_alpha(tone_color(name), 0xaa), 1.5),
                    );
                });
            }
        }
    }
    if emphasis.glow > 0.0 {
        let g = emphasis.glow as f32;
        dl.rect(
            0.0,
            0.0,
            w,
            h,
            BoxStyle::fill(Color::rgba8(124, 140, 255, 0.1 * g))
                .radius(14.0)
                .border(hex_alpha(ACCENT, (g * 160.0).round() as u32), 2.0),
        );
    }
    if emphasis.bar > 0.0 {
        dl.group(|dl| {
            dl.fade(emphasis.bar as f32);
            dl.rect(0.0, 8.0, 5.0, h - 16.0, BoxStyle::fill(ACCENT).radius(3.0));
        });
    }
    // The change marker.
    if let Some((color, _, marker)) = tone {
        let size = (layout.font as f32).max(20.0);
        let st = Style::mono(800.0, size);
        let lh = line_metrics(Face::Mono, size).normal;
        dl.text(marker, st, PAD_X as f32, (h - lh) / 2.0 + baseline_in(Face::Mono, size, lh), color);
    }
    for i in 0..placed.cells.len() {
        let g = (t.cell_emphasis)(index, i).glow as f32;
        if g > 0.0 {
            dl.rect(
                col_x(i),
                4.0,
                col_w(i),
                h - 8.0,
                BoxStyle::fill(Color::rgba8(124, 140, 255, 0.16 * g))
                    .radius(10.0)
                    .border(hex_alpha(ACCENT, (g as f64 * 200.0).round() as u32), 2.0)
                    .shadow(Shadow::new(0.0, 0.0, 28.0 * g, ACCENT_GLOW)),
            );
        }
    }
    let lh = layout.line_height as f32;
    for (i, cell) in placed.cells.iter().enumerate() {
        let key = format!("x:{index}/{i}");
        let changed = s.value_changed(&key);
        let own = s.tint(&key);
        let toned = own.main_tone().or(tinted.as_deref()).map(tone_color);
        let dim = own.dim;
        let (cx, top, ch) = (layout.cols[i].0 as f32, pad, h - 2.0 * pad);
        let at_cell = |dl: &mut DisplayList, c: &Placed, opacity: f64, shift: f64| {
            dl.group(|dl| {
                dl.fade((opacity * (1.0 - 0.5 * dim)) as f32);
                dl.translate(0.0, shift as f32);
                draw_cell(dl, c, cx, top, ch, i == 0, removed, lh, toned);
            });
        };
        if changed {
            if st < 1.0 {
                at_cell(dl, &was.cells[i], 1.0 - st, -14.0 * st);
            }
            at_cell(dl, cell, st, 14.0 * (1.0 - st));
        } else {
            at_cell(dl, cell, 1.0, 0.0);
        }
    }
    let marks = Marks { badge: placed.row.badge.clone(), tone: placed.row.tone.clone(), ..Default::default() };
    let ps = pills(&badges_of(&marks, false), ROW_BADGE as f32, None);
    if let Some((first, _)) = ps.first() {
        let mut x = w - 18.0 - row_width(&ps, 6.0);
        for (p, c) in &ps {
            x += draw_pill(dl, p, *c, x, (h - first.h) / 2.0, 1.0) + 6.0;
        }
    }
    if layer {
        dl.pop_layer();
    }
    dl.restore();
}
