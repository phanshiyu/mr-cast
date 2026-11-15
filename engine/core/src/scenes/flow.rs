//! The flow scene: a request's steps in a rail at the left, a strip naming who acts now and next, and a card with
//! each step's payload or action. A port of src/components/DataFlow.tsx and src/utils/flowLayout.ts.

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, drawn_width, fit_height};
use crate::chrome::shell::Shell;
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Shadow};
use crate::icons;
use crate::model::{Hunk, HunkStatus, LineType, TokenLine};
use crate::steps::spotlight_starts;
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::{Fit, Slot, fit_lines, fit_text};
use crate::theme;
use crate::theme::{
    ACCENT, ACCENT_GLOW, ACCENT_SOFT, BORDER, BORDER_STRONG, FAINT, MUTED, RAISED, SURFACE, TEXT, content_box,
};
use crate::timing::{FPS, build_frames, js_round};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

const LIST_W: f64 = 600.0;
const CODE_LIST_W: f64 = 420.0;
const COLUMN_GAP: f32 = 56.0;
const STRIP_H: f32 = 76.0;
const STRIP_GAP: f32 = 20.0;
const BADGE: f64 = 48.0 + 22.0;
const CHIP_PAD: f64 = 24.0;
const CHIP_ICON: f64 = 19.0 + 8.0;
const PAYLOAD_PAD: f64 = 52.0;
const HEADLINE_PAD: f64 = 64.0;
const STRIP_SHARE: f64 = 0.4;
const TRANSITION: f64 = 14.0;
const ROWS_START: f64 = 4.0;
const ROWS_END: f64 = 16.0;

#[derive(Deserialize)]
struct FlowStep {
    actor: String,
    action: String,
    payload: Option<String>,
    icon: Option<String>,
    tone: Option<String>,
    code: Option<StageCode>,
}

/// A stage's real code: lines of a hunk or snippet, some lit (shared/flow-code.mjs).
#[derive(Deserialize)]
struct StageCode {
    hunk: Option<String>,
    snippet: Option<String>,
    lines: Option<Value>,
    light: Option<Value>,
}

#[derive(Deserialize)]
struct FlowScene {
    title: Option<String>,
    steps: Vec<FlowStep>,
}

enum Card {
    Payload {
        lines: Fit,
        tokens: Vec<TokenLine>,
    },
    Headline(Fit),
    /// Real lines of the diff: the hunk, its rows (hunk line index, lit), whether any is lit, its tokens and the fit.
    Code {
        hunk: Box<Hunk>,
        rows: Vec<(usize, bool)>,
        light: bool,
        tokens: Vec<TokenLine>,
        lines: Fit,
        where_: String,
    },
}

/// "47-60" or 47 as [first, last] (`parseSpan`).
fn parse_span(r: Option<&Value>) -> Option<(i64, i64)> {
    let r = r?;
    if let Some(n) = r.as_i64() {
        return (n > 0).then_some((n, n));
    }
    let t = r.as_str()?.trim();
    let (a, b) = match t.split_once('-') {
        Some((a, b)) => (a.trim().parse().ok()?, b.trim().parse().ok()?),
        None => {
            let n: i64 = t.parse().ok()?;
            (n, n)
        }
    };
    (a >= 1 && a <= b).then_some((a, b))
}

/// The rows a stage's `code` shows, each lit or not, and the first line's number (`codeRows`); None for a problem.
fn code_rows(hunk: &Hunk, code: &StageCode) -> Option<(Vec<(usize, bool)>, i64)> {
    let number = |l: &crate::model::DiffLine| if hunk.status == HunkStatus::Deleted { l.old_line } else { l.new_line };
    let (a, b) = parse_span(code.lines.as_ref())?;
    let nums: Vec<i64> = hunk.lines.iter().filter_map(number).collect();
    let (lo, hi) = (*nums.iter().min()?, *nums.iter().max()?);
    if a < lo || b > hi {
        return None;
    }
    let picked: Vec<usize> = hunk
        .lines
        .iter()
        .enumerate()
        .filter(|(_, l)| number(l).is_some_and(|n| n >= a && n <= b))
        .map(|(i, _)| i)
        .collect();
    let (&from, &to) = (picked.first()?, picked.last()?);
    let mut rows: Vec<(usize, bool)> = (from..=to).map(|i| (i, false)).collect();
    if code.light.is_some() {
        let (la, lb) = parse_span(code.light.as_ref())?;
        let mut any = false;
        for row in &mut rows {
            if number(&hunk.lines[row.0]).is_some_and(|n| n >= la && n <= lb) {
                row.1 = true;
                any = true;
            }
        }
        if !any {
            return None;
        }
    }
    Some((rows, number(&hunk.lines[from])?))
}

const CODE_BAR_H: f32 = 64.0;
const CODE_PAD: f32 = 24.0;

fn code_card(code: &StageCode, input: &SceneInput, width: f64, height: f64) -> Option<Card> {
    let id = code.hunk.as_ref().or(code.snippet.as_ref())?;
    let hunk = input.props.hunks.get(id)?;
    let (rows, first) = code_rows(hunk, code)?;
    let column = width - 2.0 * CODE_PAD as f64 - 92.0;
    let room = height - CODE_BAR_H as f64 - 2.0 * CODE_PAD as f64;
    let texts: Vec<String> = rows.iter().map(|r| hunk.lines[r.0].text.replace('\t', "  ")).collect();
    let plain = input.props.highlight.plain.clone().unwrap_or_else(|| "#abb2bf".into());
    let tokens = input
        .props
        .highlight
        .hunks
        .get(id)
        .cloned()
        .unwrap_or_else(|| hunk.lines.iter().map(|l| vec![(l.text.clone(), plain.clone())]).collect());
    Some(Card::Code {
        light: rows.iter().any(|r| r.1),
        where_: format!("{}:{first}", hunk.file),
        lines: fit_lines(&texts, &Slot::named("flowCode", column), room),
        hunk: Box::new(hunk.clone()),
        rows,
        tokens,
    })
}

struct Row {
    actor: Fit,
    action: Fit,
    idle: Fit,
    /// A code stage's `path:line` under its action.
    where_: Option<Fit>,
}

struct FlowView {
    shell: Shell,
    steps: Vec<FlowStep>,
    step_h: f32,
    list_w: f32,
    /// The storyboard's icons (`props.icons`).
    icons: HashMap<String, Vec<String>>,
    panel_w: f32,
    card_h: f32,
    rows: Vec<Row>,
    strip: Vec<Fit>,
    cards: Vec<Card>,
    intro: Card,
}

/// Pretty-printed JSON when the payload parses, otherwise the raw text (`formatPayload`).
fn format_payload(payload: &str) -> (String, &'static str) {
    match serde_json::from_str::<serde_json::Value>(payload) {
        Ok(v) => (js_pretty(&v), "json"),
        Err(_) => (payload.to_string(), "plain"),
    }
}

/// `JSON.stringify(v, null, 2)`.
fn js_pretty(v: &serde_json::Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

fn card(action: &str, payload: Option<&str>, input: &SceneInput, width: f64, height: f64) -> Card {
    let Some(payload) = payload.filter(|p| !p.is_empty()) else {
        return Card::Headline(fit_text(action, &Slot::named("flowHeadline", width - 2.0 * HEADLINE_PAD)));
    };
    let (text, language) = format_payload(payload);
    let lines: Vec<String> = text.split('\n').map(str::to_string).collect();
    let plain = input.props.highlight.plain.clone().unwrap_or_else(|| "#abb2bf".into());
    let tokens = input
        .props
        .highlight
        .snippets
        .get(&format!("{language}\n{text}"))
        .cloned()
        .unwrap_or_else(|| lines.iter().map(|l| vec![(l.clone(), plain.clone())]).collect());
    Card::Payload {
        lines: fit_lines(&lines, &Slot::named("payload", width - 2.0 * PAYLOAD_PAD), height - 48.0),
        tokens,
    }
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let scene: FlowScene = parse(input)?;
    if scene.steps.is_empty() {
        return Err("a flow scene without steps".into());
    }
    let (bw, bh) = content_box(scene.title.is_some());
    let n = scene.steps.len() as f64;
    let step_h = 170f64.min(bh / n);
    // A flow with real code narrows its rail, so the code panel has room for long lines.
    let list_w = if scene.steps.iter().any(|s| s.code.is_some()) { CODE_LIST_W } else { LIST_W };
    let panel_w = bw - list_w - COLUMN_GAP as f64;
    let card_h = bh - STRIP_H as f64 - STRIP_GAP as f64;
    let text_w = list_w - BADGE;
    let lines = if step_h >= 150.0 { 2 } else { 1 };
    let rows: Vec<Row> = scene
        .steps
        .iter()
        .map(|s| {
            let mut action = Slot::named("flowAction", text_w);
            action.lines = lines;
            let mut idle = action.clone();
            idle.size = 27.0;
            idle.weight = 500.0;
            Row {
                actor: fit_text(
                    &s.actor,
                    &Slot::named("flowActor", text_w - CHIP_PAD - if s.icon.is_some() { CHIP_ICON } else { 0.0 }),
                ),
                action: fit_text(&s.action, &action),
                idle: fit_text(&s.action, &idle),
                where_: None,
            }
        })
        .collect();
    let strip =
        scene.steps.iter().map(|s| fit_text(&s.actor, &Slot::named("flowStrip", panel_w * STRIP_SHARE))).collect();
    let cards: Vec<Card> = scene
        .steps
        .iter()
        .map(|s| {
            s.code
                .as_ref()
                .and_then(|c| code_card(c, input, panel_w, card_h))
                .unwrap_or_else(|| card(&s.action, s.payload.as_deref(), input, panel_w, card_h))
        })
        .collect();
    // The rail's `path:line` of a code stage, with directories dropped from its front while it is too wide.
    let wheres: Vec<Option<Fit>> = cards
        .iter()
        .map(|c| {
            let Card::Code { where_, .. } = c else { return None };
            let slot = Slot::named("flowWhere", text_w);
            let parts: Vec<&str> = where_.split('/').collect();
            let mut fit = fit_text(where_, &slot);
            let mut from = 1;
            while !fit.fits && from < parts.len() {
                fit = fit_text(&parts[from..].join("/"), &slot);
                from += 1;
            }
            Some(fit)
        })
        .collect();
    let mut rows: Vec<Row> = rows;
    for (r, w) in rows.iter_mut().zip(wheres) {
        r.where_ = w;
    }
    let intro_text = scene.title.clone().unwrap_or_else(|| format!("{} steps", scene.steps.len()));
    let intro = card(&intro_text, None, input, panel_w, card_h);
    Ok(Box::new(FlowView {
        shell: Shell::new(input.scene),
        steps: scene.steps,
        step_h: step_h as f32,
        list_w: list_w as f32,
        icons: input.props.icons.clone(),
        panel_w: panel_w as f32,
        card_h: card_h as f32,
        rows,
        strip,
        cards,
        intro,
    }))
}

#[derive(Clone, Copy, PartialEq)]
enum State {
    Past,
    Active,
    Future,
}

impl FlowView {
    fn row(&self, dl: &mut DisplayList, i: usize, state: State, y: f32) {
        let active = state == State::Active;
        let past = state == State::Past;
        let row = &self.rows[i];
        // The number badge.
        let fill = if active {
            ACCENT
        } else if past {
            Color::css("#1d2140")
        } else {
            RAISED
        };
        let mut b = BoxStyle::fill(fill).radius(24.0).border(if active || past { ACCENT } else { BORDER_STRONG }, 2.0);
        if active {
            b = b.shadow(Shadow::new(0.0, 0.0, 28.0, ACCENT_GLOW));
        }
        dl.rect(0.0, y, 48.0, 48.0, b);
        if past {
            icons::draw(dl, "Check", 12.0, y + 12.0, 24.0, ACCENT, 3.0);
        } else {
            let label = (i + 1).to_string();
            let st = Style::sans(700.0, 22.0);
            let lh = line_metrics(Face::Sans, 22.0).normal;
            let w = width(&label, st);
            dl.text(
                &label,
                st,
                24.0 - w / 2.0,
                y + (48.0 - lh) / 2.0 + baseline_in(Face::Sans, 22.0, lh),
                if active { Color::css("#0b0d18") } else { FAINT },
            );
        }
        // The actor chip, the action under it.
        dl.group(|dl| {
            dl.fade(match state {
                State::Past => 0.55,
                State::Future => 0.4,
                State::Active => 1.0,
            });
            let x = 70.0;
            let top = y + 2.0;
            let size = row.actor.size as f32;
            let chip_line = line_metrics(Face::Mono, size).normal;
            let chip_h = chip_line + 6.0;
            let step = &self.steps[i];
            let icon = step.icon.as_deref().filter(|n| self.icons.contains_key(*n));
            let chip_w =
                drawn_width(&row.actor, &row.actor.lines[0], None) + 24.0 + if icon.is_some() { 27.0 } else { 0.0 };
            let tone = step.tone.as_deref().map(theme::tone);
            let ink = tone.map_or(if active { ACCENT } else { MUTED }, |t| t.0);
            let bg = tone.map_or(if active { ACCENT_SOFT } else { Color::rgba8(255, 255, 255, 0.05) }, |t| t.1);
            dl.rect(x, top, chip_w, chip_h, BoxStyle::fill(bg).radius(8.0));
            let mut tx = x + 12.0;
            if let Some(name) = icon {
                // An inline-block 19px icon, `vertical-align: -3px`: its bottom 3px under the baseline.
                let base = top + 3.0 + baseline_in(Face::Mono, size, chip_line);
                icons::draw_named(dl, &self.icons, name, tx, base + 3.0 - 19.0, 19.0, ink, 2.2);
                tx += 27.0;
            }
            draw_fit(dl, &row.actor, tx, top + 3.0, TextOpts::new(ink).normal());
            // The chip's bottom edge is its baseline, on the line of the column's 16px text.
            let strut = line_metrics(Face::Sans, 16.0);
            let line_h = chip_h.max(strut.ascent) + strut.descent;
            let fit = if active { &row.action } else { &row.idle };
            let h = draw_fit(dl, fit, x, top + line_h + 6.0, TextOpts::new(TEXT));
            if let Some(w) = &row.where_ {
                draw_fit(dl, w, x, top + line_h + 6.0 + h + 4.0, TextOpts::new(MUTED));
            }
        });
    }

    fn payload(&self, dl: &mut DisplayList, card: &Card, w: f32, h: f32) {
        match card {
            Card::Code { hunk, rows, light, tokens, lines, .. } => {
                // The file bar, then each line in the code scene's own colours, unlit lines dimmed.
                let bar = Style::mono(600.0, 22.0);
                let m22 = line_metrics(Face::Mono, 22.0).normal;
                dl.fill_rect(CODE_PAD, CODE_BAR_H - 1.0, w - 2.0 * CODE_PAD, 1.0, BORDER);
                dl.text(
                    &hunk.file,
                    bar,
                    CODE_PAD + 6.0,
                    (CODE_BAR_H - 1.0 - m22) / 2.0 + baseline_in(Face::Mono, 22.0, m22),
                    TEXT,
                );
                let size = lines.size as f32;
                let row_h = size * lines.line_height as f32;
                let st = Style::mono(400.0, size);
                let small = js_round(size as f64 * 0.85) as f32;
                let mut y = CODE_BAR_H + CODE_PAD;
                for &(i, lit) in rows {
                    let line = &hunk.lines[i];
                    dl.group(|dl| {
                        dl.fade(if *light && !lit { 0.45 } else { 1.0 });
                        let bg = match line.kind {
                            LineType::Add => theme::ADD_BG,
                            LineType::Del => theme::DEL_BG,
                            LineType::Context => Color::TRANSPARENT,
                        };
                        dl.fill_rect(CODE_PAD, y, w - 2.0 * CODE_PAD, row_h, bg);
                        if lit {
                            dl.fill_rect(CODE_PAD, y, 4.0, row_h, ACCENT);
                        }
                        let center = |face: Face, sz: f32| {
                            let m = line_metrics(face, sz);
                            y + (row_h - m.normal) / 2.0 + m.ascent
                        };
                        if let Some(n) = line.new_line.or(line.old_line) {
                            let t = n.to_string();
                            let sst = Style::mono(400.0, small);
                            dl.text(&t, sst, CODE_PAD + 66.0 - 14.0 - width(&t, sst), center(Face::Mono, small), FAINT);
                        }
                        let (sign, sc) = match line.kind {
                            LineType::Add => ("+", theme::ADD),
                            LineType::Del => ("−", theme::DEL),
                            LineType::Context => (" ", FAINT),
                        };
                        dl.text(sign, Style::mono(700.0, size), CODE_PAD + 66.0, center(Face::Mono, size), sc);
                        let mut pen = CODE_PAD + 92.0;
                        let base = center(Face::Mono, size);
                        for (text, color) in tokens.get(i).map_or(&[][..], |t| &t[..]) {
                            pen += dl.text(&text.replace('\t', "  "), st, pen, base, Color::css(color));
                        }
                    });
                    y += row_h;
                }
            }
            Card::Headline(fit) => {
                let fh = fit_height(fit, LineHeight::Fit);
                draw_fit(
                    dl,
                    fit,
                    HEADLINE_PAD as f32,
                    (h - fh) / 2.0,
                    TextOpts::new(TEXT).centered(w - 2.0 * HEADLINE_PAD as f32),
                );
            }
            Card::Payload { lines, tokens } => {
                let size = lines.size as f32;
                let lh = size * 1.5;
                let top = (h - lh * tokens.len() as f32) / 2.0;
                let st = Style::mono(400.0, size);
                for (i, line) in tokens.iter().enumerate() {
                    let base = top + i as f32 * lh + baseline_in(Face::Mono, size, lh);
                    let mut x = PAYLOAD_PAD as f32;
                    for (text, color) in line {
                        x += dl.text(text, st, x, base, Color::css(color));
                    }
                }
            }
        }
    }
}

impl SceneView for FlowView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let frame = f.frame;
        let n = self.steps.len();
        let said = f.segments.len() > 1;
        let starts = spotlight_starts(f.segments, n, build_frames("flow"));
        let reached = starts.iter().filter(|&&s| frame >= s).count() as i64 - 1;
        let active = if said { reached } else { reached.max(0) };
        let local = if active < 0 { 0.0 } else { frame - starts[active as usize] };
        let stagger = 4f64.min((ROWS_END - ROWS_START) / ((n as f64) - 1.0).max(1.0));
        let enter = if active <= 0 && !said { 1.0 } else { interpolate(local, &[0.0, TRANSITION], &[0.0, 1.0], CLAMP) };
        let progress = if active < 0 { 0.0 } else { (active as f64 + enter) / n as f64 };
        let previous = active > 0 && local < TRANSITION;

        self.shell.draw(dl, frame, f.duration, None, |dl, bx| {
            // The rail.
            let span = self.step_h * (n as f32 - 1.0);
            dl.fill_rect(23.0, 24.0, 3.0, span, BORDER);
            let done = (active as f32 / ((n as f32) - 1.0).max(1.0)).clamp(0.0, 1.0);
            dl.fill_rect(23.0, 24.0, 3.0, span * done, ACCENT);
            for i in 0..n {
                let state = match (i as i64).cmp(&active) {
                    std::cmp::Ordering::Less => State::Past,
                    std::cmp::Ordering::Equal => State::Active,
                    std::cmp::Ordering::Greater => State::Future,
                };
                let appear = spring(frame - ROWS_START - i as f64 * stagger, FPS, Spring::damping(18.0));
                dl.group(|dl| {
                    dl.fade(appear as f32);
                    self.row(dl, i, state, i as f32 * self.step_h);
                });
            }

            // The panel: the strip and the card share the column's height, shrinking as CSS flex does.
            dl.group(|dl| {
                dl.translate(self.list_w + COLUMN_GAP, 0.0);
                let w = self.panel_w;
                let over = (STRIP_H + STRIP_GAP + self.card_h + 2.0 - bx.h).max(0.0);
                let (strip_inner, card_inner) = (STRIP_H - 2.0, self.card_h);
                let strip_h = STRIP_H - over * strip_inner / (strip_inner + card_inner);
                let card_h = self.card_h + 2.0 - over * card_inner / (strip_inner + card_inner);
                dl.rect(
                    0.0,
                    0.0,
                    w,
                    strip_h,
                    BoxStyle::fill(Color::rgba8(255, 255, 255, 0.03)).radius(16.0).border(BORDER, 1.0),
                );
                let mid = strip_h / 2.0;
                let mono24 = line_metrics(Face::Mono, 24.0).normal;
                let mut x = 29.0;
                let label = |dl: &mut DisplayList, x: f32, text: &str, weight: f32, color: Color| -> f32 {
                    let st = Style::mono(weight, 24.0);
                    dl.text(text, st, x, mid - mono24 / 2.0 + baseline_in(Face::Mono, 24.0, mono24), color)
                };
                let cur = (active >= 0).then_some(active as usize);
                match cur {
                    Some(k) => {
                        let fit = &self.strip[k];
                        let lh = line_metrics(Face::Mono, fit.size as f32).normal;
                        draw_fit(dl, fit, x, mid - lh / 2.0, TextOpts::new(ACCENT).normal());
                        x += drawn_width(fit, &fit.lines[0], None);
                    }
                    None => x += label(dl, x, "start", 700.0, FAINT),
                }
                x += 18.0;
                let next = cur.map_or(Some(0), |k| (k + 1 < n).then_some(k + 1));
                icons::draw(dl, "ArrowRight", x, mid - 13.0, 26.0, if next.is_some() { MUTED } else { FAINT }, 2.0);
                x += 26.0 + 18.0;
                match next {
                    Some(k) => {
                        let fit = &self.strip[k];
                        let lh = line_metrics(Face::Mono, fit.size as f32).normal;
                        draw_fit(dl, fit, x, mid - lh / 2.0, TextOpts::new(TEXT).normal().weight(400.0));
                    }
                    None => {
                        label(dl, x, "done", 400.0, FAINT);
                    }
                }
                let count = format!("step {}/{}", (active + 1).max(0), n);
                let st = Style::mono(400.0, 20.0);
                let lh = line_metrics(Face::Mono, 20.0).normal;
                let cw = width(&count, st);
                dl.text(&count, st, w - 29.0 - cw, mid - lh / 2.0 + baseline_in(Face::Mono, 20.0, lh), FAINT);

                // The card.
                let top = strip_h + STRIP_GAP;
                dl.rect(
                    0.0,
                    top,
                    w,
                    card_h,
                    BoxStyle::fill(SURFACE).radius(22.0).border(BORDER, 1.0).shadow(Shadow::new(
                        0.0,
                        30.0,
                        80.0,
                        Color::rgba8(0, 0, 0, 0.45),
                    )),
                );
                dl.push_clip(1.0, top + 1.0, w - 2.0, card_h - 2.0, 21.0);
                dl.group(|dl| {
                    dl.translate(1.0, top + 1.0);
                    let (iw, ih) = (w - 2.0, card_h - 2.0);
                    dl.group(|dl| {
                        dl.fade(0.7);
                        dl.fill_rect(0.0, 0.0, iw * progress as f32, 4.0, ACCENT);
                    });
                    match cur {
                        None => self.payload(dl, &self.intro, iw, ih),
                        Some(k) => {
                            if previous {
                                dl.group(|dl| {
                                    dl.fade(1.0 - enter as f32);
                                    dl.translate(-(enter as f32) * 80.0, 0.0);
                                    self.payload(dl, &self.cards[k - 1], iw, ih);
                                });
                            }
                            dl.group(|dl| {
                                dl.fade(enter as f32);
                                dl.translate((1.0 - enter as f32) * 80.0, 0.0);
                                self.payload(dl, &self.cards[k], iw, ih);
                            });
                        }
                    }
                });
                dl.pop_clip();
            });
        });
    }
}
