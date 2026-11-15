//! The timeline's layout: a port of src/utils/timelineLayout.ts.

use super::format::{format_value, nice_ticks};
use crate::textfit::{Family, Fit, Font, Slot, fit_text, measure};

pub const STAMP_FONT: f64 = 17.0;
const STAMP_LINE: f64 = 24.0;
const BOX_PAD_X: f64 = 18.0;
const BOX_PAD_Y: f64 = 12.0;
const BOX_MAX_W: f64 = 330.0;
const BOX_MIN_W: f64 = 120.0;
const BOX_GAP: f64 = 14.0;
const SIDE_PAD: f64 = 40.0;
/// Space between the axis and the row of event cards, crossed by each event's stem.
const STEM_MIN: f64 = 34.0;
/// The same space when a card had to move off its event, so the leader has room to bend.
const STEM_LEAD: f64 = 96.0;
/// Height of a leader's straight rise from the axis, and of its straight drop into the card.
const LEAD_STRAIGHT: f64 = 18.0;
const TICK_ZONE: f64 = 44.0;
pub const SPAN_H: f64 = 44.0;
const SPAN_GAP: f64 = 14.0;
/// Room a span keeps inside its bar around its label.
const SPAN_PAD: f64 = 24.0;

pub struct Event {
    pub at: f64,
    pub label: String,
    pub detail: Option<String>,
}

pub struct Span {
    pub from: f64,
    pub to: f64,
    pub label: String,
}

pub struct PlacedEvent {
    pub index: usize,
    pub x: f64,
    pub stamp: String,
    pub label: Fit,
    pub detail: Option<Fit>,
    pub box_: (f64, f64, f64, f64),
    /// The leader from the event's dot on the axis to its card.
    pub stem: Vec<(f64, f64)>,
}

pub struct PlacedSpan {
    /// Index in the scene's own span list.
    pub index: usize,
    pub x0: f64,
    pub x1: f64,
    pub y: f64,
    /// Its label, inside the bar when it fits there, else beside it.
    pub label: Fit,
    pub inside: bool,
}

pub struct Layout {
    pub axis_y: f64,
    pub lo: f64,
    pub hi: f64,
    x0: f64,
    x1: f64,
    pub ticks: Vec<(f64, String)>,
    pub events: Vec<PlacedEvent>,
    pub spans: Vec<PlacedSpan>,
    pub width: f64,
    pub height: f64,
}

impl Layout {
    pub fn x(&self, v: f64) -> f64 {
        self.x0
            + ((v - self.lo) / (if self.hi - self.lo == 0.0 { 1.0 } else { self.hi - self.lo })) * (self.x1 - self.x0)
    }
}

/// Caps the widest cards at one width, so the row of cards fits in `room`. No card goes under BOX_MIN_W.
fn cap_widths(wanted: &[f64], room: f64) -> Vec<f64> {
    if wanted.iter().sum::<f64>() <= room {
        return wanted.to_vec();
    }
    let mut sorted = wanted.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let mut cap = BOX_MIN_W;
    let mut below = 0.0;
    for (i, &s) in sorted.iter().enumerate() {
        let even = (room - below) / (sorted.len() - i) as f64;
        if even <= s {
            cap = even;
            break;
        }
        below += s;
    }
    wanted.iter().map(|&w| BOX_MIN_W.max(w.min(cap))).collect()
}

struct Cluster {
    first: usize,
    last: usize,
    left: f64,
    w: f64,
    wish: f64,
}

/// Lays boxes in one row in their given order, `gap` apart and inside 0..width, each as near its wanted left edge
/// as the others allow. Boxes that would overlap join a cluster, which centers on its boxes' wishes.
pub fn pack_row(items: &[(f64, f64)], gap: f64, width: f64) -> Vec<f64> {
    let mut clusters: Vec<Cluster> = Vec::new();
    let place = |c: &mut Cluster| {
        c.left = 0.0f64.max((width - c.w).min(c.wish / (c.last - c.first + 1) as f64));
    };
    for (i, &(want, w)) in items.iter().enumerate() {
        let mut c = Cluster { first: i, last: i, left: 0.0, w, wish: want };
        place(&mut c);
        clusters.push(c);
        while clusters.len() >= 2 {
            let n = clusters.len();
            if clusters[n - 2].left + clusters[n - 2].w + gap <= clusters[n - 1].left {
                break;
            }
            let next = clusters.pop().unwrap();
            let prev = clusters.last_mut().unwrap();
            // Each box wishes for the cluster's left edge to sit at its own wanted left minus its offset in the cluster.
            let offset = prev.w + gap;
            prev.wish += next.wish - offset * (next.last - next.first + 1) as f64;
            prev.w += gap + next.w;
            prev.last = next.last;
            place(prev);
        }
    }
    let mut lefts = Vec::new();
    for c in &clusters {
        let mut at = c.left;
        for i in c.first..=c.last {
            lefts.push(at);
            at += items[i].1 + gap;
        }
    }
    lefts
}

/// Puts each item in the first lane where it does not overlap the items already there, scanning left to right.
fn assign_lanes(ranges: &[(f64, f64)], gap: f64) -> Vec<usize> {
    let mut ends: Vec<f64> = Vec::new();
    ranges
        .iter()
        .map(|&(a, b)| {
            let lane = ends.iter().position(|&end| a >= end + gap).unwrap_or(ends.len());
            if lane == ends.len() {
                ends.push(b);
            } else {
                ends[lane] = ends[lane].max(b);
            }
            lane
        })
        .collect()
}

struct Card {
    i: usize,
    w: f64,
    label: Fit,
    detail: Option<Fit>,
    h: f64,
}

struct RowLayout {
    cards: Vec<Card>,
    lefts: Vec<f64>,
    anchors: Vec<f64>,
    stem_h: f64,
    row_h: f64,
}

fn natural(text: &str, slot: &str) -> f64 {
    fit_text(text, &Slot::named(slot, f64::INFINITY)).width
}

pub fn layout_timeline(
    events: &[Event],
    spans: &[Span],
    unit: Option<&str>,
    prefix: Option<&str>,
    width: f64,
) -> Layout {
    let fmt = |v: f64| format_value(v, unit, prefix);
    let points: Vec<f64> = events.iter().map(|e| e.at).chain(spans.iter().flat_map(|s| [s.from, s.to])).collect();
    let ticks = nice_ticks(
        points.iter().copied().fold(f64::INFINITY, f64::min),
        points.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let lo = ticks[0];
    let hi = ticks[ticks.len() - 1];
    let x0 = SIDE_PAD + 30.0;
    let x1 = width - SIDE_PAD - 30.0;
    let x = |v: f64| x0 + ((v - lo) / (if hi - lo == 0.0 { 1.0 } else { hi - lo })) * (x1 - x0);

    let mut order: Vec<usize> = (0..events.len()).collect();
    order.sort_by(|&a, &b| events[a].at.total_cmp(&events[b].at).then(a.cmp(&b)));
    let wanted: Vec<f64> = order
        .iter()
        .map(|&i| {
            let e = &events[i];
            let stamp_w = measure(&fmt(e.at), &Font::new(Family::Mono, 700.0, STAMP_FONT)) * 1.2;
            let text = natural(&e.label, "eventLabel")
                .max(e.detail.as_deref().filter(|d| !d.is_empty()).map_or(0.0, |d| natural(d, "eventDetail")))
                .max(stamp_w);
            BOX_MIN_W.max(BOX_MAX_W.min(text + 2.0 * BOX_PAD_X))
        })
        .collect();
    // One row of cards above the axis while their narrowest widths fit; else every other event's card goes below it.
    let n = order.len();
    let fits_one_row = n as f64 * BOX_MIN_W + BOX_GAP * (n as f64 - 1.0) <= width;
    let rows: Vec<Vec<usize>> = if fits_one_row {
        vec![(0..n).collect()]
    } else {
        (0..2).map(|r| (0..n).filter(|i| i % 2 == r).collect()).collect()
    };
    let cx: Vec<f64> = order.iter().map(|&i| x(events[i].at)).collect();
    let row_layouts: Vec<RowLayout> = rows
        .iter()
        .map(|members| {
            let widths = cap_widths(
                &members.iter().map(|&i| wanted[i]).collect::<Vec<_>>(),
                width - BOX_GAP * (members.len().saturating_sub(1)) as f64,
            );
            let cards: Vec<Card> = members
                .iter()
                .enumerate()
                .map(|(k, &i)| {
                    let e = &events[order[i]];
                    let w = widths[k];
                    let label = fit_text(&e.label, &Slot::named("eventLabel", w - 2.0 * BOX_PAD_X));
                    let detail = e
                        .detail
                        .as_deref()
                        .filter(|d| !d.is_empty())
                        .map(|d| fit_text(d, &Slot::named("eventDetail", w - 2.0 * BOX_PAD_X)));
                    let h = 2.0 * BOX_PAD_Y + STAMP_LINE + label.height + detail.as_ref().map_or(0.0, |d| d.height);
                    Card { i, w, label, detail, h }
                })
                .collect();
            // The cards in the events' order, each as near its event as the cards beside it allow.
            let lefts = pack_row(&cards.iter().map(|c| (cx[c.i] - c.w / 2.0, c.w)).collect::<Vec<_>>(), BOX_GAP, width);
            let anchors: Vec<f64> = cards
                .iter()
                .enumerate()
                .map(|(k, c)| (lefts[k] + c.w - 2.0 * BOX_PAD_X).min((lefts[k] + 2.0 * BOX_PAD_X).max(cx[c.i])))
                .collect();
            let moved = cards.iter().enumerate().any(|(k, c)| (anchors[k] - cx[c.i]).abs() > 0.5);
            let row_h = cards.iter().fold(0.0f64, |m, c| m.max(c.h));
            RowLayout { cards, lefts, anchors, stem_h: if moved { STEM_LEAD } else { STEM_MIN }, row_h }
        })
        .collect();
    let above = &row_layouts[0];
    let below = row_layouts.get(1).map(|b| (b.stem_h, b.row_h));
    let axis_y = above.row_h + above.stem_h;
    // A row below the axis hangs under the tick labels, its leaders bending in the same way, mirrored.
    let below_top = axis_y + TICK_ZONE + below.map_or(0.0, |b| b.0);
    let mut placed: Vec<Option<PlacedEvent>> = (0..n).map(|_| None).collect();
    for (r, row) in row_layouts.into_iter().enumerate() {
        let up = r == 0;
        let edge = if up { axis_y - row.stem_h } else { below_top };
        let lead = if up { -LEAD_STRAIGHT } else { LEAD_STRAIGHT };
        let (lefts, anchors) = (row.lefts, row.anchors);
        for (k, c) in row.cards.into_iter().enumerate() {
            let idx = order[c.i];
            let ax = anchors[k];
            let bx = cx[c.i];
            let stem = if (ax - bx).abs() <= 0.5 {
                vec![(bx, axis_y), (bx, edge)]
            } else {
                vec![(bx, axis_y), (bx, axis_y + lead), (ax, edge - lead), (ax, edge)]
            };
            let box_ = (lefts[k], if up { edge - c.h } else { edge }, c.w, c.h);
            placed[c.i] = Some(PlacedEvent {
                index: idx,
                x: bx,
                stamp: fmt(events[idx].at),
                label: c.label,
                detail: c.detail,
                box_,
                stem,
            });
        }
    }
    let events_placed: Vec<PlacedEvent> = placed.into_iter().flatten().collect();

    let mut span_order: Vec<usize> = (0..spans.len()).collect();
    span_order.sort_by(|&a, &b| spans[a].from.min(spans[a].to).total_cmp(&spans[b].from.min(spans[b].to)));
    struct Fitted {
        index: usize,
        a: f64,
        b: f64,
        inside: bool,
        label: Fit,
        reach: f64,
    }
    let fitted: Vec<Fitted> = span_order
        .iter()
        .map(|&index| {
            let s = &spans[index];
            let a = x(s.from.min(s.to));
            let b = x(s.from.max(s.to));
            let mut slot = Slot::named("spanLabel", b - a - SPAN_PAD);
            slot.min = slot.size;
            let within = fit_text(&s.label, &slot);
            // A label too long for its bar sits after it, so the next span in the lane must start past the label.
            let inside = within.fits;
            let label = if inside { within } else { fit_text(&s.label, &Slot::named("spanLabel", width - (b + 12.0))) };
            let reach = if inside { b } else { b + SPAN_PAD + label.width };
            Fitted { index, a, b, inside, label, reach }
        })
        .collect();
    // Spans that only touch, like consecutive waits, share a lane and read as one bar in segments.
    let lanes = assign_lanes(&fitted.iter().map(|f| (f.a, f.reach)).collect::<Vec<_>>(), -0.5);
    let spans_top = match below {
        Some(b) => below_top + b.1 + SPAN_GAP * 2.0,
        None => axis_y + TICK_ZONE,
    };
    let lane_count = lanes.iter().max().map_or(0, |m| m + 1);
    let placed_spans: Vec<PlacedSpan> = fitted
        .into_iter()
        .enumerate()
        .map(|(i, f)| PlacedSpan {
            index: f.index,
            x0: f.a,
            x1: f.b,
            y: spans_top + lanes[i] as f64 * (SPAN_H + SPAN_GAP),
            label: f.label,
            inside: f.inside,
        })
        .collect();
    let height = spans_top + lane_count as f64 * (SPAN_H + SPAN_GAP);
    Layout {
        axis_y,
        lo,
        hi,
        x0,
        x1,
        ticks: ticks.iter().map(|&t| (x(t), fmt(t))).collect(),
        events: events_placed,
        spans: placed_spans,
        width,
        height,
    }
}

/// The scale a timeline draws at in a box: shrunk only to fit its height.
pub fn timeline_scale(layout: &Layout, box_h: f64) -> f64 {
    1.0f64.min(box_h / layout.height)
}
