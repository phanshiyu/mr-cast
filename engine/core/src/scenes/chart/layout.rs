//! The chart's layout: a port of src/utils/chartLayout.ts and src/utils/chartShapes.ts, and the pure helpers of
//! src/utils/chartTargets.ts the scene draws with.

use super::{ChartScene, Vals};
use crate::states::SceneState;
use crate::textfit::{Fit, Font, Slot, fit_text, fit_text_at, measure};
use crate::timing::js_round;

/// What a chart shows at one step: each series' values by label, whether bars and slices are sorted.
#[derive(Clone, Debug)]
pub struct ChartState {
    pub values: Vals,
    pub sort: bool,
}

/// A chart's state as the shared step model holds it (`chartStateOf`).
pub fn chart_state_of(scene: &ChartScene, state: &SceneState) -> ChartState {
    ChartState {
        values: scene
            .series
            .iter()
            .enumerate()
            .map(|(s, series)| {
                series
                    .values
                    .iter()
                    .enumerate()
                    .map(|(l, v)| state.values.get(&format!("p:{s}/{l}")).and_then(|x| x.as_f64()).unwrap_or(*v))
                    .collect()
            })
            .collect(),
        sort: state.sort == Some(true),
    }
}

/// Decimal places a value is written with.
fn places(v: f64) -> usize {
    if v != 0.0 && (v.abs() < 1e-6 || v.abs() >= 1e21) {
        return 6;
    }
    let text = v.to_string();
    text.split('.').nth(1).map_or(0, str::len)
}

/// A value `t` of the way from `a` to `b`, rounded to the places the two are written with (`between`).
pub fn between(a: f64, b: f64, t: f64) -> f64 {
    if t >= 1.0 || a == b {
        return b;
    }
    if t <= 0.0 {
        return a;
    }
    let digits = places(a).max(places(b));
    format!("{:.*}", digits, a + (b - a) * t).parse().unwrap_or(b)
}

pub fn values_between(a: &Vals, b: &Vals, t: f64) -> Vals {
    if t >= 1.0 {
        return b.clone();
    }
    b.iter()
        .enumerate()
        .map(|(s, row)| row.iter().enumerate().map(|(l, v)| a[s][l] + (v - a[s][l]) * t).collect())
        .collect()
}

pub fn shown_between(a: &Vals, b: &Vals, t: f64) -> Vals {
    b.iter()
        .enumerate()
        .map(|(s, row)| row.iter().enumerate().map(|(l, v)| between(a[s][l], *v, t)).collect())
        .collect()
}

/// A label's total over every series.
pub fn label_total(values: &[Vec<f64>], label: usize) -> f64 {
    values.iter().map(|row| row[label]).sum()
}

/// Each label's place, 0 first, in one state (`chartOrder`).
pub fn chart_order(scene: &ChartScene, values: &Vals, sort: bool) -> Vec<usize> {
    let n = scene.labels.len();
    if !sort {
        return (0..n).collect();
    }
    let key = |i: usize| if scene.stacked { label_total(values, i) } else { values[values.len() - 1][i] };
    let mut ranked: Vec<usize> = (0..n).collect();
    ranked.sort_by(|&a, &b| key(b).partial_cmp(&key(a)).unwrap_or(std::cmp::Ordering::Equal).then(a.cmp(&b)));
    let mut place = vec![0; n];
    for (rank, label) in ranked.into_iter().enumerate() {
        place[label] = rank;
    }
    place
}

/// JS `String(n)` for the numbers a chart prints.
pub fn js_num(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 1e21 { format!("{}", v as i64) } else { v.to_string() }
}

/// Groups the integer part's digits in threes, as `toLocaleString('en-US')`.
fn group(digits: &str) -> String {
    let (int, frac) = digits.split_once('.').map_or((digits, None), |(a, b)| (a, Some(b)));
    let mut out = String::new();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    match frac {
        Some(f) => format!("{out}.{f}"),
        None => out,
    }
}

/// `Number(v.toPrecision(d))`.
fn to_precision(v: f64, digits: usize) -> f64 {
    if v == 0.0 {
        return 0.0;
    }
    format!("{:.*e}", digits - 1, v).parse().unwrap_or(v)
}

fn trimmed(v: f64, digits: usize) -> String {
    let n = to_precision(v, digits);
    let text = format!("{n:.2}");
    let text = if text.contains('.') { text.trim_end_matches('0').trim_end_matches('.').to_string() } else { text };
    group(&text)
}

/// `toLocaleString('en-US', { maximumSignificantDigits: 4 })` of a non-negative number.
fn four_significant(v: f64) -> String {
    group(&js_num(to_precision(v, 4)))
}

/// What a value prints with: a `prefix` before the number and a `unit` after it.
pub fn format_value(v: f64, scene: &ChartScene) -> String {
    let abs = v.abs();
    let sign = if v < 0.0 { "\u{2212}" } else { "" };
    let text = if abs >= 1e9 {
        format!("{}B", trimmed(abs / 1e9, 3))
    } else if abs >= 1e6 {
        format!("{}M", trimmed(abs / 1e6, 3))
    } else if abs >= 1e4 {
        format!("{}k", trimmed(abs / 1e3, 3))
    } else {
        four_significant(abs)
    };
    let head = format!("{sign}{}{text}", scene.prefix.as_deref().unwrap_or(""));
    match scene.unit.as_deref().filter(|u| !u.is_empty()) {
        None => head,
        Some(u) => format!("{head}{}{u}", if ["%", "x", "\u{d7}", "\u{b0}"].contains(&u) { "" } else { " " }),
    }
}

fn ticks_of(lo: f64, span: f64, count: f64) -> Vec<f64> {
    let raw = span / count;
    let mag = 10f64.powf(raw.log10().floor());
    let step = [1.0, 2.0, 2.5, 5.0, 10.0].iter().map(|m| m * mag).find(|s| *s >= raw).unwrap_or(10.0 * mag);
    let mut ticks = Vec::new();
    let mut t = (lo / step).floor() * step;
    while t < lo + span + step - step * 1e-9 {
        ticks.push(to_precision(t, 12));
        t += step;
    }
    ticks
}

/// Round ticks covering [min, max] from zero or below (`niceTicks`).
pub fn nice_ticks(min: f64, max: f64) -> Vec<f64> {
    let lo = min.min(0.0);
    let span = if max > lo { max - lo } else { 1.0 };
    let options: Vec<Vec<f64>> = [4.0, 5.0, 3.0, 6.0].iter().map(|c| ticks_of(lo, span, *c)).collect();
    let waste = |t: &Vec<f64>| t[t.len() - 1] - (lo + span);
    let mut best = &options[0];
    for t in &options[1..] {
        if waste(t) < waste(best) - span * 0.02 {
            best = t;
        }
    }
    best.clone()
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Direction {
    Good,
    Bad,
    Neutral,
}

fn trimmed_ratio(v: f64) -> String {
    trimmed(v, 2)
}

/// The change from `a` to `b` as a badge (`delta`).
pub fn delta(a: f64, b: f64, better: Option<&str>) -> Option<(String, Direction)> {
    if a == 0.0 {
        return None;
    }
    let pct = (b - a) / a.abs() * 100.0;
    let rounded = if pct.abs() >= 10.0 { js_round(pct) } else { js_round(pct * 10.0) / 10.0 };
    let text = if pct >= 200.0 {
        format!("\u{d7}{}", trimmed_ratio(b / a))
    } else if rounded == 0.0 {
        "\u{b1}0%".to_string()
    } else {
        format!("{}{}%", if rounded > 0.0 { "+" } else { "\u{2212}" }, js_num(rounded.abs()))
    };
    let better = better.filter(|b| !b.is_empty());
    if rounded == 0.0 || better.is_none() {
        return Some((text, Direction::Neutral));
    }
    let improved = if better == Some("lower") { pct < 0.0 } else { pct > 0.0 };
    Some((text, if improved { Direction::Good } else { Direction::Bad }))
}

pub const VALUE_FONT: f64 = 21.0;
const NARROW_VALUE_FONT: f64 = 17.0;
const LEGEND_NAME_W: f64 = 240.0;
const NOTE_MAX_W: f64 = 620.0;
const NOTE_PAD_X: f64 = 52.0;
const TICK_CHAR_W: f64 = 10.5;
const HEADROOM: f64 = 84.0;
pub const ANNOTATION_BAND: f64 = 112.0;
const PLOT_RIGHT_PAD: f64 = 24.0;

#[derive(Clone, Debug)]
pub struct Plot {
    pub x0: f64,
    pub x1: f64,
    pub y0: f64,
    pub y1: f64,
}

#[derive(Clone, Debug)]
pub struct ChartLayout {
    pub plot: Plot,
    pub axis_w: f64,
    pub x_label_font: f64,
    pub x_label_top: f64,
    pub ticks: Vec<f64>,
    lo: f64,
    hi: f64,
    /// Centre x of each label's slot.
    pub xs: Vec<f64>,
    pub slot_w: f64,
    pub bar_w: f64,
    pub bar_gap: f64,
    pub x_labels: Vec<Fit>,
    pub legend: Vec<Fit>,
    pub note: Option<Fit>,
}

impl ChartLayout {
    /// Screen y of a value.
    pub fn y(&self, v: f64) -> f64 {
        let d = self.hi - self.lo;
        self.plot.y1 - ((v - self.lo) / if d == 0.0 { 1.0 } else { d }) * (self.plot.y1 - self.plot.y0)
    }
}

/// A value label: its text centred on `x`, `top` its top edge.
#[derive(Clone, Debug)]
pub struct ValueLabel {
    pub series: usize,
    pub label: usize,
    pub text: String,
    pub x: f64,
    pub top: f64,
    pub size: f64,
    pub below: bool,
}

/// Left edge of series `s`'s bar in a slot centred on `cx` (`barX`).
pub fn bar_x(layout: &ChartLayout, cx: f64, s: usize, series_count: usize, stacked: bool) -> f64 {
    if stacked {
        return cx - layout.bar_w / 2.0;
    }
    let k = series_count as f64;
    let group = k * layout.bar_w + (k - 1.0) * layout.bar_gap;
    cx - group / 2.0 + s as f64 * (layout.bar_w + layout.bar_gap)
}

/// The value labels a chart draws, every bar's and a line's at each point or at its last (`valueLabels`).
pub fn value_labels(scene: &ChartScene, layout: &ChartLayout, values: &Vals, shown: &Vals) -> Vec<ValueLabel> {
    let k = scene.series.len();
    if scene.stacked {
        let size = if layout.bar_w < 64.0 { NARROW_VALUE_FONT } else { VALUE_FONT };
        return (0..scene.labels.len())
            .map(|i| {
                let y = layout.y(label_total(values, i));
                ValueLabel {
                    series: k - 1,
                    label: i,
                    text: format_value(label_total(shown, i), scene),
                    x: layout.xs[i],
                    top: y - 14.0 - size * 1.25,
                    size,
                    below: false,
                }
            })
            .collect();
    }
    let bar = scene.kind == "bar";
    let size = if bar && layout.bar_w < 64.0 { NARROW_VALUE_FONT } else { VALUE_FONT };
    let label_every = k <= 2 && scene.labels.len() <= 8;
    let mut out = Vec::new();
    for s in 0..k {
        for (i, &v) in values[s].iter().enumerate() {
            if scene.kind == "line" && !label_every && i != values[s].len() - 1 {
                continue;
            }
            let below = scene.kind == "line" && k == 2 && (0..k).any(|j| j != s && values[j][i] > v);
            let x = if bar { bar_x(layout, layout.xs[i], s, k, false) + layout.bar_w / 2.0 } else { layout.xs[i] };
            let y = layout.y(v);
            out.push(ValueLabel {
                series: s,
                label: i,
                text: format_value(shown.get(s).and_then(|r| r.get(i)).copied().unwrap_or(v), scene),
                x,
                top: if below { y + 14.0 } else { y - 14.0 - size * 1.25 },
                size,
                below,
            });
        }
    }
    out
}

fn axis_values(scene: &ChartScene, states: &[ChartState]) -> Vec<f64> {
    states
        .iter()
        .flat_map(|st| {
            if scene.stacked {
                (0..scene.labels.len()).map(|l| label_total(&st.values, l)).collect::<Vec<_>>()
            } else {
                st.values.iter().flatten().copied().collect()
            }
        })
        .collect()
}

fn min_f(v: impl Iterator<Item = f64>) -> f64 {
    v.fold(f64::INFINITY, f64::min)
}
fn max_f(v: impl Iterator<Item = f64>) -> f64 {
    v.fold(f64::NEG_INFINITY, f64::max)
}

fn legend_fits(scene: &ChartScene) -> Vec<Fit> {
    scene.series.iter().map(|s| fit_text(&s.name, &Slot::named("legend", LEGEND_NAME_W))).collect()
}

/// A vertical bar or line chart: one axis for every state (`layoutChart`).
pub fn layout_chart(scene: &ChartScene, width: f64, height: f64, states: &[ChartState]) -> ChartLayout {
    let values = axis_values(scene, states);
    let ticks = nice_ticks(min_f(values.iter().copied()), max_f(values.iter().copied()));
    let (lo, hi) = (ticks[0], ticks[ticks.len() - 1]);
    let n = scene.labels.len() as f64;
    let axis_w =
        ticks.iter().map(|t| format_value(*t, scene).chars().count()).max().unwrap_or(0) as f64 * TICK_CHAR_W + 30.0;
    let x0 = axis_w;
    let x1 = width - PLOT_RIGHT_PAD;
    let slot_w = (x1 - x0) / n;
    let label_slot = Slot::named("chartLabel", slot_w - 12.0);
    let x_label_font = min_f(scene.labels.iter().map(|l| fit_text(l, &label_slot).size));
    let x_labels: Vec<Fit> = scene.labels.iter().map(|l| fit_text_at(l, &label_slot, x_label_font)).collect();
    let label_lines = x_labels.iter().map(|l| l.lines.len()).max().unwrap_or(1) as f64;
    let below_labels = if scene.kind == "line" && scene.series.len() == 2 { 36.0 } else { 0.0 };
    let y0 = if scene.annotation.is_some() { ANNOTATION_BAND } else { 0.0 } + HEADROOM;
    let y1 = height - 18.0 - below_labels - label_lines * js_round(x_label_font * 1.3);
    let k = if scene.stacked { 1.0 } else { scene.series.len() as f64 };
    let bar_gap = if k > 1.0 { 10.0 } else { 0.0 };
    let bar_w = if scene.kind == "bar" { 150f64.min((slot_w * 0.72 - (k - 1.0) * bar_gap) / k) } else { 0.0 };
    ChartLayout {
        plot: Plot { x0, x1, y0, y1 },
        axis_w,
        x_label_font,
        x_label_top: y1 + 14.0 + below_labels,
        ticks,
        lo,
        hi,
        xs: (0..scene.labels.len()).map(|i| x0 + slot_w * (i as f64 + 0.5)).collect(),
        slot_w,
        bar_w,
        bar_gap,
        x_labels,
        legend: legend_fits(scene),
        note: scene.annotation.as_ref().map(|a| fit_text(&a.text, &Slot::named("annotation", NOTE_MAX_W - NOTE_PAD_X))),
    }
}

/// The top of the labels above a slot's highest value, where its change badge sits (`slotTop`).
pub fn slot_top(scene: &ChartScene, layout: &ChartLayout, values: &Vals, i: usize) -> f64 {
    let value_h = VALUE_FONT * 1.25 + 14.0;
    if scene.kind == "line" {
        return layout.y(values[0][i].max(values[1][i])) - value_h - 10.0;
    }
    let top = if scene.stacked { label_total(values, i) } else { max_f(values.iter().map(|r| r[i])) };
    layout.y(top) - value_h - 6.0
}

pub fn shows_badges(scene: &ChartScene) -> bool {
    scene.series.len() == 2 && scene.badges != Some(false) && !scene.stacked
}

/// Where a step leaves the chart (`framed`): values partway, the order before and after.
pub struct Framed {
    pub values: Vals,
    pub shown: Vals,
    pub from: Vec<usize>,
    pub to: Vec<usize>,
}

impl Framed {
    pub fn place(&self, i: usize, t: f64) -> f64 {
        self.from[i] as f64 + (self.to[i] as f64 - self.from[i] as f64) * t
    }
}

pub fn framed(scene: &ChartScene, before: &ChartState, now: &ChartState, t: f64) -> Framed {
    Framed {
        values: values_between(&before.values, &now.values, t),
        shown: shown_between(&before.values, &now.values, t),
        from: chart_order(scene, &before.values, before.sort),
        to: chart_order(scene, &now.values, now.sort),
    }
}

// --- Horizontal bars and pies (chartShapes.ts). ---

pub struct BarRowsLayout {
    pub label_w: f64,
    pub x0: f64,
    pub bar_max: f64,
    pub row_h: f64,
    pub top: f64,
    pub bar_h: f64,
    pub bar_gap: f64,
    pub labels: Vec<Fit>,
    pub value_font: f64,
    pub legend: Vec<Fit>,
}

const ROW_MAX: f64 = 92.0;
const LABEL_GAP: f64 = 22.0;
pub const VALUE_PAD: f64 = 12.0;

fn mono_bold(size: f64) -> Font {
    Font::new(crate::textfit::Family::Mono, 700.0, size)
}

pub fn layout_bar_rows(scene: &ChartScene, width: f64, height: f64, states: &[ChartState]) -> BarRowsLayout {
    let n = scene.labels.len() as f64;
    let k = if scene.stacked { 1.0 } else { scene.series.len() as f64 };
    let row_h = ROW_MAX.min(height / n);
    let top = ((height - row_h * n).max(0.0) / 2.0) * 0.3;
    let bar_gap = if k > 1.0 { 6.0 } else { 0.0 };
    let bar_h = 60f64.min((row_h * 0.74 - (k - 1.0) * bar_gap) / k);
    let value_font = if bar_h < 30.0 { 17.0 } else { VALUE_FONT };
    let mut wide = Slot::named("chartLabel", f64::INFINITY);
    wide.lines = 1;
    let widest = max_f(scene.labels.iter().map(|l| fit_text(l, &wide).width));
    let label_w = js_round((width * 0.28).min(120f64.max(widest + LABEL_GAP)));
    let mut slot = Slot::named("chartLabel", label_w - LABEL_GAP);
    slot.lines = 1;
    let label_font = min_f(scene.labels.iter().map(|l| fit_text(l, &slot).size));
    let labels = scene.labels.iter().map(|l| fit_text_at(l, &slot, label_font)).collect();
    let printed = |st: &ChartState| -> Vec<f64> {
        if scene.stacked {
            (0..scene.labels.len()).map(|l| label_total(&st.values, l)).collect()
        } else {
            st.values.iter().flatten().copied().collect()
        }
    };
    let value_w =
        max_f(states.iter().flat_map(printed).map(|v| measure(&format_value(v, scene), &mono_bold(value_font))));
    BarRowsLayout {
        label_w,
        x0: label_w,
        bar_max: 40f64.max(width - label_w - value_w - VALUE_PAD - 8.0),
        row_h,
        top,
        bar_h,
        bar_gap,
        labels,
        value_font,
        legend: legend_fits(scene),
    }
}

/// Top of series `s`'s bar in the row whose top is `row_top` (`rowBarY`).
pub fn row_bar_y(layout: &BarRowsLayout, row_top: f64, s: usize, k: usize) -> f64 {
    let k = k as f64;
    let group = k * layout.bar_h + (k - 1.0) * layout.bar_gap;
    row_top + (layout.row_h - group) / 2.0 + s as f64 * (layout.bar_h + layout.bar_gap)
}

pub struct PieLayout {
    pub cx: f64,
    pub cy: f64,
    pub r: f64,
    pub hole: f64,
    pub legend_x: f64,
    pub legend_top: f64,
    pub row_h: f64,
    pub labels: Vec<Fit>,
    pub value_font: f64,
    pub centre: Option<Fit>,
}

const PIE_LEGEND_ROW: f64 = 64.0;
pub const SWATCH: f64 = 24.0;
pub const SWATCH_GAP: f64 = 18.0;

pub fn sum(values: &[f64]) -> f64 {
    values.iter().sum()
}

/// "40%" or "120 ms · 40%" (`sliceText`).
pub fn slice_text(scene: &ChartScene, value: f64, total: f64) -> String {
    let share = if total > 0.0 { value / total * 100.0 } else { 0.0 };
    let pct = format!(
        "{}%",
        js_num(if share >= 10.0 || share == 0.0 { js_round(share) } else { js_round(share * 10.0) / 10.0 })
    );
    if scene.unit.as_deref() == Some("%") {
        format_value(value, scene)
    } else {
        format!("{} \u{b7} {pct}", format_value(value, scene))
    }
}

pub fn layout_pie(scene: &ChartScene, width: f64, height: f64, states: &[ChartState]) -> PieLayout {
    let n = scene.labels.len() as f64;
    let r = js_round((height / 2.0 - 24.0).min(width * 0.24));
    let cx = js_round(width * 0.27);
    let cy = js_round(height / 2.0);
    let legend_x = js_round(cx + r + 110.0);
    let row_h = PIE_LEGEND_ROW.min(height / n);
    let value_font = if row_h < 48.0 { 18.0 } else { 21.0 };
    let value_w = max_f(
        states
            .iter()
            .flat_map(|st| {
                let total = sum(&st.values[0]);
                st.values[0].iter().map(move |v| (*v, total)).collect::<Vec<_>>()
            })
            .map(|(v, total)| measure(&slice_text(scene, v, total), &mono_bold(value_font))),
    ) + 8.0;
    let label_w = 60f64.max(width - legend_x - SWATCH - SWATCH_GAP - value_w - 24.0);
    let mut slot = Slot::named("chartLabel", label_w);
    slot.lines = 1;
    let label_font = min_f(scene.labels.iter().map(|l| fit_text(l, &slot).size));
    let hole = if scene.kind == "donut" { js_round(r * 0.58) } else { 0.0 };
    PieLayout {
        cx,
        cy,
        r,
        hole,
        legend_x,
        legend_top: js_round((height - row_h * n) / 2.0),
        row_h,
        labels: scene.labels.iter().map(|l| fit_text_at(l, &slot, label_font)).collect(),
        value_font,
        centre: (hole > 0.0).then(|| {
            let mut s = Slot::named("legend", hole * 1.6);
            s.lines = 2;
            fit_text(&scene.series[0].name, &s)
        }),
    }
}

/// Each slice's start angle, clockwise from the top in the given order, and its sweep (`sliceAngles`).
pub fn slice_angles(values: &[f64], order: &[usize]) -> Vec<(f64, f64)> {
    let total = if sum(values) == 0.0 { 1.0 } else { sum(values) };
    let mut by_place: Vec<usize> = (0..values.len()).collect();
    by_place.sort_by_key(|&i| order[i]);
    let mut out = vec![(0.0, 0.0); values.len()];
    let mut at = 0.0;
    for i in by_place {
        let span = values[i] / total * std::f64::consts::PI * 2.0;
        out[i] = (at, span);
        at += span;
    }
    out
}

/// Angles are radians clockwise from twelve o'clock.
pub fn point(cx: f64, cy: f64, r: f64, a: f64) -> (f64, f64) {
    (cx + r * a.sin(), cy - r * a.cos())
}

/// How CSS draws text in a box that collapses white space: runs of spaces become one, and the ends are trimmed.
pub fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}
