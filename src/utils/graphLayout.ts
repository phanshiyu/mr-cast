import { fitText, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { GraphEdge, GraphNode, GraphScene, NodeShape } from '../types';
import { badgeWords } from './marks';
import { sceneBox } from '../components/theme';
import { hasCallout } from '../fit/callout';
import { cardTexts, sharedTitleSize, type CardText } from './nodeText';
import { around, type Box, type LayoutBoxes } from './penGeometry';

export const NODE_W = 320;
/** Widest a card grows when the frame has room across, so long titles keep the full font. */
const NODE_W_MAX = 440;
export const NODE_H = 104;
/** A start or end pill is lower than a card; a decision's diamond is taller, as tall as its question needs. */
export const TERMINAL_H = 80;
const DECISION_HEIGHTS = [120, 140, 160, 180, 200];
/** A decision's question keeps at least this size before its diamond grows. */
const DECISION_COMFORT = 20;
/** Room around a decision's question inside its diamond, and around a terminal's words inside its pill. */
const DECISION_PAD = 10;
export const TERMINAL_PAD_X = 40;
/** How far a card's badges rise above its top edge. */
const BADGE_LIFT = 16;
/** Largest scale a small graph is drawn at. */
const MAX_SCALE = 1.3;
/** Margin around the graph across the layers. */
const PAD = 40;
const LOOP_LIFT = 90;
const LANE_MARGIN = 14;
/** Least room between a skip edge's lane and the edge of the graph. */
const LANE_EDGE = 8;
/** Room around a group's nodes inside its box, and the strip its name sits in. */
export const GROUP_PAD = 26;
export const GROUP_HEAD = 44;
/** Least gap between layers where a group's border crosses it, so edges have room on both sides of the border. */
const BORDERED_GAP = 64;
/** Between one group's box and the next band of nodes. */
const BAND_GAP = 40;

export const LABEL_FONT = 19;
export const LABEL_LINE_HEIGHT = 1.3;
export const LABEL_PAD = { x: 12, y: 5 };
const GROUP_FONT = 18;
const MONO_ADVANCE = 0.61;
/** Room between an edge label and whatever closes the gap before it or opens after it. */
const LABEL_CLEAR = 10;
/** Room an arrowhead needs before the node it points at, when no group strip already gives it. */
const ARROW_CLEAR = 24;
/** Width of the strip around a group's border that a label must not cover. */
const BORDER_CLEAR = 6;

export type GraphDirection = NonNullable<GraphScene['layout']>;

export const shapeOf = (node: GraphNode): NodeShape => node.shape ?? 'card';

/** A graph's direction: its own, or top to bottom when it branches at a decision, as a flowchart reads. */
export const graphDirection = (scene: Pick<GraphScene, 'layout' | 'nodes'>): GraphDirection => scene.layout ?? (scene.nodes.some((n) => shapeOf(n) === 'decision') ? 'TB' : 'LR');

/**
 * The width a decision's question has on `lines` lines at `size`: the widest box of that height that
 * fits inside a diamond `w` wide and `h` tall, less its padding.
 */
const diamondWidth = (w: number, h: number) => (lines: number, size: number) => w * (1 - (lines * size * SLOTS.decision.lineHeight + 2 * DECISION_PAD) / h) - 2 * DECISION_PAD;

function decisionFit(node: GraphNode, w: number, h: number, path: string, min = SLOTS.decision.min): Fit {
  return fitText(node.label, { ...SLOTS.decision, min, width: diamondWidth(w, h) }, path);
}

/** The height of a graph's diamonds: the least at which every question keeps a comfortable size. */
function decisionHeight(nodes: readonly GraphNode[], w: number): number {
  const decisions = nodes.filter((n) => shapeOf(n) === 'decision');
  return DECISION_HEIGHTS.find((h) => decisions.every((n) => decisionFit(n, w, h, '', DECISION_COMFORT).fits)) ?? DECISION_HEIGHTS[DECISION_HEIGHTS.length - 1]!;
}

/** How tall each shape is drawn, given the graph's diamond height. */
const shapeHeight = (shape: NodeShape, diamond: number) => (shape === 'decision' ? diamond : shape === 'terminal' ? TERMINAL_H : NODE_H);

/**
 * Each node's text, by id. A card fits its title and caption; a step its title and caption with no icon;
 * a terminal its words in its pill; a decision its question in its diamond. Cards and steps share one title size.
 */
function nodeTexts(nodes: readonly GraphNode[], w: number, diamond: number): Map<string, CardText> {
  const boxed = nodes.flatMap((node, index) => (shapeOf(node) === 'card' || shapeOf(node) === 'step' ? [{ node: shapeOf(node) === 'step' ? { ...node, icon: undefined } : node, index }] : []));
  const texts = cardTexts(boxed.map((b) => b.node), w, NODE_H, 'large', (i) => `nodes[${boxed[i]!.index}]`);
  nodes.forEach((node, i) => {
    if (shapeOf(node) === 'terminal') texts.set(node.id, { title: fitText(node.label, sized(SLOTS.terminal, w - 2 * TERMINAL_PAD_X), `nodes[${i}].label`), caption: null });
    if (shapeOf(node) === 'decision') texts.set(node.id, { title: decisionFit(node, w, diamond, `nodes[${i}].label`), caption: null });
  });
  return texts;
}

/**
 * The layout runs in layer coordinates: `u` along the layers (the direction edges point) and `v` across
 * them. Left to right, u is x; top to bottom, u is y. Each direction has its own node extents and gaps;
 * along u each layer takes what its own nodes need (Placed.uSize).
 */
interface Axes {
  /** Node extent across the layers. */
  V: number;
  /** Least gap between layers; a gap grows to hold its labels and group strips. */
  uGap: number;
  vGap: number;
  /** Margin before the first layer and after the last. */
  uPad: number;
  /** Characters per label line: left to right a label sits in a column gap, top to bottom in a row gap, where width is free. */
  labelChars: number;
  /** A label's extent along u and along v, from its width and height. */
  labelU: (box: { width: number; height: number }) => number;
  labelV: (box: { width: number; height: number }) => number;
  xy: (u: number, v: number) => Pt;
}

/** Top to bottom the frame is short for its layers, so the layers keep less margin there. */
function axesFor(direction: GraphDirection, nodeW: number, cellH: number): Axes {
  return direction === 'LR'
    ? { V: cellH, uGap: 280, vGap: 64, uPad: PAD, labelChars: 22, labelU: (b) => b.width, labelV: (b) => b.height, xy: (u, v) => ({ x: u, y: v }) }
    : { V: nodeW, uGap: 48, vGap: 56, uPad: 20, labelChars: 32, labelU: (b) => b.height, labelV: (b) => b.width, xy: (u, v) => ({ x: v, y: u }) };
}

export interface Pt {
  x: number;
  y: number;
}

export interface PositionedNode {
  node: GraphNode;
  layer: number;
  /** Top-left corner of its cell in layout units. */
  x: number;
  y: number;
  /** The shape as drawn, centred in its cell. */
  box: { x: number; y: number; width: number; height: number };
}

export interface EdgeLabelBox {
  text: Fit;
  /** Centre in layout units. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoutedEdge {
  edge: GraphEdge;
  index: number;
  /** SVG path data. */
  d: string;
  label: EdgeLabelBox | null;
  /** The point where its label sits or would sit, in layout units. */
  mid: Pt;
  /** Points along it, in layout units. */
  points: Pt[];
}

export interface PlacedGroup {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Earliest layer it holds a node in, for when it draws in. */
  layer: number;
  /** Which end of its top edge the name sits at: top to bottom, the end that edges coming in from outside avoid. */
  nameAt: 'left' | 'right';
  /** Its name, fitted to the room its box gives it. */
  label: Fit;
}

export interface GraphLayout {
  nodes: PositionedNode[];
  edges: RoutedEdge[];
  groups: PlacedGroup[];
  layerCount: number;
  nodeWidth: number;
  /** Height of the graph's diamonds. */
  diamondHeight: number;
  /** Each node's text, by node id: a title and, on a card or step, a caption. */
  texts: Map<string, CardText>;
  width: number;
  height: number;
}

/**
 * A node in layer coordinates: `u` and `v` are its cell's corner nearest the origin, and `iu` and `iv` how
 * far its shape sits inside its cell, so edges meet the shape and not the cell.
 */
interface Placed {
  node: GraphNode;
  layer: number;
  u: number;
  v: number;
  /** Its layer's extent along u: the node width left to right, the tallest shape in the layer top to bottom. */
  uSize: number;
  iu: number;
  iv: number;
}

/** Edges that close a cycle, found by DFS in input order so the result is deterministic. */
function backEdges(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Set<GraphEdge> {
  const out = new Map<string, GraphEdge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const state = new Map<string, 'active' | 'done'>();
  const back = new Set<GraphEdge>();
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

function assignLayers(nodes: readonly GraphNode[], dagEdges: readonly GraphEdge[]): Map<string, number> {
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
function orderLayers(columns: GraphNode[][], dagEdges: readonly GraphEdge[]): void {
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
 * A band holds one group's nodes, or one run of neighbouring layers of nodes without a group, and keeps
 * one v range across its layers. Bands whose layers do not overlap share a track, so group boxes never
 * overlap and the graph is only as deep across the layers as its busiest stretch.
 */
interface Band {
  name: string | null;
  /** First and last layer it holds a node in. */
  first: number;
  last: number;
  /** Most nodes it has in any one layer. */
  size: number;
  track: number;
  /** Where its nodes start along v. */
  v0: number;
}

function bandsOf(nodes: readonly GraphNode[], columns: readonly GraphNode[][]): Band[] {
  const bands: Band[] = [];
  for (const name of new Set(nodes.map((n) => n.group ?? null))) {
    const counts = columns.map((col) => col.filter((n) => (n.group ?? null) === name).length);
    const layers = counts.flatMap((c, l) => (c ? [l] : []));
    const runs: [number, number][] = [];
    for (const l of layers) {
      const run = runs.at(-1);
      if (run && (name !== null || run[1] === l - 1)) run[1] = l;
      else runs.push([l, l]);
    }
    for (const [first, last] of runs) bands.push({ name, first, last, size: Math.max(...counts.slice(first, last + 1)), track: 0, v0: 0 });
  }
  const tracks: Band[][] = [];
  for (const band of bands) {
    let t = tracks.findIndex((track) => track.every((o) => o.last < band.first || o.first > band.last));
    if (t < 0) t = tracks.push([]) - 1;
    tracks[t]!.push(band);
    band.track = t;
  }
  return bands;
}

/** An edge's path data and points along all of it, and the point `at(t)` in layout units, from `t0`, where its label may sit. */
interface Curve {
  d: string;
  points: Pt[];
  at: (t: number) => Pt;
  t0: number;
}

function bezier(a: Pt, b: Pt, c: Pt, d: Pt): (t: number) => Pt {
  return (t) => {
    const w = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3] as const;
    return { x: w[0] * a.x + w[1] * b.x + w[2] * c.x + w[3] * d.x, y: w[0] * a.y + w[1] * b.y + w[2] * c.y + w[3] * d.y };
  };
}

const sample = (f: (t: number) => Pt, n = 32) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

/** A cubic bezier in layer coordinates. */
function cubic(axes: Axes, p0: Pt, p1: Pt, p2: Pt, p3: Pt, t0 = 0.5): Curve {
  const [a, b, c, d] = [p0, p1, p2, p3].map((p) => axes.xy(p.x, p.y)) as [Pt, Pt, Pt, Pt];
  const at = bezier(a, b, c, d);
  return { d: `M ${a.x} ${a.y} C ${b.x} ${b.y}, ${c.x} ${c.y}, ${d.x} ${d.y}`, points: sample(at), at, t0 };
}

/** The t at which an edge between neighbouring layers, with its handles halfway along u, reaches `u`. */
function tAtU(u0: number, u3: number, u: number): number {
  const target = (u - u0) / (u3 - u0);
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2;
    if (1.5 * t * (1 - t) + t ** 3 < target) lo = t;
    else hi = t;
  }
  return (lo + hi) / 2;
}

/** How many lanes out from the nodes a skip edge may go on either side before it gives up and shares. */
const LANE_RANKS = 5;

/**
 * Edges that skip layers would run underneath the nodes in between; each such edge routes along v through
 * a lane just before or after those nodes instead. A lane holds one edge over any stretch of u, so where
 * two edges' runs overlap the second takes the lane on the other side, then one `step` further out, and so
 * on, never a lane that crosses a node. Returns a lane v per edge, or null for an edge that runs clear.
 * Points here are (u, v) in `x` and `y`.
 */
function skipLanes(axes: Axes, pairs: readonly [Placed, Placed][], all: readonly Placed[], step: number): (number | null)[] {
  const { V, vGap } = axes;
  const taken: { v: number; u0: number; u1: number }[] = [];
  return pairs.map(([a, b]) => {
    const between = all.filter((n) => n.layer > a.layer && n.layer < b.layer);
    if (!between.length) return null;
    const [u0, u1] = [a.u + a.uSize, b.u];
    const v0 = a.v + V / 2;
    const v1 = b.v + V / 2;
    const blocked = between.some((n) => {
      const t = (n.u + n.uSize / 2 - u0) / (u1 - u0);
      const v = v0 + (v1 - v0) * t;
      return v > n.v - LANE_MARGIN && v < n.v + V + LANE_MARGIN;
    });
    if (!blocked) return null;
    const before = Math.min(...between.map((n) => n.v)) - vGap / 2;
    const after = Math.max(...between.map((n) => n.v + V)) + vGap / 2;
    const mid = (v0 + v1) / 2;
    const sides: [number, number][] = Math.abs(mid - before) <= Math.abs(mid - after) ? [[before, -1], [after, 1]] : [[after, 1], [before, -1]];
    const crossesNode = (v: number) => all.some((n) => n.u < u1 && n.u + n.uSize > u0 && v > n.v - LANE_MARGIN && v < n.v + V + LANE_MARGIN);
    const sharesLane = (v: number) => taken.some((t) => Math.abs(t.v - v) < 1 && t.u0 < u1 && u0 < t.u1);
    const candidates = Array.from({ length: LANE_RANKS }, (_, k) => sides.map(([v, out]) => v + out * k * step)).flat();
    const v = candidates.find((c) => !crossesNode(c) && !sharesLane(c)) ?? sides[0]![0];
    taken.push({ v, u0, u1 });
    return v;
  });
}

/** `lane` is the v a skipping edge runs along, or null to run straight; `labelU` is where along u a label between neighbouring layers sits best. */
function route(axes: Axes, gaps: readonly number[], a: Placed, b: Placed, all: readonly Placed[], lane: number | null, labelU: number): Curve {
  const { V, xy } = axes;
  if (b.layer > a.layer) {
    const p0 = { x: a.u + a.uSize - a.iu, y: a.v + V / 2 };
    const p3 = { x: b.u + b.iu, y: b.v + V / 2 };
    if (lane !== null) {
      const g0 = gaps[a.layer]! / 2;
      const g1 = gaps[b.layer - 1]! / 2;
      const pts = [p0, { x: p0.x + g0 / 2, y: p0.y }, { x: p0.x + g0 / 2, y: lane }, { x: p0.x + g0, y: lane }, { x: p3.x - g1, y: lane }, { x: p3.x - g1 / 2, y: lane }, { x: p3.x - g1 / 2, y: p3.y }, p3].map(
        (p) => xy(p.x, p.y),
      );
      const s = (p: Pt) => `${p.x} ${p.y}`;
      const d = `M ${s(pts[0]!)} C ${s(pts[1]!)}, ${s(pts[2]!)}, ${s(pts[3]!)} L ${s(pts[4]!)} C ${s(pts[5]!)}, ${s(pts[6]!)}, ${s(pts[7]!)}`;
      const [l0, l1] = [pts[3]!, pts[4]!];
      const at = (t: number) => ({ x: l0.x + (l1.x - l0.x) * t, y: l0.y + (l1.y - l0.y) * t });
      const points = [...sample(bezier(pts[0]!, pts[1]!, pts[2]!, pts[3]!), 16), ...sample(at, 16), ...sample(bezier(pts[4]!, pts[5]!, pts[6]!, pts[7]!), 16)];
      return { d, points, at, t0: 0.5 };
    }
    const du = (p3.x - p0.x) / 2;
    return cubic(axes, p0, { x: p0.x + du, y: p0.y }, { x: p3.x - du, y: p3.y }, p3, b.layer === a.layer + 1 ? tAtU(p0.x, p3.x, labelU) : 0.5);
  }
  if (b.layer === a.layer) {
    const down = b.v > a.v;
    const p0 = { x: a.u + a.uSize / 2 + 40, y: down ? a.v + V - a.iv : a.v + a.iv };
    const p3 = { x: b.u + b.uSize / 2 + 40, y: down ? b.v + b.iv : b.v + V - b.iv };
    const bulge = a.uSize / 2 + 10;
    return cubic(axes, p0, { x: p0.x + bulge, y: p0.y }, { x: p3.x + bulge, y: p3.y }, p3);
  }
  const spanned = all.filter((n) => n.layer >= b.layer && n.layer <= a.layer);
  const top = Math.min(...spanned.map((n) => n.v)) - LOOP_LIFT;
  const p0 = { x: a.u + a.uSize / 2, y: a.v + a.iv };
  const p3 = { x: b.u + b.uSize / 2, y: b.v + b.iv };
  return cubic(axes, p0, { x: p0.x, y: top }, { x: p3.x, y: top }, p3);
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Where a group's name sits inside its box, and the font it is set in. */
export const GROUP_NAME = { x: 22, y: 12, font: GROUP_FONT, letterSpacing: 1.4 };

/** Widest a group's name may run: top to bottom it keeps to half the box, clear of edges entering at the middle. */
export const groupNameMax = (g: { width: number }, direction: GraphDirection) => (direction === 'TB' ? g.width / 2 - 34 : g.width - 44);

/** What a label must stay clear of in a group: its four borders and its name. */
function groupObstacles(g: PlacedGroup): Rect[] {
  const b = BORDER_CLEAR;
  const nameW = g.label.width;
  return [
    { x: g.x - b, y: g.y - b, width: g.width + 2 * b, height: 2 * b },
    { x: g.x - b, y: g.y + g.height - b, width: g.width + 2 * b, height: 2 * b },
    { x: g.x - b, y: g.y - b, width: 2 * b, height: g.height + 2 * b },
    { x: g.x + g.width - b, y: g.y - b, width: 2 * b, height: g.height + 2 * b },
    { x: g.nameAt === 'left' ? g.x + GROUP_NAME.x : g.x + g.width - GROUP_NAME.x - nameW, y: g.y + GROUP_NAME.y, width: nameW, height: GROUP_NAME.font * 1.3 },
  ];
}

/** An edge's label fitted to `chars` monospace cells, and the pill around it. */
function labelSize(text: string, chars: number, path: string): { text: Fit; width: number; height: number } {
  const fit = fitText(text, sized(SLOTS.edgeLabel, chars * MONO_ADVANCE * LABEL_FONT), path);
  const cells = Math.max(...fit.lines.map((line) => line.reduce((n, run) => n + run.text.length, 0)));
  return {
    text: fit,
    width: Math.max(cells * MONO_ADVANCE * fit.size, fit.width) + 2 * LABEL_PAD.x + 2,
    height: fit.lines.length * fit.size * LABEL_LINE_HEIGHT + 2 * LABEL_PAD.y + 2,
  };
}

/** Where along `curve` a label may sit, nearest its `t0` first. */
function labelSpots(curve: Curve): Pt[] {
  const ts = [curve.t0];
  for (let k = 1; k <= 30; k++) for (const t of [curve.t0 - 0.03 * k, curve.t0 + 0.03 * k]) if (t > 0.05 && t < 0.95) ts.push(t);
  return ts.map(curve.at);
}

/** What a label of `size` at `at` covers: area of `obstacles` (`cost`), then points of other edges' `lines`. */
function labelCost(at: Pt, size: { width: number; height: number }, obstacles: readonly Rect[], lines: readonly Pt[]): { cost: number; crossed: number } {
  const rect = { x: at.x - size.width / 2, y: at.y - size.height / 2, width: size.width, height: size.height };
  return {
    cost: obstacles.reduce((sum, o) => sum + overlap(rect, o), 0),
    crossed: lines.filter((p) => p.x > rect.x && p.x < rect.x + rect.width && p.y > rect.y && p.y < rect.y + rect.height).length,
  };
}

/** The spot along `curve` that covers least, nearest its `t0` among equals. */
function placeLabel(curve: Curve, size: { width: number; height: number }, obstacles: readonly Rect[], lines: readonly Pt[]): Pt & { cost: number } {
  let best = { at: curve.at(curve.t0), cost: Infinity, crossed: Infinity };
  for (const at of labelSpots(curve)) {
    const { cost, crossed } = labelCost(at, size, obstacles, lines);
    if (cost < best.cost || (cost === best.cost && crossed < best.crossed)) best = { at, cost, crossed };
    if (cost === 0 && crossed === 0) break;
  }
  return { ...best.at, cost: best.cost };
}

/**
 * Lays the graph out in layout units with cards `nodeW` wide. Each gap between layers is sized to hold
 * what crosses it: the strip below a group that ends, the name strip above a group that starts, and
 * the tallest (top to bottom) or widest (left to right) label between those two layers. A gap where a
 * label still finds no clear spot, say beside another label, grows by that label and is laid out again.
 */
export function layoutGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[], direction: GraphDirection = 'LR', nodeW = NODE_W): GraphLayout {
  const extra: number[] = [];
  for (let pass = 0; ; pass++) {
    const { layout, crowded } = layoutPass(nodes, edges, direction, nodeW, extra);
    if (!crowded.size || pass === 3) return layout;
    for (const [gap, grow] of crowded) extra[gap] = (extra[gap] ?? 0) + grow;
  }
}

/** One layout with each gap `extra[l]` larger; `crowded` maps a gap to how much a label there lacks room for. */
function layoutPass(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  direction: GraphDirection,
  nodeW: number,
  extra: readonly number[],
): { layout: GraphLayout; crowded: Map<number, number> } {
  const diamond = decisionHeight(nodes, nodeW);
  const heightOf = (n: GraphNode) => shapeHeight(shapeOf(n), diamond);
  const cellH = Math.max(...nodes.map(heightOf));
  const axes = axesFor(direction, nodeW, cellH);
  const { V, vGap, xy } = axes;
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const back = backEdges(nodes, valid);
  const dag = valid.filter((e) => !back.has(e));
  const layerOf = assignLayers(nodes, dag);
  const layer = (id: string) => layerOf.get(id)!;

  const layerCount = Math.max(1, ...nodes.map((n) => layer(n.id) + 1));
  const columns: GraphNode[][] = Array.from({ length: layerCount }, () => []);
  for (const n of nodes) columns[layer(n.id)]!.push(n);
  orderLayers(columns, dag);
  const bands = bandsOf(nodes, columns);
  /** Each layer's extent along u, and how far a node sits inside its cell. */
  const uSizes = columns.map((col) => (direction === 'LR' ? nodeW : Math.max(TERMINAL_H, ...col.map(heightOf))));
  const insets = (n: GraphNode, l: number) => (direction === 'LR' ? { iu: 0, iv: (V - heightOf(n)) / 2 } : { iu: (uSizes[l]! - heightOf(n)) / 2, iv: 0 });
  const bandOf = (n: GraphNode) => bands.find((b) => b.name === (n.group ?? null) && b.first <= layer(n.id) && layer(n.id) <= b.last)!;
  for (const col of columns) col.sort((a, b) => bandOf(a).track - bandOf(b).track);

  // The group name sits above its nodes: along v left to right, along u top to bottom.
  const headV = direction === 'LR' ? GROUP_HEAD : 0;
  const headU = direction === 'TB' ? GROUP_HEAD : 0;
  const hasBackward = valid.some((e) => back.has(e) || layer(e.to) < layer(e.from));
  const top = PAD + (hasBackward ? LOOP_LIFT : 0);
  const extent = (count: number) => count * V + (count - 1) * vGap;
  const trackCount = Math.max(...bands.map((b) => b.track)) + 1;
  let cursor = top;
  for (let t = 0; t < trackCount; t++) {
    const members = bands.filter((b) => b.track === t);
    const named = members.some((b) => b.name !== null);
    const size = Math.max(...members.map((b) => b.size));
    if (named) cursor += headV + GROUP_PAD;
    for (const band of members) band.v0 = cursor + (extent(size) - extent(band.size)) / 2;
    cursor += extent(size) + (named ? GROUP_PAD : 0) + (t < trackCount - 1 ? BAND_GAP : 0);
  }

  const named = bands.filter((b) => b.name !== null);
  /** Along u, what group boxes take after layer `l` ends and before it starts. */
  const closing = (l: number) => (named.some((b) => b.last === l) ? GROUP_PAD : 0);
  const opening = (l: number) => (named.some((b) => b.first === l) ? GROUP_PAD + headU : 0);
  const sizes = new Map(valid.flatMap((e) => (e.label ? [[e, labelSize(e.label, axes.labelChars, `edges[${edges.indexOf(e)}].label`)] as const] : [])));
  const gaps = Array.from({ length: layerCount - 1 }, (_, l) => {
    const between = valid.filter((e) => sizes.has(e) && Math.min(layer(e.from), layer(e.to)) === l && Math.abs(layer(e.to) - layer(e.from)) === 1);
    const label = Math.max(0, ...between.map((e) => axes.labelU(sizes.get(e)!)));
    const floor = closing(l) || opening(l + 1) ? Math.max(axes.uGap, BORDERED_GAP) : axes.uGap;
    return Math.max(floor, closing(l) + (label ? label + 2 * LABEL_CLEAR : 0) + Math.max(opening(l + 1), ARROW_CLEAR)) + (extra[l] ?? 0);
  });
  const uStart = [axes.uPad + opening(0)];
  gaps.forEach((gap, l) => uStart.push(uStart[l]! + uSizes[l]! + gap));
  const uOf = (l: number) => uStart[l]!;
  /** Midway between whatever closes the gap after layer `l` and whatever opens the next layer. */
  const labelU = (l: number) => (uOf(l) + uSizes[l]! + closing(l) + uOf(l + 1) - opening(l + 1)) / 2;

  const placed = new Map<string, Placed>();
  columns.forEach((col, l) => {
    bands.forEach((band) => {
      const members = col.filter((n) => bandOf(n) === band);
      members.forEach((node, i) => {
        placed.set(node.id, { node, layer: l, u: uOf(l), uSize: uSizes[l]!, v: band.v0 + (extent(band.size) - extent(members.length)) / 2 + i * (V + vGap), ...insets(node, l) });
      });
    });
  });
  const all = [...placed.values()];

  // Lanes are a label's extent apart, so stacked lanes' labels never touch, and the graph grows along v to hold the outermost.
  const ends = valid.map((e): [Placed, Placed] => [placed.get(e.from)!, placed.get(e.to)!]);
  const skipping = valid.flatMap((e, i) => (ends[i]![1].layer > ends[i]![0].layer + 1 && sizes.has(e) ? [axes.labelV(sizes.get(e)!)] : []));
  const isLane = (v: number | null): v is number => v !== null;
  const raw = skipLanes(axes, ends, all, Math.max(vGap / 2, ...skipping) + 2 * LABEL_CLEAR);
  const shift = Math.max(0, LANE_EDGE - Math.min(...raw.filter(isLane)));
  const lanes = raw.map((v) => (v === null ? null : v + shift));
  const laneVs = lanes.filter(isLane);
  for (const p of all) p.v += shift;
  for (const band of bands) band.v0 += shift;
  cursor += shift;

  const groups = named.map((band): PlacedGroup => {
    const { first, last } = band;
    const a = xy(uOf(first) - GROUP_PAD - headU, band.v0 - GROUP_PAD - headV);
    const b = xy(uOf(last) + uSizes[last]! + GROUP_PAD, band.v0 + extent(band.size) + GROUP_PAD);
    const incoming = valid.filter((e) => placed.get(e.to)!.node.group === band.name && layer(e.to) === first && placed.get(e.from)!.node.group !== band.name);
    const from = incoming.map((e) => placed.get(e.from)!.v + V / 2);
    const enterBefore = from.length > 0 && from.reduce((sum, v) => sum + v, 0) / from.length < band.v0 + extent(band.size) / 2;
    const box = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
    const label = fitText(band.name!, sized(SLOTS.groupName, groupNameMax(box, direction)), `nodes[${nodes.findIndex((n) => n.group === band.name)}].group`);
    return { name: band.name!, ...box, layer: first, nameAt: direction === 'TB' && enterBefore ? 'right' : 'left', label };
  });

  /** A node's shape in layout units. */
  const shapeBox = (p: Placed) => {
    const size = xy(p.uSize - 2 * p.iu, V - 2 * p.iv);
    return { ...xy(p.u + p.iu, p.v + p.iv), width: size.x, height: size.y };
  };
  const obstacles: Rect[] = [
    ...all.map((p) => grow(shapeBox(p), 6)),
    ...groups.flatMap(groupObstacles),
  ];
  const crowded = new Map<number, number>();
  const curves = valid.map((_, i) => {
    const [a, b] = ends[i]!;
    return route(axes, gaps, a, b, all, lanes[i]!, labelU(Math.min(a.layer, b.layer)));
  });
  const others = (i: number) => curves.flatMap((c, j) => (j === i ? [] : c.points));
  // Labels with the fewest clear spots go first, so a label that could sit anywhere along its edge
  // does not take the one spot another has.
  const clearSpots = (i: number) =>
    labelSpots(curves[i]!).filter((at) => {
      const { cost, crossed } = labelCost(at, sizes.get(valid[i]!)!, obstacles, others(i));
      return cost === 0 && crossed === 0;
    }).length;
  const labelled = valid.flatMap((e, i) => (sizes.has(e) ? [{ i, spots: clearSpots(i) }] : [])).sort((a, b) => a.spots - b.spots);
  const labels = new Map<number, EdgeLabelBox>();
  for (const { i } of labelled) {
    const [e, size] = [valid[i]!, sizes.get(valid[i]!)!];
    const { cost, ...at } = placeLabel(curves[i]!, size, obstacles, others(i));
    const [la, lb] = [layer(e.from), layer(e.to)];
    if (cost > 0 && Math.abs(la - lb) === 1) crowded.set(Math.min(la, lb), Math.max(crowded.get(Math.min(la, lb)) ?? 0, axes.labelU(size) + LABEL_CLEAR));
    labels.set(i, { ...size, ...at });
    obstacles.push(grow({ x: at.x - size.width / 2, y: at.y - size.height / 2, width: size.width, height: size.height }, 4));
  }
  const routed = valid.map((e, i): RoutedEdge => ({ edge: e, index: edges.indexOf(e), d: curves[i]!.d, label: labels.get(i) ?? null, mid: curves[i]!.at(curves[i]!.t0), points: curves[i]!.points }));

  const hasSameLayer = valid.some((e) => layer(e.to) === layer(e.from));
  const uSize = uOf(layerCount - 1) + uSizes[layerCount - 1]! + closing(layerCount - 1) + axes.uPad + (hasSameLayer ? 80 : 0);
  const vSize = Math.max(cursor + PAD, Math.max(...laneVs) + LANE_EDGE);
  const size = xy(uSize, vSize);
  const layout = {
    nodes: nodes.map((n) => {
      const p = placed.get(n.id)!;
      return { node: n, layer: p.layer, ...xy(p.u, p.v), box: shapeBox(p) };
    }),
    edges: routed,
    groups,
    layerCount,
    nodeWidth: nodeW,
    diamondHeight: diamond,
    texts: nodeTexts(nodes, nodeW, diamond),
    width: size.x,
    height: size.y,
  };
  return { layout, crowded };
}

/** Scale that fits a layout into `box`, never above MAX_SCALE. */
const fitScale = (layout: GraphLayout, box: { width: number; height: number }) => Math.min(box.width / layout.width, box.height / layout.height, MAX_SCALE);

/**
 * The layout that draws largest in `box`. Shapes widen from NODE_W towards NODE_W_MAX while that draws the
 * graph larger, or lets every title take a larger font (one size shared by all cards) without drawing it
 * smaller. Top to bottom the frame is wide for the layers, so a wider diamond, which holds its question
 * on fewer lines and so is lower, draws the whole flowchart larger; left to right a wider shape never does.
 */
export function fitGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[], direction: GraphDirection, box: { width: number; height: number }): { layout: GraphLayout; scale: number } {
  const base = layoutGraph(nodes, edges, direction, NODE_W);
  const floor = fitScale(base, box);
  const boxed = nodes.flatMap((n) => (shapeOf(n) === 'card' ? [n] : shapeOf(n) === 'step' ? [{ ...n, icon: undefined }] : []));
  const lowers = (w: number) => decisionHeight(nodes, w) < decisionHeight(nodes, NODE_W);
  let best = { layout: base, scale: floor, titleFont: sharedTitleSize(boxed, NODE_W, NODE_H, 'large') };
  for (let w = NODE_W + 8; w <= NODE_W_MAX; w += 8) {
    const font = sharedTitleSize(boxed, w, NODE_H, 'large');
    if (font <= best.titleFont && !(direction === 'TB' && lowers(w))) continue;
    const layout = layoutGraph(nodes, edges, direction, w);
    const scale = fitScale(layout, box);
    if (scale < floor * 0.995) break;
    if (scale > best.scale * 1.005 || (font > best.titleFont && scale >= best.scale * 0.995)) best = { layout, scale, titleFont: Math.max(font, best.titleFont) };
  }
  return { layout: best.layout, scale: best.scale };
}

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, in layout units: a node's
 * card, an edge's label (or its middle, when it has none), a group's box. A note keeps off the cards,
 * the labels and the group names.
 */
export function graphBoxes(layout: GraphLayout): LayoutBoxes {
  // Badges sit on a card's top edge, so a mark around the card takes them in.
  const card = (p: PositionedNode): Box => {
    const lift = badgeWords(p.node).length ? BADGE_LIFT : 0;
    return { x: p.box.x, y: p.box.y - lift, width: p.box.width, height: p.box.height + lift };
  };
  const edge = (r: RoutedEdge): Box => (r.label ? around(r.label, r.label.width, r.label.height) : around(r.mid, 40, 40));
  const boxes = new Map<string, Box>([
    ...layout.nodes.map((p): [string, Box] => [`n:${p.node.id}`, card(p)]),
    ...layout.edges.map((r): [string, Box] => [`e:${r.index}`, edge(r)]),
    ...layout.groups.map((g): [string, Box] => [`g:${g.name}`, g]),
  ]);
  const obstacles = [
    ...layout.nodes.map(card),
    ...layout.edges.flatMap((r) => (r.label ? [edge(r)] : [])),
    ...layout.groups.map((g) => ({ x: g.x, y: g.y, width: g.width, height: GROUP_HEAD })),
  ];
  return { boxes, obstacles, lines: layout.edges.flatMap((r) => r.points) };
}

/** The share of the frame a table beside the graph takes, and the gap between them. */
const TABLE_SHARE = 0.4;
const TABLE_GAP = 48;

/** Where a graph scene draws: the whole content box, the graph's part of it, and the width of the table beside it (0 for none). */
export function graphAreas(scene: GraphScene): { full: { width: number; height: number }; graphBox: { width: number; height: number }; tableW: number } {
  const full = sceneBox({}, hasCallout(scene));
  const tableW = scene.table ? Math.round(full.width * TABLE_SHARE) : 0;
  return { full, graphBox: { width: full.width - (scene.table ? tableW + TABLE_GAP : 0), height: full.height }, tableW };
}
