//! The tests scene: what the code under test promises, as a matrix of situations (rows) and outcomes (columns),
//! with the tests that check each cell. A port of src/components/TestMatrix.tsx, src/utils/testsLayout.ts and
//! shared/tests.mjs.

mod layout;
mod matrix;
pub mod names;

use super::{Frame, SceneInput, SceneView};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, drawn_width, fit_height};
use crate::chrome::shell::{Aside, Shell};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Shadow};
use crate::steps::{Emphasis, Spotlight, current_step, step_move};
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::{Fit, Slot, fit_text};
use crate::theme::{
    ACCENT, ACCENT_GLOW, ACCENT_SOFT, ADD, ADD_BG, BORDER, BORDER_STRONG, DEL, DEL_BG, FAINT, MUTED, RAISED, TEXT,
    WARN, content_box,
};
use crate::timing::{FPS, STEP_SETTLE_FRAMES, build_frames, js_round};
use layout::{FOOT_H, HEAD_H, Inputs, Layout, PlacedCell, PlacedRow, Tag, layout_tests, tag_font};
use matrix::{Situation, State, Test, resolve_ref};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

const START: f64 = 8.0;
const CALLOUT_PAD_X: f64 = 22.0;
const CALLOUT_PAD_Y: f32 = 12.0;
const CALLOUT_W: f64 = 560.0;

#[derive(Deserialize)]
struct TestsScene {
    #[serde(default)]
    subject: Option<String>,
    #[serde(default)]
    when: Option<String>,
    #[serde(default)]
    outcomes: Vec<String>,
    #[serde(default)]
    situations: Vec<Situation>,
    #[serde(default)]
    tests: Vec<Test>,
    #[serde(default)]
    callout: Option<String>,
    #[serde(default)]
    steps: Vec<Value>,
}

struct TestsView {
    shell: Shell,
    layout: Layout,
    box_h: f64,
    /// The steps that light each item key.
    keys: HashMap<String, Vec<usize>>,
    /// The callout of the narration, then of each step.
    callouts: Vec<String>,
    callout_fits: HashMap<String, Fit>,
    callout_w: f32,
    callout_h: f32,
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: TestsScene = super::parse(input)?;
    let shell = Shell::new(input.scene);
    let step_callouts: Vec<String> =
        scene.steps.iter().map(|s| s.get("callout").and_then(Value::as_str).unwrap_or("").to_string()).collect();
    // Every callout the scene shows, fitted (src/fit/callout.ts).
    let mut texts: Vec<String> = Vec::new();
    for t in scene.callout.iter().chain(step_callouts.iter()) {
        if !t.is_empty() && !texts.contains(t) {
            texts.push(t.clone());
        }
    }
    let callout_fits: HashMap<String, Fit> = texts
        .iter()
        .map(|t| (t.clone(), fit_text(t, &Slot::named("headerCallout", CALLOUT_W - 2.0 * CALLOUT_PAD_X))))
        .collect();
    let has_callout = !callout_fits.is_empty();
    let callout_w = callout_fits.values().map(|f| f.width).fold(0.0, f64::max) + 2.0 * CALLOUT_PAD_X;
    let callout_h = callout_fits.values().map(|f| f.height).fold(0.0, f64::max) as f32 + 2.0 * CALLOUT_PAD_Y;

    // headerBox: the content box, a wrapped title's extra lines taken off.
    let (bw, mut bh) = content_box(shell.title.is_some() || has_callout);
    if let Some(t) = &shell.title {
        bh -= (t.lines.len() as f64 - 1.0) * js_round(t.size * t.line_height);
    }
    let inputs = Inputs {
        when: scene.when.as_deref(),
        subject: scene.subject.as_deref(),
        outcomes: &scene.outcomes,
        situations: &scene.situations,
        tests: &scene.tests,
    };
    let added = names::added_test_count(input.props.hunks.values());
    let layout = layout_tests(&inputs, bw, bh, added);

    let mut keys: HashMap<String, Vec<usize>> = HashMap::new();
    for (k, step) in scene.steps.iter().enumerate() {
        let refs: Vec<&Value> = match step.get("focus") {
            Some(Value::Array(a)) => a.iter().collect(),
            Some(v) => vec![v],
            None => vec![&Value::Null],
        };
        let mut lit: Vec<String> = Vec::new();
        for r in refs {
            for key in resolve_ref(&scene.situations, &scene.outcomes, &scene.tests, r).unwrap_or_default() {
                if !lit.contains(&key) {
                    lit.push(key);
                }
            }
        }
        for key in lit {
            keys.entry(key).or_default().push(k);
        }
    }
    let mut callouts = vec![String::new()];
    callouts.extend(step_callouts);
    Ok(Box::new(TestsView {
        shell,
        layout,
        box_h: bh,
        keys,
        callouts,
        callout_fits: if has_callout { callout_fits } else { HashMap::new() },
        callout_w: callout_w as f32,
        callout_h,
    }))
}

/// How lit an item is at least as bright as its container (`asBrightAs`).
fn as_bright_as(own: Emphasis, others: &[Emphasis]) -> Emphasis {
    Emphasis { opacity: others.iter().fold(own.opacity, |a, e| a.max(e.opacity)), ..own }
}

fn alpha(c: Color, a: f32) -> Color {
    c.alpha(a)
}

/// A line through the text of every line of a fit, as `text-decoration: line-through` draws it.
fn strike(dl: &mut DisplayList, fit: &Fit, x: f32, y: f32, lh: f32, color: Color, thickness: f32) {
    let size = fit.size as f32;
    let face: Face = fit.font.family.into();
    for (i, line) in fit.lines.iter().enumerate() {
        let w = drawn_width(fit, line, None);
        let base = y + i as f32 * lh + baseline_in(face, size, lh);
        dl.fill_rect(x, base - 0.31 * size - thickness / 2.0, w, thickness, color);
    }
}

impl TestsView {
    fn emphasis(&self, spot: &Spotlight, key: &str) -> Emphasis {
        spot.emphasis(self.keys.get(key).map_or(&[][..], |v| v.as_slice()))
    }

    fn draw_cell(&self, dl: &mut DisplayList, c: &PlacedCell, land: f64, e: Emphasis) {
        let l = &self.layout;
        let cell = &l.matrix.rows[c.row].cells[c.col];
        let (pad_x, lh) = (l.pad_x as f32, l.line_height as f32);
        let small = l.tag_font;
        let checked = cell.state == State::Checked;
        let glow = e.glow as f32;
        let (color, bw) = match cell.state {
            State::Checked => (ADD, 1.5f32),
            State::Unchecked => (WARN, 1.5),
            State::Removed => (FAINT, 1.5),
            State::None => (FAINT, 0.0),
        };
        let text_h = c.value.as_ref().map_or(if cell.state == State::None { l.line_height } else { 0.0 }, |v| {
            v.lines.len() as f64 * l.line_height
        }) + if c.was.is_some() { js_round(small * 1.25) } else { 0.0 };
        let (x, y, w, h) = (c.b.x as f32, c.b.y as f32, c.b.w as f32, c.b.h as f32);
        dl.group(|dl| {
            dl.fade((land * e.opacity) as f32);
            dl.translate(0.0, (1.0 - land as f32) * 14.0);
            let mut style = if checked { BoxStyle::fill(ADD_BG) } else { BoxStyle::empty() }.radius(10.0);
            match cell.state {
                State::Checked => {
                    style = style.border(if glow > 0.0 { ADD } else { alpha(ADD, 0x88 as f32 / 255.0) }, 1.5)
                }
                State::Unchecked => {
                    style = style.border_stroke(crate::display::Stroke::dashed(
                        alpha(WARN, 0xcc as f32 / 255.0),
                        1.5,
                        4.5,
                        4.5,
                    ))
                }
                State::Removed => style = style.border_stroke(crate::display::Stroke::dashed(FAINT, 1.5, 4.5, 4.5)),
                State::None => {}
            }
            if glow > 0.0 {
                style = style
                    .shadow(Shadow { spread: 3.0 * glow, ..Shadow::new(0.0, 0.0, 0.0, ACCENT_SOFT) })
                    .shadow(Shadow::new(0.0, 0.0, 28.0 * glow, ACCENT_GLOW));
            }
            dl.rect(x, y, w, h, style);
            let tx = x + bw + pad_x;
            let mut ty = y + bw + (h - text_h as f32) / 2.0 - 1.5;
            if let Some(v) = &c.value {
                ty += draw_fit(dl, v, tx, ty, TextOpts::new(color).line_height(LineHeight::Times(lh / v.size as f32)));
            } else if cell.state == State::None {
                let st = Style::sans(400.0, l.font as f32);
                dl.text("–", st, tx, ty + baseline_in(Face::Sans, l.font as f32, lh), FAINT);
            }
            if let Some(f) = &c.was {
                let wlh = js_round(small * 1.25) as f32;
                let opts = TextOpts::new(MUTED).line_height(LineHeight::Times(wlh / f.size as f32));
                draw_fit(dl, f, tx, ty, opts);
                strike(dl, f, tx, ty, wlh, DEL, 2.0);
            }
            if let Some(tag) = c.tag {
                let font = tag_font(tag, small);
                let st = Style::sans(font.weight as f32, small as f32).spacing(font.letter_spacing as f32);
                let ln = line_metrics(Face::Sans, small as f32).normal;
                let inner_h = h - 2.0 * bw;
                let color = match tag {
                    Tag::New => ADD,
                    Tag::Changed => ACCENT,
                    Tag::Unchecked => WARN,
                    Tag::Removed => MUTED,
                };
                let tw = width(tag.text(), st);
                dl.text(
                    tag.text(),
                    st,
                    x + w - bw - pad_x - tw,
                    y + bw + (inner_h - ln) / 2.0 + baseline_in(Face::Sans, small as f32, ln),
                    color,
                );
            }
        });
    }

    fn draw_row(&self, dl: &mut DisplayList, row: &PlacedRow, r: usize, land: f64, spot: &Spotlight) {
        let l = &self.layout;
        let m = &l.matrix.rows[r];
        let own = self.emphasis(spot, &m.key);
        let cells: Vec<(&PlacedCell, Emphasis)> =
            row.cells.iter().map(|c| (c, as_bright_as(self.emphasis(spot, &m.cells[c.col].key), &[own]))).collect();
        let cell_es: Vec<Emphasis> = cells.iter().map(|(_, e)| *e).collect();
        let head = as_bright_as(own, &cell_es);
        let (pad_x, lh) = (l.pad_x as f32, l.line_height as f32);
        let y = row.b.y as f32;
        let h = row.b.h as f32;
        let gap_color = DEL;
        dl.group(|dl| {
            dl.fade((land * head.opacity) as f32);
            if head.bar > 0.0 {
                dl.group(|dl| {
                    dl.fade(head.bar as f32);
                    dl.rect(-14.0, y + 8.0, 5.0, h - 16.0, BoxStyle::fill(ACCENT).radius(3.0));
                });
            }
            let lines = row.when.lines.len() as f32;
            draw_fit(
                dl,
                &row.when,
                0.0,
                y + (h - lines * lh) / 2.0,
                TextOpts::new(if m.gap { gap_color } else { TEXT })
                    .line_height(LineHeight::Times(lh / row.when.size as f32)),
            );
            if !row.count.is_empty() {
                let small = l.tag_font as f32;
                let st = Style::sans(600.0, small);
                let ln = line_metrics(Face::Sans, small).normal;
                let tw = width(&row.count, st);
                dl.text(
                    &row.count,
                    st,
                    l.when_col.w as f32 - pad_x - tw,
                    y + (h - ln) / 2.0 + baseline_in(Face::Sans, small, ln),
                    if row.count == "no test" { WARN } else { FAINT },
                );
            }
        });
        if let Some((b, text)) = &row.bar {
            dl.group(|dl| {
                dl.fade((land * own.opacity) as f32);
                let glow = own.glow as f32;
                let mut style = if glow > 0.0 { BoxStyle::fill(DEL_BG) } else { BoxStyle::empty() }
                    .radius(10.0)
                    .border_stroke(crate::display::Stroke::dashed(gap_color, 2.0, 6.0, 6.0));
                if glow > 0.0 {
                    style = style.shadow(Shadow::new(0.0, 0.0, 30.0 * glow, DEL_BG));
                }
                dl.rect(b.x as f32, b.y as f32, b.w as f32, b.h as f32, style);
                let lines = text.lines.len() as f32;
                draw_fit(
                    dl,
                    text,
                    b.x as f32 + 2.0 + pad_x,
                    b.y as f32 + 2.0 + (b.h as f32 - lines * lh) / 2.0 - 2.0,
                    TextOpts::new(gap_color).line_height(LineHeight::Times(lh / text.size as f32)),
                );
            });
        }
        for (c, e) in cells {
            self.draw_cell(dl, c, land, e);
        }
        if let Some(nc) = &l.names_col
            && !row.names.is_empty()
        {
            let name_h = js_round(row.names[0].0.size * 1.25) as f32;
            let name_rows: usize = row.names.iter().map(|(f, _)| f.lines.len()).sum();
            dl.group(|dl| {
                dl.fade((land * head.opacity) as f32);
                let mut ny = y + (h - name_rows as f32 * name_h) / 2.0;
                for (fit, removed) in &row.names {
                    let color = if *removed { FAINT } else { MUTED };
                    let x = (nc.x + l.pad_x) as f32;
                    let opts = TextOpts::new(color).line_height(LineHeight::Times(name_h / fit.size as f32));
                    let drawn = draw_fit(dl, fit, x, ny, opts);
                    if *removed {
                        strike(dl, fit, x, ny, name_h, color, 1.0);
                    }
                    ny += drawn;
                }
            });
        }
    }

    fn draw_callout(&self, dl: &mut DisplayList, x: f32, y: f32, frame: f64, f: &Frame) {
        let k = current_step(f.segments, frame);
        let (was, now, t, lit) = match k {
            Some(k) if self.callouts.get(k + 1).is_some() => {
                let from = f.segments[k + 1].from;
                let settled = from + STEP_SETTLE_FRAMES;
                (
                    self.callouts[k].as_str(),
                    self.callouts[k + 1].as_str(),
                    step_move(frame, from) as f32,
                    interpolate(frame, &[from, settled, settled + 40.0], &[0.0, 1.0, 0.0], CLAMP) as f32,
                )
            }
            _ => (self.callouts[0].as_str(), self.callouts[0].as_str(), 1.0, 0.0),
        };
        let (a, b) = (if was.is_empty() { 0.0 } else { 1.0 }, if now.is_empty() { 0.0 } else { 1.0 });
        let changed = was != now;
        let glow = if changed { lit } else { 0.0 };
        let (w, h) = (self.callout_w, self.callout_h);
        dl.group(|dl| {
            dl.fade(a + (b - a) * t);
            let mut style =
                BoxStyle::fill(RAISED).radius(14.0).border(if glow > 0.0 { ACCENT } else { BORDER_STRONG }, 1.5);
            style = if glow > 0.0 {
                style
                    .shadow(Shadow { spread: 3.0 * glow, ..Shadow::new(0.0, 0.0, 0.0, ACCENT_SOFT) })
                    .shadow(Shadow::new(0.0, 0.0, 30.0 * glow, ACCENT_GLOW))
            } else {
                style.shadow(Shadow::new(0.0, 10.0, 26.0, Color::rgba8(0, 0, 0, 0.35)))
            };
            dl.rect(x, y, w, h, style);
            let text = |dl: &mut DisplayList, value: &str, opacity: f32| {
                let Some(fit) = self.callout_fits.get(value).filter(|_| !value.is_empty() && opacity > 0.0) else {
                    return;
                };
                dl.group(|dl| {
                    dl.fade(opacity);
                    let fh = fit_height(fit, LineHeight::Fit);
                    draw_fit(dl, fit, x + 1.5, y + 1.5 + (h - 3.0 - fh) / 2.0, TextOpts::new(TEXT).centered(w - 3.0));
                });
            };
            if changed {
                text(dl, was, 1.0 - t);
                text(dl, now, t);
            } else {
                text(dl, now, 1.0);
            }
        });
    }
}

impl SceneView for TestsView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let l = &self.layout;
        let starts: Vec<f64> = f.segments.iter().skip(1).map(|s| s.from).collect();
        let spot = Spotlight::new(frame, &starts);
        let n = l.rows.len();
        let stagger = 5f64.min((build_frames("tests") - START - 24.0) / (n as f64 - 1.0).max(1.0));
        let at = |i: usize| START + 6.0 + i as f64 * stagger;
        let header_in = interpolate(frame, &[START, START + 10.0], &[0.0, 1.0], CLAMP) as f32;
        let top = (self.box_h - l.height * l.scale).max(0.0) * 0.3;

        let draw_callout = |dl: &mut DisplayList, right: f32, top: f32| {
            self.draw_callout(dl, right - self.callout_w, top, frame, f);
        };
        let aside = (!self.callout_fits.is_empty()).then_some(Aside { height: self.callout_h, draw: &draw_callout });
        // TODO(camera): the generic `camera` field frames the content box here.
        self.shell.draw(dl, frame, f.duration, aside, |dl, _bx| {
            dl.group(|dl| {
                dl.translate(0.0, top as f32);
                dl.scale_about(l.scale as f32, 0.0, 0.0);
                let label = |dl: &mut DisplayList, x: f32, fit: &Fit, opacity: f32, color: Color| {
                    dl.group(|dl| {
                        dl.fade(opacity);
                        let fh = fit_height(fit, LineHeight::Normal);
                        draw_fit(dl, fit, x, (HEAD_H as f32 - fh) / 2.0, TextOpts::new(color).normal());
                    });
                };
                label(dl, 0.0, &l.when_col.title, header_in, MUTED);
                for (col, c) in l.cols.iter().enumerate() {
                    let e = self.emphasis(&spot, &format!("o:{col}"));
                    let color = if e.glow > 0.0 { TEXT } else { MUTED };
                    label(dl, (c.x + l.pad_x) as f32, &c.title, header_in * e.opacity as f32, color);
                }
                if let Some(nc) = &l.names_col {
                    label(dl, (nc.x + l.pad_x) as f32, &nc.title, header_in, MUTED);
                }
                for (i, row) in l.rows.iter().enumerate() {
                    let land = spring(frame - at(i), FPS, Spring::damping(18.0).with_stiffness(140.0));
                    self.draw_row(dl, row, i, land, &spot);
                }
                // The footer: the subject at the left, the counts at the right.
                let foot = interpolate(frame, &[at(n), at(n) + 10.0], &[0.0, 1.0], CLAMP) as f32;
                dl.group(|dl| {
                    dl.fade(foot);
                    let fy = l.foot_y as f32;
                    dl.fill_rect(0.0, fy, l.width as f32, 1.0, BORDER);
                    let inner = fy + 1.0;
                    if let Some(s) = &l.subject {
                        let fh = fit_height(s, LineHeight::Normal);
                        draw_fit(dl, s, 0.0, inner + (FOOT_H as f32 - fh) / 2.0, TextOpts::new(MUTED).normal());
                    }
                    let st = Style::sans(400.0, 18.0);
                    let ln = line_metrics(Face::Sans, 18.0).normal;
                    let tw = width(&l.counts, st);
                    dl.text(
                        &l.counts,
                        st,
                        l.width as f32 - tw,
                        inner + (FOOT_H as f32 - ln) / 2.0 + baseline_in(Face::Sans, 18.0, ln),
                        MUTED,
                    );
                });
            });
            // TODO(marks): the pen marks of the steps' `mark`s and notes are drawn here.
        });
    }
}
