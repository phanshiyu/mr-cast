import { fitText, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import { badgesWidth, badgeWords } from './marks';
import { around, type Box, type LayoutBoxes } from './penGeometry';
import type { ErEntity, ErField, ErRelation } from '../types';

export const HEADER_H = 64;
export const ROW_H = 42;
const CARD_PAD_BOTTOM = 10;
const COL_GAP = 220;
const ROW_GAP = 120;
const PAD = 36;
const STUB = 40;
const CLEARANCE = 10;
const LABEL_HALF_H = 18;
const FAN = 12;
/** Cards shift vertically at most this far to line up a PK row with its FK row. */
const MAX_ALIGN_SHIFT = 3 * ROW_H;
/** Above this many entities the slot search gets slow, so cards keep input order. */
const MAX_SEARCH = 8;

export interface Pt {
  x: number;
  y: number;
}

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedEntity extends Rect {
  entity: ErEntity;
  row: number;
  col: number;
  /** Its name in the header, and each field's name and type in its row. */
  name: Fit;
  fields: { name: Fit; type: Fit | null }[];
}

export interface RelationEnd {
  /** On the card border. */
  point: Pt;
  side: Side;
}

export interface RoutedRelation {
  relation: ErRelation;
  points: Pt[];
  d: string;
  from: RelationEnd;
  to: RelationEnd;
  /** Halfway along the connector, for the label. */
  mid: Pt;
  label: Fit | null;
}

export interface ErLayout {
  entities: PlacedEntity[];
  relations: RoutedRelation[];
  cardWidth: number;
  width: number;
  height: number;
}

export const cardHeight = (e: ErEntity) => HEADER_H + e.fields.length * ROW_H + CARD_PAD_BOTTOM;

/** Width from character counts: no DOM measuring, so stills stay deterministic. */
function cardWidth(entities: readonly ErEntity[]): number {
  const fieldW = (f: ErField) => 96 + f.name.length * 13.2 + (f.type ? 28 + f.type.length * 11.6 : 0);
  const headerW = (e: ErEntity) => 150 + e.name.length * 15;
  const widest = Math.max(...entities.flatMap((e) => [headerW(e), ...e.fields.map(fieldW)]));
  return Math.round(Math.min(480, Math.max(340, widest)));
}

/** Grid shapes to search, preferred first. Three cards also try 2×2, so a triangle of relations need not detour around the middle card. */
function gridShapes(n: number): { rows: number; cols: number }[] {
  if (n <= 3) return [{ rows: 1, cols: Math.max(1, n) }, ...(n === 3 ? [{ rows: 2, cols: 2 }] : [])];
  const cols = Math.ceil(n / 2);
  return [{ rows: Math.ceil(n / cols), cols }];
}

type Cell = { r: number; c: number };

const cross = (o: Cell, a: Cell, b: Cell) => (a.c - o.c) * (b.r - o.r) - (a.r - o.r) * (b.c - o.c);
const properlyIntersect = (p1: Cell, p2: Cell, q1: Cell, q2: Cell) =>
  cross(p1, p2, q1) * cross(p1, p2, q2) < 0 && cross(q1, q2, p1) * cross(q1, q2, p2) < 0;

/** Lower is better: short, straight, left-to-right relations that skip no cards and cross nothing. */
function placementCost(cells: readonly Cell[], pairs: readonly [number, number][], isolated: readonly boolean[], cols: number): number {
  const occupied = new Set(cells.map((p) => p.r * cols + p.c));
  let cost = 0;
  for (const [a, b] of pairs) {
    const A = cells[a]!;
    const B = cells[b]!;
    const dr = Math.abs(A.r - B.r);
    const dc = Math.abs(A.c - B.c);
    cost += dc + dr * 1.2;
    if (dr && dc) cost += 0.5;
    if (!dc) cost += 0.3;
    if (A.c > B.c) cost += 0.2;
    if (A.r > B.r) cost += 0.2;
    if (!dr) {
      for (let c = Math.min(A.c, B.c) + 1; c < Math.max(A.c, B.c); c++) if (occupied.has(A.r * cols + c)) cost += 3;
    }
  }
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a, b] = pairs[i]!;
      const [c, d] = pairs[j]!;
      if (properlyIntersect(cells[a]!, cells[b]!, cells[c]!, cells[d]!)) cost += 2;
    }
  }
  cells.forEach((p, i) => {
    if (isolated[i]) cost += 0.01 * (p.r * cols + p.c);
  });
  return cost;
}

/**
 * Exhaustive search over slot assignments in each grid shape; the first minimum wins, so ties keep
 * the preferred shape and input order.
 */
function placeInGrid(entities: readonly ErEntity[], relations: readonly ErRelation[]): Cell[] {
  const n = entities.length;
  const index = new Map(entities.map((e, i) => [e.id, i]));
  const pairs = relations
    .map((r) => [index.get(r.from), index.get(r.to)] as const)
    .filter((p): p is [number, number] => p[0] !== undefined && p[1] !== undefined && p[0] !== p[1]);
  const isolated = entities.map((_, i) => !pairs.some(([a, b]) => a === i || b === i));
  const shapes = gridShapes(n).map(({ rows, cols }) => ({
    cols,
    slots: Array.from({ length: rows * cols }, (_, i) => ({ r: Math.floor(i / cols), c: i % cols })),
  }));
  if (n > MAX_SEARCH) return shapes[0]!.slots.slice(0, n);

  let best: Cell[] = shapes[0]!.slots.slice(0, n);
  let bestCost = placementCost(best, pairs, isolated, shapes[0]!.cols);
  for (const { cols, slots } of shapes) {
    const current: Cell[] = [];
    const used = new Array<boolean>(slots.length).fill(false);
    const search = () => {
      if (current.length === n) {
        const cost = placementCost(current, pairs, isolated, cols);
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          best = [...current];
        }
        return;
      }
      slots.forEach((slot, s) => {
        if (used[s]) return;
        used[s] = true;
        current.push(slot);
        search();
        current.pop();
        used[s] = false;
      });
    };
    search();
  }
  return best;
}

const singular = (word: string) => (word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.endsWith('s') ? word.slice(0, -1) : word);

/** The FK row in `child` that points at `parent`, e.g. orders.user_id for users. */
function foreignKeyRow(child: ErEntity, parent: ErEntity): number {
  const stems = [...new Set([parent.id, parent.name, singular(parent.id), singular(parent.name)].map((s) => s.toLowerCase()))];
  const matches = (f: ErField) => {
    const name = f.name.toLowerCase();
    return stems.some((s) => name.endsWith(`${s}_id`) || name.endsWith(`${s}id`));
  };
  const fk = child.fields.findIndex((f) => f.fk && matches(f));
  return fk >= 0 ? fk : child.fields.findIndex(matches);
}

/** Field row indices at each end when the relation follows an obvious FK → PK match. */
function keyRows(from: ErEntity, to: ErEntity): { from: number; to: number } | null {
  const pk = (e: ErEntity) => Math.max(0, e.fields.findIndex((f) => f.pk));
  const inTo = foreignKeyRow(to, from);
  if (inTo >= 0) return { from: pk(from), to: inTo };
  const inFrom = foreignKeyRow(from, to);
  if (inFrom >= 0) return { from: inFrom, to: pk(to) };
  return null;
}

/**
 * Vertical offset per card within its grid row, so a relation between horizontal neighbours runs
 * straight from the PK row to the FK row instead of jogging. Walks each row left to right.
 */
function alignOffsets(entities: readonly ErEntity[], relations: readonly ErRelation[], cells: readonly Cell[]): number[] {
  const index = new Map(entities.map((e, i) => [e.id, i]));
  const offsets = entities.map(() => 0);
  const order = entities.map((_, i) => i).sort((a, b) => cells[a]!.r - cells[b]!.r || cells[a]!.c - cells[b]!.c);
  for (const i of order) {
    for (const rel of relations) {
      const a = index.get(rel.from)!;
      const b = index.get(rel.to)!;
      const left = b === i ? a : a === i ? b : -1;
      if (left < 0 || left === i || cells[left]!.r !== cells[i]!.r || cells[left]!.c !== cells[i]!.c - 1) continue;
      const keys = keyRows(entities[a]!, entities[b]!);
      if (!keys) continue;
      const [leftRow, ownRow] = left === a ? [keys.from, keys.to] : [keys.to, keys.from];
      const shift = (leftRow - ownRow) * ROW_H;
      if (Math.abs(shift) > MAX_ALIGN_SHIFT) continue;
      offsets[i] = offsets[left]! + shift;
      break;
    }
  }
  const rows = new Set(cells.map((c) => c.r));
  for (const r of rows) {
    const members = order.filter((i) => cells[i]!.r === r);
    const min = Math.min(...members.map((i) => offsets[i]!));
    for (const i of members) offsets[i] = offsets[i]! - min;
  }
  return offsets;
}

/** PK row to the first FK that points at no other table, e.g. employees.manager_id. */
function selfKeyRows(entity: ErEntity, all: readonly ErEntity[]): { from: number; to: number } {
  const pk = Math.max(0, entity.fields.findIndex((f) => f.pk));
  const named = foreignKeyRow(entity, entity);
  if (named >= 0) return { from: pk, to: named };
  const others = all.filter((e) => e !== entity);
  const fk = entity.fields.findIndex(
    (f, i) => f.fk && others.every((o) => foreignKeyRow({ ...entity, fields: [f] }, o) < 0) && i !== pk,
  );
  return { from: pk, to: fk >= 0 ? fk : Math.min(entity.fields.length - 1, pk + 1) };
}

/** Outward unit vector of each card side. */
export const normal: Record<Side, Pt> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

interface EndSpec {
  card: PlacedEntity;
  side: Side;
  /** Field row the end attaches to, or null for the middle of the side. */
  row: number | null;
  /** Runs straight across to a neighbour's aligned row, so it keeps the row centre when ends share a row. */
  straight: boolean;
}

/** A relation label's pill: at most this wide, and its padding and border across. */
export const RELATION_LABEL_MAX = 170;
const RELATION_LABEL_CHROME = 2 * 12 + 2;

/**
 * An entity's name and its fields' names and types, fitted to a card `w` wide. A row holds its marker,
 * key icon, name, badges and type; the type takes at most 45% of the row.
 */
function entityText(entity: ErEntity, index: number, w: number): Pick<PlacedEntity, 'name' | 'fields'> {
  const path = `entities[${index}]`;
  const row = w - 30;
  return {
    name: fitText(entity.name, sized(SLOTS.entityName, w - 72), `${path}.name`),
    fields: entity.fields.map((field, k) => {
      const type = field.type ? fitText(field.type, sized(SLOTS.fieldType, 0.45 * row), `${path}.fields[${k}].type`) : null;
      const badges = field.badge ? badgesWidth([field.badge], 12) + 10 : 0;
      const room = row - 60 - (type ? type.width + 10 : 0) - badges;
      return { name: fitText(field.name, sized(SLOTS.fieldName, room), `${path}.fields[${k}].name`), type };
    }),
  };
}

/** Half a relation label pill's height: one line, or as many as its label wrapped to. */
const labelHalfHeight = (label: Fit | null) => Math.max(LABEL_HALF_H, label ? (label.height + 10) / 2 : 0);

/** Matches the label pill in ErDiagram: 17px mono plus padding, capped at its max width. */
export const labelHalfWidth = (text: string) => Math.min(170, 26 + text.length * 10.4) / 2;

function sidesFor(a: PlacedEntity, b: PlacedEntity): [Side, Side] {
  if (a.col < b.col) return ['right', 'left'];
  if (a.col > b.col) return ['left', 'right'];
  return a.row < b.row ? ['bottom', 'top'] : ['top', 'bottom'];
}

const rowY = (card: PlacedEntity, row: number) => card.y + HEADER_H + row * ROW_H + ROW_H / 2;

/** Turns end specs into border points, fanning out ends that would otherwise share one spot. */
function anchorEnds(ends: readonly EndSpec[]): RelationEnd[] {
  const groups = new Map<string, number[]>();
  ends.forEach((e, i) => {
    const key = `${e.card.entity.id}|${e.side}|${e.row ?? 'mid'}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const out: RelationEnd[] = [];
  for (const group of groups.values()) {
    const members = [...group].sort((a, b) => Number(ends[b]!.straight) - Number(ends[a]!.straight));
    const pinned = ends[members[0]!]!.straight;
    members.forEach((i, k) => {
      const { card, side, row } = ends[i]!;
      const vertical = side === 'left' || side === 'right';
      if (vertical) {
        const x = side === 'left' ? card.x : card.x + card.w;
        // Pinned: 0, +FAN, -FAN, +2·FAN... so the straight link stays put; otherwise spread symmetrically.
        const fan = pinned ? Math.ceil(k / 2) * (k % 2 ? 1 : -1) * FAN : (k - (members.length - 1) / 2) * FAN;
        const y =
          row !== null
            ? rowY(card, row) + fan
            : card.y + HEADER_H + ((card.h - HEADER_H) * (k + 1)) / (members.length + 1);
        out[i] = { point: { x, y }, side };
      } else {
        const y = side === 'top' ? card.y : card.y + card.h;
        out[i] = { point: { x: card.x + (card.w * (k + 1)) / (members.length + 1), y }, side };
      }
    });
  }
  return out;
}

function segmentHitsRect(p: Pt, q: Pt, r: Rect): boolean {
  const x0 = Math.min(p.x, q.x);
  const x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  const y1 = Math.max(p.y, q.y);
  return x1 > r.x - CLEARANCE && x0 < r.x + r.w + CLEARANCE && y1 > r.y - CLEARANCE && y0 < r.y + r.h + CLEARANCE;
}

const polyLength = (pts: readonly Pt[]) => pts.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - pts[i]!.x) + Math.abs(p.y - pts[i]!.y), 0);

function dedupe(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  // Drop the middle of collinear runs so corners only appear at real bends.
  return out.filter((p, i) => {
    const a = out[i - 1];
    const b = out[i + 1];
    if (!a || !b) return true;
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

interface Grid {
  colLeft: (c: number) => number;
  rowTop: number[];
  rowBottom: number[];
  cardW: number;
}

/** Candidate orthogonal routes, cheapest first; the first that clears every other card wins. */
function route(from: RelationEnd, to: RelationEnd, a: PlacedEntity, b: PlacedEntity, cards: readonly PlacedEntity[], grid: Grid): Pt[] {
  const P = from.point;
  const Q = to.point;
  const others = cards.filter((c) => c !== a && c !== b);
  const candidates: Pt[][] = [];

  if (a === b) {
    const x = P.x + normal[from.side].x * STUB * 1.4;
    candidates.push([P, { x, y: P.y }, { x, y: Q.y }, Q]);
  } else if (from.side === 'left' || from.side === 'right') {
    const [left, right] = P.x < Q.x ? [a, b] : [b, a];
    for (let c = left.col; c < right.col; c++) {
      const x = grid.colLeft(c) + grid.cardW + COL_GAP / 2;
      candidates.push([P, { x, y: P.y }, { x, y: Q.y }, Q]);
    }
    const xa = P.x + normal[from.side].x * (COL_GAP / 2);
    const xb = Q.x + normal[to.side].x * (COL_GAP / 2);
    const lanes = [grid.rowTop[0]! - ROW_GAP / 2, ...grid.rowBottom.map((y) => y + ROW_GAP / 2)];
    for (const y of lanes) candidates.push([P, { x: xa, y: P.y }, { x: xa, y }, { x: xb, y }, { x: xb, y: Q.y }, Q]);
  } else {
    const y = (P.y + Q.y) / 2;
    candidates.push([P, { x: P.x, y }, { x: Q.x, y }, Q]);
  }

  const scored = candidates.map(dedupe).map((pts) => ({ pts, cost: polyLength(pts) + (pts.length - 2) * 40 }));
  scored.sort((x, y) => x.cost - y.cost);
  const clear = scored.find(({ pts }) => pts.slice(1).every((q, i) => others.every((r) => !segmentHitsRect(pts[i]!, q, r))));
  return (clear ?? scored[0]!).pts;
}

/** Polyline with rounded corners. */
function roundedPath(pts: readonly Pt[], radius = 16): string {
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const p = pts[i]!;
    const next = pts[i + 1]!;
    const r = Math.min(radius, Math.hypot(p.x - prev.x, p.y - prev.y) / 2, Math.hypot(next.x - p.x, next.y - p.y) / 2);
    const toward = (q: Pt) => {
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return { x: p.x + ((q.x - p.x) / len) * r, y: p.y + ((q.y - p.y) / len) * r };
    };
    const s = toward(prev);
    const e = toward(next);
    d += ` L ${s.x} ${s.y} Q ${p.x} ${p.y}, ${e.x} ${e.y}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}

function pointAlong(pts: readonly Pt[], t: number): Pt {
  let remaining = polyLength(pts) * t;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (remaining <= len && len > 0) return { x: a.x + ((b.x - a.x) * remaining) / len, y: a.y + ((b.y - a.y) * remaining) / len };
    remaining -= len;
  }
  return pts[pts.length - 1]!;
}

/** Midpoint of the longest segment, so labels sit on a straight run rather than a corner. */
function labelPoint(pts: readonly Pt[]): Pt {
  let best = 1;
  let bestLen = -1;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.abs(pts[i]!.x - pts[i - 1]!.x) + Math.abs(pts[i]!.y - pts[i - 1]!.y);
    if (len > bestLen + 1) {
      bestLen = len;
      best = i;
    }
  }
  return pts.length > 1 ? { x: (pts[best]!.x + pts[best - 1]!.x) / 2, y: (pts[best]!.y + pts[best - 1]!.y) / 2 } : pointAlong(pts, 0.5);
}

export function layoutEr(entities: readonly ErEntity[], relations: readonly ErRelation[]): ErLayout {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const valid = relations.filter((r) => byId.has(r.from) && byId.has(r.to));
  const cells = placeInGrid(entities, valid);
  const cardW = cardWidth(entities);
  const offsets = alignOffsets(entities, valid, cells);
  const rowCount = Math.max(1, ...cells.map((c) => c.r + 1));
  const rowHeights = Array.from({ length: rowCount }, (_, r) =>
    Math.max(0, ...entities.flatMap((e, i) => (cells[i]!.r === r ? [offsets[i]! + cardHeight(e)] : []))),
  );
  const rowTop: number[] = [];
  const rowBottom: number[] = [];
  let y = 0;
  rowHeights.forEach((h) => {
    rowTop.push(y);
    rowBottom.push(y + h);
    y += h + ROW_GAP;
  });
  const grid: Grid = { colLeft: (c) => c * (cardW + COL_GAP), rowTop, rowBottom, cardW };

  const placed = entities.map<PlacedEntity>((entity, i) => {
    const { r, c } = cells[i]!;
    return { entity, row: r, col: c, x: grid.colLeft(c), y: rowTop[r]! + offsets[i]!, w: cardW, h: cardHeight(entity), ...entityText(entity, i, cardW) };
  });
  const placedById = new Map(placed.map((p) => [p.entity.id, p]));

  const specs: [EndSpec, EndSpec][] = valid.map((rel) => {
    const a = placedById.get(rel.from)!;
    const b = placedById.get(rel.to)!;
    if (a === b) return [{ card: a, side: 'right', row: null, straight: false }, { card: a, side: 'right', row: null, straight: false }];
    const [sa, sb] = sidesFor(a, b);
    const keys = sa === 'left' || sa === 'right' ? keyRows(a.entity, b.entity) : null;
    const straight =
      keys !== null && a.row === b.row && Math.abs(a.col - b.col) === 1 && rowY(a, keys.from) === rowY(b, keys.to);
    return [
      { card: a, side: sa, row: keys?.from ?? null, straight },
      { card: b, side: sb, row: keys?.to ?? null, straight },
    ];
  });
  // Self-relations go last: they loop out of whichever side the other ends leave free.
  valid.forEach((rel, i) => {
    if (rel.from !== rel.to) return;
    const card = placedById.get(rel.from)!;
    const rows = selfKeyRows(card.entity, entities);
    const lo = Math.min(rows.from, rows.to);
    const hi = Math.max(rows.from, rows.to);
    const crowding = (side: Side) =>
      specs.flat().filter((e) => e.card === card && e.side === side && (e.row === null || (e.row >= lo - 1 && e.row <= hi + 1))).length;
    const side: Side = crowding('right') <= crowding('left') ? 'right' : 'left';
    specs[i] = [
      { card, side, row: rows.from, straight: false },
      { card, side, row: rows.to, straight: false },
    ];
  });
  const anchored = anchorEnds(specs.flat());

  const routed = valid.map<RoutedRelation>((relation, i) => {
    const from = anchored[2 * i]!;
    const to = anchored[2 * i + 1]!;
    const points = route(from, to, specs[i]![0].card, specs[i]![1].card, placed, grid);
    const mid =
      relation.from === relation.to && relation.label
        ? { x: points[1]!.x + normal[from.side].x * (labelHalfWidth(relation.label) + 8), y: (from.point.y + to.point.y) / 2 }
        : labelPoint(points);
    const label = relation.label ? fitText(`${relation.change === 'added' ? '+ ' : ''}${relation.label}`, sized(SLOTS.relationLabel, RELATION_LABEL_MAX - RELATION_LABEL_CHROME), `relations[${relations.indexOf(relation)}].label`) : null;
    return { relation, points, d: roundedPath(points), from, to, mid, label };
  });

  // Fit the frame to everything drawn, then shift so the content starts at PAD.
  const xs = [...placed.flatMap((p) => [p.x, p.x + p.w]), ...routed.flatMap((r) => r.points.map((p) => p.x))];
  const ys = [...placed.flatMap((p) => [p.y - 20, p.y + p.h]), ...routed.flatMap((r) => r.points.map((p) => p.y))];
  for (const r of routed) {
    if (!r.relation.label) continue;
    const half = labelHalfWidth(r.relation.label);
    xs.push(r.mid.x - half, r.mid.x + half);
    ys.push(r.mid.y - labelHalfHeight(r.label), r.mid.y + labelHalfHeight(r.label));
  }
  const dx = PAD - Math.min(...xs);
  const dy = PAD - Math.min(...ys);
  const shift = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  const shiftEnd = (e: RelationEnd): RelationEnd => ({ ...e, point: shift(e.point) });

  return {
    entities: placed.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    relations: routed.map((r) => {
      const points = r.points.map(shift);
      return { ...r, points, d: roundedPath(points), from: shiftEnd(r.from), to: shiftEnd(r.to), mid: shift(r.mid) };
    }),
    cardWidth: cardW,
    width: Math.max(...xs) - Math.min(...xs) + 2 * PAD,
    height: Math.max(...ys) - Math.min(...ys) + 2 * PAD,
  };
}

/** How far a card's badges rise above its top edge. */
const BADGE_LIFT = 15;

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, in layout units: an entity's
 * card, a field's row, a relation's label (or its middle). A note keeps off the cards and the labels.
 */
export function erBoxes(layout: ErLayout): LayoutBoxes {
  const card = (e: PlacedEntity): Box => {
    const lift = badgeWords(e.entity).length ? BADGE_LIFT : 0;
    return { x: e.x, y: e.y - lift, width: e.w, height: e.h + lift };
  };
  const relation = (r: RoutedRelation): Box => (r.relation.label ? around(r.mid, 2 * labelHalfWidth(r.relation.label), 2 * labelHalfHeight(r.label)) : around(r.mid, 40, 40));
  const boxes = new Map<string, Box>([
    ...layout.entities.map((e): [string, Box] => [`e:${e.entity.id}`, card(e)]),
    ...layout.entities.flatMap((e) => e.entity.fields.map((_, k): [string, Box] => [`f:${e.entity.id}/${k}`, { x: e.x + 6, y: e.y + HEADER_H + k * ROW_H + 2, width: e.w - 12, height: ROW_H - 4 }])),
    ...layout.relations.map((r, i): [string, Box] => [`r:${i}`, relation(r)]),
  ]);
  const obstacles = [...layout.entities.map(card), ...layout.relations.flatMap((r) => (r.relation.label ? [relation(r)] : []))];
  return { boxes, obstacles, lines: layout.relations.flatMap((r) => r.points) };
}

/** The scale an er diagram draws at in `box`: as large as fits, up to 1.3. */
export const erScale = (layout: ErLayout, box: { width: number; height: number }): number => Math.min(box.width / layout.width, box.height / layout.height, 1.3);
