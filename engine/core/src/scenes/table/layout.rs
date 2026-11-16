//! Where a table's columns, headers and rows go: a port of src/utils/tableLayout.ts.

use crate::marks::LayoutBoxes;
use crate::marks::geometry::Bx;
use crate::markup::{parse_markup, plain_text};
use crate::textfit::{Fit, Slot, fit_text, fit_text_at};
use crate::timing::js_round;
use fancy_regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

/// Average advance per em, rounded up so estimated line lengths never overflow.
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
/// Width of one header character: 17px uppercase with 2.5px letter spacing.
const HEADER_CHAR_W: f64 = 13.0;
/// Font size of a row's own badges, drawn at its right end.
pub const ROW_BADGE: f64 = 13.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Change {
    Added,
    Removed,
    Modified,
}

/// A table cell: text, or an old value struck beside a new one.
#[derive(Clone, Debug, PartialEq)]
pub enum Cell {
    Text(String),
    Change { before: String, after: String },
}

impl Cell {
    /// A cell from its JSON: a string, `{ before, after }`, or empty.
    pub fn from_json(v: Option<&Value>) -> Cell {
        match v {
            Some(Value::String(s)) => Cell::Text(s.clone()),
            Some(Value::Object(o)) => {
                match (o.get("before").and_then(Value::as_str), o.get("after").and_then(Value::as_str)) {
                    (Some(b), Some(a)) => Cell::Change { before: b.into(), after: a.into() },
                    _ => Cell::Text(String::new()),
                }
            }
            Some(Value::Number(n)) => Cell::Text(n.to_string()),
            _ => Cell::Text(String::new()),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Row {
    pub cells: Vec<Cell>,
    pub change: Option<Change>,
    pub badge: Option<String>,
    pub tone: Option<String>,
}

pub enum Placed {
    Text {
        text: Fit,
    },
    /// `inline` puts the struck value and the new one on one line; otherwise the new value goes under the old.
    Change {
        mono: bool,
        inline: bool,
        before: Fit,
        after: Fit,
    },
}

pub struct PlacedRow {
    pub row: Row,
    pub change: Option<Change>,
    pub cells: Vec<Placed>,
    pub y: f64,
    pub h: f64,
}

pub struct Layout {
    pub font: i32,
    pub line_height: f64,
    /// Left edge and width of each column, in layout pixels from the row's left edge.
    pub cols: Vec<(f64, f64)>,
    pub headers: Vec<Fit>,
    pub rows: Vec<PlacedRow>,
    pub width: f64,
    pub height: f64,
    pub truncated: bool,
    /// Below 1 when even the smallest font overflows: the table draws at `width / scale` and shrinks to fit.
    pub scale: f64,
}

impl Row {
    /// A row from its JSON, with a cell for each of `columns`.
    pub fn from_json(v: &Value, columns: usize) -> Row {
        let cells = v.get("cells").and_then(Value::as_array);
        let text = |k: &str| match v.get(k) {
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Number(n)) => Some(n.to_string()),
            _ => None,
        };
        Row {
            cells: (0..columns).map(|c| Cell::from_json(cells.and_then(|cs| cs.get(c)))).collect(),
            change: v.get("change").and_then(Value::as_str).and_then(Change::parse),
            badge: text("badge"),
            tone: v.get("tone").and_then(Value::as_str).map(str::to_string),
        }
    }
}

impl Change {
    pub fn parse(s: &str) -> Option<Change> {
        match s {
            "added" => Some(Change::Added),
            "removed" => Some(Change::Removed),
            "modified" => Some(Change::Modified),
            _ => None,
        }
    }
}

/// A table's columns and rows from its JSON (`{ columns, rows }`).
pub fn table_of(v: &Value) -> (Vec<String>, Vec<Row>) {
    let columns: Vec<String> = v
        .get("columns")
        .and_then(Value::as_array)
        .map(|cs| cs.iter().map(|c| c.as_str().unwrap_or("").to_string()).collect())
        .unwrap_or_default();
    let rows = v
        .get("rows")
        .and_then(Value::as_array)
        .map(|rs| rs.iter().map(|r| Row::from_json(r, columns.len())).collect())
        .unwrap_or_default();
    (columns, rows)
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("table regex"))
}

fn has_markup(src: &str) -> bool {
    parse_markup(src).iter().any(|r| r.styled()) || plain_text(src) != src
}

/// Identifiers, paths, numbers with units and the like read as code, so they render in mono.
fn is_code_like(text: &str) -> bool {
    static MARKS: OnceLock<Regex> = OnceLock::new();
    static MATH: OnceLock<Regex> = OnceLock::new();
    static PERCENT: OnceLock<Regex> = OnceLock::new();
    let t = text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    !t.is_empty()
        && !t.chars().any(char::is_whitespace)
        && re(&MARKS, r"[_./:=()\[\]{}<>@#$0-9]|[a-z][A-Z]").is_match(text).unwrap_or(false)
        && !re(&MATH, r"^[OΘΩ]\(|[¹²³\u{2070}-\u{209F}×÷\u{2200}-\u{22FF}]").is_match(text).unwrap_or(false)
        && !re(&PERCENT, r"^[~≈<>+\-−±]?[0-9][0-9,]*(\.[0-9]+)?%$").is_match(t).unwrap_or(false)
        && !has_markup(text)
}

/// A header is upper-cased unless it holds a formula or code, whose case means something.
fn cased_header(text: &str) -> bool {
    static CASED: OnceLock<Regex> = OnceLock::new();
    re(&CASED, r"[\^_=`\[\]{}<>\\|*+]|\w\(|[a-z][A-Z]").is_match(text).unwrap_or(false)
}

fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn cell_chars(cell: &Cell) -> usize {
    match cell {
        Cell::Text(s) => js_len(s),
        Cell::Change { before, after } => js_len(before) + js_len(after) + 3 + 2,
    }
}

fn cell_font(font: i32, mono: bool) -> f64 {
    if mono { js_round(font as f64 * 0.92) } else { font as f64 }
}

pub fn cell_mono(cell: &Cell) -> bool {
    match cell {
        Cell::Text(s) => is_code_like(s),
        Cell::Change { before, after } => is_code_like(before) && is_code_like(after),
    }
}

fn char_width(font: i32, mono: bool) -> f64 {
    cell_font(font, mono) * if mono { MONO_ADVANCE } else { SANS_ADVANCE }
}

pub fn row_change(row: &Row) -> Option<Change> {
    row.change.or_else(|| row.cells.iter().any(|c| matches!(c, Cell::Change { .. })).then_some(Change::Modified))
}

/// Room to keep free at the right end of rows for their own badges (`rowBadgeRoom`).
fn row_badge_room(rows: &[Row], size: f64) -> f64 {
    rows.iter()
        .filter_map(|r| r.badge.as_deref().filter(|b| !b.is_empty()))
        .map(|b| (js_len(b) as f64 * (size * 0.76 + 1.0) + 2.0 * (size * 0.75).floor() + 2.0).ceil() + 24.0)
        .fold(0.0, f64::max)
}

/// Splits the text width between columns (`columnWidths`).
fn column_widths(columns: &[String], rows: &[Row], text_w: f64, font: i32) -> Vec<f64> {
    let need: Vec<f64> = columns
        .iter()
        .enumerate()
        .map(|(i, header)| {
            let head = js_len(header) as f64 * HEADER_CHAR_W + 8.0;
            rows.iter()
                .filter_map(|r| r.cells.get(i))
                .map(|c| cell_chars(c) as f64 * char_width(font, cell_mono(c)))
                .fold(head.max(font as f64 * 3.0), f64::max)
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

fn fit_cell(text: &str, mono: bool, first: bool, width: f64, font: i32, lines: usize) -> Fit {
    let mut slot = Slot::named(if mono { "tableCode" } else { "tableCell" }, width);
    slot.lines = lines;
    slot.weight = if first { 650.0 } else { 450.0 };
    fit_text_at(text, &slot, cell_font(font, mono))
}

/// Room an inline change takes besides its two values: the gaps around the arrow, and the arrow.
pub fn inline_arrow(font: f64) -> f64 {
    2.0 * 0.4 * font + 0.85 * font
}

struct Sizing<'a> {
    every: &'a [Row],
    changes: &'a [Option<Change>],
}

fn attempt(columns: &[String], rows: &[Row], width: f64, font: i32, max_lines: usize, sizing: &Sizing) -> Layout {
    let line_height = js_round(font as f64 * LINE_HEIGHT);
    let pad = js_round(font as f64 * 0.5);
    let text_w =
        width - 2.0 * PAD_X - MARKER_W - (columns.len() as f64 - 1.0) * COL_GAP - row_badge_room(rows, ROW_BADGE);
    let widths = column_widths(columns, sizing.every, text_w, font);
    let mut cols = Vec::new();
    let mut x = PAD_X + MARKER_W;
    for &w in &widths {
        cols.push((x, w));
        x += w + COL_GAP;
    }
    let mut truncated = false;
    let mut y = HEADER_H;
    let mut placed = Vec::new();
    for (r, row) in rows.iter().enumerate() {
        let cells: Vec<Placed> = (0..columns.len())
            .map(|i| {
                let cell = row.cells.get(i).cloned().unwrap_or(Cell::Text(String::new()));
                let mono = cell_mono(&cell);
                let first = i == 0;
                match &cell {
                    Cell::Text(s) => {
                        let text = fit_cell(s.trim(), mono, first, widths[i], font, max_lines);
                        truncated |= !text.fits;
                        Placed::Text { text }
                    }
                    Cell::Change { before, after } => {
                        let before = fit_cell(before, mono, first, widths[i], font, max_lines);
                        let after = fit_cell(after, mono, true, widths[i], font, max_lines);
                        let inline_w = before.widths[0] + after.widths[0] + inline_arrow(cell_font(font, mono));
                        if before.lines.len() == 1 && after.lines.len() == 1 && inline_w <= widths[i] {
                            return Placed::Change { mono, inline: true, before, after };
                        }
                        truncated |= !before.fits || !after.fits;
                        Placed::Change { mono, inline: false, before, after }
                    }
                }
            })
            .collect();
        let lines = cells
            .iter()
            .map(|c| match c {
                Placed::Text { text, .. } => text.lines.len(),
                Placed::Change { inline: true, .. } => 1,
                Placed::Change { before, after, .. } => before.lines.len() + after.lines.len(),
            })
            .max()
            .unwrap_or(0);
        let h = lines as f64 * line_height + 2.0 * pad;
        placed.push(PlacedRow { row: row.clone(), change: sizing.changes[r], cells, y, h });
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
    Layout { font, line_height, cols, headers, rows: placed, width, height: y - ROW_GAP, truncated, scale: 1.0 }
}

/// Places a table whose cells steps change, once per state, so every state draws at one font with the same
/// columns (`layoutTableStates`).
pub fn layout_table_states(columns: &[String], states: &[Vec<Row>], width: f64, height: f64) -> Vec<Layout> {
    let every: Vec<Row> = states.iter().flatten().cloned().collect();
    let changes: Vec<Option<Change>> = states[0].iter().map(row_change).collect();
    let sizing = Sizing { every: &every, changes: &changes };
    let all = |font: i32, lines: usize, w: f64| -> Vec<Layout> {
        states.iter().map(|rows| attempt(columns, rows, w, font, lines, &sizing)).collect()
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
    all(MIN_FONT, 3, width / scale).into_iter().map(|r| Layout { scale, ..r }).collect()
}

/// A table's rows as each state shows them (`stateRows`).
pub fn state_rows(columns: &[String], rows: &[Row], states: &[crate::states::SceneState]) -> Vec<Vec<Row>> {
    states
        .iter()
        .map(|state| {
            rows.iter()
                .enumerate()
                .map(|(r, row)| Row {
                    cells: (0..columns.len())
                        .map(|c| match state.values.get(&format!("x:{r}/{c}")) {
                            Some(v) => Cell::from_json(Some(v)),
                            None => row.cells.get(c).cloned().unwrap_or(Cell::Text(String::new())),
                        })
                        .collect(),
                    ..row.clone()
                })
                .collect()
        })
        .collect()
}

/// How wide a placed cell's text runs and how many lines it takes (`cellExtent`).
fn cell_extent(cell: &Placed, font: i32) -> (f64, usize) {
    match cell {
        Placed::Text { text } => (text.width, text.lines.len()),
        Placed::Change { mono, inline: true, before, after } => {
            (before.width + after.width + inline_arrow(cell_font(font, *mono)), 1)
        }
        Placed::Change { before, after, .. } => (before.width.max(after.width), before.lines.len() + after.lines.len()),
    }
}

/// The box of each item a step can focus, by its key in shared/targets.mjs, in layout units: a row, a column from its
/// header down, and the text of one cell. A note keeps off the headers and the text of every cell (`tableBoxes`).
pub fn table_boxes(layout: &Layout) -> LayoutBoxes {
    let mut out = LayoutBoxes::default();
    let bottom = layout.rows.last().map_or(HEADER_H, |r| r.y + r.h);
    for (c, &(x, w)) in layout.cols.iter().enumerate() {
        out.add(format!("c:{c}"), Bx::new(x - 10.0, 4.0, w + 20.0, bottom - 4.0));
    }
    let mut cells = Vec::new();
    for (r, row) in layout.rows.iter().enumerate() {
        out.add(format!("r:{r}"), Bx::new(0.0, row.y, layout.width, row.h));
        for (c, cell) in row.cells.iter().enumerate() {
            let (width, lines) = cell_extent(cell, layout.font);
            let height = lines as f64 * layout.line_height;
            let b = Bx::new(
                layout.cols[c].0,
                row.y + (row.h - height) / 2.0,
                width.min(layout.cols[c].1).max(24.0),
                height,
            );
            out.add(format!("x:{r}/{c}"), b);
            cells.push(b);
        }
    }
    let mut obstacles = vec![Bx::new(0.0, 0.0, layout.width, HEADER_H)];
    obstacles.extend(cells);
    out.obstacles = Some(obstacles);
    out
}
