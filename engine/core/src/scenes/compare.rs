//! The compare scene: two sides in frames, row by row, with an arrow or "=" between the sides of each row, verdict
//! marks, and an options mode that labels the side taken. A port of src/components/Compare.tsx,
//! src/utils/compareLayout.ts and shared/compare.mjs.
//!
//! Not ported yet: images (a cell's picture draws the placeholder Remotion draws without a copy of it), pen marks
//! and the camera.

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::callout::header_box;
use crate::chrome::fittext::{TextOpts, draw_fit, drawn_width};
use crate::chrome::shell::Shell;
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, PathBuilder, Shadow, Stroke};
use crate::icons;
use crate::marks::geometry::Bx;
use crate::marks::{LayoutBoxes, MarkTargets, Pen, Refs, Stage};
use crate::model::{Hunk, LineType, Props, TokenLine};
use crate::steps::{Emphasis, Spotlight, step_spring};
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::{Fit, Slot, fit_lines, fit_text, fit_text_at};
use crate::theme::{
    self, ACCENT, ACCENT_GLOW, BORDER, BORDER_STRONG, FAINT, MUTED, RAISED, SURFACE, TEXT, content_box,
};
use crate::timing::{FPS, STEP_SETTLE_FRAMES, build_frames, index_range, js_round};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

const PANEL_START: f64 = 4.0;
const ROWS_START: f64 = 18.0;
/// Frames from a row's start until both its cells and the cue between them are in.
const ROW_FRAMES: f64 = 12.0;
/// Frames between the rows one step shows.
const STEP_STAGGER: f64 = 3.0;
/// A row that is the same on both sides recedes, so the rows that differ carry the eye.
const SAME_OPACITY: f64 = 0.5;
/// A row's label draws softer until its row is shown.
const UNSHOWN_LABEL: f64 = 0.55;
/// A side or cell that was not taken draws quieter.
const NOT_TAKEN_OPACITY: f64 = 0.55;

/// Height of a side's title band, above its first row.
const HEADER_H: f64 = 66.0;
const PANEL_PAD: f64 = 26.0;
const GUTTER: f64 = 88.0;
const HUNK_GUTTER: f64 = 64.0;
const OPTIONS_GUTTER: f64 = 40.0;
const TAG_W: f64 = 150.0;
const TAG_H: f64 = 32.0;
const LABEL_GAP: f64 = 30.0;
const LABEL_MIN: f64 = 200.0;
const LABEL_MAX: f64 = 360.0;
const VERDICT_W: f64 = 44.0;
/// Padding around a snippet inside its code block.
const CODE_PAD: f64 = 12.0;
const HUNK_EDGE: f64 = 10.0;
const BOTTOM_PAD: f64 = 14.0;
const MAX_FONT: i32 = 30;
const MIN_FONT: i32 = 18;

#[derive(Deserialize, Default)]
struct SideSrc {
    title: Option<Value>,
    tone: Option<String>,
    #[serde(default)]
    chosen: Option<Value>,
}

#[derive(Deserialize)]
struct RowSrc {
    #[serde(default)]
    label: Option<Value>,
    #[serde(default)]
    cells: Vec<Value>,
    #[serde(default)]
    same: Option<bool>,
    #[serde(default)]
    verdict: Option<Vec<Option<String>>>,
    #[serde(default)]
    chosen: Option<i64>,
}

#[derive(Deserialize)]
struct CompareScene {
    title: Option<String>,
    #[serde(default)]
    sides: Vec<SideSrc>,
    mode: Option<String>,
    alternative: Option<String>,
    #[serde(default)]
    rows: Vec<RowSrc>,
    #[serde(default)]
    steps: Vec<Value>,
}

// --- shared/compare.mjs ---

fn titles(scene: &CompareScene) -> [String; 2] {
    let one = |i: usize, fallback: &str| {
        scene.sides.get(i).and_then(|s| s.title.as_ref()).and_then(Value::as_str).unwrap_or(fallback).to_string()
    };
    [one(0, "Before"), one(1, "After")]
}

fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn cell_key(cell: &Value) -> String {
    if let Some(s) = cell.as_str() {
        return s.trim().to_string();
    }
    if let Some(i) = cell.get("image") {
        return format!("image\n{}", js_string(i));
    }
    if let Some(h) = cell.get("hunk") {
        let side = cell.get("side").map(js_string).unwrap_or_default();
        let lines = cell.get("lines").map(js_string).unwrap_or_default();
        return format!("hunk\n{}\n{side}\n{lines}", js_string(h));
    }
    let lang = cell.get("lang").map(js_string).unwrap_or_default();
    let code = cell.get("code").map(js_string).unwrap_or_default();
    format!("{lang}\n{code}")
}

/// Whether a row reads the same on both sides: its own `same`, or else whether its two cells are equal.
fn row_same(row: &RowSrc) -> bool {
    row.same.unwrap_or(row.cells.len() == 2 && cell_key(&row.cells[0]) == cell_key(&row.cells[1]))
}

fn is_hunk_cell(cell: &Value) -> bool {
    cell.is_object() && cell.get("hunk").is_some()
}

/// A line range written as 5 or "4-6", as (first, last).
fn line_range(value: &Value) -> Option<(i64, i64)> {
    let text = js_string(value);
    let text = text.trim();
    let (a, b) = match text.split_once('-') {
        Some((a, b)) => (a.trim_end(), Some(b.trim_start())),
        None => (text, None),
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit());
    if !digits(a) || b.is_some_and(|b| !digits(b)) {
        return None;
    }
    let first: i64 = a.parse().ok()?;
    let last: i64 = b.map_or(Some(first), |b| b.parse().ok())?;
    (first >= 1 && last >= first).then_some((first, last))
}

struct HunkRead {
    code: String,
    lang: String,
    caption: String,
}

/// The code a `{ hunk, side, lines }` cell shows, read from hunks.json, or why it cannot be.
fn resolve_hunk_cell(cell: &Value, props: &Props) -> Result<HunkRead, String> {
    let id = cell.get("hunk").map(js_string).unwrap_or_default();
    let Some(hunk) = props.hunks.get(&id) else {
        return Err(format!("no hunk \"{id}\" in hunks.json; use an id from the hunk index"));
    };
    let side = cell.get("side").and_then(Value::as_str).unwrap_or("");
    if side != "old" && side != "new" {
        return Err("side must be \"old\" or \"new\"".into());
    }
    let lines_v = cell.get("lines").cloned().unwrap_or(Value::Null);
    let Some(range) = line_range(&lines_v) else {
        return Err(format!("lines \"{}\" must be a line number or a range like \"4-6\"", js_string(&lines_v)));
    };
    let old = side == "old";
    let number = |l: &crate::model::DiffLine| if old { l.old_line } else { l.new_line };
    let kept: Vec<&crate::model::DiffLine> = hunk
        .lines
        .iter()
        .filter(|l| {
            let kind_ok = l.kind == LineType::Context || l.kind == if old { LineType::Del } else { LineType::Add };
            kind_ok && number(l).is_some_and(|n| n >= range.0 && n <= range.1)
        })
        .collect();
    if kept.is_empty() {
        let known: Vec<i64> = hunk.lines.iter().filter_map(number).collect();
        let span = match (known.iter().min(), known.iter().max()) {
            (Some(a), Some(b)) => format!("{a}-{b}"),
            _ => "none".into(),
        };
        return Err(format!("hunk {id} has no {side} lines in {} (its {side} lines are {span})", js_string(&lines_v)));
    }
    let a = number(kept[0]).unwrap_or(0);
    let b = number(kept[kept.len() - 1]).unwrap_or(0);
    let file = if old { hunk.old_file.as_ref().unwrap_or(&hunk.file) } else { &hunk.file };
    Ok(HunkRead {
        code: kept.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n"),
        lang: lang_of(hunk),
        caption: format!("{file}:{}", if a == b { a.to_string() } else { format!("{a}-{b}") }),
    })
}

fn lang_of(hunk: &Hunk) -> String {
    hunk.language.clone()
}

// --- src/utils/compareLayout.ts ---

#[derive(Clone, Copy, PartialEq)]
enum Taken {
    Chosen,
    NotTaken,
}

enum Body {
    Text(Fit),
    Code {
        lines: Fit,
        caption: Option<Fit>,
        cap_h: f64,
        /// Lines read from a hunk: the block takes the side's whole width, so `bleed` px of it sit left of the cell column.
        bleed: f64,
        /// The width its lines may take, in px, for fitting them again.
        code_w: f64,
        tokens: Vec<TokenLine>,
    },
    Image {
        src: String,
    },
}

struct PlacedCell {
    body: Body,
    verdict: Option<String>,
    taken: Option<Taken>,
    tagged: bool,
    /// Height of its text or code block, plus the tag's row when tagged, in layout pixels.
    h: f64,
    /// Height of the body alone.
    body_h: f64,
}

struct PlacedRow {
    same: bool,
    label: Option<Fit>,
    cells: [PlacedCell; 2],
    y: f64,
    h: f64,
}

struct Side {
    x: f64,
    w: f64,
    title: Fit,
    tone: String,
    taken: Option<Taken>,
}

struct Layout {
    height: f64,
    options: bool,
    mine: bool,
    label_w: f64,
    sides: [Side; 2],
    cell_x: f64,
    cell_w: f64,
    rows: Vec<PlacedRow>,
    scale: f64,
}

struct Room {
    width: f64,
    bleed: f64,
    extra: f64,
}

fn code_lines(code: &str) -> Vec<String> {
    code.trim_end().split('\n').map(str::to_string).collect()
}

fn code_slot(width: f64, size: f64, hunk: bool) -> Slot {
    let mut slot = Slot::named("compareCode", width - 2.0 * CODE_PAD);
    slot.size = size;
    if hunk {
        slot.min = theme::CODE_READABLE_MIN;
    }
    slot
}

fn fit_code(
    props: &Props,
    code: &str,
    lang: &str,
    caption: Option<&str>,
    width: f64,
    font: f64,
    hunk: Option<&Room>,
) -> (Body, f64) {
    let text = code_lines(code);
    let base = Slot::named("compareCode", 0.0).size;
    let size = (if hunk.is_some() { theme::CODE_READABLE_MIN } else { 0.0 }).max(base.min(js_round(font * 0.8)));
    let lines = fit_lines(&text, &code_slot(width, size, hunk.is_some()), f64::INFINITY);
    let cap = caption.map(|c| {
        let mut slot = Slot::named("compareCaption", width - 2.0 * CODE_PAD);
        slot.size = 12f64.max(js_round(lines.size * 0.75));
        fit_text(c, &slot)
    });
    let cap_h = cap.as_ref().map_or(0.0, |c| c.height + 6.0);
    let joined = text.join("\n");
    let plain = props.highlight.plain.clone().unwrap_or_else(|| "#abb2bf".into());
    let tokens = props
        .highlight
        .snippets
        .get(&format!("{lang}\n{joined}"))
        .cloned()
        .unwrap_or_else(|| text.iter().map(|l| vec![(l.clone(), plain.clone())]).collect());
    let h = lines.height + cap_h + 2.0 * CODE_PAD;
    (Body::Code { lines, caption: cap, cap_h, bleed: hunk.map_or(0.0, |r| r.bleed), code_w: width, tokens }, h)
}

fn fit_cell(props: &Props, cell: &Value, room: &Room, font: f64) -> PlacedCell {
    let placed = |body: Body, h: f64| PlacedCell { body, verdict: None, taken: None, tagged: false, h, body_h: h };
    if is_hunk_cell(cell) {
        return match resolve_hunk_cell(cell, props) {
            Err(e) => fit_cell(props, &Value::String(format!("Not shown: {e}")), room, font),
            Ok(read) => {
                let (body, h) = fit_code(
                    props,
                    &read.code,
                    &read.lang,
                    Some(&read.caption),
                    room.width + room.extra,
                    font,
                    Some(room),
                );
                placed(body, h)
            }
        };
    }
    if let Some(s) = cell.as_str() {
        let text = fit_text_at(s.trim(), &Slot::named("compareCell", room.width), font);
        let h = text.height;
        return placed(Body::Text(text), h);
    }
    if let Some(src) = cell.get("image") {
        return placed(Body::Image { src: js_string(src) }, js_round(room.width * 9.0 / 16.0));
    }
    let code = cell.get("code").map(js_string).unwrap_or_default();
    let lang = cell.get("lang").and_then(Value::as_str).unwrap_or("plain");
    let (body, h) = fit_code(props, &code, lang, None, room.width, font, None);
    placed(body, h)
}

/// A row's two snippets drawn at the smaller of their sizes, so the eye compares like with like.
fn share_code_size(cells: &mut [PlacedCell]) {
    let sizes: Vec<f64> = cells
        .iter()
        .filter_map(|c| if let Body::Code { lines, .. } = &c.body { Some(lines.size) } else { None })
        .collect();
    if sizes.len() < 2 {
        return;
    }
    let size = sizes.iter().copied().fold(f64::INFINITY, f64::min);
    for c in cells.iter_mut() {
        if let Body::Code { lines, cap_h, code_w, .. } = &mut c.body {
            let text: Vec<String> = lines.lines.iter().map(|l| l.iter().map(|r| r.text.as_str()).collect()).collect();
            let mut slot = Slot::named("compareCode", *code_w - 2.0 * CODE_PAD);
            slot.size = size;
            slot.min = size;
            *lines = fit_lines(&text, &slot, f64::INFINITY);
            c.h = lines.height + *cap_h + 2.0 * CODE_PAD;
            c.body_h = c.h;
        }
    }
}

fn label_text(row: &RowSrc) -> Option<&str> {
    row.label.as_ref().and_then(Value::as_str).filter(|l| !l.trim().is_empty())
}

fn label_width(rows: &[RowSrc], width: f64) -> f64 {
    let widest = rows
        .iter()
        .filter_map(label_text)
        .map(|l| {
            let mut slot = Slot::named("compareLabel", f64::INFINITY);
            slot.lines = 1;
            fit_text(l, &slot).width
        })
        .fold(None, |a: Option<f64>, w| Some(a.map_or(w, |a| a.max(w))));
    match widest {
        None => 0.0,
        Some(widest) => js_round(LABEL_MAX.min(width * 0.22).min(LABEL_MIN.max(widest + 8.0))),
    }
}

fn attempt(scene: &CompareScene, props: &Props, width: f64, font: i32, frame_h: f64) -> (Layout, bool) {
    let font_f = font as f64;
    let label_w = label_width(&scene.rows, width);
    let options = scene.mode.as_deref() == Some("options");
    let hunky = scene.rows.iter().any(|r| r.cells.iter().any(is_hunk_cell));
    let gutter = if options {
        OPTIONS_GUTTER
    } else if hunky {
        HUNK_GUTTER
    } else {
        GUTTER
    };
    let side_w = (width - label_w - if label_w > 0.0 { LABEL_GAP } else { 0.0 } - gutter) / 2.0;
    let x0 = if label_w > 0.0 { label_w + LABEL_GAP } else { 0.0 };
    let names = titles(scene);
    let side_chosen: Option<usize> = if options {
        (0..2).find(|&j| scene.sides.get(j).and_then(|s| s.chosen.as_ref()).is_some_and(|c| c == &Value::Bool(true)))
    } else {
        None
    };
    let side = |j: usize| Side {
        x: if j == 0 { x0 } else { x0 + side_w + gutter },
        w: side_w,
        title: fit_text(
            &names[j],
            &Slot::named("sideTitle", side_w - 2.0 * PANEL_PAD - if side_chosen.is_some() { TAG_W } else { 0.0 }),
        ),
        tone: scene.sides.get(j).and_then(|s| s.tone.clone()).unwrap_or_else(|| {
            let accent = match side_chosen {
                None => j == 1,
                Some(c) => c == j,
            };
            (if accent { "accent" } else { "neutral" }).into()
        }),
        taken: side_chosen.map(|c| if c == j { Taken::Chosen } else { Taken::NotTaken }),
    };
    let sides = [side(0), side(1)];
    let verdicts = scene.rows.iter().any(|r| r.verdict.as_ref().is_some_and(|v| v.iter().any(Option::is_some)));
    let cell_w = side_w - 2.0 * PANEL_PAD - if verdicts { VERDICT_W } else { 0.0 };
    let bleed = PANEL_PAD - HUNK_EDGE;
    let room = Room { width: cell_w, bleed, extra: bleed + if verdicts { 0.0 } else { bleed } };
    let label_slot = Slot::named("compareLabel", 0.0);
    let label_font = label_slot.min.max(label_slot.size.min(js_round(font_f * 0.87)));
    let pad = js_round(font_f * 0.62);
    let mut y = HEADER_H;
    let mut fits = true;
    let mut rows = Vec::new();
    for row in &scene.rows {
        let mut cells: Vec<PlacedCell> = (0..2)
            .map(|k| {
                let src = row.cells.get(k).cloned().unwrap_or(Value::String(String::new()));
                fit_cell(props, &src, &room, font_f)
            })
            .collect();
        share_code_size(&mut cells);
        let tagged = options && matches!(row.chosen, Some(0) | Some(1));
        for (k, c) in cells.iter_mut().enumerate() {
            fits &= match &c.body {
                Body::Text(t) => t.fits,
                Body::Code { lines, .. } => lines.fits,
                Body::Image { .. } => true,
            };
            c.verdict = row.verdict.as_ref().and_then(|v| v.get(k).cloned().flatten());
            c.taken = if tagged {
                Some(if row.chosen == Some(k as i64) { Taken::Chosen } else { Taken::NotTaken })
            } else {
                sides[k].taken
            };
            c.tagged = tagged;
            if tagged {
                c.h += TAG_H;
            }
        }
        let label = label_text(row).map(|l| fit_text_at(l, &Slot::named("compareLabel", label_w), label_font));
        fits &= label.as_ref().is_none_or(|l| l.fits);
        let h = label.as_ref().map_or(0.0, |l| l.height).max(cells.iter().map(|c| c.h).fold(0.0, f64::max)) + 2.0 * pad;
        let [c0, c1]: [PlacedCell; 2] = cells.try_into().ok().expect("two cells");
        rows.push(PlacedRow { same: !options && row_same(row), label, cells: [c0, c1], y, h });
        y += h;
    }
    let layout = Layout {
        height: y + BOTTOM_PAD,
        options,
        mine: options && scene.alternative.as_deref() == Some("mine"),
        label_w,
        sides,
        cell_x: PANEL_PAD,
        cell_w,
        rows,
        scale: 1.0,
    };
    let _ = frame_h;
    (layout, fits)
}

/// Places a comparison in a box: the largest font at which every cell and label fits and the rows fit the height;
/// failing that, the smallest font laid out wider and scaled down.
fn layout_compare(scene: &CompareScene, props: &Props, width: f64, height: f64) -> Layout {
    let mut font = MAX_FONT;
    while font >= MIN_FONT {
        let (layout, fits) = attempt(scene, props, width, font, height);
        if fits && layout.height <= height {
            return layout;
        }
        font -= 2;
    }
    let (last, _) = attempt(scene, props, width, MIN_FONT, height);
    if last.height <= height {
        return last;
    }
    let scale = height / last.height;
    let (mut wide, _) = attempt(scene, props, width / scale, MIN_FONT, height);
    wide.scale = scale;
    wide
}

// --- shared/targets.mjs, `compare` ---

/// The item keys a ref lights: "r:i" for rows, "s:j" for a side, "x:i/j" for one cell.
fn resolve_ref(scene: &CompareScene, r: &Value) -> Vec<String> {
    let rows = scene.rows.len();
    let one = |r: &Value| -> Vec<String> {
        if let Some((a, b)) = index_range(r) {
            return if b < rows { (a..=b).map(|i| format!("r:{i}")).collect() } else { Vec::new() };
        }
        let Some(s) = r.as_str() else { return Vec::new() };
        let names = titles(scene);
        let side_of = |name: &str| -> Option<usize> {
            let t = name.trim();
            match t {
                "0" => Some(0),
                "1" => Some(1),
                _ => names.iter().position(|n| n == t),
            }
        };
        if let Some(rest) = s.strip_prefix("side:") {
            return side_of(rest).map(|j| vec![format!("s:{j}")]).unwrap_or_default();
        }
        let Some(at) = s.find('@') else { return Vec::new() };
        let head = s[..at].trim();
        match (head.parse::<usize>(), side_of(&s[at + 1..])) {
            (Ok(row), Some(side)) if !head.is_empty() && row < rows => vec![format!("x:{row}/{side}")],
            _ => Vec::new(),
        }
    };
    let keys = one(r);
    if keys.is_empty()
        && let Some(n) = r.as_str().filter(|s| !s.trim().is_empty() && s.trim().bytes().all(|c| c.is_ascii_digit()))
        && let Ok(n) = n.trim().parse::<u64>()
    {
        return one(&Value::from(n));
    }
    keys
}

/// Per step, the last row shown by its end: every row up to the last one it or an earlier step names.
/// The box of each item a step can focus, in layout units: a row across both sides, a side's whole frame, and one
/// cell's text. A note keeps off the titles, the labels, and every row shown by `shown_through` from one side's edge to
/// the other (`compareBoxes`).
fn compare_boxes(layout: &Layout, shown_through: i64) -> LayoutBoxes {
    let mut out = LayoutBoxes::default();
    let left = layout.sides[0].x;
    let right = layout.sides[1].x + layout.sides[1].w;
    for (j, side) in layout.sides.iter().enumerate() {
        out.add(format!("s:{j}"), Bx::new(side.x, 0.0, side.w, layout.height));
    }
    let mut obstacles: Vec<Bx> = layout.sides.iter().map(|s| Bx::new(s.x, 0.0, s.w, HEADER_H)).collect();
    for (i, row) in layout.rows.iter().enumerate() {
        let x = if row.label.is_some() { 0.0 } else { left };
        out.add(format!("r:{i}"), Bx::new(x, row.y, right - x, row.h));
        for side in 0..2 {
            let cell = &row.cells[side];
            let (width, bleed) = match &cell.body {
                Body::Text(t) => (t.width, 0.0),
                Body::Code { lines, bleed, .. } => (lines.width + 2.0 * CODE_PAD, *bleed),
                Body::Image { .. } => (layout.cell_w, 0.0),
            };
            out.add(
                format!("x:{i}/{side}"),
                Bx::new(
                    layout.sides[side].x + layout.cell_x - bleed,
                    row.y + (row.h - cell.h) / 2.0,
                    (layout.cell_w + 2.0 * bleed).min(width).max(24.0),
                    cell.h,
                ),
            );
        }
        if let Some(label) = &row.label {
            obstacles.push(Bx::new(0.0, row.y + (row.h - label.height) / 2.0, label.width, label.height));
        }
        if i as i64 <= shown_through {
            obstacles.push(Bx::new(left, row.y, right - left, row.h));
        }
    }
    out.obstacles = Some(obstacles);
    out
}

struct CompareRefs<'a>(&'a CompareScene);

impl Refs for CompareRefs<'_> {
    fn resolve(&self, r: &Value) -> Option<Vec<String>> {
        Some(resolve_ref(self.0, r)).filter(|k| !k.is_empty())
    }
}

fn row_reach(keys: &[Vec<String>]) -> Vec<i64> {
    let mut last = -1i64;
    keys.iter()
        .map(|step| {
            for key in step {
                if key.starts_with("r:") || key.starts_with("x:") {
                    let digits: String = key[2..].chars().take_while(char::is_ascii_digit).collect();
                    if let Ok(n) = digits.parse::<i64>() {
                        last = last.max(n);
                    }
                }
            }
            last
        })
        .collect()
}

/// When each of `count` ordered items starts to appear (`revealStarts`).
fn reveal_starts(
    segments: &[crate::timing::Segment],
    count: usize,
    lasts: &[i64],
    from: f64,
    to: f64,
    stagger: f64,
    item_frames: f64,
) -> Vec<f64> {
    if segments.len() > 1 && !lasts.is_empty() {
        let mut starts: Vec<f64> = Vec::new();
        for (k, &last) in lasts.iter().enumerate() {
            let at = segments.get(k + 1).unwrap_or(&segments[segments.len() - 1]).from;
            let end = if k == lasts.len() - 1 { count as i64 - 1 } else { last };
            let shown = end + 1 - starts.len() as i64;
            let gap = stagger.min((STEP_SETTLE_FRAMES - item_frames).max(0.0) / ((shown - 1).max(1)) as f64);
            let mut j = 0.0;
            while starts.len() as i64 <= end {
                starts.push(at + j * gap);
                j += 1.0;
            }
        }
        return starts;
    }
    let gap = if count > 1 { (to - from) / (count - 1) as f64 } else { 0.0 };
    (0..count).map(|i| from + i as f64 * gap).collect()
}

// --- src/components/Compare.tsx ---

struct CompareView {
    shell: Shell,
    layout: Layout,
    box_h: f64,
    /// For each item key, the steps that light it.
    targets: HashMap<String, Vec<usize>>,
    lasts: Vec<i64>,
    pen: Pen,
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: CompareScene = parse(input)?;
    if scene.rows.is_empty() {
        return Err("a compare scene without rows".into());
    }
    let (bw, bh) = content_box(scene.title.is_some());
    let layout = layout_compare(&scene, input.props, bw, bh);
    let keys = crate::targets::step_targets_with(input.scene, |r| CompareRefs(&scene).resolve(r));
    let lasts = row_reach(&keys);
    let mut targets: HashMap<String, Vec<usize>> = HashMap::new();
    for (k, step) in keys.iter().enumerate() {
        for key in step {
            targets.entry(key.clone()).or_default().push(k);
        }
    }
    // A step's note keeps off the rows shown by then, and may sit where later rows have yet to appear.
    let top = (bh - layout.height * layout.scale).max(0.0) * 0.35;
    let stage = Stage { left: 0.0, top, scale: layout.scale };
    let marks: Vec<MarkTargets> = (0..scene.steps.len())
        .map(|k| {
            let through = if k + 1 == lasts.len() { i64::MAX } else { lasts.get(k).copied().unwrap_or(i64::MIN) };
            stage.targets(&compare_boxes(&layout, through), (bw, bh))
        })
        .collect();
    let pen = Pen::new(input.scene, input.segments, &CompareRefs(&scene), marks, false, header_box(input.scene));
    Ok(Box::new(CompareView { shell: Shell::new(input.scene), layout, box_h: bh, targets, lasts, pen }))
}

/// `hex(v)` as an alpha: the value rounded to a byte, as the TSX writes it into a colour's last two digits.
fn byte_alpha(v: f64) -> f32 {
    (v.clamp(0.0, 1.0) * 255.0).round() as f32 / 255.0
}

fn ink() -> Color {
    Color::rgba8(0x0b, 0x0d, 0x18, 1.0)
}

fn accent_a(a: f32) -> Color {
    ACCENT.alpha(a)
}

fn tag_text(taken: Taken, mine: bool) -> &'static str {
    match taken {
        Taken::Chosen => "CHOSEN",
        Taken::NotTaken if mine => "ANOTHER WAY",
        Taken::NotTaken => "NOT TAKEN",
    }
}

fn tag_style() -> Style {
    Style::sans(800.0, 15.0).spacing(1.2)
}

fn tag_width(taken: Taken, mine: bool) -> f32 {
    24.0 + width(tag_text(taken, mine), tag_style())
}

/// The small label that says an option was taken or not, with its top left at (x, y).
fn draw_tag(dl: &mut DisplayList, x: f32, y: f32, h: f32, taken: Taken, mine: bool) {
    let w = tag_width(taken, mine);
    let chosen = taken == Taken::Chosen;
    let style = if chosen {
        BoxStyle::fill(ACCENT).radius(999.0)
    } else {
        BoxStyle::empty().radius(999.0).border(BORDER_STRONG.alpha(0.0), 0.0)
    };
    if chosen {
        dl.rect(x, y, w, h, style);
    } else {
        dl.rect(x, y, w, h, BoxStyle::empty().radius(h / 2.0).border(BORDER_RING, 1.5));
    }
    let normal = line_metrics(Face::Sans, 15.0).normal;
    dl.text(
        tag_text(taken, mine),
        tag_style(),
        x + 12.0,
        y + (h - normal) / 2.0 + baseline_in(Face::Sans, 15.0, normal),
        if chosen { ink() } else { MUTED },
    );
}

/// `colors.border`, the ring round a not-taken tag.
const BORDER_RING: Color = BORDER;

/// A code block's width: its widest line or caption, and the padding each side.
fn code_block_width(lines: &Fit, caption: Option<&Fit>, tokens: &[TokenLine]) -> f32 {
    let size = lines.size as f32;
    let st = Style::mono(400.0, size);
    let mut widest = tokens
        .iter()
        .map(|line| if line.is_empty() { width(" ", st) } else { line.iter().map(|(t, _)| width(t, st)).sum() })
        .fold(0.0f32, f32::max);
    if let Some(c) = caption {
        let c = spaced_caption(c);
        for line in &c.lines {
            widest = widest.max(drawn_width(&c, line, None));
        }
    }
    widest + 2.0 * CODE_PAD as f32
}

/// The caption draws with the TSX's own `letterSpacing: 0.2`, which replaces the fit's.
fn spaced_caption(c: &Fit) -> Fit {
    let mut c = c.clone();
    c.font.letter_spacing = 0.2;
    c
}

impl CompareView {
    fn panel(&self, dl: &mut DisplayList, side: usize, appear: f64, title_in: f64, e: Emphasis) {
        let l = &self.layout;
        let p = &l.sides[side];
        let (tone, tone_bg) = theme::tone(&p.tone);
        let chosen = p.taken == Some(Taken::Chosen);
        let (w, h) = (p.w as f32, l.height as f32);
        dl.group(|dl| {
            dl.fade((appear * if p.taken == Some(Taken::NotTaken) { NOT_TAKEN_OPACITY + 0.2 } else { 1.0 }) as f32);
            dl.translate(p.x as f32, ((1.0 - appear) * 16.0) as f32);
            let ring = if e.glow > 0.0 || chosen { ACCENT } else { tone.alpha(0x55 as f32 / 255.0) };
            let mut style = BoxStyle::fill(SURFACE)
                .radius(20.0)
                .border(ring, if chosen { 2.5 } else { 1.5 })
                .shadow(Shadow::new(0.0, 18.0, 50.0, Color::rgba8(0, 0, 0, 0.4)));
            if e.glow > 0.0 {
                style = style.shadow(Shadow::new(0.0, 0.0, (40.0 * e.glow) as f32, ACCENT_GLOW));
            }
            dl.rect(0.0, 0.0, w, h, style);
            // The title band, rounded at its top corners only.
            dl.push_clip(0.0, 0.0, w, h, 20.0);
            dl.group(|dl| {
                dl.fade(title_in as f32);
                dl.fill_rect(0.0, 0.0, w, HEADER_H as f32, tone_bg);
            });
            dl.pop_clip();
            dl.group(|dl| {
                dl.fade((title_in * e.opacity.max(0.7)) as f32);
                draw_fit(
                    dl,
                    &p.title,
                    l.cell_x as f32,
                    ((HEADER_H - p.title.height) / 2.0) as f32,
                    TextOpts::new(tone),
                );
            });
            if let Some(taken) = p.taken {
                dl.group(|dl| {
                    dl.fade(title_in as f32);
                    let tw = tag_width(taken, l.mine);
                    draw_tag(dl, w - l.cell_x as f32 - tw, ((HEADER_H - 30.0) / 2.0) as f32, 30.0, taken, l.mine);
                });
            }
        });
    }

    #[allow(clippy::too_many_arguments)]
    fn cell(&self, dl: &mut DisplayList, row: &PlacedRow, side: usize, appear: f64, opacity: f64, glow: f64) {
        let l = &self.layout;
        let cell = &row.cells[side];
        let panel = &l.sides[side];
        let (pw, rh) = (panel.w as f32, row.h as f32);
        let verdict = cell.verdict.as_deref().map(theme::tone);
        dl.group(|dl| {
            dl.fade((appear * opacity) as f32);
            dl.translate(panel.x as f32, row.y as f32);
            if let Some((color, bg)) = verdict {
                dl.rect(
                    10.0,
                    6.0,
                    pw - 20.0,
                    rh - 12.0,
                    BoxStyle::fill(bg).radius(12.0).border(color.alpha(0x55 as f32 / 255.0), 1.5),
                );
            }
            if cell.taken == Some(Taken::Chosen) && cell.tagged {
                dl.rect(
                    10.0,
                    6.0,
                    pw - 20.0,
                    rh - 12.0,
                    BoxStyle::fill(Color::rgba8(124, 140, 255, 0.07))
                        .radius(12.0)
                        .border(accent_a(0x99 as f32 / 255.0), 1.5),
                );
            }
            if glow > 0.0 {
                dl.rect(
                    8.0,
                    4.0,
                    pw - 16.0,
                    rh - 8.0,
                    BoxStyle::fill(Color::rgba8(124, 140, 255, (0.14 * glow) as f32))
                        .radius(12.0)
                        .border(accent_a(byte_alpha(glow * 0.8)), 2.0)
                        .shadow(Shadow::new(0.0, 0.0, (28.0 * glow) as f32, ACCENT_GLOW)),
                );
            }
            // The cell's content, centred in the row and dimmed by the row's and the cell's state.
            dl.group(|dl| {
                let dim = (if row.same { SAME_OPACITY } else { 1.0 })
                    * if cell.taken == Some(Taken::NotTaken) { NOT_TAKEN_OPACITY } else { 1.0 };
                dl.fade(dim as f32);
                dl.translate(0.0, ((1.0 - appear) * 10.0) as f32);
                let tag_h = if cell.tagged && cell.taken.is_some() { TAG_H } else { 0.0 };
                let bleed = if let Body::Code { bleed, .. } = &cell.body { *bleed } else { 0.0 };
                let x = (l.cell_x - bleed) as f32;
                let mut y = ((row.h - (tag_h + cell.body_h)) / 2.0) as f32;
                if let (Some(taken), true) = (cell.taken, tag_h > 0.0) {
                    draw_tag(dl, x, y, 26.0, taken, l.mine);
                    y += TAG_H as f32;
                }
                self.body(dl, cell, x, y, bleed);
            });
            if let Some((color, _)) = verdict {
                let name = match cell.verdict.as_deref() {
                    Some("good") => "Check",
                    Some("bad") => "X",
                    _ => "AlertTriangle",
                };
                let cx = pw - (l.cell_x - 6.0) as f32 - (VERDICT_W - 8.0) as f32 / 2.0;
                let cy = rh / 2.0;
                dl.group(|dl| {
                    dl.scale_about(appear as f32, cx, cy);
                    dl.rect(cx - 17.0, cy - 17.0, 34.0, 34.0, BoxStyle::fill(color).radius(17.0));
                    icons::draw(dl, name, cx - 11.0, cy - 11.0, 22.0, ink(), 3.0);
                });
            }
        });
    }

    fn body(&self, dl: &mut DisplayList, cell: &PlacedCell, x: f32, y: f32, bleed: f64) {
        let l = &self.layout;
        match &cell.body {
            Body::Text(fit) => {
                draw_fit(dl, fit, x, y, TextOpts::new(TEXT));
            }
            Body::Code { lines, caption, cap_h, tokens, .. } => {
                let size = lines.size as f32;
                let lh = (lines.size * lines.line_height) as f32;
                let pad = CODE_PAD as f32;
                let w = code_block_width(lines, caption.as_ref(), tokens);
                let _ = bleed;
                dl.rect(
                    x,
                    y,
                    w,
                    cell.body_h as f32,
                    BoxStyle::fill(Color::rgba8(0, 0, 0, 0.32)).radius(10.0).border(BORDER, 1.0),
                );
                if let Some(c) = caption {
                    draw_fit(dl, &spaced_caption(c), x + pad, y + pad, TextOpts::new(FAINT));
                }
                let st = Style::mono(400.0, size);
                let top = y + pad + *cap_h as f32;
                let plain = Color::css("#abb2bf");
                let _ = plain;
                for (i, line) in tokens.iter().enumerate() {
                    let base = top + i as f32 * lh + baseline_in(Face::Mono, size, lh);
                    let mut pen = x + pad;
                    for (text, color) in line {
                        pen += dl.text(text, st, pen, base, Color::css(color));
                    }
                }
            }
            Body::Image { src } => {
                // Picture's placeholder, as drawn when the run holds no copy of the picture.
                let w = l.cell_w as f32;
                let h = cell.h as f32;
                dl.rect(
                    x,
                    y,
                    w,
                    h,
                    BoxStyle::fill(RAISED).radius(14.0).border_stroke(Stroke::dashed(BORDER_STRONG, 2.0, 6.0, 6.0)),
                );
                let st = Style::mono(400.0, 18.0);
                let normal = line_metrics(Face::Mono, 18.0).normal;
                let max_w = 0.8 * (w - 4.0);
                let mut rows: Vec<String> = vec![String::new()];
                for ch in src.chars() {
                    let cur = rows.last_mut().unwrap();
                    let mut next = cur.clone();
                    next.push(ch);
                    if !cur.is_empty() && width(&next, st) > max_w {
                        rows.push(ch.to_string());
                    } else {
                        cur.push(ch);
                    }
                }
                let total = 48.0 + 14.0 + rows.len() as f32 * normal;
                let top = y + (h - total) / 2.0;
                icons::draw(dl, "ImageOff", x + (w - 48.0) / 2.0, top, 48.0, FAINT, 2.0);
                for (i, r) in rows.iter().enumerate() {
                    let tw = width(r, st);
                    dl.text(
                        r,
                        st,
                        x + (w - tw) / 2.0,
                        top + 62.0 + i as f32 * normal + baseline_in(Face::Mono, 18.0, normal),
                        FAINT,
                    );
                }
            }
        }
    }

    /// Between the sides: "=" for a row that is the same, and an arrow drawn left to right for one that differs.
    fn cue(&self, dl: &mut DisplayList, row: &PlacedRow, draw: f64, opacity: f64) {
        let l = &self.layout;
        let x0 = (l.sides[0].x + l.sides[0].w + 12.0) as f32;
        let x1 = (l.sides[1].x - 12.0) as f32;
        let y = (row.y + row.h / 2.0) as f32;
        if row.same {
            dl.group(|dl| {
                dl.fade((draw * opacity) as f32);
                let st = Style::mono(700.0, 30.0);
                let normal = line_metrics(Face::Mono, 30.0).normal;
                let w = width("=", st);
                dl.text(
                    "=",
                    st,
                    x0 + (x1 - x0 - w) / 2.0,
                    y - 20.0 + (40.0 - normal) / 2.0 + baseline_in(Face::Mono, 30.0, normal),
                    FAINT,
                );
            });
            return;
        }
        if draw <= 0.0 {
            return;
        }
        let tip = x0 + (x1 - x0) * draw as f32;
        dl.group(|dl| {
            dl.fade(opacity as f32);
            dl.circle(x0, y, 5.0 * (draw * 3.0).min(1.0) as f32, ACCENT);
            let mut line = PathBuilder::new();
            line.move_to(x0, y);
            line.line_to(tip, y);
            if let Some(p) = line.finish() {
                dl.path(p, None, Some(Stroke::solid(ACCENT, 4.0).rounded()));
            }
            if draw > 0.6 {
                let mut head = PathBuilder::new();
                head.move_to(tip - 14.0, y - 10.0);
                head.line_to(tip, y);
                head.line_to(tip - 14.0, y + 10.0);
                if let Some(p) = head.finish() {
                    dl.group(|dl| {
                        dl.fade(interpolate(draw, &[0.6, 1.0], &[0.0, 1.0], CLAMP) as f32);
                        dl.path(p, None, Some(Stroke::solid(ACCENT, 4.0).rounded()));
                    });
                }
            }
        });
    }
}

impl SceneView for CompareView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let l = &self.layout;
        let count = l.rows.len();
        let stepped = !self.lasts.is_empty() && f.segments.len() > 1;
        let starts = reveal_starts(
            f.segments,
            count,
            &self.lasts,
            ROWS_START,
            build_frames("compare") - ROW_FRAMES,
            STEP_STAGGER,
            ROW_FRAMES,
        );
        // A step's rows settle when the step does; without steps each row springs in at its own pace.
        let step_from = stepped.then(|| reveal_starts(f.segments, count, &self.lasts, 0.0, 0.0, 0.0, 0.0));
        let config = Spring::damping(18.0).with_stiffness(140.0);
        let motion = |i: usize, delay: f64| match &step_from {
            Some(from) => step_spring(frame, FPS, starts[i] + delay, from[i], config),
            None => spring(frame - starts[i] - delay, FPS, config),
        };
        let step_starts: Vec<f64> = f.segments.iter().skip(1).map(|s| s.from).collect();
        let spot = Spotlight::new(frame, &step_starts);
        let emphasis = |key: &str| spot.emphasis(self.targets.get(key).map_or(&[][..], |v| &v[..]));
        let side_e = [emphasis("s:0"), emphasis("s:1")];
        let panel_in =
            |side: f64| spring(frame - PANEL_START - side * 4.0, FPS, Spring::damping(16.0).with_stiffness(110.0));
        let title_in = interpolate(frame, &[PANEL_START + 6.0, PANEL_START + 16.0], &[0.0, 1.0], CLAMP);
        let top = (self.box_h - l.height * l.scale).max(0.0) * 0.35;
        let right = l.sides[1].x + l.sides[1].w;

        self.shell.draw(dl, frame, f.duration, None, |dl, _bx| {
            self.pen.draw(dl, frame, f.segments, |dl| {
                dl.translate(0.0, top as f32);
                dl.scale_about(l.scale as f32, 0.0, 0.0);
                self.panel(dl, 0, panel_in(0.0), title_in, side_e[0]);
                self.panel(dl, 1, panel_in(1.0), title_in, side_e[1]);
                for (i, row) in l.rows.iter().enumerate() {
                    let own = emphasis(&format!("r:{i}"));
                    let cell_e = [emphasis(&format!("x:{i}/0")), emphasis(&format!("x:{i}/1"))];
                    let cell_opacity = |j: usize| own.opacity.max(side_e[j].opacity).max(cell_e[j].opacity);
                    let row_opacity = own.opacity.max(cell_e[0].opacity).max(cell_e[1].opacity);
                    let left_in = motion(i, 0.0);
                    let cue = interpolate(frame, &[starts[i] + 3.0, starts[i] + 9.0], &[0.0, 1.0], CLAMP);
                    let right_in = motion(i, 5.0);
                    if i > 0 {
                        for side in &l.sides {
                            dl.group(|dl| {
                                dl.fade(left_in as f32);
                                dl.fill_rect((side.x + 18.0) as f32, row.y as f32, (side.w - 36.0) as f32, 1.0, BORDER);
                            });
                        }
                    }
                    if own.glow > 0.0 {
                        let left = if row.label.is_some() { -14.0 } else { l.sides[0].x - 8.0 };
                        dl.rect(
                            left as f32,
                            (row.y + 2.0) as f32,
                            (right + 8.0 - left) as f32,
                            (row.h - 4.0) as f32,
                            BoxStyle::fill(Color::rgba8(124, 140, 255, (0.08 * own.glow) as f32))
                                .radius(14.0)
                                .border(accent_a(byte_alpha(own.glow * 0.6)), 2.0)
                                .shadow(Shadow::new(0.0, 0.0, (30.0 * own.glow) as f32, ACCENT_GLOW)),
                        );
                    }
                    if let Some(label) = &row.label {
                        dl.group(|dl| {
                            dl.fade((title_in * row_opacity * if left_in > 0.0 { 1.0 } else { UNSHOWN_LABEL }) as f32);
                            let color = if row.same { MUTED } else { Color::css("#d5d9e3") };
                            draw_fit(
                                dl,
                                label,
                                0.0,
                                (row.y + (row.h - label.height) / 2.0) as f32,
                                TextOpts::new(color),
                            );
                        });
                    }
                    self.cell(dl, row, 0, left_in, cell_opacity(0), cell_e[0].glow);
                    if !l.options {
                        self.cue(dl, row, cue, row_opacity * if row.same { SAME_OPACITY + 0.2 } else { 1.0 });
                    }
                    self.cell(dl, row, 1, right_in, cell_opacity(1), cell_e[1].glow);
                }
                let _ = l.label_w;
            })
        });
    }
}
