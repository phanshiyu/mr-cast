//! A pie or donut (`PieChart` of src/components/ChartShapes.tsx): slices that sweep in, change size as steps set
//! them, and swap places when sorted, with a legend of the slices.

use super::layout::{
    ChartState, PieLayout, SWATCH, SWATCH_GAP, chart_order, format_value, framed, layout_pie, point, slice_angles,
    slice_text, sum,
};
use super::{ChartScene, Ctx, hex_alpha, label_color, slice_color, value_emphasis};
use crate::anim::{CLAMP, Easing, interpolate};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, fit_height};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Shadow, Stroke, svg_path};
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::theme::{BG, MUTED, TEXT};
use crate::timing::{build_frames, js_round};

const START: f64 = 20.0;

pub struct Pie {
    pub layout: PieLayout,
}

fn wedge(l: &PieLayout, from: f64, to: f64, out: f64) -> String {
    let span = (to - from).min(std::f64::consts::PI * 2.0 - 1e-4);
    let mid = from + span / 2.0;
    let (dx, dy) = (out * mid.sin(), -out * mid.cos());
    let (cx, cy) = (l.cx + dx, l.cy + dy);
    let large = if span > std::f64::consts::PI { 1 } else { 0 };
    let (x0, y0) = point(cx, cy, l.r, from);
    let (x1, y1) = point(cx, cy, l.r, from + span);
    if l.hole == 0.0 {
        return format!("M {cx} {cy} L {x0} {y0} A {r} {r} 0 {large} 1 {x1} {y1} Z", r = l.r);
    }
    let (i1, j1) = point(cx, cy, l.hole, from + span);
    let (i0, j0) = point(cx, cy, l.hole, from);
    format!(
        "M {x0} {y0} A {r} {r} 0 {large} 1 {x1} {y1} L {i1} {j1} A {h} {h} 0 {large} 0 {i0} {j0} Z",
        r = l.r,
        h = l.hole
    )
}

fn pct_text(share: f64) -> String {
    super::layout::js_num(if share >= 10.0 { js_round(share) } else { js_round(share * 10.0) / 10.0 })
}

impl Pie {
    pub fn new(scene: &ChartScene, w: f64, h: f64, states: &[ChartState]) -> Pie {
        Pie { layout: layout_pie(scene, w, h, states) }
    }

    pub fn draw(&self, dl: &mut DisplayList, scene: &ChartScene, ctx: &Ctx, box_w: f32) {
        let l = &self.layout;
        let frame = ctx.frame;
        let t = ctx.sf.t;
        let f = framed(scene, ctx.before, ctx.now, t);
        let n = scene.labels.len();
        let shares = &f.values[0];
        let total = sum(shares);
        let was = slice_angles(&ctx.before.values[0], &chart_order(scene, &ctx.before.values, ctx.before.sort));
        let is = slice_angles(&ctx.now.values[0], &chart_order(scene, &ctx.now.values, ctx.now.sort));
        let identity: Vec<usize> = (0..n).collect();
        let spans = slice_angles(shares, &identity);
        let angles: Vec<(f64, f64)> = (0..n).map(|i| (was[i].0 + (is[i].0 - was[i].0) * t, spans[i].1)).collect();
        let sweep = interpolate(
            frame,
            &[START, build_frames("chart")],
            &[0.0, std::f64::consts::PI * 2.0],
            CLAMP.eased(Easing::OutCubic),
        );
        let legend_in = interpolate(frame, &[START + 10.0, START + 26.0], &[0.0, 1.0], CLAMP);
        for i in 0..n {
            let (from, span) = angles[i];
            let end = (from + span).min(sweep);
            if end <= from || span <= 0.0 {
                continue;
            }
            let e = value_emphasis(&ctx.focus, 0, i);
            let color = slice_color(i);
            let Some(path) = svg_path(&wedge(l, from, end, 14.0 * e.glow)) else { continue };
            dl.group(|dl| {
                dl.fade(e.opacity as f32);
                if e.glow > 0.0 {
                    // The drop shadow's glow, as a soft halo around the edge.
                    for i in 0..10 {
                        let w = (4.0 + 4.0 * i as f32) * e.glow as f32;
                        dl.path(path.clone(), None, Some(Stroke::solid(color.alpha(0.05), w)));
                    }
                }
                dl.path(path, Some(color.into()), Some(Stroke::solid(BG, 3.0)));
            });
        }
        for i in 0..n {
            let (from, span) = angles[i];
            if span < 0.32 || from + span > sweep {
                continue;
            }
            let mid = from + span / 2.0;
            let rad = if l.hole > 0.0 { (l.r + l.hole) / 2.0 } else { l.r * 0.64 };
            let (x, y) = point(l.cx, l.cy, rad, mid);
            let pct = if total > 0.0 { shares[i] / total * 100.0 } else { 0.0 };
            let text = format!("{}%", pct_text(pct));
            let st = Style::mono(800.0, 22.0);
            let lh = line_metrics(Face::Mono, 22.0).normal;
            let w = width(&text, st);
            dl.group(|dl| {
                dl.fade(value_emphasis(&ctx.focus, 0, i).opacity as f32);
                dl.text(&text, st, x as f32 - w / 2.0, y as f32 - lh / 2.0 + baseline_in(Face::Mono, 22.0, lh), BG);
            });
        }
        if l.hole > 0.0 {
            dl.group(|dl| {
                dl.fade(legend_in as f32);
                let text = super::layout::collapse(&format_value(sum(&f.shown[0]), scene));
                let st = Style::mono(800.0, 40.0);
                let lh = line_metrics(Face::Mono, 40.0).normal;
                let fit_h = l.centre.as_ref().map_or(0.0, |c| fit_height(c, LineHeight::Fit));
                let total_h = lh + if l.centre.is_some() { 6.0 + fit_h } else { 0.0 };
                let top = l.cy as f32 - total_h / 2.0;
                let w = width(&text, st);
                dl.text(&text, st, l.cx as f32 - w / 2.0, top + baseline_in(Face::Mono, 40.0, lh), TEXT);
                if let Some(c) = &l.centre {
                    let box_x = (l.cx - l.hole) as f32;
                    draw_fit(dl, c, box_x, top + lh + 6.0, TextOpts::new(MUTED).centered(2.0 * l.hole as f32));
                }
            });
        }
        let value_total = sum(&f.shown[0]);
        for i in 0..n {
            let top = (l.legend_top + f.place(i, t) * l.row_h) as f32;
            let e = value_emphasis(&ctx.focus, 0, i);
            let label = &l.labels[i];
            dl.group(|dl| {
                dl.fade((legend_in * e.opacity) as f32);
                let x = l.legend_x as f32;
                let mid = top + l.row_h as f32 / 2.0;
                let mut sw = BoxStyle::fill(slice_color(i)).radius(7.0);
                if e.glow > 0.0 {
                    let mut ring = Shadow::new(0.0, 0.0, 0.0, hex_alpha(TEXT, 0xaa));
                    ring.spread = 3.0 * e.glow as f32;
                    sw = sw.shadow(ring);
                }
                dl.rect(x, mid - SWATCH as f32 / 2.0, SWATCH as f32, SWATCH as f32, sw);
                let color = if e.glow > 0.0 { TEXT } else { label_color() };
                let fh = fit_height(label, LineHeight::Fit);
                draw_fit(dl, label, x + (SWATCH + SWATCH_GAP) as f32, mid - fh / 2.0, TextOpts::new(color));
                let text = super::layout::collapse(&slice_text(scene, f.shown[0][i], value_total));
                let st = Style::mono(700.0, l.value_font as f32);
                let lh = line_metrics(Face::Mono, l.value_font as f32).normal;
                let w = width(&text, st);
                dl.text(&text, st, box_w - w, mid - lh / 2.0 + baseline_in(Face::Mono, l.value_font as f32, lh), TEXT);
            });
        }
        let _ = Color::TRANSPARENT;
    }
}
