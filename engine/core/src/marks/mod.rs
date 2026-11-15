//! Pen marks and ink: what a step's `mark` draws on what it points at, with its note, and what its `draw` puts on the
//! board until a step erases it. A port of src/components/PenMarks.tsx and Ink.tsx over shared/pen-marks.mjs and
//! shared/ink.mjs. A scene lays out a [`Board`] once from the boxes it gives each step ([`MarkTargets`]), then draws
//! it every frame inside its content box (see engine/README.md, "Pen marks, ink and the camera").

pub mod geometry;

use crate::anim::{CLAMP, clamped, interpolate};
use crate::color::Color;
use crate::display::{DisplayList, PathBuilder, Stroke as LineStroke};
use crate::markup::plain_text;
use crate::model::Hunk;
use crate::steps::{current_step, step_move};
use crate::text::{Face, Style, shape, width};
use crate::theme::{self, BG};
use crate::timing::{Segment, cue_frame, index_range, scene_steps};
use geometry::*;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

const INK: Color = Color::rgba8(0xff, 0xe0, 0x66, 1.0);
const PEN: f64 = 4.5;
const NOTE_FONT: f32 = 34.0;
const CLEAR_FRAMES: f64 = 8.0;
const INK_NOTE_FONT: f32 = 38.0;
const WRITE_FONT: f32 = 42.0;
const INK_CLEAR_FRAMES: f64 = 10.0;
const STROKE_PX_PER_FRAME: f64 = 60.0;
const ARROW_PX_PER_FRAME: f64 = 40.0;
const FRAMES_PER_CHAR: f64 = 2.2;
const ITEM_GAP: f64 = 4.0;

/// The box of a key the scene does not list, such as a code line ("ln:<hunk line>") or text on one.
pub type BoxOf = Arc<dyn Fn(&str) -> Option<Bx> + Send + Sync>;

/// What a scene tells the pen about one step, in its content box (`MarkTargets` of src/utils/penGeometry.ts): the box of
/// each item a mark can draw on, by item key (as shared/targets.mjs names them; a code scene names its step's lines
/// "lines" and its token "token").
#[derive(Clone)]
pub struct MarkTargets {
    /// Item boxes, in the order the scene lists them.
    pub boxes: Vec<(String, Bx)>,
    /// Everything a note must keep off; every box when None.
    pub obstacles: Option<Vec<Bx>>,
    /// Points along the lines between items, which a note should rather not cross.
    pub lines: Vec<Pt>,
    /// Where marks and notes stay: the content box.
    pub area: Bx,
    /// The box of an item key that `boxes` does not list.
    pub box_of: Option<BoxOf>,
    /// Where ink shows, when content scrolls out of part of the area (a code scene's viewport).
    pub clip: Option<Bx>,
    /// Whether the scene moves the boxes towards this step while it plays (a code scene's scroll): ink then follows
    /// the shift the scene gives at draw time instead of later steps' boxes.
    pub shifts: bool,
}

impl MarkTargets {
    /// Targets with just these boxes in an area.
    pub fn new(boxes: Vec<(String, Bx)>, area: Bx) -> MarkTargets {
        MarkTargets { boxes, obstacles: None, lines: Vec::new(), area, box_of: None, clip: None, shifts: false }
    }
    pub fn get(&self, key: &str) -> Option<Bx> {
        self.boxes.iter().find(|(k, _)| k == key).map(|(_, b)| *b).or_else(|| self.box_of.as_ref().and_then(|f| f(key)))
    }
    fn obstacles(&self) -> Vec<Bx> {
        self.obstacles.clone().unwrap_or_else(|| self.boxes.iter().map(|(_, b)| *b).collect())
    }

    /// These targets and another set's in one content box, such as a graph's and its table's (`merged` of
    /// sceneTargets.ts).
    pub fn merged(mut self, other: MarkTargets) -> MarkTargets {
        let mut obstacles = self.obstacles();
        obstacles.extend(other.obstacles());
        self.boxes.extend(other.boxes);
        self.lines.extend(other.lines);
        self.obstacles = Some(obstacles);
        self
    }
}

/// A layout's item boxes in its own units, as its layout code knows them (`LayoutBoxes` of penGeometry.ts).
#[derive(Clone, Default)]
pub struct LayoutBoxes {
    pub boxes: Vec<(String, Bx)>,
    pub obstacles: Option<Vec<Bx>>,
    pub lines: Vec<Pt>,
}

impl LayoutBoxes {
    pub fn add(&mut self, key: impl Into<String>, b: Bx) {
        self.boxes.push((key.into(), b));
    }
}

/// Where a scene draws a laid-out picture in its content box: layout point (x, y) lands at
/// (left + x * scale, top + y * scale).
#[derive(Clone, Copy, Debug)]
pub struct Stage {
    pub left: f64,
    pub top: f64,
    pub scale: f64,
}

impl Stage {
    /// A layout of `size` centred in `area` and scaled about its centre, as the diagram scenes draw theirs.
    pub fn centred(area: (f64, f64), size: (f64, f64), scale: f64) -> Stage {
        Stage { left: (area.0 - size.0 * scale) / 2.0, top: (area.1 - size.1 * scale) / 2.0, scale }
    }
    fn place(&self, b: &Bx) -> Bx {
        Bx::new(self.left + b.x * self.scale, self.top + b.y * self.scale, b.width * self.scale, b.height * self.scale)
    }
    /// A layout's boxes as they land in a content box of `size` (`staged`).
    pub fn targets(&self, l: &LayoutBoxes, size: (f64, f64)) -> MarkTargets {
        MarkTargets {
            boxes: l.boxes.iter().map(|(k, b)| (k.clone(), self.place(b))).collect(),
            obstacles: l.obstacles.as_ref().map(|o| o.iter().map(|b| self.place(b)).collect()),
            lines: l
                .lines
                .iter()
                .map(|p| Pt { x: self.left + p.x * self.scale, y: self.top + p.y * self.scale })
                .collect(),
            ..MarkTargets::new(Vec::new(), Bx::new(0.0, 0.0, size.0, size.1))
        }
    }
}

/// A box of `width` and `height` centred on a point.
pub fn around(p: Pt, width: f64, height: f64) -> Bx {
    Bx::new(p.x - width / 2.0, p.y - height / 2.0, width, height)
}

/// The item keys a ref names on a step, as ink, marks and the camera resolve it (`stepRefKeys`): keys, or how many
/// places a code text occurs on the step's lines when it is not one.
pub enum RefKeys {
    Keys(Vec<String>),
    Many(usize),
    None,
}

/// Resolves a scene's refs to item keys: the scene type's `resolve` of shared/targets.mjs.
pub trait Refs: Sync {
    /// The keys `r` names in this scene, or None when it names nothing.
    fn resolve(&self, r: &Value) -> Option<Vec<String>>;
}

/// `resolveRef`: the scene's own resolution, and an index written as a string when nothing is named so.
pub fn resolve_ref(refs: &dyn Refs, r: &Value) -> Option<Vec<String>> {
    refs.resolve(r).or_else(|| {
        let s = r.as_str()?.trim();
        (!s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
            .then(|| refs.resolve(&Value::from(s.parse::<u64>().ok()?)))?
    })
}

/// A scene with no refs.
pub struct NoRefs;
impl Refs for NoRefs {
    fn resolve(&self, _: &Value) -> Option<Vec<String>> {
        None
    }
}

/// How a scene's refs resolve on a step: a scene type's refs, or a code scene's lines and text.
pub enum StepRefs<'a> {
    Scene(&'a dyn Refs),
    Code(&'a Hunk),
}

impl StepRefs<'_> {
    pub fn keys(&self, step: &Value, r: &Value) -> RefKeys {
        match self {
            StepRefs::Scene(refs) => resolve_ref(*refs, r).map_or(RefKeys::None, RefKeys::Keys),
            StepRefs::Code(hunk) => code_keys(hunk, step, r),
        }
    }
}

/// `codeKeys` of shared/ink.mjs: a line or range on the step's side ("ln:<hunk line>"), or text that occurs once on the
/// step's lines ("tx:<hunk line>:<offset>:<length>", offsets in UTF-16 units as the JS counts them).
pub fn code_keys(hunk: &Hunk, step: &Value, r: &Value) -> RefKeys {
    let digits = r.as_str().is_some_and(|s| !s.trim().is_empty() && s.trim().chars().all(|c| c.is_ascii_digit()));
    if !digits && let Some((a, b)) = index_range(r) {
        let (side, _) = crate::focus::step_range(step);
        let hits: Vec<String> = hunk
            .lines
            .iter()
            .enumerate()
            .filter(|(_, l)| {
                let n = if side == crate::focus::Side::Old { l.old_line } else { l.new_line };
                n.is_some_and(|n| n >= a as i64 && n <= b as i64)
            })
            .map(|(i, _)| format!("ln:{i}"))
            .collect();
        return if hits.is_empty() { RefKeys::None } else { RefKeys::Keys(hits) };
    }
    let Some(text) = r.as_str().filter(|t| !t.trim().is_empty()) else { return RefKeys::None };
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut hits = Vec::new();
    for i in step_lines(hunk, step) {
        let line: Vec<u16> = hunk.lines[i].text.encode_utf16().collect();
        if units.len() > line.len() {
            continue;
        }
        for at in 0..=line.len() - units.len() {
            if line[at..at + units.len()] == units[..] {
                hits.push(format!("tx:{i}:{at}:{}", units.len()));
            }
        }
    }
    match hits.len() {
        0 => RefKeys::None,
        1 => RefKeys::Keys(hits),
        n => RefKeys::Many(n),
    }
}

/// Indexes into `hunk.lines` of the lines a code step highlights (`stepLines`).
pub fn step_lines(hunk: &Hunk, step: &Value) -> Vec<usize> {
    let (side, (a, b)) = crate::focus::step_range(step);
    hunk.lines
        .iter()
        .enumerate()
        .filter(|(_, l)| {
            let n = if side == crate::focus::Side::Old { l.old_line } else { l.new_line };
            n.is_some_and(|n| n >= a && n <= b)
        })
        .map(|(i, _)| i)
        .collect()
}

/// Every place a code step's `token` occurs in its lines: (hunk line, UTF-16 offset) (`tokenHits`).
pub fn token_hits(hunk: &Hunk, step: &Value) -> Vec<(usize, usize)> {
    let Some(token) = step.get("token").and_then(Value::as_str).filter(|t| !t.is_empty()) else { return Vec::new() };
    let t: Vec<u16> = token.encode_utf16().collect();
    let mut out = Vec::new();
    for i in step_lines(hunk, step) {
        let line: Vec<u16> = hunk.lines[i].text.encode_utf16().collect();
        if t.len() > line.len() {
            continue;
        }
        for at in 0..=line.len() - t.len() {
            if line[at..at + t.len()] == t[..] {
                out.push((i, at));
            }
        }
    }
    out
}

/// A review flag's pen: its colour, and the word written before its note (`Ink` of PenMarks.tsx).
#[derive(Clone)]
pub struct InkOf {
    pub color: Color,
    pub label: String,
}

fn focus_refs(focus: Option<&Value>) -> Vec<Value> {
    match focus {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(a)) => a.clone(),
        Some(v) => vec![v.clone()],
    }
}

fn hand_width(text: &str, size: f32) -> f64 {
    width(text, Style::new(Face::Hand, 600.0, size)).ceil() as f64
}

/// A mark laid out: its sketch, a retrace, its note and box, and when it draws.
struct PlacedMark {
    step: usize,
    sketch: Sketch,
    trace: Sketch,
    note: Option<(String, Bx)>,
    color: Color,
    arrow: bool,
    start: f64,
    done: f64,
    clear: f64,
}

#[derive(Clone)]
enum InkTarget {
    Keys(Vec<String>),
    Ink(String),
    Point(f64, f64),
}

struct BoardItem {
    step: usize,
    index: usize,
    item: Value,
    verb: &'static str,
    targets: Vec<InkTarget>,
    until: Option<usize>,
    id: Option<String>,
}

struct InkText {
    lines: Vec<String>,
    bx: Bx,
    size: f32,
}

struct PlacedInk {
    item: BoardItem,
    sketch: Option<Sketch>,
    text: Option<InkText>,
    text_first: bool,
    color: Color,
    start: f64,
    stroke_frames: f64,
    text_frames: f64,
    clear: f64,
    bounds: Bx,
}

/// A scene's pen marks and ink, laid out once.
pub struct Board {
    marks: Vec<PlacedMark>,
    ink: Vec<PlacedInk>,
    /// Each step's targets, for ink that follows what it marks as later steps move it.
    targets: Vec<Option<MarkTargets>>,
    clip: Option<Bx>,
}

const INK_VERBS: [&str; 9] = ["circle", "box", "underline", "strike", "cross", "tick", "brace", "arrow", "write"];

fn is_text(v: &Value) -> bool {
    v.as_str().is_some_and(|s| !s.trim().is_empty())
}

/// The items of the board in order, with their targets and the step that erases each (`inkBoard`, without its
/// problem reports, which are `validate`'s).
fn ink_board(scene: &Value, refs: &StepRefs) -> Vec<BoardItem> {
    let steps = scene_steps(scene);
    let mut items: Vec<BoardItem> = Vec::new();
    if !steps.iter().any(|s| s.get("draw").is_some() || s.get("erase").is_some()) {
        return items;
    }
    for (k, step) in steps.iter().enumerate() {
        if !step.is_object() {
            continue;
        }
        match step.get("erase") {
            Some(Value::Bool(true)) => {
                items.iter_mut().filter(|it| it.until.is_none()).for_each(|it| it.until = Some(k))
            }
            Some(Value::Array(ids)) => {
                for id in ids {
                    for it in items.iter_mut().filter(|it| it.until.is_none() && it.id.as_deref() == id.as_str()) {
                        it.until = Some(k);
                    }
                }
            }
            _ => {}
        }
        let Some(Value::Array(draw)) = step.get("draw") else { continue };
        for (i, item) in draw.iter().enumerate() {
            if !item.is_object() {
                continue;
            }
            let verbs: Vec<&'static str> = INK_VERBS.iter().copied().filter(|v| item.get(*v).is_some()).collect();
            if verbs.len() != 1 {
                continue;
            }
            let verb = verbs[0];
            let live_ids: Vec<String> =
                items.iter().filter(|it| it.until.is_none()).filter_map(|it| it.id.clone()).collect();
            let target = |r: &Value, points: bool| -> Option<InkTarget> {
                if points
                    && let Some(a) = r.as_array()
                    && a.len() == 2
                    && a.iter().all(Value::is_number)
                {
                    let (x, y) = (a[0].as_f64()?, a[1].as_f64()?);
                    return ((0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y)).then_some(InkTarget::Point(x, y));
                }
                if let Some(s) = r.as_str()
                    && live_ids.iter().any(|id| id == s)
                {
                    return Some(InkTarget::Ink(s.to_string()));
                }
                if !r.is_string() && !r.is_number() {
                    return None;
                }
                match refs.keys(step, r) {
                    RefKeys::Keys(k) => Some(InkTarget::Keys(k)),
                    _ => None,
                }
            };
            let targets: Vec<Option<InkTarget>> = match verb {
                "arrow" => match item.get("arrow").and_then(Value::as_array) {
                    Some(a) if a.len() == 2 => a.iter().map(|r| target(r, true)).collect(),
                    _ => continue,
                },
                "write" => {
                    if item.get("near").is_some() == item.get("at").is_some() {
                        continue;
                    }
                    item.get("near").map(|n| vec![target(n, false)]).unwrap_or_default()
                }
                _ => {
                    let refs = match item.get(verb) {
                        Some(Value::Array(a)) => a.clone(),
                        Some(v) => vec![v.clone()],
                        None => Vec::new(),
                    };
                    if refs.is_empty() {
                        continue;
                    }
                    refs.iter().map(|r| target(r, false)).collect()
                }
            };
            if targets.iter().any(Option::is_none) {
                continue;
            }
            items.push(BoardItem {
                step: k,
                index: i,
                item: item.clone(),
                verb,
                targets: targets.into_iter().flatten().collect(),
                until: None,
                id: item.get("id").filter(|v| is_text(v)).and_then(Value::as_str).map(str::to_string),
            });
        }
    }
    items
}

/// The JSON text the TS seeds an item with (`JSON.stringify(item)`, keys in their written order).
fn js_json(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_default()
}

impl Board {
    /// Lays out every mark and ink item of `scene`. `targets(k)` gives step k's boxes as the step settles; `ink_of`
    /// gives a review flag's pen for a step, if any; `code` says marks aim at "token" or "lines".
    pub fn new(
        scene: &Value,
        segments: &[Segment],
        refs: &StepRefs,
        targets: &dyn Fn(usize) -> Option<MarkTargets>,
        ink_of: &dyn Fn(&Value) -> Option<InkOf>,
    ) -> Board {
        let steps = scene_steps(scene);
        let all: Vec<Option<MarkTargets>> = (0..steps.len()).map(targets).collect();
        let code = matches!(refs, StepRefs::Code(_));
        let mut marks = Vec::new();
        for (k, step) in steps.iter().enumerate() {
            let Some(mark) = step.get("mark").and_then(Value::as_str).and_then(Mark::parse) else { continue };
            let (Some(seg), Some(t)) = (segments.get(k + 1), all[k].as_ref()) else { continue };
            let target = if code {
                t.get(if step.get("token").is_some_and(|v| !v.is_null()) { "token" } else { "lines" })
            } else {
                let first = focus_refs(step.get("focus")).into_iter().next();
                let keys = first.map(|r| match refs.keys(step, &r) {
                    RefKeys::Keys(k) => k,
                    _ => Vec::new(),
                });
                union(
                    keys.unwrap_or_default()
                        .iter()
                        .map(|key| t.get(key))
                        .collect::<Vec<_>>()
                        .iter()
                        .map(Option::as_ref),
                )
            };
            let Some(target) = target else { continue };
            let obstacles = t.obstacles();
            let clutter = Clutter { target, mark: None, obstacles: &obstacles, lines: &t.lines };
            let note_raw = step.get("note").and_then(Value::as_str).unwrap_or("");
            let seed = seed_of(&format!("{k}:{}:{note_raw}", step["mark"].as_str().unwrap_or("")));
            let text = plain_text(note_raw).trim().to_string();
            let ink = ink_of(step);
            let note = match &ink {
                Some(i) => Some(format!("{}: {text}", i.label)),
                None => (!text.is_empty()).then_some(text),
            };
            let color = ink.as_ref().map_or(INK, |i| i.color);
            let size = note
                .as_ref()
                .map_or((0.0, 0.0), |n| (hand_width(n, NOTE_FONT) + 8.0, (NOTE_FONT as f64 * 1.25).round()));
            let (sketch, note_box) = if mark == Mark::Arrow {
                let (tail, nb) = place_arrow(size, &clutter, &t.area);
                (arrow_sketch(tail, &target, seed, PEN), Some(nb))
            } else {
                let s = sketch_mark(mark, &target, &t.area, &obstacles, seed, PEN);
                let nb = note.as_ref().map(|_| place_note(mark, size, &s, &clutter, &t.area));
                (s, nb)
            };
            let trace = retrace(&sketch, seed.wrapping_add(1));
            marks.push(PlacedMark {
                step: k,
                trace,
                sketch,
                note: note.zip(note_box),
                color,
                arrow: mark == Mark::Arrow,
                start: seg.mark_from,
                done: seg.voice_from - 1.0,
                clear: segments.get(k + 2).map_or(f64::INFINITY, |s| s.from),
            });
        }
        let ink = plan_ink(scene, steps, segments, refs, &all);
        let first = all.first().cloned().flatten();
        Board { marks, ink, clip: first.and_then(|t| t.clip), targets: all }
    }

    /// Whether the board draws anything at all.
    pub fn is_empty(&self) -> bool {
        self.marks.is_empty() && self.ink.is_empty()
    }

    /// Draws the ink and marks shown at `frame`, in the content box's coordinates. `shift(k)` is how far step k's
    /// boxes have yet to move to where they settle (a code scene's scroll catching up), or None.
    pub fn draw(&self, dl: &mut DisplayList, frame: f64, segments: &[Segment], shift: &dyn Fn(usize) -> Option<Pt>) {
        let ink: Vec<&PlacedInk> =
            self.ink.iter().filter(|p| frame >= p.start && frame < p.clear + INK_CLEAR_FRAMES).collect();
        if !ink.is_empty() {
            let clipped = self.clip.is_some();
            if let Some(c) = self.clip {
                // `clip-path: inset(top 0 bottom 0)`: rows only.
                dl.push_clip(-4000.0, c.y as f32, 9920.0, c.height as f32, 0.0);
            }
            for p in ink {
                let at = shift(p.item.step).or_else(|| self.follow(p, frame, segments));
                self.draw_ink(dl, p, frame, at);
            }
            if clipped {
                dl.pop_clip();
            }
        }
        for m in &self.marks {
            if frame < m.start || frame >= m.clear + CLEAR_FRAMES {
                continue;
            }
            self.draw_mark(dl, m, frame, shift(m.step));
        }
    }

    fn draw_mark(&self, dl: &mut DisplayList, m: &PlacedMark, frame: f64, shift: Option<Pt>) {
        let span = m.done - m.start;
        let (pen_from, pen_to, note_from, note_to) = if m.arrow { (0.3, 1.0, 0.0, 0.4) } else { (0.0, 1.0, 0.5, 1.0) };
        let pen = interpolate(
            frame,
            &[m.start + pen_from * span, m.start + pen_to * span],
            &[0.0, 1.0],
            CLAMP.eased(crate::anim::Easing::OutQuad),
        );
        let written = clamped(frame, m.start + note_from * span, m.start + note_to * span, 0.0, 1.0);
        let opacity =
            if m.clear.is_infinite() { 1.0 } else { clamped(frame, m.clear, m.clear + CLEAR_FRAMES, 1.0, 0.0) };
        dl.group(|dl| {
            dl.fade(opacity as f32);
            if let Some(s) = shift {
                dl.translate(s.x as f32, s.y as f32);
            }
            let progress = progress_of(&m.sketch.strokes, pen);
            draw_strokes(dl, &m.sketch.strokes, &progress, PEN + 6.0, BG.alpha(0.6));
            draw_strokes(dl, &m.sketch.strokes, &progress, PEN, m.color);
            draw_strokes(dl, &m.trace.strokes, &progress, 1.6, m.color.alpha(0.55));
            if let Some((note, b)) = &m.note
                && written > 0.0
            {
                // `clip-path: inset(-12px <unwritten share> -12px -12px)`.
                let w = b.width as f32 * written as f32;
                dl.push_clip(b.x as f32 - 12.0, b.y as f32 - 12.0, w + 12.0, b.height as f32 + 24.0, 0.0);
                hand_text(dl, note, NOTE_FONT, b.x + 4.0, b.y, b.height, m.color);
                dl.pop_clip();
            }
        });
    }

    fn follow(&self, p: &PlacedInk, frame: f64, segments: &[Segment]) -> Option<Pt> {
        let keys: Vec<&String> = p
            .item
            .targets
            .iter()
            .flat_map(|t| if let InkTarget::Keys(k) = t { k.iter().collect() } else { Vec::new() })
            .collect();
        let k = current_step(segments, frame)?;
        if keys.is_empty() || k <= p.item.step {
            return None;
        }
        let box_at = |j: usize| -> Option<Bx> {
            let t = self.targets.get(j)?.as_ref()?;
            if t.shifts {
                return None;
            }
            let boxes: Vec<Option<Bx>> = keys.iter().map(|key| t.get(key)).collect();
            if boxes.iter().all(Option::is_some) { union(boxes.iter().map(Option::as_ref)) } else { None }
        };
        let home = box_at(p.item.step)?;
        let from = home.center();
        let (mut was, mut now) = (Pt { x: 0.0, y: 0.0 }, Pt { x: 0.0, y: 0.0 });
        for j in p.item.step + 1..=k {
            was = now;
            if let Some(b) = box_at(j) {
                now = Pt { x: b.center().x - from.x, y: b.center().y - from.y };
            }
        }
        let t = step_move(frame, segments[k + 1].from);
        let at = Pt { x: was.x + (now.x - was.x) * t, y: was.y + (now.y - was.y) * t };
        (at.x.abs() >= 0.01 || at.y.abs() >= 0.01).then_some(at)
    }

    fn draw_ink(&self, dl: &mut DisplayList, p: &PlacedInk, frame: f64, shift: Option<Pt>) {
        let total = 8f64.max(p.stroke_frames + p.text_frames);
        let t = ((frame - p.start) / total).clamp(0.0, 1.0);
        let share = p.stroke_frames
            / if p.stroke_frames + p.text_frames == 0.0 { 1.0 } else { p.stroke_frames + p.text_frames };
        let (pen_from, pen_to, text_from, text_to) =
            if p.text_first { (1.0 - share, 1.0, 0.0, 1.0 - share) } else { (0.0, share, share, 1.0) };
        let pen = interpolate(
            t,
            &[pen_from, (pen_from + 1e-6).max(pen_to)],
            &[0.0, 1.0],
            CLAMP.eased(crate::anim::Easing::OutPow(1.6)),
        );
        let written = clamped(t, text_from, (text_from + 1e-6).max(text_to), 0.0, 1.0);
        let opacity =
            if p.clear.is_infinite() { 1.0 } else { clamped(frame, p.clear, p.clear + INK_CLEAR_FRAMES, 1.0, 0.0) };
        dl.group(|dl| {
            dl.fade(opacity as f32);
            if let Some(s) = shift {
                dl.translate(s.x as f32, s.y as f32);
            }
            if let Some(sk) = &p.sketch {
                let progress = progress_of(&sk.strokes, pen);
                draw_strokes(dl, &sk.strokes, &progress, PEN + 6.0, BG.alpha(0.6));
                draw_strokes(dl, &sk.strokes, &progress, PEN, p.color);
                if pen > 0.0
                    && pen < 1.0
                    && let Some(tip) = point_along(&sk.strokes, pen)
                {
                    tip_dot(dl, tip, p.color);
                }
            }
            if let Some(text) = &p.text
                && written > 0.0
            {
                writing(dl, text, written, p.color);
            }
        });
    }
}

/// A pen's tip where it is drawing: a 7px dot with a glow.
fn tip_dot(dl: &mut DisplayList, at: Pt, color: Color) {
    dl.rect(
        at.x as f32 - 3.5,
        at.y as f32 - 3.5,
        7.0,
        7.0,
        crate::display::BoxStyle::fill(color).radius(4.0).shadow(crate::display::Shadow::new(0.0, 0.0, 8.0, color)),
    );
}

/// Handwriting in the board's colour with the dark halo that keeps it readable over anything.
fn hand_text(dl: &mut DisplayList, text: &str, size: f32, x: f64, top: f64, line_h: f64, color: Color) {
    let st = Style::new(Face::Hand, 600.0, size);
    let run = shape(text, st);
    let base = top as f32 + crate::text::baseline_in(Face::Hand, size, line_h as f32);
    for blur in [14.0, 8.0, 3.0] {
        dl.run_glow(run.clone(), x as f32, base, Color::TRANSPARENT, (blur, BG));
    }
    dl.run(run, x as f32, base, color);
}

/// Handwriting revealed left to right at writing speed, line by line, with the pen's tip at its edge.
fn writing(dl: &mut DisplayList, text: &InkText, written: f64, color: Color) {
    let line_h = (text.size as f64 * 1.2).round();
    let lengths: Vec<f64> = text.lines.iter().map(|l| (l.encode_utf16().count().max(1)) as f64).collect();
    let total: f64 = lengths.iter().sum();
    let mut before = 0.0;
    for (i, line) in text.lines.iter().enumerate() {
        let share = lengths[i] / total;
        let raw = (written - before) / share;
        let p = if raw > 0.995 { 1.0 } else { raw.max(0.0) };
        before += share;
        if p <= 0.0 {
            continue;
        }
        let w = hand_width(line, text.size) + 10.0;
        let edge = p * w;
        let (x, y) = (text.bx.x, text.bx.y + i as f64 * line_h);
        if p < 1.0 {
            // The mask fades from opaque at edge - 8 to clear at edge + 4: clip at its middle.
            dl.push_clip(x as f32 - 40.0, y as f32 - 20.0, (edge - 2.0) as f32 + 40.0, line_h as f32 + 40.0, 0.0);
        }
        hand_text(dl, line, text.size, x + 5.0, y, line_h, color);
        if p < 1.0 {
            dl.pop_clip();
            tip_dot(dl, Pt { x: x + edge, y: y + line_h * 0.5 + (edge / 9.0).sin() * text.size as f64 * 0.18 }, color);
        }
    }
}

/// How far each stroke is drawn when the pen is `pen` of the way through all of them.
fn progress_of(strokes: &[Stroke], pen: f64) -> Vec<f64> {
    let lengths: Vec<f64> = strokes.iter().map(stroke_length).collect();
    let total: f64 = lengths.iter().sum();
    let total = if total == 0.0 { 1.0 } else { total };
    let mut before = 0.0;
    lengths
        .iter()
        .map(|l| {
            let v = ((pen - before / total) / (l / total)).clamp(0.0, 1.0);
            before += l;
            if v.is_nan() { 0.0 } else { v }
        })
        .collect()
}

/// Draws each stroke as far as its progress, round-capped, as an SVG path with `pathLength=1` and a dash offset.
fn draw_strokes(dl: &mut DisplayList, strokes: &[Stroke], progress: &[f64], width: f64, color: Color) {
    for (s, &p) in strokes.iter().zip(progress) {
        if p <= 0.0 {
            continue;
        }
        let segs = stroke_segments(s);
        if segs.is_empty() {
            continue;
        }
        let mut pb = PathBuilder::new();
        pb.move_to(segs[0][0].x as f32, segs[0][0].y as f32);
        let mut len = 0.0;
        for c in &segs {
            pb.cubic_to(c[1].x as f32, c[1].y as f32, c[2].x as f32, c[2].y as f32, c[3].x as f32, c[3].y as f32);
            len += cubic_length(c);
        }
        let Some(path) = pb.finish() else { continue };
        let mut st = LineStroke::solid(color, width as f32).rounded();
        if p < 1.0 {
            st.dash = Some(((len * p).max(0.01) as f32, (len * 2.0) as f32));
        }
        dl.path(path, None, Some(st));
    }
}

fn cubic_length(c: &[Pt; 4]) -> f64 {
    let at = |t: f64| {
        let u = 1.0 - t;
        Pt {
            x: u * u * u * c[0].x + 3.0 * u * u * t * c[1].x + 3.0 * u * t * t * c[2].x + t * t * t * c[3].x,
            y: u * u * u * c[0].y + 3.0 * u * u * t * c[1].y + 3.0 * u * t * t * c[2].y + t * t * t * c[3].y,
        }
    };
    let mut len = 0.0;
    let mut prev = c[0];
    for i in 1..=16 {
        let p = at(i as f64 / 16.0);
        len += (p.x - prev.x).hypot(p.y - prev.y);
        prev = p;
    }
    len
}

/// The same strokes traced again a pixel or so off, as a pen that goes over its line twice (`retrace`).
fn retrace(sketch: &Sketch, seed: u32) -> Sketch {
    let mut rand = Random::new(seed);
    Sketch {
        strokes: sketch
            .strokes
            .iter()
            .map(|s| Stroke {
                points: s
                    .points
                    .iter()
                    .map(|p| {
                        let x = p.x + (rand.next() - 0.5) * 2.4;
                        let y = p.y + (rand.next() - 0.5) * 2.4;
                        Pt { x, y }
                    })
                    .collect(),
                sharp: s.sharp,
            })
            .collect(),
        bounds: sketch.bounds,
    }
}

/// The point `share` of the way along a sketch's strokes (`pointAlong`).
fn point_along(strokes: &[Stroke], share: f64) -> Option<Pt> {
    let lengths: Vec<f64> = strokes.iter().map(stroke_length).collect();
    let mut left = share * lengths.iter().sum::<f64>();
    for (i, s) in strokes.iter().enumerate() {
        if left > lengths[i] {
            left -= lengths[i];
            continue;
        }
        for w in s.points.windows(2) {
            let (a, b) = (w[0], w[1]);
            let seg = (b.x - a.x).hypot(b.y - a.y);
            if left <= seg {
                let d = if seg == 0.0 { 1.0 } else { seg };
                return Some(Pt { x: a.x + (b.x - a.x) * left / d, y: a.y + (b.y - a.y) * left / d });
            }
            left -= seg;
        }
    }
    None
}

fn text_block(text: &str, size: f32) -> (Vec<String>, f64, f64) {
    let lines: Vec<String> = plain_text(text).split('\n').map(str::to_string).collect();
    let w = lines.iter().map(|l| hand_width(l, size)).fold(f64::NEG_INFINITY, f64::max) + 10.0;
    let h = (size as f64 * 1.2).round() * lines.len() as f64;
    (lines, w, h)
}

/// `planInk`: lays out and times every item of the board, each clear of the scene from its step on and of the ink up.
fn plan_ink(
    scene: &Value,
    steps: &[Value],
    segments: &[Segment],
    refs: &StepRefs,
    all: &[Option<MarkTargets>],
) -> Vec<PlacedInk> {
    let items = ink_board(scene, refs);
    let mut placed: Vec<PlacedInk> = Vec::new();
    let mut cursors: HashMap<usize, f64> = HashMap::new();
    for it in items {
        let (Some(segment), Some(Some(t))) = (segments.get(it.step + 1), all.get(it.step)) else { continue };
        let step_start = segment.from;
        let live: Vec<usize> = (0..placed.len()).filter(|&i| placed[i].clear > step_start).collect();
        let box_of = |target: &InkTarget| -> Option<Bx> {
            match target {
                InkTarget::Ink(id) => live
                    .iter()
                    .rev()
                    .map(|&i| &placed[i])
                    .find(|p| p.item.id.as_deref() == Some(id))
                    .map(|p| p.text.as_ref().map_or(p.bounds, |t| t.bx)),
                InkTarget::Point(x, y) => {
                    Some(Bx::new(t.area.x + x * t.area.width, t.area.y + y * t.area.height, 0.0, 0.0).grow(4.0))
                }
                InkTarget::Keys(keys) => {
                    let bs: Vec<Option<Bx>> = keys.iter().map(|k| t.get(k)).collect();
                    union(bs.iter().map(Option::as_ref))
                }
            }
        };
        let shown: Vec<&MarkTargets> = if t.shifts {
            vec![t]
        } else {
            (it.step..steps.len()).filter_map(|j| all.get(j).and_then(Option::as_ref)).collect()
        };
        let mut obstacles: Vec<Bx> = shown.iter().flat_map(|tj| tj.obstacles()).collect();
        for &i in &live {
            obstacles.push(placed[i].bounds);
            if let Some(tx) = &placed[i].text {
                obstacles.push(tx.bx);
            }
        }
        let item = &it.item;
        let seed = seed_of(&format!("{}:{}:{}", it.step, it.index, js_json(item)));
        let color = item.get("tone").and_then(Value::as_str).map_or(INK, |t| theme::tone(t).0);
        let size = if it.verb == "write" { WRITE_FONT } else { INK_NOTE_FONT };
        let words = item.get("write").or_else(|| item.get("note")).and_then(Value::as_str);
        let block = words.map(|w| text_block(w, size));
        let bsize = block.as_ref().map_or((0.0, 0.0), |b| (b.1, b.2));
        let side = item.get("side").and_then(Value::as_str).and_then(InkSide::parse);
        let mut sketch: Option<Sketch> = None;
        let mut bx: Option<Bx> = None;
        let mut text_first = false;
        match it.verb {
            "arrow" => {
                let (Some(source), Some(target)) = (box_of(&it.targets[0]), box_of(&it.targets[1])) else { continue };
                let from_point = matches!(it.targets[0], InkTarget::Point(..));
                let tail = if from_point { source.center() } else { edge_toward(&source, target.center()) };
                let s =
                    link_sketch(if from_point { None } else { Some(&source) }, tail, &target, &obstacles, seed, PEN);
                if block.is_some() {
                    let bulge = shaft_bulge(&s);
                    let ends = &s.strokes[0].points;
                    let out = Pt {
                        x: bulge.x - (ends[0].x + ends[ends.len() - 1].x) / 2.0,
                        y: bulge.y - (ends[0].y + ends[ends.len() - 1].y) / 2.0,
                    };
                    let outward = if out.y.abs() >= out.x.abs() {
                        if out.y > 0.0 { TextSide::Below } else { TextSide::Above }
                    } else if out.x > 0.0 {
                        TextSide::Right
                    } else {
                        TextSide::Left
                    };
                    let dot = Bx::new(bulge.x, bulge.y, 0.0, 0.0).grow(8.0);
                    let mut sides = vec![outward];
                    sides.extend(
                        [TextSide::Right, TextSide::Left, TextSide::Above, TextSide::Below]
                            .into_iter()
                            .filter(|s| *s != outward),
                    );
                    let mut obs = obstacles.clone();
                    obs.push(source);
                    obs.push(target);
                    bx = Some(place_text(&dot, &dot, bsize, &obs, &t.area, &sides).0);
                }
                sketch = Some(s);
            }
            "brace" => {
                let bs: Vec<Option<Bx>> = it.targets.iter().map(box_of).collect();
                let Some(span) = union(bs.iter().map(Option::as_ref)) else { continue };
                let side = side.unwrap_or(if span.width >= span.height { InkSide::Below } else { InkSide::Right });
                let target = clear_of(&span, side, &obstacles);
                let s = brace_sketch(&target, side, seed, PEN);
                if block.is_some() {
                    bx = Some(
                        place_text(
                            &target.grow(BRACE_REACH - 12.0),
                            &target,
                            bsize,
                            &obstacles,
                            &t.area,
                            &side_only(side),
                        )
                        .0,
                    );
                }
                sketch = Some(s);
            }
            "write" => {
                if let Some(at) = item.get("at").and_then(Value::as_array) {
                    let (x, y) = (at[0].as_f64().unwrap_or(0.0), at[1].as_f64().unwrap_or(0.0));
                    bx = Some(keep_in(
                        Bx::new(t.area.x + x * t.area.width, t.area.y + y * t.area.height, bsize.0, bsize.1),
                        &t.area,
                    ));
                } else {
                    let Some(target) = it.targets.first().and_then(box_of) else { continue };
                    if let Some(side) = side {
                        bx = Some(beside_clear(&target, side, bsize, 16.0, &obstacles, &t.area));
                    } else {
                        let g = target.grow(6.0);
                        let (near, crowded) = place_text(&g, &target, bsize, &obstacles, &t.area, &TEXT_SIDES);
                        let end = if crowded { row_end(&g, bsize, &obstacles, &t.area) } else { None };
                        bx = Some(end.unwrap_or(near));
                        if crowded && end.is_none() {
                            let (b, strokes) = leader(&g, bsize, &obstacles, &t.area, seed, PEN);
                            bx = Some(b);
                            let bounds = strokes_bounds(&strokes);
                            sketch = Some(Sketch { strokes, bounds });
                        }
                    }
                }
                text_first = true;
            }
            verb => {
                let bs: Vec<Option<Bx>> = it.targets.iter().map(box_of).collect();
                let Some(target) = union(bs.iter().map(Option::as_ref)) else { continue };
                let mut s = if verb == "tick" {
                    tick_sketch(&target, seed, PEN)
                } else {
                    sketch_mark(Mark::parse(verb).unwrap_or(Mark::Circle), &target, &t.area, &obstacles, seed, PEN)
                };
                if block.is_some() {
                    let sides: Vec<TextSide> = match side {
                        Some(sd) => side_only(sd).to_vec(),
                        None if verb == "underline" => UNDER_FIRST.to_vec(),
                        None => TEXT_SIDES.to_vec(),
                    };
                    let (near, crowded) = place_text(&s.bounds, &target, bsize, &obstacles, &t.area, &sides);
                    let end =
                        if crowded && side.is_none() { row_end(&s.bounds, bsize, &obstacles, &t.area) } else { None };
                    bx = Some(end.unwrap_or(near));
                    if crowded && side.is_none() && end.is_none() {
                        let (b, strokes) = leader(&s.bounds, bsize, &obstacles, &t.area, seed, PEN);
                        bx = Some(b);
                        s.strokes.extend(strokes);
                    }
                }
                sketch = Some(s);
            }
        }
        let total_len: f64 = sketch.as_ref().map_or(0.0, |s| s.strokes.iter().map(stroke_length).sum());
        let stroke_frames = total_len / if it.verb == "arrow" { ARROW_PX_PER_FRAME } else { STROKE_PX_PER_FRAME };
        let text_frames = block.as_ref().map_or(0.0, |b| b.0.concat().encode_utf16().count() as f64 * FRAMES_PER_CHAR);
        let pen_first = steps[it.step].get("mark").is_some_and(|v| !v.is_null() && v != "")
            || steps[it.step].get("flag").is_some_and(|v| !v.is_null() && v != "");
        let cursor =
            cursors.get(&it.step).copied().unwrap_or(if pen_first { segment.voice_from } else { segment.mark_from });
        let start = item.get("when").and_then(Value::as_str).and_then(|w| cue_frame(segment, w)).unwrap_or(cursor);
        cursors.insert(it.step, cursor.max(start + 8f64.max(stroke_frames + text_frames) + ITEM_GAP));
        let clear = it.until.and_then(|u| segments.get(u + 1)).map_or(f64::INFINITY, |s| s.from);
        let text = block.zip(bx).map(|(b, bx)| InkText { lines: b.0, bx, size });
        let bounds = sketch.as_ref().map(|s| s.bounds).or(bx).unwrap_or(Bx::new(0.0, 0.0, 0.0, 0.0));
        placed.push(PlacedInk {
            item: it,
            sketch,
            text,
            text_first,
            color,
            start,
            stroke_frames,
            text_frames,
            clear,
            bounds,
        });
    }
    placed
}

fn strokes_bounds(strokes: &[Stroke]) -> Bx {
    let pts: Vec<Bx> = strokes.iter().flat_map(|s| s.points.iter().map(|p| Bx::new(p.x, p.y, 0.0, 0.0))).collect();
    union(pts.iter().map(Some)).unwrap_or(Bx::new(0.0, 0.0, 0.0, 0.0))
}

/// A scene's pen marks, ink and camera, laid out once from the boxes it gives each step: what most scenes need
/// (see engine/README.md, "Pen marks, ink and the camera").
pub struct Pen {
    targets: Vec<MarkTargets>,
    /// One set of targets serves every step: the scene does not move between steps.
    same: bool,
    board: Board,
    camera: crate::camera::Camera,
}

impl Pen {
    /// `targets` holds each step's targets, or one set for every step when `same`; `area` is the content box the
    /// camera frames (`headerBox`).
    pub fn new(
        scene: &Value,
        segments: &[Segment],
        refs: &dyn Refs,
        targets: Vec<MarkTargets>,
        same: bool,
        area: (f64, f64),
    ) -> Pen {
        let step_refs = StepRefs::Scene(refs);
        let of = |k: usize| if same { targets.first().cloned() } else { targets.get(k).cloned() };
        let board = Board::new(scene, segments, &step_refs, &of, &|_| None);
        let camera = crate::camera::Camera::new(scene, &step_refs, area);
        Pen { targets, same, board, camera }
    }

    fn target(&self, k: usize) -> Option<MarkTargets> {
        if self.same { self.targets.first().cloned() } else { self.targets.get(k).cloned() }
    }

    /// Draws `content` (in content-box coordinates) through the camera, with the marks and ink over it.
    pub fn draw(&self, dl: &mut DisplayList, frame: f64, segments: &[Segment], content: impl FnOnce(&mut DisplayList)) {
        self.draw_shifted(dl, frame, segments, &|_| None, content);
    }

    /// `draw` for a scene that scrolls: `shift(k)` is how far step k's boxes have yet to move to where they settle.
    pub fn draw_shifted(
        &self,
        dl: &mut DisplayList,
        frame: f64,
        segments: &[Segment],
        shift: &dyn Fn(usize) -> Option<Pt>,
        content: impl FnOnce(&mut DisplayList),
    ) {
        let view = self.camera.view(frame, segments, &|k| self.target(k));
        self.camera.draw(dl, view, |dl| {
            dl.group(content);
            self.board.draw(dl, frame, segments, shift);
        });
    }
}
