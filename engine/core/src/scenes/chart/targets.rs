//! Where each item of a chart is when each step settles, for its pen and its camera (src/utils/chartTargets.ts).

use super::layout::{
    ANNOTATION_BAND, BarRowsLayout, ChartLayout, ChartState, PieLayout, VALUE_FONT, VALUE_PAD, bar_x, chart_order,
    format_value, framed, label_total, point, row_bar_y, shows_badges, slice_angles, slot_top,
};
use super::{Body, ChartScene, Vals};
use crate::marks::MarkTargets;
use crate::marks::geometry::{Bx, Pt, union};

const BADGE_H: f64 = 34.0;

fn area(size: (f64, f64)) -> Bx {
    Bx::new(0.0, 0.0, size.0, size.1)
}

/// `s:<series>`: the union of its values' boxes.
fn series_boxes(scene: &ChartScene, boxes: &mut Vec<(String, Bx)>) {
    for s in 0..scene.series.len() {
        let all: Vec<Bx> = (0..scene.labels.len())
            .filter_map(|l| boxes.iter().find(|(k, _)| *k == format!("p:{s}/{l}")).map(|(_, b)| *b))
            .collect();
        if let Some(u) = union(all.iter().map(Some)) {
            boxes.push((format!("s:{s}"), u));
        }
    }
}

/// A column or line chart's items (`chartTargets`).
fn column_targets(scene: &ChartScene, layout: &ChartLayout, values: &Vals, size: (f64, f64)) -> MarkTargets {
    let bar = scene.kind == "bar";
    let font = if bar && layout.bar_w < 64.0 { 17.0 } else { VALUE_FONT };
    let value_h = font * 1.25 + 14.0;
    let mut boxes = Vec::new();
    let mut obstacles = Vec::new();
    let mut lines = Vec::new();
    if scene.kind == "line" {
        for row in values {
            for i in 0..row.len().saturating_sub(1) {
                let (x0, x1) = (layout.xs[i], layout.xs[i + 1]);
                let (y0, y1) = (layout.y(row[i]), layout.y(row[i + 1]));
                for t in 0..8 {
                    let t = t as f64 / 8.0;
                    lines.push(Pt { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
                }
            }
        }
    }
    let k = scene.series.len();
    for (s, row) in values.iter().enumerate() {
        for (l, &v) in row.iter().enumerate() {
            let below = if scene.stacked { label_total(&values[..s], l) } else { 0.0 };
            let top = layout.y(below + v);
            let value = if bar {
                if scene.stacked {
                    let last = if s == k - 1 { value_h } else { 0.0 };
                    Bx::new(
                        bar_x(layout, layout.xs[l], s, 1, true) - 6.0,
                        top - last,
                        layout.bar_w + 12.0,
                        layout.y(below) - top + last,
                    )
                } else {
                    Bx::new(
                        bar_x(layout, layout.xs[l], s, k, false) - 6.0,
                        top - value_h,
                        layout.bar_w + 12.0,
                        value_h + 40f64.min(layout.plot.y1 - top),
                    )
                }
            } else {
                Bx::new(layout.xs[l] - 34.0, top - value_h, 68.0, value_h + 16.0)
            };
            boxes.push((format!("p:{s}/{l}"), value));
            obstacles.push(if bar { Bx::new(value.x, value.y, value.width, layout.plot.y1 - value.y) } else { value });
        }
    }
    for (i, text) in layout.x_labels.iter().enumerate() {
        let width = layout.slot_w.min(text.width + 8.0);
        let label = Bx::new(
            layout.xs[i] - width / 2.0,
            layout.x_label_top - 4.0,
            width,
            text.lines.len() as f64 * layout.x_label_font * 1.3 + 8.0,
        );
        boxes.push((format!("l:{i}"), label));
        obstacles.push(label);
        if shows_badges(scene) {
            obstacles.push(Bx::new(layout.xs[i] - 60.0, slot_top(scene, layout, values, i) - BADGE_H, 120.0, BADGE_H));
        }
    }
    series_boxes(scene, &mut boxes);
    if scene.annotation.is_some() {
        obstacles.push(Bx::new(layout.plot.x0, 0.0, layout.plot.x1 - layout.plot.x0, ANNOTATION_BAND));
    }
    MarkTargets { obstacles: Some(obstacles), lines, ..MarkTargets::new(boxes, area(size)) }
}

/// A horizontal chart's rows, bars and values (`rowTargets`).
fn row_targets(
    scene: &ChartScene,
    layout: &BarRowsLayout,
    values: &Vals,
    place: &dyn Fn(usize) -> f64,
    size: (f64, f64),
) -> MarkTargets {
    let mut boxes = Vec::new();
    let mut obstacles = Vec::new();
    let k = if scene.stacked { 1 } else { scene.series.len() };
    let longest =
        (0..scene.labels.len())
            .map(|l| {
                if scene.stacked {
                    label_total(values, l)
                } else {
                    values.iter().map(|r| r[l]).fold(f64::MIN, f64::max)
                }
            })
            .fold(1e-9, f64::max);
    for l in 0..scene.labels.len() {
        let top = layout.top + place(l) * layout.row_h;
        let label = &layout.labels[l];
        let label_box = Bx::new(
            layout.label_w - 18.0 - label.width,
            top + (layout.row_h - label.height) / 2.0,
            label.width,
            label.height,
        );
        boxes.push((format!("l:{l}"), label_box));
        obstacles.push(label_box);
        let mut run = 0.0;
        for s in 0..scene.series.len() {
            let v = values[s][l];
            let x = layout.x0 + if scene.stacked { run / longest * layout.bar_max } else { 0.0 };
            let w = v / longest * layout.bar_max;
            run += v;
            let printed = if scene.stacked && s < scene.series.len() - 1 {
                0.0
            } else {
                let shown = if scene.stacked { label_total(values, l) } else { v };
                format_value(shown, scene).encode_utf16().count() as f64 * layout.value_font * 0.62
            };
            let bar = Bx::new(
                x,
                row_bar_y(layout, top, if scene.stacked { 0 } else { s }, k),
                w.max(8.0) + printed + VALUE_PAD,
                layout.bar_h,
            );
            boxes.push((format!("p:{s}/{l}"), bar));
            obstacles.push(bar);
        }
    }
    series_boxes(scene, &mut boxes);
    MarkTargets { obstacles: Some(obstacles), ..MarkTargets::new(boxes, area(size)) }
}

/// The box around a wedge, from points along its arcs (`wedgeBox`).
fn wedge_box(layout: &PieLayout, from: f64, to: f64) -> Bx {
    let pts: Vec<(f64, f64)> = (0..=16)
        .map(|i| from + (to - from) * i as f64 / 16.0)
        .flat_map(|a| [point(layout.cx, layout.cy, layout.r, a), point(layout.cx, layout.cy, layout.hole, a)])
        .collect();
    let (x0, x1) = (pts.iter().map(|p| p.0).fold(f64::MAX, f64::min), pts.iter().map(|p| p.0).fold(f64::MIN, f64::max));
    let (y0, y1) = (pts.iter().map(|p| p.1).fold(f64::MAX, f64::min), pts.iter().map(|p| p.1).fold(f64::MIN, f64::max));
    Bx::new(x0, y0, x1 - x0, y1 - y0)
}

/// Each slice and its legend row (`pieTargets`).
fn pie_targets(scene: &ChartScene, layout: &PieLayout, state: &ChartState, size: (f64, f64)) -> MarkTargets {
    let order = chart_order(scene, &state.values, state.sort);
    let settled = slice_angles(&state.values[0], &order);
    let mut boxes = Vec::new();
    let mut rows = Vec::new();
    for i in 0..scene.labels.len() {
        let (from, span) = settled[i];
        let wedge = wedge_box(layout, from, from + span);
        let row = Bx::new(
            layout.legend_x,
            layout.legend_top + order[i] as f64 * layout.row_h + 6.0,
            size.0 - layout.legend_x,
            layout.row_h - 12.0,
        );
        boxes.push((format!("l:{i}"), wedge));
        boxes.push((format!("p:0/{i}"), wedge));
        boxes.push((format!("x:{i}"), row));
        rows.push(row);
    }
    let whole = Bx::new(layout.cx - layout.r, layout.cy - layout.r, 2.0 * layout.r, 2.0 * layout.r);
    boxes.push(("s:0".into(), whole));
    let mut obstacles = vec![whole];
    obstacles.extend(rows);
    MarkTargets { obstacles: Some(obstacles), ..MarkTargets::new(boxes, area(size)) }
}

/// Each step's item boxes as its values settle (`chartStepTargets`); `states` are the states after each step.
pub fn step_targets(scene: &ChartScene, body: &Body, states: &[ChartState], size: (f64, f64)) -> Vec<MarkTargets> {
    states
        .iter()
        .map(|st| match body {
            Body::Pie(p) => pie_targets(scene, &p.layout, st, size),
            Body::Rows(r) => {
                let f = framed(scene, st, st, 1.0);
                row_targets(scene, &r.layout, &f.values, &|i| f.place(i, 1.0), size)
            }
            Body::Column(c) => {
                let f = framed(scene, st, st, 1.0);
                let mut layout = c.layout.clone();
                layout.xs = (0..scene.labels.len()).map(|i| c.layout.xs[f.to[i]]).collect();
                column_targets(scene, &layout, &f.values, size)
            }
        })
        .collect()
}
