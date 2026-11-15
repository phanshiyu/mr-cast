//! The review scene: every finding of a reviewed storyboard, worst first, under a label that says it is Claude's
//! opinion. A port of src/components/ReviewRecap.tsx and src/utils/reviewLayout.ts.

use super::{Frame, SceneInput, SceneView, parse};
use crate::anim::{Spring, spring};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit};
use crate::chrome::shell::{Aside, Shell};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList};
use crate::icons;
use crate::review::{Finding, by_severity, finding_location, findings, ink_alpha, severity_ink};
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::{Family, Font, Slot, fit_text_at, measure};
use crate::theme::{BORDER, MUTED, TEXT, content_box};
use crate::timing::{FPS, build_frames, js_round};
use serde::Deserialize;

const START: f64 = 12.0;
const MAX_FONT: i32 = 30;
const LINE_HEIGHT: f64 = 1.3;
const PILL_W: f64 = 104.0;
const ROW_PAD_X: f64 = 22.0;
const COL_GAP: f64 = 26.0;
const ROW_GAP: f64 = 10.0;
const WHERE_SHARE: f64 = 0.4;

#[derive(Deserialize)]
struct ReviewScene {}

struct Row {
    severity: String,
    y: f64,
    h: f64,
    place: crate::textfit::Fit,
    claim: crate::textfit::Fit,
}

struct Layout {
    rows: Vec<Row>,
    line_height: f64,
    where_x: f64,
    claim_x: f64,
    height: f64,
}

fn attempt(findings: &[&Finding], width: f64, font: f64) -> (Layout, bool) {
    let line_height = js_round(font * LINE_HEIGHT);
    let where_font = js_round(font * 0.82);
    let pad = js_round(font * 0.5);
    let where_x = ROW_PAD_X + PILL_W + COL_GAP;
    let locations: Vec<String> = findings.iter().map(|f| finding_location(f)).collect();
    let slot = Slot::named("findingWhere", 0.0);
    let widest =
        locations.iter().map(|l| measure(l, &Font::new(Family::Mono, slot.weight, where_font))).fold(0.0, f64::max);
    let where_w = widest.min((width - where_x) * WHERE_SHARE).ceil();
    let claim_x = where_x + where_w + COL_GAP;
    let claim_w = width - claim_x - ROW_PAD_X;
    let mut y = 0.0;
    let mut fits = true;
    let rows = findings
        .iter()
        .zip(&locations)
        .map(|(f, loc)| {
            let place = fit_text_at(loc, &Slot::named("findingWhere", where_w), where_font);
            let claim = fit_text_at(&f.claim, &Slot::named("findingClaim", claim_w), font);
            fits &= claim.fits;
            let h = claim.lines.len().max(1) as f64 * line_height + 2.0 * pad;
            let row = Row { severity: f.severity.clone(), y, h, place, claim };
            y += h + ROW_GAP;
            row
        })
        .collect();
    (Layout { rows, line_height, where_x, claim_x, height: (y - ROW_GAP).max(0.0) }, fits)
}

fn layout(findings: &[&Finding], width: f64, height: f64) -> Layout {
    let min = Slot::named("findingClaim", 0.0).min as i32;
    let mut last = attempt(findings, width, min as f64).0;
    for font in (min..=MAX_FONT).rev() {
        let (l, fits) = attempt(findings, width, font as f64);
        if l.height <= height && fits {
            return l;
        }
        if font == min {
            last = l;
        }
    }
    last
}

struct ReviewView {
    shell: Shell,
    layout: Layout,
    top: f32,
    box_w: f32,
}

pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String> {
    let _scene: ReviewScene = parse(input)?;
    let has_title = input.scene.get("title").and_then(|t| t.as_str()).is_some_and(|t| !t.is_empty());
    let (bw, bh) = content_box(has_title);
    let all = findings(&input.props.storyboard);
    let ordered = by_severity(&all);
    let layout = layout(&ordered, bw, bh);
    let top = (bh - layout.height).max(0.0) * 0.3;
    Ok(Box::new(ReviewView { shell: Shell::new(input.scene), layout, top: top as f32, box_w: bw as f32 }))
}

impl ReviewView {
    fn row(&self, dl: &mut DisplayList, row: &Row, at: f64, frame: f64) {
        let l = &self.layout;
        let ink = Color::css(severity_ink(&row.severity));
        let land = spring(frame - at, FPS, Spring::damping(17.0).with_stiffness(120.0));
        let (y, h) = (row.y as f32, row.h as f32);
        dl.group(|dl| {
            dl.fade(land as f32);
            dl.translate((1.0 - land as f32) * -40.0, 0.0);
            dl.rect(
                0.0,
                y,
                self.box_w,
                h,
                BoxStyle::fill(Color::rgba8(255, 255, 255, 0.03)).radius(14.0).border(BORDER, 1.0),
            );
            dl.rect(0.0, y + 8.0, 5.0, h - 16.0, BoxStyle::fill(ink).radius(3.0));
            // The severity pill: 104 wide, 5px of padding, a 1.5px border, centred in the row.
            let label = row.severity.to_uppercase();
            let st = Style::sans(800.0, 16.0).spacing(1.6);
            let line = line_metrics(Face::Sans, 16.0).normal;
            let ph = line + 10.0 + 3.0;
            let py = y + (h - ph) / 2.0;
            dl.rect(
                ROW_PAD_X as f32,
                py,
                PILL_W as f32,
                ph,
                BoxStyle::fill(ink_alpha(&row.severity, "1f"))
                    .radius(ph / 2.0)
                    .border(ink_alpha(&row.severity, "99"), 1.5),
            );
            let tw = width(&label, st);
            dl.text(
                &label,
                st,
                ROW_PAD_X as f32 + 1.5 + (PILL_W as f32 - 3.0 - tw) / 2.0,
                py + 1.5 + 5.0 + baseline_in(Face::Sans, 16.0, line),
                ink,
            );
            draw_fit(dl, &row.place, l.where_x as f32, y + (h - row.place.height as f32) / 2.0, TextOpts::new(MUTED));
            let lines = row.claim.lines.len() as f64;
            draw_fit(
                dl,
                &row.claim,
                l.claim_x as f32,
                y + (h - (lines * l.line_height) as f32) / 2.0,
                TextOpts::new(TEXT).line_height(LineHeight::Times((l.line_height / row.claim.size) as f32)),
            );
        });
    }
}

impl SceneView for ReviewView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList) {
        let n = self.layout.rows.len() as f64;
        let stagger = 8f64.min((build_frames("review") - START - 14.0) / (n - 1.0).max(1.0));
        let line = line_metrics(Face::Sans, 22.0).normal;
        let content_h = line.max(26.0);
        let text = "My opinion, checked against the code";
        let st = Style::sans(500.0, 22.0);
        let draw_aside = |dl: &mut DisplayList, right: f32, top: f32| {
            let tw = width(text, st);
            let x = right - (26.0 + 12.0 + tw);
            icons::draw(
                dl,
                "MessageCircleWarning",
                x,
                top + (content_h - 26.0) / 2.0,
                26.0,
                Color::css(severity_ink("risk")),
                2.0,
            );
            dl.text(
                text,
                st,
                x + 26.0 + 12.0,
                top + (content_h - line) / 2.0 + baseline_in(Face::Sans, 22.0, line),
                MUTED,
            );
        };
        let aside = Aside { height: content_h + 6.0, draw: &draw_aside };
        self.shell.draw(dl, f.frame, f.duration, Some(aside), |dl, _bx| {
            dl.translate(0.0, self.top);
            for (i, row) in self.layout.rows.iter().enumerate() {
                self.row(dl, row, START + i as f64 * stagger, f.frame);
            }
        });
    }
}
