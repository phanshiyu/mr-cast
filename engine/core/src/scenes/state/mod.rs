//! The state scene: states as pills, transitions routed between them with labels, an entry dot, and steps that
//! light parts of it. A port of src/components/StateDiagram.tsx and src/utils/stateLayout.ts.

mod layout;

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::callout::header_box;
use crate::chrome::callout::{aside_height, draw_aside};
use crate::chrome::fittext::{Align, LineHeight, TextOpts, draw_fit, drawn_width, fit_height};
use crate::chrome::marks::{
    EMPHASIS, EMPHASIS_GLOW, EMPHASIS_SOFT, badges_of, change_tone, corner_badges, draw_pill, emphasis_card, pill,
};
use crate::chrome::shell::{Aside, Shell};
use crate::color::Color;
use crate::diagram::{bez, skia, strike, trim};
use crate::display::{BoxStyle, DisplayList, Paint, PathBuilder, Shadow, Stroke};
use crate::marks::geometry::{Bx, Pt as MPt};
use crate::marks::{LayoutBoxes, Pen, Stage, around};
use crate::steps::Emphasis;
use crate::steps::{FocusSpotlight as Focus, as_bright_as};
use crate::targets::SceneRefs;
use crate::targets::target_steps;
use crate::text::{Face, Style, baseline_in};
use crate::theme::{ACCENT, ACCENT_GLOW, BORDER_STRONG, DEL, MUTED, RAISED, TEXT, content_box};
use crate::timing::{FPS, build_frames};
use layout::{ARROW_LEN, BADGE_FONT, StateLayout, StateNode, StateTransition, layout_state, state_scale};
use serde::Deserialize;
use std::collections::HashMap;

const START: f64 = 8.0;
const STATES_END: f64 = 20.0;
const TRANSITION_FRAMES: f64 = 12.0;

fn edge_color() -> Color {
    Color::rgba8(170, 178, 200, 0.7)
}

#[derive(Deserialize)]
struct StateScene {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    initial: Option<String>,
    states: Vec<StateNode>,
    #[serde(default)]
    transitions: Vec<StateTransition>,
}

struct Timeline {
    entry_at: f64,
    state_at: HashMap<usize, f64>,
    transition_at: Vec<f64>,
}

struct StateView {
    shell: Shell,
    scene: StateScene,
    layout: StateLayout,
    timeline: Timeline,
    targets: HashMap<String, Vec<usize>>,
    scale: f64,
    box_: (f64, f64),
    legend: Vec<&'static str>,
    pen: Pen,
}

/// The box of each item a step can focus, in layout units: a state's card, a transition's label (or a spot before its
/// arrowhead). A note keeps off the cards and the labels (`stateBoxes`).
fn state_boxes(layout: &StateLayout, scene: &StateScene) -> LayoutBoxes {
    let card = |p: &layout::PlacedState| Bx::new(p.x, p.y, p.w, p.h);
    let transition = |r: &layout::RoutedTransition| match &r.label {
        Some(l) => around(MPt { x: l.x, y: l.y }, l.w, l.h),
        None => around(MPt { x: r.tip.x - r.dir.x * 40.0, y: r.tip.y - r.dir.y * 40.0 }, 36.0, 36.0),
    };
    let mut out = LayoutBoxes::default();
    for p in &layout.states {
        out.add(format!("s:{}", scene.states[p.state].id), card(p));
    }
    for (i, r) in layout.transitions.iter().enumerate() {
        out.add(format!("t:{i}"), transition(r));
    }
    let mut obstacles: Vec<Bx> = layout.states.iter().map(card).collect();
    obstacles.extend(layout.transitions.iter().filter(|r| r.label.is_some()).map(transition));
    out.obstacles = Some(obstacles);
    out
}

fn build_timeline(scene: &StateScene, layout: &StateLayout) -> Timeline {
    let n = layout.states.len();
    let state_start = START + if layout.entry.is_some() { 4.0 } else { 0.0 };
    let stagger = 7f64.min((STATES_END - state_start) / ((n as f64) - 1.0).max(1.0));
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by_key(|&i| (layout.states[i].layer, layout.states[i].row));
    let state_at: HashMap<usize, f64> =
        order.iter().enumerate().map(|(rank, &i)| (i, state_start + rank as f64 * stagger)).collect();
    let span = |t: usize| {
        let tr = &scene.transitions[layout.transitions[t].transition];
        let (a, b) = (layout.layer_of[&tr.from], layout.layer_of[&tr.to]);
        (a.min(b), a.max(b))
    };
    let m = layout.transitions.len();
    let mut torder: Vec<usize> = (0..m).collect();
    torder.sort_by_key(|&t| span(t));
    let rank: HashMap<usize, usize> = torder.iter().enumerate().map(|(r, &t)| (t, r)).collect();
    let start = STATES_END + 4.0;
    let tstagger = 5f64.min((build_frames("state") - start - TRANSITION_FRAMES - 4.0) / ((m as f64) - 1.0).max(1.0));
    Timeline { entry_at: START, state_at, transition_at: (0..m).map(|i| start + rank[&i] as f64 * tstagger).collect() }
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: StateScene = parse(input)?;
    if scene.states.is_empty() {
        return Err("a state scene without states".into());
    }
    let layout = layout_state(&scene.states, &scene.transitions, scene.initial.as_deref());
    let timeline = build_timeline(&scene, &layout);
    let box_ = content_box(scene.title.is_some());
    let scale = state_scale(&layout, box_);
    let mut legend: Vec<&'static str> = Vec::new();
    for c in ["added", "removed", "modified"] {
        let has = scene.states.iter().any(|s| s.marks.change.as_deref() == Some(c))
            || scene.transitions.iter().any(|t| t.marks.change.as_deref() == Some(c));
        if has {
            legend.push(c);
        }
    }
    let marks = Stage::centred(box_, (layout.width, layout.height), scale).targets(&state_boxes(&layout, &scene), box_);
    let pen =
        Pen::new(input.scene, input.segments, &SceneRefs(input.scene), vec![marks], true, header_box(input.scene));
    Ok(Box::new(StateView {
        pen,
        shell: Shell::new(input.scene),
        targets: target_steps(input.scene),
        scene,
        layout,
        timeline,
        scale,
        box_,
        legend,
    }))
}

fn pulse_of(frame: f64, ats: &[f64]) -> f64 {
    ats.iter().map(|&at| interpolate(frame, &[at, at + 7.0, at + 32.0], &[0.0, 1.0, 0.0], CLAMP)).fold(0.0, f64::max)
}

fn alpha(c: Color, a: f64) -> Color {
    c.alpha(a as f32)
}

fn arrow_head(dl: &mut DisplayList, tip: (f64, f64), dir: (f64, f64), color: Color, opacity: f64) {
    let base = (tip.0 - dir.0 * (ARROW_LEN + 1.0), tip.1 - dir.1 * (ARROW_LEN + 1.0));
    let half = 7.0;
    let mut pb = PathBuilder::new();
    pb.move_to(tip.0 as f32, tip.1 as f32);
    pb.line_to((base.0 - dir.1 * half) as f32, (base.1 + dir.0 * half) as f32);
    pb.line_to((base.0 + dir.1 * half) as f32, (base.1 - dir.0 * half) as f32);
    pb.close();
    if let Some(p) = pb.finish() {
        dl.group(|dl| {
            dl.fade(opacity as f32);
            dl.path(p, Some(color.into()), Some(Stroke::solid(color, 1.5).rounded()));
        });
    }
}

fn tone_color(t: &StateTransition) -> Color {
    if let Some(c) = t.marks.change.as_deref().and_then(change_tone) {
        c.color
    } else if t.marks.highlighted() {
        EMPHASIS
    } else {
        edge_color()
    }
}

impl StateView {
    fn pulse_ats(&self, key: &str, segments: &[crate::timing::Segment]) -> Vec<f64> {
        self.targets
            .get(key)
            .map(|steps| steps.iter().map(|&k| segments.get(k + 1).map_or(0.0, |s| s.from)).collect())
            .unwrap_or_default()
    }

    fn draw_card(&self, dl: &mut DisplayList, i: usize, f: &Frame, emphasis: Emphasis) {
        let placed = &self.layout.states[i];
        let state = &self.scene.states[placed.state];
        let frame = f.frame;
        let start = self.timeline.state_at[&i];
        let appear = spring(frame - start, FPS, Spring::damping(16.0).with_stiffness(110.0));
        let badge_scale = spring(frame - start - 10.0, FPS, Spring::damping(12.0).with_stiffness(160.0));
        let pulse = pulse_of(frame, &self.pulse_ats(&format!("s:{}", state.id), f.segments));
        let removed = state.marks.change.as_deref() == Some("removed");
        let tone = state.marks.change.as_deref().and_then(change_tone);
        let highlight = state.marks.highlighted() && tone.is_none();
        let border = if removed {
            alpha(DEL, 0xcc as f64 / 255.0)
        } else {
            tone.map(|t| t.color).unwrap_or(if highlight { EMPHASIS } else { BORDER_STRONG })
        };
        let (w, h) = (placed.w as f32, placed.h as f32);
        let g = emphasis.glow as f32;
        let p = pulse as f32;
        let mut style = BoxStyle::fill(match state.marks.change.as_deref() {
            Some("modified") => Paint::vertical(0.0, h, Color::css("#1c2033"), Color::css("#151826")),
            Some("added") => Paint::vertical(0.0, h, Color::css("#14231f"), Color::css("#121a1a")),
            _ if highlight => emphasis_card(0.0, h),
            _ => RAISED.into(),
        })
        .radius(h / 2.0);
        // Shadows, bottom first (CSS lists the top one first).
        if g > 0.0 {
            style = style.shadow(Shadow::new(0.0, 0.0, 40.0 * g, ACCENT_GLOW));
            let mut r = Shadow::new(0.0, 0.0, 0.0, ACCENT);
            r.spread = 4.0 * g;
            style = style.shadow(r);
        }
        if let Some(t) = tone {
            let mut r = Shadow::new(0.0, 0.0, 0.0, alpha(t.color, ((pulse * 140.0).round()) / 255.0));
            r.spread = 4.0 + 10.0 * p;
            style = style.shadow(r);
        }
        match tone {
            Some(t) if !removed => {
                style = style.shadow(Shadow::new(0.0, 0.0, 40.0 + 30.0 * p, alpha(t.color, 0x55 as f64 / 255.0)));
                let mut r = Shadow::new(0.0, 0.0, 0.0, t.bg);
                r.spread = 6.0;
                style = style.shadow(r);
            }
            _ if highlight => {
                style = style.shadow(Shadow::new(0.0, 0.0, 44.0, EMPHASIS_GLOW));
                let mut r = Shadow::new(0.0, 0.0, 0.0, EMPHASIS_SOFT);
                r.spread = 6.0;
                style = style.shadow(r);
            }
            _ => style = style.shadow(Shadow::new(0.0, 14.0, 36.0, Color::rgba8(0, 0, 0, 0.45))),
        }
        style = if removed {
            style.border_stroke(Stroke::dashed(border, 2.0, 6.0, 6.0))
        } else {
            style.border(border, 2.0)
        };
        let opacity = appear * if removed { 0.62 } else { 1.0 } * emphasis.opacity;
        dl.group(|dl| {
            dl.translate(placed.x as f32, placed.y as f32);
            dl.fade(opacity as f32);
            dl.translate(0.0, ((1.0 - appear) * 20.0) as f32);
            dl.scale_about(((0.9 + 0.1 * appear) * (1.0 + 0.05 * pulse)) as f32, w / 2.0, h / 2.0);
            dl.rect(0.0, 0.0, w, h, style);
            if state.is_final == Some(true) {
                dl.rect(2.0, 2.0, w - 4.0, h - 4.0, BoxStyle::empty().radius(h / 2.0 - 2.0).border(border, 7.0));
                dl.rect(2.0, 2.0, w - 4.0, h - 4.0, BoxStyle::empty().radius(h / 2.0 - 2.0).border(RAISED, 5.0));
            }
            let label = &placed.label;
            let badges = badges_of(&state.marks, true);
            let pills: Vec<_> = badges.iter().map(|b| (pill(&b.text, BADGE_FONT as f32, None), b.color)).collect();
            let lw = label.width as f32;
            let content_w = lw + pills.iter().map(|(p, _)| 14.0 + p.w).sum::<f32>();
            let single = label.lines.len() <= 1;
            let lh = if single { LineHeight::Normal } else { LineHeight::Fit };
            let bh = fit_height(label, lh);
            let mut x = 2.0 + 26.0 + (w - 4.0 - 52.0 - content_w) / 2.0;
            let top = 2.0 + (h - 4.0 - bh) / 2.0;
            let color = if removed { MUTED } else { TEXT };
            let opts = TextOpts { align: Align::Center, width: lw, line_height: lh, ..TextOpts::new(color) };
            draw_fit(dl, label, x, top, opts);
            if removed {
                let face: Face = label.font.family.into();
                let line_h = fit_height(label, lh) / label.lines.len().max(1) as f32;
                for (k, line) in label.lines.iter().enumerate() {
                    let lwid = drawn_width(label, line, None);
                    let base = top + k as f32 * line_h + baseline_in(face, label.size as f32, line_h);
                    strike(
                        dl,
                        Style::new(face, label.font.weight as f32, label.size as f32),
                        x + (lw - lwid) / 2.0,
                        base,
                        lwid,
                        DEL,
                        Some(3.0),
                    );
                }
            }
            x += lw;
            for (p, c) in &pills {
                x += 14.0;
                draw_pill(dl, p, *c, x, 2.0 + (h - 4.0 - p.h) / 2.0, badge_scale as f32);
                x += p.w;
            }
        });
    }

    fn draw_transition(&self, dl: &mut DisplayList, i: usize, draw: f64, pulse: f64, em: Emphasis) {
        let routed = &self.layout.transitions[i];
        let t = &self.scene.transitions[routed.transition];
        if draw <= 0.0 {
            return;
        }
        let change = t.marks.change.as_deref();
        let color = tone_color(t);
        let removed = change == Some("removed");
        let steady = if change.is_some() {
            if removed { 0.1 } else { 0.22 }
        } else if t.marks.highlighted() {
            0.22
        } else {
            0.0
        };
        let path = bez(&routed.d);
        let shown = trim(&path, draw);
        dl.group(|dl| {
            dl.fade(((if removed { 0.78 } else { 1.0 }) * em.opacity) as f32);
            if steady > 0.0 || em.glow > 0.0 {
                let c = if change.is_some() || t.marks.highlighted() { color } else { ACCENT };
                let a = steady + 0.45 * pulse.max(em.glow * 0.6);
                if let Some(p) = skia(&shown) {
                    dl.path(p, None, Some(Stroke::solid(c.fade(a as f32), (10.0 + 8.0 * pulse) as f32).rounded()));
                }
            }
            if let Some(p) = skia(&shown) {
                let st = if removed {
                    Stroke::dashed(color, 3.0, 10.0, 9.0).rounded()
                } else {
                    Stroke::solid(color, 3.0).rounded()
                };
                dl.path(p, None, Some(st));
            }
            arrow_head(
                dl,
                (routed.tip.x, routed.tip.y),
                (routed.dir.x, routed.dir.y),
                color,
                interpolate(draw, &[0.85, 1.0], &[0.0, 1.0], CLAMP),
            );
        });
    }

    fn draw_label(&self, dl: &mut DisplayList, i: usize, appear: f64, pulse: f64, em: Emphasis) {
        let routed = &self.layout.transitions[i];
        let Some(label) = &routed.label else { return };
        let t = &self.scene.transitions[routed.transition];
        let change = t.marks.change.as_deref();
        let highlight = t.marks.highlighted() && change.is_none();
        let color = if change.is_some() || highlight { tone_color(t) } else { MUTED };
        let (w, h) = (label.w as f32, label.h as f32);
        dl.group(|dl| {
            dl.translate(label.x as f32, label.y as f32);
            dl.fade((appear * if change == Some("removed") { 0.85 } else { 1.0 } * em.opacity) as f32);
            dl.scale_about(((0.9 + 0.1 * appear) * (1.0 + 0.12 * pulse)) as f32, 0.0, 0.0);
            dl.translate(-w / 2.0, -h / 2.0);
            let border = if change.is_some() || highlight { color.alpha(0x99 as f32 / 255.0) } else { BORDER_STRONG };
            let mut style = BoxStyle::fill(Color::css("#0d0f16")).radius(10.0).border(border, 1.0);
            if pulse > 0.0 {
                style = style.shadow(Shadow::new(0.0, 0.0, (24.0 * pulse) as f32, color.alpha(0x88 as f32 / 255.0)));
            } else if highlight {
                style = style.shadow(Shadow::new(0.0, 0.0, 18.0, EMPHASIS_GLOW));
            }
            dl.rect(0.0, 0.0, w, h, style);
            let fit = &label.text;
            let th = (fit.lines.len() as f64 * fit.size * fit.line_height) as f32;
            let top = 1.0 + (h - 2.0 - th) / 2.0;
            let left = 1.0 + 12.0;
            let cw = w - 2.0 - 24.0;
            draw_fit(dl, fit, left, top, TextOpts { align: Align::Center, width: cw, ..TextOpts::new(color) });
            if change == Some("removed") {
                let lh = fit.size as f32 * fit.line_height as f32;
                let face: Face = fit.font.family.into();
                for (k, line) in fit.lines.iter().enumerate() {
                    let lw = drawn_width(fit, line, None);
                    let base = top + k as f32 * lh + baseline_in(face, fit.size as f32, lh);
                    strike(
                        dl,
                        Style::new(face, fit.font.weight as f32, fit.size as f32),
                        left + (cw - lw) / 2.0,
                        base,
                        lw,
                        color,
                        None,
                    );
                }
            }
            let badges = badges_of(&t.marks, false);
            corner_badges(dl, &badges, 12.0, w - 1.0 + 4.0, 1.0 - 19.0, 1.0);
        });
    }
}

impl SceneView for StateView {
    fn pencil_spans(&self) -> Vec<crate::chrome::pencil::Span> {
        let b = self.shell.content(0.0);
        self.pen.frame_spans((b.x, b.y))
    }

    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let focus = Focus::borrowed(&self.targets, f.segments, frame);
        let layout = &self.layout;
        let used: Vec<&str> = self.legend.to_vec();
        let aside_fn = |dl: &mut DisplayList, right: f32, top: f32| draw_aside(dl, &used, None, None, right, top);
        let aside = Aside { height: aside_height(&used, None), draw: &aside_fn };
        self.shell.draw(dl, frame, f.duration, Some(aside), |dl, bx| {
            self.pen.draw(dl, frame, f.segments, |dl| {
                let (lw, lh) = (layout.width, layout.height);
                let draws: Vec<f64> = (0..layout.transitions.len())
                    .map(|i| {
                        let at = self.timeline.transition_at[i];
                        interpolate(frame, &[at, at + TRANSITION_FRAMES], &[0.0, 1.0], CLAMP)
                    })
                    .collect();
                dl.group(|dl| {
                    dl.translate((bx.w - lw as f32) / 2.0, (bx.h - lh as f32) / 2.0);
                    dl.scale_about(self.scale as f32, (lw / 2.0) as f32, (lh / 2.0) as f32);
                    if let Some(entry) = &layout.entry {
                        let at = self.timeline.entry_at;
                        let appear = spring(frame - at, FPS, Spring::damping(14.0).with_stiffness(140.0));
                        let draw = interpolate(frame, &[at + 4.0, at + 14.0], &[0.0, 1.0], CLAMP);
                        dl.circle(entry.dot.x as f32, entry.dot.y as f32, (12.0 * appear) as f32, TEXT);
                        if let Some(p) = skia(&trim(&bez(&entry.d), draw)) {
                            dl.path(p, None, Some(Stroke::solid(TEXT, 3.0)));
                        }
                        arrow_head(
                            dl,
                            (entry.tip.x, entry.tip.y),
                            (entry.dir.x, entry.dir.y),
                            TEXT,
                            interpolate(draw, &[0.8, 1.0], &[0.0, 1.0], CLAMP),
                        );
                    }
                    for (i, &draw) in draws.iter().enumerate() {
                        let pulse = pulse_of(frame, &self.pulse_ats(&format!("t:{i}"), f.segments));
                        self.draw_transition(dl, i, draw, pulse, focus.emphasis(&format!("t:{i}")));
                    }
                    for (i, placed) in layout.states.iter().enumerate() {
                        let id = &self.scene.states[placed.state].id;
                        let adjacent: Vec<Emphasis> = self
                            .scene
                            .transitions
                            .iter()
                            .enumerate()
                            .filter(|(_, t)| t.from == *id || t.to == *id)
                            .map(|(k, _)| focus.emphasis(&format!("t:{k}")))
                            .collect();
                        let em = as_bright_as(focus.emphasis(&format!("s:{id}")), &adjacent);
                        self.draw_card(dl, i, f, em);
                    }
                    for (i, &draw) in draws.iter().enumerate() {
                        let pulse = pulse_of(frame, &self.pulse_ats(&format!("t:{i}"), f.segments));
                        let appear = interpolate(draw, &[0.55, 1.0], &[0.0, 1.0], CLAMP);
                        self.draw_label(dl, i, appear, pulse, focus.emphasis(&format!("t:{i}")));
                    }
                });
                let _ = self.box_;
            })
        });
    }
}
