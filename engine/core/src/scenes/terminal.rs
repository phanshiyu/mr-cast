//! The terminal scene: a shell window where commands type out and their output prints, scrolling to follow the
//! steps. A port of src/components/Terminal.tsx, src/utils/terminalLayout.ts, src/utils/terminalCamera.ts and
//! shared/terminal.mjs.
//!
//! Not ported yet: pen marks and the generic `camera` field.

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, interpolate};
use crate::chrome::fittext::{TextOpts, draw_fit, drawn_width};
use crate::chrome::shell::Shell;
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint, Shadow};
use crate::steps::{Emphasis, Spotlight, step_move};
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::{Family, Fit, Font, Slot, fit_text, measure};
use crate::theme::{ACCENT, ACCENT_GLOW, ADD, ADD_BG, BORDER, BORDER_STRONG, DEL, DEL_BG, MUTED, TEXT, content_box};
use crate::timing::{FPS, STEP_SETTLE_FRAMES, Segment, build_frames, index_range, js_round};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

const WINDOW_START: f64 = 2.0;
const OUTPUT_TEXT: Color = Color::rgba8(0xc3, 0xc8, 0xd4, 1.0);
const BODY_BG: Color = Color::rgba8(0x0b, 0x0d, 0x13, 1.0);
/// Room under the title bar where scrolled lines fade out.
const FADE: f32 = 26.0;

const CHROME_H: f64 = 52.0;
const PAD_X: f64 = 34.0;
const PAD_Y: f64 = 24.0;
const SIZES: [f64; 3] = [28.0, 26.0, 24.0];
const LINE_HEIGHT: f64 = 1.5;
const ENTRY_GAP: f64 = 0.5;
const MIN_BODY: f64 = 0.5;
const EXIT_FONT: f64 = 17.0;
const EXIT_PAD: f64 = 13.0;
const EXIT_GAP: f64 = 20.0;

// terminalCamera.ts
const TYPE_CPS: f64 = 40.0;
const TYPE_MIN: f64 = 6.0;
const TYPE_MAX: f64 = 30.0;
const OUTPUT_DELAY: f64 = 4.0;
const LINE_GAP: f64 = 2.0;
const OUTPUT_SPREAD: f64 = 10.0;
const TIMING_GAP: f64 = 4.0;
const MARGIN: f64 = 20.0;
const HOLD: f64 = 30.0;

#[derive(Deserialize)]
struct EntrySrc {
    command: Option<String>,
    output: Option<String>,
    prompt: Option<String>,
    exit: Option<f64>,
}

#[derive(Deserialize)]
struct StepSrc {
    #[serde(default)]
    focus: Value,
    #[serde(default)]
    mark: Value,
}

#[derive(Deserialize)]
struct TerminalScene {
    title: Option<String>,
    window: Option<String>,
    #[serde(default)]
    entries: Vec<EntrySrc>,
    #[serde(default)]
    steps: Vec<StepSrc>,
}

fn output_lines(e: &EntrySrc) -> Vec<&str> {
    match e.output.as_deref() {
        Some(o) if !o.is_empty() => o.split('\n').collect(),
        _ => Vec::new(),
    }
}

struct OutLine {
    index: usize,
    indent: f64,
    fit: Fit,
    y: f64,
}

struct Command {
    rows: Vec<String>,
    fit: Fit,
    chars: usize,
    y: f64,
}

struct Exit {
    text: String,
    ok: bool,
    y: f64,
    w: f64,
}

struct Placed {
    index: usize,
    failed: bool,
    prompt: String,
    prompt_w: f64,
    command: Option<Command>,
    lines: Vec<OutLine>,
    exit: Option<Exit>,
    top: f64,
    bottom: f64,
}

struct Layout {
    width: f64,
    font: f64,
    row_h: f64,
    inner_w: f64,
    entries: Vec<Placed>,
    height: f64,
    view_h: f64,
    window: Option<Fit>,
}

fn wrap(text: &str, name: &str, width: f64, size: f64) -> Fit {
    let mut slot = Slot::named(name, width);
    slot.size = size;
    slot.min = size;
    fit_text(text, &slot)
}

fn mono(weight: f64, size: f64) -> Font {
    Font::new(Family::Mono, weight, size)
}

fn attempt(scene: &TerminalScene, w: f64, size: f64) -> Layout {
    let row_h = size * LINE_HEIGHT;
    let inner_w = w - 2.0 * PAD_X;
    let gap = js_round(row_h * ENTRY_GAP);
    let mut y = PAD_Y;
    let mut entries = Vec::new();
    for (index, entry) in scene.entries.iter().enumerate() {
        let top = y;
        let prompt = entry.prompt.clone().unwrap_or_else(|| "$".into());
        let prompt_w = measure(&format!("{prompt} "), &mono(700.0, size));
        let mut command = None;
        if let Some(c) = &entry.command {
            let fit = wrap(c, "terminalCommand", inner_w - prompt_w, size);
            let rows: Vec<String> = fit.lines.iter().map(|l| l.iter().map(|r| r.text.as_str()).collect()).collect();
            let chars = rows.iter().map(|r| r.chars().count()).sum();
            y_add(&mut y, fit.lines.len() as f64 * row_h);
            command = Some(Command { rows, fit, chars, y: top });
        }
        let mut lines = Vec::new();
        for (l, raw) in output_lines(entry).into_iter().enumerate() {
            let text = raw.replace('\t', "  ");
            let text = text.trim_end();
            let body = text.trim_start();
            let spaces = text.chars().count() - body.chars().count();
            let indent = (inner_w / 2.0).min(measure(&" ".repeat(spaces), &mono(400.0, size)));
            let fit = wrap(body, "terminalOutput", inner_w - indent, size);
            let n = fit.lines.len().max(1) as f64;
            lines.push(OutLine { index: l, indent, fit, y });
            y += n * row_h;
        }
        let mut exit = None;
        if let Some(code) = entry.exit {
            let text = format!("exit {}", js_num(code));
            let w = measure(&text, &mono(700.0, EXIT_FONT)) + 2.0 * EXIT_PAD;
            let last_w = if let Some(last) = lines.last() {
                Some(last.indent + last.fit.widths.last().copied().unwrap_or(0.0))
            } else {
                command.as_ref().map(|c| prompt_w + c.fit.widths.last().copied().unwrap_or(0.0))
            };
            let own = last_w.is_none_or(|lw| lw + EXIT_GAP + w > inner_w);
            exit = Some(Exit { text, ok: code == 0.0, y: if own { y } else { y - row_h }, w });
            if own {
                y += row_h;
            }
        }
        let failed = entry.exit.is_some_and(|c| c != 0.0);
        entries.push(Placed { index, failed, prompt, prompt_w, command, lines, exit, top, bottom: y });
        y += gap;
    }
    Layout { width: w, font: size, row_h, inner_w, entries, height: y - gap + PAD_Y, view_h: 0.0, window: None }
}

fn y_add(y: &mut f64, d: f64) {
    *y += d;
}

fn js_num(n: f64) -> String {
    if n.fract() == 0.0 { format!("{}", n as i64) } else { n.to_string() }
}

fn layout_terminal(scene: &TerminalScene, w: f64, height: f64) -> Layout {
    let room = height - CHROME_H;
    let mut fitted: Vec<Layout> = SIZES.iter().map(|&s| attempt(scene, w, s)).collect();
    let at = fitted.iter().position(|l| l.height <= room).unwrap_or(fitted.len() - 1);
    let mut chosen = fitted.swap_remove(at);
    chosen.view_h = room.min(chosen.height.max(js_round(room * MIN_BODY)));
    chosen.window = scene
        .window
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| fit_text(s, &Slot::named("terminalWindow", w - 260.0)));
    chosen
}

/// An entry's box and each output line's box, in session units, by item key.
fn boxes(layout: &Layout) -> HashMap<String, (f64, f64)> {
    let mut m = HashMap::new();
    for e in &layout.entries {
        m.insert(format!("en:{}", e.index), (e.top - 4.0, 0.0));
        for l in &e.lines {
            m.insert(format!("ln:{}/{}", e.index, l.index), (l.y, 0.0));
        }
    }
    m
}

// --- focus refs (shared/targets.mjs, `terminal`) ---

fn resolve_ref(scene: &TerminalScene, r: &Value) -> Vec<String> {
    let n = scene.entries.len();
    if let Some((a, b)) = index_range(r) {
        return if b < n { (a..=b).map(|i| format!("en:{i}")).collect() } else { Vec::new() };
    }
    let one = |r: &Value| -> Vec<String> {
        let Some(s) = r.as_str() else { return Vec::new() };
        let Some((a, b)) = s.split_once(':') else { return Vec::new() };
        let digits = |t: &str| !t.is_empty() && t.bytes().all(|c| c.is_ascii_digit());
        let (a, b) = (a.trim(), b.trim());
        if !digits(a) || !digits(b) {
            return Vec::new();
        }
        let (Ok(e), Ok(l)) = (a.parse::<usize>(), b.parse::<usize>()) else { return Vec::new() };
        if e < n && l < output_lines(&scene.entries[e]).len() { vec![format!("ln:{e}/{l}")] } else { Vec::new() }
    };
    let keys = one(r);
    if keys.is_empty()
        && let Some(s) = r.as_str().map(str::trim).filter(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()))
        && let Ok(i) = s.parse::<usize>()
        && i < n
    {
        return vec![format!("en:{i}")];
    }
    keys
}

fn step_keys(scene: &TerminalScene) -> Vec<Vec<String>> {
    scene
        .steps
        .iter()
        .map(|step| {
            let refs = match &step.focus {
                Value::Array(a) => a.clone(),
                Value::Null => Vec::new(),
                v => vec![v.clone()],
            };
            let mut keys: Vec<String> = Vec::new();
            for key in refs.iter().flat_map(|r| resolve_ref(scene, r)) {
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
            keys
        })
        .collect()
}

/// Per step, the last entry typed by its end.
fn entry_reach(keys: &[Vec<String>]) -> Vec<i64> {
    let mut last = -1i64;
    keys.iter()
        .map(|step| {
            for key in step {
                if key.starts_with("en:") || key.starts_with("ln:") {
                    let digits: String = key[3..].chars().take_while(char::is_ascii_digit).collect();
                    if let Ok(n) = digits.parse::<i64>() {
                        last = last.max(n);
                    }
                }
            }
            last
        })
        .collect()
}

// --- terminalCamera.ts ---

#[derive(Clone, Copy, Default)]
struct Timing {
    type_from: f64,
    type_frames: f64,
    out_from: f64,
    line_gap: f64,
}

struct Pace {
    type_frames: f64,
    delay: f64,
    line_gap: f64,
    total: f64,
}

fn natural(e: &Placed) -> Pace {
    let type_frames = e.command.as_ref().map_or(0.0, |c| TYPE_MAX.min(TYPE_MIN.max(c.chars as f64 * FPS / TYPE_CPS)));
    let delay = if e.command.is_some() { OUTPUT_DELAY } else { 0.0 };
    let n = e.lines.len();
    let line_gap = if n > 1 { LINE_GAP.min(OUTPUT_SPREAD / (n - 1) as f64) } else { 0.0 };
    Pace { type_frames, delay, line_gap, total: type_frames + delay + line_gap * n.saturating_sub(1) as f64 + 1.0 }
}

/// Plays `entries` one after another from `from`, squeezed into `budget` frames when they would take longer.
fn play_group(entries: &[Placed], from: f64, budget: f64, out: &mut [Timing]) {
    let paces: Vec<Pace> = entries.iter().map(natural).collect();
    let total = paces.iter().map(|p| p.total + TIMING_GAP).sum::<f64>() - TIMING_GAP;
    let k = if total > budget { f64::max(0.05, budget / total) } else { 1.0 };
    let mut at = from;
    for (e, p) in entries.iter().zip(&paces) {
        let out_from = at + (p.type_frames + p.delay) * k;
        let done = out_from + p.line_gap * k * e.lines.len().saturating_sub(1) as f64;
        out[e.index] = Timing { type_from: at, type_frames: p.type_frames * k, out_from, line_gap: p.line_gap * k };
        at = done + 1.0 + TIMING_GAP * k;
    }
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null | Value::Bool(false) => false,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64() != Some(0.0),
        _ => true,
    }
}

fn schedule(scene: &TerminalScene, layout: &Layout, reach: &[i64], segments: &[Segment]) -> Vec<Timing> {
    let entries = &layout.entries;
    let mut out = vec![Timing::default(); entries.len()];
    if !reach.is_empty() && segments.len() > 1 {
        let mut shown = 0usize;
        for (k, &last) in reach.iter().enumerate() {
            let end = if k == reach.len() - 1 { entries.len() as i64 - 1 } else { last };
            let from = segments[k + 1].from;
            let next = segments.get(k + 2).map_or(from + segments[k + 1].duration, |s| s.from);
            let marked = scene.steps.get(k).is_some_and(|s| truthy(&s.mark));
            let hi = ((end + 1).max(0) as usize).min(entries.len());
            if shown < hi {
                play_group(
                    &entries[shown..hi],
                    from,
                    if marked { STEP_SETTLE_FRAMES } else { (next - from) * 0.8 },
                    &mut out,
                );
            }
            shown = shown.max(hi);
        }
        return out;
    }
    let narration = &segments[0];
    let from = build_frames("terminal").max(narration.voice_from);
    let span = f64::max(entries.len() as f64 * 12.0, narration.from + narration.duration - HOLD - from);
    let slot = span / entries.len().max(1) as f64;
    for e in entries {
        play_group(std::slice::from_ref(e), from + e.index as f64 * slot, slot * 0.8, &mut out);
    }
    out
}

/// Where the camera settles for each step, from the session's top.
fn stops(scene: &TerminalScene, layout: &Layout, keys: &[Vec<String>], reach: &[i64]) -> Vec<f64> {
    let max_scroll = (layout.height - layout.view_h).max(0.0);
    let clamp = |v: f64| v.max(0.0).min(max_scroll);
    let showing = |bottom: f64| clamp(bottom + PAD_Y - layout.view_h);
    let b = boxes(layout);
    keys.iter()
        .enumerate()
        .map(|(k, ks)| {
            let last = if k == reach.len() - 1 { layout.entries.len() as i64 - 1 } else { reach[k] };
            let mut stop = if last >= 0 { showing(layout.entries[last as usize].bottom) } else { 0.0 };
            let tops: Vec<f64> = ks.iter().filter_map(|key| b.get(key).map(|v| v.0)).collect();
            if let Some(min) = tops.iter().copied().reduce(f64::min)
                && min - MARGIN < stop
            {
                stop = clamp(min - MARGIN);
            }
            let _ = scene;
            stop
        })
        .collect()
}

enum Camera {
    Still,
    Steps(Vec<f64>),
    Follow { times: Vec<f64>, values: Vec<f64> },
}

fn in_out_quad(t: f64) -> f64 {
    if t < 0.5 { 2.0 * t * t } else { 1.0 - 2.0 * (1.0 - t) * (1.0 - t) }
}

impl Camera {
    fn scroll(&self, frame: f64, segments: &[Segment]) -> f64 {
        match self {
            Camera::Still => 0.0,
            Camera::Steps(stops) => stops
                .iter()
                .enumerate()
                .map(|(k, &stop)| {
                    let prev = if k > 0 { stops[k - 1] } else { 0.0 };
                    (stop - prev) * segments.get(k + 1).map_or(0.0, |s| step_move(frame, s.from))
                })
                .sum(),
            Camera::Follow { times, values } => {
                let n = times.len();
                if frame <= times[0] {
                    return values[0];
                }
                if frame >= times[n - 1] {
                    return values[n - 1];
                }
                let i = times.iter().position(|&t| t >= frame).unwrap_or(n - 1).max(1) - 1;
                let t = (frame - times[i]) / (times[i + 1] - times[i]);
                values[i] + (values[i + 1] - values[i]) * in_out_quad(t)
            }
        }
    }
}

fn camera(
    layout: &Layout,
    timing: &[Timing],
    keys: &[Vec<String>],
    reach: &[i64],
    segments: &[Segment],
    scene: &TerminalScene,
) -> Camera {
    let max_scroll = (layout.height - layout.view_h).max(0.0);
    if max_scroll < 0.5 {
        return Camera::Still;
    }
    if !reach.is_empty() && segments.len() > 1 {
        return Camera::Steps(stops(scene, layout, keys, reach));
    }
    let showing = |bottom: f64| (bottom + PAD_Y - layout.view_h).max(0.0).min(max_scroll);
    let mut times = vec![0.0];
    let mut values = vec![0.0];
    let mut key = |t: f64, v: f64| {
        times.push(t.max(times[times.len() - 1] + 1.0));
        values.push(v.max(values[values.len() - 1]));
    };
    for e in &layout.entries {
        let t = timing[e.index];
        let done = {
            let p = e.lines.len().saturating_sub(1) as f64;
            t.out_from + t.line_gap * p
        };
        key(
            t.type_from,
            showing(match &e.command {
                Some(c) => c.y + c.fit.lines.len() as f64 * layout.row_h,
                None => e.top + layout.row_h,
            }),
        );
        key(done + 6.0, showing(e.bottom));
    }
    Camera::Follow { times, values }
}

struct TerminalView {
    shell: Shell,
    layout: Layout,
    box_h: f64,
    timing: Vec<Timing>,
    camera: Camera,
    targets: HashMap<String, Vec<usize>>,
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: TerminalScene = parse(input)?;
    let (bw, bh) = content_box(scene.title.is_some());
    let layout = layout_terminal(&scene, bw, bh);
    let keys = step_keys(&scene);
    let reach = entry_reach(&keys);
    let timing = schedule(&scene, &layout, &reach, input.segments);
    let camera = camera(&layout, &timing, &keys, &reach, input.segments, &scene);
    let mut targets: HashMap<String, Vec<usize>> = HashMap::new();
    for (k, step) in keys.iter().enumerate() {
        for key in step {
            targets.entry(key.clone()).or_default().push(k);
        }
    }
    Ok(Box::new(TerminalView { shell: Shell::new(input.scene), layout, box_h: bh, timing, camera, targets }))
}

fn byte_alpha(v: f64) -> f32 {
    (v.clamp(0.0, 1.0) * 255.0).round() as f32 / 255.0
}

impl TerminalView {
    fn entry(&self, dl: &mut DisplayList, p: &Placed, t: Timing, frame: f64, spot: &Spotlight) {
        if frame < t.type_from {
            return;
        }
        let l = &self.layout;
        let (row_h, font) = (l.row_h as f32, l.font as f32);
        let emph = |key: &str| -> Emphasis { spot.emphasis(self.targets.get(key).map_or(&[][..], |v| &v[..])) };
        let e = emph(&format!("en:{}", p.index));
        let line_e: Vec<Emphasis> = p.lines.iter().map(|ln| emph(&format!("ln:{}/{}", p.index, ln.index))).collect();
        let typed = p.command.as_ref().map_or(0, |c| {
            interpolate(frame, &[t.type_from, t.type_from + t.type_frames.max(1.0)], &[0.0, c.chars as f64], CLAMP)
                .floor() as usize
        });
        let printing = frame < t.out_from;
        let line_in = |i: usize| {
            interpolate(
                frame,
                &[t.out_from + i as f64 * t.line_gap, t.out_from + i as f64 * t.line_gap + 3.0],
                &[0.0, 1.0],
                CLAMP,
            )
        };
        let last_in = if p.lines.is_empty() {
            interpolate(frame, &[t.out_from, t.out_from + 3.0], &[0.0, 1.0], CLAMP)
        } else {
            line_in(p.lines.len() - 1)
        };
        let height = p.bottom - p.top;
        let opacity = line_e.iter().fold(e.opacity, |a, x| a.max(x.opacity));
        let (x0, top, h8) = ((PAD_X - 18.0) as f32, (p.top - 4.0) as f32, (height + 8.0) as f32);
        let wide = (l.inner_w + 36.0) as f32;
        dl.group(|dl| {
            dl.fade(opacity as f32);
            if p.failed {
                dl.group(|dl| {
                    dl.fade((0.8 * last_in) as f32);
                    dl.rect(x0, top, wide, h8, BoxStyle::fill(DEL_BG).radius(10.0));
                });
            }
            if p.failed || e.glow > 0.0 {
                dl.group(|dl| {
                    dl.fade(if p.failed { last_in } else { e.glow } as f32);
                    dl.rect(x0, top, 4.0, h8, BoxStyle::fill(if p.failed { DEL } else { ACCENT }).radius(2.0));
                });
            }
            if e.glow > 0.0 {
                dl.rect(
                    x0,
                    top,
                    wide,
                    h8,
                    BoxStyle::fill(Color::rgba8(124, 140, 255, (0.09 * e.glow) as f32))
                        .radius(10.0)
                        .border(ACCENT.alpha(byte_alpha(0.55 * e.glow)), 1.5),
                );
            }
            for (ln, le) in p.lines.iter().zip(&line_e) {
                if le.glow > 0.0 {
                    dl.rect(
                        (PAD_X + ln.indent - 10.0) as f32,
                        ln.y as f32,
                        (l.inner_w.min(ln.fit.width) + 20.0) as f32,
                        ln.fit.lines.len().max(1) as f32 * row_h,
                        BoxStyle::fill(Color::rgba8(124, 140, 255, (0.18 * le.glow) as f32))
                            .radius(8.0)
                            .border(ACCENT.alpha(byte_alpha(0.8 * le.glow)), 2.0)
                            .shadow(Shadow::new(0.0, 0.0, (24.0 * le.glow) as f32, ACCENT_GLOW)),
                    );
                }
            }
            if let Some(c) = &p.command {
                let mut before = 0usize;
                let normal_base = baseline_in(Face::Mono, font, row_h);
                let desc = line_metrics(Face::Mono, font).descent;
                for (r, row) in c.rows.iter().enumerate() {
                    let from = before;
                    before += row.chars().count();
                    let shown: String = row.chars().take(typed.saturating_sub(from)).collect();
                    let cursor_here =
                        printing && (typed < from + row.chars().count() || r == c.rows.len() - 1) && typed >= from;
                    let base = (c.y + r as f64 * l.row_h) as f32 + normal_base;
                    let mut pen = PAD_X as f32;
                    if r == 0 {
                        let color = if p.failed && last_in > 0.5 { DEL } else { ADD };
                        pen += dl.text(&format!("{} ", p.prompt), Style::mono(700.0, font), pen, base, color);
                    } else {
                        pen += p.prompt_w as f32;
                    }
                    let st = Style::mono(500.0, font);
                    pen += dl.text(&shown, st, pen, base, TEXT);
                    if cursor_here {
                        let typing = frame < t.type_from + t.type_frames;
                        let on = typing || ((frame - t.type_from) / 8.0).floor() % 2.0 == 0.0;
                        if on {
                            dl.group(|dl| {
                                dl.fade(0.85);
                                dl.fill_rect(pen, base + desc - font * 1.15, font * 0.6, font * 1.15, TEXT);
                            });
                        }
                    }
                }
            }
            for ln in &p.lines {
                dl.group(|dl| {
                    dl.fade(line_in(ln.index) as f32);
                    draw_fit(dl, &ln.fit, (PAD_X + ln.indent) as f32, ln.y as f32, TextOpts::new(OUTPUT_TEXT));
                });
            }
            if let Some(x) = &p.exit {
                dl.group(|dl| {
                    dl.fade(last_in as f32);
                    let color = if x.ok { ADD } else { DEL };
                    let ph = (EXIT_FONT * 1.7) as f32;
                    let left = (PAD_X + l.inner_w - x.w) as f32;
                    let ty = x.y as f32 + (row_h - ph) / 2.0;
                    dl.rect(
                        left,
                        ty,
                        x.w as f32,
                        ph,
                        BoxStyle::fill(if x.ok { ADD_BG } else { DEL_BG })
                            .radius(999.0f32.min(ph / 2.0))
                            .border(color.alpha(0x66 as f32 / 255.0), 1.5),
                    );
                    let st = Style::mono(700.0, EXIT_FONT as f32);
                    let normal = line_metrics(Face::Mono, EXIT_FONT as f32).normal;
                    let tw = width(&x.text, st);
                    dl.text(
                        &x.text,
                        st,
                        left + (x.w as f32 - tw) / 2.0,
                        ty + (ph - normal) / 2.0 + baseline_in(Face::Mono, EXIT_FONT as f32, normal),
                        color,
                    );
                });
            }
        });
    }

    fn chrome(&self, dl: &mut DisplayList, win_h: f32) {
        let l = &self.layout;
        let w = l.width as f32;
        let ch = CHROME_H as f32;
        dl.push_clip(0.0, 0.0, w, win_h, 16.0);
        dl.fill_rect(0.0, 0.0, w, ch + 1.0, Color::css("#171a23"));
        dl.fill_rect(0.0, ch, w, 1.0, BORDER);
        dl.pop_clip();
        for (i, c) in ["#ff5f57", "#febc2e", "#28c840"].iter().enumerate() {
            dl.group(|dl| {
                dl.fade(0.85);
                dl.rect(
                    22.0 + i as f32 * 24.0,
                    (ch - 14.0) / 2.0,
                    14.0,
                    14.0,
                    BoxStyle::fill(Color::css(c)).radius(7.0),
                );
            });
        }
        if let Some(win) = &l.window {
            let tw = win.lines.iter().map(|ln| drawn_width(win, ln, None)).fold(0.0f32, f32::max);
            draw_fit(dl, win, (w - tw) / 2.0, (ch - win.height as f32) / 2.0, TextOpts::new(MUTED));
        }
    }
}

impl SceneView for TerminalView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let l = &self.layout;
        let scroll = self.camera.scroll(frame, f.segments);
        let starts: Vec<f64> = f.segments.iter().skip(1).map(|s| s.from).collect();
        let spot = Spotlight::new(frame, &starts);
        let win_h = CHROME_H + l.view_h;
        let win_top = (self.box_h - win_h).max(0.0) * 0.4;
        let appear = interpolate(frame, &[WINDOW_START, WINDOW_START + 12.0], &[0.0, 1.0], CLAMP);
        let more = scroll < l.height - l.view_h - 1.0;
        let (w, wh, view_h) = (l.width as f32, win_h as f32, l.view_h as f32);

        // TODO(camera): the scene's `camera` field moves the content box here.
        self.shell.draw(dl, frame, f.duration, None, |dl, _bx| {
            dl.group(|dl| {
                dl.fade(appear as f32);
                dl.translate(0.0, win_top as f32 + ((1.0 - appear) * 14.0) as f32);
                let mut ring = Shadow::new(0.0, 0.0, 0.0, BORDER_STRONG);
                ring.spread = 1.5;
                dl.rect(
                    0.0,
                    0.0,
                    w,
                    wh,
                    BoxStyle::fill(BODY_BG).radius(16.0).shadow(ring).shadow(Shadow::new(
                        0.0,
                        24.0,
                        70.0,
                        Color::rgba8(0, 0, 0, 0.55),
                    )),
                );
                self.chrome(dl, wh);
                dl.group(|dl| {
                    dl.translate(0.0, CHROME_H as f32);
                    dl.push_clip(0.0, 0.0, w, view_h, 0.0);
                    dl.group(|dl| {
                        dl.translate(0.0, -scroll as f32);
                        for p in &self.layout.entries {
                            self.entry(dl, p, self.timing[p.index], frame, &spot);
                        }
                    });
                    // The mask that fades scrolled lines out under the title bar and over the bottom edge
                    // is drawn as the window's own colour fading in over them.
                    let clear = BODY_BG.alpha(0.0);
                    if scroll > 1.0 {
                        dl.rect(
                            0.0,
                            1.0,
                            w,
                            FADE - 1.0,
                            BoxStyle::fill(Paint::vertical(-1.0, FADE - 1.0, BODY_BG, clear)),
                        );
                    }
                    if more {
                        dl.rect(
                            0.0,
                            view_h - FADE,
                            w,
                            FADE,
                            BoxStyle::fill(Paint::vertical(0.0, FADE, clear, BODY_BG)),
                        );
                    }
                    dl.pop_clip();
                });
            });
            // TODO(marks): the pen marks of the current step draw over the window here.
        });
    }
}
