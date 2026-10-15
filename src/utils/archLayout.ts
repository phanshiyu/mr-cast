import type { ArchEdge, ArchNode, ArchScene } from '../types';

export const NODE_W = 320;
export const NODE_H = 104;
const PAD = 40;
const LOOP_LIFT = 90;
const LANE_MARGIN = 14;
/** Room around a group's nodes inside its box, and the strip its name sits in. */
export const GROUP_PAD = 26;
export const GROUP_HEAD = 44;
/** Between one group's box and the next band of nodes. */
const BAND_GAP = 40;

export type ArchDirection = NonNullable<ArchScene['layout']>;

/**
 * The layout runs in layer coordinates: `u` along the layers (the direction edges point) and `v` across
 * them. Left to right, u is x; top to bottom, u is y. Each direction has its own node extents and gaps.
 */
interface Axes {
  /** Node extent along u and along v. */
  U: number;
  V: number;
  uGap: number;
  vGap: number;
  /**
   * Where along an edge between neighbouring layers its label sits. Top to bottom, a group's name sits
   * just above its first node, so labels sit nearer the source and clear it.
   */
  labelAt: number;
  xy: (u: number, v: number) => Pt;
}

const AXES: Record<ArchDirection, Axes> = {
  LR: { U: NODE_W, V: NODE_H, uGap: 280, vGap: 64, labelAt: 0.5, xy: (u, v) => ({ x: u, y: v }) },
  TB: { U: NODE_H, V: NODE_W, uGap: 130, vGap: 56, labelAt: 0.4, xy: (u, v) => ({ x: v, y: u }) },
};

export interface Pt {
  x: number;
  y: number;
}

export interface PositionedNode {
  node: ArchNode;
  layer: number;
  /** Top-left corner in layout units. */
  x: number;
  y: number;
}

export interface RoutedEdge {
  edge: ArchEdge;
  index: number;
  /** SVG path data. */
  d: string;
  mid: Pt;
}

export interface PlacedGroup {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Earliest layer it holds a node in, for when it draws in. */
  layer: number;
}

export interface ArchLayout {
  nodes: PositionedNode[];
  edges: RoutedEdge[];
  groups: PlacedGroup[];
  layerCount: number;
  width: number;
  height: number;
}

/** A node in layer coordinates: `u` and `v` are its corner nearest the origin. */
interface Placed {
  node: ArchNode;
  layer: number;
  u: number;
  v: number;
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

/**
 * Bands across the layers: one per group, in order of each group's first node, and one for the nodes
 * without a group. A band keeps the same v range in every layer, so group boxes never overlap.
 */
interface Band {
  name: string | null;
  /** Most nodes the band has in any one layer. */
  size: number;
  /** Where its nodes start along v. */
  v0: number;
}

function bandsOf(nodes: readonly ArchNode[], columns: readonly ArchNode[][]): Band[] {
  const names = [...new Set(nodes.map((n) => n.group ?? null))];
  return names.map((name) => ({
    name,
    size: Math.max(...columns.map((col) => col.filter((n) => (n.group ?? null) === name).length)),
    v0: 0,
  }));
}

/** A cubic bezier in layer coordinates, as path data plus the point at `t` where its label sits. */
function cubic(axes: Axes, p0: Pt, p1: Pt, p2: Pt, p3: Pt, t = 0.5): { d: string; mid: Pt } {
  const [a, b, c, d] = [p0, p1, p2, p3].map((p) => axes.xy(p.x, p.y)) as [Pt, Pt, Pt, Pt];
  const w = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3] as const;
  return {
    d: `M ${a.x} ${a.y} C ${b.x} ${b.y}, ${c.x} ${c.y}, ${d.x} ${d.y}`,
    mid: { x: w[0] * a.x + w[1] * b.x + w[2] * c.x + w[3] * d.x, y: w[0] * a.y + w[1] * b.y + w[2] * c.y + w[3] * d.y },
  };
}

/**
 * Edges that skip layers would run underneath the nodes in between; route those through a lane just
 * before or after the in-between nodes along v instead. Points here are (u, v) in `x` and `y`.
 */
function skipLane(axes: Axes, a: Placed, b: Placed, all: readonly Placed[]): number | null {
  const { U, V, vGap } = axes;
  const between = all.filter((n) => n.layer > a.layer && n.layer < b.layer);
  if (!between.length) return null;
  const v0 = a.v + V / 2;
  const v1 = b.v + V / 2;
  const blocked = between.some((n) => {
    const t = (n.u + U / 2 - (a.u + U)) / (b.u - (a.u + U));
    const v = v0 + (v1 - v0) * t;
    return v > n.v - LANE_MARGIN && v < n.v + V + LANE_MARGIN;
  });
  if (!blocked) return null;
  const before = Math.min(...between.map((n) => n.v)) - vGap / 2;
  const after = Math.max(...between.map((n) => n.v + V)) + vGap / 2;
  const mid = (v0 + v1) / 2;
  return Math.abs(mid - before) <= Math.abs(mid - after) ? before : after;
}

function route(axes: Axes, edge: ArchEdge, index: number, a: Placed, b: Placed, all: readonly Placed[]): RoutedEdge {
  const { U, V, uGap, xy } = axes;
  if (b.layer > a.layer) {
    const p0 = { x: a.u + U, y: a.v + V / 2 };
    const p3 = { x: b.u, y: b.v + V / 2 };
    const lane = skipLane(axes, a, b, all);
    if (lane !== null) {
      const gap = uGap / 2;
      const pts = [p0, { x: p0.x + gap / 2, y: p0.y }, { x: p0.x + gap - gap / 2, y: lane }, { x: p0.x + gap, y: lane }, { x: p3.x - gap, y: lane }, { x: p3.x - gap + gap / 2, y: lane }, { x: p3.x - gap / 2, y: p3.y }, p3].map(
        (p) => xy(p.x, p.y),
      );
      const s = (p: Pt) => `${p.x} ${p.y}`;
      const d = `M ${s(pts[0]!)} C ${s(pts[1]!)}, ${s(pts[2]!)}, ${s(pts[3]!)} L ${s(pts[4]!)} C ${s(pts[5]!)}, ${s(pts[6]!)}, ${s(pts[7]!)}`;
      return { edge, index, d, mid: xy((p0.x + gap + p3.x - gap) / 2, lane) };
    }
    const du = (p3.x - p0.x) / 2;
    return { edge, index, ...cubic(axes, p0, { x: p0.x + du, y: p0.y }, { x: p3.x - du, y: p3.y }, p3, b.layer === a.layer + 1 ? axes.labelAt : 0.5) };
  }
  if (b.layer === a.layer) {
    const down = b.v > a.v;
    const p0 = { x: a.u + U / 2 + 40, y: down ? a.v + V : a.v };
    const p3 = { x: b.u + U / 2 + 40, y: down ? b.v : b.v + V };
    const bulge = U / 2 + 10;
    return { edge, index, ...cubic(axes, p0, { x: p0.x + bulge, y: p0.y }, { x: p3.x + bulge, y: p3.y }, p3) };
  }
  const spanned = all.filter((n) => n.layer >= b.layer && n.layer <= a.layer);
  const top = Math.min(...spanned.map((n) => n.v)) - LOOP_LIFT;
  const p0 = { x: a.u + U / 2, y: a.v };
  const p3 = { x: b.u + U / 2, y: b.v };
  return { edge, index, ...cubic(axes, p0, { x: p0.x, y: top }, { x: p3.x, y: top }, p3) };
}

export function layoutArch(nodes: readonly ArchNode[], edges: readonly ArchEdge[], direction: ArchDirection = 'LR'): ArchLayout {
  const axes = AXES[direction];
  const { U, V, uGap, vGap, xy } = axes;
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const back = backEdges(nodes, valid);
  const dag = valid.filter((e) => !back.has(e));
  const layerOf = assignLayers(nodes, dag);

  const layerCount = Math.max(1, ...nodes.map((n) => layerOf.get(n.id)! + 1));
  const columns: ArchNode[][] = Array.from({ length: layerCount }, () => []);
  for (const n of nodes) columns[layerOf.get(n.id)!]!.push(n);
  orderLayers(columns, dag);
  const bands = bandsOf(nodes, columns);
  const bandOf = (n: ArchNode) => bands.findIndex((b) => b.name === (n.group ?? null));
  for (const col of columns) col.sort((a, b) => bandOf(a) - bandOf(b));

  const grouped = bands.some((b) => b.name !== null);
  // The group name sits above its nodes: along v left to right, along u top to bottom.
  const headV = direction === 'LR' ? GROUP_HEAD : 0;
  const headU = direction === 'TB' ? GROUP_HEAD : 0;
  const hasBackward = valid.some((e) => back.has(e) || layerOf.get(e.to)! < layerOf.get(e.from)!);
  const top = PAD + (hasBackward ? LOOP_LIFT : 0);
  const extent = (count: number) => count * V + (count - 1) * vGap;
  let cursor = top;
  bands.forEach((band, i) => {
    if (band.name !== null) cursor += headV + GROUP_PAD;
    band.v0 = cursor;
    cursor += extent(band.size) + (band.name !== null ? GROUP_PAD : 0) + (i < bands.length - 1 ? BAND_GAP : 0);
  });
  const u0 = PAD + (grouped ? GROUP_PAD + headU : 0);
  const uOf = (layer: number) => u0 + layer * (U + uGap);

  const placed = new Map<string, Placed>();
  columns.forEach((col, layer) => {
    bands.forEach((band, b) => {
      const members = col.filter((n) => bandOf(n) === b);
      members.forEach((node, i) => {
        placed.set(node.id, { node, layer, u: uOf(layer), v: band.v0 + (extent(band.size) - extent(members.length)) / 2 + i * (V + vGap) });
      });
    });
  });

  const groups = bands.flatMap((band): PlacedGroup[] => {
    if (band.name === null) return [];
    const layers = [...placed.values()].filter((p) => p.node.group === band.name).map((p) => p.layer);
    const [first, last] = [Math.min(...layers), Math.max(...layers)];
    const a = xy(uOf(first) - GROUP_PAD - headU, band.v0 - GROUP_PAD - headV);
    const b = xy(uOf(last) + U + GROUP_PAD, band.v0 + extent(band.size) + GROUP_PAD);
    return [{ name: band.name, x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y, layer: first }];
  });

  const all = [...placed.values()];
  const hasSameLayer = valid.some((e) => layerOf.get(e.to) === layerOf.get(e.from));
  const uSize = uOf(layerCount - 1) + U + (grouped ? GROUP_PAD : 0) + PAD + (hasSameLayer ? 80 : 0);
  const vSize = cursor + PAD;
  const size = xy(uSize, vSize);
  return {
    nodes: nodes.map((n) => {
      const p = placed.get(n.id)!;
      return { node: n, layer: p.layer, ...xy(p.u, p.v) };
    }),
    edges: valid.map((e) => route(axes, e, edges.indexOf(e), placed.get(e.from)!, placed.get(e.to)!, all)),
    groups,
    layerCount,
    width: size.x,
    height: size.y,
  };
}
