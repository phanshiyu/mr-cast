//! The text scene: a kicker, one big lead (headline, question, number, term or quote), a note, a risk badge,
//! bullet items or two sides, and the diff's stats in the header. A port of src/components/TextCard.tsx and
//! src/utils/textLayout.ts.
//! Steps light parts (`focus`), rewrite the lead, note or kicker (`set`, crossfading), show and hide parts, draw pen
//! marks and ink, and move the camera.

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, Easing, Spring, clamped, interpolate, spring};
use crate::camera::Camera;
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit};
use crate::chrome::shell::{Aside, Shell, header_box};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Paint, Shadow};
use crate::icons;
use crate::marks::geometry::Bx;
use crate::marks::{Board, MarkTargets, Refs, StepRefs, resolve_ref};
use crate::model::{HunkStatus, Props};
use crate::states::{SceneState, StateFrame, StateModel, walk_states};
use crate::steps::{CALM, Emphasis, Spotlight, current_step};
use crate::text::{Face, Style, baseline_in, line_metrics, shape, width};
use crate::textfit::{Family, Fit, Font, Slot, fit_text, fit_text_at, measure};
use crate::theme::{self, ACCENT, ACCENT_GLOW, BORDER, MUTED, TEXT, content_box};
use crate::timing::{FPS, index_range};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

const LEADS: [&str; 5] = ["headline", "question", "number", "term", "quote"];

struct Gap;
impl Gap {
    const KICKER: f64 = 22.0;
    const NOTE: f64 = 26.0;
    const RULE: f64 = 30.0;
    const RISK: f64 = 32.0;
    const RISK_H: f64 = 50.0;
    const LIST: f64 = 44.0;
    const ITEM: f64 = 20.0;
    const SIDE_LABEL: f64 = 18.0;
    const SIDE_LIST: f64 = 26.0;
    const SIDE_ITEM: f64 = 14.0;
    const BOTTOM: f64 = 24.0;
}
const RULE_W: f64 = 120.0;
const RULE_H: f64 = 7.0;
const QUESTION_ROOM: f64 = 0.2;
const SIDE_GUTTER: f64 = 64.0;
const BULLET_INDENT: f64 = 12.0 + 22.0 + 12.0;
const QUOTE_SCALE: f64 = 3.2;
const QUOTE_GAP: f64 = 0.35;
const LIT_SHIFT: f32 = 12.0;

#[derive(Deserialize, Default, Clone)]
struct Fields {
    kicker: Option<String>,
    note: Option<String>,
    headline: Option<String>,
    question: Option<String>,
    number: Option<String>,
    term: Option<String>,
    quote: Option<String>,
    #[serde(default)]
    items: Vec<String>,
    label: Option<String>,
    tone: Option<String>,
}

impl Fields {
    fn lead(&self) -> Option<(&'static str, &str)> {
        let all = [&self.headline, &self.question, &self.number, &self.term, &self.quote];
        LEADS.iter().zip(all).find_map(|(k, v)| v.as_deref().map(|t| (*k, t)))
    }
}

#[derive(Deserialize)]
struct Step {
    #[serde(default)]
    focus: Value,
}

#[derive(Deserialize)]
struct TextScene {
    #[serde(flatten)]
    own: Fields,
    risk: Option<String>,
    sides: Option<Vec<Fields>>,
    #[serde(default)]
    diffstat: bool,
    #[serde(default)]
    steps: Vec<Step>,
}

/// The text a state draws in place of the scene's own lead, note and kicker.
fn with_values(o: &Fields, values: &HashMap<String, Value>) -> Fields {
    let mut f = o.clone();
    let text = |k: &str| values.get(k).and_then(Value::as_str).map(str::to_string);
    if let Some(t) = text("t:kicker") {
        f.kicker = Some(t);
    }
    if let Some(t) = text("t:note") {
        f.note = Some(t);
    }
    if let (Some(t), Some((kind, _))) = (text("t:lead"), o.lead()) {
        match kind {
            "headline" => f.headline = Some(t),
            "question" => f.question = Some(t),
            "number" => f.number = Some(t),
            "term" => f.term = Some(t),
            _ => f.quote = Some(t),
        }
    }
    f
}

#[derive(Clone, Copy, PartialEq)]
enum Where {
    Alone,
    List,
    Side,
}

struct LeadType {
    alone: f64,
    list: f64,
    side: f64,
    min: f64,
    lines: usize,
    weight: f64,
    ls: f64,
    lh: f64,
    width: f64,
    max_width: f64,
}

fn lead_type(kind: &str) -> LeadType {
    let t = |alone, list, side, min, lines, weight, ls, lh, width, max_width| LeadType {
        alone,
        list,
        side,
        min,
        lines,
        weight,
        ls,
        lh,
        width,
        max_width,
    };
    match kind {
        "headline" => t(120.0, 68.0, 60.0, 44.0, 3, 700.0, -2.5, 1.12, 0.94, 1580.0),
        "question" => t(92.0, 64.0, 52.0, 40.0, 3, 700.0, -2.0, 1.1, 1.0 - QUESTION_ROOM, f64::INFINITY),
        "number" => t(300.0, 190.0, 170.0, 90.0, 1, 800.0, -10.0, 1.0, 1.0, f64::INFINITY),
        "term" => t(140.0, 100.0, 100.0, 52.0, 2, 800.0, -4.0, 1.05, 0.94, f64::INFINITY),
        _ => t(68.0, 54.0, 44.0, 34.0, 4, 600.0, -1.0, 1.22, 0.86, f64::INFINITY),
    }
}

/// size, side size, weight, lines of the note under each lead.
fn note_type(kind: Option<&str>) -> (f64, f64, f64, usize) {
    match kind {
        Some("number") => (50.0, 34.0, 500.0, 2),
        Some("term") => (54.0, 40.0, 500.0, 3),
        Some("quote") => (34.0, 28.0, 500.0, 2),
        _ => (42.0, 32.0, 500.0, 3),
    }
}

#[derive(Clone)]
struct Count {
    value: f64,
    decimals: usize,
    grouped: bool,
    prefix: String,
    suffix: String,
}

struct LeadFit {
    kind: &'static str,
    main: Fit,
    unit: Option<Fit>,
    count: Option<Count>,
}

struct TextBlock {
    kicker: Option<Fit>,
    lead: Option<LeadFit>,
    note: Option<Fit>,
    indent: f64,
    height: f64,
}

struct SideLayout {
    label: Option<Fit>,
    block: TextBlock,
    items: Vec<Fit>,
    height: f64,
}

struct TextLayout {
    block: TextBlock,
    items: Vec<Fit>,
    sides: Option<Vec<SideLayout>>,
    mark: Option<f64>,
}

#[allow(clippy::too_many_arguments)]
fn slot(name: &str, weight: f64, size: f64, min: f64, lines: usize, lh: f64, width: f64, balanced: bool) -> Slot {
    Slot {
        name: name.into(),
        family: Family::Sans,
        weight,
        size,
        min,
        lines,
        line_height: lh,
        width,
        letter_spacing: None,
        upper: None,
        balanced: Some(balanced),
        markup: None,
        one_line_min: None,
    }
}

/// "500 hours" as its figure and its words; None when it does not start with a figure.
fn split_number(text: &str) -> Option<(String, String)> {
    let re = fancy_regex::Regex::new(r"^\s*([~≈<>+\-−$€£]?\s?\d[\d,.]*\s?[%×x]?)(?:\s+(.+))?$").unwrap();
    let c = re.captures(text).ok()??;
    let fig = c.get(1)?.as_str();
    if fig.contains(['*', '`', '=', '[', ']', '{', '}']) {
        return None;
    }
    Some((fig.trim().to_string(), c.get(2).map_or("", |m| m.as_str()).trim().to_string()))
}

fn count_of(figure: &str) -> Option<Count> {
    let re = fancy_regex::Regex::new(r"^([^\d]*)(\d[\d,]*)(\.\d+)?(.*)$").unwrap();
    let c = re.captures(figure).ok()??;
    let int = c.get(2)?.as_str();
    let dec = c.get(3).map_or("", |m| m.as_str());
    Some(Count {
        prefix: c[1].to_string(),
        value: format!("{}{dec}", int.replace(',', "")).parse().ok()?,
        decimals: dec.len().saturating_sub(1),
        grouped: int.contains(','),
        suffix: c.get(4).map_or("", |m| m.as_str()).to_string(),
    })
}

/// A figure partway (`t`, 0 to 1) from 0 to `to`, written as `to` is (`countText`).
fn count_text(to: &Count, t: f64, from: Option<&Count>) -> Option<String> {
    if let Some(f) = from
        && (f.prefix != to.prefix || f.suffix != to.suffix)
    {
        return None;
    }
    let start = from.map_or(0.0, |f| f.value);
    let v = start + (to.value - start) * t;
    let decimals = to.decimals.max(from.map_or(0, |f| f.decimals));
    let s = format!("{:.*}", if t >= 1.0 { to.decimals } else { decimals }, v);
    let (int, dec) = s.split_once('.').map_or((s.as_str(), None), |(a, b)| (a, Some(b)));
    let int = if to.grouped || from.is_some_and(|f| f.grouped) {
        let digits: Vec<char> = int.chars().collect();
        let mut out = String::new();
        for (i, c) in digits.iter().enumerate() {
            if i > 0 && (digits.len() - i).is_multiple_of(3) && c.is_ascii_digit() && digits[i - 1].is_ascii_digit() {
                out.push(',');
            }
            out.push(*c);
        }
        out
    } else {
        int.to_string()
    };
    Some(format!("{}{int}{}{}", to.prefix, dec.map_or(String::new(), |d| format!(".{d}")), to.suffix))
}

fn fit_lead(kind: &'static str, text: &str, width: f64, at: Where, scale: f64) -> LeadFit {
    let t = lead_type(kind);
    let base = match at {
        Where::Alone => t.alone,
        Where::List => t.list,
        Where::Side => t.side,
    };
    let size = t.min.max(crate::timing::js_round(base * scale));
    let letter_spacing = if kind == "headline" || kind == "question" {
        -crate::timing::js_round(size * 0.022 * 10.0) / 10.0
    } else {
        t.ls
    };
    let mut s = slot(
        kind,
        t.weight,
        size,
        size.min(t.min),
        t.lines,
        t.lh,
        (width * t.width).min(t.max_width),
        !(kind == "headline" && at == Where::List),
    );
    s.letter_spacing = Some(letter_spacing);
    if kind == "number"
        && let Some((figure, unit)) = split_number(text)
    {
        let mut fs = s.clone();
        fs.markup = Some(false);
        let main = fit_text(&figure, &fs);
        let mut us = slot(
            "number unit",
            700.0,
            32f64.max(crate::timing::js_round(main.size * 0.3)),
            26.0,
            2,
            1.1,
            1f64.max(width - main.width - main.size * 0.12),
            true,
        );
        us.letter_spacing = Some(-0.5);
        let unit = (!unit.is_empty()).then(|| fit_text(&unit, &us));
        return LeadFit { kind, main, unit, count: count_of(&figure) };
    }
    LeadFit { kind, main: fit_text(text, &s), unit: None, count: None }
}

fn quote_indent(at: Where, scale: f64) -> f64 {
    let t = lead_type("quote");
    let base = match at {
        Where::Alone => t.alone,
        Where::List => t.list,
        Where::Side => t.side,
    };
    let size = t.min.max(crate::timing::js_round(base * scale));
    crate::timing::js_round(measure("“", &Font::new(Family::Sans, 800.0, size * QUOTE_SCALE)) + size * QUOTE_GAP)
}

fn fit_block(o: &Fields, full: f64, at: Where, scale: f64) -> TextBlock {
    let lead = o.lead();
    let kind = lead.map(|l| l.0);
    let indent = if kind == Some("quote") { quote_indent(at, scale) } else { 0.0 };
    let width = full - indent;
    let kicker = o.kicker.as_deref().map(|k| {
        let w = if kind == Some("question") { width * (1.0 - QUESTION_ROOM) } else { width };
        fit_text(k, &slot("kicker", 500.0, if at == Where::Side { 24.0 } else { 28.0 }, 20.0, 1, 1.2, w, true))
    });
    let lead = lead.map(|(k, t)| fit_lead(k, t, width, at, scale));
    let (nsize, nside, nweight, nlines) = note_type(kind);
    let note_size = 26f64.max(crate::timing::js_round(if at == Where::Side { nside } else { nsize } * scale.max(0.8)));
    let note_width = width
        * match kind {
            Some("question") => 1.0 - QUESTION_ROOM,
            Some("quote") => 0.86,
            _ => 0.9,
        };
    let note =
        o.note.as_deref().map(|n| fit_text(n, &slot("note", nweight, note_size, 24.0, nlines, 1.3, note_width, true)));
    let lead_h = lead.as_ref().map_or(0.0, |l| l.main.height.max(l.unit.as_ref().map_or(0.0, |u| u.height)));
    let rule_h = if kind == Some("term") && note.is_some() { Gap::RULE * 2.0 + RULE_H - Gap::NOTE } else { 0.0 };
    let height = kicker.as_ref().map_or(0.0, |k| k.height + Gap::KICKER)
        + lead_h
        + note.as_ref().map_or(0.0, |n| Gap::NOTE + rule_h + n.height);
    TextBlock { kicker, lead, note, indent, height }
}

fn items_height(items: &[Fit], gap: f64) -> f64 {
    items.iter().map(|f| f.height).sum::<f64>() + (items.len().max(1) - 1) as f64 * gap
}

fn fit_items(items: &[String], width: f64, start: f64, min: f64, gap: f64, room: f64) -> Vec<Fit> {
    let s = slot("item", 600.0, start, min, 2, 1.3, width - BULLET_INDENT, false);
    let mut fits = Vec::new();
    let mut size = start;
    while size >= min {
        fits = items.iter().map(|b| fit_text_at(b, &s, size)).collect();
        if fits.iter().all(|f| f.fits) && items_height(&fits, gap) <= room {
            break;
        }
        size -= 1.0;
    }
    fits
}

fn layout_text(scene: &TextScene, values: &HashMap<String, Value>) -> TextLayout {
    let own = with_values(&scene.own, values);
    let (width, box_h) = content_box(false);
    let room = box_h - Gap::BOTTOM;
    let listed = !scene.own.items.is_empty() || scene.sides.is_some();
    let asked = scene.own.lead().is_some_and(|l| l.0 == "question");
    let inner = if asked { width * (1.0 - QUESTION_ROOM) } else { width };
    let mut scale = 1.0;
    loop {
        let block = fit_block(&own, width, if listed { Where::List } else { Where::Alone }, scale);
        let above = block.height + if scene.risk.is_some() { Gap::RISK + Gap::RISK_H } else { 0.0 };
        let items = if scene.own.items.is_empty() {
            Vec::new()
        } else {
            let start = if scene.own.items.len() > 4 { 32.0 } else { 36.0 };
            fit_items(&scene.own.items, inner, start, 24.0, Gap::ITEM, room - above - Gap::LIST)
        };
        let side_w = (inner - SIDE_GUTTER * 2.0) / 2.0;
        let sides = scene.sides.as_ref().map(|sides| {
            sides
                .iter()
                .map(|side| {
                    let label = side.label.as_deref().map(|l| {
                        let mut s = slot("side label", 800.0, 24.0, 16.0, 1, 1.2, side_w, true);
                        s.letter_spacing = Some(2.5);
                        s.upper = Some(true);
                        fit_text(l, &s)
                    });
                    let block = fit_block(side, side_w, Where::Side, scale);
                    let items = if side.items.is_empty() {
                        Vec::new()
                    } else {
                        fit_items(&side.items, side_w, 30.0, 22.0, Gap::SIDE_ITEM, f64::INFINITY)
                    };
                    let height = label.as_ref().map_or(0.0, |l| l.height + Gap::SIDE_LABEL)
                        + block.height
                        + if items.is_empty() { 0.0 } else { Gap::SIDE_LIST + items_height(&items, Gap::SIDE_ITEM) };
                    SideLayout { label, block, items, height }
                })
                .collect::<Vec<_>>()
        });
        let below = if items.is_empty() { 0.0 } else { Gap::LIST + items_height(&items, Gap::ITEM) }
            + sides.as_ref().map_or(0.0, |s| {
                (if block.height > 0.0 { Gap::LIST } else { 0.0 }) + s.iter().map(|s| s.height).fold(0.0, f64::max)
            });
        let height = above + below;
        let mark = asked.then(|| {
            let column = width * QUESTION_ROOM;
            crate::timing::js_round(
                640f64
                    .min(height * 1.25 + 160.0)
                    .min(column / (measure("?", &Font::new(Family::Sans, 800.0, 100.0)) / 100.0)),
            )
        });
        // The overlap check against the question mark is `validate`'s; the drawing only needs the sizes.
        if height <= room || scale - 0.05 < 0.5 - 1e-9 {
            return TextLayout { block, items, sides, mark };
        }
        scale -= 0.05;
    }
}

struct DiffStats {
    files: usize,
    additions: i64,
    deletions: i64,
}

fn diff_stats(props: &Props) -> DiffStats {
    let all: Vec<_> = props.hunks.values().filter(|h| h.status != HunkStatus::Source).collect();
    DiffStats {
        files: all.iter().map(|h| h.file.as_str()).collect::<HashSet<_>>().len(),
        additions: all.iter().map(|h| h.additions).sum(),
        deletions: all.iter().map(|h| h.deletions).sum(),
    }
}

struct TextView {
    shell: Shell,
    scene: TextScene,
    /// The scene's state at each step, and its layout then.
    states: Vec<SceneState>,
    layouts: Vec<TextLayout>,
    stats: Option<DiffStats>,
    /// For each item key ("b:0", "t:lead", ...), the steps that light it.
    targets: HashMap<String, Vec<usize>>,
    /// Kinds of key some step lights ("b", "t", "sd").
    lit: Vec<String>,
    board: Board,
    camera: Camera,
    /// The pen's boxes for each step.
    marks: Vec<Option<MarkTargets>>,
}

/// The item keys a focus ref lights (shared/targets.mjs, `text`).
fn resolve(scene: &TextScene, r: &Value) -> Option<Vec<String>> {
    let items = scene.own.items.len();
    if let Some(n) = r.as_u64().map(|n| n as usize)
        && n < items
    {
        return Some(vec![format!("b:{n}")]);
    }
    if let Some((a, b)) = index_range(r)
        && b < items
    {
        return Some((a..=b).map(|i| format!("b:{i}")).collect());
    }
    let lead = scene.own.lead().map(|l| l.0);
    Some(match r.as_str()? {
        "note" if scene.own.note.is_some() => vec!["t:note".into()],
        "kicker" if scene.own.kicker.is_some() => vec!["t:kicker".into()],
        s if Some(s) == lead => vec!["t:lead".into()],
        "left" if scene.sides.as_ref().is_some_and(|s| !s.is_empty()) => vec!["sd:0".into()],
        "right" if scene.sides.as_ref().is_some_and(|s| s.len() > 1) => vec!["sd:1".into()],
        _ => return None,
    })
}

/// The text scene's refs and state model (the `text` entries of shared/targets.mjs and shared/state-steps.mjs).
struct TextModel<'a>(&'a TextScene);

impl Refs for TextModel<'_> {
    fn resolve(&self, r: &Value) -> Option<Vec<String>> {
        resolve(self.0, r)
    }
}

impl StateModel for TextModel<'_> {
    fn initial(&self, scene: &Value) -> SceneState {
        let mut st = SceneState::default();
        if let Some((_, lead)) = self.0.own.lead() {
            st.values.insert("t:lead".into(), Value::from(lead));
        }
        if let Some(n) = &self.0.own.note {
            st.values.insert("t:note".into(), Value::from(n.as_str()));
        }
        if let Some(k) = &self.0.own.kicker {
            st.values.insert("t:kicker".into(), Value::from(k.as_str()));
        }
        for r in scene.get("hidden").and_then(Value::as_array).into_iter().flatten() {
            for key in resolve_ref(self, r).unwrap_or_default() {
                st.hidden.insert(key, true);
            }
        }
        st
    }
    fn set_prefixes(&self) -> &[&str] {
        &["t:"]
    }
    fn value_ok(&self, value: &Value, _key: &str) -> bool {
        value.is_string()
    }
    fn show_prefixes(&self) -> Option<&[&str]> {
        Some(&["t:", "b:", "sd:"])
    }
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: TextScene = parse(input)?;
    let model = TextModel(&scene);
    let mut targets: HashMap<String, Vec<usize>> = HashMap::new();
    for (k, step) in scene.steps.iter().enumerate() {
        let refs = match &step.focus {
            Value::Array(a) => a.clone(),
            Value::Null => Vec::new(),
            v => vec![v.clone()],
        };
        let mut keys: Vec<String> = Vec::new();
        for key in refs.iter().flat_map(|r| resolve_ref(&model, r).unwrap_or_default()) {
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
        for key in keys {
            targets.entry(key).or_default().push(k);
        }
    }
    let states = walk_states(&model, input.scene);
    let layouts: Vec<TextLayout> = states.iter().map(|st| layout_text(&scene, &st.values)).collect();
    let stats = diff_stats(input.props);
    let stats = (scene.diffstat && stats.files > 0).then_some(stats);
    let shell = Shell::new(input.scene);
    let bx = shell.content(if stats.is_some() { chip_height() } else { 0.0 });
    let area = Bx::new(0.0, 0.0, bx.w as f64, bx.h as f64);
    // The card measures its parts for the pen only when some step marks or draws; the camera frames those boxes, so
    // without them it shows the whole card (as TextCard.tsx does).
    let marked = input.scene["steps"]
        .as_array()
        .is_some_and(|s| s.iter().any(|st| st.get("mark").is_some() || st.get("draw").is_some()));
    let marks: Vec<Option<MarkTargets>> = (0..scene.steps.len())
        .filter(|_| marked)
        .map(|k| {
            let l = layouts.get(k + 1).unwrap_or(&layouts[0]);
            Some(MarkTargets::new(part_boxes(&scene, l, bx.w, bx.h), area))
        })
        .collect();
    let refs = StepRefs::Scene(&model);
    let board = Board::new(input.scene, input.segments, &refs, &|k| marks.get(k).cloned().flatten(), &|_| None);
    let camera = Camera::new(input.scene, &refs, header_box(input.scene));
    let lit = targets.keys().map(|k| k[..k.find(':').unwrap_or(0)].to_string()).collect();
    Ok(Box::new(TextView { shell, states, layouts, stats, targets, lit, board, camera, marks, scene }))
}

/// The height a lead takes on screen: a counted number's figure is a box its size tall plus 4% padding, with its unit
/// on its baseline (the layout counts the fit's own height).
fn lead_dom_height(l: &LeadFit) -> f64 {
    if l.kind != "number" || l.count.is_none() {
        return l.main.height.max(l.unit.as_ref().map_or(0.0, |u| u.height));
    }
    let size = l.main.size as f32;
    let fb = baseline_in(Face::Sans, size, size);
    let (mut top, mut bottom) = (0.0f32, size * 1.04);
    if let Some(u) = &l.unit {
        let ut = fb - baseline_in(Face::Sans, u.size as f32, u.size as f32 * 1.05);
        top = top.min(ut);
        bottom = bottom.max(ut + (u.lines.len() as f64 * u.size * 1.05) as f32);
    }
    (bottom - top) as f64
}

/// A block's height on screen.
fn block_dom_height(b: &TextBlock) -> f64 {
    // A term's rule's top margin collapses into the note's, so it takes GAP.note, not GAP.rule, above the rule.
    let collapsed =
        if b.note.is_some() && b.lead.as_ref().is_some_and(|l| l.kind == "term") { Gap::RULE - Gap::NOTE } else { 0.0 };
    b.height - collapsed
        + b.lead
            .as_ref()
            .map_or(0.0, |l| lead_dom_height(l) - l.main.height.max(l.unit.as_ref().map_or(0.0, |u| u.height)))
}

/// A side's height on screen.
fn side_dom_height(side: &SideLayout) -> f64 {
    side.height - side.block.height + block_dom_height(&side.block)
}

/// Where the card stacks its parts in a content box `h` tall: the block's top, and each later part's top.
struct Stack {
    block: f32,
    risk: f32,
    items: Vec<f32>,
    sides: f32,
}

fn risk_height() -> f32 {
    20.0 + line_metrics(Face::Sans, 24.0).normal.max(26.0) + 2.0
}

fn stack(scene: &TextScene, l: &TextLayout, h: f32) -> Stack {
    let items_h = items_height(&l.items, Gap::ITEM) as f32;
    let sides_h = l.sides.as_ref().map_or(0.0, |s| s.iter().map(side_dom_height).fold(0.0, f64::max)) as f32;
    let total = block_dom_height(&l.block) as f32
        + if scene.risk.is_some() { Gap::RISK as f32 + risk_height() } else { 0.0 }
        + if l.items.is_empty() { 0.0 } else { Gap::LIST as f32 + items_h }
        + if l.sides.is_some() { (if l.block.height > 0.0 { Gap::LIST as f32 } else { 0.0 }) + sides_h } else { 0.0 };
    let block = (h - Gap::BOTTOM as f32 - total) / 2.0;
    let mut y = block + block_dom_height(&l.block) as f32;
    let risk = y + Gap::RISK as f32;
    if scene.risk.is_some() {
        y = risk + risk_height();
    }
    let mut items = Vec::new();
    if !l.items.is_empty() {
        y += Gap::LIST as f32;
        for item in &l.items {
            items.push(y);
            y += (item.height + Gap::ITEM) as f32;
        }
        y -= Gap::ITEM as f32;
    }
    let sides = y + if l.block.height > 0.0 { Gap::LIST as f32 } else { 0.0 };
    Stack { block, risk, items, sides }
}

/// The boxes of the card's parts as the TS measures them for the pen and the camera (`boxIn` of TextCard.tsx).
fn part_boxes(scene: &TextScene, l: &TextLayout, w: f32, h: f32) -> Vec<(String, Bx)> {
    let s = stack(scene, l, h);
    let b = &l.block;
    let x = b.indent;
    let mut out = Vec::new();
    let mut y = s.block as f64;
    if let Some(k) = &b.kicker {
        out.push(("t:kicker".to_string(), Bx::new(x, y, k.width, k.height)));
        y += k.height + Gap::KICKER;
    }
    if let Some(lead) = &b.lead {
        let lw = lead.main.width + lead.unit.as_ref().map_or(0.0, |u| lead.main.size * 0.1 + u.width);
        let lh = lead.main.height.max(lead.unit.as_ref().map_or(0.0, |u| u.height));
        out.push(("t:lead".to_string(), Bx::new(x, y, lw, lh)));
    }
    if let Some(n) = &b.note {
        let nx = if b.lead.as_ref().is_some_and(|l| l.kind == "quote") { 58.0 } else { 0.0 };
        out.push((
            "t:note".to_string(),
            Bx::new(x, s.block as f64 + block_dom_height(b) - n.height, n.width + nx, n.height),
        ));
    }
    for (i, (item, &top)) in l.items.iter().zip(&s.items).enumerate() {
        // An item's box takes in its dot (34px left of its text), where it sits once lit.
        out.push((format!("b:{i}"), Bx::new(LIT_SHIFT as f64, top as f64, item.width + 34.0, item.height)));
    }
    if let Some(sides) = &l.sides {
        let inner = if l.mark.is_some() { w * (1.0 - QUESTION_ROOM as f32) } else { w };
        let side_w = (inner - SIDE_GUTTER as f32 * 2.0) / 2.0;
        for (i, side) in sides.iter().enumerate() {
            out.push((
                format!("sd:{i}"),
                Bx::new(
                    (i as f32 * (side_w + SIDE_GUTTER as f32 * 2.0)) as f64,
                    s.sides as f64,
                    side_w as f64,
                    side_dom_height(side),
                ),
            ));
        }
    }
    out
}

const CHIP_FONT: f32 = 24.0;

/// A diffstat chip: its width, and its drawing with its top left at (x, y).
fn chip_width(icon: bool, text: &str) -> f32 {
    18.0 * 2.0 + 2.0 + width(text, Style::mono(600.0, CHIP_FONT)) + if icon { 22.0 + 10.0 } else { 0.0 }
}

fn chip_height() -> f32 {
    20.0 + 2.0 + line_metrics(Face::Mono, CHIP_FONT).normal
}

fn draw_chip(dl: &mut DisplayList, x: f32, y: f32, icon: bool, text: &str, color: Color) {
    let (w, h) = (chip_width(icon, text), chip_height());
    dl.rect(x, y, w, h, BoxStyle::fill(Color::rgba8(255, 255, 255, 0.04)).radius(h / 2.0).border(BORDER, 1.0));
    let mut pen = x + 19.0;
    if icon {
        icons::draw(dl, "FileCode2", pen, y + (h - 22.0) / 2.0, 22.0, color, 2.0);
        pen += 32.0;
    }
    let base = y + 11.0 + baseline_in(Face::Mono, CHIP_FONT, line_metrics(Face::Mono, CHIP_FONT).normal);
    dl.text(text, Style::mono(600.0, CHIP_FONT), pen, base, color);
}

impl TextView {
    /// A part dims while others are lit only when some step lights a part of its kind; a hidden part fades.
    fn emphasis(&self, spot: &Spotlight, s: &StateFrame, key: &str) -> Emphasis {
        let kind = &key[..key.find(':').unwrap_or(0)];
        let e = if self.lit.iter().any(|k| k == kind) {
            spot.emphasis(self.targets.get(key).map_or(&[][..], |v| v))
        } else {
            CALM
        };
        Emphasis { opacity: e.opacity * s.shown(key), ..e }
    }

    /// A lead drawn as its field says; a number's figure in gradient display type while and after it counts.
    fn draw_lead(dl: &mut DisplayList, l: &LeadFit, x: f32, y: f32, figure: Option<&str>, tone: Option<&str>) {
        if l.kind != "number" || l.count.is_none() {
            draw_fit(dl, &l.main, x, y, TextOpts::new(TEXT));
            return;
        }
        let text = figure.unwrap_or(&l.main.text);
        let size = l.main.size as f32;
        let st = Style::sans(800.0, size).spacing(l.main.font.letter_spacing as f32);
        let base = y + baseline_in(Face::Sans, size, size);
        let run = shape(text, st);
        let w = run.width;
        // `linear-gradient(180deg, #fff 10%, mid 60%, end 100%)` over the figure's box, size tall plus 4% padding.
        let (mid, end) = match tone {
            Some(t) if t != "accent" => (theme::tone(t).0.alpha(0xaa as f32 / 255.0), theme::tone(t).0),
            Some(t) => (Color::css("#c7cdff"), theme::tone(t).0),
            None => (Color::css("#c7cdff"), ACCENT),
        };
        let fill = Paint::Linear {
            start: (0.0, y),
            end: (0.0, y + size * 1.04),
            stops: vec![(0.1, Color::css("#ffffff")), (0.6, mid), (1.0, end)],
        };
        dl.run_paint(run, x, base, fill);
        if let Some(u) = &l.unit {
            let ub = baseline_in(Face::Sans, u.size as f32, u.size as f32 * 1.05);
            draw_fit(dl, u, x + w + size * 0.1, base - ub, TextOpts::new(MUTED).line_height(LineHeight::Times(1.05)));
        }
    }

    /// Draws a block's kicker, lead and note. With `before` (the block before the current step rewrote it) and `t`
    /// under 1, each changed part crossfades from its old text, sliding up out as the new slides up in (`Swap`).
    #[allow(clippy::too_many_arguments)]
    fn draw_block(
        &self,
        dl: &mut DisplayList,
        b: &TextBlock,
        before: Option<&TextBlock>,
        t: f64,
        appear: &dyn Fn(f64) -> f64,
        e: [Emphasis; 3],
        tone: Option<&str>,
        figure: Option<String>,
    ) {
        let ink = tone.map_or(ACCENT, |t| theme::tone(t).0);
        let x = b.indent as f32;
        let mut y = 0.0f32;
        let [kicker_e, lead_e, note_e] = e;
        let same = |a: Option<&Fit>, b: Option<&Fit>| a.map(|f| (&f.text, f.size)) == b.map(|f| (&f.text, f.size));
        // Draws `after`, or both sides of a swap when `old` is given and the step is still changing.
        let swap =
            |dl: &mut DisplayList, old: Option<&dyn Fn(&mut DisplayList)>, new: &dyn Fn(&mut DisplayList)| match old {
                Some(old) if t < 1.0 => {
                    dl.group(|dl| {
                        dl.fade(1.0 - t as f32);
                        dl.translate(0.0, -20.0 * t as f32);
                        old(dl);
                    });
                    dl.group(|dl| {
                        dl.fade(t as f32);
                        dl.translate(0.0, 20.0 * (1.0 - t) as f32);
                        new(dl);
                    });
                }
                _ => new(dl),
            };
        if let Some(k) = &b.kicker {
            dl.group(|dl| {
                dl.fade((appear(2.0) * kicker_e.opacity) as f32);
                let old_k = before.and_then(|p| p.kicker.as_ref()).filter(|o| !same(Some(o), Some(k)));
                let old = old_k.map(|o| {
                    move |dl: &mut DisplayList| {
                        draw_fit(dl, o, x, y, TextOpts::new(MUTED));
                    }
                });
                swap(dl, old.as_ref().map(|f| f as &dyn Fn(&mut DisplayList)), &|dl| {
                    draw_fit(dl, k, x, y, TextOpts::new(MUTED));
                });
            });
            y += (k.height + Gap::KICKER) as f32;
        }
        let enter = |dl: &mut DisplayList, delay: f64, e: Emphasis| {
            let a = appear(delay);
            dl.fade((a * e.opacity) as f32);
            dl.translate(0.0, ((1.0 - a) * 24.0) as f32);
        };
        if let Some(l) = &b.lead {
            dl.group(|dl| {
                enter(dl, 5.0, lead_e);
                if l.kind == "quote" {
                    let size = l.main.size as f32 * QUOTE_SCALE as f32;
                    let st = Style::sans(800.0, size);
                    let base = -l.main.size as f32 * 0.5 + baseline_in(Face::Sans, size, size);
                    dl.group(|dl| {
                        dl.fade(0.9);
                        dl.text("“", st, 0.0, base, ink);
                    });
                }
                let counting = l.kind == "number" && figure.is_some();
                let old_l =
                    before.and_then(|p| p.lead.as_ref()).filter(|o| !counting && !same(Some(&o.main), Some(&l.main)));
                let old = old_l.map(|o| move |dl: &mut DisplayList| Self::draw_lead(dl, o, x, y, None, tone));
                swap(dl, old.as_ref().map(|f| f as &dyn Fn(&mut DisplayList)), &|dl| {
                    Self::draw_lead(dl, l, x, y, figure.as_deref(), tone)
                });
            });
            y += lead_dom_height(l) as f32;
        }
        if b.note.is_some() {
            let note_of = |dl: &mut DisplayList, blk: &TextBlock| {
                let Some(n) = &blk.note else { return };
                let mut ny = y + Gap::NOTE as f32;
                let kind = blk.lead.as_ref().map(|l| l.kind);
                if kind == Some("term") {
                    // The rule's top margin collapses into the note's.
                    dl.rect(x, ny, RULE_W as f32, RULE_H as f32, BoxStyle::fill(ink).radius(4.0));
                    ny += (RULE_H + Gap::RULE) as f32;
                }
                let color = if note_e.glow > 0.0 {
                    TEXT
                } else if matches!(kind, Some("term") | Some("number")) {
                    Color::rgba8(242, 244, 248, 0.88)
                } else {
                    MUTED
                };
                let mut nx = x;
                if kind == Some("quote") {
                    let h = n.height as f32;
                    dl.rect(nx, ny + h / 2.0 - 1.5, 40.0, 3.0, BoxStyle::fill(ink).radius(2.0));
                    nx += 58.0;
                }
                draw_fit(dl, n, nx, ny, TextOpts::new(color));
            };
            dl.group(|dl| {
                enter(dl, 14.0, note_e);
                let old_b = before.filter(|p| !same(p.note.as_ref(), b.note.as_ref()));
                let old = old_b.map(|p| move |dl: &mut DisplayList| note_of(dl, p));
                swap(dl, old.as_ref().map(|f| f as &dyn Fn(&mut DisplayList)), &|dl| note_of(dl, b));
            });
        }
    }

    fn draw_risk(&self, dl: &mut DisplayList, risk: &str, y: f32, appear: f64) -> f32 {
        let c = theme::risk_color(risk);
        let label = format!("{risk} risk").to_uppercase();
        let st = Style::sans(700.0, 24.0).spacing(1.5);
        let line = line_metrics(Face::Sans, 24.0).normal;
        let h = 20.0 + line.max(26.0) + 2.0;
        let w = 16.0 + 26.0 + 12.0 + width(&label, st) + 22.0 + 2.0;
        dl.group(|dl| {
            dl.fade(appear as f32);
            dl.scale_about(0.85 + 0.15 * appear as f32, 0.0, y + h / 2.0);
            dl.rect(
                0.0,
                y,
                w,
                h,
                BoxStyle::fill(c.fade(0x1f as f32 / 255.0)).radius(h / 2.0).border(c.fade(0x66 as f32 / 255.0), 1.0),
            );
            let icon = match risk {
                "low" => "ShieldCheck",
                "high" => "ShieldAlert",
                _ => "AlertTriangle",
            };
            icons::draw(dl, icon, 17.0, y + (h - 26.0) / 2.0, 26.0, c, 2.4);
            let base = y + (h - line) / 2.0 + baseline_in(Face::Sans, 24.0, line);
            dl.text(&label, st, 17.0 + 26.0 + 12.0, base, c);
        });
        h
    }
}

impl SceneView for TextView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let pop = |delay: f64| spring(frame - delay, FPS, Spring::damping(18.0).with_stiffness(120.0));
        let spot = Spotlight::new(frame, &f.segments.iter().skip(1).map(|s| s.from).collect::<Vec<_>>());
        let st = StateFrame::at(&self.states, f.segments, frame);
        let k = current_step(f.segments, frame);
        let now_at = match k {
            Some(k) if self.layouts.get(k + 1).is_some() => k + 1,
            _ => 0,
        };
        let l = &self.layouts[now_at];
        let before = (now_at > 0).then(|| &self.layouts[now_at - 1].block);

        // A number counts up from 0 as the scene opens, and from the figure before when a step sets a new one.
        let lead = l.block.lead.as_ref();
        let from = before.and_then(|b| b.lead.as_ref()).and_then(|l| l.count.as_ref());
        let recount = now_at > 0
            && before.and_then(|b| b.lead.as_ref()).map(|l| &l.main.text) != lead.map(|l| &l.main.text)
            && from.is_some();
        let counted = if recount {
            let s0 = f.segments[now_at].from;
            interpolate(frame, &[s0, s0 + 30.0], &[0.0, 1.0], CLAMP.eased(Easing::OutCubic))
        } else {
            interpolate(frame, &[6.0, 46.0], &[0.0, 1.0], CLAMP.eased(Easing::OutCubic))
        };
        let figure = lead.and_then(|lead| lead.count.as_ref()).and_then(|c| {
            if counted < 1.0 {
                count_text(c, counted, if recount { from } else { None })
            } else {
                Some(lead.unwrap().main.text.clone())
            }
        });
        let changing = before.is_some() && st.t < 1.0;

        let chips = self.stats.as_ref().map(|s| {
            vec![
                (true, format!("{} {}", s.files, if s.files == 1 { "file" } else { "files" }), MUTED),
                (false, format!("+{}", s.additions), theme::ADD),
                (false, format!("−{}", s.deletions), theme::DEL),
            ]
        });
        let draw_chips = |dl: &mut DisplayList, right: f32, top: f32| {
            let Some(chips) = &chips else { return };
            let total: f32 =
                chips.iter().map(|(i, t, _)| chip_width(*i, t)).sum::<f32>() + 12.0 * (chips.len() - 1) as f32;
            let mut x = right - total;
            dl.group(|dl| {
                dl.fade(clamped(frame, 10.0, 22.0, 0.0, 1.0) as f32);
                for (icon, text, color) in chips {
                    draw_chip(dl, x, top, *icon, text, *color);
                    x += chip_width(*icon, text) + 12.0;
                }
            });
        };
        let aside = chips.as_ref().map(|_| Aside { height: chip_height(), draw: &draw_chips });
        let view = self.camera.view(frame, f.segments, &|k| self.marks.get(k).cloned().flatten());

        self.shell.draw(dl, frame, f.duration, aside, |dl, bx| {
            self.camera.draw(dl, view, |dl| {
                let pos = stack(&self.scene, l, bx.h);
                if let Some(size) = l.mark {
                    let p = pop(10.0);
                    let e = self.emphasis(&spot, &st, "t:lead");
                    let size = size as f32;
                    let run = shape("?", Style::sans(800.0, size));
                    let gw = run.width;
                    let column = bx.w * QUESTION_ROOM as f32;
                    let (cx, cy) = (bx.w - column / 2.0, bx.h / 2.0);
                    dl.group(|dl| {
                        dl.fade((p * e.opacity) as f32);
                        dl.scale_about(0.9 + 0.1 * p as f32, cx, cy);
                        let (x0, y0) = (cx - gw / 2.0, cy - size * 0.4);
                        let base = y0 + baseline_in(Face::Sans, size, size * 0.8);
                        // `linear-gradient(160deg, accent 0%, rgba(124,140,255,0.08) 85%)` over the mark's box.
                        let Paint::Linear { start, end, stops } = Paint::css_linear(
                            160.0,
                            gw,
                            size * 0.8,
                            vec![(0.0, ACCENT), (0.85, Color::rgba8(124, 140, 255, 0.08))],
                        ) else {
                            unreachable!()
                        };
                        let fill =
                            Paint::Linear { start: (start.0 + x0, start.1 + y0), end: (end.0 + x0, end.1 + y0), stops };
                        dl.run_paint(run, x0, base, fill);
                    });
                }

                dl.group(|dl| {
                    dl.translate(0.0, pos.block);
                    let e = [
                        self.emphasis(&spot, &st, "t:kicker"),
                        self.emphasis(&spot, &st, "t:lead"),
                        self.emphasis(&spot, &st, "t:note"),
                    ];
                    self.draw_block(
                        dl,
                        &l.block,
                        if changing { before } else { None },
                        st.t,
                        &pop,
                        e,
                        None,
                        figure.clone(),
                    );
                });
                if let Some(risk) = &self.scene.risk {
                    self.draw_risk(dl, risk, pos.risk, pop(12.0));
                }
                for (i, (item, &y)) in l.items.iter().zip(&pos.items).enumerate() {
                    let p = pop(20.0 + i as f64 * 7.0);
                    let e = self.emphasis(&spot, &st, &format!("b:{i}"));
                    let size = item.size as f32;
                    let base = y + baseline_in(Face::Sans, size, size * item.line_height as f32);
                    dl.group(|dl| {
                        dl.fade((p * e.opacity) as f32);
                        dl.translate(((1.0 - p) * -36.0) as f32 + LIT_SHIFT * e.glow as f32, 0.0);
                        dl.group(|dl| {
                            let s = 1.0 + 0.5 * e.glow as f32;
                            dl.scale_about(s, 6.0, base - 12.0);
                            dl.rect(
                                0.0,
                                base - 18.0,
                                12.0,
                                12.0,
                                BoxStyle::fill(ACCENT).radius(4.0).shadow(Shadow::new(
                                    0.0,
                                    0.0,
                                    16.0 + 20.0 * e.glow as f32,
                                    ACCENT_GLOW,
                                )),
                            );
                        });
                        let color = if e.glow > 0.0 { TEXT } else { Color::rgba8(242, 244, 248, 0.9) };
                        draw_fit(
                            dl,
                            item,
                            34.0,
                            y,
                            TextOpts::new(color).weight(if e.glow > 0.0 { 600.0 } else { 400.0 }),
                        );
                    });
                }
                if let (Some(sides), Some(own)) = (&l.sides, &self.scene.sides) {
                    let y = pos.sides;
                    let inner = if l.mark.is_some() { bx.w * (1.0 - QUESTION_ROOM as f32) } else { bx.w };
                    let side_w = (inner - SIDE_GUTTER as f32 * 2.0) / 2.0;
                    let sides_h = sides.iter().map(side_dom_height).fold(0.0, f64::max) as f32;
                    dl.group(|dl| {
                        dl.fade(pop(18.0) as f32);
                        dl.fill_rect(side_w + SIDE_GUTTER as f32 - 1.0, y, 2.0, sides_h, BORDER);
                    });
                    for (i, side) in sides.iter().enumerate() {
                        let fields = &own[i];
                        let ink = fields
                            .tone
                            .as_deref()
                            .map_or(if i == 0 { theme::tone("neutral").0 } else { ACCENT }, |t| theme::tone(t).0);
                        let e = self.emphasis(&spot, &st, &format!("sd:{i}"));
                        let p = pop(12.0 + i as f64 * 10.0);
                        dl.group(|dl| {
                            dl.translate(i as f32 * (side_w + SIDE_GUTTER as f32 * 2.0), y + ((1.0 - p) * 24.0) as f32);
                            dl.fade((p * e.opacity) as f32);
                            let mut sy = 0.0;
                            if let Some(label) = &side.label {
                                sy += draw_fit(dl, label, 0.0, 0.0, TextOpts::new(ink)) + Gap::SIDE_LABEL as f32;
                            }
                            let figure = side.block.lead.as_ref().and_then(|l| l.count.as_ref()).and_then(|c| {
                                count_text(
                                    c,
                                    interpolate(frame, &[6.0, 46.0], &[0.0, 1.0], CLAMP.eased(Easing::OutCubic)),
                                    None,
                                )
                            });
                            dl.group(|dl| {
                                dl.translate(0.0, sy);
                                self.draw_block(
                                    dl,
                                    &side.block,
                                    None,
                                    1.0,
                                    &|_| 1.0,
                                    [CALM; 3],
                                    fields.tone.as_deref(),
                                    figure,
                                );
                            });
                            sy += block_dom_height(&side.block) as f32 + Gap::SIDE_LIST as f32;
                            for item in &side.items {
                                let size = item.size as f32;
                                let base = sy + baseline_in(Face::Sans, size, size * item.line_height as f32);
                                dl.rect(0.0, base - 15.0, 10.0, 10.0, BoxStyle::fill(ink).radius(3.0));
                                draw_fit(
                                    dl,
                                    item,
                                    32.0,
                                    sy,
                                    TextOpts::new(Color::rgba8(242, 244, 248, 0.9)).weight(500.0),
                                );
                                sy += (item.height + Gap::SIDE_ITEM) as f32;
                            }
                        });
                    }
                }
                self.board.draw(dl, frame, f.segments, &|_| None);
            });
        });
    }
}
