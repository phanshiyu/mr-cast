//! The tests scene's layout (src/utils/testsLayout.ts): column widths, the largest font at which every text fits,
//! and each row's and cell's box.

use super::matrix::{Matrix, Row, Situation, State, Test, matrix};
use crate::markup::plain_text;
use crate::textfit::{Family, Fit, Font, Slot, fit_text, fit_text_at, measure};
use crate::timing::js_round;

const MAX_FONT: i32 = 25;
const MIN_FONT: i32 = 15;
const COL_GAP: f64 = 12.0;
const ROW_GAP: f64 = 8.0;
const TAG_GAP: f64 = 10.0;
pub const HEAD_H: f64 = 40.0;
pub const FOOT_H: f64 = 44.0;
const FOOT_GAP: f64 = 14.0;
const NAME_LINES: usize = 2;

#[derive(Clone, Copy, Debug)]
pub struct Bx {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Tag {
    New,
    Changed,
    Unchecked,
    Removed,
}

impl Tag {
    pub fn text(self) -> &'static str {
        match self {
            Tag::New => "NEW",
            Tag::Changed => "CHANGED",
            Tag::Unchecked => "unchecked",
            Tag::Removed => "REMOVED",
        }
    }
}

pub fn tag_font(tag: Tag, size: f64) -> Font {
    if tag == Tag::Unchecked {
        Font::new(Family::Sans, 600.0, size)
    } else {
        Font::new(Family::Sans, 800.0, size).spacing(1.0)
    }
}

fn tag_width(tag: Option<Tag>, size: f64) -> f64 {
    tag.map_or(0.0, |t| measure(t.text(), &tag_font(t, size)) + TAG_GAP)
}

pub struct PlacedCell {
    pub b: Bx,
    pub row: usize,
    pub col: usize,
    pub value: Option<Fit>,
    pub was: Option<Fit>,
    pub tag: Option<Tag>,
}

pub struct Col {
    pub x: f64,
    pub w: f64,
    pub title: Fit,
}

pub struct PlacedRow {
    pub b: Bx,
    pub when: Fit,
    pub count: String,
    pub cells: Vec<PlacedCell>,
    pub bar: Option<(Bx, Fit)>,
    pub names: Vec<(Fit, bool)>,
}

pub struct Layout {
    pub matrix: Matrix,
    pub font: f64,
    pub tag_font: f64,
    pub line_height: f64,
    pub pad_x: f64,
    pub when_col: Col,
    pub cols: Vec<Col>,
    pub names_col: Option<Col>,
    pub rows: Vec<PlacedRow>,
    pub foot_y: f64,
    pub subject: Option<Fit>,
    pub counts: String,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

fn tag_of(c: &super::matrix::Cell) -> Option<Tag> {
    match c.state {
        State::Checked => match c.status {
            Some("added") => Some(Tag::New),
            Some("modified") => Some(Tag::Changed),
            _ => None,
        },
        State::Unchecked => Some(Tag::Unchecked),
        State::Removed => Some(Tag::Removed),
        State::None => None,
    }
}

/// The text a cell shows: its promised value, ticked when a test checks it (`cellText`).
pub fn cell_text(c: &super::matrix::Cell) -> String {
    if c.state == State::Checked {
        format!("✓ {}", c.value.as_deref().unwrap_or("")).trim_end().to_string()
    } else {
        c.value.clone().unwrap_or_default()
    }
}

/// "7 tests · 4 new · 2 changed ...": the counts under the matrix (`countsLine`).
fn counts_line(m: &Matrix, added: usize) -> String {
    let c = &m.counts;
    let n = |k: usize, one: &str| format!("{k} {one}{}", if k == 1 { "" } else { "s" });
    let of_branch = added > 0 && c.added <= added;
    let mut parts = vec![if of_branch {
        format!("{} of {added} {} this branch adds", c.added, if added == 1 { "test" } else { "tests" })
    } else if c.tests > 0 {
        n(c.tests, "test")
    } else {
        "no tests".to_string()
    }];
    if !of_branch && c.added > 0 && c.added < c.tests {
        parts.push(format!("{} new", c.added));
    }
    if c.modified > 0 {
        parts.push(format!("{} changed", c.modified));
    }
    if c.removed > 0 {
        parts.push(format!("{} removed", c.removed));
    }
    if of_branch && c.existing > 0 {
        parts.push(format!("{} existing", c.existing));
    }
    if c.unchecked > 0 {
        parts.push(format!("{} unchecked", c.unchecked));
    }
    if c.gaps > 0 {
        parts.push(n(c.gaps, "gap"));
    }
    parts.join(" · ")
}

fn row_count(tests: &[Test], row: &Row) -> String {
    let live = row.tests.iter().filter(|&&n| tests[n].status() != "removed").count();
    if row.gap {
        String::new()
    } else if live == 0 {
        "no test".into()
    } else if live == 1 {
        "1 test".into()
    } else {
        format!("{live} tests")
    }
}

/// Column widths for `room` (`shareWidths`).
fn share_widths(natural: &[f64], room: f64) -> Vec<f64> {
    let total: f64 = natural.iter().sum();
    if total <= room {
        return natural.iter().map(|n| n + (room - total) / natural.len() as f64).collect();
    }
    let mut out = vec![0.0; natural.len()];
    let mut open: Vec<usize> = (0..natural.len()).collect();
    let mut left = room;
    loop {
        let share = left / open.len() as f64;
        let fitting: Vec<usize> = open.iter().copied().filter(|&i| natural[i] <= share).collect();
        if fitting.is_empty() {
            break;
        }
        for &i in &fitting {
            out[i] = natural[i];
            left -= natural[i];
        }
        open.retain(|i| !fitting.contains(i));
        if open.is_empty() {
            return out;
        }
    }
    for &i in &open {
        out[i] = left / open.len() as f64;
    }
    out
}

pub struct Inputs<'a> {
    pub when: Option<&'a str>,
    pub subject: Option<&'a str>,
    pub outcomes: &'a [String],
    pub situations: &'a [Situation],
    pub tests: &'a [Test],
}

fn head_slot(width: f64) -> Slot {
    let mut s = Slot::named("tableHeader", width);
    s.size = 17.0;
    s
}

fn attempt(inp: &Inputs, m: Matrix, width: f64, font: f64, added: usize, max_lines: usize) -> (Layout, bool) {
    let line_height = js_round(font * 1.25);
    let pad_x = js_round(font * 0.6);
    let pad_y = js_round(font * 0.42);
    let small = (MIN_FONT as f64).max(js_round(font * 0.66));
    let tests = inp.tests;
    let value_font = Font::new(Family::Sans, 700.0, font);
    let when_font = Font::new(Family::Sans, 600.0, font);
    let hs = head_slot(0.0);
    let head_font = Font::new(Family::Sans, 700.0, hs.size).spacing(hs.letter_spacing.unwrap_or(0.0)).upper();
    let counted = m.rows.iter().any(|r| r.tests.iter().filter(|&&n| tests[n].live()).count() > 1);
    let count_w = if counted { measure("99 tests", &Font::new(Family::Sans, 600.0, small)) + TAG_GAP } else { 0.0 };

    let when_nat = m
        .rows
        .iter()
        .map(|r| measure(&plain_text(r.situation.when.as_deref().unwrap_or("")), &when_font))
        .fold(0.0, f64::max)
        + 2.0 * pad_x
        + count_w;
    let when_w = js_round(when_nat.max(width * 0.16).min(width * 0.34));
    let col_nat: Vec<f64> = m
        .outcomes
        .iter()
        .enumerate()
        .map(|(col, o)| {
            m.rows.iter().filter(|r| !r.gap).fold(measure(o, &head_font) + 2.0 * pad_x, |acc, r| {
                let cell = &r.cells[col];
                acc.max(
                    measure(&plain_text(&cell_text(cell)), &value_font) + tag_width(tag_of(cell), small) + 2.0 * pad_x,
                )
            })
        })
        .collect();

    let name_font = Font::new(Family::Mono, 500.0, (MIN_FONT as f64).max(js_round(font * 0.76)));
    let names_nat = if tests.is_empty() {
        0.0
    } else {
        tests.iter().map(|t| measure(&t.label(), &name_font)).fold(measure("Tests", &head_font), f64::max) + 2.0 * pad_x
    };
    let n_out = m.outcomes.len() as f64;
    let outcome_room =
        |names_w: f64| width - when_w - names_w - COL_GAP * (n_out + if names_w > 0.0 { 1.0 } else { 0.0 });
    let nat_sum: f64 = col_nat.iter().sum();
    let names_fit = js_round(names_nat.min(width * 0.3));
    let names_w = if names_nat > 0.0 && outcome_room(names_fit) >= nat_sum { names_fit } else { 0.0 };
    let room = outcome_room(names_w);
    let col_w = share_widths(&col_nat, room);

    let mut fits = true;
    let mut fit_at = |text: &str, slot: &str, w: f64, size: f64, lines: usize| -> Fit {
        let mut s = Slot::named(slot, w.max(1.0));
        s.lines = lines;
        let f = fit_text_at(text, &s, size);
        fits &= f.fits;
        f
    };
    let when_title = fit_text(inp.when.unwrap_or("When"), &head_slot(when_w - pad_x));
    let when_col = Col { x: 0.0, w: when_w, title: when_title };
    let mut x = when_w + COL_GAP;
    let cols: Vec<Col> = m
        .outcomes
        .iter()
        .enumerate()
        .map(|(col, o)| {
            let c = Col { x, w: js_round(col_w[col]), title: fit_text(o, &head_slot(col_w[col] - pad_x)) };
            x += c.w + COL_GAP;
            c
        })
        .collect();
    let names_col =
        (names_w > 0.0).then(|| Col { x, w: names_w, title: fit_text("Tests", &head_slot(names_w - pad_x)) });
    let right = names_col.as_ref().map_or(x - COL_GAP, |c| c.x + c.w);

    let mut placed: Vec<PlacedRow> = Vec::new();
    let mut y = HEAD_H;
    for (r, row) in m.rows.iter().enumerate() {
        let sit = &row.situation;
        let count = if names_col.is_some() || !counted { String::new() } else { row_count(tests, row) };
        let when = fit_at(
            sit.when.as_deref().unwrap_or(""),
            "testWhen",
            when_w - 2.0 * pad_x - if count.is_empty() { 0.0 } else { count_w },
            font,
            max_lines,
        );
        let mut h = when.lines.len() as f64 * line_height;
        let mut bar: Option<(Bx, Fit)> = None;
        let mut cells: Vec<PlacedCell> = Vec::new();
        if row.gap {
            let bar_x = cols.first().map_or(when_w + COL_GAP, |c| c.x);
            let text = fit_at(
                &format!("✗ {}", sit.gap.as_deref().unwrap_or("")),
                "testGap",
                right - bar_x - 2.0 * pad_x,
                font,
                max_lines,
            );
            h = h.max(text.lines.len() as f64 * line_height);
            bar = Some((Bx { x: bar_x, y, w: right - bar_x, h: 0.0 }, text));
        } else {
            for (col, cell) in row.cells.iter().enumerate() {
                let tag = tag_of(cell);
                let c = &cols[col];
                let inner = c.w - 2.0 * pad_x - tag_width(tag, small);
                let text = cell_text(cell);
                let value = (!text.is_empty()).then(|| fit_at(&text, "testValue", inner, font, max_lines));
                let was = (!cell.was.is_empty()).then(|| fit_at(&cell.was.join(", "), "testWas", inner, small, 1));
                h = h.max(
                    value.as_ref().map_or(1, |v| v.lines.len()) as f64 * line_height
                        + if was.is_some() { js_round(small * 1.25) } else { 0.0 },
                );
                cells.push(PlacedCell { b: Bx { x: c.x, y, w: c.w, h: 0.0 }, row: r, col, value, was, tag });
            }
        }
        let names: Vec<(Fit, bool)> = match &names_col {
            Some(nc) if !row.gap => row
                .tests
                .iter()
                .map(|&n| {
                    let f = fit_at(&tests[n].label(), "testNames", nc.w - 2.0 * pad_x, name_font.size, NAME_LINES);
                    (f, !tests[n].live())
                })
                .collect(),
            _ => Vec::new(),
        };
        if !names.is_empty() {
            h = h.max(names.iter().map(|(f, _)| f.lines.len()).sum::<usize>() as f64 * js_round(name_font.size * 1.25));
        }
        h += 2.0 * pad_y;
        for c in &mut cells {
            c.b.h = h;
        }
        if let Some((b, _)) = &mut bar {
            b.h = h;
        }
        placed.push(PlacedRow { b: Bx { x: 0.0, y, w: right, h }, when, count, cells, bar, names });
        y += h + ROW_GAP;
    }
    let foot_y = y - ROW_GAP + FOOT_GAP;
    let subject = inp.subject.map(|s| {
        let mut slot = Slot::named("testSubject", right * 0.55);
        slot.width = right * 0.55;
        fit_text(s, &slot)
    });
    if subject.as_ref().is_some_and(|s| !s.fits) {
        fits = false;
    }
    let counts = counts_line(&m, added);
    (
        Layout {
            matrix: m,
            font,
            tag_font: small,
            line_height,
            pad_x,
            when_col,
            cols,
            names_col,
            rows: placed,
            foot_y,
            subject,
            counts,
            width: right,
            height: foot_y + FOOT_H,
            scale: 1.0,
        },
        fits,
    )
}

/// Places the matrix in a box (`layoutTests`): the largest font at which everything fits, else three lines a text at
/// the smallest, else laid out wider and scaled down.
pub fn layout_tests(inp: &Inputs, width: f64, height: f64, added: usize) -> Layout {
    let build = |w: f64, font: f64, lines: usize| {
        attempt(inp, matrix(inp.outcomes, inp.situations, inp.tests), w, font, added, lines)
    };
    for font in (MIN_FONT..=MAX_FONT).rev() {
        let (l, fits) = build(width, font as f64, 2);
        if fits && l.height <= height {
            return l;
        }
    }
    let (last, _) = build(width, MIN_FONT as f64, 3);
    if last.height <= height {
        return last;
    }
    let scale = height / last.height;
    let (mut wide, _) = build(width / scale, MIN_FONT as f64, 3);
    wide.scale = scale;
    wide
}
