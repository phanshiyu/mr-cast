//! The files scene as a map of the change's parts: a card per part, linked by what each builds on. A port of
//! src/components/PartsMap.tsx and src/utils/partsLayout.ts.

use super::model::{Part, ShownFile};
use crate::anim::{CLAMP, Spring, interpolate, spring};
use crate::chrome::fittext::{TextOpts, draw_fit};
use crate::color::Color;
use crate::display::{BoxStyle, DisplayList, Shadow, Stroke, svg_path};
use crate::icons;
use crate::steps::Emphasis;
use crate::text::{Face, Style, baseline_in, line_metrics, width};
use crate::textfit::{Fit, Slot, fit_text};
use crate::theme::{ACCENT, ADD, DEL, FAINT, MUTED, TEXT, WARN};
use crate::timing::FPS;
use std::collections::HashSet;

pub const CARD_PAD: f64 = 22.0;
const GAP_Y: f64 = 24.0;
const LINK_GAP: f64 = 76.0;
const PLAIN_GAP: f64 = 28.0;
const MIN_CARD_W: f64 = 340.0;
const MAX_CARD_W: f64 = 600.0;
const MAX_LAYER_ROWS: usize = 2;
pub const TAGS_H: f64 = 22.0;
pub const STATS_H: f64 = 26.0;
pub const FILE_ROW_H: f64 = 26.0;
const BLOCK_GAP: f64 = 10.0;
const HEAD: f64 = 9.0;
const TAG_FONT: f32 = 15.0;
const COUNT_FONT: f32 = 19.0;
pub const START: f64 = 10.0;

fn listed_max(weight: &str) -> usize {
    if weight == "routine" { 2 } else { 3 }
}
fn name_size(weight: &str) -> f64 {
    match weight {
        "core" => 30.0,
        "support" => 27.0,
        _ => 24.0,
    }
}
pub fn card_opacity(weight: &str) -> f64 {
    match weight {
        "core" => 1.0,
        "support" => 0.92,
        _ => 0.6,
    }
}

pub struct PlacedFile {
    pub name: Fit,
    pub y: f64,
}

pub struct PlacedCard {
    pub part: Part,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub tags: Vec<String>,
    pub name: Fit,
    pub does: Option<Fit>,
    pub risk: Option<Fit>,
    pub name_y: f64,
    pub does_y: f64,
    pub risk_y: f64,
    pub stats_y: f64,
    pub files: Vec<PlacedFile>,
    pub more: usize,
}

pub struct PartLink {
    pub from: usize,
    pub to: usize,
    pub path: String,
    pub head: Vec<(f32, f32)>,
}

pub struct PartsLayout {
    pub cards: Vec<PlacedCard>,
    pub links: Vec<PartLink>,
    pub width: f64,
    pub height: f64,
}

fn size(f: &ShownFile) -> i64 {
    f.additions.unwrap_or(0) + f.deletions.unwrap_or(0)
}

struct Where {
    linked: bool,
    layered: bool,
    columns: usize,
    cell: Vec<(usize, usize)>,
    before: Vec<Vec<usize>>,
}

fn depth_of(i: usize, before: &[Vec<usize>], depth: &mut Vec<Option<usize>>, visiting: &mut HashSet<usize>) -> usize {
    if let Some(d) = depth[i] {
        return d;
    }
    visiting.insert(i);
    let mut best: i64 = -1;
    let open: Vec<usize> = before[i].iter().copied().filter(|j| !visiting.contains(j)).collect();
    for j in open {
        best = best.max(depth_of(j, before, depth, visiting) as i64);
    }
    visiting.remove(&i);
    let d = (best + 1) as usize;
    depth[i] = Some(d);
    d
}

fn place(parts: &[Part], width: f64) -> Where {
    let index = |n: &str| parts.iter().position(|p| p.name == n);
    let before: Vec<Vec<usize>> = parts
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let mut out: Vec<usize> = Vec::new();
            for n in &p.after {
                if let Some(j) = index(n)
                    && j != i
                    && !out.contains(&j)
                {
                    out.push(j);
                }
            }
            out
        })
        .collect();
    let linked = before.iter().any(|b| !b.is_empty());
    let max_cols = (((width + LINK_GAP) / (MIN_CARD_W + LINK_GAP)).floor() as usize).max(1);
    let mut depth_opt: Vec<Option<usize>> = vec![None; parts.len()];
    let mut visiting = HashSet::new();
    for i in 0..parts.len() {
        depth_of(i, &before, &mut depth_opt, &mut visiting);
    }
    let mut depth: Vec<usize> = depth_opt.iter().map(|d| d.unwrap_or(0)).collect();
    let alone: Vec<bool> =
        (0..parts.len()).map(|i| linked && before[i].is_empty() && !before.iter().any(|b| b.contains(&i))).collect();
    let chained = (0..parts.len()).filter(|&i| !alone[i]).map(|i| depth[i]).max().unwrap_or(0) + 1;
    let mut sizes: Vec<usize> =
        (0..chained).map(|c| (0..parts.len()).filter(|&i| !alone[i] && depth[i] == c).count()).collect();
    for i in 0..parts.len() {
        if !alone[i] {
            continue;
        }
        let min = *sizes.iter().min().unwrap_or(&0);
        let c = sizes.iter().position(|&s| s == min).unwrap_or(0);
        let into = if sizes[c] >= MAX_LAYER_ROWS { sizes.len() } else { c };
        if into == sizes.len() {
            sizes.push(0);
        }
        sizes[into] += 1;
        depth[i] = into;
    }
    let columns = depth.iter().copied().max().unwrap_or(0) + 1;
    let mut layers: Vec<Vec<usize>> =
        (0..columns).map(|c| (0..parts.len()).filter(|&i| depth[i] == c).collect()).collect();
    if linked && columns <= max_cols && layers.iter().map(Vec::len).max().unwrap_or(0) <= MAX_LAYER_ROWS {
        let mut row: Vec<Option<usize>> = vec![None; parts.len()];
        for (c, layer) in layers.iter_mut().enumerate() {
            let at = |i: usize, row: &[Option<usize>]| -> f64 {
                let rows: Vec<f64> =
                    before[i].iter().filter(|&&j| depth[j] < c).filter_map(|&j| row[j]).map(|r| r as f64).collect();
                if alone[i] {
                    f64::INFINITY
                } else if rows.is_empty() {
                    i as f64
                } else {
                    rows.iter().sum::<f64>() / rows.len() as f64
                }
            };
            let snapshot = row.clone();
            layer.sort_by(|&a, &b| {
                let (x, y) = (at(a, &snapshot), at(b, &snapshot));
                if x == y {
                    a.cmp(&b)
                } else if x < y {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Greater
                }
            });
            for (r, &i) in layer.iter().enumerate() {
                row[i] = Some(r);
            }
        }
        return Where {
            linked,
            layered: true,
            columns,
            cell: (0..parts.len()).map(|i| (depth[i], row[i].unwrap_or(0))).collect(),
            before,
        };
    }
    let mut order: Vec<usize> = (0..parts.len()).collect();
    if linked {
        order.sort_by(|&a, &b| depth[a].cmp(&depth[b]).then(a.cmp(&b)));
    }
    let n = parts.len();
    let cols = max_cols.min(if n <= 3 {
        n
    } else if n == 4 {
        2
    } else if n <= 6 {
        3
    } else {
        4
    });
    let mut cell = vec![(0, 0); n];
    for (k, &i) in order.iter().enumerate() {
        cell[i] = (k % cols, k / cols);
    }
    Where { linked, layered: false, columns: cols, cell, before }
}

struct Built {
    name: Fit,
    does: Option<Fit>,
    risk: Option<Fit>,
    all: Vec<PlacedFile>,
}

fn build(part: &Part, w: f64, names: &[String]) -> Built {
    let inner = w - 2.0 * CARD_PAD;
    let mut ranked: Vec<&ShownFile> = part.files.iter().collect();
    ranked.sort_by_key(|f| std::cmp::Reverse(size(f)));
    let all = ranked
        .iter()
        .enumerate()
        .map(|(k, file)| {
            let base = file.path.rsplit('/').next().unwrap_or("");
            let shared = names.iter().filter(|n| *n == base).count() > 1;
            PlacedFile {
                y: k as f64,
                name: fit_text(if shared { &file.path } else { base }, &Slot::named("partCardFile", inner - 26.0)),
            }
        })
        .collect();
    let mut name_slot = Slot::named("partCardName", inner);
    name_slot.size = name_size(part.weight);
    Built {
        name: fit_text(&part.name, &name_slot),
        does: part.does.as_ref().map(|d| fit_text(d, &Slot::named("partCardDoes", inner))),
        risk: part.risk.as_ref().map(|r| {
            let more = if part.risk_more > 0 { format!(" + {} more", part.risk_more) } else { String::new() };
            fit_text(&format!("{r}{more}"), &Slot::named("partCardRisk", inner))
        }),
        all,
    }
}

fn need(name_h: f64, does_h: f64, risk_h: f64, listed: usize, more: bool) -> f64 {
    let files = listed + usize::from(more);
    2.0 * CARD_PAD
        + TAGS_H
        + BLOCK_GAP
        + name_h
        + if does_h > 0.0 { BLOCK_GAP / 2.0 + does_h } else { 0.0 }
        + if risk_h > 0.0 { BLOCK_GAP / 2.0 + risk_h } else { 0.0 }
        + BLOCK_GAP
        + STATS_H
        + if files > 0 { BLOCK_GAP + files as f64 * FILE_ROW_H } else { 0.0 }
}

fn fmt(n: f64) -> String {
    // JS template of a number: integers without a decimal point.
    if n.fract() == 0.0 { format!("{}", n as i64) } else { format!("{n}") }
}

fn link(cards: &[PlacedCard], from: usize, to: usize, layered: bool) -> PartLink {
    let (a, b) = (&cards[from], &cards[to]);
    let across = if layered { a.x != b.x } else { a.x != b.x && a.y == b.y };
    if across && b.x > a.x {
        let (sx, sy, ex, ey) = (a.x + a.w, a.y + a.h / 2.0, b.x, b.y + b.h / 2.0);
        let mx = ex - (if ex - sx > 2.0 * LINK_GAP { LINK_GAP } else { ex - sx }) / 2.0;
        return PartLink {
            from,
            to,
            path: format!("M{} {} H{} V{} H{}", fmt(sx), fmt(sy), fmt(mx), fmt(ey), fmt(ex - HEAD)),
            head: vec![
                (ex as f32, ey as f32),
                ((ex - HEAD) as f32, (ey - HEAD / 2.0 - 1.0) as f32),
                ((ex - HEAD) as f32, (ey + HEAD / 2.0 + 1.0) as f32),
            ],
        };
    }
    let (sx, sy, ex, ey) = (a.x + a.w / 2.0, a.y + a.h, b.x + b.w / 2.0, b.y);
    let my = sy + (ey - sy) / 2.0;
    PartLink {
        from,
        to,
        path: format!("M{} {} V{} H{} V{}", fmt(sx), fmt(sy), fmt(my), fmt(ex), fmt(ey - HEAD)),
        head: vec![
            (ex as f32, ey as f32),
            ((ex - HEAD / 2.0 - 1.0) as f32, (ey - HEAD) as f32),
            ((ex + HEAD / 2.0 + 1.0) as f32, (ey - HEAD) as f32),
        ],
    }
}

fn leads(before: &[Vec<usize>], f: usize, m: usize, seen: &mut HashSet<usize>) -> bool {
    for &x in &before[m] {
        if x == f {
            return true;
        }
        if !seen.contains(&x) {
            seen.insert(x);
            if leads(before, f, x, seen) {
                return true;
            }
        }
    }
    false
}

pub fn layout_parts(parts: &[Part], width: f64, height: f64) -> PartsLayout {
    let wh = place(parts, width);
    let rows = wh.cell.iter().map(|c| c.1).max().unwrap_or(0) + 1;
    let gap = if wh.linked { LINK_GAP } else { PLAIN_GAP };
    let w = MAX_CARD_W.min(((width - (wh.columns as f64 - 1.0) * gap) / wh.columns as f64).floor());
    let names: Vec<String> = parts
        .iter()
        .flat_map(|p| p.files.iter().map(|f| f.path.rsplit('/').next().unwrap_or("").to_string()))
        .collect();
    let mut built: Vec<Built> = parts.iter().map(|p| build(p, w, &names)).collect();
    let name_h = built.iter().map(|b| b.name.height).fold(0.0, f64::max);
    let does_h = built.iter().map(|b| b.does.as_ref().map_or(0.0, |f| f.height)).fold(0.0, f64::max);
    let risk_h = built.iter().map(|b| b.risk.as_ref().map_or(0.0, |f| f.height)).fold(0.0, f64::max);
    let cap = |i: usize| listed_max(parts[i].weight).min(parts[i].files.len());
    let wanted = (0..parts.len())
        .map(|i| need(name_h, does_h, risk_h, cap(i), parts[i].files.len() > cap(i)))
        .fold(f64::NEG_INFINITY, f64::max);
    let h = wanted.min((height - (rows as f64 - 1.0) * GAP_Y) / rows as f64).floor();
    let total_w = wh.columns as f64 * w + (wh.columns as f64 - 1.0) * gap;
    let total_h = rows as f64 * h + (rows as f64 - 1.0) * GAP_Y;
    let mut cards = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        let b = &mut built[i];
        let mut listed = cap(i);
        while listed > 0 && need(name_h, does_h, risk_h, listed, part.files.len() > listed) > h + 1.0 {
            listed -= 1;
        }
        let more = part.files.len() - listed;
        let name_y = CARD_PAD + TAGS_H + BLOCK_GAP;
        let does_y = name_y + b.name.height + BLOCK_GAP / 2.0;
        let risk_y = name_y + name_h + if does_h > 0.0 { BLOCK_GAP / 2.0 + does_h } else { 0.0 } + BLOCK_GAP / 2.0;
        let stats_y = name_y
            + name_h
            + if does_h > 0.0 { BLOCK_GAP / 2.0 + does_h } else { 0.0 }
            + if risk_h > 0.0 { BLOCK_GAP / 2.0 + risk_h } else { 0.0 }
            + BLOCK_GAP;
        let files_y = stats_y + STATS_H + BLOCK_GAP;
        let (col, row) = wh.cell[i];
        let mut tags = vec![part.weight.to_string()];
        if part.check {
            tags.push("check".into());
        }
        let files: Vec<PlacedFile> = std::mem::take(&mut b.all)
            .into_iter()
            .take(listed)
            .enumerate()
            .map(|(k, f)| PlacedFile { y: files_y + k as f64 * FILE_ROW_H, ..f })
            .collect();
        cards.push(PlacedCard {
            part: part.clone(),
            x: col as f64 * (w + gap),
            y: row as f64 * (h + GAP_Y),
            w,
            h,
            tags,
            name: b.name.clone(),
            does: b.does.clone(),
            risk: b.risk.clone(),
            name_y,
            does_y,
            risk_y,
            stats_y,
            files,
            more,
        });
    }
    let mut links = Vec::new();
    for (to, from) in wh.before.iter().enumerate() {
        let mut uniq: Vec<usize> = Vec::new();
        for &f in from {
            if !uniq.contains(&f) {
                uniq.push(f);
            }
        }
        for f in uniq {
            if f != to && !from.iter().any(|&m| m != f && m != to && leads(&wh.before, f, m, &mut HashSet::new())) {
                links.push(link(&cards, f, to, wh.layered));
            }
        }
    }
    PartsLayout { cards, links, width: total_w, height: total_h }
}

fn weight_color(weight: &str) -> Color {
    match weight {
        "core" => ACCENT,
        "support" => TEXT,
        _ => MUTED,
    }
}

fn tag(dl: &mut DisplayList, x: f32, y: f32, word: &str, color: Color) -> f32 {
    let st = Style::sans(800.0, TAG_FONT).spacing(1.2);
    let text = word.to_uppercase();
    let w = width(&text, st) + 18.0 + 2.0;
    dl.rect(
        x,
        y,
        w,
        TAGS_H as f32,
        BoxStyle::empty().radius(TAGS_H as f32 / 2.0).border(color.alpha(0x88 as f32 / 255.0), 1.0),
    );
    let lh = TAG_FONT * 1.3;
    dl.text(&text, st, x + 10.0, y + 2.0 + baseline_in(Face::Sans, TAG_FONT, lh), color);
    w
}

pub fn draw_card(dl: &mut DisplayList, card: &PlacedCard, land: f64, e: Emphasis) {
    let part = &card.part;
    let color = weight_color(part.weight);
    let core = part.weight == "core";
    let bw = if core { 2.0 } else { 1.5 };
    let (x, y, w, h) = (card.x as f32, card.y as f32, card.w as f32, card.h as f32);
    dl.group(|dl| {
        dl.fade((land * e.opacity * card_opacity(part.weight)) as f32);
        dl.translate(0.0, (1.0 - land as f32) * 24.0);
        let mut style = BoxStyle::fill(Color::css(if core { "#161a30" } else { "#0f1118" }))
            .radius(16.0)
            .border(if core { Color::css("#7c8cff88") } else { crate::theme::BORDER }, bw);
        let glow = e.glow as f32;
        if glow > 0.0 {
            style = style.shadow(Shadow::new(0.0, 0.0, 30.0 * glow, Color::css("#7c8cff33")));
        }
        dl.rect(x, y, w, h, style);
        if glow > 0.0 {
            // The inset ring the glow draws inside the border.
            let ring = Color::css("#7c8cff").alpha((e.glow * 150.0).round() as f32 / 255.0);
            let r = bw;
            dl.rect(x + r, y + r, w - 2.0 * r, h - 2.0 * r, BoxStyle::empty().radius(16.0 - r).border(ring, 2.0));
        }
        let (ox, oy) = (x + bw + CARD_PAD as f32, y + bw);
        let mut tx = ox;
        for t in &card.tags {
            let c = if t == "check" { WARN } else { color };
            tx += tag(dl, tx, oy + CARD_PAD as f32, t, c) + 8.0;
        }
        draw_fit(dl, &card.name, ox, oy + card.name_y as f32, TextOpts::new(color));
        if let Some(d) = &card.does {
            draw_fit(dl, d, ox, oy + card.does_y as f32, TextOpts::new(Color::css("#c9cedb")));
        }
        if let Some(r) = &card.risk {
            dl.group(|dl| {
                dl.fade(0.8);
                draw_fit(dl, r, ox, oy + card.risk_y as f32, TextOpts::new(WARN));
            });
        }
        // Counts.
        let st = Style::mono(700.0, COUNT_FONT);
        let ln = line_metrics(Face::Mono, COUNT_FONT).normal;
        let base = oy + card.stats_y as f32 + (STATS_H as f32 - ln) / 2.0 + baseline_in(Face::Mono, COUNT_FONT, ln);
        let files = format!("{} {}", part.files.len(), if part.files.len() == 1 { "file" } else { "files" });
        let mut sx = ox;
        sx += dl.text(&files, st, sx, base, MUTED) + 0.9 * COUNT_FONT;
        if part.files.iter().any(|f| f.additions.is_some() || f.deletions.is_some()) {
            sx += dl.text(&format!("+{}", part.additions), st, sx, base, ADD) + 0.9 * COUNT_FONT;
            dl.text(&format!("\u{2212}{}", part.deletions), st, sx, base, DEL);
        }
        for f in &card.files {
            let fy = oy + f.y as f32;
            icons::draw(dl, "FileCode2", ox, fy + (FILE_ROW_H as f32 - 17.0) / 2.0, 17.0, FAINT, 2.0);
            let fh = line_metrics(f.name.font.family.into(), f.name.size as f32).normal;
            draw_fit(dl, &f.name, ox + 17.0 + 8.0, fy + (FILE_ROW_H as f32 - fh) / 2.0, TextOpts::new(MUTED).normal());
        }
        if card.more > 0 {
            let top = card.files.last().map_or(card.stats_y + STATS_H + 10.0, |f| f.y + FILE_ROW_H);
            let st = Style::mono(400.0, 16.0);
            let ln = line_metrics(Face::Mono, 16.0).normal;
            dl.text(
                &format!("+ {} more", card.more),
                st,
                ox,
                oy + top as f32 + (FILE_ROW_H as f32 - ln) / 2.0 + baseline_in(Face::Mono, 16.0, ln),
                FAINT,
            );
        }
    });
}

pub fn draw_link(dl: &mut DisplayList, l: &PartLink, opacity: f32, strong: bool) {
    let color = if strong { ACCENT } else { Color::css("#8a91ad") };
    dl.group(|dl| {
        dl.fade(opacity);
        if let Some(p) = svg_path(&l.path) {
            dl.path(p, None, Some(Stroke::solid(color, 2.0)));
        }
        let mut d = String::from("M");
        for (i, (x, y)) in l.head.iter().enumerate() {
            d.push_str(&format!("{}{x} {y}", if i == 0 { "" } else { " L" }));
        }
        d.push('Z');
        if let Some(p) = svg_path(&d) {
            dl.path(p, Some(color.into()), None);
        }
    });
}

pub fn land_of(frame: f64, i: usize, stagger: f64) -> f64 {
    spring(frame - START - i as f64 * stagger, FPS, Spring::damping(17.0).with_stiffness(130.0))
}

pub fn link_in(frame: f64) -> f32 {
    interpolate(frame, &[START + 14.0, START + 30.0], &[0.0, 1.0], CLAMP) as f32
}
