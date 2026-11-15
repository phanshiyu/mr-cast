//! The timeline scene: an axis with its events as cards on leaders, spans as bands under it, and a playhead that
//! sweeps along as the voice goes. A port of src/components/Timeline.tsx and src/utils/timelineLayout.ts.

#![allow(clippy::collapsible_if, clippy::too_many_arguments, clippy::needless_range_loop)]

mod format;
mod layout;

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::fittext::{TextOpts, draw_fit};
use crate::chrome::marks::{
    BadgeSpec, EMPHASIS_COLOR, EMPHASIS_GLOW, Marks, badge_box, badges_of, draw_badge, draw_corner_badges,
    emphasis_card, emphasis_ring, ring,
};
use crate::chrome::shell::Shell;
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Path, PathBuilder, Shadow, Stroke};
use crate::geom::partial_polyline;
use crate::steps::{Emphasis, FocusSpotlight, reveal_starts, step_spring};
use crate::targets::{step_targets, target_steps};
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::{Family, Font, measure};
use crate::theme::{ACCENT, ACCENT_GLOW, BG, BORDER_STRONG, FAINT, MUTED, RAISED, TEXT, content_box, tone};
use crate::timing::{FPS, Segment, build_frames};
use format::format_value;
use layout::{Event, Layout, PlacedEvent, PlacedSpan, SPAN_H, STAMP_FONT, Span, layout_timeline, timeline_scale};
use serde::Deserialize;

const START: f64 = 10.0;
/// Frames an event takes to rise in after the playhead reaches it.
const RISE_FRAMES: f64 = 14.0;
/// Frames the playhead takes to move to a step's events.
const TRAVEL_FRAMES: f64 = 8.0;

#[derive(Deserialize)]
struct EventIn {
    at: f64,
    label: String,
    detail: Option<String>,
    #[serde(flatten)]
    marks: Marks,
}

#[derive(Deserialize)]
struct SpanIn {
    from: f64,
    to: f64,
    label: String,
    #[serde(flatten)]
    marks: Marks,
}

#[derive(Deserialize)]
struct TimelineScene {
    title: Option<String>,
    unit: Option<String>,
    prefix: Option<String>,
    events: Vec<EventIn>,
    spans: Option<Vec<SpanIn>>,
}

struct View {
    shell: Shell,
    scene: serde_json::Value,
    events: Vec<EventIn>,
    spans: Vec<SpanIn>,
    unit: Option<String>,
    layout: Layout,
    box_size: (f64, f64),
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: TimelineScene = parse(input)?;
    if scene.events.is_empty() {
        return Err("a timeline without events".into());
    }
    let box_size = content_box(scene.title.is_some());
    let spans = scene.spans.unwrap_or_default();
    let layout = layout_timeline(
        &scene
            .events
            .iter()
            .map(|e| Event { at: e.at, label: e.label.clone(), detail: e.detail.clone() })
            .collect::<Vec<_>>(),
        &spans.iter().map(|s| Span { from: s.from, to: s.to, label: s.label.clone() }).collect::<Vec<_>>(),
        scene.unit.as_deref(),
        scene.prefix.as_deref(),
        box_size.0,
    );
    Ok(Box::new(View {
        shell: Shell::new(input.scene),
        scene: input.scene.clone(),
        events: scene.events,
        spans,
        unit: scene.unit,
        layout,
        box_size,
    }))
}

/// Per step, the last event drawn by its end and the furthest value it focuses, both never moving back.
fn step_reach(scene: &serde_json::Value, events: &[EventIn], spans: &[SpanIn]) -> (Vec<i64>, Vec<f64>) {
    let (mut last, mut value) = (-1i64, f64::NEG_INFINITY);
    let (mut lasts, mut values) = (Vec::new(), Vec::new());
    for keys in step_targets(scene) {
        for k in &keys {
            if let Some(i) = k.strip_prefix("ev:").and_then(|n| n.parse::<usize>().ok()) {
                last = last.max(i as i64);
                if let Some(e) = events.get(i) {
                    value = value.max(e.at);
                }
            } else if let Some(i) = k.strip_prefix("sp:").and_then(|n| n.parse::<usize>().ok()) {
                if let Some(s) = spans.get(i) {
                    value = value.max(s.from.max(s.to));
                }
            }
        }
        lasts.push(last);
        values.push(value);
    }
    (lasts, values)
}

struct Playhead {
    times: Vec<f64>,
    xs: Vec<f64>,
    stepped: bool,
    step_from: Vec<f64>,
}

/// When an event appears, and the start of the step that brings it, if one does.
struct EventTiming {
    at: f64,
    step_from: Option<f64>,
}

impl Playhead {
    fn new(v: &View, segments: &[Segment]) -> Playhead {
        let layout = &v.layout;
        let mut values: Vec<f64> =
            v.events.iter().map(|e| e.at).chain(v.spans.iter().flat_map(|s| [s.from, s.to])).collect();
        values.sort_by(|a, b| a.total_cmp(b));
        values.dedup();
        let start_x = layout.ticks[0].0;
        let end_x = layout.x(values[values.len() - 1]);
        let mut times = vec![START + 4.0];
        let mut xs = vec![start_x];
        let (lasts, reach) = step_reach(&v.scene, &v.events, &v.spans);
        if !reach.is_empty() && segments.len() > 1 {
            for (k, &value) in reach.iter().enumerate() {
                let at = segments.get(k + 1).map_or(0.0, |s| s.from);
                let target = if k == reach.len() - 1 {
                    end_x
                } else if value.is_finite() {
                    layout.x(value)
                } else {
                    start_x
                };
                times.push(at);
                times.push(at + TRAVEL_FRAMES);
                xs.push(xs[xs.len() - 1]);
                xs.push(target);
            }
        } else {
            let first = START + 12.0;
            let last = build_frames("timeline") - RISE_FRAMES;
            for (i, &value) in values.iter().enumerate() {
                times.push(if values.len() == 1 {
                    first
                } else {
                    first + (i as f64 / (values.len() as f64 - 1.0)) * (last - first)
                });
                xs.push(layout.x(value));
            }
        }
        let stepped = !lasts.is_empty() && segments.len() > 1;
        let step_from = reveal_starts(segments, v.events.len(), &lasts, 0.0, 0.0, 0.0, 0.0);
        Playhead { times, xs, stepped, step_from }
    }

    fn play_x(&self, frame: f64) -> f64 {
        interpolate(frame, &self.times, &self.xs, CLAMP)
    }

    /// The first frame the playhead reaches `value`.
    fn reached_at(&self, layout: &Layout, value: f64) -> f64 {
        let x = layout.x(value);
        if x <= self.xs[0] {
            return self.times[0];
        }
        for i in 1..self.xs.len() {
            if self.xs[i] > self.xs[i - 1] && x <= self.xs[i] {
                return self.times[i - 1]
                    + ((x - self.xs[i - 1]) / (self.xs[i] - self.xs[i - 1])) * (self.times[i] - self.times[i - 1]);
            }
        }
        self.times[self.times.len() - 1]
    }

    fn event_at(&self, layout: &Layout, events: &[EventIn], index: usize) -> EventTiming {
        let reached = self.reached_at(layout, events[index].at);
        if self.stepped {
            let from = self.step_from.get(index).copied().unwrap_or(f64::NAN);
            EventTiming { at: from.max(reached - TRAVEL_FRAMES / 2.0), step_from: Some(from) }
        } else {
            EventTiming { at: reached, step_from: None }
        }
    }

    fn last(&self) -> f64 {
        self.times[self.times.len() - 1]
    }
}

struct Motion {
    pop: f64,
    rise: f64,
    flash: f64,
}

fn event_motion(frame: f64, t: &EventTiming) -> Motion {
    let motion = |delay: f64, config: Spring| match t.step_from {
        None => spring(frame - t.at - delay, FPS, config),
        Some(from) => step_spring(frame, FPS, t.at + delay, from, config),
    };
    Motion {
        pop: motion(0.0, Spring::damping(12.0).with_stiffness(170.0)),
        rise: motion(3.0, Spring::damping(17.0).with_stiffness(120.0)),
        flash: interpolate(frame, &[t.at, t.at + 6.0, t.at + 30.0], &[0.0, 1.0, 0.0], CLAMP),
    }
}

fn stroke_path(points: &[(f64, f64)]) -> Option<Path> {
    crate::geom::polyline(points)
}

fn circle_path(cx: f32, cy: f32, r: f32) -> Option<Path> {
    PathBuilder::from_circle(cx, cy, r)
}

fn with_alpha(c: Color, a: f32) -> Color {
    c.alpha(a)
}

impl View {
    fn event_mark(&self, dl: &mut DisplayList, p: &PlacedEvent, t: &EventTiming, frame: f64) {
        let ev = &self.events[p.index];
        let (color, _) = tone(ev.marks.tone.as_deref().unwrap_or("accent"));
        let m = event_motion(frame, t);
        let rise = m.rise.clamp(0.0, 1.0);
        if rise > 0.0 {
            let (pts, _) = partial_polyline(&p.stem, rise);
            if let Some(path) = stroke_path(&pts) {
                let mut s = Stroke::solid(with_alpha(color, color.a * 0.6), 2.0);
                s.round = false;
                dl.path(path, None, Some(s));
            }
        }
        let axis_y = self.layout.axis_y as f32;
        let r_ring = ((18.0 + 14.0 * m.flash) * m.pop.min(1.0)) as f32;
        if r_ring > 0.0 && m.flash > 0.0 {
            if let Some(c) = circle_path(p.x as f32, axis_y, r_ring) {
                dl.path(c, None, Some(Stroke::solid(color.fade(0.5 * m.flash as f32), 3.0)));
            }
        }
        let r = (10.0 * m.pop).max(0.0) as f32;
        if r > 0.0 {
            if let Some(c) = circle_path(p.x as f32, axis_y, r) {
                dl.path(c, Some(color.into()), Some(Stroke::solid(BG, 3.0)));
            }
        }
    }

    fn event_card(&self, dl: &mut DisplayList, p: &PlacedEvent, t: &EventTiming, frame: f64, e: Emphasis) {
        let ev = &self.events[p.index];
        let (color, _) = tone(ev.marks.tone.as_deref().unwrap_or("accent"));
        let m = event_motion(frame, t);
        let (x, y, w, h) = (p.box_.0 as f32, p.box_.1 as f32, p.box_.2 as f32, p.box_.3 as f32);
        let hi = ev.marks.highlighted();
        let flash = m.flash as f32;
        let g = e.glow as f32;
        let border = if hi {
            EMPHASIS_COLOR
        } else {
            color.fade(if flash > 0.0 { 0xcc as f32 / 255.0 } else { 0x66 as f32 / 255.0 })
        };
        let mut shadows: Vec<Shadow> = if hi {
            emphasis_ring(5.0, 40.0).to_vec()
        } else {
            vec![Shadow::new(0.0, 14.0, 36.0, Color::rgba8(0, 0, 0, 0.45))]
        };
        shadows.push(Shadow::new(0.0, 0.0, 30.0 * flash, color.fade(0x55 as f32 / 255.0)));
        if g > 0.0 {
            shadows.push(ring(3.0 * g, color));
            shadows.push(Shadow::new(0.0, 0.0, 40.0 * g, color.fade(0x66 as f32 / 255.0)));
        }
        let opacity = (m.rise * e.opacity).clamp(0.0, 1.0) as f32;
        dl.group(|dl| {
            let layered = opacity < 1.0;
            if layered {
                dl.push_layer(opacity);
            }
            let rise = m.rise as f32;
            dl.translate(0.0, (1.0 - rise) * 18.0);
            dl.scale_about(1.0 + 0.03 * g, x + w / 2.0, y + h / 2.0);
            let fill: crate::display::Paint = if hi { emphasis_card(y, h) } else { RAISED.into() };
            let mut style = BoxStyle::fill(fill).radius(14.0).border(border, 1.0);
            style.shadows = shadows;
            dl.rect(x, y, w, h, style);
            // Chrome draws a 1.5px border as 1px.
            let (cx, mut top) = (x + 1.0 + BOX_PAD_X, y + 1.0 + BOX_PAD_Y);
            dl.text(
                &p.stamp,
                Style::mono(700.0, STAMP_FONT as f32),
                cx,
                top + baseline_in(Face::Mono, STAMP_FONT as f32, 24.0),
                color,
            );
            top += 24.0;
            top += draw_fit(dl, &p.label, cx, top, TextOpts::new(TEXT));
            if let Some(d) = &p.detail {
                draw_fit(dl, d, cx, top, TextOpts::new(MUTED));
            }
            draw_corner_badges(dl, &badges_of(&ev.marks), 12.0, x + w - 1.0 - 12.0, y + 1.0 - 12.0);
            if layered {
                dl.pop_layer();
            }
        });
    }

    fn span_bar(&self, dl: &mut DisplayList, p: &PlacedSpan, play_x: f64, done_at: f64, frame: f64, e: Emphasis) {
        let sp = &self.spans[p.index];
        let (color, bg) = tone(sp.marks.tone.as_deref().unwrap_or("warn"));
        let full = p.x1 - p.x0;
        let w = 0.0f64.max(full.min(play_x - p.x0));
        let label_op = interpolate(frame, &[done_at - 4.0, done_at + 8.0], &[0.0, 1.0], CLAMP);
        let duration = format_value((sp.to - sp.from).abs(), self.unit.as_deref(), None);
        let room = full - 24.0 - p.label.width - measure(&duration, &Font::new(Family::Mono, 600.0, 17.0)) - 20.0;
        let g = e.glow as f32;
        let hi = sp.marks.highlighted();
        dl.group(|dl| {
            let opacity = e.opacity.clamp(0.0, 1.0) as f32;
            let layered = opacity < 1.0;
            if layered {
                dl.push_layer(opacity);
            }
            let (x, y, wf, h) = (p.x0 as f32, p.y as f32, w as f32, SPAN_H as f32);
            if wf > 0.0 {
                let mut style = BoxStyle::fill(bg).radius(10.0);
                if g > 0.0 {
                    style = style.shadow(Shadow::new(0.0, 0.0, 36.0 * g, color.fade(0x77 as f32 / 255.0)));
                } else if hi {
                    style = style.shadow(Shadow::new(0.0, 0.0, 26.0, EMPHASIS_GLOW));
                }
                // `repeating-linear-gradient(135deg, bg 0 10px, transparent 10px 18px)` over the same fill.
                dl.rect(x, y, wf, h, style);
                dl.push_clip(x, y, wf, h, 10.0);
                let len = (wf + h) / std::f32::consts::SQRT_2;
                let centre = x + wf / 2.0 + y + h / 2.0;
                let mut t = 0.0f32;
                while t < len {
                    let c0 = centre + std::f32::consts::SQRT_2 * (t - len / 2.0);
                    let c1 = centre + std::f32::consts::SQRT_2 * (t + 10.0 - len / 2.0);
                    let mut pb = PathBuilder::new();
                    pb.move_to(c0 - y, y);
                    pb.line_to(c1 - y, y);
                    pb.line_to(c1 - (y + h), y + h);
                    pb.line_to(c0 - (y + h), y + h);
                    pb.close();
                    if let Some(path) = pb.finish() {
                        dl.path(path, Some(bg.into()), None);
                    }
                    t += 18.0;
                }
                dl.pop_clip();
                let edge = if hi {
                    EMPHASIS_COLOR
                } else if g > 0.0 {
                    color
                } else {
                    color.fade(0x99 as f32 / 255.0)
                };
                dl.rect(x, y, wf, h, BoxStyle::empty().radius(10.0).border(edge, 1.0));
            }
            // The label, inside the bar or after it.
            dl.group(|dl| {
                dl.fade(label_op as f32);
                let cy = y + h / 2.0;
                let left = if p.inside { x + 12.0 } else { p.x1 as f32 + 12.0 };
                let size = p.label.size as f32;
                let lh = line_metrics(Face::Sans, size).normal;
                let badges: Vec<BadgeSpec> = badges_of(&sp.marks);
                draw_fit(dl, &p.label, left, cy - lh / 2.0, TextOpts::new(color).normal());
                let mut bx = left + p.label.width as f32 + 10.0;
                for b in &badges {
                    let bh = badge_box(b, 12.0).1;
                    bx += draw_badge(dl, b, 12.0, bx, cy - bh / 2.0) + 10.0;
                }
                if p.inside && room > 0.0 {
                    let st = Style::mono(600.0, 17.0);
                    let mh = line_metrics(Face::Mono, 17.0).normal;
                    let dw = width(&duration, st);
                    dl.group(|dl| {
                        dl.fade(0.8);
                        dl.text(
                            &duration,
                            st,
                            p.x1 as f32 - 12.0 - dw,
                            cy - mh / 2.0 + baseline_in(Face::Mono, 17.0, mh),
                            color,
                        );
                    });
                }
            });
            if layered {
                dl.pop_layer();
            }
        });
    }
}

const BOX_PAD_X: f32 = 18.0;
const BOX_PAD_Y: f32 = 12.0;

impl SceneView for View {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let layout = &self.layout;
        let (bw, bh) = self.box_size;
        let playhead = Playhead::new(self, f.segments);
        let scale = timeline_scale(layout, bh);
        let left = (bw - layout.width * scale) / 2.0;
        let top = 0.0f64.max(bh - layout.height * scale) * 0.4;
        let play_x = playhead.play_x(frame);
        let emphasis = FocusSpotlight::new(target_steps(&self.scene), f.segments, frame);
        let axis_in = interpolate(frame, &[START, START + 10.0], &[0.0, 1.0], CLAMP) as f32;
        let head_opacity = interpolate(
            frame,
            &[START + 2.0, START + 8.0, playhead.last() + 6.0, playhead.last() + 18.0],
            &[0.0, 1.0, 1.0, 0.0],
            CLAMP,
        );
        let axis_y = layout.axis_y as f32;
        let (lx, rx) = (layout.ticks[0].0 as f32, layout.ticks[layout.ticks.len() - 1].0 as f32);

        self.shell.draw(dl, frame, f.duration, None, |dl, _| {
            dl.translate(left as f32, top as f32);
            dl.scale_about(scale as f32, 0.0, 0.0);
            // The axis, its played part and its ticks.
            dl.group(|dl| {
                dl.fade(axis_in);
                if let Some(p) = stroke_path(&[(lx as f64, axis_y as f64), (rx as f64, axis_y as f64)]) {
                    dl.path(p, None, Some(Stroke::dashed(BORDER_STRONG, 3.0, 2.0, 9.0).rounded()));
                }
            });
            let px = lx.max(play_x as f32);
            if px > lx {
                if let Some(p) = stroke_path(&[(lx as f64, axis_y as f64), (px as f64, axis_y as f64)]) {
                    dl.path(p, None, Some(Stroke::solid(TEXT.fade(0.75), 4.0).rounded()));
                }
            }
            dl.group(|dl| {
                dl.fade(axis_in);
                for (x, _) in &layout.ticks {
                    dl.fill_rect(*x as f32 - 1.0, axis_y - 8.0, 2.0, 16.0, FAINT);
                }
                let st = Style::mono(400.0, 17.0);
                let lh = line_metrics(Face::Mono, 17.0).normal;
                for (x, text) in &layout.ticks {
                    let w = width(text, st);
                    dl.text(text, st, *x as f32 - w / 2.0, axis_y + 14.0 + baseline_in(Face::Mono, 17.0, lh), FAINT);
                }
            });
            for (i, p) in layout.spans.iter().enumerate() {
                let sp = &self.spans[p.index];
                let done = playhead.reached_at(layout, sp.from.max(sp.to));
                self.span_bar(dl, p, play_x, done, frame, emphasis.emphasis(&format!("sp:{i}")));
            }
            for p in &layout.events {
                self.event_mark(dl, p, &playhead.event_at(layout, &self.events, p.index), frame);
            }
            for p in &layout.events {
                let t = playhead.event_at(layout, &self.events, p.index);
                self.event_card(dl, p, &t, frame, emphasis.emphasis(&format!("ev:{}", p.index)));
            }
            dl.group(|dl| {
                dl.fade(head_opacity as f32);
                dl.rect(
                    play_x as f32 - 1.5,
                    axis_y - 26.0,
                    3.0,
                    52.0,
                    BoxStyle::fill(ACCENT).radius(2.0).shadow(Shadow::new(0.0, 0.0, 18.0, ACCENT_GLOW)),
                );
            });
            // TODO(marks): pen marks over the timeline.
            // TODO(camera): the generic `camera` field.
        });
    }
}
