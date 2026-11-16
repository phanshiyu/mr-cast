//! The sequence diagram's layout: a port of src/utils/sequenceLayout.ts.

use crate::chrome::marks::Marks;
use crate::chrome::nodecard::{CardSize, CardText, Node, card_texts};
use crate::textfit::{Fit, Slot, fit_text};
use serde::Deserialize;
use std::collections::HashMap;

pub const CARD_H: f64 = 84.0;
/// Room above the cards for the "changed" pill.
const CARD_TOP: f64 = 18.0;
const CARD_MAX_W: f64 = 300.0;
const MAX_COL_W: f64 = 520.0;
const ROWS_GAP: f64 = 20.0;
const BOTTOM_PAD: f64 = 24.0;
const MAX_UNIT: f64 = 92.0;
/// A self-call needs room for its loop, so its row is taller than a plain one.
const SELF_WEIGHT: f64 = 1.5;
pub const BAR_W: f64 = 14.0;
const BAR_STEP: f64 = 8.0;
pub const LOOP_W: f64 = 40.0;
const LABEL_GAP: f64 = 6.0;
const NOTE_GAP: f64 = 18.0;
const NOTE_MAX_W: f64 = 460.0;
const CHIP_PAD_X: f64 = 12.0;
const LABEL_LINE_HEIGHT: f64 = 1.35;
/// Chip padding and border above and below the text.
const CHIP_PAD_Y: f64 = 3.0;
/// Width of a note's card less its text: padding, border, icon and gap.
const NOTE_CHROME: f64 = 24.0 + 2.0 + 17.0 + 8.0;
/// Room kept between a row's note and the rows around it.
const NOTE_CLEAR: f64 = 12.0;
/// How far a label may rise into the row above, as a share of a row.
const LABEL_RISE: f64 = 0.2;
/// Rows a short sequence takes are at least this tall.
const MIN_UNIT: f64 = 46.0;

#[derive(Clone, Debug, Deserialize)]
pub struct Message {
    pub from: String,
    pub to: String,
    pub label: String,
    pub kind: Option<String>,
    pub note: Option<String>,
    #[serde(flatten)]
    pub marks: Marks,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Call,
    Return,
    Async,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Align {
    Center,
    Left,
    Right,
}

#[derive(Clone, Debug)]
pub struct PlacedLabel {
    /// Anchor point; `align` says which edge of the chip sits on it. Center labels sit above the anchor.
    pub x: f64,
    pub y: f64,
    pub align: Align,
    pub max_width: f64,
    pub text: Fit,
}

#[derive(Clone, Debug)]
pub struct PlacedNote {
    /// Vertical centre of the card, and the x of its edge nearest the arrow.
    pub x: f64,
    pub y: f64,
    pub left_side: bool,
    pub max_width: f64,
    pub text: Fit,
}

#[derive(Clone, Debug)]
pub struct PlacedMessage {
    pub message: Message,
    pub kind: Kind,
    /// Row band, for the "current message" highlight.
    pub top: f64,
    pub bottom: f64,
    /// Source to arrow tip: two points, or four for a self-call loop.
    pub points: Vec<(f64, f64)>,
    pub label: PlacedLabel,
    pub note: Option<PlacedNote>,
}

#[derive(Clone, Debug)]
pub struct PlacedActivation {
    pub x: f64,
    pub y0: f64,
    pub y1: f64,
    /// Index of the message that opens it; it appears with that message.
    pub opener: usize,
}

pub struct Layout {
    pub width: f64,
    pub height: f64,
    pub card_w: f64,
    pub card_top: f64,
    pub lifeline_top: f64,
    /// Lifeline x of each participant.
    pub xs: Vec<f64>,
    pub texts: Vec<CardText>,
    pub messages: Vec<PlacedMessage>,
    pub activations: Vec<PlacedActivation>,
}

struct Span {
    participant: usize,
    start: usize,
    end: usize,
    open: bool,
}

/// Pairs each call with the next return its callee sends, stack-wise. A call never returned ends at the next
/// message its callee sends, or at the last message.
fn pair_activations(messages: &[Message], index_of: &HashMap<&str, usize>) -> Vec<Span> {
    let mut pending: Vec<(usize, Vec<Span>)> = Vec::new();
    let mut spans: Vec<Span> = Vec::new();
    for (i, m) in messages.iter().enumerate() {
        let (from, to) = (index_of[m.from.as_str()], index_of[m.to.as_str()]);
        if from == to {
            continue;
        }
        match m.kind.as_deref().unwrap_or("call") {
            "call" => {
                let span = Span { participant: to, start: i, end: usize::MAX, open: false };
                match pending.iter_mut().find(|(p, _)| *p == to) {
                    Some((_, stack)) => stack.push(span),
                    None => pending.push((to, vec![span])),
                }
            }
            "return" => {
                if let Some(mut span) = pending.iter_mut().find(|(p, _)| *p == from).and_then(|(_, s)| s.pop()) {
                    span.end = i;
                    spans.push(span);
                }
            }
            _ => {}
        }
    }
    for (_, stack) in pending {
        for mut span in stack {
            let next = messages
                .iter()
                .enumerate()
                .position(|(j, m)| j > span.start && index_of[m.from.as_str()] == span.participant && m.from != m.to);
            span.end = next.unwrap_or(messages.len() - 1);
            span.open = next.is_none();
            spans.push(span);
        }
    }
    spans.sort_by_key(|s| (s.start, s.participant));
    spans
}

fn slot_with(width: f64, size: f64, min: f64, lines: usize) -> Slot {
    let mut s = Slot::named("messageLabel", width);
    s.size = size;
    s.min = min;
    s.one_line_min = None;
    s.lines = lines;
    s
}

/// Fits a message label in a chip `width` wide. It shrinks to keep one line, then wraps onto two at the largest
/// font that fits `room`, the height its row leaves it; failing that, onto up to three lines at the row's font,
/// and the row grows to hold them.
fn fit_label(text: &str, width: f64, room: f64, max: f64) -> Fit {
    let text_w = width - CHIP_PAD_X * 2.0;
    let base = Slot::named("messageLabel", text_w);
    let min = base.min;
    let one = fit_text(text, &slot_with(text_w, max, min, 1));
    if one.fits {
        return one;
    }
    let tallest = ((room - 2.0 * CHIP_PAD_Y) / (2.0 * LABEL_LINE_HEIGHT)).floor();
    let two = (tallest >= min).then(|| fit_text(text, &slot_with(text_w, max.min(tallest), min, 2)));
    match two {
        Some(t) if t.fits => t,
        _ => fit_text(text, &Slot { size: max, min, one_line_min: None, ..base }),
    }
}

fn chip_width(fit: &Fit) -> f64 {
    fit.width + CHIP_PAD_X * 2.0
}

fn chip_height(fit: &Fit) -> f64 {
    fit.lines.len() as f64 * fit.size * LABEL_LINE_HEIGHT + 2.0 * CHIP_PAD_Y + 2.0
}

fn note_height(fit: &Fit) -> f64 {
    fit.height + 10.0 + 2.0
}

enum Geometry {
    SelfCall { x: f64, depth: usize, start: f64, tip: f64, loop_x: f64 },
    Across { x1: f64, x2: f64 },
}

struct Row {
    message: Message,
    kind: Kind,
    label: PlacedLabel,
    note: Option<PlacedNote>,
    geometry: Geometry,
    arrow: f64,
    height: f64,
}

/// Lays a sequence out at a readable size. Rows share the frame's height down to MIN_UNIT and grow to hold a
/// label or note that wraps; a sequence taller than the frame keeps that spacing, and the scene scrolls it
/// under its pinned participants.
pub fn layout_sequence(participants: &[Node], all: &[Message], (box_w, box_h): (f64, f64)) -> Layout {
    let index_of: HashMap<&str, usize> = participants.iter().enumerate().map(|(i, p)| (p.id.as_str(), i)).collect();
    let messages: Vec<Message> = all
        .iter()
        .filter(|m| index_of.contains_key(m.from.as_str()) && index_of.contains_key(m.to.as_str()))
        .cloned()
        .collect();
    let n = participants.len().max(1) as f64;
    let col_w = MAX_COL_W.min(box_w / n);
    let width = col_w * n;
    let card_w = CARD_MAX_W.min(col_w - 16.0);
    let xs: Vec<f64> = (0..participants.len()).map(|i| col_w * (i as f64 + 0.5)).collect();
    let lifeline_top = CARD_TOP + CARD_H;
    let rows_top = lifeline_top + ROWS_GAP;

    let is_self = |m: &Message| m.from == m.to;
    let weights: Vec<f64> = messages.iter().map(|m| if is_self(m) { SELF_WEIGHT } else { 1.0 }).collect();
    let total_weight = weights.iter().sum::<f64>().max(1.0);
    let unit = MIN_UNIT.max(MAX_UNIT.min((box_h - rows_top - BOTTOM_PAD) / total_weight));
    let base_font = (17.0f64.max(24.0f64.min(unit * 0.36))).round();
    // A label may rise from its arrow to just short of the arrow in the row above.
    let label_room = (1.0 - 0.28 + LABEL_RISE) * unit - LABEL_GAP;

    let spans = pair_activations(&messages, &index_of);
    let covering =
        |p: usize, row: usize| spans.iter().filter(|s| s.participant == p && s.start <= row && s.end >= row).count();
    // Where an arrow leaves or reaches a lifeline: the outer edge of its activation bars, if any.
    let edge_x = |p: usize, row: usize, dir: i32| {
        let depth = covering(p, row);
        if depth == 0 {
            return xs[p];
        }
        if dir > 0 { xs[p] + (depth - 1) as f64 * BAR_STEP + BAR_W / 2.0 } else { xs[p] - BAR_W / 2.0 }
    };

    // Across first: where each arrow runs and its label and note sit, and the height each needs.
    let across: Vec<Row> = messages
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let kind = match m.kind.as_deref() {
                Some("return") => Kind::Return,
                Some("async") => Kind::Async,
                _ => Kind::Call,
            };
            let (from, to) = (index_of[m.from.as_str()], index_of[m.to.as_str()]);
            let label: PlacedLabel;
            let occupied: (f64, f64);
            let geometry: Geometry;
            if from == to {
                let x = xs[from];
                let depth = covering(from, i);
                let start = edge_x(from, i, 1);
                let tip = x + depth as f64 * BAR_STEP + BAR_W / 2.0;
                let loop_x = start.max(tip) + LOOP_W;
                let right_room = width - (loop_x + 12.0);
                let left_room = x - BAR_W - 8.0;
                let mut one = Slot::named("messageLabel", f64::INFINITY);
                one.size = base_font;
                one.min = base_font;
                one.one_line_min = None;
                one.lines = 1;
                let want = chip_width(&fit_text(&m.label, &one));
                let on_right = right_room >= want.min(col_w * 0.9) || right_room >= left_room;
                let max_width = (if on_right { right_room } else { left_room }).min((col_w * 0.9).max(want));
                let text = fit_label(&m.label, max_width, label_room, base_font);
                let used = max_width.min(chip_width(&text));
                label = if on_right {
                    PlacedLabel { x: loop_x + 12.0, y: 0.0, align: Align::Left, max_width, text }
                } else {
                    PlacedLabel { x: left_room, y: 0.0, align: Align::Right, max_width, text }
                };
                occupied = if on_right { (x - BAR_W, loop_x + 12.0 + used) } else { (left_room - used, loop_x) };
                geometry = Geometry::SelfCall { x, depth, start, tip, loop_x };
            } else {
                let dir = if to > from { 1 } else { -1 };
                let x1 = edge_x(from, i, dir);
                let x2 = edge_x(to, i, if dir == 1 { -1 } else { 1 });
                let span = (x2 - x1).abs() - 12.0;
                label = PlacedLabel {
                    x: (x1 + x2) / 2.0,
                    y: 0.0,
                    align: Align::Center,
                    max_width: span,
                    text: fit_label(&m.label, span, label_room, base_font),
                };
                occupied = (x1.min(x2), x1.max(x2));
                geometry = Geometry::Across { x1, x2 };
            }
            let note = m.note.as_deref().filter(|n| !n.is_empty()).map(|text| {
                let left = occupied.0 - NOTE_GAP;
                let right = width - (occupied.1 + NOTE_GAP);
                let left_side = right < left;
                let max_width = NOTE_MAX_W.min(left.max(right));
                let mut slot = Slot::named("messageNote", max_width - NOTE_CHROME);
                slot.lines = if weights[i] * unit >= 62.0 { 2 } else { 1 };
                let usual = fit_text(text, &slot);
                slot.lines = 3;
                PlacedNote {
                    x: if left_side { occupied.0 - NOTE_GAP } else { occupied.1 + NOTE_GAP },
                    y: 0.0,
                    left_side,
                    max_width,
                    text: if usual.fits { usual } else { fit_text(text, &slot) },
                }
            });
            // Down a row: a plain arrow sits 0.72 of a row down with its label above it; a self-call starts 0.3
            // down and loops 0.6 further, its label beside the loop. A tall label or note pushes the arrow down
            // and the row's end with it.
            let label_h = chip_height(&label.text);
            let note_h = note.as_ref().map_or(0.0, |n| note_height(&n.text) + NOTE_CLEAR);
            let base = weights[i] * unit;
            let (arrow, height);
            if matches!(geometry, Geometry::SelfCall { .. }) {
                let mid = (0.6 * unit).max(label_h / 2.0 - LABEL_RISE * unit).max(note_h / 2.0);
                arrow = mid - 0.3 * unit;
                height = base.max(mid + label_h.max(note_h) / 2.0 + 0.1 * unit);
            } else {
                arrow = (0.72 * unit).max(label_h + LABEL_GAP - LABEL_RISE * unit);
                height = base.max(arrow + 0.28 * unit).max(note_h);
            }
            Row { message: m.clone(), kind, label, note, geometry, arrow, height }
        })
        .collect();

    let mut row_tops: Vec<f64> = Vec::new();
    let mut top = rows_top;
    for row in &across {
        row_tops.push(top);
        top += row.height;
    }
    let arrow_y: Vec<f64> = across.iter().enumerate().map(|(i, r)| row_tops[i] + r.arrow).collect();

    let mut activations: Vec<PlacedActivation> = spans
        .iter()
        .map(|s| {
            let depth = spans
                .iter()
                .filter(|o| o.participant == s.participant && o.start < s.start && o.end >= s.start)
                .count();
            PlacedActivation {
                x: xs[s.participant] + depth as f64 * BAR_STEP,
                y0: arrow_y[s.start],
                y1: arrow_y[s.end] + if s.open { 16.0 } else { 0.0 },
                opener: s.start,
            }
        })
        .collect();

    let placed: Vec<PlacedMessage> = across
        .into_iter()
        .enumerate()
        .map(|(i, row)| {
            let top = row_tops[i];
            let bottom = top + row.height;
            let y = arrow_y[i];
            let mut label = row.label;
            let (points, self_call);
            match row.geometry {
                Geometry::SelfCall { x, depth, start, tip, loop_x } => {
                    let y_end = y + 0.6 * unit;
                    points = vec![(start, y), (loop_x, y), (loop_x, y_end), (tip, y_end)];
                    activations.push(PlacedActivation {
                        x: x + depth as f64 * BAR_STEP,
                        y0: y_end - 8.0,
                        y1: y_end + 14.0,
                        opener: i,
                    });
                    label.y = (y + y_end) / 2.0;
                    self_call = true;
                }
                Geometry::Across { x1, x2 } => {
                    points = vec![(x1, y), (x2, y)];
                    label.y = y - LABEL_GAP;
                    self_call = false;
                }
            }
            let note = row.note.map(|mut n| {
                n.y = if self_call { label.y } else { (top + bottom) / 2.0 };
                n
            });
            PlacedMessage { message: row.message, kind: row.kind, top, bottom, points, label, note }
        })
        .collect();

    let rows_end = match (row_tops.last(), placed.last()) {
        (Some(t), Some(p)) => t + (p.bottom - p.top),
        _ => rows_top + unit,
    };
    let size = if card_w < 290.0 { CardSize::Compact } else { CardSize::Small };
    Layout {
        width,
        height: rows_end + BOTTOM_PAD,
        card_w,
        card_top: CARD_TOP,
        lifeline_top,
        xs,
        texts: card_texts(participants, card_w, CARD_H, size, false),
        messages: placed,
        activations,
    }
}

/// The scale a sequence draws at in a box: it keeps its rows readable, scaling only to fit across, and scrolls
/// when it is taller than the frame (`sequenceScale`).
pub fn sequence_scale(layout: &Layout, (box_w, box_h): (f64, f64)) -> f64 {
    let across = 1.0f64.min(box_w / layout.width);
    if layout.height <= box_h / across { across.min(box_h / layout.height) } else { across }
}
