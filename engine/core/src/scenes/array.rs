//! The array scene: cells in a row (or rows, or a hex grid) with pointers over them, ranges under them and steps that
//! set, move, show, hide and tint. A port of src/components/ArrayDiagram.tsx and src/utils/arrayLayout.ts.

use super::{Frame, SceneInput, SceneView};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::arrays::{self, array_rows, cell_key, marker_row, row_key};
use crate::chrome::callout::{HeaderCallout, header_box};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, fit_height};
use crate::chrome::shell::Shell;
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint, PathBuilder, Shadow, Stroke};
use crate::states::{SceneState, StateFrame, hex_alpha, js_string, list, ordered_entries, tint_fill, walk_states};
use crate::steps::{FocusSpotlight, as_bright_as};
use crate::targets::target_steps;

use crate::steps::Emphasis;
use crate::text::{Face, Style, baseline_in, line_metrics};
use crate::textfit::{Fit, Slot, fit_text, fit_text_at};
use crate::theme::{ACCENT, BG, BORDER_STRONG, FAINT, MUTED, RAISED, TEXT, tone};
use crate::timing::{FPS, js_round};
use serde_json::Value;
use std::collections::HashMap;

const START: f64 = 6.0;
/// Frames by which every cell has started to land; pointers and ranges follow.
const CELLS_END: f64 = 18.0;
const MARKERS_IN: f64 = 22.0;

const CELL_MAX_W: f64 = 200.0;
const CELL_MIN_W: f64 = 44.0;
const CELL_GAP: f64 = 10.0;
const SPLIT_GAP: f64 = 34.0;
const CELL_PAD: f64 = 10.0;
const LABEL_H: f64 = 50.0;
const LABEL_GAP: f64 = 28.0;
pub const CHIP_H: f64 = 38.0;
const CHIP_GAP: f64 = 6.0;
pub const ARROW_LEN: f64 = 30.0;
const INDEX_H: f64 = 34.0;
pub const BAND_H: f64 = 36.0;
const BAND_GAP: f64 = 10.0;
const ROW_GAP: f64 = 30.0;
const HEX_PITCH: f64 = 0.75;
pub const BAND_PAD: f64 = 14.0;
const POINTER_TONES: [&str; 4] = ["accent", "warn", "good", "bad"];

fn hex_h() -> f64 {
    2.0 / 3f64.sqrt()
}

/// One array as placed.
struct PlacedRow {
    name: String,
    key: String,
    count: usize,
    cuts_before: Vec<usize>,
    ghost_left: bool,
    ghost_right: bool,
    x: f64,
    label: Option<Fit>,
    label_x: f64,
    label_y: f64,
    cells_y: f64,
    index_y: f64,
    hex_row: usize,
    width: f64,
}

struct PointerInfo {
    name: String,
    tone: String,
    fit: Fit,
    row: String,
}

struct RangeInfo {
    name: String,
    tone: String,
    fit: Fit,
    y: f64,
    row: String,
}

struct Layout {
    hex: bool,
    indexes: bool,
    slot_w: f64,
    cell_w: f64,
    cell_h: f64,
    rows: Vec<PlacedRow>,
    values: HashMap<String, Fit>,
    pointers: Vec<PointerInfo>,
    ranges: Vec<RangeInfo>,
    width: f64,
    height: f64,
}

impl Layout {
    fn row(&self, name: &str) -> &PlacedRow {
        self.rows.iter().find(|r| r.name == name).expect("row")
    }

    /// Left edge of cell `i` of a row (-1 and `count` are the slots past either end).
    fn cell_x(&self, row: &PlacedRow, i: i64) -> f64 {
        if self.hex {
            return row.x + i as f64 * self.slot_w + (row.hex_row % 2) as f64 * (self.slot_w / 2.0);
        }
        let cuts = if i < 0 {
            0
        } else if i >= row.count as i64 {
            row.cuts_before.get(row.count.wrapping_sub(1)).copied().unwrap_or(0)
        } else {
            row.cuts_before[i as usize]
        };
        row.x + (i + i64::from(row.ghost_left)) as f64 * self.slot_w + cuts as f64 * SPLIT_GAP
    }

    /// The box of a cell: x, y, w, h.
    fn cell_box(&self, row: &PlacedRow, i: usize) -> (f64, f64, f64, f64) {
        (self.cell_x(row, i as i64) + if self.hex { 3.0 } else { 0.0 }, row.cells_y, self.cell_w, self.cell_h)
    }

    fn ghost_x(&self, row: &PlacedRow, i: i64) -> f64 {
        self.cell_x(row, i)
    }

    /// A range's band under its array's cells, spanning cells `a` to `b` (fractional while it moves): x and width.
    fn band(&self, row: &PlacedRow, (a, b): (f64, f64)) -> (f64, f64) {
        let at = |i: f64| {
            let lo = i.floor();
            let hi = ((row.count as f64) - 1.0).min(lo + 1.0);
            self.cell_x(row, lo as i64) + (self.cell_x(row, hi as i64) - self.cell_x(row, lo as i64)) * (i - lo)
        };
        (at(a), at(b) - at(a) + self.cell_w)
    }

    /// The x of a pointer standing at a place that may be fractional while it moves.
    fn pointer_x(&self, row: &PlacedRow, at: f64) -> f64 {
        let lo = at.floor();
        self.cell_x(row, lo as i64) + (self.cell_x(row, lo as i64 + 1) - self.cell_x(row, lo as i64)) * (at - lo)
    }
}

/// Top of a pointer chip stacked `lane` chips above its cell's arrow.
fn chip_y(row: &PlacedRow, lane: f64) -> f64 {
    row.cells_y - ARROW_LEN - CHIP_H - lane * (CHIP_H + CHIP_GAP)
}

/// Each shown pointer's lane in its cell's stack, in declaration order from the cell up.
fn pointer_lanes(scene: &Value, state: &SceneState) -> HashMap<String, usize> {
    let mut taken: HashMap<String, usize> = HashMap::new();
    let mut lanes = HashMap::new();
    for p in list(scene, "pointers") {
        let name = p.get("name").map(js_string).unwrap_or_default();
        if state.hidden.contains(&format!("ptr:{name}")) {
            continue;
        }
        let at = format!("{}/{}", marker_row(scene, p), state.places.get(&format!("ptr:{name}")).map_or(0.0, |p| p.0));
        let lane = taken.get(&at).copied().unwrap_or(0);
        lanes.insert(name, lane);
        taken.insert(at, lane + 1);
    }
    lanes
}

struct Shape {
    name: String,
    count: usize,
    ghost_left: bool,
    ghost_right: bool,
    cuts: Vec<usize>,
    slots: usize,
    stack: usize,
    label: Option<String>,
}

fn layout_array(scene: &Value, states: &[SceneState], (bw, bh): (f64, f64)) -> Result<Layout, String> {
    let hex = scene.get("cells").and_then(Value::as_str) == Some("hex");
    let indexes = !hex && scene.get("indexes") != Some(&Value::Bool(false));
    let multi = scene.get("arrays").is_some_and(Value::is_array);
    let source = array_rows(scene);
    let pointers_all = list(scene, "pointers");
    let ranges_all = list(scene, "ranges");
    let on = |items: &'_ [Value], name: &str| -> Vec<Value> {
        items.iter().filter(|m| marker_row(scene, m) == name).cloned().collect()
    };
    let name_of = |m: &Value| m.get("name").map(js_string).unwrap_or_default();
    let shape: Vec<Shape> = source
        .iter()
        .map(|a| {
            let mine = on(pointers_all, &a.name);
            let places: Vec<i64> = states
                .iter()
                .flat_map(|s| {
                    mine.iter().map(|p| s.places.get(&format!("ptr:{}", name_of(p))).map_or(0.0, |p| p.0) as i64)
                })
                .collect();
            let n = a.values.len();
            let (ghost_left, ghost_right) = (places.contains(&-1), places.contains(&(n as i64)));
            let cuts: Vec<usize> = (0..n).map(|i| a.splits.iter().filter(|&&s| s <= i as i64).count()).collect();
            let stack = states
                .iter()
                .map(|s| {
                    let lanes = pointer_lanes(scene, s);
                    mine.iter().filter_map(|p| lanes.get(&name_of(p)).map(|l| l + 1)).max().unwrap_or(0)
                })
                .max()
                .unwrap_or(0);
            let label = if hex {
                None
            } else if multi {
                a.label.clone()
            } else {
                scene.get("label").and_then(Value::as_str).map(str::to_string)
            };
            Shape {
                name: a.name.clone(),
                count: n,
                ghost_left,
                ghost_right,
                slots: n + usize::from(ghost_left) + usize::from(ghost_right),
                cuts,
                stack,
                label,
            }
        })
        .collect();
    let labels: Vec<Option<Fit>> = shape
        .iter()
        .map(|r| {
            r.label
                .as_ref()
                .filter(|l| !l.is_empty())
                .map(|l| fit_text(l, &Slot::named("arrayLabel", if multi { bw / 4.0 } else { bw })))
        })
        .collect();
    let label_room = if multi {
        labels.iter().map(|l| l.as_ref().map_or(0.0, |l| l.width + LABEL_GAP)).fold(0.0, f64::max)
    } else {
        0.0
    };
    let widest = shape.iter().map(|r| if hex { r.count as f64 + 0.5 } else { r.slots as f64 }).fold(f64::MIN, f64::max);
    let cut_room = shape.iter().map(|r| r.cuts.last().copied().unwrap_or(0) as f64 * SPLIT_GAP).fold(0.0, f64::max);

    struct Placed {
        cell_w: f64,
        cell_h: f64,
        rows: Vec<PlacedRow>,
        height: f64,
    }
    let ranges_on: Vec<usize> = shape.iter().map(|r| on(ranges_all, &r.name).len()).collect();
    let place = |slot_w: f64| -> Placed {
        let cell_w = slot_w - if hex { 6.0 } else { CELL_GAP };
        let cell_h = if hex {
            js_round(slot_w * hex_h()) - 6.0
        } else {
            76f64.min(js_round(cell_w * 0.9)).max(124f64.min(js_round(cell_w * 0.72)))
        };
        let mut y = 0.0;
        let rows: Vec<PlacedRow> = shape
            .iter()
            .enumerate()
            .map(|(n, r)| {
                let label = labels[n].clone();
                let top = if hex { n as f64 * js_round(slot_w * hex_h() * HEX_PITCH) } else { y };
                let cells_y = top
                    + if label.is_some() && !multi { LABEL_H } else { 0.0 }
                    + if r.stack > 0 { r.stack as f64 * (CHIP_H + CHIP_GAP) - CHIP_GAP + ARROW_LEN } else { 0.0 }
                    + if hex { 0.0 } else { 8.0 };
                let index_y = cells_y + cell_h + 8.0;
                let below = (if indexes { index_y + INDEX_H } else { cells_y + cell_h })
                    + ranges_on[n] as f64 * (BAND_H + BAND_GAP);
                if !hex {
                    y = below + ROW_GAP;
                }
                let width = if hex {
                    (r.count as f64 + (n % 2) as f64 * 0.5) * slot_w
                } else {
                    r.slots as f64 * slot_w - CELL_GAP + r.cuts.last().copied().unwrap_or(0) as f64 * SPLIT_GAP
                };
                let label_y = match (&label, multi) {
                    (Some(l), true) => js_round(cells_y + (cell_h - l.height) / 2.0),
                    _ => top,
                };
                PlacedRow {
                    name: r.name.clone(),
                    key: row_key(&r.name),
                    count: r.count,
                    cuts_before: r.cuts.clone(),
                    ghost_left: r.ghost_left,
                    ghost_right: r.ghost_right,
                    x: 0.0,
                    label,
                    label_x: 0.0,
                    label_y,
                    cells_y,
                    index_y,
                    hex_row: n,
                    width,
                }
            })
            .collect();
        let height = if hex { rows.last().map_or(0.0, |r| r.cells_y) + cell_h } else { y - ROW_GAP };
        Placed { cell_w, cell_h, rows, height }
    };
    let mut slot_w = CELL_MAX_W.min(((bw - cut_room - 2.0 * label_room) / widest).floor());
    let mut placed = place(slot_w);
    while placed.height > bh && slot_w > CELL_MIN_W {
        slot_w -= 1.0;
        placed = place(slot_w);
    }
    let Placed { cell_w, cell_h, mut rows, height } = placed;
    let cells_w = rows.iter().map(|r| r.width).fold(0.0, f64::max);
    let width = cells_w + 2.0 * label_room;
    for row in &mut rows {
        row.x = if hex { label_room } else { label_room + js_round((cells_w - row.width) / 2.0) };
        row.label_x = match (&row.label, multi) {
            (Some(l), true) => row.x - LABEL_GAP + CELL_GAP - l.width,
            _ => row.x,
        };
    }

    // One size for every value the scene ever shows, so a value that changes keeps its size.
    let mut texts: Vec<String> = Vec::new();
    let mut note = |t: String| {
        if !texts.contains(&t) {
            texts.push(t);
        }
    };
    for a in &source {
        a.values.iter().for_each(|v| note(js_string(v)));
    }
    for step in list(scene, "steps") {
        if let Some(set) = step.get("set").and_then(Value::as_object) {
            for (_, v) in ordered_entries(Some(&Value::Object(set.clone()))) {
                note(js_string(&v));
            }
        }
    }
    let base = Slot::named("arrayValue", if hex { cell_w * 0.7 } else { cell_w - 2.0 * CELL_PAD });
    let (max, min, line_height, max_lines) = (base.size, base.min, base.line_height, base.lines);
    let fit_all = |size: f64| -> Vec<(String, Fit)> {
        let room = (if hex { cell_h * 0.55 } else { cell_h }) - 12.0;
        let lines = 1usize.max(max_lines.min((room / (size * line_height)).floor().max(0.0) as usize));
        let slot = Slot { lines, ..base.clone() };
        texts.iter().map(|t| (t.clone(), fit_text_at(t, &slot, size))).collect()
    };
    let mut values = fit_all(min);
    let mut size = max;
    while size > min {
        let at = fit_all(size);
        if at.iter().all(|(_, f)| f.fits) {
            values = at;
            break;
        }
        size -= 1.0;
    }

    // A pointer without a tone takes the next one no pointer has asked for.
    let free: Vec<&str> = POINTER_TONES
        .iter()
        .copied()
        .filter(|t| !pointers_all.iter().any(|p| p.get("tone").and_then(Value::as_str) == Some(t)))
        .collect();
    let mut next = 0usize;
    let pointers = pointers_all
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let tone = match p.get("tone").and_then(Value::as_str) {
                Some(t) => t.to_string(),
                None if !free.is_empty() => {
                    next += 1;
                    free[(next - 1) % free.len()].to_string()
                }
                None => POINTER_TONES[i % POINTER_TONES.len()].to_string(),
            };
            let name = name_of(p);
            PointerInfo {
                fit: fit_text(&name, &Slot::named("pointerName", cell_w - 12.0)),
                name,
                tone,
                row: marker_row(scene, p),
            }
        })
        .collect();
    let mut seen: HashMap<String, usize> = HashMap::new();
    let ranges = ranges_all
        .iter()
        .map(|r| {
            let rname = marker_row(scene, r);
            let row = rows.iter().find(|x| x.name == rname).ok_or_else(|| format!("a range on no array {rname:?}"))?;
            let k = {
                let c = seen.entry(rname.clone()).or_insert(0);
                *c += 1;
                *c - 1
            };
            let name = name_of(r);
            Ok(RangeInfo {
                fit: fit_text(&name, &Slot::named("rangeLabel", bw)),
                name,
                row: row.name.clone(),
                tone: r.get("tone").and_then(Value::as_str).unwrap_or("accent").to_string(),
                y: (if indexes { row.index_y + INDEX_H } else { row.cells_y + cell_h })
                    + 8.0
                    + k as f64 * (BAND_H + BAND_GAP),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    if pointers_all.iter().any(|p| !rows.iter().any(|r| r.name == marker_row(scene, p))) {
        return Err("a pointer on no array".into());
    }
    Ok(Layout {
        hex,
        indexes,
        slot_w,
        cell_w,
        cell_h,
        rows,
        values: values.into_iter().collect(),
        pointers,
        ranges,
        width,
        height,
    })
}

struct ArrayView {
    scene: Value,
    shell: Shell,
    layout: Layout,
    states: Vec<SceneState>,
    targets: HashMap<String, Vec<usize>>,
    callout: Option<HeaderCallout>,
    box_size: (f64, f64),
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene = input.scene.clone();
    if array_rows(&scene).is_empty() || array_rows(&scene).iter().all(|a| a.values.is_empty()) {
        return Err("an array scene without values".into());
    }
    let shell = Shell::new(&scene);
    let box_size = header_box(&scene);
    let states = walk_states(&arrays::Model(&scene), &scene);
    let layout = layout_array(&scene, &states, box_size)?;
    Ok(Box::new(ArrayView {
        targets: target_steps(&scene),
        callout: HeaderCallout::new(&scene),
        scene,
        shell,
        layout,
        states,
        box_size,
    }))
}

fn rgba(r: u8, g: u8, b: u8, a: f64) -> Color {
    Color::rgba8(r, g, b, a as f32)
}

/// `0 0 0 3g color, 0 0 36g color+45%` (`litRing`).
fn lit_ring(color: Color, glow: f64) -> Vec<Shadow> {
    if glow <= 0.0 {
        return Vec::new();
    }
    let mut ring = Shadow::new(0.0, 0.0, 0.0, color);
    ring.spread = (3.0 * glow) as f32;
    vec![ring, Shadow::new(0.0, 0.0, (36.0 * glow) as f32, color.alpha(hex_alpha(0.45 * glow)))]
}

/// A value centred in a box, sliding by `shift` of `height`, fading at `opacity`.
#[allow(clippy::too_many_arguments)]
fn value(
    dl: &mut DisplayList,
    fit: &Fit,
    opacity: f64,
    shift: f64,
    height: f64,
    inner: (f64, f64, f64, f64),
    color: Color,
) {
    if opacity <= 0.0 {
        return;
    }
    dl.group(|dl| {
        dl.fade(opacity as f32);
        dl.translate(0.0, (shift * height) as f32);
        let fh = f64::from(fit_height(fit, LineHeight::Fit));
        draw_fit(
            dl,
            fit,
            inner.0 as f32,
            (inner.1 + (inner.3 - fh) / 2.0) as f32,
            TextOpts::new(color).centered(inner.2 as f32),
        );
    });
}

/// Fills over a cell: a colour and how much of it.
struct Fill {
    color: Color,
    amount: f64,
}

struct Pointer {
    name: String,
    key: String,
    row: String,
    tone: String,
    lane: f64,
    at: f64,
    shown: f64,
}

struct Span {
    name: String,
    row: String,
    tone: String,
    place: (f64, f64),
    shown: f64,
}

fn hexagon(x: f64, y: f64, w: f64, h: f64) -> crate::display::Path {
    let mut pb = PathBuilder::new();
    let pts = [(50.0, 0.0), (100.0, 25.0), (100.0, 75.0), (50.0, 100.0), (0.0, 75.0), (0.0, 25.0)];
    for (i, (px, py)) in pts.iter().enumerate() {
        let (px, py) = ((x + px * w / 100.0) as f32, (y + py * h / 100.0) as f32);
        if i == 0 {
            pb.move_to(px, py);
        } else {
            pb.line_to(px, py);
        }
    }
    pb.close();
    pb.finish().expect("hexagon")
}

impl ArrayView {
    #[allow(clippy::too_many_arguments)]
    fn cell(
        &self,
        dl: &mut DisplayList,
        row: &PlacedRow,
        i: usize,
        s: &StateFrame,
        emphasis: Emphasis,
        pop: f64,
        fills: Vec<Fill>,
    ) {
        let l = &self.layout;
        let key = cell_key(&row.name, i);
        let (was, now) = (
            s.before.values.get(&key).map(js_string).unwrap_or_default(),
            s.now.values.get(&key).map(js_string).unwrap_or_default(),
        );
        let changed = s.value_changed(&key);
        let lit = if changed { s.lit } else { 0.0 };
        let (x, y, w, h) = l.cell_box(row, i);
        let empty = now.is_empty() && (!changed || s.t >= 1.0);
        let mix = s.tint(&key);
        let tone_name = mix.main_tone().map(str::to_string);
        let ink = if mix.dim > 0.5 { MUTED } else { TEXT };
        let glow = emphasis.glow;
        let edge = if glow > 0.0 {
            ACCENT
        } else if lit > 0.0 {
            rgba(242, 244, 248, 0.25 + 0.6 * lit)
        } else if let Some(t) = &tone_name {
            tone(t).0.alpha(0xcc as f32 / 255.0)
        } else {
            BORDER_STRONG
        };
        let mut all: Vec<Fill> = fills;
        all.extend(mix.tones.iter().map(|(t, amount)| Fill { color: tint_fill(tone(t).0), amount: *amount }));
        let opacity = pop * emphasis.opacity * mix.dim_opacity();
        let (cx, cy) = ((x + w / 2.0) as f32, (y + h / 2.0) as f32);
        let (fx, fy, fw, fh) = (x as f32, y as f32, w as f32, h as f32);
        let values = |dl: &mut DisplayList, inner: (f64, f64, f64, f64)| {
            if changed {
                if let Some(f) = l.values.get(&was) {
                    value(dl, f, 1.0 - s.t, -0.5 * s.t, h, inner, ink);
                }
                if let Some(f) = l.values.get(&now) {
                    value(dl, f, s.t, 0.5 * (1.0 - s.t), h, inner, ink);
                }
            } else if let Some(f) = l.values.get(&now) {
                value(dl, f, 1.0, 0.0, h, inner, ink);
            }
        };
        dl.group(|dl| {
            dl.fade(opacity as f32);
            dl.translate(0.0, ((1.0 - pop) * 22.0) as f32);
            dl.scale_about((1.0 + 0.015 * glow) as f32, cx, cy);
            let bg = if empty { Color::rgba8(255, 255, 255, 0.025) } else { RAISED };
            if l.hex {
                let drop = if glow > 0.0 {
                    Some((14.0 * glow, ACCENT))
                } else if lit > 0.0 {
                    Some((14.0 * lit, rgba(242, 244, 248, 0.5)))
                } else {
                    None
                };
                if let Some((radius, color)) = drop {
                    // drop-shadow(0 0 r color): a blur of std dev r / 2, stood for by growing strokes.
                    let sigma = radius / 2.0;
                    // The shadow is cast by the cell's own alpha, so a translucent cell lets it show through.
                    let mut alpha = bg.a;
                    for f in all.iter().filter(|f| f.amount > 0.0) {
                        alpha += (1.0 - alpha) * f.color.a * f.amount.min(1.0) as f32;
                    }
                    dl.path(hexagon(x, y, w, h), Some(Paint::from(color.fade(alpha))), None);
                    for (d, a) in [(2.0, 0.04), (1.5, 0.0729), (1.0, 0.1348), (0.5, 0.2208)] {
                        let stroke = Stroke::solid(color.fade(a as f32), (2.0 * d * sigma) as f32).rounded();
                        dl.path(hexagon(x, y, w, h), None, Some(stroke));
                    }
                }
                dl.path(hexagon(x, y, w, h), Some(Paint::from(bg)), None);
                for f in all.iter().filter(|f| f.amount > 0.0) {
                    dl.path(hexagon(x, y, w, h), Some(Paint::from(f.color.fade(f.amount.min(1.0) as f32))), None);
                }
                if lit > 0.0 {
                    dl.path(hexagon(x, y, w, h), Some(Paint::from(rgba(242, 244, 248, 0.14 * lit))), None);
                }
                dl.path(hexagon(x, y, w, h), None, Some(Stroke::solid(edge, if glow > 0.0 { 2.5 } else { 1.5 })));
                values(dl, (x, y, w, h));
                return;
            }
            let mut style = BoxStyle::fill(bg).radius(12.0).border(edge, 1.5);
            for sh in lit_ring(ACCENT, glow) {
                style = style.shadow(sh);
            }
            if lit > 0.0 {
                style = style.shadow(Shadow::new(0.0, 0.0, (34.0 * lit) as f32, rgba(242, 244, 248, 0.35 * lit)));
            }
            style = style.shadow(Shadow::new(0.0, 10.0, 26.0, Color::rgba8(0, 0, 0, 0.35)));
            dl.rect(fx, fy, fw, fh, style);
            dl.push_clip(fx + 1.5, fy + 1.5, fw - 3.0, fh - 3.0, 10.5);
            for f in all.iter().filter(|f| f.amount > 0.0) {
                dl.fill_rect(fx + 1.5, fy + 1.5, fw - 3.0, fh - 3.0, f.color.fade(f.amount.min(1.0) as f32));
            }
            if lit > 0.0 {
                dl.fill_rect(fx + 1.5, fy + 1.5, fw - 3.0, fh - 3.0, rgba(242, 244, 248, 0.14 * lit));
            }
            values(dl, (x + 1.5, y + 1.5, w - 3.0, h - 3.0));
            dl.pop_clip();
        });
    }

    fn band(&self, dl: &mut DisplayList, r: &Span, span_y: f64, e: Emphasis, right_edge: f64) {
        let l = &self.layout;
        let row = l.row(&r.row);
        let info = l.ranges.iter().find(|x| x.name == r.name).expect("range");
        let (bx, bw) = l.band(row, r.place);
        let (color, bg) = tone(&r.tone);
        let (fx, fy, fw) = (bx as f32, span_y as f32, bw as f32);
        let inside = info.fit.width + 2.0 * BAND_PAD <= bw;
        let label_left = if inside {
            bx + BAND_PAD
        } else if bx + bw + 12.0 + info.fit.width <= right_edge {
            bx + bw + 12.0
        } else {
            bx - 12.0 - info.fit.width
        };
        let border = if e.glow > 0.0 { color } else { color.alpha(0x99 as f32 / 255.0) };
        dl.push_layer((r.shown * e.opacity).clamp(0.0, 1.0) as f32);
        let mut style = BoxStyle::fill(bg).radius(10.0);
        for sh in lit_ring(color, e.glow) {
            style = style.shadow(sh);
        }
        dl.rect(fx, fy, fw, BAND_H as f32, style);
        // repeating-linear-gradient(135deg, bg, bg 10px, transparent 10px, transparent 18px) over the box.
        dl.push_clip(fx, fy, fw, BAND_H as f32, 10.0);
        let (w, h) = (bw, BAND_H);
        let (cx, cy) = (bx + w / 2.0, span_y + h / 2.0);
        let d = (std::f64::consts::FRAC_1_SQRT_2, std::f64::consts::FRAC_1_SQRT_2);
        let n = (-d.1, d.0);
        let len = (w + h) * std::f64::consts::FRAC_1_SQRT_2;
        let start = (cx - d.0 * len / 2.0, cy - d.1 * len / 2.0);
        let reach = w + h;
        let mut t0 = 0.0;
        while t0 < len {
            let t1 = (t0 + 10.0).min(len);
            let corner = |t: f64, s: f64| ((start.0 + d.0 * t + n.0 * s) as f32, (start.1 + d.1 * t + n.1 * s) as f32);
            let mut pb = PathBuilder::new();
            let (a, b, c, e2) = (corner(t0, -reach), corner(t1, -reach), corner(t1, reach), corner(t0, reach));
            pb.move_to(a.0, a.1);
            pb.line_to(b.0, b.1);
            pb.line_to(c.0, c.1);
            pb.line_to(e2.0, e2.1);
            pb.close();
            if let Some(p) = pb.finish() {
                dl.path(p, Some(Paint::from(bg)), None);
            }
            t0 += 18.0;
        }
        dl.pop_clip();
        dl.rect(fx, fy, fw, BAND_H as f32, BoxStyle::empty().radius(10.0).border(border, 1.5));
        draw_fit(
            dl,
            &info.fit,
            label_left as f32,
            (span_y + (BAND_H - info.fit.height) / 2.0) as f32,
            TextOpts::new(color),
        );
        dl.pop_layer();
    }

    fn pointer(&self, dl: &mut DisplayList, p: &Pointer, e: Emphasis) {
        let l = &self.layout;
        let info = l.pointers.iter().find(|x| x.name == p.name).expect("pointer");
        let row = l.row(&p.row);
        let (color, bg) = tone(&p.tone);
        let x = l.pointer_x(row, p.at);
        let top = chip_y(row, p.lane);
        let arrow = (1.0 - p.lane).max(0.0);
        dl.group(|dl| {
            dl.fade((p.shown * e.opacity) as f32);
            dl.translate(0.0, ((1.0 - p.shown) * -14.0) as f32);
            let (cw, ch) = ((l.cell_w - 8.0) as f32, CHIP_H as f32);
            let (cx, cy) = ((x + 4.0) as f32 + cw / 2.0, top as f32 + ch / 2.0);
            dl.group(|dl| {
                dl.scale_about((1.0 + 0.06 * e.glow) as f32, cx, cy);
                let mut style = BoxStyle::fill(BG).radius(9.0).border(color, 2.0);
                for sh in lit_ring(color, e.glow) {
                    style = style.shadow(sh);
                }
                dl.rect((x + 4.0) as f32, top as f32, cw, ch, style);
                // inset 0 0 0 40px tone.bg: the padding box takes the tone's background.
                dl.rect((x + 4.0) as f32 + 2.0, top as f32 + 2.0, cw - 4.0, ch - 4.0, BoxStyle::fill(bg).radius(7.0));
                let fh = f64::from(fit_height(&info.fit, LineHeight::Fit));
                draw_fit(
                    dl,
                    &info.fit,
                    (f64::from(cx) - info.fit.width / 2.0) as f32,
                    (f64::from(cy) - fh / 2.0) as f32,
                    TextOpts::new(color),
                );
            });
            if arrow > 0.0 {
                dl.group(|dl| {
                    dl.fade(arrow as f32);
                    let ax = (x + l.cell_w / 2.0) as f32;
                    let ay = (row.cells_y - ARROW_LEN) as f32;
                    let mut line = PathBuilder::new();
                    line.move_to(ax, ay + 2.0);
                    line.line_to(ax, ay + ARROW_LEN as f32 - 9.0);
                    dl.path(line.finish().expect("line"), None, Some(Stroke::solid(color, 3.0).rounded()));
                    let mut head = PathBuilder::new();
                    head.move_to(ax - 7.0, ay + ARROW_LEN as f32 - 12.0);
                    head.line_to(ax, ay + ARROW_LEN as f32 - 3.0);
                    head.line_to(ax + 7.0, ay + ARROW_LEN as f32 - 12.0);
                    dl.path(head.finish().expect("head"), None, Some(Stroke::solid(color, 3.0).rounded()));
                });
            }
        });
    }
}

/// How shown a slot past either end of a row is: as shown as the pointer standing on it (`ghostShown`).
fn ghost_shown(pointers: &[Pointer], row: &str, i: i64) -> f64 {
    pointers
        .iter()
        .filter(|p| p.row == row)
        .map(|p| p.shown * (1.0 - (p.at - i as f64).abs()).max(0.0))
        .fold(0.0, f64::max)
}

impl SceneView for ArrayView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let l = &self.layout;
        let scene = &self.scene;
        let s = StateFrame::at(&self.states, f.segments, frame);
        let focus = FocusSpotlight::borrowed(&self.targets, f.segments, frame);
        let (bw, bh) = self.box_size;
        let stage_left = js_round((bw - l.width) / 2.0) as f32;
        let stage_top = js_round((bh - l.height).max(0.0) * 0.4) as f32;
        let longest = l.rows.iter().map(|r| r.count).max().unwrap_or(0) as f64;
        let stagger = 3f64.min((CELLS_END - START) / 1f64.max(longest + l.rows.len() as f64 - 2.0));
        let pop_at = |ri: usize, i: i64| {
            spring(
                frame - START - ((i.max(0) as f64) + ri as f64) * stagger,
                FPS,
                Spring::damping(16.0).with_stiffness(150.0),
            )
        };
        let markers_in = interpolate(frame, &[MARKERS_IN, MARKERS_IN + 10.0], &[0.0, 1.0], CLAMP);
        let lanes_before = pointer_lanes(scene, s.before);
        let lanes_now = pointer_lanes(scene, s.now);
        let row_shown: HashMap<&str, f64> = l.rows.iter().map(|r| (r.name.as_str(), s.shown(&r.key))).collect();
        let spans: Vec<Span> = l
            .ranges
            .iter()
            .map(|r| Span {
                name: r.name.clone(),
                row: r.row.clone(),
                tone: r.tone.clone(),
                place: s.place(&format!("rg:{}", r.name)),
                shown: s.shown(&format!("rg:{}", r.name)) * markers_in * row_shown[r.row.as_str()],
            })
            .collect();
        let pointers: Vec<Pointer> = l
            .pointers
            .iter()
            .map(|p| {
                let key = format!("ptr:{}", p.name);
                let now = lanes_now.get(&p.name).map(|&n| n as f64);
                let was = lanes_before.get(&p.name).map(|&n| n as f64).or(now);
                let lane = match now {
                    None => was.unwrap_or(0.0),
                    Some(n) => was.unwrap_or(n) + (n - was.unwrap_or(n)) * s.t,
                };
                let first = |st: &SceneState| st.places.get(&key).map_or(0.0, |p| p.0);
                let at = if s.now.hidden.contains(&key) {
                    first(s.before)
                } else if s.before.hidden.contains(&key) {
                    first(s.now)
                } else {
                    s.place(&key).0
                };
                Pointer {
                    name: p.name.clone(),
                    row: p.row.clone(),
                    tone: p.tone.clone(),
                    lane,
                    at,
                    shown: s.shown(&key) * markers_in * row_shown[p.row.as_str()],
                    key,
                }
            })
            .collect();
        let cell_emphasis = |row: &PlacedRow, i: usize| -> Emphasis {
            let mut others = vec![focus.emphasis(&row.key)];
            others.extend(
                pointers
                    .iter()
                    .filter(|p| p.row == row.name && p.shown > 0.5 && js_round(p.at) == i as f64)
                    .map(|p| focus.emphasis(&p.key)),
            );
            others.extend(
                spans
                    .iter()
                    .filter(|r| {
                        r.row == row.name
                            && r.shown > 0.5
                            && i as f64 >= js_round(r.place.0)
                            && i as f64 <= js_round(r.place.1)
                    })
                    .map(|r| focus.emphasis(&format!("rg:{}", r.name))),
            );
            as_bright_as(focus.emphasis(&cell_key(&row.name, i)), &others)
        };
        let cover = |i: usize, (a, b): (f64, f64)| ((b + 1.0).min(i as f64 + 1.0) - a.max(i as f64)).max(0.0);
        let right_edge = (bw + l.width) / 2.0;

        let draw_all = |dl: &mut DisplayList, bx_h: f32| {
            let _ = bx_h;
            dl.translate(stage_left, stage_top);
            for (ri, row) in l.rows.iter().enumerate() {
                let shown = row_shown[row.name.as_str()];
                if shown <= 0.0 {
                    continue;
                }
                dl.group(|dl| {
                    dl.fade(shown as f32);
                    if let Some(label) = &row.label {
                        dl.group(|dl| {
                            dl.fade(interpolate(frame, &[START, START + 10.0], &[0.0, 1.0], CLAMP) as f32);
                            draw_fit(dl, label, row.label_x as f32, row.label_y as f32, TextOpts::new(MUTED));
                        });
                    }
                    let mut slots: Vec<i64> = Vec::new();
                    if row.ghost_left {
                        slots.push(-1);
                    }
                    slots.extend(0..row.count as i64);
                    if row.ghost_right {
                        slots.push(row.count as i64);
                    }
                    for &i in &slots {
                        let pop = pop_at(ri, i);
                        if i < 0 || i >= row.count as i64 {
                            let (x, y) = (l.ghost_x(row, i), row.cells_y);
                            dl.group(|dl| {
                                dl.fade((0.8 * pop * ghost_shown(&pointers, &row.name, i)) as f32);
                                dl.rect(
                                    x as f32,
                                    y as f32,
                                    l.cell_w as f32,
                                    l.cell_h as f32,
                                    BoxStyle::empty().radius(12.0).border_stroke(Stroke::dashed(
                                        BORDER_STRONG,
                                        2.0,
                                        6.0,
                                        4.0,
                                    )),
                                );
                            });
                            continue;
                        }
                        let i = i as usize;
                        let fills = spans
                            .iter()
                            .filter(|r| r.row == row.name)
                            .map(|r| Fill { color: tone(&r.tone).1, amount: 1.4 * r.shown * cover(i, r.place) })
                            .collect();
                        self.cell(dl, row, i, &s, cell_emphasis(row, i), pop, fills);
                    }
                    if l.indexes {
                        for &i in &slots {
                            let inside = i >= 0 && i < row.count as i64;
                            let lit = inside && cell_emphasis(row, i as usize).glow > 0.0;
                            let st = Style::mono(if lit { 700.0 } else { 500.0 }, 19.0);
                            let label = i.to_string();
                            let lh = line_metrics(Face::Mono, 19.0).normal;
                            let w = crate::text::width(&label, st);
                            let op = pop_at(ri, i) * if inside { 1.0 } else { ghost_shown(&pointers, &row.name, i) };
                            dl.group(|dl| {
                                dl.fade(op as f32);
                                dl.text(
                                    &label,
                                    st,
                                    l.ghost_x(row, i) as f32 + (l.cell_w as f32 - w) / 2.0,
                                    row.index_y as f32 + baseline_in(Face::Mono, 19.0, lh),
                                    if lit { ACCENT } else { FAINT },
                                );
                            });
                        }
                    }
                });
            }
            for r in &spans {
                if r.shown <= 0.0 {
                    continue;
                }
                let info = l.ranges.iter().find(|x| x.name == r.name).expect("range");
                self.band(dl, r, info.y, focus.emphasis(&format!("rg:{}", r.name)), right_edge);
            }
            for p in &pointers {
                if p.shown <= 0.0 {
                    continue;
                }
                self.pointer(dl, p, focus.emphasis(&p.key));
            }
            // TODO(marks): PenMarks over the stage.
            // TODO(camera): the scene's camera targets (arrayTargets).
        };

        let aside_draw = |dl: &mut DisplayList, right: f32, top: f32| {
            if let Some(c) = &self.callout {
                c.draw(dl, right, top, &s);
            }
        };
        let aside = self.callout.as_ref().map(|c| c.aside(&aside_draw));
        self.shell.draw(dl, frame, f.duration, aside, |dl, bx| draw_all(dl, bx.h));
    }
}
