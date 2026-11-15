//! The plot scene: numeric axes and parts (functions, data series, points, vectors, shaded areas) whose numbers
//! may be expressions in parameters that steps `set`. A port of src/components/PlotDiagram.tsx, shared/plot.mjs
//! and shared/expr.mjs.

mod expr;
mod layout;

use super::callout::HeaderCallout;
use super::state::{
    Focus, Model as StateModel, SceneState, SetEntry, StateFrame, TintMix, resolve_ref, scene_states, state_frame,
    target_steps,
};
use super::{Frame, SceneInput, SceneView};
use crate::anim::{CLAMP, Easing, Spring, interpolate, spring};
use crate::chrome::shell::{Aside, Shell};
use crate::color::Color;
use crate::display::{DisplayList, Path, PathBuilder, Stroke};
use crate::model::Voiceover;
use crate::text::{Face, Style, line_metrics};
use crate::theme::{ACCENT_GLOW, BG, BORDER_STRONG, MUTED, TEXT, content_box, tone};
use crate::timing::{FPS, STEP_SETTLE_FRAMES, Segment};
use layout::{
    AXIS_FONT, Axes, Geo, Item, Kind, LABEL_FONT, Model, POINT_R, Part, Px, TICK_FONT, TICK_LEN, geometry, labels,
};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

const START: f64 = 6.0;
const STAGGER: f64 = 4.0;

thread_local! {
    /// The model of the scene being prepared, for the state walk's plain function pointers.
    static CURRENT: RefCell<Option<Arc<Model>>> = const { RefCell::new(None) };
}

fn with_model<T>(f: impl FnOnce(&Model) -> T) -> Option<T> {
    CURRENT.with(|c| c.borrow().as_ref().map(|m| f(m)))
}

fn state_model() -> StateModel {
    StateModel {
        initial: |scene| {
            let mut s = SceneState::default();
            with_model(|m| {
                for (name, _) in &m.params {
                    if let Some(v) = scene.get("params").and_then(|p| p.get(name)) {
                        s.values.insert(format!("k:{name}"), v.clone());
                    }
                }
                for p in &m.parts {
                    if p.hidden || m.traced.contains(&p.id) {
                        s.hidden.insert(format!("p:{}", p.id));
                    }
                }
            });
            s
        },
        resolve: |_, r| {
            let id = r.as_str()?;
            with_model(|m| {
                if m.part(id).is_some() {
                    return Some(vec![format!("p:{id}")]);
                }
                m.dependents.get(id).filter(|d| !d.is_empty()).map(|d| d.iter().map(|i| format!("p:{i}")).collect())
            })
            .flatten()
        },
        set: |_, r, value| -> Option<Vec<SetEntry>> {
            let known = with_model(|m| m.params.iter().any(|(k, _)| k == r))?;
            (known && value.as_f64().is_some_and(f64::is_finite)).then(|| vec![(format!("k:{r}"), value.clone())])
        },
        show: Some(&["p:"]),
        tint: Some(&["p:"]),
        sortable: |_| false,
        trace: Some(|_, r| {
            with_model(|m| m.part(r).filter(|p| p.kind != Kind::Points).map(|_| format!("p:{r}"))).flatten()
        }),
    }
}

// ─── Cues ───

/// A spoken text's words, lower case without punctuation, each with its index among the text's words.
fn cue_tokens(text: &str) -> Vec<(String, usize)> {
    text.split_whitespace()
        .enumerate()
        .map(|(i, w)| (w.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>(), i))
        .filter(|(w, _)| !w.is_empty())
        .collect()
}

fn cue_word(text: &str, cue: &str) -> Option<usize> {
    let said = cue_tokens(text);
    let want: Vec<String> =
        cue_tokens(&crate::speech::speech_text(&crate::markup::plain_text(cue))).into_iter().map(|t| t.0).collect();
    if want.is_empty() {
        return None;
    }
    (0..said.len().checked_sub(want.len())? + 1)
        .find(|&i| want.iter().enumerate().all(|(j, w)| said[i + j].0 == *w))
        .map(|i| said[i].1)
}

/// Seconds after a segment's voice starts at which it reaches word `index`.
fn word_start(seg: &Segment, index: usize) -> f64 {
    let words = crate::timing::word_count(&seg.text);
    if let Some(sentences) = seg.clip.as_ref().and_then(|c| c.sentences.as_deref())
        && !sentences.is_empty()
        && sentences.iter().map(|s| s.words).sum::<usize>() == words
    {
        let mut before = 0;
        for s in sentences {
            if index < before + s.words {
                return s.start + ((index - before) as f64 / s.words as f64) * (s.end - s.start);
            }
            before += s.words;
        }
    }
    if words > 0 { (index as f64 / words as f64) * (seg.speaking_frames / FPS) } else { 0.0 }
}

/// Frame at which a segment's voice says `cue`, less a short lead (`cueFrame`).
fn cue_frame(seg: &Segment, cue: &str) -> Option<f64> {
    let index = cue_word(&seg.text, cue)?;
    Some(seg.mark_from.max(seg.voice_from + crate::timing::js_round(word_start(seg, index) * FPS) - 3.0))
}

// ─── The view ───

struct PlotView {
    shell: Shell,
    scene: Value,
    model: Model,
    axes: Axes,
    states: Vec<SceneState>,
    steps: HashMap<String, Vec<usize>>,
    callout: Option<HeaderCallout>,
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let _: Option<&Voiceover> = None;
    let model = Arc::new(Model::new(input.scene)?);
    CURRENT.with(|c| *c.borrow_mut() = Some(model.clone()));
    let sm = state_model();
    let states = scene_states(&sm, input.scene);
    let steps = target_steps(&sm, input.scene);
    CURRENT.with(|c| *c.borrow_mut() = None);
    let shell = Shell::new(input.scene);
    let callout = HeaderCallout::new(input.scene);
    let (w, mut h) = content_box(shell.title.is_some() || callout.is_some());
    if let Some(t) = &shell.title {
        h -= (t.lines.len() as f64 - 1.0) * crate::timing::js_round(t.size * t.line_height);
    }
    let axes = Axes::new(&model, w, h);
    let model = Arc::try_unwrap(model).map_err(|_| "plot model shared".to_string())?;
    Ok(Box::new(PlotView { shell, scene: input.scene.clone(), model, axes, states, steps, callout }))
}

fn px(p: Px) -> (f32, f32) {
    (p[0] as f32, p[1] as f32)
}

fn run_path(run: &[Px]) -> Option<Path> {
    let mut pb = PathBuilder::new();
    for (i, p) in run.iter().enumerate() {
        let (x, y) = px(*p);
        if i == 0 {
            pb.move_to(x, y);
        } else {
            pb.line_to(x, y);
        }
    }
    pb.finish()
}

fn line_path(a: Px, b: Px) -> Option<Path> {
    run_path(&[a, b])
}

fn erf(x: f64) -> f64 {
    let t = 1.0 / (1.0 + 0.3275911 * x.abs());
    let y = 1.0
        - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592)
            * t
            * (-x * x).exp();
    if x >= 0.0 { y } else { -y }
}

/// A CSS `drop-shadow(0 0 blur color)` under a shape of width `width`, as stacked wider copies of the shape whose
/// alphas follow a Gaussian of standard deviation blur / 2. `draw` paints the shape grown by `extra` px.
fn shadow(dl: &mut DisplayList, width: f64, blur: f64, color: Color, draw: &dyn Fn(&mut DisplayList, f32, Color)) {
    let sigma = blur / 2.0;
    let step = (sigma / 2.0).max(0.75);
    let n = ((3.0 * sigma / step).ceil() as usize).clamp(1, 12);
    let profile = |e: f64| {
        let d = width / 2.0 + e;
        let s = sigma * std::f64::consts::SQRT_2;
        0.5 * (erf((d + width / 2.0) / s) - erf((d - width / 2.0) / s)) * color.a as f64
    };
    let ring = |j: usize| profile((j as f64 + 0.5) * step);
    for j in (0..n).rev() {
        let outer = if j + 1 < n { ring(j + 1) } else { 0.0 };
        let target = ring(j);
        let a = 1.0 - (1.0 - target) / (1.0 - outer);
        if a > 0.002 {
            draw(dl, 2.0 * (j as f32 + 1.0) * step as f32, color.alpha(a as f32));
        }
    }
}

/// The two drop-shadows of a lit part, then the part (`glowStyle`).
fn glowed(dl: &mut DisplayList, glow: f64, color: Color, width: f64, draw: &dyn Fn(&mut DisplayList, f32, Color)) {
    if glow > 0.0 {
        shadow(dl, width, 14.0 * glow, ACCENT_GLOW, draw);
        shadow(dl, width, 4.0 * glow, color.alpha(1.0), draw);
    }
    draw(dl, 0.0, color);
}

/// Draws `text` with its baseline origin at (x, base). Inter here has no Greek, so a pi, which Chrome takes from
/// a system font, is drawn as strokes of about the same shape and advance.
fn put(dl: &mut DisplayList, text: &str, style: Style, x: f32, base: f32, color: Color) {
    let mut pen = x;
    let mut run = String::new();
    let flush = |dl: &mut DisplayList, run: &mut String, pen: &mut f32| {
        if !run.is_empty() {
            *pen += dl.text(run, style, *pen, base, color);
            run.clear();
        }
    };
    for ch in text.chars() {
        if ch != 'π' {
            run.push(ch);
            continue;
        }
        flush(dl, &mut run, &mut pen);
        let font = layout::Font::new(layout::Family::Sans, style.weight as f64, style.size as f64);
        let w = layout::measure("π", &font) as f32;
        let s = style.size;
        let sw = s * 0.085;
        let mut pb = PathBuilder::new();
        pb.move_to(pen + 0.04 * w, base - 0.47 * s);
        pb.line_to(pen + 0.96 * w, base - 0.47 * s);
        pb.move_to(pen + 0.30 * w, base - 0.47 * s);
        pb.cubic_to(pen + 0.30 * w, base - 0.25 * s, pen + 0.28 * w, base - 0.08 * s, pen + 0.24 * w, base);
        pb.move_to(pen + 0.70 * w, base - 0.47 * s);
        pb.cubic_to(pen + 0.70 * w, base - 0.22 * s, pen + 0.70 * w, base - 0.05 * s, pen + 0.80 * w, base - 0.02 * s);
        pb.cubic_to(pen + 0.84 * w, base - 0.01 * s, pen + 0.90 * w, base - 0.01 * s, pen + 0.94 * w, base - 0.03 * s);
        if let Some(p) = pb.finish() {
            dl.path(p, None, Some(Stroke::solid(color, sw)));
        }
        pen += w;
    }
    flush(dl, &mut run, &mut pen);
}

fn halo(dl: &mut DisplayList, text: &str, style: Style, x: f32, y_mid: f32, color: Color, opacity: f32) {
    let m = line_metrics(Face::Sans, style.size);
    // SVG `dominant-baseline: central` puts the middle of the em box on y.
    let base = y_mid + (m.ascent - m.descent) / 2.0;
    let layered = opacity < 0.999;
    if layered {
        dl.push_layer(opacity);
    }
    for (radius, count) in [(3.0f32, 16), (1.5, 8)] {
        for i in 0..count {
            let a = i as f32 / count as f32 * std::f32::consts::TAU;
            put(dl, text, style, x + radius * a.cos(), base + radius * a.sin(), BG);
        }
    }
    put(dl, text, style, x, base, color);
    if layered {
        dl.pop_layer();
    }
}

struct Look {
    color: Color,
    opacity: f64,
    glow: f64,
}

impl SceneView for PlotView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let m = &self.model;
        let axes = &self.axes;
        let plot = &axes.plot;
        let sf = state_frame(&self.states, f.segments, frame);
        // The step's own window: from its start (or its `when` words), or across its words when it traces.
        let (k, t) = match sf.step {
            None => (None, 1.0),
            Some(k) => {
                let seg = &f.segments[k + 1];
                let when = self.scene["steps"][k].get("when").and_then(Value::as_str);
                let start = when.and_then(|w| cue_frame(seg, w)).unwrap_or(seg.from);
                let traces = !self.states[k + 1].traces.is_empty();
                let end = if traces {
                    (start + STEP_SETTLE_FRAMES).max(seg.voice_from + seg.speaking_frames)
                } else {
                    start + STEP_SETTLE_FRAMES
                };
                let easing = if traces { Easing::Linear } else { Easing::Bezier(0.25, 0.1, 0.25, 1.0) };
                (Some(k), interpolate(frame, &[start, end], &[0.0, 1.0], CLAMP.eased(easing)))
            }
        };
        let s = StateFrame { t, ..sf };
        let focus = Focus::from_steps(self.steps.clone(), f.segments, frame);
        let (was, now) = (m.state_params(s.before), m.state_params(s.now));
        let mut scope = expr::Scope::new();
        for (i, (name, v)) in now.iter().enumerate() {
            scope.0.push((name.clone(), was[i].1 + (v - was[i].1) * t));
        }
        let traced: Vec<String> = match k {
            Some(k) => self.states[k + 1].traces.keys().map(|key| key[2..].to_string()).collect(),
            None => Vec::new(),
        };
        let is_traced = |id: &str| traced.iter().any(|t| t == id);
        let geos = geometry(m, axes, &scope, &|id| if is_traced(id) { t } else { 1.0 });
        let appear =
            |i: f64| spring(frame - START - i * STAGGER, FPS, Spring::damping(18.0).with_stiffness(140.0)).min(1.0);
        let build = appear(0.0);
        let shown = |id: &str| if is_traced(id) { 1.0 } else { s.shown(&format!("p:{id}")) };
        let placed = labels(m, axes, &geos, &scope, &|id| shown(id) > 0.5);

        let look = |id: &str, index: usize| -> Look {
            let key = format!("p:{id}");
            let part = m.part(id).unwrap();
            let mix: TintMix = s.tint(&key);
            let tone_name = mix.main_tone().map(str::to_string).unwrap_or_else(|| m.part_tone(part));
            let e = focus.at(&key);
            Look {
                color: tone(&tone_name).0,
                opacity: appear(index as f64 + 1.0) * shown(id) * e.opacity * mix.dim_opacity(),
                glow: e.glow,
            }
        };

        let aside_h = self.callout.as_ref().map_or(0.0, |c| c.height);
        let callout = self.callout.as_ref();
        let aside_draw = |dl: &mut DisplayList, right: f32, top: f32| {
            if let Some(c) = callout {
                c.draw(dl, right - c.width, top, &s);
            }
        };
        let aside = callout.map(|_| Aside { height: aside_h, draw: &aside_draw });
        // The pen marks, ink and camera of the scene go over this content.
        // TODO(camera): a step's `camera` zooms and pans the content (SceneShell's Camera) and the plot's view.
        self.shell.draw(dl, frame, f.duration, aside, |dl, _bx| {
            let layer = |dl: &mut DisplayList, opacity: f64, body: &dyn Fn(&mut DisplayList)| {
                if opacity < 0.999 {
                    dl.push_layer(opacity as f32);
                    body(dl);
                    dl.pop_layer();
                } else {
                    body(dl);
                }
            };
            let stroke_line = |dl: &mut DisplayList, a: Px, b: Px, color: Color, w: f32| {
                if let Some(p) = line_path(a, b) {
                    dl.path(p, None, Some(Stroke::solid(color, w)));
                }
            };
            // The grid.
            layer(dl, build, &|dl| {
                if m.x.grid {
                    for tk in &axes.ticks_x {
                        stroke_line(dl, [tk.at, plot.y], [tk.at, plot.y + plot.height], BORDER_STRONG, 1.5);
                    }
                }
                if m.y.as_ref().is_some_and(|y| y.grid) {
                    for tk in &axes.ticks_y {
                        stroke_line(dl, [plot.x, tk.at], [plot.x + plot.width, tk.at], BORDER_STRONG, 1.5);
                    }
                }
            });
            let clip = |dl: &mut DisplayList, body: &dyn Fn(&mut DisplayList)| {
                dl.push_clip(
                    (plot.x - 4.0) as f32,
                    (plot.y - 4.0) as f32,
                    (plot.width + 8.0) as f32,
                    (plot.height + 8.0) as f32,
                    0.0,
                );
                body(dl);
                dl.pop_clip();
            };
            let draw_geo = |dl: &mut DisplayList, geo: &Geo| {
                let part: &Part = &m.parts[geo.part];
                let Look { color, opacity, glow } = look(&part.id, geo.part);
                if opacity <= 0.001 {
                    return;
                }
                let width = 5.0 + 2.0 * glow;
                match (&part.kind, &part.item) {
                    (Kind::Areas, _) => {
                        if let Some(poly) = &geo.polygon
                            && let Some(path) = run_closed(poly)
                        {
                            let a = (0.22 * opacity + 0.12 * glow) as f32;
                            dl.path(path, Some(color.alpha(color.a * a).into()), None);
                        }
                    }
                    (Kind::Functions | Kind::Series, item) => {
                        let dashed =
                            matches!(item, Item::Function { dashed: true, .. } | Item::Series { dashed: true, .. });
                        layer(dl, opacity, &|dl| {
                            let runs: Vec<&Vec<Px>> = geo.runs.iter().filter(|r| r.len() > 1).collect();
                            let paint = |dl: &mut DisplayList, extra: f32, c: Color| {
                                let sw = width as f32 + extra;
                                for r in &runs {
                                    if let Some(p) = run_path(r) {
                                        let st = if dashed {
                                            Stroke::dashed(c, sw, 16.0, 11.0)
                                        } else {
                                            Stroke::solid(c, sw)
                                        };
                                        dl.path(p, None, Some(st.rounded()));
                                    }
                                }
                                for d in &geo.dots {
                                    let r = 7.0 + extra / 2.0;
                                    if extra > 0.0 {
                                        dl.circle(d[0] as f32, d[1] as f32, r, c);
                                    }
                                }
                            };
                            glowed(dl, glow, color, width, &paint);
                            for d in &geo.dots {
                                if let Some(c) = PathBuilder::from_circle(d[0] as f32, d[1] as f32, 7.0) {
                                    dl.path(c, Some(color.into()), Some(Stroke::solid(BG, 2.0)));
                                }
                            }
                        });
                    }
                    (Kind::Vectors, _) => {
                        let Some([a, b]) = geo.arrow else { return };
                        layer(dl, opacity, &|dl| {
                            let paint = |dl: &mut DisplayList, extra: f32, c: Color| {
                                if let Some(p) = line_path(a, b) {
                                    dl.path(p, None, Some(Stroke::solid(c, width as f32 + extra).rounded()));
                                }
                                if extra > 0.0 {
                                    arrow_head(dl, a, b, c, extra / 2.0);
                                }
                            };
                            glowed(dl, glow, color, width, &paint);
                            arrow_head(dl, a, b, color, 0.0);
                        });
                    }
                    (Kind::Points, Item::Point { guides, .. }) => {
                        let Some(dot) = geo.dot.filter(|_| geo.visible) else { return };
                        layer(dl, opacity, &|dl| {
                            let r = POINT_R + 2.0 * glow;
                            let paint = |dl: &mut DisplayList, extra: f32, c: Color| {
                                dl.circle(dot[0] as f32, dot[1] as f32, r as f32 + extra / 2.0, c);
                            };
                            glowed(dl, glow, color, 2.0 * r, &paint);
                            if *guides {
                                dl.group(|dl| {
                                    dl.fade(0.7);
                                    let dash = |dl: &mut DisplayList, a: Px, b: Px| {
                                        if let Some(p) = line_path(a, b) {
                                            dl.path(p, None, Some(Stroke::dashed(color, 2.5, 8.0, 8.0)));
                                        }
                                    };
                                    dash(dl, dot, [dot[0], axes.x_axis_y]);
                                    if let Some(yx) = axes.y_axis_x {
                                        dash(dl, dot, [yx, dot[1]]);
                                    }
                                });
                            }
                            if let Some(c) = PathBuilder::from_circle(dot[0] as f32, dot[1] as f32, r as f32) {
                                dl.path(c, Some(color.into()), Some(Stroke::solid(BG, 3.0)));
                            }
                        });
                    }
                    _ => {}
                }
            };
            let of_kinds =
                |kinds: &[Kind]| geos.iter().filter(|g| kinds.contains(&m.parts[g.part].kind)).collect::<Vec<_>>();

            clip(dl, &|dl| of_kinds(&[Kind::Areas]).into_iter().for_each(|g| draw_geo(dl, g)));
            // The axes.
            layer(dl, build, &|dl| {
                let w = 2.5;
                stroke_line(dl, [plot.x, axes.x_axis_y], [plot.x + plot.width * build, axes.x_axis_y], MUTED, w);
                if let Some(yx) = axes.y_axis_x {
                    stroke_line(
                        dl,
                        [yx, plot.y + plot.height],
                        [yx, plot.y + plot.height - plot.height * build],
                        MUTED,
                        w,
                    );
                }
                for tk in &axes.ticks_x {
                    let top = axes.x_axis_y - if axes.number_line { TICK_LEN } else { 0.0 };
                    stroke_line(dl, [tk.at, top], [tk.at, axes.x_axis_y + TICK_LEN], MUTED, w);
                }
                if let Some(yx) = axes.y_axis_x {
                    for tk in &axes.ticks_y {
                        stroke_line(dl, [yx - TICK_LEN, tk.at], [yx, tk.at], MUTED, w);
                    }
                }
            });
            clip(dl, &|dl| of_kinds(&[Kind::Functions, Kind::Series]).into_iter().for_each(|g| draw_geo(dl, g)));
            // The axis text sits over the lines, on a halo of the background.
            let tick_style = Style::sans(TICK_FONT.weight as f32, TICK_FONT.size as f32);
            for tk in axes.ticks_x.iter().chain(axes.ticks_y.iter()) {
                halo(
                    dl,
                    &tk.text,
                    tick_style,
                    tk.box_.x as f32,
                    (tk.box_.y + tk.box_.height / 2.0) as f32,
                    MUTED,
                    build as f32,
                );
            }
            let axis_style = Style::sans(AXIS_FONT.weight as f32, AXIS_FONT.size as f32);
            for l in [&axes.label_x, &axes.label_y].into_iter().flatten() {
                halo(
                    dl,
                    &l.text,
                    axis_style,
                    l.box_.x as f32,
                    (l.box_.y + l.box_.height / 2.0) as f32,
                    TEXT,
                    build as f32,
                );
            }
            of_kinds(&[Kind::Vectors, Kind::Points]).into_iter().for_each(|g| draw_geo(dl, g));
            let label_style = Style::sans(LABEL_FONT.weight as f32, LABEL_FONT.size as f32);
            for l in &placed {
                let index = m.parts.iter().position(|p| p.id == l.id).unwrap_or(0);
                let Look { color, opacity, .. } = look(&l.id, index);
                // A label waits for its line to finish drawing, rather than riding the pen across the plot.
                let written = if is_traced(&l.id) { interpolate(t, &[0.85, 1.0], &[0.0, 1.0], CLAMP) } else { 1.0 };
                let _ = &l.tone;
                halo(
                    dl,
                    &l.text,
                    label_style,
                    l.box_.x as f32,
                    (l.box_.y + l.box_.height / 2.0) as f32,
                    color,
                    (opacity * written) as f32,
                );
            }
            // TODO(marks): PenMarks of the scene's steps.
            // TODO(ink): the scene's ink.
        });
        let _ = resolve_ref;
    }
}

fn run_closed(poly: &[Px]) -> Option<Path> {
    let mut pb = PathBuilder::new();
    for (i, p) in poly.iter().enumerate() {
        let (x, y) = px(*p);
        if i == 0 {
            pb.move_to(x, y);
        } else {
            pb.line_to(x, y);
        }
    }
    pb.close();
    pb.finish()
}

/// The arrowhead at the end of a vector, grown by `grow` px.
fn arrow_head(dl: &mut DisplayList, from: Px, to: Px, color: Color, grow: f32) {
    let len = (to[0] - from[0]).hypot(to[1] - from[1]);
    let len = if len == 0.0 { 1.0 } else { len };
    let (ux, uy) = ((to[0] - from[0]) / len, (to[1] - from[1]) / len);
    let (l, w) = (len.min(24.0), 10.0);
    let base = [to[0] - ux * l, to[1] - uy * l];
    let corners = [to, [base[0] - uy * w, base[1] + ux * w], [base[0] + uy * w, base[1] - ux * w]];
    if let Some(p) = run_closed(&corners) {
        let st = (grow > 0.0).then(|| Stroke::solid(color, 2.0 * grow));
        dl.path(p, Some(color.into()), st);
    }
}
