//! The table beside a graph: its layout in every state (src/utils/tableLayout.ts) and its drawing
//! (`TableView` in src/components/DataTable.tsx).

use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, drawn_width};
use crate::color::Color;
use crate::diagram::strike;
use crate::display::{BoxStyle, DisplayList, Shadow};
use crate::graph_states::{SceneState, StateFrame, Val, tint_fill};
use crate::item_marks::{
    Marks, badges_of, badges_width, change_tone, draw_pill, js_len, pills, row_width, text_or_number,
};
use crate::markup::{parse_markup, plain_text};
use crate::steps::Emphasis;
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::{Fit, Slot, fit_text, fit_text_at};
use crate::theme::{ACCENT, ACCENT_GLOW, ADD, BORDER, DEL, FAINT, MUTED, TEXT, tone};
use crate::timing::{FPS, js_round};
use fancy_regex::Regex;
use serde::Deserialize;
use std::sync::OnceLock;

const MONO_ADVANCE: f64 = 0.61;
const SANS_ADVANCE: f64 = 0.5;
const MAX_FONT: i32 = 30;
const MIN_FONT: i32 = 17;
const LINE_HEIGHT: f64 = 1.3;
pub const HEADER_H: f64 = 44.0;
pub const MARKER_W: f64 = 30.0;
pub const PAD_X: f64 = 22.0;
pub const COL_GAP: f64 = 28.0;
const ROW_GAP: f64 = 6.0;
const HEADER_CHAR_W: f64 = 13.0;
pub const ROW_BADGE: f32 = 13.0;
const STRUCK: &str = "#c98a93";

/// A table cell: text, or the old value beside the new.
#[derive(Clone, Debug, PartialEq)]
pub enum Cell {
    Text(String),
    Change(String, String),
}

fn cell_text(c: &Cell) -> String {
    match c {
        Cell::Text(t) => t.clone(),
        Cell::Change(a, b) => format!("{a} \u{2192} {b}"),
    }
}

impl<'de> Deserialize<'de> for Cell {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        Ok(match crate::graph_states::cell_val(&v) {
            Some(Val::Change(a, b)) => Cell::Change(a, b),
            Some(Val::Text(t)) => Cell::Text(t),
            None => Cell::Text(match &v {
                serde_json::Value::Number(n) => n.to_string(),
                _ => String::new(),
            }),
        })
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct TableRow {
    #[serde(default)]
    pub cells: Vec<Cell>,
    #[serde(default)]
    pub change: Option<String>,
    #[serde(default, deserialize_with = "text_or_number")]
    pub badge: Option<String>,
    #[serde(default)]
    pub tone: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Table {
    #[serde(default)]
    pub columns: Vec<String>,
    #[serde(default)]
    pub rows: Vec<TableRow>,
}

pub enum PlacedCell {
    Text { text: Fit },
    Change { mono: bool, inline: bool, before: Fit, after: Fit },
}

pub struct PlacedRow {
    pub row: usize,
    pub change: Option<String>,
    pub cells: Vec<PlacedCell>,
    pub y: f64,
    pub h: f64,
}

pub struct TableLayout {
    pub font: f64,
    pub line_height: f64,
    pub cols: Vec<(f64, f64)>,
    pub headers: Vec<Fit>,
    pub rows: Vec<PlacedRow>,
    pub width: f64,
    pub height: f64,
    pub truncated: bool,
    pub scale: f64,
}

fn re(cell: &'static OnceLock<Regex>, src: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(src).expect("regex"))
}

fn has_markup(text: &str) -> bool {
    parse_markup(text).iter().any(|r| r.bold || r.code || r.mark || r.tone.is_some()) || plain_text(text) != text
}

/// Identifiers, paths and the like read as code, so they render in mono.
fn is_code_like(text: &str) -> bool {
    static MARKS: OnceLock<Regex> = OnceLock::new();
    static MATH: OnceLock<Regex> = OnceLock::new();
    static PERCENT: OnceLock<Regex> = OnceLock::new();
    let t = text.trim();
    !t.is_empty()
        && !t.chars().any(char::is_whitespace)
        && re(&MARKS, r"[_./:=()\[\]{}<>@#$\d]|[a-z][A-Z]").is_match(text).unwrap_or(false)
        && !re(&MATH, "^[OΘΩ]\\(|[¹²³⁰-₟×÷∀-⋿]").is_match(text).unwrap_or(false)
        && !re(&PERCENT, r"^[~≈<>+\-−±]?\d[\d,]*(\.\d+)?%$").is_match(t).unwrap_or(false)
        && !has_markup(text)
}

fn cased_header(c: &str) -> bool {
    static CASED: OnceLock<Regex> = OnceLock::new();
    re(&CASED, r"[\^_=`\[\]{}<>\\|*+]|\w\(|[a-z][A-Z]").is_match(c).unwrap_or(false)
}

fn cell_chars(c: &Cell) -> f64 {
    match c {
        Cell::Text(t) => js_len(t) as f64,
        _ => js_len(&cell_text(c)) as f64 + 2.0,
    }
}
fn cell_font(font: f64, mono: bool) -> f64 {
    if mono { js_round(font * 0.92) } else { font }
}
fn cell_mono(c: &Cell) -> bool {
    match c {
        Cell::Text(t) => is_code_like(t),
        Cell::Change(a, b) => is_code_like(a) && is_code_like(b),
    }
}
fn char_width(font: f64, mono: bool) -> f64 {
    cell_font(font, mono) * if mono { MONO_ADVANCE } else { SANS_ADVANCE }
}
fn row_change(row: &TableRow) -> Option<String> {
    if let Some(c) = &row.change {
        return Some(c.clone());
    }
    row.cells.iter().any(|c| matches!(c, Cell::Change(..))).then(|| "modified".to_string())
}

fn column_widths(columns: &[String], rows: &[TableRow], text_w: f64, font: f64) -> Vec<f64> {
    let need: Vec<f64> = columns
        .iter()
        .enumerate()
        .map(|(i, header)| {
            let h = js_len(header) as f64 * HEADER_CHAR_W + 8.0;
            let cells =
                rows.iter().map(|r| r.cells.get(i).map_or(0.0, |c| cell_chars(c) * char_width(font, cell_mono(c))));
            cells.fold(h, f64::max).max(font * 3.0)
        })
        .collect();
    let mut widths = vec![0.0; columns.len()];
    let mut open: Vec<usize> = (0..columns.len()).collect();
    let mut left = text_w;
    while !open.is_empty() {
        let share = left / open.len() as f64;
        let fits: Vec<usize> = open.iter().copied().filter(|&i| need[i] <= share).collect();
        if fits.is_empty() {
            for &i in &open {
                widths[i] = share;
            }
            break;
        }
        for &i in &fits {
            widths[i] = need[i];
            left -= need[i];
        }
        open.retain(|i| !fits.contains(i));
    }
    let total: f64 = widths.iter().sum();
    let spare = text_w - total;
    widths.iter().map(|w| w + spare * w / total).collect()
}

fn fit_cell(text: &str, mono: bool, first: bool, w: f64, font: f64, lines: usize) -> Fit {
    let mut slot = Slot::named(if mono { "tableCode" } else { "tableCell" }, w);
    slot.lines = lines;
    slot.weight = if first { 650.0 } else { 450.0 };
    fit_text_at(text, &slot, cell_font(font, mono))
}

fn inline_arrow(font: f64) -> f64 {
    2.0 * 0.4 * font + 0.85 * font
}

fn attempt(
    columns: &[String],
    rows: &[TableRow],
    every: &[TableRow],
    changes: &[Option<String>],
    w: f64,
    font: i32,
    max_lines: usize,
) -> TableLayout {
    let font = font as f64;
    let line_height = js_round(font * LINE_HEIGHT);
    let pad = js_round(font * 0.5);
    let badge_room = rows
        .iter()
        .map(|r| match r.badge.as_deref().filter(|b| !b.is_empty()) {
            Some(b) => badges_width(&[b.to_string()], ROW_BADGE as f64) + 24.0,
            None => 0.0,
        })
        .fold(0.0, f64::max);
    let text_w = w - 2.0 * PAD_X - MARKER_W - (columns.len() as f64 - 1.0) * COL_GAP - badge_room;
    let widths = column_widths(columns, every, text_w, font);
    let mut cols = Vec::new();
    let mut x = PAD_X + MARKER_W;
    for cw in &widths {
        cols.push((x, *cw));
        x += cw + COL_GAP;
    }
    let mut truncated = false;
    let mut y = HEADER_H;
    let mut placed = Vec::new();
    for (r, row) in rows.iter().enumerate() {
        let cells: Vec<PlacedCell> = (0..columns.len())
            .map(|i| {
                let cell = row.cells.get(i).cloned().unwrap_or(Cell::Text(String::new()));
                let mono = cell_mono(&cell);
                let first = i == 0;
                match &cell {
                    Cell::Text(t) => {
                        let text = fit_cell(t.trim(), mono, first, widths[i], font, max_lines);
                        truncated |= !text.fits;
                        PlacedCell::Text { text }
                    }
                    Cell::Change(b, a) => {
                        let before = fit_cell(b, mono, first, widths[i], font, max_lines);
                        let after = fit_cell(a, mono, true, widths[i], font, max_lines);
                        let inline_w = before.widths[0] + after.widths[0] + inline_arrow(cell_font(font, mono));
                        if before.lines.len() == 1 && after.lines.len() == 1 && inline_w <= widths[i] {
                            return PlacedCell::Change { mono, inline: true, before, after };
                        }
                        truncated |= !before.fits || !after.fits;
                        PlacedCell::Change { mono, inline: false, before, after }
                    }
                }
            })
            .collect();
        let lines = cells
            .iter()
            .map(|c| match c {
                PlacedCell::Text { text, .. } => text.lines.len(),
                PlacedCell::Change { inline, before, after, .. } => {
                    if *inline {
                        1
                    } else {
                        before.lines.len() + after.lines.len()
                    }
                }
            })
            .max()
            .unwrap_or(1);
        let h = lines as f64 * line_height + 2.0 * pad;
        placed.push(PlacedRow { row: r, change: changes.get(r).cloned().flatten(), cells, y, h });
        y += h + ROW_GAP;
    }
    let headers = columns
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let mut slot = Slot::named("tableHeader", widths[i] + COL_GAP / 2.0);
            slot.upper = Some(!cased_header(c));
            fit_text(c, &slot)
        })
        .collect();
    TableLayout { font, line_height, cols, headers, rows: placed, width: w, height: y - ROW_GAP, truncated, scale: 1.0 }
}

/// A table's rows as each state shows them (`stateRows`).
pub fn state_rows(table: &Table, states: &[SceneState]) -> Vec<Vec<TableRow>> {
    states
        .iter()
        .map(|st| {
            table
                .rows
                .iter()
                .enumerate()
                .map(|(r, row)| TableRow {
                    cells: (0..table.columns.len())
                        .map(|c| match st.values.get(&format!("x:{r}/{c}")) {
                            Some(Val::Text(t)) => Cell::Text(t.clone()),
                            Some(Val::Change(a, b)) => Cell::Change(a.clone(), b.clone()),
                            None => row.cells.get(c).cloned().unwrap_or(Cell::Text(String::new())),
                        })
                        .collect(),
                    ..row.clone()
                })
                .collect()
        })
        .collect()
}

/// Places a table whose cells steps change, once per state, so every state draws at one font with the same columns
/// (`layoutTableStates`).
pub fn layout_states(columns: &[String], states: &[Vec<TableRow>], width: f64, height: f64) -> Vec<TableLayout> {
    let every: Vec<TableRow> = states.iter().flatten().cloned().collect();
    let changes: Vec<Option<String>> = states[0].iter().map(row_change).collect();
    let all = |font: i32, lines: usize, w: f64| -> Vec<TableLayout> {
        states.iter().map(|rows| attempt(columns, rows, &every, &changes, w, font, lines)).collect()
    };
    for font in (MIN_FONT..=MAX_FONT).rev() {
        let result = all(font, 2, width);
        if result.iter().all(|r| r.height <= height && !r.truncated) {
            return result;
        }
    }
    let last = all(MIN_FONT, 3, width);
    let tallest = last.iter().map(|r| r.height).fold(0.0, f64::max);
    if tallest <= height {
        return last;
    }
    let scale = height / tallest;
    all(MIN_FONT, 3, width / scale).into_iter().map(|r| TableLayout { scale, ..r }).collect()
}

/// What `TableView` needs to draw a table at one moment of a step.
pub struct TableDraw<'a> {
    pub rows: &'a [TableRow],
    pub layout: &'a TableLayout,
    pub before: &'a TableLayout,
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

fn alpha(c: Color, a: u8) -> Color {
    c.alpha(a as f32 / 255.0)
}

/// Draws one cell's text in its box at (x, y) of `w` by `h`, centred vertically.
#[allow(clippy::too_many_arguments)]
fn draw_cell(
    dl: &mut DisplayList,
    cell: &PlacedCell,
    first: bool,
    removed: bool,
    layout: &TableLayout,
    ink: Option<Color>,
    x: f32,
    y: f32,
    h: f32,
) {
    let lh = layout.line_height as f32;
    let base_color = if removed {
        MUTED
    } else if first {
        TEXT
    } else {
        Color::css("#d5d9e3")
    };
    let struck_color = Color::css(STRUCK);
    let text_block = |dl: &mut DisplayList,
                      fit: &Fit,
                      color: Color,
                      top: f32,
                      left: f32,
                      decorate: bool,
                      deco: Color|
     -> f32 {
        let opts = TextOpts::new(color).line_height(LineHeight::Times(lh / fit.size as f32));
        draw_fit(dl, fit, left, top, opts);
        if decorate {
            let face: Face = fit.font.family.into();
            for (i, line) in fit.lines.iter().enumerate() {
                let w = drawn_width(fit, line, None);
                let base = top + i as f32 * lh + baseline_in(face, fit.size as f32, lh);
                strike(dl, Style::new(face, fit.font.weight as f32, fit.size as f32), left, base, w, deco, Some(2.5));
            }
        }
        fit.lines.len() as f32 * lh
    };
    match cell {
        PlacedCell::Text { text, .. } => {
            let bh = text.lines.len() as f32 * lh;
            text_block(dl, text, base_color, y + (h - bh) / 2.0, x, removed, DEL);
        }
        PlacedCell::Change { mono, inline, before, after } => {
            let after_color = ink.unwrap_or(ADD);
            if *inline {
                let top = y + (h - lh) / 2.0;
                let size = after.size as f32;
                let face = if *mono { Face::Mono } else { Face::Sans };
                let mut px = x;
                text_block(dl, before, struck_color, top, px, true, DEL);
                px += drawn_width(before, &before.lines[0], None) + 0.4 * size;
                let st = Style::new(face, 400.0, size);
                let base = top + baseline_in(face, size, lh);
                px += dl.text("\u{2192}", st, px, base, FAINT) + 0.4 * size;
                let deco = if removed { DEL } else { after_color };
                text_block(dl, after, after_color, top, px, removed, deco);
            } else {
                let bh = (before.lines.len() + after.lines.len()) as f32 * lh;
                let top = y + (h - bh) / 2.0;
                let used = text_block(dl, before, struck_color, top, x, true, DEL);
                text_block(dl, after, after_color, top + used, x, removed, DEL);
            }
        }
    }
}

/// A table's headers and rows at one moment of a step, placed at `left` and `top` (`TableView`).
pub fn draw_table(dl: &mut DisplayList, t: &TableDraw) {
    let layout = t.layout;
    dl.group(|dl| {
        dl.translate(t.left, t.top);
        if layout.scale != 1.0 {
            dl.scale_about(layout.scale as f32, 0.0, 0.0);
        }
        dl.group(|dl| {
            dl.fade(t.header_in as f32);
            for (i, header) in layout.headers.iter().enumerate() {
                let color = if (t.header_glow)(i) > 0.0 { ACCENT } else { FAINT };
                draw_fit(dl, header, layout.cols[i].0 as f32, 8.0, TextOpts::new(color).normal());
            }
        });
        for (i, placed) in layout.rows.iter().enumerate() {
            draw_row(dl, t, i, placed);
        }
    });
}

fn draw_row(dl: &mut DisplayList, t: &TableDraw, index: usize, placed: &PlacedRow) {
    let layout = t.layout;
    let s = t.s;
    let was = &t.before.rows[index];
    let at = (t.row_at)(index);
    let emphasis = (t.row_emphasis)(index);
    let shown = s.shown(&format!("r:{index}"));
    let land = spring(t.frame - at, FPS, Spring::damping(17.0).with_stiffness(120.0));
    let flash = interpolate(t.frame, &[at + 4.0, at + 10.0, at + 30.0], &[0.0, 1.0, 0.0], CLAMP);
    let tone_mark = placed.change.as_deref().and_then(change_tone);
    let removed = placed.change.as_deref() == Some("removed");
    let pad = js_round(layout.font * 0.5) as f32;
    let mix = s.tint(&format!("r:{index}"));
    let tinted = mix.main().map(str::to_string);
    let bg = match (&tone_mark, placed.change.as_deref()) {
        (Some(tm), Some(c)) if c != "modified" => tm.bg,
        _ => Color::rgba8(255, 255, 255, (0.025 + 0.05 * flash) as f32),
    };
    let ring = if let Some(t) = &tinted {
        (alpha(tone(t).0, 0xaa), 1.5)
    } else if let Some(tm) = &tone_mark {
        (alpha(tm.color, if placed.change.as_deref() == Some("modified") { 0x44 } else { 0x55 }), 1.0)
    } else {
        (BORDER, 1.0)
    };
    let y = (was.y + (placed.y - was.y) * s.t) as f32;
    let h = (was.h + (placed.h - was.h) * s.t) as f32;
    let w = layout.width as f32;
    let opacity = land * shown * emphasis.opacity * mix.dim_opacity() * if removed { 0.85 } else { 1.0 };
    dl.group(|dl| {
        dl.translate(0.0, y);
        dl.fade(opacity as f32);
        dl.translate(((1.0 - land * shown) * -40.0) as f32, 0.0);
        let sc = 1.0 + 0.008 * emphasis.glow as f32;
        if sc != 1.0 {
            dl.scale_about(sc, w / 2.0, h / 2.0);
        }
        let blur = (26.0 * flash + 34.0 * emphasis.glow) as f32;
        let mut style = BoxStyle::fill(bg).radius(14.0);
        if blur > 0.0 {
            style = style.shadow(Shadow::new(0.0, 0.0, blur, alpha(tone_mark.map_or(ACCENT, |m| m.color), 0x44)));
        }
        dl.rect(0.0, 0.0, w, h, style);
        dl.rect(0.0, 0.0, w, h, BoxStyle::empty().radius(14.0).border(ring.0, ring.1));
        for (name, amount) in &mix.tones {
            if *amount > 0.0 {
                dl.group(|dl| {
                    dl.fade(*amount as f32);
                    dl.rect(0.0, 0.0, w, h, BoxStyle::fill(tint_fill(name)).radius(14.0));
                });
            }
        }
        for i in 0..placed.cells.len() {
            let cell = s.tint(&format!("x:{index}/{i}"));
            for (name, amount) in &cell.tones {
                if *amount > 0.0 {
                    dl.group(|dl| {
                        dl.fade(*amount as f32);
                        let (cx, cw) = (layout.cols[i].0 - COL_GAP / 3.0, layout.cols[i].1 + 2.0 * COL_GAP / 3.0);
                        dl.rect(cx as f32, 4.0, cw as f32, h - 8.0, BoxStyle::fill(tint_fill(name)).radius(10.0));
                        dl.rect(
                            cx as f32,
                            4.0,
                            cw as f32,
                            h - 8.0,
                            BoxStyle::empty().radius(10.0).border(alpha(tone(name).0, 0xaa), 1.5),
                        );
                    });
                }
            }
        }
        if emphasis.glow > 0.0 {
            dl.rect(
                0.0,
                0.0,
                w,
                h,
                BoxStyle::fill(Color::rgba8(124, 140, 255, (0.1 * emphasis.glow) as f32)).radius(14.0),
            );
            dl.rect(
                0.0,
                0.0,
                w,
                h,
                BoxStyle::empty().radius(14.0).border(alpha(ACCENT, (emphasis.glow * 160.0).round() as u8), 2.0),
            );
        }
        if emphasis.bar > 0.0 {
            dl.group(|dl| {
                dl.fade(emphasis.bar as f32);
                dl.rect(0.0, 8.0, 5.0, h - 16.0, BoxStyle::fill(ACCENT).radius(3.0));
            });
        }
        if let Some(tm) = &tone_mark {
            let size = layout.font.max(20.0) as f32;
            let lh = line_metrics(Face::Mono, size).normal;
            dl.text(
                tm.marker,
                Style::mono(800.0, size),
                PAD_X as f32,
                (h - lh) / 2.0 + baseline_in(Face::Mono, size, lh),
                tm.color,
            );
        }
        for i in 0..placed.cells.len() {
            let g = (t.cell_emphasis)(index, i).glow as f32;
            if g > 0.0 {
                let (cx, cw) =
                    ((layout.cols[i].0 - COL_GAP / 3.0) as f32, (layout.cols[i].1 + 2.0 * COL_GAP / 3.0) as f32);
                dl.rect(
                    cx,
                    4.0,
                    cw,
                    h - 8.0,
                    BoxStyle::fill(Color::rgba8(124, 140, 255, 0.16 * g)).radius(10.0).shadow(Shadow::new(
                        0.0,
                        0.0,
                        28.0 * g,
                        ACCENT_GLOW,
                    )),
                );
                dl.rect(
                    cx,
                    4.0,
                    cw,
                    h - 8.0,
                    BoxStyle::empty().radius(10.0).border(alpha(ACCENT, (g * 200.0).round() as u8), 2.0),
                );
            }
        }
        for (i, cell) in placed.cells.iter().enumerate() {
            let key = format!("x:{index}/{i}");
            let changed = s.value_changed(&key);
            let own = s.tint(&key);
            let toned = own.main().map(str::to_string).or_else(|| tinted.clone());
            let ink = toned.as_deref().map(|n| tone(n).0);
            let (cx, ch) = (layout.cols[i].0 as f32, h - 2.0 * pad);
            let at = |dl: &mut DisplayList, c: &PlacedCell, opacity: f64, shift: f32| {
                dl.group(|dl| {
                    dl.fade((opacity * (1.0 - 0.5 * own.dim)) as f32);
                    dl.translate(0.0, shift);
                    draw_cell(dl, c, i == 0, removed, layout, ink, cx, pad, ch);
                });
            };
            if changed {
                if s.t < 1.0 {
                    at(dl, &was.cells[i], 1.0 - s.t, (-14.0 * s.t) as f32);
                }
                at(dl, cell, s.t, (14.0 * (1.0 - s.t)) as f32);
            } else {
                at(dl, cell, 1.0, 0.0);
            }
        }
        let marks = Marks {
            badge: t.rows.get(placed.row).and_then(|r| r.badge.clone()),
            tone: t.rows.get(placed.row).and_then(|r| r.tone.clone()),
            ..Default::default()
        };
        let badges = badges_of(&marks, false);
        if !badges.is_empty() {
            let ps = pills(&badges, ROW_BADGE, None);
            let total = row_width(&ps, 6.0);
            let ph = ps[0].0.h;
            let mut x = w - 18.0 - total;
            for (p, c) in &ps {
                draw_pill(dl, p, *c, x, (h - ph) / 2.0, 1.0);
                x += p.w + 6.0;
            }
        }
        let _ = width; // text widths come from the fits
    });
}
