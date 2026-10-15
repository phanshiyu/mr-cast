import type { ArchEdge, ArchNode } from '../types';

export const NODE_W = 320;
export const NODE_H = 104;
const COL_GAP = 280;
const ROW_GAP = 64;
const PAD = 40;
const LOOP_LIFT = 90;

export interface PositionedNode {
  node: ArchNode;
  layer: number;
  /** Top-left corner in layout units. */
  x: number;
  y: number;
}

export interface RoutedEdge {
  edge: ArchEdge;
  /** SVG path data for a single cubic bezier. */
  d: string;
  mid: { x: number; y: number };
}

export interface ArchLayout {
  nodes: PositionedNode[];
  edges: RoutedEdge[];
  layerCount: number;
  width: number;
  height: number;
}

/** Edges that close a cycle, found by DFS in input order so the result is deterministic. */
function backEdges(nodes: readonly ArchNode[], edges: readonly ArchEdge[]): Set<ArchEdge> {
  const out = new Map<string, ArchEdge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const state = new Map<string, 'active' | 'done'>();
  const back = new Set<ArchEdge>();
  const visit = (id: string) => {
    state.set(id, 'active');
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.to);
      if (s === 'active') back.add(e);
      else if (s === undefined) visit(e.to);
    }
    state.set(id, 'done');
  };
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);
  return back;
}

function assignLayers(nodes: readonly ArchNode[], dagEdges: readonly ArchEdge[]): Map<string, number> {
  const preds = new Map<string, string[]>();
  for (const e of dagEdges) preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
  const layer = new Map<string, number>();
  const resolve = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    const value = Math.max(-1, ...(preds.get(id) ?? []).map(resolve)) + 1;
    layer.set(id, value);
    return value;
  };
  for (const n of nodes) resolve(n.id);
  return layer;
}

/** One down and one up barycenter sweep; ties keep input order because Array.sort is stable. */
function orderLayers(columns: ArchNode[][], dagEdges: readonly ArchEdge[]): void {
  const neighbours = (id: string, dir: 'in' | 'out') =>
    dagEdges.filter((e) => (dir === 'in' ? e.to === id : e.from === id)).map((e) => (dir === 'in' ? e.from : e.to));
  const sweep = (from: number, to: number, step: number, dir: 'in' | 'out') => {
    for (let l = from; l !== to; l += step) {
      const ref = columns[l - step]!;
      const col = columns[l]!;
      const index = new Map(ref.map((n, i) => [n.id, i]));
      const key = new Map(
        col.map((n, i) => {
          const ns = neighbours(n.id, dir).flatMap((id) => (index.has(id) ? [index.get(id)!] : []));
          return [n.id, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : i];
        }),
      );
      col.sort((a, b) => key.get(a.id)! - key.get(b.id)!);
    }
  };
  sweep(1, columns.length, 1, 'in');
  sweep(columns.length - 2, -1, -1, 'out');
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt): Omit<RoutedEdge, 'edge'> {
  return {
    d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`,
    mid: { x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8, y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8 },
  };
}

interface Pt {
  x: number;
  y: number;
}

const LANE_MARGIN = 14;

/**
 * Edges that skip layers would run underneath the nodes in between; route those through a
 * horizontal lane just above or below the in-between nodes instead.
 */
function skipLane(a: PositionedNode, b: PositionedNode, all: readonly PositionedNode[]): number | null {
  const between = all.filter((n) => n.layer > a.layer && n.layer < b.layer);
  if (!between.length) return null;
  const y0 = a.y + NODE_H / 2;
  const y1 = b.y + NODE_H / 2;
  const blocked = between.some((n) => {
    const t = (n.x + NODE_W / 2 - (a.x + NODE_W)) / (b.x - (a.x + NODE_W));
    const y = y0 + (y1 - y0) * t;
    return y > n.y - LANE_MARGIN && y < n.y + NODE_H + LANE_MARGIN;
  });
  if (!blocked) return null;
  const above = Math.min(...between.map((n) => n.y)) - ROW_GAP / 2;
  const below = Math.max(...between.map((n) => n.y + NODE_H)) + ROW_GAP / 2;
  const mid = (y0 + y1) / 2;
  return Math.abs(mid - above) <= Math.abs(mid - below) ? above : below;
}

function route(edge: ArchEdge, a: PositionedNode, b: PositionedNode, all: readonly PositionedNode[]): RoutedEdge {
  if (b.layer > a.layer) {
    const p0 = { x: a.x + NODE_W, y: a.y + NODE_H / 2 };
    const p3 = { x: b.x, y: b.y + NODE_H / 2 };
    const lane = skipLane(a, b, all);
    if (lane !== null) {
      const gap = COL_GAP / 2;
      const l0 = { x: p0.x + gap, y: lane };
      const l1 = { x: p3.x - gap, y: lane };
      const d =
        `M ${p0.x} ${p0.y} C ${p0.x + gap / 2} ${p0.y}, ${l0.x - gap / 2} ${lane}, ${l0.x} ${lane} ` +
        `L ${l1.x} ${lane} C ${l1.x + gap / 2} ${lane}, ${p3.x - gap / 2} ${p3.y}, ${p3.x} ${p3.y}`;
      return { edge, d, mid: { x: (l0.x + l1.x) / 2, y: lane } };
    }
    const dx = (p3.x - p0.x) / 2;
    return { edge, ...cubic(p0, { x: p0.x + dx, y: p0.y }, { x: p3.x - dx, y: p3.y }, p3) };
  }
  if (b.layer === a.layer) {
    const down = b.y > a.y;
    const p0 = { x: a.x + NODE_W / 2 + 40, y: down ? a.y + NODE_H : a.y };
    const p3 = { x: b.x + NODE_W / 2 + 40, y: down ? b.y : b.y + NODE_H };
    const bulge = NODE_W / 2 + 10;
    return { edge, ...cubic(p0, { x: p0.x + bulge, y: p0.y }, { x: p3.x + bulge, y: p3.y }, p3) };
  }
  const spanned = all.filter((n) => n.layer >= b.layer && n.layer <= a.layer);
  const top = Math.min(...spanned.map((n) => n.y)) - LOOP_LIFT;
  const p0 = { x: a.x + NODE_W / 2, y: a.y };
  const p3 = { x: b.x + NODE_W / 2, y: b.y };
  return { edge, ...cubic(p0, { x: p0.x, y: top }, { x: p3.x, y: top }, p3) };
}

export function layoutArch(nodes: readonly ArchNode[], edges: readonly ArchEdge[]): ArchLayout {
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const back = backEdges(nodes, valid);
  const dag = valid.filter((e) => !back.has(e));
  const layerOf = assignLayers(nodes, dag);

  const layerCount = Math.max(1, ...nodes.map((n) => layerOf.get(n.id)! + 1));
  const columns: ArchNode[][] = Array.from({ length: layerCount }, () => []);
  for (const n of nodes) columns[layerOf.get(n.id)!]!.push(n);
  orderLayers(columns, dag);

  const tallest = Math.max(...columns.map((c) => c.length));
  const innerH = tallest * NODE_H + (tallest - 1) * ROW_GAP;
  const hasBackward = valid.some((e) => back.has(e) || layerOf.get(e.to)! < layerOf.get(e.from)!);
  const top = PAD + (hasBackward ? LOOP_LIFT : 0);
  const positioned = new Map<string, PositionedNode>();
  columns.forEach((col, layer) => {
    const colH = col.length * NODE_H + (col.length - 1) * ROW_GAP;
    col.forEach((node, i) => {
      positioned.set(node.id, {
        node,
        layer,
        x: PAD + layer * (NODE_W + COL_GAP),
        y: top + (innerH - colH) / 2 + i * (NODE_H + ROW_GAP),
      });
    });
  });

  const hasSameLayer = valid.some((e) => layerOf.get(e.to) === layerOf.get(e.from));
  return {
    nodes: nodes.map((n) => positioned.get(n.id)!),
    edges: valid.map((e) => route(e, positioned.get(e.from)!, positioned.get(e.to)!, [...positioned.values()])),
    layerCount,
    width: PAD * 2 + layerCount * NODE_W + (layerCount - 1) * COL_GAP + (hasSameLayer ? 80 : 0),
    height: top + innerH + PAD,
  };
}
