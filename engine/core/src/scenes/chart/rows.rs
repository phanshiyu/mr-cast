//! A horizontal bar chart (`BarRows` of src/components/ChartShapes.tsx): rows that slide to their places when
//! sorted, bars as long as their values against the largest.

use super::column::rrect;
use super::layout::{
    BarRowsLayout, ChartState, VALUE_PAD, format_value, framed, label_total, layout_bar_rows, row_bar_y,
};
use super::{ChartScene, Ctx, hex_alpha, label_color, series_tone, slice_color, tone_color, value_emphasis};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::fittext::{Align, TextOpts, draw_fit};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint, Shadow};
use crate::text::{Face, Style, baseline_in};
use crate::theme::TEXT;
use crate::timing::{FPS, build_frames, js_round};

const START: f64 = 20.0;

pub struct Rows {
    pub layout: BarRowsLayout,
}

impl Rows {
    pub fn new(scene: &ChartScene, w: f64, h: f64, states: &[ChartState]) -> Rows {
        Rows { layout: layout_bar_rows(scene, w, h, states) }
    }

    pub fn draw(&self, dl: &mut DisplayList, scene: &ChartScene, ctx: &Ctx, box_w: f32) {
        let layout = &self.layout;
        let frame = ctx.frame;
        let f = framed(scene, ctx.before, ctx.now, ctx.sf.t);
        let values = &f.values;
        let n = scene.labels.len();
        let k = if scene.stacked { 1 } else { scene.series.len() };
        let ends: Vec<f64> = (0..n)
            .map(|l| {
                if scene.stacked {
                    label_total(values, l)
                } else {
                    values.iter().map(|r| r[l]).fold(f64::NEG_INFINITY, f64::max)
                }
            })
            .collect();
        let longest = ends.iter().copied().fold(1e-9, f64::max);
        let stagger = 5f64.min((build_frames("chart") - START - 16.0) / (n as f64 - 1.0).max(1.0));
        for l in 0..n {
            let top = (layout.top + f.place(l, ctx.sf.t) * layout.row_h) as f32;
            let grow = spring(frame - START - l as f64 * stagger, FPS, Spring::damping(18.0).with_stiffness(110.0));
            let label = &layout.labels[l];
            let lit = ctx.focus.emphasis(&format!("l:{l}"));
            let row_opacity = (0..scene.series.len())
                .map(|s| value_emphasis(&ctx.focus, s, l).opacity)
                .fold(f64::NEG_INFINITY, f64::max);
            dl.group(|dl| {
                dl.fade(interpolate(grow, &[0.0, 0.3], &[0.0, 1.0], CLAMP) as f32);
                // The label, right-aligned against the bars.
                dl.group(|dl| {
                    dl.fade(row_opacity as f32);
                    let right = (layout.label_w - 18.0) as f32;
                    let ly = top + (layout.row_h - label.height) as f32 / 2.0;
                    let w = layout.label_w as f32 - 18.0;
                    let color = if lit.glow > 0.0 { TEXT } else { label_color() };
                    draw_fit(
                        dl,
                        label,
                        right - w,
                        ly,
                        TextOpts { align: Align::Right, width: w, ..TextOpts::new(color) },
                    );
                });
                let mut run = 0.0;
                for s in 0..scene.series.len() {
                    let v = values[s][l];
                    let x = layout.x0 + if scene.stacked { run / longest * layout.bar_max * grow } else { 0.0 };
                    run += v;
                    let w = v / longest * layout.bar_max * grow;
                    let color = if scene.series.len() == 1 && scene.series[0].tone.is_none() {
                        slice_color(l)
                    } else {
                        tone_color(series_tone(&scene.series, s))
                    };
                    let y = row_bar_y(layout, top as f64, if scene.stacked { 0 } else { s }, k);
                    let e = value_emphasis(&ctx.focus, s, l);
                    let last = !scene.stacked || s == scene.series.len() - 1;
                    let printed = if scene.stacked { label_total(&f.shown, l) } else { f.shown[s][l] };
                    dl.group(|dl| {
                        dl.fade(e.opacity as f32);
                        let (bx, by, bw, bh) = (x as f32, y as f32, w as f32, layout.bar_h as f32);
                        let mut style = BoxStyle::empty().radius(if last { 6.0 } else { 3.0 });
                        style = style.shadow(Shadow::new(0.0, 0.0, 28.0, hex_alpha(color, 0x33)));
                        if e.glow > 0.0 {
                            let g = e.glow as f32;
                            let mut ring = Shadow::new(0.0, 0.0, 0.0, hex_alpha(TEXT, 0xcc));
                            ring.spread = 4.0 * g;
                            style = style.shadow(ring).shadow(Shadow::new(0.0, 0.0, 36.0 * g, color));
                        }
                        dl.rect(bx, by, bw, bh, style);
                        let radii = if last { [3.0, 10.0, 10.0, 3.0] } else { [3.0; 4] };
                        if let Some(path) = rrect(bx, by, bw, bh, radii) {
                            let paint = Paint::Linear {
                                start: (bx, 0.0),
                                end: (bx + bw, 0.0),
                                stops: vec![(0.0, hex_alpha(color, 0xaa)), (1.0, color)],
                            };
                            dl.path(path, Some(paint), None);
                        }
                        if bw > 2.0 && bh > 2.0 {
                            dl.fill_rect(bx + 3.0, by, bw - 6.0, 1.0, Color::rgba8(255, 255, 255, 0.25));
                        }
                        if last {
                            let text = super::layout::collapse(&format_value(printed, scene));
                            let size = layout.value_font as f32;
                            let st = Style::mono(700.0, size);
                            let lh = js_round(layout.value_font * 1.25) as f32;
                            let vx = layout.x0
                                + (if scene.stacked { label_total(values, l) } else { v }) / longest
                                    * layout.bar_max
                                    * grow
                                + VALUE_PAD;
                            let top_v = y as f32 + (layout.bar_h as f32 - size * 1.25) / 2.0;
                            dl.group(|dl| {
                                dl.fade(interpolate(grow, &[0.6, 1.0], &[0.0, 1.0], CLAMP) as f32);
                                let c = if s == scene.series.len() - 1 { TEXT } else { Color::css("#b9c0d0") };
                                dl.text(&text, st, vx as f32, top_v + baseline_in(Face::Mono, size, lh), c);
                            });
                        }
                    });
                }
            });
        }
        let _ = box_w;
    }
}
