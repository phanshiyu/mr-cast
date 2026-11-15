//! The code scene: one hunk in a panel, its steps lit one after another as the camera scrolls to each, removed
//! lines flashing and collapsing and added ones growing in, with a callout or a step diagram beside it. A port
//! of src/components/CodeDiff.tsx, StepDiagram.tsx, src/utils/codeLayout.ts, stepsLayout.ts and diffRows.ts.
//!
//! Not ported yet: typing (`typing`, src/components/CodeTyping.tsx) draws the code as a morph, the output pane of
//! steps with `output`, pen marks and the camera.

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, Spring, clamped, interpolate, spring};
use crate::camera::Camera;
use crate::chrome::callout::header_box;
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, fit_height};
use crate::chrome::shell::Shell;
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint, PathBuilder, Shadow, Stroke};
use crate::focus::line_focus_ranges;
use crate::icons;
use crate::marks::geometry::{Bx, Pt, union};
use crate::marks::{Board, BoxOf, InkOf, MarkTargets, StepRefs, token_hits};
use crate::model::{Hunk, HunkStatus, LineType, TokenLine};
use crate::steps::step_move;
use crate::text::{Face, Style, line_metrics, width};
use crate::textfit::{Family, Fit, Font, Slot, fit_lines, fit_text, fit_text_at, measure};
use crate::theme::{
    ACCENT, ACCENT_SOFT, ADD, ADD_BG, BORDER, BORDER_STRONG, CODE_TAB_SIZE, DEL, DEL_BG, FAINT, MUTED, RAISED, SURFACE,
    TEXT, WARN, code_columns, content_box,
};
use crate::timing::{FPS, js_round};
use crate::timing::{Segment, cue_frame};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

const STEP_FADE: f64 = 14.0;
const VISITED_OPACITY: f64 = 0.6;
const DIM_OPACITY: f64 = 0.3;

const SIGN_W: f32 = 26.0;
const SPLIT_NUMBER_W: f32 = 66.0;
const MORPH_NUMBER_W: f32 = 58.0;
const SPLIT_GUTTER_W: f32 = SPLIT_NUMBER_W + SIGN_W;
const MORPH_GUTTER_W: f32 = MORPH_NUMBER_W * 2.0 + SIGN_W;
const HARD_MIN: f64 = 10.0;
const CODE_RIGHT_PAD: f64 = 14.0;
const PANEL_PAD: f32 = 18.0;
const HEADER_H: f32 = 92.0;
const HEADER_GAP: f32 = 22.0;
const CALLOUT_W: f32 = 420.0;
const CALLOUT_GAP: f32 = 56.0;
const CALLOUT_BELOW_H: f32 = 112.0;
const CALLOUT_PAD: (f64, f64) = (52.0, 44.0);
const FLOW_CODE_SHARE: f64 = 0.6;
const FLOW_GAP: f64 = 72.0;
const FLOW_CALLOUT_GAP: f32 = 36.0;
const CONTEXT_ROWS: usize = 3;

// Step diagram (src/utils/stepsLayout.ts).
const NODE_PAD_X: f64 = 20.0;
const NODE_PAD_Y: f64 = 16.0;
const BADGE: f64 = 40.0;
const BADGE_GAP: f64 = 16.0;
const ARROW_GAPS: [f64; 2] = [42.0, 26.0];
const OUTCOME_GAP: f64 = 8.0;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeStep {
    label: Option<String>,
    outcome: Option<String>,
    output: Option<String>,
    output_when: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeScene {
    hunk_id: String,
    #[serde(default)]
    steps: Vec<CodeStep>,
    view: Option<String>,
    flow: Option<Vec<CodeStep>>,
    callout_text: Option<String>,
    #[serde(default)]
    typing: bool,
    output_title: Option<String>,
}

#[derive(Clone, Copy, PartialEq)]
enum View {
    Split,
    Morph,
}

#[derive(Clone, Copy, PartialEq)]
enum CalloutAt {
    Beside,
    Below,
    Flow,
}

/// One displayed row: a side-by-side pair of hunk.lines indices, or the same index twice in morph view.
#[derive(Clone, Copy)]
struct Slot2 {
    left: Option<usize>,
    right: Option<usize>,
    step: Option<usize>,
}

struct StepNode {
    top: f64,
    height: f64,
    label: Fit,
    outcome: Option<Fit>,
}

struct StepLayout {
    font: f64,
    nodes: Vec<StepNode>,
    height: f64,
}

struct Callout {
    at: CalloutAt,
    text: Fit,
    height: f32,
}

#[derive(Clone, Copy)]
struct Morph {
    flash_start: f64,
    collapse_start: f64,
    collapse_end: f64,
    grow_start: f64,
    stagger: f64,
    grow_end: f64,
}

struct CodeView {
    shell: Shell,
    hunk: Hunk,
    tokens: Vec<TokenLine>,
    view: View,
    slots: Vec<Slot2>,
    step_count: usize,
    stepped: bool,
    font: f32,
    row_h: f32,
    panel_w: f32,
    panel_h: f32,
    viewport_h: f32,
    path: Fit,
    header: Option<Fit>,
    callout: Option<Callout>,
    steps: Option<StepLayout>,
    diagram_left: f32,
    diagram_w: f32,
    diagram_top: f32,
    /// Index of the last step that names only old lines, if any.
    last_old: Option<usize>,
    /// When each typed row types, for a typing scene.
    typing: Option<Typing>,
    output: Option<OutputPane>,
    /// The scroll stop of each step, planned on the settled layout.
    stops: Vec<f32>,
    /// Pen marks and ink, the camera, and the pen's boxes for each step.
    board: Option<Board>,
    camera: Option<Camera>,
    marks: Vec<Option<MarkTargets>>,
    /// The step currently at each step's top row is in `slots`; its first row.
    first_row: Vec<Option<usize>>,
}

/// When each row of a typing scene types (`TypingSchedule` of src/utils/codeTyping.ts).
struct Typing {
    /// By row: the frame its first character appears, how many it types and how fast; None for a line already there.
    lines: Vec<Option<(f64, usize, f64)>>,
    /// By step: the frame its typing ends.
    ends: Vec<f64>,
}

const TYPE_FASTEST: f64 = 3.0;
const TYPE_SLOWEST: f64 = 0.6;
const TYPED_BY: f64 = 0.8;

fn indent_of(text: &str) -> usize {
    text.chars().count() - text.trim_start().chars().count()
}

/// `typingSchedule`.
fn typing_schedule(
    texts: &[String],
    slots: &[Slot2],
    step_count: usize,
    segments: &[Segment],
    duration: f64,
) -> Typing {
    let mut lines = vec![None; slots.len()];
    let mut ends = Vec::new();
    for k in 0..step_count {
        let own: Vec<usize> = slots.iter().enumerate().filter(|(_, s)| s.step == Some(k)).map(|(r, _)| r).collect();
        let Some(seg) = segments.get(k + 1).filter(|_| !own.is_empty()) else {
            ends.push(segments.get(k + 1).map_or(0.0, |s| s.from));
            continue;
        };
        let start = seg.from + 4.0;
        let next = segments.get(k + 2).map_or(duration, |s| s.from);
        let chars: usize = own.iter().map(|&r| texts[r].trim_start().chars().count()).sum();
        let window = 10f64.max(seg.voice_from + seg.speaking_frames * TYPED_BY - start);
        let frames =
            window.max(chars as f64 / TYPE_FASTEST).min(chars as f64 / TYPE_SLOWEST).min(1f64.max(next - 6.0 - start));
        let per = (chars as f64 / frames.max(1.0)).max(1e-6);
        let mut at = start;
        for &r in &own {
            let n = texts[r].trim_start().chars().count();
            lines[r] = Some((at, n, per));
            at += n as f64 / per;
        }
        ends.push(at);
    }
    Typing { lines, ends }
}

impl Typing {
    /// The row the cursor sits on at `frame`, and whether it is typing (true) or resting there (`cursorAt`).
    fn cursor(&self, frame: f64) -> Option<(usize, bool)> {
        let mut best = None;
        for (r, l) in self.lines.iter().enumerate() {
            if let Some((from, chars, per)) = l
                && frame >= *from
            {
                best = Some((r, frame < from + *chars as f64 / per));
            }
        }
        best
    }
}

const OUTPUT_CHROME_H: f32 = 46.0;
const OUTPUT_PAD: (f32, f32) = (24.0, 18.0);
const OUTPUT_GAP: f64 = 40.0;
const OUTPUT_CODE_SHARE: f64 = 0.58;
const OUTPUT_FONT: f64 = 22.0;
const OUTPUT_LINE_GAP: f64 = 4.0;

/// The terminal-like pane steps print into (`OutputPaneLayout` and `OutputPane`).
struct OutputPane {
    x: f32,
    width: f32,
    title: Fit,
    lines: Vec<(usize, Fit, f32, f32)>,
    /// When each step's output starts printing.
    starts: Vec<f64>,
}

fn layout_output(steps: &[CodeStep], title: Option<&str>, x: f64, width: f64) -> OutputPane {
    let row_h = js_round(OUTPUT_FONT * 1.5);
    let inner = width - 2.0 * OUTPUT_PAD.0 as f64;
    let mut y = OUTPUT_PAD.1 as f64;
    let mut lines = Vec::new();
    for (k, step) in steps.iter().enumerate() {
        let Some(out) = &step.output else { continue };
        for raw in out.split('\n') {
            let mut slot = Slot::named("terminalOutput", inner);
            slot.size = OUTPUT_FONT;
            slot.min = OUTPUT_FONT;
            let fit = fit_text(raw.replace('\t', "  ").trim_end(), &slot);
            let h = fit.lines.len().max(1) as f64 * row_h;
            lines.push((k, fit, y as f32, h as f32));
            y += h;
        }
    }
    OutputPane {
        x: x as f32,
        width: width as f32,
        title: fit_text(title.unwrap_or("Output"), &Slot::named("terminalWindow", width - 140.0)),
        lines,
        starts: Vec::new(),
    }
}

/// Pairs each run of deletions with the run of additions after it, GitHub style (`splitRows`).
fn split_rows(hunk: &Hunk) -> Vec<(Option<usize>, Option<usize>)> {
    let lines = &hunk.lines;
    let mut rows = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].kind == LineType::Context {
            rows.push((Some(i), Some(i)));
            i += 1;
            continue;
        }
        let (mut dels, mut adds) = (Vec::new(), Vec::new());
        while i < lines.len() && lines[i].kind == LineType::Del {
            dels.push(i);
            i += 1;
        }
        while i < lines.len() && lines[i].kind == LineType::Add {
            adds.push(i);
            i += 1;
        }
        for k in 0..dels.len().max(adds.len()) {
            rows.push((dels.get(k).copied(), adds.get(k).copied()));
        }
    }
    rows
}

fn default_view(hunk: &Hunk, scene: &Value) -> View {
    let focus = line_focus_ranges(scene, hunk);
    let changed = |i: Option<usize>| i.is_some_and(|i| hunk.lines[i].kind != LineType::Context);
    let focused: Vec<_> = split_rows(hunk)
        .into_iter()
        .filter(|&(l, r)| [l, r].iter().any(|&i| changed(i) && focus[i.unwrap()].is_some()))
        .collect();
    let paired = focused.iter().filter(|&&(l, r)| changed(l) && changed(r)).count();
    if paired > 0 && 2 * paired >= focused.len() { View::Split } else { View::Morph }
}

fn crop_slots(hunk: &Hunk, view: View, scene: &Value, stepped: usize, typing: bool) -> (Vec<Slot2>, usize) {
    let range_of = line_focus_ranges(scene, hunk);
    // Typing writes the new code, so removed lines are not drawn.
    let rows: Vec<(Option<usize>, Option<usize>)> = match view {
        View::Split => split_rows(hunk),
        View::Morph => (0..hunk.lines.len())
            .filter(|&i| !(typing && hunk.lines[i].kind == LineType::Del))
            .map(|i| (Some(i), Some(i)))
            .collect(),
    };
    let mut order: Vec<usize> = Vec::new();
    let slots: Vec<Slot2> = rows
        .into_iter()
        .map(|(left, right)| {
            let id = [left, right].iter().flatten().filter_map(|&i| range_of[i]).min();
            let step = id.map(|id| {
                if stepped > 0 {
                    id
                } else {
                    if !order.contains(&id) {
                        order.push(id);
                    }
                    order.iter().position(|&o| o == id).unwrap()
                }
            });
            Slot2 { left, right, step }
        })
        .collect();
    let focused: Vec<usize> = slots.iter().enumerate().filter(|(_, s)| s.step.is_some()).map(|(i, _)| i).collect();
    let (Some(&first), Some(&last)) = (focused.first(), focused.last()) else { return (slots, stepped) };
    let from = first.saturating_sub(CONTEXT_ROWS);
    let to = slots.len().min(last + 1 + CONTEXT_ROWS);
    (slots[from..to].to_vec(), if stepped > 0 { stepped } else { order.len() })
}

fn status_label(s: HunkStatus) -> &'static str {
    match s {
        HunkStatus::Added => "new",
        HunkStatus::Modified => "changed",
        HunkStatus::Deleted => "removed",
        HunkStatus::Renamed => "renamed",
        HunkStatus::Source => "source",
    }
}

fn status_color(s: HunkStatus) -> Color {
    match s {
        HunkStatus::Added => ADD,
        HunkStatus::Modified => ACCENT,
        HunkStatus::Deleted => DEL,
        HunkStatus::Renamed => WARN,
        HunkStatus::Source => MUTED,
    }
}

fn range_text(h: &Hunk) -> String {
    if h.status == HunkStatus::Deleted {
        format!("L{}", h.old_start_line)
    } else {
        format!("L{}–{}", h.start_line, h.end_line)
    }
}

fn morph_gutter_w(h: &Hunk) -> f32 {
    if h.status == HunkStatus::Source { SPLIT_GUTTER_W } else { MORPH_GUTTER_W }
}

/// Width of the status pill and the line counts on either side of the path (`headerChrome`).
fn header_chrome(h: &Hunk) -> f64 {
    let pill = measure(status_label(h.status), &Font::new(Family::Sans, 700.0, 20.0).spacing(1.5).upper()) + 32.0 + 2.0;
    let mono = Font::new(Family::Mono, 600.0, 24.0);
    let counts = if h.status == HunkStatus::Source {
        0.0
    } else {
        measure(&format!("+{}", h.additions), &mono) + measure(&format!("−{}", h.deletions), &mono) + 28.0
    };
    pill + 44.0 + counts + 8.0 + measure(&range_text(h), &mono)
}

fn expand_tabs(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        if ch == '\t' {
            let n = CODE_TAB_SIZE - (out.chars().count() % CODE_TAB_SIZE);
            out.push_str(&" ".repeat(n));
        } else {
            out.push(ch);
        }
    }
    out
}

fn layout_steps(steps: &[&CodeStep], width: f64, max_height: f64) -> StepLayout {
    let at = |font: f64, gap: f64, lines: usize| {
        let text_w = width - NODE_PAD_X * 2.0 - BADGE - BADGE_GAP;
        let small = js_round(font * 0.8);
        let mut nodes = Vec::new();
        let mut top = 0.0;
        let mut fits = true;
        for s in steps {
            let mut ls = Slot::named("stepLabel", text_w);
            ls.lines = lines;
            let label = fit_text_at(s.label.as_deref().unwrap_or(""), &ls, font);
            let outcome = s.outcome.as_deref().filter(|o| !o.trim().is_empty()).map(|o| {
                let mut os = Slot::named("stepOutcome", text_w - small - 8.0);
                os.lines = lines;
                fit_text_at(o, &os, small)
            });
            fits &= label.fits && outcome.as_ref().is_none_or(|o| o.fits);
            let text = label.height + outcome.as_ref().map_or(0.0, |o| OUTCOME_GAP + o.height);
            let height = js_round(BADGE.max(text) + NODE_PAD_Y * 2.0);
            nodes.push(StepNode { top, height, label, outcome });
            top += height + gap;
        }
        (StepLayout { font, nodes, height: top - gap }, fits)
    };
    let mut size = 26.0;
    while size >= 17.0 {
        for gap in ARROW_GAPS {
            let (l, fits) = at(size, gap, 2);
            if fits && l.height <= max_height {
                return l;
            }
        }
        size -= 1.0;
    }
    at(17.0, ARROW_GAPS[1], 3).0
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: CodeScene = parse(input)?;
    let raw = input.scene;
    let Some(hunk) = input.props.hunks.get(&scene.hunk_id).cloned() else {
        return Err(format!("hunk {} not found", scene.hunk_id));
    };
    let (bw, bh) = content_box(false);
    let stepped = !scene.steps.is_empty();
    let flow: Option<Vec<&CodeStep>> = if stepped {
        scene.steps.iter().all(|s| s.label.is_some()).then(|| scene.steps.iter().collect())
    } else {
        scene.flow.as_ref().filter(|f| !f.is_empty()).map(|f| f.iter().collect())
    };
    let view = if hunk.status == HunkStatus::Source || scene.typing {
        View::Morph
    } else {
        match scene.view.as_deref() {
            Some("split") => View::Split,
            Some("morph") => View::Morph,
            _ if flow.is_some() => View::Morph,
            _ => default_view(&hunk, raw),
        }
    };
    let (slots, step_count) = crop_slots(&hunk, view, raw, scene.steps.len(), scene.typing);
    let callout_text = scene.callout_text.as_deref().map(str::trim).filter(|t| !t.is_empty());
    let printing = flow.is_none() && scene.steps.iter().any(|s| s.output.is_some());
    let at = callout_text.map(|_| {
        if flow.is_some() {
            CalloutAt::Flow
        } else if view == View::Morph && !printing {
            CalloutAt::Beside
        } else {
            CalloutAt::Below
        }
    });
    let panel_w = if flow.is_some() {
        js_round(bw * FLOW_CODE_SHARE)
    } else if printing {
        js_round(bw * OUTPUT_CODE_SHARE)
    } else if at == Some(CalloutAt::Beside) {
        bw - CALLOUT_W as f64 - CALLOUT_GAP as f64
    } else {
        bw
    };
    let panel_h = bh
        - HEADER_H as f64
        - HEADER_GAP as f64
        - if at == Some(CalloutAt::Below) { CALLOUT_BELOW_H as f64 + 28.0 } else { 0.0 };
    let mut shown: Vec<String> = Vec::new();
    for s in &slots {
        for i in [s.left, s.right].into_iter().flatten() {
            let t = expand_tabs(&hunk.lines[i].text);
            if !shown.contains(&t) {
                shown.push(t);
            }
        }
    }
    let inner = panel_w - 2.0;
    let column = match view {
        View::Split => (inner - 1.0) / 2.0 - SPLIT_GUTTER_W as f64,
        View::Morph => inner - morph_gutter_w(&hunk) as f64,
    } - CODE_RIGHT_PAD;
    let mut code_slot = Slot::named("code", column);
    code_slot.size = if view == View::Split { 20.0 } else { 23.0 };
    code_slot.min = HARD_MIN;
    let drawn = fit_lines(&shown, &code_slot, f64::INFINITY);
    let font = drawn.size;

    let diagram_left = panel_w + FLOW_GAP;
    let diagram_w = bw - diagram_left;
    let callout = callout_text.zip(at).map(|(t, at)| {
        let w = match at {
            CalloutAt::Flow => diagram_w,
            CalloutAt::Beside => CALLOUT_W as f64,
            CalloutAt::Below => bw,
        };
        let mut s = Slot::named("callout", w - CALLOUT_PAD.0);
        s.lines = match at {
            CalloutAt::Beside => 5,
            CalloutAt::Flow => 4,
            CalloutAt::Below => 2,
        };
        let text = fit_text(t, &s);
        Callout { at, height: (text.height + CALLOUT_PAD.1) as f32, text }
    });
    let flow_block =
        callout.as_ref().filter(|c| c.at == CalloutAt::Flow).map_or(0.0, |c| c.height as f64 + FLOW_CALLOUT_GAP as f64);
    let steps = flow.as_ref().map(|f| layout_steps(f, diagram_w, panel_h - flow_block));
    let path_text = match (&hunk.old_file, hunk.status) {
        (Some(old), HunkStatus::Renamed) => format!("{old} → {}", hunk.file),
        _ => hunk.file.clone(),
    };
    let text_w = bw - header_chrome(&hunk);
    let last_old = raw.get("steps").and_then(Value::as_array).and_then(|s| {
        s.iter().rposition(|st| {
            st.get("lines").is_none_or(Value::is_null) && st.get("oldLines").is_some_and(|v| !v.is_null())
        })
    });
    let plain = input.props.highlight.plain.clone().unwrap_or_else(|| "#abb2bf".into());
    let tokens = input
        .props
        .highlight
        .hunks
        .get(&hunk.id)
        .cloned()
        .unwrap_or_else(|| hunk.lines.iter().map(|l| vec![(l.text.clone(), plain.clone())]).collect());
    let typing = (scene.typing && stepped).then(|| {
        let texts: Vec<String> = slots.iter().map(|sl| hunk.lines[sl.left.unwrap_or(0)].text.clone()).collect();
        typing_schedule(&texts, &slots, step_count, input.segments, input.duration)
    });
    let output = printing.then(|| {
        let mut o =
            layout_output(&scene.steps, scene.output_title.as_deref(), panel_w + OUTPUT_GAP, bw - panel_w - OUTPUT_GAP);
        o.starts = scene
            .steps
            .iter()
            .enumerate()
            .map(|(k, st)| {
                let Some(seg) = input.segments.get(k + 1) else { return f64::INFINITY };
                if let Some(c) = st.output_when.as_deref().and_then(|w| cue_frame(seg, w)) {
                    return c;
                }
                match &typing {
                    Some(t) => seg.from.max(t.ends[k] + 6.0),
                    None => seg.voice_from,
                }
            })
            .collect();
        o
    });
    let mut view = CodeView {
        typing,
        output,
        stops: Vec::new(),
        board: None,
        camera: None,
        marks: Vec::new(),
        first_row: Vec::new(),
        shell: Shell::new(raw),
        path: fit_text(&path_text, &Slot::named("codePath", text_w)),
        header: hunk
            .header
            .as_deref()
            .filter(|h| !h.is_empty())
            .map(|h| fit_text(h, &Slot::named("hunkHeader", text_w))),
        diagram_top: steps.as_ref().map_or(0.0, |s| ((panel_h - s.height - flow_block) / 2.0).max(0.0)) as f32,
        steps,
        tokens,
        view,
        slots,
        step_count,
        stepped,
        font: font as f32,
        row_h: js_round(font * 1.65) as f32,
        panel_w: panel_w as f32,
        panel_h: panel_h as f32,
        viewport_h: panel_h as f32 - PANEL_PAD * 2.0,
        callout,
        diagram_left: diagram_left as f32,
        diagram_w: diagram_w as f32,
        last_old,
        hunk,
    };
    view.plan(input);
    Ok(Box::new(view))
}

/// Advance of the mono font per em as the render browser draws it, for placing a token on its line (`MONO_DRAWN`).
const MONO_DRAWN: f64 = 0.602;

impl CodeView {
    /// Each row's height once the morph has played: a removed line of a morph collapses to nothing.
    fn final_heights(&self) -> Vec<f32> {
        self.slots
            .iter()
            .map(|s| {
                if self.view == View::Morph
                    && self.typing.is_none()
                    && self.hunk.lines[s.left.unwrap()].kind == LineType::Del
                {
                    0.0
                } else {
                    self.row_h
                }
            })
            .collect()
    }

    /// Row tops at the heights rows have while step k plays: removed lines stay until the steps leave them.
    fn row_tops(&self, k: usize) -> Vec<f32> {
        let mut top = 0.0;
        self.slots
            .iter()
            .map(|s| {
                let at = top;
                let line = &self.hunk.lines[s.left.or(s.right).unwrap()];
                top += if self.view == View::Morph && line.kind == LineType::Del && self.typing.is_none() {
                    if self.last_old.is_some_and(|lo| k <= lo) { self.row_h } else { 0.0 }
                } else {
                    self.row_h
                };
                at
            })
            .collect()
    }

    /// Lays out what does not change with the frame: scroll stops, the pen's boxes, the board and the camera.
    fn plan(&mut self, input: &SceneInput) {
        let n = self.step_count;
        let heights = self.final_heights();
        let mut spans = vec![(f32::INFINITY, f32::NEG_INFINITY); n];
        let mut y = 0.0;
        for (s, h) in self.slots.iter().zip(&heights) {
            if let Some(span) = s.step.and_then(|k| spans.get_mut(k)) {
                span.0 = span.0.min(y);
                span.1 = span.1.max(y + h);
            }
            y += h;
        }
        let max_scroll = (y - self.viewport_h).max(0.0);
        let mut stops: Vec<f32> = Vec::new();
        for s in &spans {
            let previous = stops.last().copied().unwrap_or(0.0);
            let target = if s.0.is_finite() {
                max_scroll.min(((s.0 + s.1) / 2.0 - self.viewport_h / 2.0).max(0.0))
            } else {
                previous
            };
            stops.push(previous.max(target));
        }
        self.stops = stops;
        self.first_row = (0..n).map(|k| self.slots.iter().position(|s| s.step == Some(k))).collect();
        let steps: Vec<Value> = input.scene.get("steps").and_then(Value::as_array).cloned().unwrap_or_default();
        if steps.is_empty() {
            return;
        }
        self.marks = (0..steps.len()).map(|k| self.code_targets(&steps, k)).collect();
        let findings = input.props.storyboard.findings.clone();
        let ink_of = |step: &Value| -> Option<InkOf> {
            let id = step.get("flag")?.as_str()?;
            let f = findings.as_ref()?.as_array()?.iter().find(|f| f.get("id").and_then(Value::as_str) == Some(id))?;
            let sev = f.get("severity")?.as_str()?;
            let color = match sev {
                "bug" => Color::css("#ff6b7a"),
                "risk" => Color::css("#ff9f43"),
                _ => Color::css("#8fa0ff"),
            };
            Some(InkOf { color, label: sev.to_string() })
        };
        let refs = StepRefs::Code(&self.hunk);
        let board = Board::new(input.scene, input.segments, &refs, &|k| self.marks.get(k).cloned().flatten(), &ink_of);
        let camera = Camera::new(input.scene, &refs, header_box(input.scene));
        self.board = (!board.is_empty()).then_some(board);
        self.camera = camera.moves().then_some(camera);
    }

    /// Where step k's lines and token sit once its camera move has settled (`codeTargets`).
    fn code_targets(&self, steps: &[Value], k: usize) -> Option<MarkTargets> {
        let step = steps.get(k)?;
        let (bw, bh) = content_box(false);
        let panel_top = HEADER_H as f64 + HEADER_GAP as f64;
        let viewport_top = panel_top + PANEL_PAD as f64;
        let font = self.font as f64;
        let row_h = self.row_h as f64;
        let advance = font * MONO_DRAWN;
        let inner = self.panel_w as f64 - 2.0;
        let half = (inner - 1.0) / 2.0;
        let gutter = morph_gutter_w(&self.hunk) as f64;
        let stop = self.stops.get(k).copied().unwrap_or(0.0) as f64;
        let tops = self.row_tops(k);
        let old_only =
            step.get("oldLines").is_some_and(|v| !v.is_null()) && step.get("lines").is_none_or(Value::is_null);
        // (hunk line, text box, x and y of its code)
        let mut text_boxes: Vec<(usize, Bx, f64, f64)> = Vec::new();
        for (r, slot) in self.slots.iter().enumerate() {
            let y = viewport_top + tops[r] as f64 - stop;
            let sides = if self.view == View::Morph {
                vec![slot.left]
            } else if old_only {
                vec![slot.left, slot.right]
            } else {
                vec![slot.right, slot.left]
            };
            let mut seen = Vec::new();
            for i in sides.into_iter().flatten() {
                if seen.contains(&i) {
                    continue;
                }
                seen.push(i);
                let x = if self.view == View::Morph {
                    1.0 + gutter
                } else if slot.right == Some(i) && slot.left != Some(i) {
                    1.0 + half + 1.0 + SPLIT_GUTTER_W as f64
                } else {
                    1.0 + SPLIT_GUTTER_W as f64
                };
                let w = 24f64.max(code_columns(&self.hunk.lines[i].text) as f64 * advance);
                text_boxes.push((i, Bx::new(x - 4.0, y + 2.0, w + 8.0, row_h - 4.0), x, y));
            }
        }
        let own: Vec<usize> =
            self.slots.iter().filter(|s| s.step == Some(k)).flat_map(|s| [s.left, s.right]).flatten().collect();
        let mut boxes = Vec::new();
        let lines: Vec<Bx> = text_boxes
            .iter()
            .filter(|t| own.contains(&t.0) && !self.hunk.lines[t.0].text.trim().is_empty())
            .map(|t| t.1)
            .collect();
        if let Some(u) = union(lines.iter().map(Some)) {
            boxes.push(("lines".to_string(), u));
        }
        let text_h = (font * 1.3).round();
        let cols = |t: &str, units: (usize, usize)| -> f64 {
            let u: Vec<u16> = t.encode_utf16().collect();
            code_columns(&String::from_utf16_lossy(&u[units.0.min(u.len())..units.1.min(u.len())])) as f64 * advance
        };
        if let Some(&(line, at)) = token_hits(&self.hunk, step).first()
            && let Some(tb) = text_boxes.iter().find(|t| t.0 == line)
        {
            let text = &self.hunk.lines[line].text;
            let token = step.get("token").and_then(Value::as_str).unwrap_or("");
            boxes.push((
                "token".to_string(),
                Bx::new(
                    tb.2 + cols(text, (0, at)),
                    tb.3 + (row_h - text_h) / 2.0,
                    code_columns(token) as f64 * advance,
                    text_h,
                ),
            ));
        }
        let mut obstacles: Vec<Bx> =
            text_boxes.iter().filter(|t| t.1.y + t.1.height > viewport_top && t.1.y < bh).map(|t| t.1).collect();
        obstacles.push(Bx::new(0.0, 0.0, bw, HEADER_H as f64));
        if let Some(c) = &self.callout {
            match c.at {
                CalloutAt::Beside => obstacles.push(Bx::new(
                    self.panel_w as f64 + CALLOUT_GAP as f64,
                    panel_top + ((self.panel_h - c.height) / 2.0).max(0.0) as f64,
                    CALLOUT_W as f64,
                    c.height as f64,
                )),
                CalloutAt::Below => {
                    obstacles.push(Bx::new(0.0, panel_top + self.panel_h as f64 + 28.0, bw, CALLOUT_BELOW_H as f64))
                }
                CalloutAt::Flow => {}
            }
        }
        if let Some(st) = &self.steps {
            let block =
                self.callout.as_ref().filter(|c| c.at == CalloutAt::Flow).map_or(0.0, |c| c.height + FLOW_CALLOUT_GAP);
            obstacles.push(Bx::new(
                self.diagram_left as f64,
                panel_top + self.diagram_top as f64,
                self.diagram_w as f64,
                st.height + block as f64,
            ));
        }
        let rows: Vec<(usize, f64, f64)> = text_boxes.iter().map(|t| (t.0, t.2, t.3)).collect();
        let lines_text: Vec<String> = self.hunk.lines.iter().map(|l| l.text.clone()).collect();
        let row_box: Vec<(usize, Bx)> = text_boxes.iter().map(|t| (t.0, t.1)).collect();
        let box_of: BoxOf = Arc::new(move |key: &str| {
            let parts: Vec<&str> = key.split(':').collect();
            let line: usize = parts.get(1)?.parse().ok()?;
            let (_, x, y) = *rows.iter().find(|r| r.0 == line)?;
            match parts[0] {
                "ln" => row_box.iter().find(|r| r.0 == line).map(|r| r.1),
                "tx" => {
                    let from: usize = parts.get(2)?.parse().ok()?;
                    let len: usize = parts.get(3)?.parse().ok()?;
                    let u: Vec<u16> = lines_text[line].encode_utf16().collect();
                    let c = |a: usize, b: usize| {
                        code_columns(&String::from_utf16_lossy(&u[a.min(u.len())..b.min(u.len())])) as f64 * advance
                    };
                    Some(Bx::new(x + c(0, from), y + (row_h - text_h) / 2.0, c(from, from + len), text_h))
                }
                _ => None,
            }
        });
        Some(MarkTargets {
            boxes,
            obstacles: Some(obstacles),
            lines: Vec::new(),
            area: Bx::new(0.0, 0.0, bw, bh),
            box_of: Some(box_of),
            clip: Some(Bx::new(0.0, viewport_top, bw, self.viewport_h as f64)),
            shifts: true,
        })
    }
}

fn morph_timeline(h: &Hunk, span: f64, drawn_by: f64) -> Morph {
    let pure_add = h.deletions == 0;
    let pure_del = h.additions == 0;
    let adds = h.additions as f64;
    let flash_start = js_round(span * if pure_del { 0.35 } else { 0.2 });
    let collapse_start = js_round(span * if pure_del { 0.5 } else { 0.28 });
    let collapse_end = js_round(span * if pure_del { 0.62 } else { 0.38 });
    let grow_start = if pure_add {
        10.0
    } else if pure_del {
        collapse_end
    } else {
        js_round(span * 0.36)
    };
    let stagger = if pure_add {
        3f64.min(0.5f64.max((drawn_by - grow_start - 10.0) / adds.max(1.0)))
    } else {
        3f64.min((span * 0.2) / adds.max(1.0))
    };
    Morph {
        flash_start,
        collapse_start,
        collapse_end,
        grow_start,
        stagger,
        grow_end: grow_start + stagger * adds + 10.0,
    }
}

impl CodeView {
    fn stepped_morph(&self, f: &Frame, intro_end: f64, legacy: Morph) -> Morph {
        let Some(last_old) = self.last_old else { return legacy };
        let segs = f.segments;
        let collapse_start = match segs.get(last_old + 2) {
            Some(next) => next.from,
            None => intro_end.max(segs.get(last_old + 1).map_or(intro_end, |s| s.from + s.duration) - 20.0),
        };
        let adds = self.hunk.additions as f64;
        let stagger = 3f64.min(1f64.max((intro_end * 0.3) / adds.max(1.0)));
        let grow_len = stagger * adds + 10.0;
        let grow_start = 10f64.max(intro_end - grow_len);
        Morph {
            flash_start: (collapse_start - 18.0).max(0.0),
            collapse_start,
            collapse_end: collapse_start + 10.0,
            grow_start,
            stagger,
            grow_end: grow_start + grow_len,
        }
    }

    /// Draws a line's code from its tokens with tabs expanded, starting at x on the baseline.
    fn code(&self, dl: &mut DisplayList, i: usize, x: f32, base: f32) {
        let st = Style::mono(400.0, self.font);
        let mut pen = x;
        let mut col = 0;
        for (text, color) in self.tokens.get(i).map_or(&[][..], |t| &t[..]) {
            let mut shown = String::new();
            for ch in text.chars() {
                if ch == '\t' {
                    let n = CODE_TAB_SIZE - (col % CODE_TAB_SIZE);
                    shown.push_str(&" ".repeat(n));
                    col += n;
                } else {
                    shown.push(ch);
                    col += 1;
                }
            }
            if !shown.is_empty() {
                pen += dl.text(&shown, st, pen, base, Color::css(color));
            }
        }
    }

    /// The line number column(s) and the change sign, from x; returns where the code starts.
    fn gutter(&self, dl: &mut DisplayList, i: usize, numbers: &[Option<i64>], x: f32, row_h: f32) -> f32 {
        let line = &self.hunk.lines[i];
        let w = if numbers.len() > 1 { MORPH_NUMBER_W } else { SPLIT_NUMBER_W };
        let small = js_round(self.font as f64 * 0.85) as f32;
        let st = Style::mono(400.0, small);
        let mut pen = x;
        for n in numbers {
            if let Some(n) = n {
                let t = n.to_string();
                let tw = width(&t, st);
                dl.text(&t, st, pen + w - 14.0 - tw, center_base(Face::Mono, small, row_h), FAINT);
            }
            pen += w;
        }
        let (sign, color) = match line.kind {
            LineType::Add => ("+", ADD),
            LineType::Del => ("−", DEL),
            LineType::Context => (" ", FAINT),
        };
        dl.text(sign, Style::mono(700.0, self.font), pen, center_base(Face::Mono, self.font, row_h), color);
        pen + SIGN_W
    }

    fn numbers(&self, i: usize) -> Vec<Option<i64>> {
        let l = &self.hunk.lines[i];
        if self.hunk.status == HunkStatus::Source { vec![l.new_line] } else { vec![l.old_line, l.new_line] }
    }

    fn callout_card(&self, dl: &mut DisplayList, c: &Callout, x: f32, y: f32, w: f32, appear: f64) {
        let h = fit_height(&c.text, LineHeight::Fit) + 44.0 + 2.0;
        let a = appear as f32;
        dl.group(|dl| {
            dl.fade(a);
            dl.translate((1.0 - a) * 30.0, 0.0);
            dl.scale_about(0.94 + 0.06 * a, x + w / 2.0, y + h / 2.0);
            dl.rect(
                x,
                y,
                w,
                h,
                BoxStyle::fill(Paint::vertical(y, y + h, Color::css("#1d2136"), Color::css("#161a2a")))
                    .radius(18.0)
                    .border(ACCENT.fade(0x88 as f32 / 255.0), 1.0)
                    .shadow(Shadow::new(0.0, 18.0, 48.0, Color::rgba8(0, 0, 0, 0.5)))
                    .shadow(Shadow::new(0.0, 0.0, 32.0, ACCENT_SOFT)),
            );
            draw_fit(dl, &c.text, x + 27.0, y + 23.0, TextOpts::new(TEXT));
        });
    }

    fn file_header(&self, dl: &mut DisplayList, w: f32) {
        let h = &self.hunk;
        let color = status_color(h.status);
        let label = status_label(h.status).to_uppercase();
        let st = Style::sans(700.0, 20.0).spacing(1.5);
        let line = line_metrics(Face::Sans, 20.0).normal;
        let (pw, ph) = (width(&label, st) + 34.0, line + 18.0);
        let mid = HEADER_H / 2.0;
        dl.rect(
            0.0,
            mid - ph / 2.0,
            pw,
            ph,
            BoxStyle::fill(color.fade(0x1f as f32 / 255.0)).radius(10.0).border(color.fade(0x55 as f32 / 255.0), 1.0),
        );
        dl.text(&label, st, 17.0, center_base(Face::Sans, 20.0, HEADER_H), color);
        // Path and hunk header, centred as a column.
        let path_h = fit_height(&self.path, LineHeight::Normal);
        let head_h = self.header.as_ref().map_or(0.0, |f| 6.0 + fit_height(f, LineHeight::Normal));
        let top = mid - (path_h + head_h) / 2.0;
        draw_fit(dl, &self.path, pw + 22.0, top, TextOpts::new(TEXT).normal());
        if let Some(f) = &self.header {
            draw_fit(dl, f, pw + 22.0, top + path_h + 6.0, TextOpts::new(FAINT).normal());
        }
        // Counts and range at the right.
        let mono = Style::mono(600.0, 24.0);
        let base = center_base(Face::Mono, 24.0, HEADER_H);
        let mut parts: Vec<(String, Color, f32)> = Vec::new();
        if h.status != HunkStatus::Source {
            parts.push((format!("+{}", h.additions), ADD, 0.0));
            parts.push((format!("−{}", h.deletions), DEL, 14.0));
        }
        parts.push((range_text(h), FAINT, if parts.is_empty() { 0.0 } else { 14.0 + 8.0 }));
        let total: f32 = parts.iter().map(|(t, _, gap)| width(t, mono) + gap).sum();
        let mut x = w - total;
        for (t, c, gap) in parts {
            x += gap;
            x += dl.text(&t, mono, x, base, c);
        }
    }
}

/// The baseline of a line of `face` at `size` centred in a box `h` tall, as flex centring places it.
fn center_base(face: Face, size: f32, h: f32) -> f32 {
    let m = line_metrics(face, size);
    (h - m.normal) / 2.0 + m.ascent
}

struct Row {
    slot: usize,
    /// Added rows shown above this one.
    add_index: usize,
    height: f32,
    final_height: f32,
}

impl SceneView for CodeView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let (row_h, font) = (self.row_h, self.font);
        let intro_frames = if self.stepped { f.segments.get(1).map_or(f.duration, |s| s.from) } else { f.duration };
        let paced = morph_timeline(&self.hunk, intro_frames, f.segments.first().map_or(0.0, |s| s.voice_from));
        let morph = if self.stepped { self.stepped_morph(f, intro_frames, paced) } else { paced };
        let morph_end = if self.view == View::Morph { paced.grow_end } else { 0.0 };
        let intro_end =
            if self.stepped { intro_frames } else { js_round(f.duration * 0.15).max(morph_end.min(f.duration * 0.5)) };
        let steps_end = intro_end.max(js_round(f.duration * 0.9));
        let n = self.step_count;
        let starts: Vec<f64> = (0..n)
            .map(|k| {
                if self.stepped {
                    f.segments.get(k + 1).map_or(intro_end, |s| s.from)
                } else {
                    intro_end + (k as f64 * (steps_end - intro_end)) / n as f64
                }
            })
            .collect();
        let reached = |k: usize| if k < n { clamped(frame, starts[k], starts[k] + STEP_FADE, 0.0, 1.0) } else { 0.0 };
        let dim = reached(0);

        // Row heights this frame, and once the morph has played.
        let mut add_index = 0;
        let rows: Vec<Row> = self
            .slots
            .iter()
            .enumerate()
            .map(|(r, s)| {
                if self.view == View::Split || self.typing.is_some() {
                    return Row { slot: r, add_index: 0, height: row_h, final_height: row_h };
                }
                let line = &self.hunk.lines[s.left.unwrap()];
                match line.kind {
                    LineType::Del => {
                        let c = clamped(frame, morph.collapse_start, morph.collapse_end, 0.0, 1.0) as f32;
                        Row { slot: r, add_index, height: row_h * (1.0 - c), final_height: 0.0 }
                    }
                    LineType::Add => {
                        let start = morph.grow_start + add_index as f64 * morph.stagger;
                        add_index += 1;
                        let g = clamped(frame, start, start + 10.0, 0.0, 1.0) as f32;
                        Row { slot: r, add_index: add_index - 1, height: row_h * g, final_height: row_h }
                    }
                    LineType::Context => Row { slot: r, add_index, height: row_h, final_height: row_h },
                }
            })
            .collect();

        let mut y = 0.0f32;
        let mut final_y = 0.0f32;
        let mut spans = vec![(f32::INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::NEG_INFINITY); n];
        let mut tops = Vec::with_capacity(rows.len());
        for row in &rows {
            if let Some(span) = self.slots[row.slot].step.and_then(|k| spans.get_mut(k)) {
                span.0 = span.0.min(y);
                span.1 = span.1.max(y + row.height);
                span.2 = span.2.min(final_y);
                span.3 = span.3.max(final_y + row.final_height);
            }
            tops.push(y);
            y += row.height;
            final_y += row.final_height;
        }
        let content_h = y;
        let vh = self.viewport_h;
        let max_scroll = (final_y - vh).max(0.0);
        let mut stops: Vec<f32> = Vec::new();
        for s in &spans {
            let previous = stops.last().copied().unwrap_or(0.0);
            let target =
                if s.2.is_finite() { max_scroll.min(((s.2 + s.3) / 2.0 - vh / 2.0).max(0.0)) } else { previous };
            stops.push(previous.max(target));
        }
        let scroll = stops.iter().enumerate().fold(0.0f32, |acc, (k, &stop)| {
            if k == 0 { stop } else { acc + (stop - stops[k - 1]) * step_move(frame, starts[k]) as f32 }
        });
        let anchor_y = |s: (f32, f32)| {
            PANEL_PAD + vh.min(((if s.0.is_finite() { (s.0 + s.1) / 2.0 } else { 0.0 }) - scroll).max(0.0))
        };
        let last = spans.last().filter(|s| s.0.is_finite()).map_or((0.0, content_h), |s| (s.0, s.1));
        let last_center = (last.0 + last.1) / 2.0;
        let callout_appear = spring(
            frame - starts.last().copied().unwrap_or(intro_end) - 6.0,
            FPS,
            Spring::damping(16.0).with_stiffness(120.0),
        );
        let focus_y = anchor_y(last);
        let callout_h = self.callout.as_ref().filter(|c| c.at == CalloutAt::Beside).map_or(0.0, |c| c.height);
        let callout_top = (self.panel_h - callout_h).min((focus_y - callout_h / 2.0).max(0.0));

        let view =
            self.camera.as_ref().and_then(|c| c.view(frame, f.segments, &|k| self.marks.get(k).cloned().flatten()));
        let cursor = self.typing.as_ref().and_then(|t| t.cursor(frame));
        // How far step k's rows have yet to move to where they settle: the scroll and the collapsing lines catching up.
        let shift = |k: usize| -> Option<Pt> {
            let first = (*self.first_row.get(k)?)?;
            let settled = self.row_tops(k)[first] - self.stops.get(k).copied().unwrap_or(0.0);
            let live = tops[first] - scroll;
            Some(Pt { x: 0.0, y: (live - settled) as f64 })
        };
        self.shell.draw(dl, frame, f.duration, None, |dl, bx| {
            let body = |dl: &mut DisplayList| {
                dl.group(|dl| {
                    self.file_header(dl, bx.w);
                    dl.translate(0.0, HEADER_H + HEADER_GAP);
                    let (pw, ph) = (self.panel_w, self.panel_h);
                    dl.rect(
                        0.0,
                        0.0,
                        pw,
                        ph,
                        BoxStyle::fill(SURFACE).radius(20.0).border(BORDER, 1.0).shadow(Shadow::new(
                            0.0,
                            30.0,
                            80.0,
                            Color::rgba8(0, 0, 0, 0.45),
                        )),
                    );
                    dl.push_clip(1.0, 1.0, pw - 2.0, ph - 2.0, 19.0);
                    if self.hunk.additions == 0 && content_h < row_h {
                        let k = interpolate(content_h as f64, &[0.0, row_h as f64], &[1.0, 0.0], CLAMP) as f32;
                        let text = format!(
                            "{} {} removed",
                            self.hunk.deletions,
                            if self.hunk.deletions == 1 { "line" } else { "lines" }
                        );
                        let st = Style::sans(600.0, 30.0);
                        let tw = width(&text, st);
                        let x0 = (pw - (34.0 + 18.0 + tw)) / 2.0;
                        dl.group(|dl| {
                            dl.fade(k);
                            icons::draw(dl, "Trash2", x0, ph / 2.0 - 17.0, 34.0, DEL, 2.0);
                            dl.text(&text, st, x0 + 52.0, center_base(Face::Sans, 30.0, ph), MUTED);
                        });
                    }
                    let inner = pw - 2.0;
                    dl.push_clip(1.0, 1.0 + PANEL_PAD, inner, vh, 0.0);
                    for (row, &top) in rows.iter().zip(&tops) {
                        let s = &self.slots[row.slot];
                        let ry = 1.0 + PANEL_PAD + top - scroll;
                        if row.height <= 0.0 || ry > 1.0 + PANEL_PAD + vh || ry + row.height < 1.0 + PANEL_PAD {
                            continue;
                        }
                        // A line a typing step has not reached yet draws nothing, not even its step's light.
                        let typed = self.typing.as_ref().and_then(|t| t.lines[row.slot]);
                        if typed.is_some_and(|(from, _, _)| frame < from) {
                            continue;
                        }
                        let now = s.step.map_or(0.0, reached);
                        let passed = s.step.map_or(0.0, |k| reached(k + 1));
                        let opacity = 1.0 - (1.0 - DIM_OPACITY) * (dim - now) - (1.0 - VISITED_OPACITY) * passed;
                        let bar = now - 0.7 * passed;
                        let glow = now - passed;
                        dl.group(|dl| {
                            dl.translate(1.0, ry);
                            dl.push_clip(0.0, 0.0, inner, row.height, 0.0);
                            dl.fade(opacity as f32);
                            if glow > 0.0 {
                                dl.fill_rect(
                                    0.0,
                                    0.0,
                                    inner,
                                    row.height,
                                    Color::rgba8(124, 140, 255, 0.08 * glow as f32),
                                );
                            }
                            if bar > 0.0 {
                                dl.fill_rect(0.0, 0.0, 5.0, row.height, ACCENT.fade(bar as f32));
                            }
                            match self.view {
                                View::Morph if self.typing.is_some() => {
                                    let i = s.left.unwrap();
                                    dl.fill_rect(0.0, 0.0, inner, row_h, line_bg(self.hunk.lines[i].kind));
                                    let numbers = self.numbers(i);
                                    let x = self.gutter(dl, i, &numbers, 0.0, row_h);
                                    let base = center_base(Face::Mono, font, row_h);
                                    match typed {
                                        Some(t) => {
                                            let c = cursor.filter(|c| c.0 == row.slot).map(|c| c.1);
                                            self.typed_code(dl, i, x, base, frame, t, c);
                                        }
                                        None => self.code(dl, i, x, base),
                                    }
                                }
                                View::Morph => self.morph_row(dl, s.left.unwrap(), row.add_index, frame, &morph, inner),
                                View::Split => {
                                    let half = (inner - 1.0) / 2.0;
                                    for (side, i) in [(0, s.left), (1, s.right)] {
                                        let x = if side == 0 { 0.0 } else { half + 1.0 };
                                        if side == 1 {
                                            dl.fill_rect(half, 0.0, 1.0, row_h, BORDER);
                                        }
                                        match i {
                                            None => {
                                                dl.fill_rect(x, 0.0, half, row_h, Color::rgba8(255, 255, 255, 0.025))
                                            }
                                            Some(i) => {
                                                let line = &self.hunk.lines[i];
                                                dl.fill_rect(x, 0.0, half, row_h, line_bg(line.kind));
                                                let n = if side == 0 { line.old_line } else { line.new_line };
                                                let cx = self.gutter(dl, i, &[n], x, row_h);
                                                self.code(dl, i, cx, center_base(Face::Mono, font, row_h));
                                            }
                                        }
                                    }
                                }
                            }
                            dl.pop_clip();
                        });
                    }
                    dl.pop_clip();
                    dl.pop_clip();

                    if let Some(o) = &self.output {
                        self.output_pane(dl, o, ph, frame, crate::steps::current_step(f.segments, frame));
                    }
                    if let Some(steps) = &self.steps {
                        let code_y: Vec<f32> = spans.iter().map(|s| anchor_y((s.0, s.1))).collect();
                        self.step_diagram(dl, steps, frame, &reached, &code_y);
                    }
                    if let Some(c) = &self.callout {
                        match c.at {
                            CalloutAt::Flow => {
                                if let Some(steps) = &self.steps {
                                    let top = self.diagram_top + steps.height as f32;
                                    dl.group(|dl| {
                                        dl.fade(callout_appear as f32);
                                        dl.fill_rect(
                                            self.diagram_left + self.diagram_w / 2.0 - 1.5,
                                            top,
                                            3.0,
                                            FLOW_CALLOUT_GAP,
                                            ACCENT,
                                        );
                                    });
                                    self.callout_card(
                                        dl,
                                        c,
                                        self.diagram_left,
                                        top + FLOW_CALLOUT_GAP,
                                        self.diagram_w,
                                        callout_appear,
                                    );
                                }
                            }
                            CalloutAt::Beside => {
                                let mut pb = PathBuilder::new();
                                let x0 = pw - 4.0;
                                let x1 = pw + CALLOUT_GAP;
                                let cy = callout_top + callout_h / 2.0;
                                pb.move_to(x0, focus_y);
                                pb.cubic_to(pw + CALLOUT_GAP / 2.0, focus_y, pw + CALLOUT_GAP / 2.0, cy, x1, cy);
                                dl.group(|dl| {
                                    dl.fade(callout_appear as f32);
                                    if let Some(p) = pb.finish() {
                                        dl.path(p, None, Some(Stroke::solid(ACCENT, 3.0)));
                                    }
                                    dl.circle(x0, focus_y, 7.0, ACCENT);
                                });
                                self.callout_card(dl, c, x1, callout_top, CALLOUT_W, callout_appear);
                            }
                            CalloutAt::Below => {
                                if n > 0 {
                                    let top = focus_y + (last.1 - last_center);
                                    dl.group(|dl| {
                                        dl.fade(callout_appear as f32);
                                        dl.fill_rect(10.0, top, 3.0, (ph + 28.0 - top).max(0.0), ACCENT);
                                    });
                                }
                                self.callout_card(dl, c, 0.0, ph + 28.0, bx.w, callout_appear);
                            }
                        }
                    }
                });
                if let Some(b) = &self.board {
                    b.draw(dl, frame, f.segments, &shift);
                }
            };
            match &self.camera {
                Some(c) => c.draw(dl, view, body),
                None => body(dl),
            }
        });
    }
}

const BLINK: f64 = 16.0;
const OUTPUT_BODY: Color = Color::rgba8(0x0b, 0x0d, 0x13, 1.0);
const OUTPUT_TEXT: Color = Color::rgba8(0xc3, 0xc8, 0xd4, 1.0);

impl CodeView {
    /// A typed line (`TypedCode`): its indent and the characters typed so far, with the cursor after them while it
    /// types, blinking there once its step's typing is done.
    #[allow(clippy::too_many_arguments)]
    fn typed_code(
        &self,
        dl: &mut DisplayList,
        i: usize,
        x: f32,
        base: f32,
        frame: f64,
        line: (f64, usize, f64),
        cursor: Option<bool>,
    ) {
        let (from, chars, per) = line;
        let typed = chars.min(((frame - from) * per).floor().max(-1.0) as usize + 1);
        let mut left = indent_of(&self.hunk.lines[i].text) + typed;
        let st = Style::mono(400.0, self.font);
        let mut pen = x;
        let mut col = 0;
        for (text, color) in self.tokens.get(i).map_or(&[][..], |t| &t[..]) {
            if left == 0 {
                break;
            }
            let part: String = text.chars().take(left).collect();
            left -= part.chars().count();
            let mut shown = String::new();
            for ch in part.chars() {
                if ch == '\t' {
                    let n = CODE_TAB_SIZE - (col % CODE_TAB_SIZE);
                    shown.push_str(&" ".repeat(n));
                    col += n;
                } else {
                    shown.push(ch);
                    col += 1;
                }
            }
            pen += dl.text(&shown, st, pen, base, Color::css(color));
        }
        if let Some(typing) = cursor {
            let on = typing || (frame / BLINK).floor() as i64 % 2 == 0;
            if on {
                let m = line_metrics(Face::Mono, self.font);
                let h = self.font * 1.25;
                dl.fill_rect(pen + 1.0, base + m.descent - h, (self.font * 0.12).max(3.0), h, ACCENT);
            }
        }
    }

    /// The terminal-like pane each step's output prints into, a line every few frames, scrolling to keep the newest
    /// in view (`OutputPane`).
    fn output_pane(&self, dl: &mut DisplayList, o: &OutputPane, height: f32, frame: f64, current: Option<usize>) {
        let view_h = height - OUTPUT_CHROME_H;
        let mut first: HashMap<usize, usize> = HashMap::new();
        for (i, l) in o.lines.iter().enumerate() {
            first.entry(l.0).or_insert(i);
        }
        let appear_of: Vec<f64> = o
            .lines
            .iter()
            .enumerate()
            .map(|(i, l)| {
                let at = o.starts[l.0] + (i - first[&l.0]) as f64 * OUTPUT_LINE_GAP;
                clamped(frame, at, at + 3.0, 0.0, 1.0)
            })
            .collect();
        let scroll = o
            .lines
            .iter()
            .zip(&appear_of)
            .map(|(l, a)| (l.2 + l.3 + OUTPUT_PAD.1 - view_h).max(0.0) * (a * 2.0).min(1.0) as f32)
            .fold(0.0, f32::max);
        let appear = clamped(frame, 2.0, 14.0, 0.0, 1.0) as f32;
        let (x, w) = (o.x, o.width);
        dl.group(|dl| {
            dl.fade(appear);
            dl.rect(
                x,
                0.0,
                w,
                height,
                BoxStyle::fill(OUTPUT_BODY)
                    .radius(16.0)
                    .shadow(Shadow { dx: 0.0, dy: 0.0, blur: 0.0, spread: 1.5, color: BORDER_STRONG })
                    .shadow(Shadow::new(0.0, 24.0, 70.0, Color::rgba8(0, 0, 0, 0.55))),
            );
            dl.push_clip(x, 0.0, w, height, 16.0);
            dl.fill_rect(x, 0.0, w, OUTPUT_CHROME_H, Color::css("#171a23"));
            dl.fill_rect(x, OUTPUT_CHROME_H - 1.0, w, 1.0, BORDER);
            for (j, c) in ["#ff5f57", "#febc2e", "#28c840"].iter().enumerate() {
                dl.rect(
                    x + 20.0 + j as f32 * 21.0,
                    OUTPUT_CHROME_H / 2.0 - 6.0,
                    12.0,
                    12.0,
                    BoxStyle::fill(Color::css(c).fade(0.85)).radius(6.0),
                );
            }
            let th = fit_height(&o.title, LineHeight::Fit);
            draw_fit(dl, &o.title, x, (OUTPUT_CHROME_H - th) / 2.0, TextOpts::new(MUTED).centered(w));
            dl.push_clip(x, OUTPUT_CHROME_H, w, view_h, 0.0);
            for ((step, fit, y, _), a) in o.lines.iter().zip(&appear_of) {
                if *a <= 0.0 {
                    continue;
                }
                dl.group(|dl| {
                    dl.fade((*a * if Some(*step) == current { 1.0 } else { 0.62 }) as f32);
                    draw_fit(dl, fit, x + OUTPUT_PAD.0, OUTPUT_CHROME_H + y - scroll, TextOpts::new(OUTPUT_TEXT));
                });
            }
            dl.pop_clip();
            dl.pop_clip();
        });
    }
}

fn line_bg(kind: LineType) -> Color {
    match kind {
        LineType::Add => ADD_BG,
        LineType::Del => DEL_BG,
        LineType::Context => Color::TRANSPARENT,
    }
}

impl CodeView {
    /// Draws hunk line `i` as a morph row; `add_index` counts the added rows shown above it, which stagger in.
    fn morph_row(&self, dl: &mut DisplayList, i: usize, add_index: usize, frame: f64, t: &Morph, inner: f32) {
        let line = &self.hunk.lines[i];
        let row_h = self.row_h;
        let mut opacity = 1.0f32;
        let mut bg = Color::TRANSPARENT;
        let mut strike = 0.0f32;
        match line.kind {
            LineType::Del => {
                let collapse = clamped(frame, t.collapse_start, t.collapse_end, 0.0, 1.0) as f32;
                let flash = interpolate(
                    frame,
                    &[t.flash_start, t.flash_start + 6.0, t.collapse_start],
                    &[0.1, 0.32, 0.2],
                    CLAMP,
                );
                opacity = 1.0 - collapse;
                bg = Color::rgba8(255, 107, 122, flash as f32);
                strike = clamped(frame, t.flash_start, t.collapse_start, 0.0, 1.0) as f32;
            }
            LineType::Add => {
                let start = t.grow_start + add_index as f64 * t.stagger;
                let grow = clamped(frame, start, start + 10.0, 0.0, 1.0) as f32;
                let glow = interpolate(frame, &[start, start + 10.0, start + 30.0], &[0.35, 0.3, 0.12], CLAMP);
                opacity = grow;
                bg = Color::rgba8(61, 220, 151, glow as f32);
            }
            LineType::Context => {}
        }
        dl.group(|dl| {
            dl.fade(opacity);
            dl.fill_rect(0.0, 0.0, inner, row_h, bg);
            let numbers = self.numbers(i);
            let x = self.gutter(dl, i, &numbers, 0.0, row_h);
            self.code(dl, i, x, center_base(Face::Mono, self.font, row_h));
            if strike > 0.0 {
                let ch = width("0", Style::mono(400.0, self.font));
                let w = ((code_columns(&line.text) + 2) as f32 * strike * ch).min(inner - MORPH_GUTTER_W - 18.0);
                dl.fill_rect(MORPH_GUTTER_W, row_h / 2.0 - 1.0, w, 2.0, DEL);
            }
        });
    }

    fn step_diagram(
        &self,
        dl: &mut DisplayList,
        l: &StepLayout,
        frame: f64,
        reached: &dyn Fn(usize) -> f64,
        code_y: &[f32],
    ) {
        let (left, top, w) = (self.diagram_left, self.diagram_top, self.diagram_w);
        let small = js_round(l.font * 0.8) as f32;
        let arrow_x = left + NODE_PAD_X as f32 + BADGE as f32 / 2.0;
        let appear = |k: usize| spring(frame - 6.0 - k as f64 * 4.0, FPS, Spring::damping(18.0)) as f32;
        let line = |dl: &mut DisplayList, x: f32, y0: f32, y1: f32, s: Stroke| {
            let mut pb = PathBuilder::new();
            pb.move_to(x, y0);
            pb.line_to(x, y1);
            if let Some(p) = pb.finish() {
                dl.path(p, None, Some(s));
            }
        };
        for i in 0..l.nodes.len().saturating_sub(1) {
            let (a, b) = (&l.nodes[i], &l.nodes[i + 1]);
            let from = top + (a.top + a.height) as f32;
            let to = top + b.top as f32;
            let drawn = reached(i + 1) as f32;
            let tip = from + (to - from - 2.0) * drawn;
            dl.group(|dl| {
                dl.fade(appear(i + 1));
                line(dl, arrow_x, from, to - 2.0, Stroke::dashed(BORDER_STRONG, 2.0, 5.0, 6.0));
                if drawn > 0.0 {
                    dl.group(|dl| {
                        dl.fade(0.5 + 0.5 * drawn);
                        line(dl, arrow_x, from, tip - 6.0, Stroke::solid(ACCENT, 3.0));
                    });
                    let mut pb = PathBuilder::new();
                    pb.move_to(arrow_x - 7.0, tip - 9.0);
                    pb.line_to(arrow_x, tip);
                    pb.line_to(arrow_x + 7.0, tip - 9.0);
                    if let Some(p) = pb.finish() {
                        let mut s = Stroke::solid(ACCENT, 3.0);
                        s.round = true;
                        dl.path(p, None, Some(s));
                    }
                }
            });
        }
        for (k, node) in l.nodes.iter().enumerate() {
            let strength = (reached(k) - reached(k + 1)) as f32;
            if strength <= 0.0 {
                continue;
            }
            let y1 = code_y.get(k).copied().unwrap_or(0.0);
            let y2 = top + (node.top + node.height / 2.0) as f32;
            let mid = (self.panel_w + left) / 2.0;
            let mut pb = PathBuilder::new();
            pb.move_to(self.panel_w, y1);
            pb.cubic_to(mid, y1, mid, y2, left - 4.0, y2);
            dl.group(|dl| {
                dl.fade(strength);
                if let Some(p) = pb.finish() {
                    dl.path(p, None, Some(Stroke::solid(ACCENT, 3.0)));
                }
                dl.circle(self.panel_w, y1, 7.0, ACCENT);
            });
        }
        for (k, node) in l.nodes.iter().enumerate() {
            let now = reached(k);
            let passed = reached(k + 1);
            let active = now - passed;
            let state = if active >= 0.5 {
                2
            } else if passed >= 0.5 {
                1
            } else {
                0
            };
            let (y, h) = (top + node.top as f32, node.height as f32);
            dl.group(|dl| {
                dl.fade(appear(k) * (0.38 + 0.62 * now - 0.28 * passed) as f32);
                dl.scale_about(0.96 + 0.04 * now as f32, left, y + h / 2.0);
                let border_c = match state {
                    2 => ACCENT,
                    1 => Color::rgba8(124, 140, 255, 0.4),
                    _ => BORDER_STRONG,
                };
                let fill: Paint = if state == 2 {
                    Paint::vertical(y, y + h, Color::css("#1d2136"), Color::css("#161a2a"))
                } else {
                    RAISED.into()
                };
                let mut b = BoxStyle::fill(fill).radius(16.0);
                b = if now >= 0.5 {
                    b.border(border_c, 2.0)
                } else {
                    b.border_stroke(Stroke::dashed(border_c, 2.0, 6.0, 6.0))
                };
                if active > 0.0 {
                    b = b.shadow(Shadow::new(
                        0.0,
                        0.0,
                        36.0 * active as f32,
                        Color::rgba8(124, 140, 255, 0.45 * active as f32),
                    ));
                }
                dl.rect(left, y, w, h, b);
                // Badge.
                let bx = left + 2.0 + NODE_PAD_X as f32;
                let by = y + 2.0 + NODE_PAD_Y as f32;
                let (bfill, bcolor) = match state {
                    2 => (ACCENT, Color::css("#0b0d18")),
                    1 => (Color::css("#1d2140"), ACCENT),
                    _ => (Color::TRANSPARENT, FAINT),
                };
                dl.rect(
                    bx,
                    by,
                    40.0,
                    40.0,
                    BoxStyle::fill(bfill).radius(20.0).border(if state == 0 { BORDER_STRONG } else { ACCENT }, 2.0),
                );
                if state == 1 {
                    icons::draw(dl, "Check", bx + 9.0, by + 9.0, 22.0, bcolor, 3.0);
                } else {
                    let t = (k + 1).to_string();
                    let st = Style::sans(700.0, 20.0);
                    let tw = width(&t, st);
                    dl.text(&t, st, bx + 20.0 - tw / 2.0, by + center_base(Face::Sans, 20.0, 40.0), bcolor);
                }
                // Label and outcome, centred.
                let tx = bx + 40.0 + BADGE_GAP as f32;
                let label_h = node.label.height as f32;
                let out_h =
                    node.outcome.as_ref().map_or(0.0, |o| OUTCOME_GAP as f32 + (o.height as f32).max(small * 1.15));
                let inner_h = h - 4.0 - 2.0 * NODE_PAD_Y as f32;
                let ty = by + ((inner_h - label_h - out_h) / 2.0).max(0.0);
                draw_fit(dl, &node.label, tx, ty, TextOpts::new(TEXT).weight(if state == 2 { 650.0 } else { 550.0 }));
                if let Some(o) = &node.outcome {
                    let oy = ty + label_h + OUTCOME_GAP as f32;
                    let c = if state == 2 { Color::css("#c3c9ff") } else { MUTED };
                    icons::draw(dl, "CornerDownRight", tx, oy + small * 0.15, small, c, 2.0);
                    draw_fit(dl, o, tx + small + 8.0, oy, TextOpts::new(c));
                }
            });
        }
    }
}
