//! A scene's frame: its chapter label and title, an optional aside at the header's right end, and the content
//! box below, fading and sliding in and out as one (src/components/SceneShell.tsx, src/fit/shell.ts).

use super::fittext::{LineHeight, TextOpts, draw_fit, fit_height};
use crate::anim::{CLAMP, clamped, interpolate};
use crate::display::DisplayList;
use crate::textfit::{Fit, Slot, fit_text};
use crate::theme::{ACCENT, SAFE, TEXT};
use crate::timing::SCENE_EXIT_FRAMES;
use serde_json::Value;

const ENTER_FRAMES: f64 = 12.0;
const ASIDE_RESERVE: f64 = 560.0;
const ASIDE_GAP: f64 = 32.0;
const TITLE_ONE_LINE_MIN: f64 = 42.0;
const CALLOUT_W: f64 = 560.0;
const CALLOUT_PAD_X: f64 = 22.0;
const WITH_ASIDE: [&str; 8] = ["text", "graph", "state", "table", "er", "chart", "files", "review"];

/// The chapter title: the scene's own `chapter`, else one for its type (shared/chapters.mjs).
pub fn scene_chapter(scene: &Value) -> String {
    if let Some(c) = scene.get("chapter").and_then(Value::as_str).filter(|c| !c.is_empty()) {
        return c.to_string();
    }
    let ty = scene.get("type").and_then(Value::as_str).unwrap_or("");
    if ty == "graph"
        && scene
            .get("nodes")
            .and_then(Value::as_array)
            .is_some_and(|n| n.iter().any(|n| n.get("shape").and_then(Value::as_str) == Some("decision")))
    {
        return "Flowchart".into();
    }
    match ty {
        "text" => "Overview",
        "graph" => "Architecture",
        "code" => "Code change",
        "flow" => "Data flow",
        "sequence" => "Sequence",
        "er" => "Data model",
        "state" => "States",
        "mermaid" => "Diagram",
        "tests" => "Tests",
        "table" => "Table",
        "chart" => "Chart",
        "timeline" => "Timeline",
        "files" => "Files",
        "review" => "Claude's review",
        "reading" => "Reading order",
        "compare" => "Compare",
        "terminal" => "Terminal",
        "layers" => "Layers",
        "array" => "Step by step",
        "memory" => "Memory",
        "svg" => "Drawing",
        "plot" => "Plot",
        other => other,
    }
    .to_string()
}

/// Every callout text the scene shows: its own and the steps' (src/fit/callout.ts).
fn callout_texts(scene: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |v: Option<&Value>| {
        if let Some(s) = v.and_then(Value::as_str).filter(|s| !s.is_empty())
            && !out.iter().any(|o| o == s)
        {
            out.push(s.to_string());
        }
    };
    add(scene.get("callout"));
    for step in scene.get("steps").and_then(Value::as_array).into_iter().flatten() {
        add(step.get("callout"));
    }
    out
}

/// Width of the header callout's box, or 0 without one (`calloutBoxWidth`).
pub fn callout_box_width(scene: &Value) -> f64 {
    callout_texts(scene)
        .iter()
        .map(|t| {
            fit_text(t, &Slot::named("headerCallout", CALLOUT_W - 2.0 * CALLOUT_PAD_X)).width + 2.0 * CALLOUT_PAD_X
        })
        .fold(0.0, f64::max)
}

/// The header's chapter label and title (`shellFits`).
pub fn shell_fits(scene: &Value) -> (Fit, Option<Fit>) {
    let callout = callout_box_width(scene);
    let ty = scene.get("type").and_then(Value::as_str).unwrap_or("");
    let aside = if WITH_ASIDE.contains(&ty) { ASIDE_RESERVE + ASIDE_GAP } else { 0.0 }
        + if callout > 0.0 { callout + ASIDE_GAP } else { 0.0 };
    let width = 1920.0 - 104.0 - 104.0 - aside;
    let title = scene.get("title").and_then(Value::as_str).filter(|t| !t.is_empty());
    let mut title_slot = Slot::named("title", width);
    if callout > 0.0 {
        title_slot.lines = 2;
        title_slot.one_line_min = Some(TITLE_ONE_LINE_MIN);
    }
    (fit_text(&scene_chapter(scene), &Slot::named("eyebrow", width)), title.map(|t| fit_text(t, &title_slot)))
}

/// Where a scene's content goes, in frame pixels.
#[derive(Clone, Copy, Debug)]
pub struct ContentBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// What the header draws at its right end: its height, and how to draw it with its right edge at `right`
/// and its top at `top`.
pub struct Aside<'a> {
    pub height: f32,
    pub draw: &'a dyn Fn(&mut DisplayList, f32, f32),
}

pub struct Shell {
    pub eyebrow: Fit,
    pub title: Option<Fit>,
    /// The content is already on screen as the scene starts, held from the scene before (a picture it continues),
    /// so only the header fades in.
    pub hold_in: bool,
    /// The content stays on screen as the scene ends, for the next scene to continue, so only the header fades out.
    pub hold_out: bool,
    /// The least height the header takes, so every scene of a held picture lays it out in the same box.
    pub header_min: f32,
}

impl Shell {
    pub fn new(scene: &Value) -> Shell {
        let (eyebrow, title) = shell_fits(scene);
        Shell { eyebrow, title, hold_in: false, hold_out: false, header_min: 0.0 }
    }

    /// The header's height with an aside `aside_h` tall (0 without one).
    pub fn header_height(&self, aside_h: f32) -> f32 {
        self.label_height().max(aside_h).max(self.header_min)
    }

    fn label_height(&self) -> f32 {
        fit_height(&self.eyebrow, LineHeight::Normal)
            + self.title.as_ref().map_or(0.0, |t| 10.0 + fit_height(t, LineHeight::Normal))
    }

    /// The content box below a header with an aside `aside_h` tall (0 without one).
    pub fn content(&self, aside_h: f32) -> ContentBox {
        let header = self.header_height(aside_h);
        let y = SAFE.top + header + 36.0;
        ContentBox { x: SAFE.left, y, w: 1920.0 - SAFE.left - SAFE.right, h: 1080.0 - SAFE.bottom - y }
    }

    /// Draws the header and runs `content` translated to the content box's origin, all faded and slid as the
    /// scene enters and leaves.
    pub fn draw(
        &self,
        dl: &mut DisplayList,
        frame: f64,
        duration: f64,
        aside: Option<Aside>,
        content: impl FnOnce(&mut DisplayList, ContentBox),
    ) {
        let exit_start = ENTER_FRAMES.max(duration - SCENE_EXIT_FRAMES);
        let opacity = interpolate(frame, &[0.0, ENTER_FRAMES, exit_start, duration], &[0.0, 1.0, 1.0, 0.0], CLAMP);
        let y = clamped(frame, 0.0, ENTER_FRAMES, 28.0, 0.0) + clamped(frame, exit_start, duration, 0.0, -16.0);
        let aside_h = aside.as_ref().map_or(0.0, |a| a.height);
        let header = self.header_height(aside_h);
        let bx = self.content(aside_h);
        let draw_header = |dl: &mut DisplayList| {
            let mut top = SAFE.top + header - self.label_height();
            if crate::look::board() {
                // On the board the chapter label is left out and the title is lettered by hand, written on as the
                // scene starts.
                if let Some(t) = &self.title {
                    hand_title(dl, t, SAFE.left, top, frame);
                }
                if let Some(a) = &aside {
                    (a.draw)(dl, 1920.0 - SAFE.right, SAFE.top + header - a.height);
                }
                return;
            }
            top += draw_fit(dl, &self.eyebrow, SAFE.left, top, TextOpts::new(ACCENT).normal());
            if let Some(t) = &self.title {
                draw_fit(dl, t, SAFE.left, top + 10.0, TextOpts::new(TEXT).normal());
            }
            if let Some(a) = &aside {
                (a.draw)(dl, 1920.0 - SAFE.right, SAFE.top + header - a.height);
            }
        };
        if !self.hold_in && !self.hold_out {
            dl.save();
            dl.fade(opacity as f32);
            dl.translate(0.0, y as f32);
            draw_header(dl);
            dl.save();
            dl.translate(bx.x, bx.y);
            content(dl, bx);
            dl.restore();
            dl.restore();
            return;
        }
        // A held picture: the header fades and slides as usual, the content only at an end it does not hold.
        dl.save();
        dl.fade(opacity as f32);
        dl.translate(0.0, y as f32);
        draw_header(dl);
        dl.restore();
        let fade_in = if self.hold_in { 1.0 } else { clamped(frame, 0.0, ENTER_FRAMES, 0.0, 1.0) };
        let fade_out = if self.hold_out { 1.0 } else { clamped(frame, exit_start, duration, 1.0, 0.0) };
        let slide = if self.hold_in { 0.0 } else { clamped(frame, 0.0, ENTER_FRAMES, 28.0, 0.0) }
            + if self.hold_out { 0.0 } else { clamped(frame, exit_start, duration, 0.0, -16.0) };
        dl.save();
        dl.fade(fade_in.min(fade_out) as f32);
        dl.translate(bx.x, bx.y + slide as f32);
        content(dl, bx);
        dl.restore();
    }

    /// How much of the scene's ink to show at `frame`: all of it, fading out over the scene's last frames when the
    /// scene holds its content for the next, since ink does not carry to it.
    pub fn ink_alpha(&self, frame: f64, duration: f64) -> f32 {
        if !self.hold_out {
            return 1.0;
        }
        let exit_start = ENTER_FRAMES.max(duration - SCENE_EXIT_FRAMES);
        clamped(frame, exit_start, duration, 1.0, 0.0) as f32
    }
}

/// A pre-read diagram's quiet "In the code:" line at the top right, naming the files of the hunks its `from` cites
/// (`SourceLine` of src/Walkthrough.tsx, src/fit/source.ts). Drawn over the scene, outside its shell.
pub fn source_line(scene: &Value, hunks: &std::collections::HashMap<String, crate::model::Hunk>) -> Option<Fit> {
    let mut files: Vec<String> = Vec::new();
    for id in scene.get("from").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        if let Some(h) = hunks.get(id) {
            let name = h.file.rsplit('/').next().unwrap_or(&h.file).to_string();
            if !files.contains(&name) {
                files.push(name);
            }
        }
    }
    (!files.is_empty()).then(|| {
        fit_text(
            &format!("In the code: {}", files.join(", ")),
            &Slot::named("sourceLine", 1920.0 - SAFE.left as f64 - SAFE.right as f64),
        )
    })
}

/// Draws a source line fit at the top right of the frame.
pub fn draw_source_line(dl: &mut DisplayList, fit: &Fit) {
    let w = crate::chrome::fittext::drawn_width(fit, &fit.lines[0], None);
    dl.group(|dl| {
        dl.fade(0.85);
        draw_fit(dl, fit, 1920.0 - SAFE.right - w, 22.0, TextOpts::new(crate::theme::MUTED).normal());
    });
}

/// A title's size in the handwriting face, against its size in the sans: the hand is smaller for its size.
const HAND_TITLE_SCALE: f32 = 1.3;
/// Frames a title takes to write on, a character, and the frame it starts on.
const HAND_FRAMES_PER_CHAR: f64 = 1.1;
const HAND_START: f64 = 4.0;

fn title_lines(t: &Fit) -> Vec<String> {
    t.lines.iter().map(|l| l.iter().map(|r| r.text.as_str()).collect::<String>()).collect()
}

/// How far a title is written at `frame`, 0 to 1.
fn title_written(t: &Fit, frame: f64) -> f64 {
    let chars: usize = title_lines(t).iter().map(|l| l.chars().count()).sum();
    ((frame - HAND_START) / (chars.max(1) as f64 * HAND_FRAMES_PER_CHAR)).clamp(0.0, 1.0)
}

/// The title lettered by hand in orange at (x, top), revealed left to right, line by line, as it is written.
fn hand_title(dl: &mut DisplayList, t: &Fit, x: f32, top: f32, frame: f64) {
    use crate::text::{Face, Style, baseline_in, shape};
    let size = t.size as f32 * HAND_TITLE_SCALE;
    let lh = (size * 1.15).round();
    let lines = title_lines(t);
    let total: f64 = lines.iter().map(|l| l.chars().count().max(1) as f64).sum();
    let written = title_written(t, frame);
    let mut before = 0.0;
    for (i, line) in lines.iter().enumerate() {
        let share = line.chars().count().max(1) as f64 / total;
        let p = ((written - before) / share).clamp(0.0, 1.0);
        before += share;
        if p <= 0.0 {
            continue;
        }
        let run = shape(line, Style::new(Face::Hand, 700.0, size));
        let y = top + i as f32 * lh;
        let base = y + baseline_in(Face::Hand, size, lh);
        if p < 1.0 {
            dl.push_clip(x - 20.0, y - 20.0, run.width * p as f32 + 20.0, lh + 40.0, 0.0);
        }
        dl.run(run.clone(), x, base, crate::look::ORANGE);
        if p < 1.0 {
            dl.pop_clip();
        }
    }
}

impl Shell {
    /// The pencil's spans as it letters the title on the board, a line at a time, with the header's aside
    /// `aside_h` tall.
    pub fn title_spans(&self, aside_h: f32) -> Vec<super::pencil::Span> {
        use crate::text::{Face, Style, shape};
        let Some(t) = self.title.as_ref() else { return Vec::new() };
        let size = t.size as f32 * HAND_TITLE_SCALE;
        let lh = (size * 1.15).round() as f64;
        let lines = title_lines(t);
        let chars: Vec<f64> = lines.iter().map(|l| l.chars().count().max(1) as f64).collect();
        let total_frames = chars.iter().sum::<f64>() * HAND_FRAMES_PER_CHAR;
        let top = self.header_top(aside_h) as f64;
        let mut from = HAND_START;
        lines
            .iter()
            .enumerate()
            .map(|(i, line)| {
                let frames = total_frames * chars[i] / chars.iter().sum::<f64>();
                let w = shape(line, Style::new(Face::Hand, 700.0, size)).width as f64;
                let span = super::pencil::Span {
                    from,
                    to: from + frames,
                    path: super::pencil::writing_path(SAFE.left as f64, top + i as f64 * lh, w, lh),
                };
                from += frames;
                span
            })
            .collect()
    }

    /// The top of the header's labels, where the title is lettered on the board.
    pub fn header_top(&self, aside_h: f32) -> f32 {
        SAFE.top + self.header_height(aside_h) - self.label_height()
    }
}

/// The "illustrative" tag of a scene with `"illustrative": true`: a sketch, not real data.
pub fn illustrative(scene: &Value) -> Option<Fit> {
    (scene.get("illustrative").and_then(Value::as_bool) == Some(true))
        .then(|| fit_text("illustrative", &Slot::named("sourceLine", 400.0)))
}

/// Draws the illustrative tag at the stage's bottom right, just above the captions, fading with the scene.
pub fn draw_illustrative(dl: &mut DisplayList, fit: &Fit, frame: f64, duration: f64) {
    let exit_start = ENTER_FRAMES.max(duration - SCENE_EXIT_FRAMES);
    let opacity = interpolate(frame, &[0.0, ENTER_FRAMES, exit_start, duration], &[0.0, 1.0, 1.0, 0.0], CLAMP);
    let w = crate::chrome::fittext::drawn_width(fit, &fit.lines[0], None);
    let h = fit_height(fit, LineHeight::Normal);
    dl.group(|dl| {
        dl.fade(0.7 * opacity as f32);
        draw_fit(
            dl,
            fit,
            1920.0 - SAFE.right - w,
            1080.0 - SAFE.bottom - h - 6.0,
            TextOpts::new(crate::theme::MUTED).normal(),
        );
    });
}
