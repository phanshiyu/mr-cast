//! The table scene: a port of src/components/DataTable.tsx and src/utils/tableLayout.ts. Rows land one after
//! another, steps show, hide, set and tint cells, and focus lights rows, columns and cells.
//!
//! The scene's own pen marks, ink and camera are not drawn yet: see the TODOs.

mod layout;

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::callout::HeaderCallout;
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, drawn_width};
use crate::chrome::shell::{Aside, Shell};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Shadow};
use crate::states::{
    self as state, BoundModel, FnModel as Model, SceneState, SetEntry, StateFrame, items as list, walk_states,
};
use crate::steps::{Emphasis, Spotlight, spotlight_starts};
use crate::steps::{FocusSpotlight as Focus, brighter};
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::Fit;
use crate::theme::{ACCENT, ACCENT_GLOW, ADD, ADD_BG, BORDER, DEL, DEL_BG, FAINT, MUTED, TEXT};
use crate::timing::{FPS, build_frames};
use layout::{COL_GAP, Cell, Change, Layout, PAD_X, Placed, PlacedRow, ROW_BADGE, Row};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

const START: f64 = 10.0;
/// Every row has started landing by this frame, so all have landed by the end of the build.
const ROWS_END: f64 = 26.0;
const STRUCK: &str = "#c98a93";

#[derive(Deserialize)]
struct RowJson {
    #[serde(default)]
    cells: Vec<Value>,
    change: Option<String>,
    badge: Option<String>,
    tone: Option<String>,
}

#[derive(Deserialize)]
struct TableScene {
    columns: Vec<String>,
    rows: Vec<RowJson>,
    #[serde(default)]
    highlight: Vec<usize>,
    #[serde(default)]
    steps: Vec<Value>,
}

// --- The state model (shared/state-steps.mjs `table`, shared/targets.mjs `table`). ---

fn initial(scene: &Value) -> SceneState {
    let columns = list(scene.get("columns"));
    let mut s = SceneState::default();
    for (i, r) in list(scene.get("rows")).iter().enumerate() {
        for c in 0..columns.len() {
            let cell = list(r.get("cells")).get(c).cloned().unwrap_or(Value::String(String::new()));
            s.values.insert(format!("x:{i}/{c}"), cell);
        }
        if r.get("hidden") == Some(&Value::Bool(true)) {
            s.hidden.insert(format!("r:{i}"));
        }
    }
    s
}

pub fn resolve(scene: &Value, r: &Value) -> Option<Vec<String>> {
    let columns = list(scene.get("columns"));
    let rows = list(scene.get("rows")).len();
    if let Some(i) = crate::targets::index_ref(r, rows) {
        return Some(vec![format!("r:{i}")]);
    }
    let r = r.as_str()?;
    let col_of = |name: &str| columns.iter().position(|c| c.as_str() == Some(name.trim()));
    if let Some(name) = r.strip_prefix("col:") {
        return col_of(name).map(|c| vec![format!("c:{c}")]);
    }
    let at = r.rfind('@').filter(|&a| a > 0)?;
    let col = col_of(&r[..at])?;
    let digits = r[at + 1..].trim();
    let row: f64 = digits.parse().ok().filter(|_| !digits.is_empty())?;
    (row.fract() == 0.0 && row >= 0.0 && (row as usize) < rows).then(|| vec![format!("x:{}/{col}", row as usize)])
}

fn set(scene: &Value, r: &str, value: &Value) -> Option<Vec<SetEntry>> {
    let key = state::one_key(&BoundModel { model: &MODEL, scene }, &Value::String(r.into()), &["x:"])?;
    (value.is_string() || state::is_change(value)).then(|| vec![(key, value.clone())])
}

static MODEL: Model =
    Model { initial, resolve, set, show: Some(&["r:"]), tint: Some(&["r:", "x:"]), sortable: |_| false, trace: None };

// --- Tones of a change. ---

fn change_tone(change: Change) -> (Color, Color, &'static str) {
    match change {
        Change::Added => (ADD, ADD_BG, "+"),
        Change::Removed => (DEL, DEL_BG, "\u{2212}"),
        Change::Modified => (ACCENT, crate::theme::ACCENT_SOFT, "~"),
    }
}

fn hex_alpha(c: Color, a: u32) -> Color {
    c.alpha(a.min(255) as f32 / 255.0)
}

fn tone_color(name: &str) -> Color {
    crate::theme::tone(name).0
}

// --- The view. ---

struct TableView {
    shell: Shell,
    columns: Vec<String>,
    highlight: Vec<usize>,
    has_steps: bool,
    states: Vec<SceneState>,
    layouts: Vec<Layout>,
    targets: HashMap<String, Vec<usize>>,
    callout: Option<HeaderCallout>,
    legend: Vec<Change>,
    box_h: f64,
}

fn parse_change(s: &str) -> Option<Change> {
    match s {
        "added" => Some(Change::Added),
        "removed" => Some(Change::Removed),
        "modified" => Some(Change::Modified),
        _ => None,
    }
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: TableScene = parse(input)?;
    if scene.columns.is_empty() {
        return Err("a table without columns".into());
    }
    let shell = Shell::new(input.scene);
    let callout = HeaderCallout::new(input.scene);
    let (bw, bh) = crate::theme::content_box(shell.title.is_some() || callout.is_some());
    let box_h = match &shell.title {
        Some(t) => bh - (t.lines.len() as f64 - 1.0) * crate::timing::js_round(t.size * t.line_height),
        None => bh,
    };
    let states = walk_states(&BoundModel { model: &MODEL, scene: input.scene }, input.scene);
    let rows: Vec<Row> = scene
        .rows
        .iter()
        .map(|r| Row {
            cells: (0..scene.columns.len()).map(|c| Cell::from_json(r.cells.get(c))).collect(),
            change: r.change.as_deref().and_then(parse_change),
            badge: r.badge.clone(),
            tone: r.tone.clone(),
        })
        .collect();
    let by_state = layout::state_rows(&scene.columns, &rows, &states);
    let layouts = layout::layout_table_states(&scene.columns, &by_state, bw, box_h);
    let mut legend = Vec::new();
    for c in [Change::Added, Change::Removed, Change::Modified] {
        if layouts[0].rows.iter().any(|r| r.change == Some(c)) {
            legend.push(c);
        }
    }
    Ok(Box::new(TableView {
        shell,
        columns: scene.columns,
        highlight: scene.highlight,
        has_steps: !scene.steps.is_empty(),
        targets: crate::targets::target_steps(input.scene),
        states,
        layouts,
        callout,
        legend,

        box_h,
    }))
}

/// The words of a change in the legend (`CHANGE_WORD`).
fn change_word(c: Change) -> &'static str {
    match c {
        Change::Added => "new",
        Change::Removed => "removed",
        Change::Modified => "changed",
    }
}

const LEGEND_BOX: f32 = 26.0;
const LEGEND_GAP: f32 = 22.0;
const LEGEND_PAD_BOTTOM: f32 = 6.0;

fn legend_width(used: &[Change]) -> f32 {
    let st = Style::sans(400.0, 19.0);
    used.iter().map(|&c| LEGEND_BOX + 8.0 + width(change_word(c), st)).sum::<f32>()
        + LEGEND_GAP * used.len().saturating_sub(1) as f32
}

fn draw_legend(dl: &mut DisplayList, used: &[Change], x: f32, y: f32) {
    let st = Style::sans(400.0, 19.0);
    let lh = line_metrics(Face::Sans, 19.0).normal;
    let mut x = x;
    for &c in used {
        let (color, bg, marker) = change_tone(c);
        dl.rect(x, y, LEGEND_BOX, LEGEND_BOX, BoxStyle::fill(bg).radius(7.0).border(hex_alpha(color, 0x88), 1.0));
        let ms = Style::mono(800.0, 19.0);
        let mlh = line_metrics(Face::Mono, 19.0).normal;
        let mw = width(marker, ms);
        dl.text(
            marker,
            ms,
            x + (LEGEND_BOX - mw) / 2.0,
            y + (LEGEND_BOX - mlh) / 2.0 + baseline_in(Face::Mono, 19.0, mlh),
            color,
        );
        let word = change_word(c);
        let tx = x + LEGEND_BOX + 8.0;
        dl.text(word, st, tx, y + (LEGEND_BOX - lh) / 2.0 + baseline_in(Face::Sans, 19.0, lh), MUTED);
        x = tx + width(word, st) + LEGEND_GAP;
    }
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

/// A row's own badge pill, centred on the row at `right` from its right end (`RowBadges`).
fn draw_badge(dl: &mut DisplayList, text: &str, color: Color, row_w: f32, row_h: f32, right: f32) {
    let size = ROW_BADGE as f32;
    let st = Style::sans(800.0, size).spacing(1.0);
    let upper = text.to_uppercase();
    let (px, py) = ((size * 0.75).floor(), (size / 4.0).floor());
    let tw = width(&upper, st);
    let lh = line_metrics(Face::Sans, size).normal;
    let (w, h) = (tw + 2.0 * px, lh + 2.0 * py);
    let x = row_w - right - w;
    let y = (row_h - h) / 2.0;
    dl.rect(x, y, w, h, BoxStyle::fill(color).radius(999.0));
    dl.text(&upper, st, x + px, y + py + baseline_in(Face::Sans, size, lh), Color::css("#0b0d18"));
}

struct Ctx<'a> {
    frame: f64,
    sf: StateFrame<'a>,
    focus: Focus<'a>,
    walked: Vec<usize>,
    spot: Spotlight,
    has_steps: bool,
    columns: usize,
}

impl Ctx<'_> {
    fn cell_emphasis(&self, row: usize, col: usize) -> Emphasis {
        brighter(self.focus.emphasis(&format!("c:{col}")), self.focus.emphasis(&format!("x:{row}/{col}")))
    }

    fn row_emphasis(&self, row: usize) -> Emphasis {
        if !self.has_steps {
            return match self.walked.iter().position(|&r| r == row) {
                Some(k) => self.spot.emphasis(&[k]),
                None => self.spot.emphasis(&[]),
            };
        }
        let own = self.focus.emphasis(&format!("r:{row}"));
        let opacity = (0..self.columns).map(|c| self.cell_emphasis(row, c).opacity).fold(own.opacity, f64::max);
        Emphasis { opacity, ..own }
    }
}

impl TableView {
    fn draw_row(&self, dl: &mut DisplayList, ctx: &Ctx, layout: &Layout, was: &PlacedRow, index: usize, at: f64) {
        let s = &ctx.sf;
        let placed = &layout.rows[index];
        let shown = s.shown(&format!("r:{index}"));
        let land = spring(ctx.frame - at, FPS, Spring::damping(17.0).with_stiffness(120.0));
        let flash = interpolate(ctx.frame, &[at + 4.0, at + 10.0, at + 30.0], &[0.0, 1.0, 0.0], CLAMP);
        let emphasis = ctx.row_emphasis(index);
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
        let t = s.t;
        let y = (was.y + (placed.y - was.y) * t) as f32;
        let h = (was.h + (placed.h - was.h) * t) as f32;
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
            let g = ctx.cell_emphasis(index, i).glow as f32;
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
                if t < 1.0 {
                    at_cell(dl, &was.cells[i], 1.0 - t, -14.0 * t);
                }
                at_cell(dl, cell, t, 14.0 * (1.0 - t));
            } else {
                at_cell(dl, cell, 1.0, 0.0);
            }
        }
        if let Some(badge) = placed.row.badge.as_deref().filter(|b| !b.is_empty()) {
            let color = tone_color(placed.row.tone.as_deref().unwrap_or("neutral"));
            draw_badge(dl, badge, color, w, h, 18.0);
        }
        if layer {
            dl.pop_layer();
        }
        dl.restore();
    }
}

impl SceneView for TableView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let sf = StateFrame::at(&self.states, f.segments, frame);
        let idx = |s: &SceneState| self.states.iter().position(|x| std::ptr::eq(x, s)).unwrap_or(0);
        let (layout, before) = (&self.layouts[idx(sf.now)], &self.layouts[idx(sf.before)]);
        let n = layout.rows.len();
        let row_stagger = 5f64.min((ROWS_END - START - 6.0) / ((n as f64) - 1.0).max(1.0));
        let row_at = |i: usize| START + 6.0 + i as f64 * row_stagger;
        let walked: Vec<usize> = if !self.highlight.is_empty() {
            self.highlight.clone()
        } else {
            layout.rows.iter().enumerate().filter(|(_, r)| r.change.is_some()).map(|(i, _)| i).collect()
        };
        let starts = spotlight_starts(f.segments, walked.len(), build_frames("table"));
        let ctx = Ctx {
            frame,
            focus: Focus::borrowed(&self.targets, f.segments, frame),
            spot: Spotlight::new(frame, &starts),
            walked,
            has_steps: self.has_steps,
            columns: self.columns.len(),
            sf,
        };
        let header_in = interpolate(frame, &[START, START + 10.0], &[0.0, 1.0], CLAMP);
        let top = (self.box_h - layout.height * layout.scale).max(0.0) * 0.3;

        let legend_w = legend_width(&self.legend);
        let has_legend = !self.legend.is_empty();
        let legend_h = LEGEND_BOX + LEGEND_PAD_BOTTOM;
        let height = if has_legend { legend_h } else { 0.0 }.max(self.callout.as_ref().map_or(0.0, |c| c.height));
        let draw_aside = |dl: &mut DisplayList, right: f32, top: f32| {
            let mut right = right;
            if let Some(c) = &self.callout {
                c.draw(dl, right, top + height - c.height, &ctx.sf);
                right -= c.width + 32.0;
            }
            if has_legend {
                draw_legend(dl, &self.legend, right - legend_w, top + height - legend_h);
            }
        };
        let aside = (has_legend || self.callout.is_some()).then_some(Aside { height, draw: &draw_aside });
        self.shell.draw(dl, frame, f.duration, aside, |dl, _bx| {
            dl.save();
            dl.translate(0.0, top as f32);
            dl.scale_about(layout.scale as f32, 0.0, 0.0);
            // The headers.
            dl.group(|dl| {
                dl.fade(header_in as f32);
                for (i, header) in layout.headers.iter().enumerate() {
                    let lit = ctx.focus.emphasis(&format!("c:{i}")).glow > 0.0;
                    draw_fit(
                        dl,
                        header,
                        layout.cols[i].0 as f32,
                        8.0,
                        TextOpts::new(if lit { ACCENT } else { FAINT }).normal(),
                    );
                }
            });
            for i in 0..n {
                self.draw_row(dl, &ctx, layout, &before.rows[i], i, row_at(i));
            }
            // TODO(marks): PenMarks over the table.
            // TODO(ink): Ink over the table.
            // TODO(camera): the scene's `camera` zoom around the content.
            dl.restore();
        });
    }
}
