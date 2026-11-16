//! The files scene as a tree by directory: names, change markers, diffstat bars and notes. A port of
//! src/components/FileTree.tsx and src/utils/filesLayout.ts.

use super::model::{Change, ShownFile, locale_compare};
use crate::anim::{CLAMP, Easing, Spring, interpolate, spring};
use crate::chrome::fittext::{LineHeight, TextOpts, draw_fit, drawn_width};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Shadow};
use crate::icons;
use crate::steps::Emphasis;
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::{Fit, Slot, fit_text};
use crate::theme::{ACCENT, ACCENT_SOFT, ADD, BORDER, DEL, MUTED, TEXT, tone};
use crate::timing::{FPS, js_round};

const MONO_ADVANCE: f64 = 0.61;
const MAX_FONT: i32 = 26;
const MIN_FONT: i32 = 17;
pub const PAD_X: f64 = 20.0;
pub const MARKER_W: f64 = 26.0;
const COL_GAP: f64 = 40.0;
const COLUMN_GUTTER: f64 = 56.0;
const ONE_COLUMN_MIN_FONT: i32 = 21;
pub const BAR_MAX: f64 = 110.0;
const COUNT_CHARS: f64 = 11.0;
pub const START: f64 = 10.0;
pub const ROWS_END: f64 = 22.0;

#[derive(Clone, Debug)]
pub enum TreeRow {
    Dir { name: String, depth: usize },
    File { name: String, depth: usize, file: ShownFile, note: Option<String> },
}

impl TreeRow {
    pub fn depth(&self) -> usize {
        match self {
            TreeRow::Dir { depth, .. } | TreeRow::File { depth, .. } => *depth,
        }
    }
    fn name(&self) -> &str {
        match self {
            TreeRow::Dir { name, .. } | TreeRow::File { name, .. } => name,
        }
    }
}

pub struct PlacedRow {
    pub row: TreeRow,
    pub x: f64,
    pub y: f64,
    pub name: Fit,
    pub note: Option<Fit>,
}

pub struct FilesLayout {
    pub font: f64,
    pub row_h: f64,
    pub indent: f64,
    pub rows: Vec<PlacedRow>,
    pub width: f64,
    pub name_x: f64,
    pub name_w: f64,
    pub counts_x: Option<f64>,
    pub note_x: f64,
    pub note_w: f64,
    pub max_lines: f64,
    pub height: f64,
    pub scale: f64,
}

#[derive(Default)]
struct Dir {
    dirs: Vec<(String, Dir)>,
    files: Vec<ShownFile>,
}

fn build_tree(files: &[ShownFile]) -> Dir {
    let mut root = Dir::default();
    for file in files {
        let parts: Vec<&str> = file.path.split('/').collect();
        let mut dir = &mut root;
        for part in &parts[..parts.len() - 1] {
            let at = match dir.dirs.iter().position(|(n, _)| n == part) {
                Some(i) => i,
                None => {
                    dir.dirs.push((part.to_string(), Dir::default()));
                    dir.dirs.len() - 1
                }
            };
            dir = &mut dir.dirs[at].1;
        }
        dir.files.push(file.clone());
    }
    root
}

fn flatten(dir: &Dir, depth: usize, notes: &serde_json::Map<String, serde_json::Value>, out: &mut Vec<TreeRow>) {
    let mut dirs: Vec<&(String, Dir)> = dir.dirs.iter().collect();
    dirs.sort_by(|a, b| locale_compare(&a.0, &b.0));
    for (name, child) in dirs {
        let mut label = name.clone();
        let mut node = child;
        while node.files.is_empty() && node.dirs.len() == 1 {
            let (next, inner) = &node.dirs[0];
            label.push('/');
            label.push_str(next);
            node = inner;
        }
        out.push(TreeRow::Dir { name: format!("{label}/"), depth });
        flatten(node, depth + 1, notes, out);
    }
    let mut files: Vec<&ShownFile> = dir.files.iter().collect();
    files.sort_by(|a, b| locale_compare(&a.path, &b.path));
    for file in files {
        out.push(TreeRow::File {
            name: file.path.rsplit('/').next().unwrap_or("").to_string(),
            depth,
            file: file.clone(),
            note: notes.get(&file.path).and_then(|n| n.as_str()).map(str::to_string),
        });
    }
}

/// The files as a tree by directory (`treeRows`).
pub fn tree_rows(files: &[ShownFile], notes: &serde_json::Map<String, serde_json::Value>) -> Vec<TreeRow> {
    let mut out = Vec::new();
    flatten(&build_tree(files), 0, notes, &mut out);
    out
}

/// Splits the rows into two columns at the directory nearest the middle; the second repeats its ancestors.
fn split_columns(rows: &[TreeRow]) -> Vec<Vec<TreeRow>> {
    let middle = rows.len() as f64 / 2.0;
    let mut at: i64 = -1;
    for (i, r) in rows.iter().enumerate() {
        if matches!(r, TreeRow::Dir { .. })
            && i > 0
            && (at < 0 || (i as f64 - middle).abs() < (at as f64 - middle).abs())
        {
            at = i as i64;
        }
    }
    let at = if at < 0 { middle.ceil() as usize } else { at as usize };
    let mut ancestors: Vec<TreeRow> = Vec::new();
    let mut depth = rows[at].depth();
    let mut i = at as i64 - 1;
    while i >= 0 && depth > 0 {
        let r = &rows[i as usize];
        if matches!(r, TreeRow::Dir { .. }) && r.depth() < depth {
            ancestors.insert(0, r.clone());
            depth = r.depth();
        }
        i -= 1;
    }
    let mut second = ancestors;
    second.extend_from_slice(&rows[at..]);
    vec![rows[..at].to_vec(), second]
}

fn note_fit(text: &str, width: f64, font: f64, row_h: f64) -> Fit {
    let slot = Slot::named("fileNote", width);
    let mut one = slot.clone();
    one.size = js_round(font * 0.92);
    one.min = js_round(font * 0.72);
    one.lines = 1;
    let f = fit_text(text, &one);
    if f.fits {
        return f;
    }
    let two = js_round(font * 0.72).min((row_h / (2.0 * slot.line_height)).floor());
    let mut s = slot.clone();
    s.size = two.max(slot.min);
    s.lines = 2;
    fit_text(text, &s)
}

/// Width a badge at `size` takes, estimated from its character count (`badgesWidth`).
pub fn badge_width(word: &str, size: f64) -> f64 {
    (word.chars().count() as f64 * (size * 0.76 + 1.0) + 2.0 * (size * 0.75).floor() + 2.0).ceil()
}

fn extras(r: &TreeRow, font: f64) -> f64 {
    match r {
        TreeRow::File { file, .. } => {
            (if file.test { font * 3.4 } else { 0.0 })
                + file.badge.as_ref().map_or(0.0, |b| badge_width(b, js_round(font * 0.58)) + 8.0)
        }
        TreeRow::Dir { .. } => 0.0,
    }
}

fn attempt(columns: &[Vec<TreeRow>], total_width: f64, font: f64, counts: bool) -> (FilesLayout, f64) {
    let width = (total_width - (columns.len() as f64 - 1.0) * COLUMN_GUTTER) / columns.len() as f64;
    let all: Vec<&TreeRow> = columns.iter().flatten().collect();
    let row_h = js_round(font * 1.72);
    let indent = js_round(font * 1.25);
    let icon_w = js_round(font * 1.35);
    let name_x = PAD_X + MARKER_W;
    let name_need = all
        .iter()
        .map(|r| {
            r.depth() as f64 * indent
                + icon_w
                + r.name().encode_utf16().count() as f64 * font * MONO_ADVANCE
                + extras(r, font)
        })
        .fold(f64::NEG_INFINITY, f64::max);
    let has_notes = all.iter().any(|r| matches!(r, TreeRow::File { note: Some(n), .. } if !n.is_empty()));
    let name_w = (name_need + 8.0).min(width * if has_notes { 0.46 } else { 0.7 });
    let counts_x = counts.then_some(name_x + name_w + COL_GAP);
    let note_x = counts_x.unwrap_or(name_x + name_w)
        + if counts { COUNT_CHARS * font * 0.62 + 14.0 + BAR_MAX } else { 0.0 }
        + COL_GAP;
    let note_w = width - PAD_X - note_x;
    let mut heights = Vec::new();
    let mut rows = Vec::new();
    for (c, column) in columns.iter().enumerate() {
        let mut y = 0.0;
        for row in column {
            let mut slot = Slot::named("fileName", name_w - row.depth() as f64 * indent - icon_w - extras(row, font));
            slot.size = font;
            let name = fit_text(row.name(), &slot);
            let note = match row {
                TreeRow::File { note: Some(n), .. } if !n.is_empty() => Some(note_fit(n, note_w, font, row_h)),
                _ => None,
            };
            rows.push(PlacedRow { row: row.clone(), x: c as f64 * (width + COLUMN_GUTTER), y, name, note });
            y += row_h;
        }
        heights.push(y);
    }
    let height = heights.iter().copied().fold(0.0, f64::max);
    (
        FilesLayout {
            font,
            row_h,
            indent,
            rows,
            width,
            name_x,
            name_w,
            counts_x,
            note_x,
            note_w,
            max_lines: 1.0,
            height,
            scale: 1.0,
        },
        height,
    )
}

/// The largest font at which the tree fits in one column, then in two; failing that, two scaled down (`layoutFiles`).
pub fn layout_files(rows: &[TreeRow], width: f64, height: f64) -> FilesLayout {
    let files: Vec<&ShownFile> =
        rows.iter().filter_map(|r| if let TreeRow::File { file, .. } = r { Some(file) } else { None }).collect();
    let counts = files.iter().any(|f| f.additions.is_some() || f.deletions.is_some());
    let max_lines =
        files.iter().map(|f| (f.additions.unwrap_or(0) + f.deletions.unwrap_or(0)) as f64).fold(1.0, f64::max);
    let two = split_columns(rows);
    let options: [(Vec<Vec<TreeRow>>, i32); 2] = [(vec![rows.to_vec()], ONE_COLUMN_MIN_FONT), (two.clone(), MIN_FONT)];
    for (columns, min) in &options {
        for font in (*min..=MAX_FONT).rev() {
            let (mut l, h) = attempt(columns, width, font as f64, counts);
            if h <= height {
                l.max_lines = max_lines;
                return l;
            }
        }
    }
    let (_, h) = attempt(&two, width, MIN_FONT as f64, counts);
    let scale = height / h;
    let (mut l, _) = attempt(&two, width / scale, MIN_FONT as f64, counts);
    l.max_lines = max_lines;
    l.scale = scale;
    l
}

fn change_tone(c: Change) -> (Color, &'static str) {
    match c {
        Change::Added => (ADD, "+"),
        Change::Removed => (DEL, "\u{2212}"),
        Change::Modified => (ACCENT, "~"),
    }
}

/// A filled pill with an uppercase word (`Badge`); returns its width. `top` is where its box starts.
fn badge(dl: &mut DisplayList, x: f32, y_mid: f32, word: &str, color: Color, size: f32) -> f32 {
    let st = Style::sans(800.0, size).spacing(1.0);
    let text = word.to_uppercase();
    let px = (size * 0.75).floor();
    let py = (size / 4.0).floor();
    let ln = line_metrics(Face::Sans, size).normal;
    let (w, h) = (width(&text, st) + 2.0 * px, ln + 2.0 * py);
    dl.rect(x, y_mid - h / 2.0, w, h, BoxStyle::fill(color).radius(h / 2.0));
    dl.text(&text, st, x + px, y_mid - h / 2.0 + py + baseline_in(Face::Sans, size, ln), Color::css("#0b0d18"));
    w
}

fn line_through(dl: &mut DisplayList, fit: &Fit, x: f32, y: f32, color: Color, thickness: f32) {
    let size = fit.size as f32;
    let lh = line_metrics(fit.font.family.into(), size).normal;
    let w = drawn_width(fit, &fit.lines[0], None);
    let base = y + baseline_in(fit.font.family.into(), size, lh);
    dl.fill_rect(x, base - 0.31 * size - thickness / 2.0, w, thickness, color);
}

pub struct RowCtx<'a> {
    pub layout: &'a FilesLayout,
    pub at: f64,
    pub emphasis: Emphasis,
    pub frame: f64,
}

fn counts(dl: &mut DisplayList, l: &FilesLayout, additions: i64, deletions: i64, grow: f64, mid: f32) {
    let total = (additions + deletions) as f64;
    let bar_w = BAR_MAX * (total / l.max_lines).sqrt() * grow;
    let add_w = if total > 0.0 { bar_w * additions as f64 / total } else { 0.0 };
    let font = js_round(l.font * 0.88) as f32;
    let st = Style::mono(700.0, font);
    let ln = line_metrics(Face::Mono, font).normal;
    let x0 = l.counts_x.unwrap_or(0.0) as f32;
    let box_w = 11.0 * 0.62 * font;
    let plus = format!("+{}", js_round(additions as f64 * grow));
    let minus = format!("\u{2212}{}", js_round(deletions as f64 * grow));
    let (pw, mw) = (width(&plus, st), width(&minus, st));
    let right = x0 + box_w;
    let base = mid - ln / 2.0 + baseline_in(Face::Mono, font, ln);
    let mx = right - mw;
    let px = mx - 0.6 * font - pw;
    dl.group(|dl| {
        dl.fade(if additions > 0 { 1.0 } else { 0.35 });
        dl.text(&plus, st, px, base, ADD);
    });
    dl.group(|dl| {
        dl.fade(if deletions > 0 { 1.0 } else { 0.35 });
        dl.text(&minus, st, mx, base, DEL);
    });
    let bx = right + 14.0;
    let by = mid - 5.0;
    dl.rect(bx, by, BAR_MAX as f32, 10.0, BoxStyle::fill(Color::rgba8(255, 255, 255, 0.05)).radius(5.0));
    dl.push_clip(bx, by, BAR_MAX as f32, 10.0, 5.0);
    dl.fill_rect(bx, by, add_w as f32, 10.0, ADD);
    dl.fill_rect(bx + add_w as f32, by, (bar_w - add_w) as f32, 10.0, DEL);
    dl.pop_clip();
}

pub fn draw_row(dl: &mut DisplayList, placed: &PlacedRow, c: &RowCtx) {
    let l = c.layout;
    let e = c.emphasis;
    let land = spring(c.frame - c.at, FPS, Spring::damping(17.0).with_stiffness(130.0));
    let grow = interpolate(c.frame, &[c.at + 4.0, c.at + 22.0], &[0.0, 1.0], CLAMP.eased(Easing::OutCubic));
    let note_in = interpolate(c.frame, &[c.at + 10.0, c.at + 20.0], &[0.0, 1.0], CLAMP) as f32;
    let icon = js_round(l.font * 0.95) as f32;
    let row = &placed.row;
    let (x, y, w, h) = (placed.x as f32, placed.y as f32, l.width as f32, l.row_h as f32);
    let left = (l.name_x + row.depth() as f64 * l.indent) as f32;
    let gap = js_round(l.font * 0.4) as f32;
    let font = l.font as f32;
    let normal = |fit: &Fit| line_metrics(fit.font.family.into(), fit.size as f32).normal;
    dl.group(|dl| {
        dl.fade((land * e.opacity) as f32);
        dl.translate(x + (1.0 - land as f32) * -30.0, y);
        let guides = |dl: &mut DisplayList| {
            for d in 0..row.depth() {
                let gx = (l.name_x + d as f64 * l.indent) as f32 + icon / 2.0;
                dl.fill_rect(gx, 0.0, 1.5, h, BORDER);
            }
        };
        match row {
            TreeRow::Dir { .. } => {
                guides(dl);
                icons::draw(dl, "Folder", left, (h - icon) / 2.0, icon, MUTED, 2.0);
                let ln = normal(&placed.name);
                draw_fit(dl, &placed.name, left + icon + gap, (h - ln) / 2.0, TextOpts::new(MUTED).normal());
            }
            TreeRow::File { file, .. } => {
                let glow = e.glow as f32;
                if glow > 0.0 {
                    let ring = Color::css("#7c8cff").alpha((e.glow * 150.0).round() as f32 / 255.0);
                    dl.rect(
                        0.0,
                        0.0,
                        w,
                        h,
                        BoxStyle::fill(Color::rgba8(124, 140, 255, 0.1 * glow))
                            .radius(12.0)
                            .border(ring, 2.0)
                            .shadow(Shadow::new(0.0, 0.0, 30.0 * glow, Color::css("#7c8cff33"))),
                    );
                }
                if e.bar > 0.0 {
                    dl.group(|dl| {
                        dl.fade(e.bar as f32);
                        dl.rect(0.0, 6.0, 5.0, h - 12.0, BoxStyle::fill(ACCENT).radius(3.0));
                    });
                }
                guides(dl);
                let tn = file.change.map(change_tone);
                if let Some((color, marker)) = tn {
                    let st = Style::mono(800.0, font);
                    let ln = line_metrics(Face::Mono, font).normal;
                    dl.text(marker, st, PAD_X as f32, (h - ln) / 2.0 + baseline_in(Face::Mono, font, ln), color);
                }
                let removed = file.change == Some(Change::Removed);
                let icon_color = if file.test {
                    ACCENT
                } else if let (Some((c, _)), false) = (tn, removed) {
                    c
                } else {
                    MUTED
                };
                let name_icon = if file.test { "FlaskConical" } else { "FileCode2" };
                icons::draw(dl, name_icon, left, (h - icon) / 2.0, icon, icon_color, 2.0);
                let mut nx = left + icon + gap;
                let ln = normal(&placed.name);
                let name_color = if removed { MUTED } else { TEXT };
                draw_fit(dl, &placed.name, nx, (h - ln) / 2.0, TextOpts::new(name_color).normal());
                if removed {
                    line_through(dl, &placed.name, nx, (h - ln) / 2.0, DEL, 2.5);
                }
                nx += drawn_width(&placed.name, &placed.name.lines[0], None) + gap;
                if file.test {
                    let size = js_round(l.font * 0.58) as f32;
                    let st = Style::sans(800.0, size).spacing(1.2);
                    let tln = line_metrics(Face::Sans, size).normal;
                    let tw = width("TEST", st);
                    let (bw, bh) = (tw + 18.0 + 2.0, tln + 4.0 + 2.0);
                    dl.rect(
                        nx,
                        (h - bh) / 2.0,
                        bw,
                        bh,
                        BoxStyle::fill(ACCENT_SOFT).radius(bh / 2.0).border(Color::css("#7c8cff77"), 1.0),
                    );
                    dl.text(
                        "TEST",
                        st,
                        nx + 1.0 + 9.0,
                        (h - bh) / 2.0 + 1.0 + 2.0 + baseline_in(Face::Sans, size, tln),
                        ACCENT,
                    );
                    nx += bw + gap;
                }
                if let Some(b) = &file.badge {
                    let color = tone(file.tone.as_deref().unwrap_or("neutral")).0;
                    badge(dl, nx, h / 2.0, b, color, js_round(l.font * 0.58) as f32);
                }
                if l.counts_x.is_some() && (file.additions.is_some() || file.deletions.is_some()) {
                    counts(dl, l, file.additions.unwrap_or(0), file.deletions.unwrap_or(0), grow, h / 2.0);
                }
                if let Some(note) = &placed.note {
                    dl.group(|dl| {
                        dl.fade(note_in);
                        dl.translate((1.0 - note_in) * 12.0, 0.0);
                        let lh = if note.lines.len() > 1 { LineHeight::Fit } else { LineHeight::Normal };
                        let nh = crate::chrome::fittext::fit_height(note, lh);
                        draw_fit(
                            dl,
                            note,
                            l.note_x as f32,
                            (h - nh) / 2.0,
                            TextOpts::new(Color::css("#c9cedb")).line_height(lh),
                        );
                    });
                }
            }
        }
    });
}
