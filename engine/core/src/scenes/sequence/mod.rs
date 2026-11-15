//! The sequence scene: participants across the top, lifelines, activation bars, and messages as arrows with their
//! labels and notes, drawn in as the voice reaches them. A port of src/components/SequenceDiagram.tsx,
//! src/utils/sequenceLayout.ts and src/utils/sequenceCamera.ts.

mod camera;
mod layout;

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::backdrop;
use crate::chrome::fittext::{Align as TextAlign, TextOpts, draw_fit};
use crate::chrome::marks::{EMPHASIS_COLOR, EMPHASIS_GLOW, badges_of, draw_corner_badges};
use crate::chrome::nodecard::{self, CardSize, Node, node_mark, strike_with};
use crate::chrome::shell::Shell;
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, PathBuilder, Shadow, Stroke};
use crate::geom::{partial_polyline, polyline, rounded_rect};
use crate::icons;
use crate::steps::{FocusSpotlight, current_step, reveal_starts};
use crate::targets::{step_targets, target_steps};
use crate::theme::{ACCENT, ACCENT_GLOW, ADD, BORDER, DEL, MUTED, TEXT, content_box};
use crate::timing::{FPS, build_frames};
use camera::{Camera, sequence_camera};
use layout::{Align, BAR_W, CARD_H, Kind, Layout, Message, PlacedMessage, layout_sequence, sequence_scale};
use serde::Deserialize;
use std::collections::BTreeSet;

const HEADER_START: f64 = 6.0;
const HEADERS_END: f64 = 14.0;
const LIFELINE_START: f64 = 12.0;
const LIFELINE_FRAMES: f64 = 16.0;
const MESSAGES_START: f64 = 20.0;
const DRAW_FRAMES: f64 = 10.0;
/// Frames from a message's start until its label has faded in.
const MESSAGE_FRAMES: f64 = DRAW_FRAMES * 1.2;
/// Frames between the messages one step reveals.
const STEP_STAGGER: f64 = 2.0;
const HEAD: f64 = 14.0;
/// Room under the participants where scrolled messages fade out rather than meet the cards.
const FADE: f64 = 28.0;

const NEUTRAL_STROKE: Color = Color::rgba8(0xc4, 0xca, 0xd8, 1.0);
const RETURN_STROKE: Color = Color::rgba8(170, 178, 200, 0.62);
const NOTE_AMBER: Color = Color::rgba8(251, 191, 36, 0.45);

#[derive(Deserialize)]
struct SequenceScene {
    title: Option<String>,
    participants: Vec<Node>,
    messages: Vec<Message>,
}

struct View {
    shell: Shell,
    scene: serde_json::Value,
    participants: Vec<Node>,
    layout: Layout,
    box_size: (f64, f64),
    /// Per step, the last message drawn by its end, and the messages it lights.
    lasts: Vec<i64>,
    lit: Vec<BTreeSet<usize>>,
}

/// The messages each step lights, and the last message drawn by the end of each step: a step draws every message
/// up to the last one it or an earlier step focuses, and the last step also draws and lights any after.
fn message_steps(scene: &serde_json::Value, count: usize) -> (Vec<i64>, Vec<BTreeSet<usize>>) {
    let focused: Vec<Vec<usize>> = step_targets(scene)
        .into_iter()
        .map(|keys| keys.iter().filter_map(|k| k.strip_prefix("m:")?.parse().ok()).collect())
        .collect();
    let mut reach = -1i64;
    let lasts: Vec<i64> = focused
        .iter()
        .map(|ms| {
            reach = ms.iter().fold(reach, |r, &m| r.max(m as i64));
            reach
        })
        .collect();
    let lit = focused
        .iter()
        .enumerate()
        .map(|(k, ms)| {
            let mut set: BTreeSet<usize> = ms.iter().copied().collect();
            if k == focused.len() - 1 {
                let from =
                    ms.iter().fold(-1i64, |r, &m| r.max(m as i64)).max(if k > 0 { lasts[k - 1] } else { -1 }) + 1;
                for i in from..count as i64 {
                    set.insert(i as usize);
                }
            }
            set
        })
        .collect();
    (lasts, lit)
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: SequenceScene = parse(input)?;
    let box_size = content_box(scene.title.is_some());
    let layout = layout_sequence(&scene.participants, &scene.messages, box_size);
    let (lasts, lit) = message_steps(input.scene, layout.messages.len());
    Ok(Box::new(View {
        shell: Shell::new(input.scene),
        scene: input.scene.clone(),
        participants: scene.participants,
        layout,
        box_size,
        lasts,
        lit,
    }))
}

struct MessageMark {
    stroke: Color,
    glow: Color,
    label_bg: Color,
    label_text: Color,
}

/// How a message is marked: by what the diff does to it, else as highlighted, else not at all.
fn message_mark(m: &Message) -> Option<MessageMark> {
    match m.marks.change.as_deref() {
        Some("modified") => Some(MessageMark {
            stroke: ACCENT,
            glow: ACCENT_GLOW,
            label_bg: Color::css("#141834"),
            label_text: Color::css("#cdd3ff"),
        }),
        Some("added") => Some(MessageMark {
            stroke: ADD,
            glow: Color::rgba8(61, 220, 151, 0.4),
            label_bg: Color::css("#10201b"),
            label_text: Color::css("#c4f3dd"),
        }),
        Some("removed") => Some(MessageMark {
            stroke: DEL,
            glow: Color::TRANSPARENT,
            label_bg: Color::css("#1e1216"),
            label_text: MUTED,
        }),
        _ if m.marks.highlighted() => Some(MessageMark {
            stroke: EMPHASIS_COLOR,
            glow: EMPHASIS_GLOW,
            label_bg: Color::css("#1f2026"),
            label_text: TEXT,
        }),
        _ => None,
    }
}

fn draw_arrow(dl: &mut DisplayList, m: &PlacedMessage, draw: f64, current: bool) {
    if draw <= 0.0 {
        return;
    }
    let kind = m.kind;
    let mark = message_mark(&m.message);
    let removed = m.message.marks.change.as_deref() == Some("removed");
    let stroke = mark.as_ref().map_or(if kind == Kind::Return { RETURN_STROKE } else { NEUTRAL_STROKE }, |k| k.stroke);
    let (points, angle) = partial_polyline(&m.points, draw);
    let tip = points[points.len() - 1];
    let width = (if kind == Kind::Return { 2.5 } else { 3.0 }) + if current { 0.75 } else { 0.0 };
    let opacity = if removed {
        0.7
    } else if mark.is_some() && kind == Kind::Return {
        0.85
    } else {
        1.0
    };
    let layer = opacity < 1.0;
    if layer {
        dl.push_layer(opacity);
    }
    if let (Some(k), false) = (&mark, removed) {
        let strength = if m.message.marks.highlighted() && m.message.marks.change.is_none() {
            0.7
        } else if current {
            0.55
        } else {
            0.35
        };
        if let Some(p) = polyline(&points) {
            dl.path(p, None, Some(Stroke::solid(k.glow.fade(strength), if current { 14.0 } else { 10.0 }).rounded()));
        }
    }
    if let Some(p) = polyline(&points) {
        let s = if kind == Kind::Return || removed {
            Stroke::dashed(stroke, width as f32, 10.0, 8.0)
        } else {
            Stroke::solid(stroke, width as f32)
        };
        dl.path(p, None, Some(s));
    }
    let (sin, cos) = angle.sin_cos();
    let at = |px: f64, py: f64| ((tip.0 + px * cos - py * sin) as f32, (tip.1 + px * sin + py * cos) as f32);
    let mut pb = PathBuilder::new();
    match kind {
        Kind::Call => {
            let (a, b, c) = (at(0.0, 0.0), at(-HEAD, -HEAD * 0.5), at(-HEAD, HEAD * 0.5));
            pb.move_to(a.0, a.1);
            pb.line_to(b.0, b.1);
            pb.line_to(c.0, c.1);
            pb.close();
        }
        Kind::Return => {
            let (a, b, c) = (at(-HEAD, -HEAD * 0.55), at(0.0, 0.0), at(-HEAD, HEAD * 0.55));
            pb.move_to(a.0, a.1);
            pb.line_to(b.0, b.1);
            pb.line_to(c.0, c.1);
        }
        Kind::Async => {
            let (a, b) = (at(-HEAD, -HEAD * 0.6), at(0.0, 0.0));
            pb.move_to(a.0, a.1);
            pb.line_to(b.0, b.1);
        }
    }
    if let Some(p) = pb.finish() {
        let (fill, w) = if kind == Kind::Call { (Some(stroke.into()), 1.0) } else { (None, width as f32) };
        dl.path(p, fill, Some(Stroke::solid(stroke, w).rounded()));
    }
    if layer {
        dl.pop_layer();
    }
}

fn draw_label(dl: &mut DisplayList, m: &PlacedMessage, appear: f64, current: bool) {
    let label = &m.label;
    let mark = message_mark(&m.message);
    let removed = m.message.marks.change.as_deref() == Some("removed");
    let fit = &label.text;
    let w = (fit.width + 24.0).min(label.max_width) as f32;
    let h = (fit.lines.len() as f64 * fit.size * 1.35 + 6.0 + 2.0) as f32;
    let (ox, oy) = match label.align {
        Align::Center => (-w / 2.0, -h),
        Align::Right => (-w, -h / 2.0),
        Align::Left => (0.0, -h / 2.0),
    };
    let border = match &mark {
        Some(k) => k.stroke,
        None if current => Color::rgba8(255, 255, 255, 0.32),
        None => BORDER,
    };
    let mut style =
        BoxStyle::fill(mark.as_ref().map_or(Color::css("#0d0f16"), |k| k.label_bg)).radius(8.0).border(border, 1.0);
    if current || (m.message.marks.highlighted() && m.message.marks.change.is_none()) {
        let glow = match &mark {
            Some(k) if !removed => k.glow,
            _ => Color::rgba8(255, 255, 255, 0.12),
        };
        style = style.shadow(Shadow::new(0.0, 0.0, 22.0, glow));
    }
    let color = mark.as_ref().map_or(if m.kind == Kind::Return { MUTED } else { TEXT }, |k| k.label_text);
    dl.group(|dl| {
        dl.fade(appear as f32);
        dl.translate(label.x as f32, label.y as f32);
        dl.scale_about((0.94 + 0.06 * appear) as f32, 0.0, 0.0);
        dl.rect(ox, oy, w, h, style);
        let align = match label.align {
            Align::Center => TextAlign::Center,
            Align::Left => TextAlign::Left,
            Align::Right => TextAlign::Right,
        };
        let mut opts = TextOpts::new(color).weight(if current { 650.0 } else { 500.0 });
        opts.align = align;
        opts.width = w - 24.0;
        draw_fit(dl, fit, ox + 12.0, oy + 3.0, opts);
        if removed {
            strike_with(dl, fit, ox + 12.0, oy + 3.0, None, align, w - 24.0);
        }
        draw_corner_badges(dl, &badges_of(&m.message.marks), 13.0, ox + w - 10.0, oy - 15.0);
    });
}

fn draw_note(dl: &mut DisplayList, m: &PlacedMessage, appear: f64) {
    let Some(note) = &m.note else { return };
    let fit = &note.text;
    let w = ((fit.width + 24.0 + 2.0 + 17.0 + 8.0).min(note.max_width)) as f32;
    let content_h = (fit.height as f32).max(17.0 + 3.0);
    let h = content_h + 10.0 + 2.0;
    let slide = ((1.0 - appear) * if note.left_side { 12.0 } else { -12.0 }) as f32;
    dl.group(|dl| {
        dl.fade(appear as f32);
        dl.translate(note.x as f32 + slide, note.y as f32);
        let x = if note.left_side { -w } else { 0.0 };
        let y = -h / 2.0;
        if let Some(p) = rounded_rect(x + 0.5, y + 0.5, w - 1.0, h - 1.0, [7.5, 1.5, 7.5, 7.5]) {
            if let Some(full) = rounded_rect(x, y, w, h, [8.0, 2.0, 8.0, 8.0]) {
                dl.path(full, Some(Color::css("#1e1a10").into()), None);
            }
            dl.path(p, None, Some(Stroke::solid(NOTE_AMBER, 1.0)));
        }
        icons::draw(dl, "StickyNote", x + 1.0 + 12.0, y + 1.0 + 5.0 + 3.0, 17.0, Color::css("#fbbf24"), 2.2);
        draw_fit(dl, fit, x + 1.0 + 12.0 + 17.0 + 8.0, y + 1.0 + 5.0, TextOpts::new(Color::css("#f1dca0")));
    });
}

/// Paints the backdrop over the band `y0..y1` of the current space at `alpha`, as a mask that fades what is under.
fn veil(dl: &mut DisplayList, x: f32, y0: f32, y1: f32, w: f32, alpha: f32) {
    if alpha <= 0.0 || y1 <= y0 {
        return;
    }
    dl.group(|dl| {
        dl.fade(alpha);
        dl.push_clip(x, y0, w, y1 - y0, 0.0);
        let t = dl.transform();
        dl.scale_about(1.0 / t.sx, 0.0, 0.0);
        dl.translate(-t.tx, -t.ty);
        backdrop::draw(dl);
        dl.pop_clip();
    });
}

impl View {
    fn starts(&self, f: &Frame) -> Vec<f64> {
        reveal_starts(
            f.segments,
            self.layout.messages.len(),
            &self.lasts,
            MESSAGES_START,
            build_frames("sequence") - MESSAGE_FRAMES,
            STEP_STAGGER,
            MESSAGE_FRAMES,
        )
    }

    fn content(&self, dl: &mut DisplayList, f: &Frame, camera: &Camera, scroll: f64) {
        let frame = f.frame;
        let layout = &self.layout;
        let starts = self.starts(f);
        let step = current_step(f.segments, frame);
        let lit_set = step.and_then(|k| self.lit.get(k));
        let is_lit = |i: usize| lit_set.is_some_and(|s| s.contains(&i));
        let lit_range = lit_set.and_then(|s| Some((*s.first()?, *s.last()?)));
        let emphasis = FocusSpotlight::new(target_steps(&self.scene), f.segments, frame);
        let lifeline = interpolate(frame, &[LIFELINE_START, LIFELINE_START + LIFELINE_FRAMES], &[0.0, 1.0], CLAMP);
        let n = self.participants.len();
        let stagger = 5.0f64.min((HEADERS_END - HEADER_START) / (n.saturating_sub(1)).max(1) as f64);
        let w = layout.width as f32;
        let view_h = camera.view_h as f32;

        dl.group(|dl| {
            if camera.scrolls {
                dl.push_clip(0.0, 0.0, w, view_h, 0.0);
                dl.translate(0.0, -scroll as f32);
            }
            // The lit band.
            if let Some((a, b)) = lit_range {
                #[allow(clippy::collapsible_if)]
                if let (Some(first), Some(last)) = (layout.messages.get(a), layout.messages.get(b)) {
                    let modified = layout.messages[a..=b.min(layout.messages.len() - 1)]
                        .iter()
                        .any(|m| m.message.marks.change.as_deref() == Some("modified"));
                    let fill =
                        if modified { Color::rgba8(124, 140, 255, 0.07) } else { Color::rgba8(255, 255, 255, 0.035) };
                    let op = interpolate(frame, &[starts[a], starts[a] + DRAW_FRAMES], &[0.0, 1.0], CLAMP);
                    dl.group(|dl| {
                        dl.fade(op as f32);
                        dl.rect(
                            -12.0,
                            first.top as f32,
                            w + 24.0,
                            (last.bottom - first.top) as f32,
                            BoxStyle::fill(fill).radius(12.0),
                        );
                    });
                }
            }
            // Lifelines.
            for (p, &x) in self.participants.iter().zip(&layout.xs) {
                let mark = node_mark(&p.marks);
                let color = mark.map_or(Color::rgba8(255, 255, 255, 0.22), |m| m.0.fade(0.45));
                let y1 = layout.lifeline_top + (layout.height - layout.lifeline_top) * lifeline;
                if let Some(path) = polyline(&[(x, layout.lifeline_top), (x, y1)]) {
                    dl.path(path, None, Some(Stroke::dashed(color, 2.0, 6.0, 10.0)));
                }
            }
            // Activation bars, revealed down to the arrow of the latest message that has landed.
            let front = {
                let ys: Vec<f64> = layout.messages.iter().map(|m| m.points[m.points.len() - 1].1).collect();
                if ys.is_empty() {
                    0.0
                } else {
                    let mut input: Vec<f64> = starts.iter().map(|s| s + DRAW_FRAMES).collect();
                    let last_end = input[input.len() - 1];
                    input.push(last_end + 8.0);
                    let mut out = ys;
                    out.push(layout.height);
                    interpolate(frame, &input, &out, CLAMP)
                }
            };
            for a in &layout.activations {
                if frame < starts[a.opener] {
                    continue;
                }
                let h = (0.0f64.max(a.y1.min(front.max(a.y0 + 6.0)) - a.y0)) as f32;
                // An SVG stroke is centred on the edge, a CSS border sits inside it.
                let (x, y) = ((a.x - BAR_W / 2.0) as f32 - 0.75, a.y0 as f32 - 0.75);
                dl.rect(
                    x,
                    y,
                    BAR_W as f32 + 1.5,
                    h + 1.5,
                    BoxStyle::fill(Color::css("#262b3c")).radius(3.75).border(Color::rgba8(255, 255, 255, 0.3), 1.5),
                );
            }
            for (i, m) in layout.messages.iter().enumerate() {
                let draw = interpolate(frame, &[starts[i], starts[i] + DRAW_FRAMES], &[0.0, 1.0], CLAMP);
                draw_arrow(dl, m, draw, is_lit(i));
            }
            for (i, m) in layout.messages.iter().enumerate() {
                let appear = interpolate(
                    frame,
                    &[starts[i] + DRAW_FRAMES * 0.5, starts[i] + MESSAGE_FRAMES],
                    &[0.0, 1.0],
                    CLAMP,
                );
                draw_label(dl, m, appear, is_lit(i));
                draw_note(dl, m, appear);
            }
            if camera.scrolls {
                // The messages fade out under the participants, and at the bottom edge while more lies below.
                let top = layout.lifeline_top as f32;
                let more = scroll < layout.height - camera.view_h - 1.0;
                dl.group(|dl| {
                    dl.translate(0.0, scroll as f32);
                    veil(dl, -12.0, 0.0, top, w + 24.0, 1.0);
                    let steps = 14;
                    let band = FADE as f32 / steps as f32;
                    for j in 0..steps {
                        let y0 = top + j as f32 * band;
                        veil(dl, -12.0, y0, y0 + band, w + 24.0, 1.0 - (j as f32 + 0.5) / steps as f32);
                    }
                    if more {
                        let from = view_h - FADE as f32;
                        for j in 0..steps {
                            let y0 = from + j as f32 * band;
                            veil(dl, -12.0, y0, y0 + band, w + 24.0, (j as f32 + 0.5) / steps as f32);
                        }
                    }
                });
                dl.pop_clip();
            }
        });
        let size = if layout.card_w < 290.0 { CardSize::Compact } else { CardSize::Small };
        for (i, p) in self.participants.iter().enumerate() {
            let appear =
                spring(frame - HEADER_START - i as f64 * stagger, FPS, Spring::damping(16.0).with_stiffness(110.0));
            let mut e = emphasis.emphasis(&format!("p:{}", p.id));
            e.opacity = 1.0;
            nodecard::draw(
                dl,
                p,
                (
                    (layout.xs[i] - layout.card_w / 2.0) as f32,
                    layout.card_top as f32,
                    layout.card_w as f32,
                    CARD_H as f32,
                ),
                size,
                appear,
                e,
                &layout.texts[i],
            );
        }
    }
}

impl SceneView for View {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let (bw, bh) = self.box_size;
        let scale = sequence_scale(&self.layout, self.box_size);
        let camera = sequence_camera(&self.layout, &self.lit, f.segments, bh / scale);
        let scroll = camera.scroll_at(f.frame, f.segments);
        let left = (bw - self.layout.width * scale) / 2.0;
        let top = if camera.scrolls { 0.0 } else { (bh - self.layout.height * scale) / 2.0 };
        self.shell.draw(dl, f.frame, f.duration, None, |dl, _| {
            dl.translate(left as f32, top as f32);
            dl.scale_about(scale as f32, 0.0, 0.0);
            self.content(dl, f, &camera, scroll);
            // TODO(marks): pen marks over the diagram.
            // TODO(camera): the generic `camera` field.
        });
    }
}
