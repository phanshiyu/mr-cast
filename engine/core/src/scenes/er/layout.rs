//! The er diagram's layout: a grid of table cards and orthogonal relation lines (src/utils/erLayout.ts).

use crate::item_marks::{Marks, badges_width, js_len, text_or_number};
use crate::textfit::{Fit, Slot, fit_text};
use crate::timing::js_round;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

pub const HEADER_H: f64 = 64.0;
pub const ROW_H: f64 = 42.0;
const CARD_PAD_BOTTOM: f64 = 10.0;
const COL_GAP: f64 = 220.0;
const ROW_GAP: f64 = 120.0;
const PAD: f64 = 36.0;
const STUB: f64 = 40.0;
const CLEARANCE: f64 = 10.0;
const LABEL_HALF_H: f64 = 18.0;
const FAN: f64 = 12.0;
const MAX_ALIGN_SHIFT: f64 = 3.0 * ROW_H;
const MAX_SEARCH: usize = 8;
pub const RELATION_LABEL_MAX: f64 = 170.0;
const RELATION_LABEL_CHROME: f64 = 2.0 * 12.0 + 2.0;

#[derive(Clone, Debug, Deserialize)]
pub struct ErField {
    #[serde(default, deserialize_with = "text_or_number")]
    pub name: Option<String>,
    #[serde(default, rename = "type", deserialize_with = "text_or_number")]
    pub ty: Option<String>,
    #[serde(default)]
    pub pk: Option<bool>,
    #[serde(default)]
    pub fk: Option<bool>,
    #[serde(flatten)]
    pub marks: Marks,
}

impl ErField {
    pub fn name(&self) -> &str {
        self.name.as_deref().unwrap_or("")
    }
    fn ty(&self) -> Option<&str> {
        self.ty.as_deref().filter(|t| !t.is_empty())
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct ErEntity {
    pub id: String,
    #[serde(default, deserialize_with = "text_or_number")]
    pub name: Option<String>,
    #[serde(default)]
    pub fields: Vec<ErField>,
    #[serde(flatten)]
    pub marks: Marks,
}

impl ErEntity {
    pub fn name(&self) -> &str {
        self.name.as_deref().unwrap_or("")
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct ErRelation {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub cardinality: Option<String>,
    #[serde(default, deserialize_with = "text_or_number")]
    pub label: Option<String>,
    #[serde(flatten)]
    pub marks: Marks,
}

impl ErRelation {
    pub fn label(&self) -> Option<&str> {
        self.label.as_deref().filter(|l| !l.is_empty())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

fn pt(x: f64, y: f64) -> Pt {
    Pt { x, y }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Side {
    Left,
    Right,
    Top,
    Bottom,
}

impl Side {
    /// The outward unit vector of a card side.
    pub fn normal(self) -> Pt {
        match self {
            Side::Left => pt(-1.0, 0.0),
            Side::Right => pt(1.0, 0.0),
            Side::Top => pt(0.0, -1.0),
            Side::Bottom => pt(0.0, 1.0),
        }
    }
    fn name(self) -> &'static str {
        match self {
            Side::Left => "left",
            Side::Right => "right",
            Side::Top => "top",
            Side::Bottom => "bottom",
        }
    }
}

#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

pub struct FieldText {
    pub name: Fit,
    pub ty: Option<Fit>,
}

pub struct PlacedEntity {
    pub entity: usize,
    pub row: usize,
    pub col: usize,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub name: Fit,
    pub fields: Vec<FieldText>,
}

#[derive(Clone, Copy)]
pub struct RelationEnd {
    pub point: Pt,
    pub side: Side,
}

pub struct RoutedRelation {
    pub relation: usize,
    pub d: String,
    pub from: RelationEnd,
    pub to: RelationEnd,
    pub mid: Pt,
    pub label: Option<Fit>,
}

pub struct ErLayout {
    pub entities: Vec<PlacedEntity>,
    pub relations: Vec<RoutedRelation>,
    pub width: f64,
    pub height: f64,
}

fn card_height(e: &ErEntity) -> f64 {
    HEADER_H + e.fields.len() as f64 * ROW_H + CARD_PAD_BOTTOM
}

fn card_width(entities: &[ErEntity]) -> f64 {
    let field_w =
        |f: &ErField| 96.0 + js_len(f.name()) as f64 * 13.2 + f.ty().map_or(0.0, |t| 28.0 + js_len(t) as f64 * 11.6);
    let header_w = |e: &ErEntity| 150.0 + js_len(e.name()) as f64 * 15.0;
    let widest = entities
        .iter()
        .flat_map(|e| std::iter::once(header_w(e)).chain(e.fields.iter().map(field_w)))
        .fold(f64::NEG_INFINITY, f64::max);
    js_round(480f64.min(340f64.max(widest)))
}

fn grid_shapes(n: usize) -> Vec<(usize, usize)> {
    if n <= 3 {
        let mut v = vec![(1, n.max(1))];
        if n == 3 {
            v.push((2, 2));
        }
        return v;
    }
    let cols = n.div_ceil(2);
    vec![(n.div_ceil(cols), cols)]
}

#[derive(Clone, Copy)]
struct Cell {
    r: i64,
    c: i64,
}

fn cross(o: Cell, a: Cell, b: Cell) -> i64 {
    (a.c - o.c) * (b.r - o.r) - (a.r - o.r) * (b.c - o.c)
}

fn properly_intersect(p1: Cell, p2: Cell, q1: Cell, q2: Cell) -> bool {
    cross(p1, p2, q1) * cross(p1, p2, q2) < 0 && cross(q1, q2, p1) * cross(q1, q2, p2) < 0
}

fn placement_cost(cells: &[Cell], pairs: &[(usize, usize)], isolated: &[bool], cols: i64) -> f64 {
    let occupied: HashSet<i64> = cells.iter().map(|p| p.r * cols + p.c).collect();
    let mut cost = 0.0;
    for &(a, b) in pairs {
        let (ca, cb) = (cells[a], cells[b]);
        let dr = (ca.r - cb.r).abs() as f64;
        let dc = (ca.c - cb.c).abs() as f64;
        cost += dc + dr * 1.2;
        if dr != 0.0 && dc != 0.0 {
            cost += 0.5;
        }
        if dc == 0.0 {
            cost += 0.3;
        }
        if ca.c > cb.c {
            cost += 0.2;
        }
        if ca.r > cb.r {
            cost += 0.2;
        }
        if dr == 0.0 {
            for c in ca.c.min(cb.c) + 1..ca.c.max(cb.c) {
                if occupied.contains(&(ca.r * cols + c)) {
                    cost += 3.0;
                }
            }
        }
    }
    for i in 0..pairs.len() {
        for j in i + 1..pairs.len() {
            let (a, b) = pairs[i];
            let (c, d) = pairs[j];
            if properly_intersect(cells[a], cells[b], cells[c], cells[d]) {
                cost += 2.0;
            }
        }
    }
    for (i, p) in cells.iter().enumerate() {
        if isolated[i] {
            cost += 0.01 * (p.r * cols + p.c) as f64;
        }
    }
    cost
}

fn place_in_grid(entities: &[ErEntity], relations: &[&ErRelation]) -> Vec<Cell> {
    let n = entities.len();
    let index: HashMap<&str, usize> = entities.iter().enumerate().map(|(i, e)| (e.id.as_str(), i)).collect();
    let pairs: Vec<(usize, usize)> = relations
        .iter()
        .filter_map(|r| Some((*index.get(r.from.as_str())?, *index.get(r.to.as_str())?)))
        .filter(|(a, b)| a != b)
        .collect();
    let isolated: Vec<bool> = (0..n).map(|i| !pairs.iter().any(|&(a, b)| a == i || b == i)).collect();
    let shapes: Vec<(i64, Vec<Cell>)> = grid_shapes(n)
        .into_iter()
        .map(|(rows, cols)| {
            (cols as i64, (0..rows * cols).map(|i| Cell { r: (i / cols) as i64, c: (i % cols) as i64 }).collect())
        })
        .collect();
    let first: Vec<Cell> = shapes[0].1.iter().copied().take(n).collect();
    if n > MAX_SEARCH {
        return first;
    }
    let mut best = first;
    let mut best_cost = placement_cost(&best, &pairs, &isolated, shapes[0].0);
    for (cols, slots) in &shapes {
        let mut current: Vec<Cell> = Vec::new();
        let mut used = vec![false; slots.len()];
        #[allow(clippy::too_many_arguments)]
        fn search(
            n: usize,
            slots: &[Cell],
            cols: i64,
            pairs: &[(usize, usize)],
            isolated: &[bool],
            current: &mut Vec<Cell>,
            used: &mut Vec<bool>,
            best: &mut Vec<Cell>,
            best_cost: &mut f64,
        ) {
            if current.len() == n {
                let cost = placement_cost(current, pairs, isolated, cols);
                if cost < *best_cost - 1e-9 {
                    *best_cost = cost;
                    *best = current.clone();
                }
                return;
            }
            for s in 0..slots.len() {
                if used[s] {
                    continue;
                }
                used[s] = true;
                current.push(slots[s]);
                search(n, slots, cols, pairs, isolated, current, used, best, best_cost);
                current.pop();
                used[s] = false;
            }
        }
        search(n, slots, *cols, &pairs, &isolated, &mut current, &mut used, &mut best, &mut best_cost);
    }
    best
}

fn singular(word: &str) -> String {
    if let Some(s) = word.strip_suffix("ies") {
        format!("{s}y")
    } else if let Some(s) = word.strip_suffix('s') {
        s.to_string()
    } else {
        word.to_string()
    }
}

fn foreign_key_row(child: &ErEntity, parent: &ErEntity) -> Option<usize> {
    let mut stems: Vec<String> = Vec::new();
    for s in [parent.id.clone(), parent.name().to_string(), singular(&parent.id), singular(parent.name())] {
        let l = s.to_lowercase();
        if !stems.contains(&l) {
            stems.push(l);
        }
    }
    let matches = |f: &ErField| {
        let name = f.name().to_lowercase();
        stems.iter().any(|s| name.ends_with(&format!("{s}_id")) || name.ends_with(&format!("{s}id")))
    };
    child.fields.iter().position(|f| f.fk == Some(true) && matches(f)).or_else(|| child.fields.iter().position(matches))
}

fn pk_row(e: &ErEntity) -> usize {
    e.fields.iter().position(|f| f.pk == Some(true)).unwrap_or(0)
}

fn key_rows(from: &ErEntity, to: &ErEntity) -> Option<(usize, usize)> {
    if let Some(r) = foreign_key_row(to, from) {
        return Some((pk_row(from), r));
    }
    foreign_key_row(from, to).map(|r| (r, pk_row(to)))
}

fn align_offsets(entities: &[ErEntity], relations: &[&ErRelation], cells: &[Cell]) -> Vec<f64> {
    let index: HashMap<&str, usize> = entities.iter().enumerate().map(|(i, e)| (e.id.as_str(), i)).collect();
    let mut offsets = vec![0.0; entities.len()];
    let mut order: Vec<usize> = (0..entities.len()).collect();
    order.sort_by_key(|&i| (cells[i].r, cells[i].c));
    for &i in &order {
        for rel in relations {
            let a = index[rel.from.as_str()];
            let b = index[rel.to.as_str()];
            let left = if b == i {
                a as i64
            } else if a == i {
                b as i64
            } else {
                -1
            };
            if left < 0 || left as usize == i {
                continue;
            }
            let left = left as usize;
            if cells[left].r != cells[i].r || cells[left].c != cells[i].c - 1 {
                continue;
            }
            let Some(keys) = key_rows(&entities[a], &entities[b]) else { continue };
            let (left_row, own_row) = if left == a { (keys.0, keys.1) } else { (keys.1, keys.0) };
            let shift = (left_row as f64 - own_row as f64) * ROW_H;
            if shift.abs() > MAX_ALIGN_SHIFT {
                continue;
            }
            offsets[i] = offsets[left] + shift;
            break;
        }
    }
    let rows: HashSet<i64> = cells.iter().map(|c| c.r).collect();
    for r in rows {
        let members: Vec<usize> = order.iter().copied().filter(|&i| cells[i].r == r).collect();
        let min = members.iter().map(|&i| offsets[i]).fold(f64::INFINITY, f64::min);
        for i in members {
            offsets[i] -= min;
        }
    }
    offsets
}

fn self_key_rows(entity: &ErEntity, all: &[ErEntity]) -> (usize, usize) {
    let pk = pk_row(entity);
    if let Some(named) = foreign_key_row(entity, entity) {
        return (pk, named);
    }
    let others: Vec<&ErEntity> = all.iter().filter(|e| e.id != entity.id).collect();
    let fk = entity.fields.iter().enumerate().position(|(i, f)| {
        f.fk == Some(true)
            && others.iter().all(|o| {
                let single = ErEntity { fields: vec![f.clone()], ..entity.clone() };
                foreign_key_row(&single, o).is_none()
            })
            && i != pk
    });
    (pk, fk.unwrap_or_else(|| entity.fields.len().saturating_sub(1).min(pk + 1)))
}

#[derive(Clone, Copy)]
struct EndSpec {
    card: usize,
    side: Side,
    row: Option<usize>,
    straight: bool,
}

fn entity_text(entity: &ErEntity, w: f64) -> (Fit, Vec<FieldText>) {
    let row = w - 30.0;
    let name = fit_text(entity.name(), &Slot::named("entityName", w - 72.0));
    let fields = entity
        .fields
        .iter()
        .map(|field| {
            let ty = field.ty().map(|t| fit_text(t, &Slot::named("fieldType", 0.45 * row)));
            let badges = match field.marks.badge.as_deref().filter(|b| !b.is_empty()) {
                Some(b) => badges_width(&[b.to_string()], 12.0) + 10.0,
                None => 0.0,
            };
            let room = row - 60.0 - ty.as_ref().map_or(0.0, |t| t.width + 10.0) - badges;
            FieldText { name: fit_text(field.name(), &Slot::named("fieldName", room)), ty }
        })
        .collect();
    (name, fields)
}

fn label_half_height(label: Option<&Fit>) -> f64 {
    LABEL_HALF_H.max(label.map_or(0.0, |l| (l.height + 10.0) / 2.0))
}

fn label_half_width(text: &str) -> f64 {
    RELATION_LABEL_MAX.min(26.0 + js_len(text) as f64 * 10.4) / 2.0
}

fn sides_for(a: &PlacedEntity, b: &PlacedEntity) -> (Side, Side) {
    if a.col < b.col {
        (Side::Right, Side::Left)
    } else if a.col > b.col {
        (Side::Left, Side::Right)
    } else if a.row < b.row {
        (Side::Bottom, Side::Top)
    } else {
        (Side::Top, Side::Bottom)
    }
}

fn row_y(card: &PlacedEntity, row: usize) -> f64 {
    card.y + HEADER_H + row as f64 * ROW_H + ROW_H / 2.0
}

fn anchor_ends(placed: &[PlacedEntity], entities: &[ErEntity], ends: &[EndSpec]) -> Vec<RelationEnd> {
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, e) in ends.iter().enumerate() {
        let key = format!(
            "{}|{}|{}",
            entities[placed[e.card].entity].id,
            e.side.name(),
            e.row.map_or("mid".to_string(), |r| r.to_string())
        );
        if !groups.contains_key(&key) {
            order.push(key.clone());
        }
        groups.entry(key).or_default().push(i);
    }
    let mut out = vec![RelationEnd { point: pt(0.0, 0.0), side: Side::Left }; ends.len()];
    for key in order {
        let mut members = groups[&key].clone();
        members.sort_by_key(|&i| !ends[i].straight);
        let pinned = ends[members[0]].straight;
        for (k, &i) in members.iter().enumerate() {
            let EndSpec { card, side, row, .. } = ends[i];
            let c = &placed[card];
            if side == Side::Left || side == Side::Right {
                let x = if side == Side::Left { c.x } else { c.x + c.w };
                let fan = if pinned {
                    (k as f64 / 2.0).ceil() * if k % 2 == 1 { 1.0 } else { -1.0 } * FAN
                } else {
                    (k as f64 - (members.len() as f64 - 1.0) / 2.0) * FAN
                };
                let y = match row {
                    Some(r) => row_y(c, r) + fan,
                    None => c.y + HEADER_H + ((c.h - HEADER_H) * (k as f64 + 1.0)) / (members.len() as f64 + 1.0),
                };
                out[i] = RelationEnd { point: pt(x, y), side };
            } else {
                let y = if side == Side::Top { c.y } else { c.y + c.h };
                out[i] =
                    RelationEnd { point: pt(c.x + (c.w * (k as f64 + 1.0)) / (members.len() as f64 + 1.0), y), side };
            }
        }
    }
    out
}

fn segment_hits_rect(p: Pt, q: Pt, r: Rect) -> bool {
    let (x0, x1) = (p.x.min(q.x), p.x.max(q.x));
    let (y0, y1) = (p.y.min(q.y), p.y.max(q.y));
    x1 > r.x - CLEARANCE && x0 < r.x + r.w + CLEARANCE && y1 > r.y - CLEARANCE && y0 < r.y + r.h + CLEARANCE
}

fn poly_length(pts: &[Pt]) -> f64 {
    pts.windows(2).map(|w| (w[1].x - w[0].x).abs() + (w[1].y - w[0].y).abs()).sum()
}

fn dedupe(pts: &[Pt]) -> Vec<Pt> {
    let mut out: Vec<Pt> = Vec::new();
    for &p in pts {
        if let Some(last) = out.last()
            && (last.x - p.x).abs() < 0.5
            && (last.y - p.y).abs() < 0.5
        {
            continue;
        }
        out.push(p);
    }
    (0..out.len())
        .filter(|&i| {
            let p = out[i];
            let (Some(a), Some(b)) = (i.checked_sub(1).map(|j| out[j]), out.get(i + 1)) else { return true };
            !((a.x == p.x && p.x == b.x) || (a.y == p.y && p.y == b.y))
        })
        .map(|i| out[i])
        .collect()
}

struct Grid {
    rows_top: Vec<f64>,
    rows_bottom: Vec<f64>,
    card_w: f64,
}

impl Grid {
    fn col_left(&self, c: usize) -> f64 {
        c as f64 * (self.card_w + COL_GAP)
    }
}

fn route(from: RelationEnd, to: RelationEnd, a: usize, b: usize, cards: &[PlacedEntity], grid: &Grid) -> Vec<Pt> {
    let (p, q) = (from.point, to.point);
    let others: Vec<Rect> = cards
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != a && *i != b)
        .map(|(_, c)| Rect { x: c.x, y: c.y, w: c.w, h: c.h })
        .collect();
    let mut candidates: Vec<Vec<Pt>> = Vec::new();
    if a == b {
        let x = p.x + from.side.normal().x * STUB * 1.4;
        candidates.push(vec![p, pt(x, p.y), pt(x, q.y), q]);
    } else if from.side == Side::Left || from.side == Side::Right {
        let (left, right) = if p.x < q.x { (&cards[a], &cards[b]) } else { (&cards[b], &cards[a]) };
        for c in left.col..right.col {
            let x = grid.col_left(c) + grid.card_w + COL_GAP / 2.0;
            candidates.push(vec![p, pt(x, p.y), pt(x, q.y), q]);
        }
        let xa = p.x + from.side.normal().x * (COL_GAP / 2.0);
        let xb = q.x + to.side.normal().x * (COL_GAP / 2.0);
        let mut lanes = vec![grid.rows_top[0] - ROW_GAP / 2.0];
        lanes.extend(grid.rows_bottom.iter().map(|y| y + ROW_GAP / 2.0));
        for y in lanes {
            candidates.push(vec![p, pt(xa, p.y), pt(xa, y), pt(xb, y), pt(xb, q.y), q]);
        }
    } else {
        let y = (p.y + q.y) / 2.0;
        candidates.push(vec![p, pt(p.x, y), pt(q.x, y), q]);
    }
    let mut scored: Vec<(Vec<Pt>, f64)> = candidates
        .iter()
        .map(|c| dedupe(c))
        .map(|pts| {
            let cost = poly_length(&pts) + (pts.len() as f64 - 2.0) * 40.0;
            (pts, cost)
        })
        .collect();
    scored.sort_by(|x, y| x.1.partial_cmp(&y.1).unwrap_or(std::cmp::Ordering::Equal));
    let clear = scored
        .iter()
        .position(|(pts, _)| pts.windows(2).all(|w| others.iter().all(|r| !segment_hits_rect(w[0], w[1], *r))));
    scored.swap_remove(clear.unwrap_or(0)).0
}

fn rounded_path(pts: &[Pt]) -> String {
    let radius: f64 = 16.0;
    let mut d = format!("M {} {}", pts[0].x, pts[0].y);
    for i in 1..pts.len() - 1 {
        let (prev, p, next) = (pts[i - 1], pts[i], pts[i + 1]);
        let r = radius.min((p.x - prev.x).hypot(p.y - prev.y) / 2.0).min((next.x - p.x).hypot(next.y - p.y) / 2.0);
        let toward = |q: Pt| {
            let len = (q.x - p.x).hypot(q.y - p.y);
            let len = if len == 0.0 { 1.0 } else { len };
            pt(p.x + (q.x - p.x) / len * r, p.y + (q.y - p.y) / len * r)
        };
        let (s, e) = (toward(prev), toward(next));
        d += &format!(" L {} {} Q {} {}, {} {}", s.x, s.y, p.x, p.y, e.x, e.y);
    }
    let last = pts[pts.len() - 1];
    format!("{d} L {} {}", last.x, last.y)
}

fn point_along(pts: &[Pt], t: f64) -> Pt {
    let mut remaining = poly_length(pts) * t;
    for w in pts.windows(2) {
        let len = (w[1].x - w[0].x).abs() + (w[1].y - w[0].y).abs();
        if remaining <= len && len > 0.0 {
            return pt(w[0].x + (w[1].x - w[0].x) * remaining / len, w[0].y + (w[1].y - w[0].y) * remaining / len);
        }
        remaining -= len;
    }
    pts[pts.len() - 1]
}

fn label_point(pts: &[Pt]) -> Pt {
    let (mut best, mut best_len) = (1usize, -1.0);
    for i in 1..pts.len() {
        let len = (pts[i].x - pts[i - 1].x).abs() + (pts[i].y - pts[i - 1].y).abs();
        if len > best_len + 1.0 {
            best_len = len;
            best = i;
        }
    }
    if pts.len() > 1 {
        pt((pts[best].x + pts[best - 1].x) / 2.0, (pts[best].y + pts[best - 1].y) / 2.0)
    } else {
        point_along(pts, 0.5)
    }
}

pub fn layout_er(entities: &[ErEntity], relations: &[ErRelation]) -> ErLayout {
    let by_id: HashMap<&str, usize> = entities.iter().enumerate().map(|(i, e)| (e.id.as_str(), i)).collect();
    let valid_idx: Vec<usize> = (0..relations.len())
        .filter(|&i| by_id.contains_key(relations[i].from.as_str()) && by_id.contains_key(relations[i].to.as_str()))
        .collect();
    let valid: Vec<&ErRelation> = valid_idx.iter().map(|&i| &relations[i]).collect();
    let cells = place_in_grid(entities, &valid);
    let card_w = card_width(entities);
    let offsets = align_offsets(entities, &valid, &cells);
    let row_count = cells.iter().map(|c| c.r + 1).max().unwrap_or(1).max(1) as usize;
    let row_heights: Vec<f64> = (0..row_count)
        .map(|r| {
            entities
                .iter()
                .enumerate()
                .filter(|(i, _)| cells[*i].r == r as i64)
                .map(|(i, e)| offsets[i] + card_height(e))
                .fold(0.0, f64::max)
        })
        .collect();
    let mut rows_top = Vec::new();
    let mut rows_bottom = Vec::new();
    let mut y = 0.0;
    for h in &row_heights {
        rows_top.push(y);
        rows_bottom.push(y + h);
        y += h + ROW_GAP;
    }
    let grid = Grid { rows_top, rows_bottom, card_w };
    let mut placed: Vec<PlacedEntity> = entities
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let (r, c) = (cells[i].r as usize, cells[i].c as usize);
            let (name, fields) = entity_text(e, card_w);
            PlacedEntity {
                entity: i,
                row: r,
                col: c,
                x: grid.col_left(c),
                y: grid.rows_top[r] + offsets[i],
                w: card_w,
                h: card_height(e),
                name,
                fields,
            }
        })
        .collect();

    let mut specs: Vec<(EndSpec, EndSpec)> = valid
        .iter()
        .map(|rel| {
            let a = by_id[rel.from.as_str()];
            let b = by_id[rel.to.as_str()];
            if a == b {
                let s = EndSpec { card: a, side: Side::Right, row: None, straight: false };
                return (s, s);
            }
            let (sa, sb) = sides_for(&placed[a], &placed[b]);
            let keys = if sa == Side::Left || sa == Side::Right { key_rows(&entities[a], &entities[b]) } else { None };
            let straight = keys.is_some_and(|k| {
                placed[a].row == placed[b].row
                    && (placed[a].col as i64 - placed[b].col as i64).abs() == 1
                    && row_y(&placed[a], k.0) == row_y(&placed[b], k.1)
            });
            (
                EndSpec { card: a, side: sa, row: keys.map(|k| k.0), straight },
                EndSpec { card: b, side: sb, row: keys.map(|k| k.1), straight },
            )
        })
        .collect();
    for (i, rel) in valid.iter().enumerate() {
        if rel.from != rel.to {
            continue;
        }
        let card = by_id[rel.from.as_str()];
        let rows = self_key_rows(&entities[card], entities);
        let (lo, hi) = (rows.0.min(rows.1) as i64, rows.0.max(rows.1) as i64);
        let crowding = |side: Side| {
            specs
                .iter()
                .flat_map(|(a, b)| [*a, *b])
                .filter(|e| {
                    e.card == card
                        && e.side == side
                        && e.row.is_none_or(|r| (r as i64) >= lo - 1 && (r as i64) <= hi + 1)
                })
                .count()
        };
        let side = if crowding(Side::Right) <= crowding(Side::Left) { Side::Right } else { Side::Left };
        specs[i] = (
            EndSpec { card, side, row: Some(rows.0), straight: false },
            EndSpec { card, side, row: Some(rows.1), straight: false },
        );
    }
    let flat: Vec<EndSpec> = specs.iter().flat_map(|(a, b)| [*a, *b]).collect();
    let anchored = anchor_ends(&placed, entities, &flat);

    struct Routed {
        relation: usize,
        points: Vec<Pt>,
        from: RelationEnd,
        to: RelationEnd,
        mid: Pt,
        label: Option<Fit>,
    }
    let routed: Vec<Routed> = valid
        .iter()
        .enumerate()
        .map(|(i, rel)| {
            let (from, to) = (anchored[2 * i], anchored[2 * i + 1]);
            let points = route(from, to, specs[i].0.card, specs[i].1.card, &placed, &grid);
            let mid = match rel.label() {
                Some(l) if rel.from == rel.to => pt(
                    points[1].x + from.side.normal().x * (label_half_width(l) + 8.0),
                    (from.point.y + to.point.y) / 2.0,
                ),
                _ => label_point(&points),
            };
            let label = rel.label().map(|l| {
                let text = format!("{}{l}", if rel.marks.change.as_deref() == Some("added") { "+ " } else { "" });
                fit_text(&text, &Slot::named("relationLabel", RELATION_LABEL_MAX - RELATION_LABEL_CHROME))
            });
            Routed { relation: valid_idx[i], points, from, to, mid, label }
        })
        .collect();

    let mut xs: Vec<f64> = placed.iter().flat_map(|p| [p.x, p.x + p.w]).collect();
    xs.extend(routed.iter().flat_map(|r| r.points.iter().map(|p| p.x)));
    let mut ys: Vec<f64> = placed.iter().flat_map(|p| [p.y - 20.0, p.y + p.h]).collect();
    ys.extend(routed.iter().flat_map(|r| r.points.iter().map(|p| p.y)));
    for r in &routed {
        let Some(l) = relations[r.relation].label() else { continue };
        let half = label_half_width(l);
        xs.push(r.mid.x - half);
        xs.push(r.mid.x + half);
        let hh = label_half_height(r.label.as_ref());
        ys.push(r.mid.y - hh);
        ys.push(r.mid.y + hh);
    }
    let min_x = xs.iter().copied().fold(f64::INFINITY, f64::min);
    let max_x = xs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let min_y = ys.iter().copied().fold(f64::INFINITY, f64::min);
    let max_y = ys.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let (dx, dy) = (PAD - min_x, PAD - min_y);
    let shift = |p: Pt| pt(p.x + dx, p.y + dy);
    for p in placed.iter_mut() {
        p.x += dx;
        p.y += dy;
    }
    let relations_out: Vec<RoutedRelation> = routed
        .into_iter()
        .map(|r| {
            let points: Vec<Pt> = r.points.iter().map(|&p| shift(p)).collect();
            RoutedRelation {
                relation: r.relation,
                d: rounded_path(&points),
                from: RelationEnd { point: shift(r.from.point), side: r.from.side },
                to: RelationEnd { point: shift(r.to.point), side: r.to.side },
                mid: shift(r.mid),
                label: r.label,
            }
        })
        .collect();
    ErLayout {
        entities: placed,
        relations: relations_out,
        width: max_x - min_x + 2.0 * PAD,
        height: max_y - min_y + 2.0 * PAD,
    }
}

/// The scale an er diagram draws at in `box_`: as large as fits, up to 1.3.
pub fn er_scale(layout: &ErLayout, box_: (f64, f64)) -> f64 {
    (box_.0 / layout.width).min(box_.1 / layout.height).min(1.3)
}
