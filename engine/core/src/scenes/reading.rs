//! The reading scene: a pre-read's handoff, the first items of the reading order, numbered, and how many more
//! reading.md lists. A port of src/components/ReadingList.tsx, src/utils/readingLayout.ts and the reading order of
//! shared/reading.mjs.

use super::{Frame, SceneInput, SceneView};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit};
use crate::chrome::shell::{Shell, scene_chapter};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList};
use crate::markup::plain_text;
use crate::model::Hunk;
use crate::review::{Finding, findings, line_span, severity_ink};
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::{Family, Fit, Font, Slot, fit_text_at, measure};
use crate::theme::{BORDER, MUTED, TEXT, content_box};
use crate::timing::{FPS, build_frames, js_round};
use serde_json::Value;

const START: f64 = 12.0;
const READ_FIRST_MAX: usize = 6;
const MAX_FONT: i32 = 30;
const LINE_HEIGHT: f64 = 1.3;
const NUMBER_W: f64 = 52.0;
const ROW_PAD_X: f64 = 22.0;
const COL_GAP: f64 = 28.0;
const ROW_GAP: f64 = 12.0;
const WHY_GAP: f64 = 4.0;
const HEAD_H: f64 = 40.0;
const MORE_H: f64 = 44.0;
const WHERE_SHARE: f64 = 0.42;

struct Item {
    hunk_id: String,
    place: String,
    check: String,
    why: String,
    routine: bool,
    finding: Option<Finding>,
    explained_in: Option<String>,
    topic_id: Option<String>,
    also: Vec<String>,
}

struct Order {
    read_first: Vec<Item>,
    /// How many routine items sit on the skim lines.
    skim: usize,
}

fn strip_control(s: &str) -> String {
    s.chars().filter(|c| !(*c <= '\u{1f}' || *c == '\u{7f}')).collect()
}

/// The file of a hunk and where in it: (file, uses new lines, first and last line).
fn hunk_span(h: &Hunk) -> (String, bool, Option<(i64, i64)>) {
    let new = h.lines.iter().any(|l| l.new_line.is_some());
    let numbers: Vec<i64> = h.lines.iter().filter_map(|l| if new { l.new_line } else { l.old_line }).collect();
    let file = strip_control(&if new { h.file.clone() } else { h.old_file.clone().unwrap_or_else(|| h.file.clone()) });
    let range = numbers.iter().min().zip(numbers.iter().max()).map(|(a, b)| (*a, *b));
    (file, new, range)
}

fn span_text((a, b): (i64, i64)) -> String {
    if a == b { a.to_string() } else { format!("{a}-{b}") }
}

fn hunk_location(h: &Hunk, lines: &Value) -> String {
    let (file, new, range) = hunk_span(h);
    let Some(range) = range else { return file };
    let shown = line_span(lines).filter(|o| o.0 >= range.0 && o.1 <= range.1).unwrap_or(range);
    format!("{file}:{}{}", span_text(shown), if new { "" } else { " (removed)" })
}

/// The scene that explains `hunk_id`: of those citing it in `from`, the one that cites the fewest hunks.
fn explainer<'a>(scenes: &'a [Value], hunk_id: &str) -> Option<&'a Value> {
    let mut best: Option<(&Value, usize)> = None;
    for scene in scenes {
        let Some(from) = scene.get("from").and_then(Value::as_array) else { continue };
        if !from.iter().any(|v| v.as_str() == Some(hunk_id)) {
            continue;
        }
        if best.is_none_or(|(_, n)| from.len() < n) {
            best = Some((scene, from.len()));
        }
    }
    best.map(|b| b.0)
}

fn js_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => "undefined".into(),
    }
}

/// The items grouped by the topic of their explaining scene, flattened in the order the topics first appear.
fn by_topic(items: Vec<Item>) -> Vec<Item> {
    let mut keys: Vec<Option<String>> = Vec::new();
    for i in &items {
        if !keys.contains(&i.topic_id) {
            keys.push(i.topic_id.clone());
        }
    }
    let mut out = Vec::new();
    let mut rest = items;
    for k in keys {
        let (mine, other): (Vec<Item>, Vec<Item>) = rest.into_iter().partition(|i| i.topic_id == k);
        out.extend(mine);
        rest = other;
    }
    out
}

fn reading_order(input: &SceneInput) -> Option<Order> {
    let scenes = &input.props.storyboard.scenes;
    let scene = scenes.iter().find(|s| s.get("type").and_then(Value::as_str) == Some("reading"))?;
    let hunks = &input.props.hunks;
    let own = scene.get("items").and_then(Value::as_array).filter(|a| !a.is_empty());
    if own.is_none() && scene.get("items").is_some_and(Value::is_array) {
        return None;
    }
    let found = findings(&input.props.storyboard);
    let items: Vec<Item> = match own {
        Some(own) => own
            .iter()
            .filter_map(|item| {
                let id = item.get("hunkId")?.as_str()?;
                let hunk = hunks.get(id)?;
                let by = explainer(scenes, id);
                Some(Item {
                    hunk_id: id.to_string(),
                    place: hunk_location(hunk, item.get("lines").unwrap_or(&Value::Null)),
                    check: item.get("check").and_then(Value::as_str).unwrap_or("").to_string(),
                    why: item.get("why").and_then(Value::as_str).unwrap_or("").to_string(),
                    routine: item.get("routine") == Some(&Value::Bool(true)),
                    finding: item
                        .get("flag")
                        .and_then(Value::as_str)
                        .and_then(|f| found.iter().find(|x| x.id == f).cloned()),
                    explained_in: by.map(scene_chapter),
                    topic_id: by.and_then(|s| s.get("topic")).and_then(Value::as_str).map(str::to_string),
                    also: Vec::new(),
                })
            })
            .collect(),
        None => {
            let checks = input.props.storyboard.brief.as_ref().and_then(|b| b.get("check")).and_then(Value::as_array);
            checks
                .into_iter()
                .flatten()
                .filter(|c| c.get("file").is_some_and(Value::is_string) && c.get("what").is_some_and(Value::is_string))
                .enumerate()
                .map(|(i, c)| Item {
                    hunk_id: format!("check:{i}"),
                    place: format!("{}:{}", strip_control(c["file"].as_str().unwrap_or("")), js_text(c.get("line"))),
                    check: c["what"].as_str().unwrap_or("").to_string(),
                    why: c.get("why").and_then(Value::as_str).unwrap_or("").to_string(),
                    routine: false,
                    finding: None,
                    explained_in: None,
                    topic_id: None,
                    also: Vec::new(),
                })
                .collect()
        }
    };
    let (routine, to_read): (Vec<Item>, Vec<Item>) = items.into_iter().partition(|i| i.routine);
    let mut read_first = by_topic(to_read);
    // A routine hunk of a file the reader already reads rides on that file's item.
    let mut skim = 0;
    for item in routine {
        let file = hunk_span(&hunks[&item.hunk_id]).0;
        let host = read_first.iter_mut().find(|r| hunks.get(&r.hunk_id).is_some_and(|h| hunk_span(h).0 == file));
        match host {
            Some(host) => {
                let rest: String = item.place.chars().skip(file.chars().count() + 1).collect();
                if !rest.is_empty() {
                    host.also.push(rest);
                }
            }
            None => skim += 1,
        }
    }
    Some(Order { read_first, skim })
}

fn also_text(item: &Item) -> String {
    if item.also.is_empty() { String::new() } else { format!(", also {}", item.also.join(", ")) }
}

fn flag_text(f: &Finding) -> String {
    let word = match f.severity.as_str() {
        "bug" => "likely bug",
        "risk" => "risk",
        "nit" => "nit",
        other => other,
    };
    let claim = plain_text(&f.claim).split_whitespace().collect::<Vec<_>>().join(" ");
    format!("Claude: {word}, {claim}")
}

struct Placed {
    index: usize,
    y: f64,
    h: f64,
    place: Fit,
    explained: Option<Fit>,
    check: Fit,
    why: Option<Fit>,
    flag: Option<Fit>,
}

struct Layout {
    rows: Vec<Placed>,
    line_height: f64,
    where_x: f64,
    check_x: f64,
    more_to_read: usize,
    routine: usize,
    height: f64,
}

fn attempt(shown: &[Item], width: f64, font: f64) -> Layout {
    let line_height = js_round(font * LINE_HEIGHT);
    let where_font = js_round(font * 0.8);
    let note_font = js_round(font * 0.62);
    let flag_font = js_round(font * 0.76);
    let why_font = js_round(font * 0.72);
    let pad = js_round(font * 0.5);
    let where_x = ROW_PAD_X + NUMBER_W + COL_GAP;
    let weight = Slot::named("findingWhere", 0.0).weight;
    let widest = shown
        .iter()
        .map(|i| measure(&format!("{}{}", i.place, also_text(i)), &Font::new(Family::Mono, weight, where_font)))
        .fold(0.0, f64::max);
    let where_w = widest.min((width - where_x) * WHERE_SHARE).ceil();
    let check_x = where_x + where_w + COL_GAP;
    let check_w = width - check_x - ROW_PAD_X;
    let mut y = HEAD_H;
    let rows = shown
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let place = fit_text_at(
                &format!("{}{}", item.place, also_text(item)),
                &Slot::named("findingWhere", where_w),
                where_font,
            );
            let explained = item
                .explained_in
                .as_ref()
                .map(|c| fit_text_at(&format!("Explained in: {c}"), &Slot::named("readingNote", where_w), note_font));
            let check = fit_text_at(&item.check, &Slot::named("readingCheck", check_w), font);
            let why =
                (!item.why.is_empty()).then(|| fit_text_at(&item.why, &Slot::named("readingWhy", check_w), why_font));
            let flag = item
                .finding
                .as_ref()
                .map(|f| fit_text_at(&flag_text(f), &Slot::named("readingFlag", check_w), flag_font));
            let left = place.height + explained.as_ref().map_or(0.0, |e| e.height + 4.0);
            let right = check.lines.len().max(1) as f64 * line_height
                + why.as_ref().map_or(0.0, |w| WHY_GAP + w.height)
                + flag.as_ref().map_or(0.0, |f| 6.0 + f.height);
            let h = left.max(right) + 2.0 * pad;
            let row = Placed { index, y, h, place, explained, check, why, flag };
            y += h + ROW_GAP;
            row
        })
        .collect();
    Layout { rows, line_height, where_x, check_x, more_to_read: 0, routine: 0, height: HEAD_H.max(y - ROW_GAP) }
}

fn layout(order: &Order, width: f64, height: f64) -> Layout {
    let shown = &order.read_first[..order.read_first.len().min(READ_FIRST_MAX)];
    let more_to_read = order.read_first.len() - shown.len();
    let routine = order.skim;
    let room = height - if more_to_read > 0 || routine > 0 { MORE_H } else { 0.0 };
    let min = Slot::named("readingCheck", 0.0).min as i32;
    let fits = |l: &Layout| {
        l.height <= room
            && l.rows.iter().all(|r| {
                r.check.fits
                    && r.why.as_ref().is_none_or(|f| f.fits)
                    && r.flag.as_ref().is_none_or(|f| f.fits)
                    && r.explained.as_ref().is_none_or(|f| f.fits)
            })
    };
    let mut last = attempt(shown, width, min as f64);
    for font in (min..=MAX_FONT).rev() {
        last = attempt(shown, width, font as f64);
        if fits(&last) {
            break;
        }
    }
    Layout { more_to_read, routine, ..last }
}

/// "+2 more to read, +3 routine".
fn more_text(l: &Layout) -> String {
    let parts: Vec<String> = [
        (l.more_to_read > 0).then(|| format!("+{} more to read", l.more_to_read)),
        (l.routine > 0).then(|| format!("+{} routine", l.routine)),
    ]
    .into_iter()
    .flatten()
    .collect();
    parts.join(", ")
}

struct ReadingView {
    shell: Shell,
    layout: Option<Layout>,
    items: Vec<Option<Finding>>,
    box_w: f32,
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let has_title = input.scene.get("title").and_then(Value::as_str).is_some_and(|t| !t.is_empty());
    let (bw, bh) = content_box(has_title);
    let order = reading_order(input);
    let items = order.as_ref().map(|o| o.read_first.iter().map(|i| i.finding.clone()).collect()).unwrap_or_default();
    let layout = order.as_ref().map(|o| layout(o, bw, bh));
    Ok(Box::new(ReadingView { shell: Shell::new(input.scene), layout, items, box_w: bw as f32 }))
}

impl ReadingView {
    fn row(&self, dl: &mut DisplayList, l: &Layout, row: &Placed, at: f64, frame: f64) {
        let finding = &self.items[row.index];
        let ink_hex = finding.as_ref().map_or("#7c8cff", |f| severity_ink(&f.severity));
        let ink = Color::css(ink_hex);
        let land = spring(frame - at, FPS, Spring::damping(17.0).with_stiffness(120.0));
        let (y, h) = (row.y as f32, row.h as f32);
        dl.group(|dl| {
            dl.fade(land as f32);
            dl.translate((1.0 - land as f32) * -40.0, 0.0);
            let edge = if finding.is_some() { Color::css(&format!("{ink_hex}66")) } else { BORDER };
            dl.rect(
                0.0,
                y,
                self.box_w,
                h,
                BoxStyle::fill(Color::rgba8(255, 255, 255, 0.03)).radius(14.0).border(edge, 1.0),
            );
            // The number: a 52px circle with a 2px border (this box is border-box in Remotion's render).
            let cy = y + (h - NUMBER_W as f32) / 2.0;
            let cx = ROW_PAD_X as f32;
            dl.rect(
                cx,
                cy,
                NUMBER_W as f32,
                NUMBER_W as f32,
                BoxStyle::fill(Color::css(&format!("{ink_hex}1f")))
                    .radius(26.0)
                    .border(Color::css(&format!("{ink_hex}99")), 2.0),
            );
            let label = (row.index + 1).to_string();
            let st = Style::mono(800.0, 24.0);
            let nl = line_metrics(Face::Mono, 24.0).normal;
            dl.text(
                &label,
                st,
                cx + (NUMBER_W as f32 - width(&label, st)) / 2.0,
                cy + (NUMBER_W as f32 - nl) / 2.0 + baseline_in(Face::Mono, 24.0, nl),
                ink,
            );
            let mut ly =
                y + (h - row.place.height as f32 - row.explained.as_ref().map_or(0.0, |e| e.height as f32 + 4.0)) / 2.0;
            ly += draw_fit(dl, &row.place, l.where_x as f32, ly, TextOpts::new(TEXT));
            if let Some(e) = &row.explained {
                draw_fit(dl, e, l.where_x as f32, ly + 4.0, TextOpts::new(MUTED));
            }
            let lines = row.check.lines.len().max(1) as f64;
            let mut cy = y
                + (h - (lines * l.line_height) as f32
                    - row.why.as_ref().map_or(0.0, |w| (WHY_GAP + w.height) as f32)
                    - row.flag.as_ref().map_or(0.0, |f| (6.0 + f.height) as f32))
                    / 2.0;
            let lh = LineHeight::Times((l.line_height / row.check.size) as f32);
            draw_fit(dl, &row.check, l.check_x as f32, cy, TextOpts::new(TEXT).line_height(lh));
            cy += (lines * l.line_height) as f32;
            if let Some(w) = &row.why {
                draw_fit(dl, w, l.check_x as f32, cy + WHY_GAP as f32, TextOpts::new(MUTED));
                cy += (WHY_GAP + w.height) as f32;
            }
            if let Some(f) = &row.flag {
                draw_fit(dl, f, l.check_x as f32, cy + 6.0, TextOpts::new(ink));
            }
        });
    }
}

impl SceneView for ReadingView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        self.shell.draw(dl, f.frame, f.duration, None, |dl, _bx| {
            let Some(l) = &self.layout else { return };
            let n = l.rows.len() as f64;
            let stagger = 8f64.min((build_frames("reading") - START - 14.0) / (n - 1.0).max(1.0));
            let more_at = START + n * stagger;
            let head = Style::sans(800.0, 20.0).spacing(2.5);
            let hl = line_metrics(Face::Sans, 20.0).normal;
            dl.text("READ FIRST", head, ROW_PAD_X as f32, baseline_in(Face::Sans, 20.0, hl), MUTED);
            for (i, row) in l.rows.iter().enumerate() {
                self.row(dl, l, row, START + i as f64 * stagger, f.frame);
            }
            let more = more_text(l);
            if !more.is_empty() {
                let a = interpolate(f.frame, &[more_at, more_at + 10.0], &[0.0, 1.0], CLAMP) as f32;
                dl.group(|dl| {
                    dl.fade(a);
                    let sans = Style::sans(400.0, 22.0);
                    let mono = Style::mono(400.0, 22.0);
                    let base = line_metrics(Face::Sans, 22.0).ascent.max(line_metrics(Face::Mono, 22.0).ascent);
                    let y = l.height as f32 + 14.0 + base;
                    let mut x = (ROW_PAD_X + NUMBER_W + COL_GAP) as f32;
                    x += dl.text(&format!("{more}, in "), sans, x, y, MUTED);
                    dl.text("reading.md", mono, x, y, MUTED);
                });
            }
        });
    }
}
