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
}

impl Shell {
    pub fn new(scene: &Value) -> Shell {
        let (eyebrow, title) = shell_fits(scene);
        Shell { eyebrow, title }
    }

    fn label_height(&self) -> f32 {
        fit_height(&self.eyebrow, LineHeight::Normal)
            + self.title.as_ref().map_or(0.0, |t| 10.0 + fit_height(t, LineHeight::Normal))
    }

    /// The content box below a header with an aside `aside_h` tall (0 without one).
    pub fn content(&self, aside_h: f32) -> ContentBox {
        let header = self.label_height().max(aside_h);
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
        let header = self.label_height().max(aside_h);
        let bx = self.content(aside_h);
        dl.save();
        dl.fade(opacity as f32);
        dl.translate(0.0, y as f32);
        let mut top = SAFE.top + header - self.label_height();
        top += draw_fit(dl, &self.eyebrow, SAFE.left, top, TextOpts::new(ACCENT).normal());
        if let Some(t) = &self.title {
            draw_fit(dl, t, SAFE.left, top + 10.0, TextOpts::new(TEXT).normal());
        }
        if let Some(a) = aside {
            (a.draw)(dl, 1920.0 - SAFE.right, SAFE.top + header - a.height);
        }
        dl.save();
        dl.translate(bx.x, bx.y);
        content(dl, bx);
        dl.restore();
        dl.restore();
    }
}

/// Whether any state of the scene shows a header callout: its own, or one a step brings (`hasCallout`).
pub fn has_callout(scene: &Value) -> bool {
    !callout_texts(scene).is_empty()
}

/// The content box a scene's layout and camera assume (`headerBox` of src/fit/shell.ts): `content_box`, less the
/// lines a wrapped title takes.
pub fn header_box(scene: &Value) -> (f64, f64) {
    let (_, title) = shell_fits(scene);
    let (w, h) = crate::theme::content_box(title.is_some() || has_callout(scene));
    match title {
        Some(t) => (w, h - (t.lines.len() as f64 - 1.0) * crate::timing::js_round(t.size * t.line_height)),
        None => (w, h),
    }
}

/// The header callout of a scene whose steps set `callout` (src/components/HeaderCallout.tsx): a box at the header's
/// right end, as wide as the widest callout, crossfading as steps replace its text and glowing while it settles.
pub struct HeaderCallout {
    fits: Vec<(String, Fit)>,
    width: f32,
    height: f32,
}

const CALLOUT_PAD_Y: f64 = 12.0;

impl HeaderCallout {
    /// The scene's callout, or None when no state shows one.
    pub fn new(scene: &Value) -> Option<HeaderCallout> {
        let texts = callout_texts(scene);
        if texts.is_empty() {
            return None;
        }
        let fits: Vec<(String, Fit)> = texts
            .into_iter()
            .map(|t| {
                let f = fit_text(&t, &Slot::named("headerCallout", CALLOUT_W - 2.0 * CALLOUT_PAD_X));
                (t, f)
            })
            .collect();
        let height = fits.iter().map(|(_, f)| f.height).fold(0.0, f64::max) + 2.0 * CALLOUT_PAD_Y;
        Some(HeaderCallout { width: callout_box_width(scene) as f32, height: height as f32, fits })
    }

    /// Its height, for the shell's [`Aside`].
    pub fn height(&self) -> f32 {
        self.height
    }
    pub fn width(&self) -> f32 {
        self.width
    }

    /// Draws it with its right edge at `right` and its top at `top`, at the state frame `s`.
    pub fn draw(&self, dl: &mut DisplayList, right: f32, top: f32, s: &crate::states::StateFrame) {
        use crate::display::{BoxStyle, Shadow};
        use crate::theme::{ACCENT, ACCENT_GLOW, ACCENT_SOFT, BORDER_STRONG, RAISED};
        let (was, now) = (s.before.callout.as_str(), s.now.callout.as_str());
        let has = |v: &str| if v.is_empty() { 0.0 } else { 1.0 };
        let shown = has(was) + (has(now) - has(was)) * s.t;
        let changed = was != now;
        let glow = if changed { s.lit } else { 0.0 } as f32;
        let (x, w, h) = (right - self.width, self.width, self.height);
        dl.group(|dl| {
            dl.fade(shown as f32);
            let mut b =
                BoxStyle::fill(RAISED).radius(14.0).border(if glow > 0.0 { ACCENT } else { BORDER_STRONG }, 1.5);
            b = if glow > 0.0 {
                b.shadow(Shadow { dx: 0.0, dy: 0.0, blur: 0.0, spread: 3.0 * glow, color: ACCENT_SOFT })
                    .shadow(Shadow::new(0.0, 0.0, 30.0 * glow, ACCENT_GLOW))
            } else {
                b.shadow(Shadow::new(0.0, 10.0, 26.0, crate::color::Color::rgba8(0, 0, 0, 0.35)))
            };
            dl.rect(x, top, w, h, b);
            let text = |dl: &mut DisplayList, value: &str, opacity: f32| {
                let Some((_, f)) = self.fits.iter().find(|(t, _)| t == value) else { return };
                if value.is_empty() || opacity <= 0.0 {
                    return;
                }
                let fh = fit_height(f, LineHeight::Fit);
                dl.group(|dl| {
                    dl.fade(opacity);
                    draw_fit(dl, f, x, top + (h - fh) / 2.0, TextOpts::new(TEXT).centered(w));
                });
            };
            if changed {
                text(dl, was, 1.0 - s.t as f32);
                text(dl, now, s.t as f32);
            } else {
                text(dl, now, 1.0);
            }
        });
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
