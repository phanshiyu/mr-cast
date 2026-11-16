//! The table scene: a port of src/components/DataTable.tsx and src/utils/tableLayout.ts. Rows land one after
//! another, steps show, hide, set and tint cells, and focus lights rows, columns and cells.

pub mod layout;
pub mod view;

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, interpolate};
use crate::camera::Camera;
use crate::chrome::callout::HeaderCallout;
use crate::chrome::shell::{Aside, Shell};
use crate::color::hex_alpha;
use crate::display::{BoxStyle, DisplayList};
use crate::marks::{Board, MarkTargets, Stage, StepRefs};
use crate::states::{
    self as state, BoundModel, FnModel as Model, SceneState, SetEntry, StateFrame, items as list, walk_states,
};
use crate::steps::{Emphasis, Spotlight, spotlight_starts};
use crate::steps::{FocusSpotlight as Focus, brighter};
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::theme::MUTED;
use crate::timing::build_frames;
use layout::{Change, Layout};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use view::{TableDraw, change_tone, draw_table};

const START: f64 = 10.0;
/// Every row has started landing by this frame, so all have landed by the end of the build.
const ROWS_END: f64 = 26.0;

#[derive(Deserialize)]
struct TableScene {
    columns: Vec<String>,
    #[serde(default)]
    highlight: Vec<usize>,
    #[serde(default)]
    steps: Vec<Value>,
}

// --- The state model (shared/state-steps.mjs `table`, shared/targets.mjs `table`). ---

fn initial(scene: &Value) -> SceneState {
    let columns = list(scene.get("columns"));
    let mut s = SceneState::default();
    for (i, r) in list(scene.get("rows")).iter().enumerate() {
        for c in 0..columns.len() {
            let cell = list(r.get("cells")).get(c).cloned().unwrap_or(Value::String(String::new()));
            s.values.insert(format!("x:{i}/{c}"), cell);
        }
        if r.get("hidden") == Some(&Value::Bool(true)) {
            s.hidden.insert(format!("r:{i}"));
        }
    }
    s
}

pub fn resolve(scene: &Value, r: &Value) -> Option<Vec<String>> {
    let columns = list(scene.get("columns"));
    let rows = list(scene.get("rows")).len();
    if let Some(i) = crate::targets::index_ref(r, rows) {
        return Some(vec![format!("r:{i}")]);
    }
    let r = r.as_str()?;
    let col_of = |name: &str| columns.iter().position(|c| c.as_str() == Some(name.trim()));
    if let Some(name) = r.strip_prefix("col:") {
        return col_of(name).map(|c| vec![format!("c:{c}")]);
    }
    let at = r.rfind('@').filter(|&a| a > 0)?;
    let col = col_of(&r[..at])?;
    let digits = r[at + 1..].trim();
    let row: f64 = digits.parse().ok().filter(|_| !digits.is_empty())?;
    (row.fract() == 0.0 && row >= 0.0 && (row as usize) < rows).then(|| vec![format!("x:{}/{col}", row as usize)])
}

fn set(scene: &Value, r: &str, value: &Value) -> Option<Vec<SetEntry>> {
    let key = state::one_key(&BoundModel { model: &MODEL, scene }, &Value::String(r.into()), &["x:"])?;
    (value.is_string() || state::is_change(value)).then(|| vec![(key, value.clone())])
}

static MODEL: Model =
    Model { initial, resolve, set, show: Some(&["r:"]), tint: Some(&["r:", "x:"]), sortable: |_| false, trace: None };

// --- The view. ---

struct TableView {
    shell: Shell,
    columns: Vec<String>,
    highlight: Vec<usize>,
    has_steps: bool,
    states: Vec<SceneState>,
    layouts: Vec<Layout>,
    targets: HashMap<String, Vec<usize>>,
    callout: Option<HeaderCallout>,
    legend: Vec<Change>,
    box_h: f64,
    marks: Vec<MarkTargets>,
    board: Board,
    camera: Camera,
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: TableScene = parse(input)?;
    if scene.columns.is_empty() {
        return Err("a table without columns".into());
    }
    let shell = Shell::new(input.scene);
    let callout = HeaderCallout::new(input.scene);
    let (bw, bh) = crate::theme::content_box(shell.title.is_some() || callout.is_some());
    let box_h = match &shell.title {
        Some(t) => bh - (t.lines.len() as f64 - 1.0) * crate::timing::js_round(t.size * t.line_height),
        None => bh,
    };
    let states = walk_states(&BoundModel { model: &MODEL, scene: input.scene }, input.scene);
    let (_, rows) = layout::table_of(input.scene);
    let by_state = layout::state_rows(&scene.columns, &rows, &states);
    let layouts = layout::layout_table_states(&scene.columns, &by_state, bw, box_h);
    let mut legend = Vec::new();
    for c in [Change::Added, Change::Removed, Change::Modified] {
        if layouts[0].rows.iter().any(|r| r.change == Some(c)) {
            legend.push(c);
        }
    }
    let marks: Vec<MarkTargets> = layouts[1..]
        .iter()
        .map(|l| {
            let top = (box_h - l.height * l.scale).max(0.0) * 0.3;
            Stage { left: 0.0, top, scale: l.scale }.targets(&layout::table_boxes(l), (bw, box_h))
        })
        .collect();
    let refs = crate::targets::SceneRefs(input.scene);
    let step_refs = StepRefs::Scene(&refs);
    let board = Board::new(input.scene, input.segments, &step_refs, &|k| marks.get(k).cloned(), &|_| None);
    let camera = Camera::new(input.scene, &step_refs, crate::chrome::callout::header_box(input.scene));
    Ok(Box::new(TableView {
        marks,
        board,
        camera,
        shell,
        columns: scene.columns,
        highlight: scene.highlight,
        has_steps: !scene.steps.is_empty(),
        targets: crate::targets::target_steps(input.scene),
        states,
        layouts,
        callout,
        legend,

        box_h,
    }))
}

/// The words of a change in the legend (`CHANGE_WORD`).
fn change_word(c: Change) -> &'static str {
    match c {
        Change::Added => "new",
        Change::Removed => "removed",
        Change::Modified => "changed",
    }
}

const LEGEND_BOX: f32 = 26.0;
const LEGEND_GAP: f32 = 22.0;
const LEGEND_PAD_BOTTOM: f32 = 6.0;

fn legend_width(used: &[Change]) -> f32 {
    let st = Style::sans(400.0, 19.0);
    used.iter().map(|&c| LEGEND_BOX + 8.0 + width(change_word(c), st)).sum::<f32>()
        + LEGEND_GAP * used.len().saturating_sub(1) as f32
}

fn draw_legend(dl: &mut DisplayList, used: &[Change], x: f32, y: f32) {
    let st = Style::sans(400.0, 19.0);
    let lh = line_metrics(Face::Sans, 19.0).normal;
    let mut x = x;
    for &c in used {
        let (color, bg, marker) = change_tone(c);
        dl.rect(x, y, LEGEND_BOX, LEGEND_BOX, BoxStyle::fill(bg).radius(7.0).border(hex_alpha(color, 0x88), 1.0));
        let ms = Style::mono(800.0, 19.0);
        let mlh = line_metrics(Face::Mono, 19.0).normal;
        let mw = width(marker, ms);
        dl.text(
            marker,
            ms,
            x + (LEGEND_BOX - mw) / 2.0,
            y + (LEGEND_BOX - mlh) / 2.0 + baseline_in(Face::Mono, 19.0, mlh),
            color,
        );
        let word = change_word(c);
        let tx = x + LEGEND_BOX + 8.0;
        dl.text(word, st, tx, y + (LEGEND_BOX - lh) / 2.0 + baseline_in(Face::Sans, 19.0, lh), MUTED);
        x = tx + width(word, st) + LEGEND_GAP;
    }
}

struct Ctx<'a> {
    sf: StateFrame<'a>,
    focus: Focus<'a>,
    walked: Vec<usize>,
    spot: Spotlight,
    has_steps: bool,
    columns: usize,
}

impl Ctx<'_> {
    fn cell_emphasis(&self, row: usize, col: usize) -> Emphasis {
        brighter(self.focus.emphasis(&format!("c:{col}")), self.focus.emphasis(&format!("x:{row}/{col}")))
    }

    fn row_emphasis(&self, row: usize) -> Emphasis {
        if !self.has_steps {
            return match self.walked.iter().position(|&r| r == row) {
                Some(k) => self.spot.emphasis(&[k]),
                None => self.spot.emphasis(&[]),
            };
        }
        let own = self.focus.emphasis(&format!("r:{row}"));
        let opacity = (0..self.columns).map(|c| self.cell_emphasis(row, c).opacity).fold(own.opacity, f64::max);
        Emphasis { opacity, ..own }
    }
}

impl SceneView for TableView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let sf = StateFrame::at(&self.states, f.segments, frame);
        let idx = |s: &SceneState| self.states.iter().position(|x| std::ptr::eq(x, s)).unwrap_or(0);
        let (layout, before) = (&self.layouts[idx(sf.now)], &self.layouts[idx(sf.before)]);
        let n = layout.rows.len();
        let row_stagger = 5f64.min((ROWS_END - START - 6.0) / ((n as f64) - 1.0).max(1.0));
        let row_at = |i: usize| START + 6.0 + i as f64 * row_stagger;
        let walked: Vec<usize> = if !self.highlight.is_empty() {
            self.highlight.clone()
        } else {
            layout.rows.iter().enumerate().filter(|(_, r)| r.change.is_some()).map(|(i, _)| i).collect()
        };
        let starts = spotlight_starts(f.segments, walked.len(), build_frames("table"));
        let ctx = Ctx {
            focus: Focus::borrowed(&self.targets, f.segments, frame),
            spot: Spotlight::new(frame, &starts),
            walked,
            has_steps: self.has_steps,
            columns: self.columns.len(),
            sf,
        };
        let header_in = interpolate(frame, &[START, START + 10.0], &[0.0, 1.0], CLAMP);
        let top = (self.box_h - layout.height * layout.scale).max(0.0) * 0.3;

        let legend_w = legend_width(&self.legend);
        let has_legend = !self.legend.is_empty();
        let legend_h = LEGEND_BOX + LEGEND_PAD_BOTTOM;
        let height = if has_legend { legend_h } else { 0.0 }.max(self.callout.as_ref().map_or(0.0, |c| c.height));
        let draw_aside = |dl: &mut DisplayList, right: f32, top: f32| {
            let mut right = right;
            if let Some(c) = &self.callout {
                c.draw(dl, right, top + height - c.height, &ctx.sf);
                right -= c.width + 32.0;
            }
            if has_legend {
                draw_legend(dl, &self.legend, right - legend_w, top + height - legend_h);
            }
        };
        let aside = (has_legend || self.callout.is_some()).then_some(Aside { height, draw: &draw_aside });
        let view = self.camera.view(frame, f.segments, &|k| self.marks.get(k).cloned());
        self.shell.draw(dl, frame, f.duration, aside, |dl, _bx| {
            self.camera.draw(dl, view, |dl| {
                let draw = TableDraw {
                    layout,
                    before,
                    s: &ctx.sf,
                    left: 0.0,
                    top: top as f32,
                    frame,
                    header_in,
                    row_at: &row_at,
                    row_emphasis: &|i| ctx.row_emphasis(i),
                    cell_emphasis: &|r, c| ctx.cell_emphasis(r, c),
                    header_glow: &|i| ctx.focus.emphasis(&format!("c:{i}")).glow,
                };
                draw_table(dl, &draw);
                self.board.draw(dl, frame, f.segments, &|_| None);
            });
        });
    }
}
