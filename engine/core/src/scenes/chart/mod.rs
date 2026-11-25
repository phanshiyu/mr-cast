//! The chart scene: bar, line, horizontal bar, stacked, pie and donut charts, with steps that set values, sort and
//! light labels, series or values. A port of src/components/Chart.tsx, ChartShapes.tsx and the layout in
//! src/utils/chartLayout.ts, chartShapes.ts and chartTargets.ts.
//!
//! Not ported yet (see engine/README.md): pen marks, ink and the camera.

// The layout code indexes parallel series, label and place arrays as the TSX does.
#![allow(clippy::needless_range_loop)]

mod column;
mod layout;
mod pie;
mod rows;
mod targets;

use super::{Frame, SceneInput, SceneView, parse};
use crate::camera::Camera;
use crate::chrome::callout::HeaderCallout;
use crate::chrome::fittext::{TextOpts, draw_fit, drawn_width};
use crate::chrome::shell::{Aside, Shell};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList};
use crate::marks::{Board, MarkTargets, StepRefs};
use crate::states::{BoundModel, FnModel as Model, SceneState, SetEntry, StateFrame, items as list, walk_states};
use crate::steps::Emphasis;
use crate::steps::FocusSpotlight as Focus;
use crate::text::{Face, Style, baseline_in, line_metrics, shape};
use crate::textfit::Fit;
use crate::theme::{self, BG, TEXT};
use crate::timing::js_round;
use layout::{ChartState, chart_state_of};
use serde::Deserialize;
use serde_json::Value;

fn line() -> String {
    "line".into()
}

pub type Vals = Vec<Vec<f64>>;

#[derive(Deserialize, Clone)]
pub struct Series {
    pub name: String,
    pub values: Vec<f64>,
    pub tone: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct Annotation {
    pub at: String,
    pub series: Option<String>,
    pub text: String,
}

#[derive(Deserialize, Clone)]
pub struct ChartScene {
    #[serde(default = "line")]
    pub kind: String,
    pub title: Option<String>,
    pub unit: Option<String>,
    pub prefix: Option<String>,
    pub labels: Vec<String>,
    pub series: Vec<Series>,
    #[serde(default)]
    pub horizontal: bool,
    #[serde(default)]
    pub stacked: bool,
    #[serde(default)]
    pub sort: bool,
    pub badges: Option<bool>,
    pub better: Option<String>,
    pub annotation: Option<Annotation>,
}

// --- The scene's state model (shared/state-steps.mjs MODELS.chart, shared/targets.mjs TARGETS.chart). ---

fn initial(scene: &Value) -> SceneState {
    let mut st = SceneState::default();
    for (s, series) in list(scene.get("series")).iter().enumerate() {
        for (l, v) in list(series.get("values")).iter().enumerate() {
            st.values.insert(format!("p:{s}/{l}"), v.clone());
        }
    }
    st.sort = Some(scene.get("sort").and_then(Value::as_bool) == Some(true));
    st
}

fn names<'a>(scene: &'a Value, field: &str, key: &str) -> Vec<&'a str> {
    list(scene.get(field))
        .iter()
        .map(|s| if key.is_empty() { s.as_str() } else { s.get(key).and_then(Value::as_str) }.unwrap_or("\u{0}"))
        .collect()
}

pub fn resolve(scene: &Value, r: &Value) -> Option<Vec<String>> {
    let labels = names(scene, "labels", "");
    let series = names(scene, "series", "name");
    let r = r.as_str()?;
    if let Some(l) = labels.iter().position(|x| *x == r) {
        return Some(vec![format!("l:{l}")]);
    }
    if let Some(rest) = r.strip_prefix("series:") {
        return series.iter().position(|x| *x == rest.trim()).map(|s| vec![format!("s:{s}")]);
    }
    for (at, _) in r.match_indices('@') {
        if at == 0 {
            continue;
        }
        let (s, l) = (series.iter().position(|x| *x == &r[..at]), labels.iter().position(|x| *x == &r[at + 1..]));
        if let (Some(s), Some(l)) = (s, l) {
            return Some(vec![format!("p:{s}/{l}")]);
        }
    }
    None
}

/// A value a step sets: a finite number, and not below 0 unless the chart is a line chart.
fn value_ok(scene: &Value, v: &Value) -> bool {
    match v.as_f64() {
        Some(n) if n.is_finite() => !(n < 0.0 && scene.get("kind").and_then(Value::as_str) != Some("line")),
        _ => false,
    }
}

fn set(scene: &Value, r: &str, value: &Value) -> Option<Vec<SetEntry>> {
    let series = names(scene, "series", "name");
    let labels = list(scene.get("labels"));
    let entries: Vec<SetEntry> = if let Some(s) = series.iter().position(|x| *x == r) {
        let arr = value.as_array().filter(|a| a.len() == labels.len())?;
        arr.iter().enumerate().map(|(l, v)| (format!("p:{s}/{l}"), v.clone())).collect()
    } else {
        let keys = crate::targets::with_fallback(&Value::String(r.to_string()), |r| resolve(scene, r))?;
        match keys.as_slice() {
            [k] if k.starts_with("p:") && !value.is_array() => vec![(k.clone(), value.clone())],
            _ => return None,
        }
    };
    entries.iter().all(|(_, v)| value_ok(scene, v)).then_some(entries)
}

fn sortable(scene: &Value) -> bool {
    matches!(scene.get("kind").and_then(Value::as_str), Some("bar" | "pie" | "donut"))
}

static MODEL: Model = Model { initial, resolve, set, show: None, tint: None, sortable, trace: None };

// --- Colours. ---

/// A series' own tone, or the default (`seriesTone`).
pub fn series_tone(series: &[Series], index: usize) -> &str {
    if let Some(t) = &series[index].tone {
        return t;
    }
    if series.len() == 2 {
        return if index == 0 { "neutral" } else { "accent" };
    }
    ["accent", "good", "warn", "bad", "neutral"][index % 5]
}

pub fn tone_color(name: &str) -> Color {
    theme::tone(name).0
}

/// Distinct colours for the slices of a pie or the rows of a one-series horizontal chart (`sliceColor`).
pub fn slice_color(index: usize) -> Color {
    [
        theme::ACCENT,
        theme::ADD,
        Color::css("#fbbf24"),
        theme::DEL,
        Color::css("#5ec8f2"),
        Color::css("#c084fc"),
        Color::css("#ff9f43"),
        Color::css("#8f98ad"),
    ][index % 8]
}

pub use crate::color::hex_alpha;

pub fn label_color() -> Color {
    Color::css("#c9cedb")
}

/// The scene's content box as the layout code assumes it (`headerBox`).
fn header_box(scene: &Value, shell: &Shell, has_callout: bool) -> (f64, f64) {
    let (w, h) = theme::content_box(shell.title.is_some() || has_callout);
    match &shell.title {
        Some(t) => (w, h - (t.lines.len() as f64 - 1.0) * js_round(t.size * t.line_height)),
        None => {
            let _ = scene;
            (w, h)
        }
    }
}

/// Draws `text` at the left edge `x` with a line box `lh` tall whose top is `top`.
pub fn put_text(dl: &mut DisplayList, text: &str, style: Style, x: f32, top: f32, lh: f32, color: Color) -> f32 {
    dl.text(text, style, x, top + baseline_in(style.face, style.size, lh), color)
}

/// A mono line centred horizontally on `cx`, as `translateX(-50%)` places it.
#[allow(clippy::too_many_arguments)]
pub fn centred_text(
    dl: &mut DisplayList,
    text: &str,
    style: Style,
    cx: f32,
    top: f32,
    lh: f32,
    color: Color,
    halo: bool,
) {
    let run = shape(text, style);
    let x = cx - run.width / 2.0;
    let base = top + baseline_in(style.face, style.size, lh);
    if halo {
        dl.run_glow(run, x, base, color, (6.0, BG));
    } else {
        dl.run(run, x, base, color);
    }
}

/// How lit one value is through its label, its series or itself (`emphasisOf` of ChartShapes.tsx).
pub fn value_emphasis(focus: &Focus, s: usize, i: usize) -> Emphasis {
    let own = crate::steps::brighter(focus.emphasis(&format!("s:{s}")), focus.emphasis(&format!("p:{s}/{i}")));
    let label = focus.emphasis(&format!("l:{i}"));
    Emphasis { glow: own.glow.max(label.glow), opacity: own.opacity.max(label.opacity), ..own }
}

enum Body {
    Column(column::Column),
    Rows(rows::Rows),
    Pie(pie::Pie),
}

struct ChartView {
    shell: Shell,
    scene: ChartScene,
    raw: Value,
    states: Vec<SceneState>,
    cstates: Vec<ChartState>,
    callout: Option<HeaderCallout>,
    box_w: f64,
    box_h: f64,
    body: Body,
    marks: Vec<MarkTargets>,
    board: Board,
    camera: Camera,
}

/// What the body draws with at one frame.
pub struct Ctx<'a> {
    pub frame: f64,
    pub sf: StateFrame<'a>,
    pub before: &'a ChartState,
    pub now: &'a ChartState,
    pub focus: Focus<'a>,
    pub segments: &'a [crate::timing::Segment],
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: ChartScene = parse(input)?;
    if scene.labels.is_empty() || scene.series.is_empty() {
        return Err("a chart without labels or series".into());
    }
    if scene.series.iter().any(|s| s.values.len() != scene.labels.len()) {
        return Err("a series with a value count that is not the label count".into());
    }
    let shell = Shell::new(input.scene);
    let callout = HeaderCallout::new(input.scene);
    let (box_w, box_h) = header_box(input.scene, &shell, callout.is_some());
    let states = walk_states(&BoundModel { model: &MODEL, scene: input.scene }, input.scene);
    let cstates: Vec<ChartState> = states.iter().map(|s| chart_state_of(&scene, s)).collect();
    let pie = matches!(scene.kind.as_str(), "pie" | "donut");
    let body = if pie {
        Body::Pie(pie::Pie::new(&scene, box_w, box_h, &cstates))
    } else if scene.horizontal {
        Body::Rows(rows::Rows::new(&scene, box_w, box_h, &cstates))
    } else {
        Body::Column(column::Column::new(&scene, box_w, box_h, &cstates))
    };
    let marks = targets::step_targets(&scene, &body, &cstates[1..], (box_w, box_h));
    let refs = crate::scenes::refs::SceneRefs(input.scene);
    let step_refs = StepRefs::Scene(&refs);
    let board = Board::new(input.scene, input.segments, &step_refs, &|k| marks.get(k).cloned(), &|_| None);
    let camera = Camera::new(input.scene, &step_refs, (box_w, box_h));
    Ok(Box::new(ChartView {
        shell,
        raw: input.scene.clone(),
        scene,
        states,
        cstates,
        callout,
        box_w,
        box_h,
        body,
        marks,
        board,
        camera,
    }))
}

/// A legend: the series names with their colours (`Legend` of ChartShapes.tsx).
pub struct Legend {
    width: f32,
    /// Height of the row of items, without the padding under it.
    row: f32,
}

const LEGEND_GAP: f32 = 26.0;

impl Legend {
    fn new(fits: &[Fit]) -> Legend {
        let item_h = |f: &Fit| line_metrics(Face::Sans, f.size as f32).normal;
        let items: f32 = fits.iter().map(|f| 22.0 + 10.0 + drawn_width(f, &f.lines[0], None)).sum();
        Legend {
            width: items + LEGEND_GAP * (fits.len() as f32 - 1.0),
            row: fits.iter().map(item_h).fold(22.0, f32::max),
        }
    }

    fn height(&self) -> f32 {
        self.row + 6.0
    }

    fn draw(
        &self,
        dl: &mut DisplayList,
        scene: &ChartScene,
        fits: &[Fit],
        x: f32,
        top: f32,
        opacity: &dyn Fn(usize) -> f64,
    ) {
        let mut x = x;
        for (i, fit) in fits.iter().enumerate() {
            let color = tone_color(series_tone(&scene.series, i));
            let w = 22.0 + 10.0 + drawn_width(fit, &fit.lines[0], None);
            dl.group(|dl| {
                dl.fade(opacity(i) as f32);
                let mid = top + self.row / 2.0;
                if scene.kind == "bar" {
                    dl.rect(x, mid - 11.0, 22.0, 22.0, BoxStyle::fill(color).radius(6.0));
                } else {
                    dl.rect(x, mid - 2.5, 22.0, 5.0, BoxStyle::fill(color).radius(3.0));
                }
                let lh = line_metrics(Face::Sans, fit.size as f32).normal;
                draw_fit(dl, fit, x + 32.0, mid - lh / 2.0, TextOpts::new(TEXT).normal());
            });
            x += w + LEGEND_GAP;
        }
    }
}

impl SceneView for ChartView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let sf = StateFrame::at(&self.states, f.segments, frame);
        let idx = |s: &SceneState| self.states.iter().position(|x| std::ptr::eq(x, s)).unwrap_or(0);
        let (before, now) = (&self.cstates[idx(sf.before)], &self.cstates[idx(sf.now)]);
        let ctx = Ctx {
            frame,
            before,
            now,
            focus: Focus::new(crate::scenes::refs::target_steps(&self.raw), f.segments, frame),
            segments: f.segments,
            sf,
        };
        let legend = match &self.body {
            Body::Column(c) => Some((Legend::new(&c.layout.legend), &c.layout.legend)),
            Body::Rows(r) if self.scene.series.len() > 1 => Some((Legend::new(&r.layout.legend), &r.layout.legend)),
            _ => None,
        };
        let series_opacity = |s: usize| -> f64 {
            (0..self.scene.labels.len())
                .map(|i| value_emphasis(&ctx.focus, s, i).opacity)
                .fold(f64::NEG_INFINITY, f64::max)
        };
        let height =
            legend.as_ref().map_or(0.0, |(l, _)| l.height()).max(self.callout.as_ref().map_or(0.0, |c| c.height));
        let has_aside = legend.is_some() || self.callout.is_some();
        let draw_aside = |dl: &mut DisplayList, right: f32, top: f32| {
            let mut right = right;
            if let Some(c) = &self.callout {
                c.draw(dl, right, top + height - c.height, &ctx.sf);
                right -= c.width + 32.0;
            }
            if let Some((l, fits)) = &legend {
                l.draw(dl, &self.scene, fits, right - l.width, top + height - l.height(), &series_opacity);
            }
        };
        let aside = has_aside.then_some(Aside { height, draw: &draw_aside });
        let view = self.camera.view(frame, f.segments, &|k| self.marks.get(k).cloned());
        self.shell.draw(dl, frame, f.duration, aside, |dl, _bx| {
            self.camera.draw(dl, view, |dl| {
                dl.group(|dl| match &self.body {
                    Body::Column(c) => c.draw(dl, &self.scene, &ctx, self.box_w as f32, self.box_h as f32),
                    Body::Rows(r) => r.draw(dl, &self.scene, &ctx, self.box_w as f32),
                    Body::Pie(p) => p.draw(dl, &self.scene, &ctx, self.box_w as f32),
                });
                self.board.draw(dl, frame, f.segments, &|_| None);
            })
        });
    }
}
