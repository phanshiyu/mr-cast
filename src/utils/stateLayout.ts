import { fitText, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import { badgeWords } from './marks';
import type { StateNode, StateTransition } from '../types';
import { around, type Box, type LayoutBoxes, type Pt } from './penGeometry';

const STATE_H = 72;
const STATE_FONT = 26;
export const BADGE_FONT = 14;
const LABEL_FONT = 18;
const LABEL_LINE_H = 22;
const LABEL_PAD_Y = 6;
const LABEL_MAX_CHARS = 22;
const MONO_ADVANCE = 0.61;
export const ARROW_LEN = 14;
const MIN_W = 170;
const MAX_W = 360;
const PAD_X = 28;
const MIN_COL_GAP = 150;
const ROW_GAP = 110;
const PAD = 36;
const LOOP_H = 92;
const LOOP_STEP = 46;
const ARC_CLEAR = 48;
const LANE_STEP = 46;
const CORNER = 20;
const CHANNEL = 34;
const SPREAD = 44;
const ENTRY_GAP = 74;

function badgeWidth(text: string): number {
  return Math.ceil(text.length * (BADGE_FONT * 0.76 + 1) + 22);
}

/** A transition label pill: its text fitted to LABEL_MAX_CHARS monospace cells, and the pill's size. */
export interface LabelBox {
  text: Fit;
  w: number;
  h: number;
}

const labelHeight = (lines: number, size = LABEL_FONT) => lines * LABEL_LINE_H * (size / LABEL_FONT) + 2 * LABEL_PAD_Y;

function labelBox(t: StateTransition, path: string): LabelBox {
  const text = fitText(
    (t.change === 'added' ? '+ ' : '') + (t.label ?? ''),
    sized(SLOTS.transitionLabel, LABEL_MAX_CHARS * LABEL_FONT * MONO_ADVANCE),
    path,
  );
  const cells = Math.max(...text.lines.map((line) => line.reduce((n, run) => n + run.text.length, 0)));
  return {
    text,
    w: Math.ceil(Math.max(cells * text.size * MONO_ADVANCE, text.width) + 26),
    h: labelHeight(text.lines.length, text.size),
  };
}

/** Room a state's label has: its pill less the padding and its badges. */
const labelRoom = (state: StateNode, w: number) =>
  w - 2 * PAD_X - badgeWords(state).reduce((sum, word) => sum + badgeWidth(word) + 14, 0);

function stateWidth(state: StateNode): number {
  const badges = badgeWords(state).reduce((sum, word) => sum + badgeWidth(word) + 14, 0);
  const w = state.label.length * STATE_FONT * 0.6 + 2 * PAD_X + 8 + badges;
  return Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));
}

export interface PlacedState {
  state: StateNode;
  /** Its label, fitted to its pill. */
  label: Fit;
  layer: number;
  /** Position within its column, top to bottom. */
  row: number;
  /** Top-left corner in layout units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoutedTransition {
  transition: StateTransition;
  /** SVG path data ending ARROW_LEN short of `tip`, so the arrowhead covers the gap. */
  d: string;
  tip: Pt;
  /** Unit vector the arrow points along. */
  dir: Pt;
  /** Centre of the label pill, or null when the transition has no label. */
  label: (Pt & LabelBox) | null;
}

export interface StateLayout {
  states: PlacedState[];
  transitions: RoutedTransition[];
  entry: { dot: Pt; d: string; tip: Pt; dir: Pt } | null;
  /** Layer of each state id, for animation order. */
  layerOf: Map<string, number>;
  width: number;
  height: number;
}

type Seg = ['M', Pt] | ['L', Pt] | ['Q', Pt, Pt] | ['C', Pt, Pt, Pt];

interface Route {
  segs: Seg[];
  tip: Pt;
  dir: Pt;
  label: (Pt & LabelBox) | null;
}

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const unit = (a: Pt): Pt => {
  const len = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / len, y: a.y / len };
};

/**
 * Layers by BFS distance from the start state, so every forward transition spans exactly one layer.
 * A state the start cannot reach sits one column before its first reachable target, at the bottom
 * (see orderColumns); one with no such target goes in an extra column at the end.
 */
function assignLayers(
  states: readonly StateNode[],
  edges: readonly StateTransition[],
  initial: string | undefined,
): { layerOf: Map<string, number>; unreachable: Set<string> } {
  const ids = new Set(states.map((s) => s.id));
  const hasIncoming = new Set(edges.filter((e) => e.from !== e.to).map((e) => e.to));
  const start =
    (initial && ids.has(initial) ? initial : undefined) ??
    states.find((s) => !hasIncoming.has(s.id))?.id ??
    states[0]?.id;
  const layerOf = new Map<string, number>();
  if (start !== undefined) {
    layerOf.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of edges) {
        if (e.from === id && !layerOf.has(e.to)) {
          layerOf.set(e.to, layerOf.get(id)! + 1);
          queue.push(e.to);
        }
      }
    }
  }
  const unreachable = new Set(states.filter((s) => !layerOf.has(s.id)).map((s) => s.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of unreachable) {
      if (layerOf.has(id)) continue;
      const targets = edges.flatMap((e) =>
        e.from === id && e.to !== id && layerOf.has(e.to) ? [layerOf.get(e.to)!] : [],
      );
      if (targets.length) {
        layerOf.set(id, Math.max(0, Math.min(...targets) - 1));
        changed = true;
      }
    }
  }
  const last = layerOf.size ? Math.max(...layerOf.values()) + 1 : 0;
  for (const id of unreachable) if (!layerOf.has(id)) layerOf.set(id, last);
  return { layerOf, unreachable };
}

/** Alternating barycenter sweeps over transitions between adjacent columns; stable sort keeps ties in input order. */
function orderColumns(
  columns: StateNode[][],
  edges: readonly StateTransition[],
  layerOf: Map<string, number>,
  unreachable: Set<string>,
): void {
  const neighbours = (id: string, layer: number) =>
    edges.flatMap((e) => {
      const other = e.from === id ? e.to : e.to === id ? e.from : null;
      return other !== null && other !== id && layerOf.get(other) === layer ? [other] : [];
    });
  const sweep = (l: number, ref: number) => {
    const index = new Map(columns[ref]!.map((s, i) => [s.id, i]));
    const key = new Map(
      columns[l]!.map((s, i) => {
        const ns = neighbours(s.id, ref).map((id) => index.get(id)!);
        return [s.id, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : i];
      }),
    );
    columns[l]!.sort((a, b) => key.get(a.id)! - key.get(b.id)!);
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l < columns.length; l++) sweep(l, l - 1);
    for (let l = columns.length - 2; l >= 0; l--) sweep(l, l + 1);
  }
  for (const col of columns) col.sort((a, b) => Number(unreachable.has(a.id)) - Number(unreachable.has(b.id)));
}

/** Horizontal inset of a pill's rounded end at vertical offset `dy` from its centre. */
function pillInset(p: PlacedState, dy: number): number {
  const r = p.h / 2;
  const d = Math.min(Math.abs(dy), r);
  return r - Math.sqrt(r * r - d * d);
}

const cy = (p: PlacedState) => p.y + p.h / 2;
const cx = (p: PlacedState) => p.x + p.w / 2;

function sideTip(p: PlacedState, side: 'left' | 'right', dy: number): Pt {
  const inset = pillInset(p, dy);
  return { x: side === 'left' ? p.x + inset : p.x + p.w - inset, y: cy(p) + dy };
}

/** A polyline with rounded corners, ending ARROW_LEN before its last point. */
function orth(points: Pt[], label: Route['label']): Route {
  const tip = points[points.length - 1]!;
  const dir = unit(sub(tip, points[points.length - 2]!));
  const pts = [...points.slice(0, -1), sub(tip, mul(dir, ARROW_LEN))];
  const segs: Seg[] = [['M', pts[0]!]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [prev, corner, next] = [pts[i - 1]!, pts[i]!, pts[i + 1]!];
    const inDir = unit(sub(corner, prev));
    const outDir = unit(sub(next, corner));
    const r = Math.min(
      CORNER,
      Math.hypot(corner.x - prev.x, corner.y - prev.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
    );
    segs.push(['L', sub(corner, mul(inDir, r))], ['Q', corner, add(corner, mul(outDir, r))]);
  }
  segs.push(['L', pts[pts.length - 1]!]);
  return { segs, tip, dir, label };
}

function cubicRoute(p0: Pt, c1: Pt, c2: Pt, tip: Pt, box: LabelBox | null): Route {
  const dir = unit(sub(tip, c2));
  const p3 = sub(tip, mul(dir, ARROW_LEN));
  const mid = { x: (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8, y: (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8 };
  return {
    segs: [
      ['M', p0],
      ['C', c1, c2, p3],
    ],
    tip,
    dir,
    label: box === null ? null : { ...mid, ...box },
  };
}

type Side = 'left' | 'right';

/** How one transition is drawn, decided from placement before any coordinates are routed. */
type Plan =
  | { kind: 'loop'; t: StateTransition; a: PlacedState; nth: number }
  /** Adjacent columns, either direction. BFS layering makes every forward transition one of these. */
  | { kind: 'gap'; t: StateTransition; a: PlacedState; b: PlacedState; offset: number }
  /** Neighbours in one column: a straight vertical arrow. */
  | { kind: 'vertical'; t: StateTransition; a: PlacedState; b: PlacedState; offset: number; size: number }
  /** Same column but not neighbours (or the lower one has a loop on top): a channel beside the column. */
  | { kind: 'channel'; t: StateTransition; a: PlacedState; b: PlacedState; side: Side; offset: number }
  /** Back across two or more columns: a lane above or below everything it spans. */
  | {
      kind: 'arc';
      t: StateTransition;
      a: PlacedState;
      b: PlacedState;
      above: boolean;
      level: number;
      topA: boolean;
      topB: boolean;
    };

export function layoutState(
  states: readonly StateNode[],
  transitions: readonly StateTransition[],
  initial: string | undefined,
): StateLayout {
  const labels = new Map(transitions.map((t, i) => [t, labelBox(t, `transitions[${i}].label`)]));
  const labelOf = (t: StateTransition) => labels.get(t)!;
  const ids = new Set(states.map((s) => s.id));
  const edges = transitions.filter((t) => ids.has(t.from) && ids.has(t.to));
  const { layerOf, unreachable } = assignLayers(states, edges, initial);
  const layerCount = Math.max(1, ...[...layerOf.values()].map((l) => l + 1));
  const columns: StateNode[][] = Array.from({ length: layerCount }, () => []);
  for (const s of states) columns[layerOf.get(s.id)!]!.push(s);
  orderColumns(columns, edges, layerOf, unreachable);

  const loopCount = (id: string) => edges.filter((e) => e.from === id && e.to === id).length;
  /** Space a state's self-loops (with labels) take above it. */
  const loopReserve = (id: string) => {
    const loops = edges.filter((e) => e.from === id && e.to === id);
    const labelH = Math.max(labelHeight(1), ...loops.map((e) => (e.label ? labelOf(e).h : 0)));
    return loops.length ? 0.75 * (LOOP_H + (loops.length - 1) * LOOP_STEP) + labelH + 10 : 0;
  };

  // Rows first; x waits until the column gaps are sized from the labels that sit in them.
  const placed = new Map<string, PlacedState>();
  columns.forEach((col, layer) => {
    // Centre each column on its state bodies so a chain of states stays on one line whatever loops sit above.
    const gaps = col.map((s, i) => (i === 0 ? 0 : ROW_GAP + loopReserve(s.id)));
    const bodyH = col.length * STATE_H + gaps.reduce((a, b) => a + b, 0);
    let y = -bodyH / 2;
    col.forEach((s, row) => {
      y += gaps[row]!;
      const w = stateWidth(s);
      const label = fitText(s.label, sized(SLOTS.stateLabel, labelRoom(s, w)), `states[${states.indexOf(s)}].label`);
      placed.set(s.id, { state: s, label, layer, row, x: 0, y, w, h: STATE_H });
      y += STATE_H;
    });
  });
  const at = (id: string) => placed.get(id)!;
  const isTop = (p: PlacedState) => p.row === 0;
  const isBottom = (p: PlacedState) => p.row === columns[p.layer]!.length - 1;

  // Transitions between the same pair of states fan out symmetrically so they never overlap.
  const pairKey = (t: StateTransition) => [t.from, t.to].sort().join('\u0000');
  const groups = new Map<string, StateTransition[]>();
  for (const t of edges) if (t.from !== t.to) groups.set(pairKey(t), [...(groups.get(pairKey(t)) ?? []), t]);
  const spread = (t: StateTransition) => {
    const g = groups.get(pairKey(t))!;
    return { offset: (g.indexOf(t) - (g.length - 1) / 2) * SPREAD, size: g.length };
  };

  // Lanes: shorter spans take the inner lanes; an arc keeps clear of self-loops by leaving through the side.
  const arcPlans = new Map<StateTransition, Plan & { kind: 'arc' }>();
  const span = (t: StateTransition) => Math.abs(layerOf.get(t.from)! - layerOf.get(t.to)!);
  let balance = 0;
  for (const t of edges.filter((e) => span(e) >= 2).sort((x, y) => span(x) - span(y))) {
    const a = at(t.from);
    const b = at(t.to);
    const above =
      isTop(a) && isTop(b)
        ? true
        : isBottom(a) && isBottom(b)
          ? false
          : cy(a) + cy(b) < 0 || (cy(a) + cy(b) === 0 && balance <= 0);
    balance += above ? 1 : -1;
    const lo = Math.min(a.layer, b.layer);
    const hi = Math.max(a.layer, b.layer);
    const level =
      Math.max(
        -1,
        ...[...arcPlans.values()]
          .filter(
            (o) => o.above === above && Math.min(o.a.layer, o.b.layer) <= hi && lo <= Math.max(o.a.layer, o.b.layer),
          )
          .map((o) => o.level),
      ) + 1;
    const free = (p: PlacedState) => (above ? isTop(p) && !loopCount(p.state.id) : isBottom(p));
    arcPlans.set(t, { kind: 'arc', t, a, b, above, level, topA: free(a), topB: free(b) });
  }

  const loopsSeen = new Map<string, number>();
  const plans: Plan[] = edges.map((t): Plan => {
    const a = at(t.from);
    const b = at(t.to);
    if (t.from === t.to) {
      const nth = loopsSeen.get(t.from) ?? 0;
      loopsSeen.set(t.from, nth + 1);
      return { kind: 'loop', t, a, nth };
    }
    if (Math.abs(b.layer - a.layer) === 1) return { kind: 'gap', t, a, b, offset: spread(t).offset };
    if (a.layer === b.layer) {
      const lower = b.row > a.row ? b : a;
      if (Math.abs(b.row - a.row) === 1 && !loopCount(lower.state.id))
        return { kind: 'vertical', t, a, b, ...spread(t) };
      return { kind: 'channel', t, a, b, side: b.row > a.row ? 'right' : 'left', offset: spread(t).offset };
    }
    return arcPlans.get(t)!;
  });

  // Every transition meeting a state's side gets its own port, fanned out by where its other end sits.
  const portDy = new Map<string, number>();
  const sidePorts = new Map<string, { key: string; order: number }[]>();
  const port = (key: string, node: PlacedState, side: Side, order: number) => {
    const k = `${node.state.id}\u0000${side}`;
    sidePorts.set(k, [...(sidePorts.get(k) ?? []), { key, order }]);
  };
  plans.forEach((p, i) => {
    if (p.kind === 'gap') {
      const forward = p.b.layer > p.a.layer;
      port(`${i}:from`, p.a, forward ? 'right' : 'left', cy(p.b));
      port(`${i}:to`, p.b, forward ? 'left' : 'right', cy(p.a));
    } else if (p.kind === 'channel') {
      port(`${i}:from`, p.a, p.side, cy(p.b));
      port(`${i}:to`, p.b, p.side, cy(p.a));
    } else if (p.kind === 'arc') {
      const lane = p.above ? -1e6 : 1e6;
      if (!p.topA) port(`${i}:from`, p.a, p.a.layer > p.b.layer ? 'left' : 'right', lane);
      if (!p.topB) port(`${i}:to`, p.b, p.a.layer > p.b.layer ? 'right' : 'left', lane);
    }
  });
  for (const list of sidePorts.values()) {
    list.sort((x, y) => x.order - y.order);
    const step = Math.min(18, (STATE_H * 0.6) / Math.max(1, list.length - 1));
    list.forEach(({ key }, i) => portDy.set(key, (i - (list.length - 1) / 2) * step));
  }

  // Column gaps grow to fit the widest label that sits in them.
  const gapW = Array.from({ length: Math.max(0, layerCount - 1) }, () => MIN_COL_GAP);
  const widen = (gap: number, w: number) => {
    if (gap >= 0 && gap < gapW.length) gapW[gap] = Math.max(gapW[gap]!, w);
  };
  for (const p of plans) {
    const lw = p.t.label ? labelOf(p.t).w : 0;
    if (p.kind === 'gap') widen(Math.min(p.a.layer, p.b.layer), lw + 64);
    if (p.kind === 'channel')
      widen(p.side === 'right' ? p.a.layer : p.a.layer - 1, CHANNEL + Math.abs(p.offset) / 2 + lw + 40);
  }
  const colW = columns.map((col) => Math.max(MIN_W, ...col.map(stateWidth)));
  const colX: number[] = [];
  colW.forEach((_, i) => colX.push(i === 0 ? 0 : colX[i - 1]! + colW[i - 1]! + gapW[i - 1]!));
  for (const p of placed.values()) p.x = colX[p.layer]! + (colW[p.layer]! - p.w) / 2;
  const colTop = (l: number) => Math.min(...columns[l]!.map((s) => at(s.id).y - loopReserve(s.id)));
  const colBottom = (l: number) => Math.max(...columns[l]!.map((s) => at(s.id).y + STATE_H));

  const route = (p: Plan, i: number): Route => {
    const box = p.t.label ? labelOf(p.t) : null;
    const lw = box?.w ?? null;
    const labelAt = (pt: Pt) => (box === null ? null : { ...pt, ...box });
    const dy = (end: 'from' | 'to') => portDy.get(`${i}:${end}`) ?? 0;

    switch (p.kind) {
      case 'loop': {
        const { a, nth } = p;
        const h = LOOP_H + nth * LOOP_STEP;
        const spanX = 24 + nth * 10;
        const p0 = { x: cx(a) - spanX, y: a.y };
        const tip = { x: cx(a) + spanX, y: a.y };
        const r = cubicRoute(p0, { x: p0.x - 44, y: a.y - h }, { x: tip.x + 44, y: a.y - h }, tip, null);
        return { ...r, label: labelAt({ x: cx(a), y: a.y - 0.75 * h - (box?.h ?? 0) / 2 - 4 }) };
      }
      case 'gap': {
        const forward = p.b.layer > p.a.layer;
        const p0 = sideTip(p.a, forward ? 'right' : 'left', dy('from'));
        const tip = sideTip(p.b, forward ? 'left' : 'right', dy('to'));
        const dx = (tip.x - p0.x) / 2;
        return cubicRoute(p0, { x: p0.x + dx, y: p0.y + p.offset }, { x: tip.x - dx, y: tip.y + p.offset }, tip, box);
      }
      case 'vertical': {
        const down = p.b.row > p.a.row;
        const x = cx(p.a) + p.offset;
        const p0 = { x, y: down ? p.a.y + STATE_H : p.a.y };
        const tip = { x, y: down ? p.b.y : p.b.y + STATE_H };
        const lx = p.size === 1 || lw === null ? x : x + Math.sign(p.offset) * (lw / 2 + 10);
        return orth([p0, tip], labelAt({ x: lx, y: (p0.y + tip.y) / 2 }));
      }
      case 'channel': {
        const sign = p.side === 'right' ? 1 : -1;
        const edgeX = p.side === 'right' ? colX[p.a.layer]! + colW[p.a.layer]! : colX[p.a.layer]!;
        const x = edgeX + sign * (CHANNEL + Math.abs(p.offset) / 2);
        const p0 = sideTip(p.a, p.side, dy('from'));
        const tip = sideTip(p.b, p.side, dy('to'));
        return orth(
          [p0, { x, y: p0.y }, { x, y: tip.y }, tip],
          labelAt({ x: x + sign * ((lw ?? 0) / 2 + 10), y: (p0.y + tip.y) / 2 }),
        );
      }
      case 'arc': {
        const { a, b, above } = p;
        const sign = above ? -1 : 1;
        // BFS layering means arcs only run backwards: leave A on its left, arrive at B from the right.
        const back = a.layer > b.layer;
        const lo = Math.min(a.layer, b.layer);
        const spanned = Array.from({ length: Math.abs(a.layer - b.layer) + 1 }, (_, k) => lo + k);
        const edgeY = above ? Math.min(...spanned.map(colTop)) : Math.max(...spanned.map(colBottom));
        const lane = edgeY + sign * (ARC_CLEAR + p.level * LANE_STEP);
        const portY = (s: PlacedState) => (above ? s.y : s.y + STATE_H);
        const channelX = (s: PlacedState, side: Side) =>
          side === 'left' ? colX[s.layer]! - CHANNEL : colX[s.layer]! + colW[s.layer]! + CHANNEL;
        const outSide: Side = back ? 'left' : 'right';
        const inSide: Side = back ? 'right' : 'left';
        const start: Pt[] = p.topA
          ? [{ x: a.x + a.w * (back ? 0.3 : 0.7), y: portY(a) }]
          : (() => {
              const s = sideTip(a, outSide, dy('from'));
              return [s, { x: channelX(a, outSide), y: s.y }];
            })();
        const end: Pt[] = p.topB
          ? [{ x: b.x + b.w * (back ? 0.7 : 0.3), y: portY(b) }]
          : (() => {
              const e = sideTip(b, inSide, dy('to'));
              return [{ x: channelX(b, inSide), y: e.y }, e];
            })();
        const s = start[start.length - 1]!;
        const e = end[0]!;
        return orth(
          [...start, { x: s.x, y: lane }, { x: e.x, y: lane }, ...end],
          labelAt({ x: (s.x + e.x) / 2, y: lane }),
        );
      }
    }
  };

  const routes = plans.map(route);
  const initialState = initial ? placed.get(initial) : undefined;
  const entryRoute = initialState
    ? (() => {
        const tip = sideTip(initialState, 'left', 0);
        const dot = { x: tip.x - ENTRY_GAP, y: tip.y };
        return { dot, ...orth([{ x: dot.x + 12, y: dot.y }, tip], null) };
      })()
    : null;

  separateLabels(routes, [...placed.values()]);

  // Normalise so the bounding box of everything drawn starts at PAD.
  const xs: number[] = [];
  const ys: number[] = [];
  const grow = (p: Pt, rx = 0, ry = 0) => {
    xs.push(p.x - rx, p.x + rx);
    ys.push(p.y - ry, p.y + ry);
  };
  for (const p of placed.values()) {
    grow({ x: p.x, y: p.y });
    grow({ x: p.x + p.w, y: p.y + p.h });
  }
  for (const r of routes) {
    for (const seg of r.segs) for (const p of seg.slice(1) as Pt[]) grow(p);
    grow(r.tip, ARROW_LEN, ARROW_LEN);
    if (r.label) grow(r.label, r.label.w / 2, r.label.h / 2);
  }
  if (entryRoute) grow(entryRoute.dot, 14, 14);
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const shift = (p: Pt): Pt => ({ x: Math.round((p.x - minX) * 10) / 10, y: Math.round((p.y - minY) * 10) / 10 });
  const path = (segs: Seg[]) =>
    segs
      .map(([cmd, ...pts]) => `${cmd} ${(pts as Pt[]).map((p) => `${shift(p).x} ${shift(p).y}`).join(', ')}`)
      .join(' ');

  return {
    states: states.map((s) => {
      const p = placed.get(s.id)!;
      return { ...p, ...shift(p) };
    }),
    transitions: routes.map((r, i) => ({
      transition: edges[i]!,
      d: path(r.segs),
      tip: shift(r.tip),
      dir: r.dir,
      label: r.label ? { ...r.label, ...shift(r.label) } : null,
    })),
    entry: entryRoute
      ? { dot: shift(entryRoute.dot), d: path(entryRoute.segs), tip: shift(entryRoute.tip), dir: entryRoute.dir }
      : null,
    layerOf,
    width: Math.max(...xs) - minX + PAD,
    height: Math.max(...ys) - minY + PAD,
  };
}

/** Nudges label pills vertically until none overlap each other or a state. Deterministic: fixed passes in input order. */
function separateLabels(routes: Route[], states: PlacedState[]): void {
  const labels = routes.flatMap((r) => (r.label ? [r.label] : []));
  const M = 6;
  const overlapY = (a: Pt & LabelBox, bx: number, by: number, bw: number, bh: number) => {
    const ox = Math.min(a.x + a.w / 2, bx + bw / 2) - Math.max(a.x - a.w / 2, bx - bw / 2);
    const oy = Math.min(a.y + a.h / 2, by + bh / 2) - Math.max(a.y - a.h / 2, by - bh / 2);
    return ox > -M && oy > -M ? oy + M : 0;
  };
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!;
        const b = labels[j]!;
        const o = overlapY(a, b.x, b.y, b.w, b.h);
        if (o > 0) {
          const dir = b.y >= a.y ? 1 : -1;
          a.y -= (dir * o) / 2;
          b.y += (dir * o) / 2;
          moved = true;
        }
      }
      for (const s of states) {
        const a = labels[i]!;
        const o = overlapY(a, s.x + s.w / 2, s.y + s.h / 2, s.w, s.h);
        if (o > 0) {
          a.y += a.y >= s.y + s.h / 2 ? o : -o;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, in layout units: a state's
 * card, a transition's label (or the end of its arrow, when it has none). A note keeps off both.
 */
export function stateBoxes(layout: StateLayout): LayoutBoxes {
  const card = (p: PlacedState): Box => ({ x: p.x, y: p.y, width: p.w, height: p.h });
  const transition = (r: RoutedTransition): Box =>
    r.label
      ? around(r.label, r.label.w, r.label.h)
      : around({ x: r.tip.x - r.dir.x * 40, y: r.tip.y - r.dir.y * 40 }, 36, 36);
  const boxes = new Map<string, Box>([
    ...layout.states.map((p): [string, Box] => [`s:${p.state.id}`, card(p)]),
    ...layout.transitions.map((r, i): [string, Box] => [`t:${i}`, transition(r)]),
  ]);
  return {
    boxes,
    obstacles: [...layout.states.map(card), ...layout.transitions.flatMap((r) => (r.label ? [transition(r)] : []))],
  };
}

/** The scale a state diagram draws at in `box`: as large as fits, up to 1.25. */
export const stateScale = (layout: StateLayout, box: { width: number; height: number }): number =>
  Math.min(box.width / layout.width, box.height / layout.height, 1.25);
