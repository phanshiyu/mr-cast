//! A vertical bar or line chart (`ColumnChart` of src/components/Chart.tsx).

use super::layout::{
    ANNOTATION_BAND, ChartLayout, ChartState, Direction, VALUE_FONT, ValueLabel, bar_x, delta, format_value, framed,
    label_total, layout_chart, shows_badges, slot_top, value_labels,
};
use super::{ChartScene, Ctx, Vals, centred_text, hex_alpha, label_color, put_text, series_tone, tone_color};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint, Path, PathBuilder, Shadow, Stroke};
use crate::scenes::step_state::brighter;
use crate::steps::Emphasis;
use crate::steps::step_spring;
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::Fit;
use crate::theme::{ACCENT, ACCENT_SOFT, BG, BORDER, BORDER_STRONG, FAINT, TEXT};
use crate::timing::{FPS, build_frames, js_round};

const START: f64 = 10.0;
const GROW_FRAMES: f64 = 22.0;
const LABEL_FRAMES: f64 = 12.0;
const BADGE_H: f64 = 34.0;

pub struct Column {
    pub layout: ChartLayout,
}

struct Timeline {
    bar_at: Box<dyn Fn(usize, usize) -> f64>,
    slot_done_at: Box<dyn Fn(usize) -> f64>,
    draw_at: Box<dyn Fn(usize) -> f64>,
    draw_frames: f64,
    done_at: f64,
}

fn timeline(scene: &ChartScene) -> Timeline {
    let n = scene.labels.len() as f64;
    let k = scene.series.len() as f64;
    let start = START + 10.0;
    let end = build_frames("chart");
    if scene.kind == "bar" {
        let stagger = 6f64.min((end - GROW_FRAMES - start) / (n * k - 1.0).max(1.0));
        let bar_at = move |i: usize, s: usize| start + (i as f64 * k + s as f64) * stagger;
        let done_at = bar_at(scene.labels.len() - 1, scene.series.len() - 1) + GROW_FRAMES;
        let last = scene.series.len() - 1;
        return Timeline {
            bar_at: Box::new(bar_at),
            slot_done_at: Box::new(move |i| bar_at(i, last) + 10.0),
            draw_at: Box::new(|_| 0.0),
            draw_frames: 0.0,
            done_at,
        };
    }
    let draw_frames = 48f64.min((end - LABEL_FRAMES - start) / (0.75 * (k - 1.0) + 1.0));
    let draw_at = move |s: usize| start + s as f64 * draw_frames * 0.75;
    let done_at = draw_at(scene.series.len() - 1) + draw_frames;
    let last_draw = draw_at(scene.series.len() - 1);
    Timeline {
        bar_at: Box::new(|_, _| 0.0),
        slot_done_at: Box::new(move |i| last_draw + draw_frames * ((i as f64 + 0.5) / n)),
        draw_at: Box::new(draw_at),
        draw_frames,
        done_at,
    }
}

struct NotePoint {
    label: usize,
    series: usize,
    x: f64,
    y: f64,
}

fn annotation_point(scene: &ChartScene, layout: &ChartLayout, values: &Vals) -> Option<NotePoint> {
    let note = scene.annotation.as_ref()?;
    let label = scene.labels.iter().position(|l| *l == note.at)?;
    let named = note.series.as_ref().and_then(|n| scene.series.iter().position(|s| s.name == *n));
    let series = named.unwrap_or(scene.series.len() - 1);
    let value = if scene.stacked { label_total(&values[..=series], label) } else { values[series][label] };
    let x = if scene.kind == "bar" {
        bar_x(layout, layout.xs[label], series, scene.series.len(), scene.stacked) + layout.bar_w / 2.0
    } else {
        layout.xs[label]
    };
    Some(NotePoint { label, series, x, y: layout.y(value) })
}

/// A rounded rectangle with a radius per corner (top left, top right, bottom right, bottom left), scaled down as CSS does.
pub fn rrect(x: f32, y: f32, w: f32, h: f32, r: [f32; 4]) -> Option<Path> {
    let f = [w / (r[0] + r[1]), w / (r[3] + r[2]), h / (r[0] + r[3]), h / (r[1] + r[2])]
        .into_iter()
        .filter(|f| f.is_finite())
        .fold(1.0f32, f32::min);
    let r = r.map(|v| v * f);
    let k = 0.552_284_8;
    let mut p = PathBuilder::new();
    p.move_to(x + r[0], y);
    p.line_to(x + w - r[1], y);
    p.cubic_to(x + w - r[1] * (1.0 - k), y, x + w, y + r[1] * (1.0 - k), x + w, y + r[1]);
    p.line_to(x + w, y + h - r[2]);
    p.cubic_to(x + w, y + h - r[2] * (1.0 - k), x + w - r[2] * (1.0 - k), y + h, x + w - r[2], y + h);
    p.line_to(x + r[3], y + h);
    p.cubic_to(x + r[3] * (1.0 - k), y + h, x, y + h - r[3] * (1.0 - k), x, y + h - r[3]);
    p.line_to(x, y + r[0]);
    p.cubic_to(x, y + r[0] * (1.0 - k), x + r[0] * (1.0 - k), y, x + r[0], y);
    p.close();
    p.finish()
}

fn value_label(dl: &mut DisplayList, v: &ValueLabel, color: Color, appear: f64) {
    let a = appear.clamp(0.0, 1.0) as f32;
    dl.group(|dl| {
        dl.fade(a);
        let shift = (1.0 - appear) as f32 * if v.below { -8.0 } else { 8.0 };
        let lh = js_round(v.size * 1.25) as f32;
        centred_text(
            dl,
            &super::layout::collapse(&v.text),
            Style::mono(700.0, v.size as f32),
            v.x as f32,
            v.top as f32 + shift,
            lh,
            color,
            true,
        );
    });
}

/// `emphasisAt` of Chart.tsx: bright through its label, its series or itself, glowing through its series or itself.
fn emphasis_at(ctx: &Ctx, s: usize, i: usize) -> Emphasis {
    let own = brighter(ctx.focus.at(&format!("s:{s}")), ctx.focus.at(&format!("p:{s}/{i}")));
    Emphasis { opacity: own.opacity.max(ctx.focus.at(&format!("l:{i}")).opacity), ..own }
}

fn emphasis_of(scene: &ChartScene, ctx: &Ctx, i: usize) -> Emphasis {
    let op = (0..scene.series.len()).map(|s| emphasis_at(ctx, s, i).opacity).fold(f64::NEG_INFINITY, f64::max);
    Emphasis { opacity: op, ..ctx.focus.at(&format!("l:{i}")) }
}

impl Column {
    pub fn new(scene: &ChartScene, w: f64, h: f64, states: &[ChartState]) -> Column {
        Column { layout: layout_chart(scene, w, h, states) }
    }

    pub fn draw(&self, dl: &mut DisplayList, source: &ChartScene, ctx: &Ctx, box_w: f32, _box_h: f32) {
        let frame = ctx.frame;
        let f = framed(source, ctx.before, ctx.now, ctx.sf.t);
        let t = ctx.sf.t;
        let mut layout = self.layout.clone();
        layout.xs = (0..source.labels.len())
            .map(|i| {
                let (a, b) = (self.layout.xs[f.from[i]], self.layout.xs[f.to[i]]);
                a + (b - a) * t
            })
            .collect();
        let values = &f.values;
        let shown = &f.shown;
        let tl = timeline(source);
        let k = source.series.len();
        let grid_in = interpolate(frame, &[START, START + 14.0], &[0.0, 1.0], CLAMP);
        let point = annotation_point(source, &layout, values);
        let note_steps: Vec<usize> = point
            .as_ref()
            .map(|p| {
                let mut v = ctx.focus.steps(&format!("l:{}", p.label)).to_vec();
                v.extend_from_slice(ctx.focus.steps(&format!("p:{}/{}", p.series, p.label)));
                v
            })
            .unwrap_or_default();
        let note_step = note_steps.iter().min().copied();
        let note_at = note_step.map_or(tl.done_at - 8.0, |k| ctx.segments[k + 1].from);
        let cfg = Spring::damping(16.0).with_stiffness(120.0);
        let note_in = match note_step {
            Some(_) => step_spring(frame, FPS, note_at, note_at, cfg),
            None => spring(frame - note_at, FPS, cfg),
        };
        let pulse = interpolate(frame, &[note_at + 4.0, note_at + 12.0, note_at + 40.0], &[0.0, 1.0, 0.35], CLAMP);
        let bar = source.kind == "bar";

        // The column behind each lit label.
        for i in 0..source.labels.len() {
            let e = emphasis_of(source, ctx, i);
            if e.glow > 0.0 {
                let g = e.glow as f32;
                dl.rect(
                    (layout.xs[i] - layout.slot_w / 2.0 + 6.0) as f32,
                    layout.plot.y0 as f32,
                    (layout.slot_w - 12.0) as f32,
                    (layout.x_label_top - layout.plot.y0 + 40.0) as f32,
                    BoxStyle::fill(Color::rgba8(124, 140, 255, 0.08 * g))
                        .radius(16.0)
                        .border(hex_alpha(ACCENT, js_round(e.glow * 110.0) as u32), 2.0),
                );
            }
        }
        self.grid(dl, &layout, source, grid_in);
        for (i, fit) in layout.x_labels.iter().enumerate() {
            let e = emphasis_of(source, ctx, i);
            dl.group(|dl| {
                dl.fade((grid_in * e.opacity) as f32);
                let lh = js_round(layout.x_label_font * 1.3);
                let color = if e.glow > 0.0 { TEXT } else { label_color() };
                draw_fit(
                    dl,
                    fit,
                    (layout.xs[i] - layout.slot_w / 2.0) as f32,
                    layout.x_label_top as f32,
                    TextOpts::new(color)
                        .line_height(LineHeight::Times((lh / fit.size) as f32))
                        .centered(layout.slot_w as f32),
                );
            });
        }
        // The annotation's leader goes under the data labels.
        let note = point.as_ref().zip(layout.note.as_ref()).map(|(p, text)| {
            let w = 620f64.min(text.width + 52.0);
            let h = text.height + 28.0;
            let left = (box_w as f64 - w).min(layout.axis_w.max(p.x - w / 2.0));
            (text, left, (ANNOTATION_BAND - h) / 2.0 - 6.0, w, h)
        });
        if let (Some(p), Some((_, _, top, _, h))) = (&point, &note) {
            let end = if bar { p.y - VALUE_FONT * 1.25 - 18.0 } else { p.y - 15.0 };
            let from = top + h;
            let color = tone_color(series_tone(&source.series, p.series));
            let (px, y2) = (p.x as f32, (from + (end - from) * note_in) as f32);
            let mut pb = PathBuilder::new();
            pb.move_to(px, from as f32);
            pb.line_to(px, y2);
            if let Some(path) = pb.finish() {
                dl.path(path, None, Some(Stroke::dashed(ACCENT.alpha(0.85), 2.0, 5.0, 6.0)));
            }
            if !bar && let Some(c) = PathBuilder::from_circle(px, p.y as f32, (15.0 + 14.0 * pulse) as f32) {
                dl.path(c, None, Some(Stroke::solid(color.alpha((0.35 + 0.55 * pulse) as f32), 3.0)));
            }
        }
        if bar {
            self.bars(dl, source, ctx, &layout, values, shown, &tl, point.as_ref(), pulse);
        } else {
            self.lines(dl, source, ctx, &layout, values, shown, &tl);
        }
        if shows_badges(source) {
            for i in 0..source.labels.len() {
                let Some((text, dir)) = delta(values[0][i], values[1][i], source.better.as_deref()) else { continue };
                let at = (tl.slot_done_at)(i);
                let appear = spring(frame - at, FPS, Spring::damping(12.0).with_stiffness(150.0));
                let e = emphasis_of(source, ctx, i);
                let y = slot_top(source, &layout, values, i);
                badge(dl, layout.xs[i] as f32, y as f32, &text, dir, appear, e.opacity);
            }
        }
        if let (Some((text, left, top, w, h)), Some(_)) = (&note, &point) {
            draw_note(dl, text, *left as f32, *top as f32, *w as f32, *h as f32, note_in);
        }
        let _ = k;
        // TODO(marks): PenMarks
        // TODO(ink): Ink
        // TODO(camera): the scene's `camera` field
    }

    fn grid(&self, dl: &mut DisplayList, layout: &ChartLayout, scene: &ChartScene, appear: f64) {
        let (x0, x1) = (layout.plot.x0 as f32, layout.plot.x1 as f32);
        for &t in &layout.ticks {
            let y = layout.y(t) as f32;
            let mut pb = PathBuilder::new();
            pb.move_to(x0, y);
            pb.line_to(x0 + (x1 - x0) * appear as f32, y);
            if let Some(path) = pb.finish() {
                let stroke =
                    if t == 0.0 { Stroke::solid(BORDER_STRONG, 2.0) } else { Stroke::dashed(BORDER, 1.5, 4.0, 8.0) };
                dl.path(path, None, Some(stroke));
            }
        }
        for &t in &layout.ticks {
            let text = super::layout::collapse(&format_value(t, scene));
            let st = Style::mono(400.0, 17.0);
            let w = width(&text, st);
            dl.group(|dl| {
                dl.fade(appear as f32);
                put_text(dl, &text, st, (layout.axis_w - 18.0) as f32 - w, (layout.y(t) - 12.0) as f32, 24.0, FAINT);
            });
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn bars(
        &self,
        dl: &mut DisplayList,
        scene: &ChartScene,
        ctx: &Ctx,
        layout: &ChartLayout,
        values: &Vals,
        shown: &Vals,
        tl: &Timeline,
        noted: Option<&NotePoint>,
        pulse: f64,
    ) {
        let frame = ctx.frame;
        let k = scene.series.len();
        let labels = value_labels(scene, layout, values, shown);
        for i in 0..scene.labels.len() {
            for s in 0..k {
                let at = (tl.bar_at)(i, s);
                let grow = spring(frame - at, FPS, Spring::damping(18.0).with_stiffness(110.0));
                let color = tone_color(series_tone(&scene.series, s));
                let below = if scene.stacked { label_total(&values[..s], i) } else { 0.0 };
                let base = layout.y(below);
                let top = layout.y(below + values[s][i]);
                let h = (base - top) * grow;
                let x = bar_x(layout, layout.xs[i], s, k, scene.stacked);
                let top_of_stack = !scene.stacked || s == k - 1;
                let label = interpolate(frame, &[at + 12.0, at + 20.0], &[0.0, 1.0], CLAMP);
                let lit = emphasis_at(ctx, s, i);
                dl.group(|dl| {
                    dl.fade(lit.opacity as f32);
                    let (bx, by, bw, bh) = (x as f32, (base - h) as f32, layout.bar_w as f32, h as f32);
                    let radii = if top_of_stack { [10.0, 10.0, 3.0, 3.0] } else { [3.0; 4] };
                    let mut style = BoxStyle::empty().radius(if top_of_stack { 6.0 } else { 3.0 });
                    style = style.shadow(Shadow::new(0.0, 0.0, 28.0, hex_alpha(color, 0x33)));
                    if noted.is_some_and(|n| n.label == i && n.series == s) {
                        let mut sh =
                            Shadow::new(0.0, 0.0, 0.0, hex_alpha(color, (40.0 + 120.0 * pulse).round() as u32));
                        sh.spread = (3.0 + 6.0 * pulse) as f32;
                        style = style.shadow(sh);
                    }
                    if lit.glow > 0.0 {
                        let g = lit.glow as f32;
                        let mut ring = Shadow::new(0.0, 0.0, 0.0, hex_alpha(TEXT, 0xcc));
                        ring.spread = 4.0 * g;
                        style = style.shadow(ring).shadow(Shadow::new(0.0, 0.0, 36.0 * g, color));
                    }
                    dl.rect(bx, by, bw, bh, style);
                    if let Some(path) = rrect(bx, by, bw, bh, radii) {
                        dl.path(path, Some(Paint::vertical(by, by + bh, color, hex_alpha(color, 0xaa))), None);
                    }
                    if bh > 2.0 {
                        let r = if top_of_stack { 10.0f32.min(bw / 2.0) } else { 3.0 };
                        dl.fill_rect(bx + r * 0.3, by, bw - r * 0.6, 1.0, Color::rgba8(255, 255, 255, 0.25));
                    }
                    if scene.stacked {
                        segment_value(
                            dl,
                            x as f32,
                            layout.bar_w as f32,
                            (base - h) as f32,
                            h as f32,
                            &super::layout::collapse(&format_value(shown[s][i], scene)),
                            label,
                        );
                    }
                    if let Some(v) = labels.iter().find(|v| v.series == s && v.label == i) {
                        value_label(dl, v, if s == k - 1 { TEXT } else { Color::css("#b9c0d0") }, label);
                    }
                });
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn lines(
        &self,
        dl: &mut DisplayList,
        scene: &ChartScene,
        ctx: &Ctx,
        layout: &ChartLayout,
        values: &Vals,
        shown: &Vals,
        tl: &Timeline,
    ) {
        let frame = ctx.frame;
        let (x0, x1, y1) = (layout.plot.x0, layout.plot.x1, layout.plot.y1);
        let k = scene.series.len();
        let n = scene.labels.len();
        for s in 0..k {
            let r = interpolate(frame, &[(tl.draw_at)(s), (tl.draw_at)(s) + tl.draw_frames], &[0.0, 1.0], CLAMP);
            let reveal = 1.0 - (1.0 - r) * (1.0 - r);
            let (first, last) = (layout.xs[0], layout.xs[n - 1]);
            let tone = tone_color(series_tone(&scene.series, s));
            let opacity = (0..n).map(|i| emphasis_at(ctx, s, i).opacity).fold(f64::NEG_INFINITY, f64::max);
            let pts: Vec<(f32, f32)> = (0..n).map(|i| (layout.xs[i] as f32, layout.y(values[s][i]) as f32)).collect();
            dl.push_clip(
                (x0 - 20.0) as f32,
                -200.0,
                (first - x0 + 20.0 + (last - first) * reveal + 14.0) as f32,
                (y1 + 400.0) as f32,
                0.0,
            );
            dl.push_layer(opacity as f32);
            if k == 1 || (k == 2 && s == 1) {
                let base = layout.y(layout.ticks[0].max(0.0)) as f32;
                let mut pb = PathBuilder::new();
                pb.move_to(pts[0].0, base);
                for p in &pts {
                    pb.line_to(p.0, p.1);
                }
                pb.line_to(pts[n - 1].0, base);
                pb.close();
                let top = pts.iter().map(|p| p.1).fold(base, f32::min);
                if let Some(path) = pb.finish() {
                    dl.path(path, Some(Paint::vertical(top, base, tone.alpha(0.22), tone.alpha(0.0))), None);
                }
            }
            let mut pb = PathBuilder::new();
            pb.move_to(pts[0].0, pts[0].1);
            for p in &pts[1..] {
                pb.line_to(p.0, p.1);
            }
            if let Some(path) = pb.finish() {
                let w = if s == k - 1 { 5.0 } else { 4.0 };
                let stroke = if s == 0 && k > 1 && scene.series[s].tone.is_none() {
                    Stroke::dashed(tone, w, 2.0, 10.0).rounded()
                } else {
                    Stroke::solid(tone, w).rounded()
                };
                dl.path(path, None, Some(stroke));
            }
            dl.pop_layer();
            dl.pop_clip();
        }
        for s in 0..k {
            for i in 0..n {
                let tone = tone_color(series_tone(&scene.series, s));
                let at = (tl.draw_at)(s) + tl.draw_frames * ((layout.xs[i] - layout.xs[0]) / (x1 - x0).max(1.0));
                let pop = interpolate(frame, &[at, at + 8.0], &[0.0, 1.0], CLAMP);
                let lit = emphasis_at(ctx, s, i);
                let glow = lit.glow.max(ctx.focus.at(&format!("l:{i}")).glow);
                let r = ((8.0 + 3.0 * glow) * pop) as f32;
                if r > 0.0
                    && let Some(c) = PathBuilder::from_circle(layout.xs[i] as f32, layout.y(values[s][i]) as f32, r)
                {
                    dl.group(|dl| {
                        dl.fade(lit.opacity as f32);
                        dl.path(c, Some(BG.into()), Some(Stroke::solid(tone, 4.0)));
                    });
                }
            }
        }
        for v in value_labels(scene, layout, values, shown) {
            let at = (tl.draw_at)(v.series)
                + tl.draw_frames * ((layout.xs[v.label] - layout.xs[0]) / (x1 - x0).max(1.0))
                + 4.0;
            let appear =
                interpolate(frame, &[at, at + 8.0], &[0.0, 1.0], CLAMP) * emphasis_at(ctx, v.series, v.label).opacity;
            value_label(dl, &v, if v.series == k - 1 { TEXT } else { Color::css("#b9c0d0") }, appear);
        }
    }
}

/// A stacked segment's own value, inside it, when the segment is tall and wide enough to hold it.
fn segment_value(dl: &mut DisplayList, x: f32, w: f32, top: f32, h: f32, text: &str, appear: f64) {
    let size = 17.0f32;
    if h < size * 1.9 || text.chars().count() as f32 * size * 0.62 + 12.0 > w {
        return;
    }
    dl.group(|dl| {
        dl.fade(appear as f32 * 0.9);
        let st = Style::mono(700.0, size);
        let lh = line_metrics(Face::Mono, size).normal;
        let tw = width(text, st);
        dl.text(text, st, x + (w - tw) / 2.0, top + (h - lh) / 2.0 + baseline_in(Face::Mono, size, lh), BG);
    });
}

fn badge(dl: &mut DisplayList, x: f32, y: f32, text: &str, direction: Direction, appear: f64, wrap: f64) {
    let (color, bg) = crate::theme::tone(match direction {
        Direction::Good => "good",
        Direction::Bad => "bad",
        Direction::Neutral => "accent",
    });
    let st = Style::mono(800.0, 19.0);
    let tw = width(text, st);
    let (w, h) = (tw + 24.0 + 3.0, BADGE_H as f32 + 3.0);
    let top = y - BADGE_H as f32;
    dl.group(|dl| {
        dl.fade((appear.min(1.0) * wrap) as f32);
        dl.scale_about((0.6 + 0.4 * appear) as f32, x, top + h);
        dl.rect(x - w / 2.0, top, w, h, BoxStyle::fill(Color::css("#0d0f16")).radius(999.0));
        dl.rect(x - w / 2.0, top, w, h, BoxStyle::fill(bg).radius(999.0).border(hex_alpha(color, 0xaa), 1.5));
        let lh = line_metrics(Face::Mono, 19.0).normal;
        dl.text(
            text,
            st,
            x - tw / 2.0,
            top + 1.5 + (BADGE_H as f32 - lh) / 2.0 + baseline_in(Face::Mono, 19.0, lh),
            color,
        );
    });
}

fn draw_note(dl: &mut DisplayList, text: &Fit, left: f32, top: f32, w: f32, h: f32, appear: f64) {
    dl.group(|dl| {
        dl.fade(appear.clamp(0.0, 1.0) as f32);
        dl.translate(0.0, (1.0 - appear) as f32 * 14.0);
        dl.scale_about((0.95 + 0.05 * appear) as f32, left + w / 2.0, top + h / 2.0);
        let style = BoxStyle::fill(Paint::vertical(top, top + h, Color::css("#1d2136"), Color::css("#161a2a")))
            .radius(16.0)
            .border(hex_alpha(ACCENT, 0x88), 1.0)
            .shadow(Shadow::new(0.0, 18.0, 48.0, Color::rgba8(0, 0, 0, 0.5)))
            .shadow(Shadow::new(0.0, 0.0, 32.0, ACCENT_SOFT));
        dl.rect(left, top, w, h, style);
        draw_fit(dl, text, left + 27.0, top + 15.0, TextOpts::new(TEXT).centered(w - 54.0));
    });
}
