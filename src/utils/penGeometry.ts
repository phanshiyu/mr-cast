// Geometry of pen marks: hand-drawn strokes around a target box, and a spot for the note that keeps off
// the target and everything else on screen. Pure and seeded, so a frame always draws the same marks.

import type { PenMark } from '../types';

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Points drawn as one pen stroke; `sharp` joins them with straight lines instead of a smooth curve. */
export interface Stroke {
  points: Pt[];
  sharp?: boolean;
}

/** A mark's strokes, drawn one after another, and the box they cover. */
export interface Sketch {
  strokes: Stroke[];
  bounds: Box;
}

export const right = (b: Box) => b.x + b.width;
export const bottom = (b: Box) => b.y + b.height;
export const center = (b: Box): Pt => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
export const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by });

/**
 * What a scene tells the pen about step k, in its content box (SceneShell's children): the box of each
 * item a mark can draw on, by the item keys of shared/targets.mjs. A code scene names its step's lines
 * `lines` and its token `token`.
 */
export interface MarkTargets {
  boxes: ReadonlyMap<string, Box>;
  /** Everything a note must keep off. Defaults to every box. */
  obstacles?: readonly Box[];
  /** Points along the lines between items, which a note should rather not cross. */
  lines?: readonly Pt[];
  /** Where marks and notes stay: the content box, clear of the header and the caption band. */
  area: Box;
  /** How far the boxes have yet to move to where step k settles, such as a code scene's camera catching up. */
  shift?: Pt;
}

/** A layout's item boxes in its own units, as its layout code knows them. */
export interface LayoutBoxes {
  boxes: Map<string, Box>;
  obstacles?: Box[];
  lines?: Pt[];
}

/** Where a scene draws a laid-out picture in its content box: layout point (x, y) lands at (left + x * scale, top + y * scale). */
export interface Stage {
  left: number;
  top: number;
  scale: number;
}

/** A layout of `size` centred in `area` and scaled about its centre, as the diagram scenes draw theirs. */
export const centredStage = (area: { width: number; height: number }, size: { width: number; height: number }, scale: number): Stage => ({
  left: (area.width - size.width * scale) / 2,
  top: (area.height - size.height * scale) / 2,
  scale,
});

/** A box in layout units as it lands in the content box. */
export const onStage = ({ left, top, scale }: Stage, b: Box): Box => ({ x: left + b.x * scale, y: top + b.y * scale, width: b.width * scale, height: b.height * scale });

/** A layout's boxes as they land in a content box of `size`. */
export function staged({ boxes, obstacles, lines }: LayoutBoxes, stage: Stage, size: { width: number; height: number }): MarkTargets {
  return {
    boxes: new Map([...boxes].map(([key, b]) => [key, onStage(stage, b)])),
    obstacles: obstacles?.map((b) => onStage(stage, b)),
    lines: lines?.map((p) => ({ x: stage.left + p.x * stage.scale, y: stage.top + p.y * stage.scale })),
    area: areaOf(size),
  };
}

/** A content box of this size, from its top-left corner. */
export const areaOf = (size: { width: number; height: number }): Box => ({ x: 0, y: 0, width: size.width, height: size.height });

/** A box of `width` and `height` centred on a point. */
export const around = (p: Pt, width: number, height: number): Box => ({ x: p.x - width / 2, y: p.y - height / 2, width, height });

/** The smallest box around every box given, or null for none. */
export function union(boxes: readonly (Box | null | undefined)[]): Box | null {
  const all = boxes.filter((b): b is Box => Boolean(b));
  if (!all.length) return null;
  const x = Math.min(...all.map((b) => b.x));
  const y = Math.min(...all.map((b) => b.y));
  return { x, y, width: Math.max(...all.map(right)) - x, height: Math.max(...all.map(bottom)) - y };
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const inside = (p: Pt, b: Box) => p.x > b.x && p.x < right(b) && p.y > b.y && p.y < bottom(b);
const clampTo = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** A box moved the least distance that puts it inside `area`. */
const keepInside = (b: Box, area: Box): Box => ({ ...b, x: clampTo(b.x, area.x, right(area) - b.width), y: clampTo(b.y, area.y, bottom(area) - b.height) });

/** A stable seed from any text. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Numbers in [0, 1) from a seed, the same sequence every time. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;
const jitter = (rand: Random, by: number) => (rand() - 0.5) * 2 * by;

function boundsOf(strokes: readonly Stroke[], pen: number): Box {
  const points = strokes.flatMap((s) => s.points);
  const x = Math.min(...points.map((p) => p.x));
  const y = Math.min(...points.map((p) => p.y));
  return grow({ x, y, width: Math.max(...points.map((p) => p.x)) - x, height: Math.max(...points.map((p) => p.y)) - y }, pen);
}

/** A line from `a` to `b` in `n` pieces that bows by `bow` (px, to the left of travel) and wavers by `waver`. */
function line(a: Pt, b: Pt, n: number, bow: number, waver: number, rand: Random): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const normal = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const off = bow * Math.sin(Math.PI * t) + (i > 0 && i < n ? jitter(rand, waver) : 0);
    return { x: a.x + (b.x - a.x) * t + normal.x * off, y: a.y + (b.y - a.y) * t + normal.y * off };
  });
}

/**
 * An ellipse around the target that clears its corners, drawn the way a hand rings something: starting
 * at the upper left, a little more than once round, wobbling and spiralling out so the ends overlap.
 */
function ring(t: Box, area: Box, rand: Random): Stroke {
  const c = center(t);
  const [a, b] = [t.width / 2, t.height / 2];
  const roomY = Math.max(b + 4, Math.min(c.y - area.y, bottom(area) - c.y) - 6);
  const ry = Math.min(roomY, b + clampTo(0.35 * b + 10, 12, 36));
  const clears = a / Math.sqrt(Math.max(0.2, 1 - (b / ry) ** 2));
  const roomX = Math.max(a + 4, Math.min(c.x - area.x, right(area) - c.x) - 6);
  const rx = Math.min(roomX, Math.max(a + 16, clears));
  const tilt = jitter(rand, 0.03);
  const start = -2.2 + jitter(rand, 0.25);
  const sweep = 2 * Math.PI + 0.4 + rand() * 0.3;
  const [p1, p2] = [rand() * 6.28, rand() * 6.28];
  const n = 64;
  return {
    points: Array.from({ length: n + 1 }, (_, i) => {
      const k = i / n;
      const th = start + sweep * k;
      const r = 0.97 + 0.07 * k + 0.02 * Math.sin(2 * th + p1) + 0.012 * Math.sin(3 * th + p2);
      const x = rx * r * Math.cos(th);
      const y = ry * r * Math.sin(th);
      return { x: c.x + x * Math.cos(tilt) - y * Math.sin(tilt), y: c.y + x * Math.sin(tilt) + y * Math.cos(tilt) };
    }),
  };
}

/** A rectangle around the target, each side a separate push of the pen that runs a little past its corner. */
function frame(t: Box, rand: Random): Stroke {
  const m = 10;
  const corner = (x: number, y: number): Pt => ({ x: x + jitter(rand, 3), y: y + jitter(rand, 3) });
  const [tl, tr, br, bl] = [corner(t.x - m, t.y - m), corner(right(t) + m, t.y - m), corner(right(t) + m, bottom(t) + m), corner(t.x - m, bottom(t) + m)];
  const over = 7;
  const points = [
    { x: tl.x - over, y: tl.y + 1 },
    ...line(tl, tr, 6, jitter(rand, 2), 1, rand).slice(1),
    { x: tr.x + 2, y: tr.y - 1 },
    ...line(tr, br, 4, jitter(rand, 2), 1, rand).slice(1),
    ...line(br, bl, 6, jitter(rand, 2), 1, rand).slice(1),
    ...line(bl, { x: tl.x + 1, y: tl.y - over }, 4, jitter(rand, 2), 1, rand).slice(1),
  ];
  return { points, sharp: true };
}

/** The strokes of a mark on `target`, kept inside `area` where the target leaves room. Arrows are drawn by `arrowSketch`. */
export function sketchMark(mark: Exclude<PenMark, 'arrow'>, target: Box, area: Box, seed: number, pen: number): Sketch {
  const rand = random(seed);
  const t = target;
  const strokes: Stroke[] = (() => {
    switch (mark) {
      case 'circle':
        return [ring(t, area, rand)];
      case 'box':
        return [frame(t, rand)];
      case 'underline': {
        const y = bottom(t) + 8;
        return [{ points: line({ x: t.x - 6, y: y + jitter(rand, 2) }, { x: right(t) + 8, y: y + jitter(rand, 3) }, 10, -2 - rand() * 3, 0.8, rand) }];
      }
      case 'strike': {
        const y = t.y + t.height / 2;
        return [{ points: line({ x: t.x - 8, y: y + jitter(rand, 3) }, { x: right(t) + 8, y: y + jitter(rand, 3) }, 10, jitter(rand, 3), 0.8, rand) }];
      }
      case 'cross': {
        const g = grow(t, 6);
        return [
          { points: line({ x: g.x, y: g.y }, { x: right(g), y: bottom(g) }, 10, jitter(rand, 5), 1, rand) },
          { points: line({ x: right(g), y: g.y + jitter(rand, 3) }, { x: g.x + jitter(rand, 3), y: bottom(g) }, 10, jitter(rand, 5), 1, rand) },
        ];
      }
    }
  })();
  return { strokes, bounds: boundsOf(strokes, pen) };
}

/** Where a line from `from` towards the target's centre meets the target grown by `gap`. */
function edgePoint(from: Pt, target: Box, gap: number): Pt {
  const g = grow(target, gap);
  const c = center(g);
  const [dx, dy] = [from.x - c.x, from.y - c.y];
  const s = Math.min(dx ? g.width / 2 / Math.abs(dx) : Infinity, dy ? g.height / 2 / Math.abs(dy) : Infinity, 1);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** A curved shaft from `tail` to just short of the target, then the two barbs of its head in one stroke. */
export function arrowSketch(tail: Pt, target: Box, seed: number, pen: number): Sketch {
  const rand = random(seed);
  const tip = edgePoint(tail, target, 10);
  const len = Math.hypot(tip.x - tail.x, tip.y - tail.y);
  const shaft = line(tail, tip, 16, (rand() < 0.5 ? -1 : 1) * len * (0.1 + rand() * 0.05), 0.8, rand);
  const last = shaft[shaft.length - 3]!;
  const angle = Math.atan2(tip.y - last.y, tip.x - last.x);
  const barb = (turn: number): Pt => ({ x: tip.x - 22 * Math.cos(angle + turn), y: tip.y - 22 * Math.sin(angle + turn) });
  const strokes: Stroke[] = [{ points: shaft }, { points: [barb(0.5 + jitter(rand, 0.06)), tip, barb(-0.5 + jitter(rand, 0.06))], sharp: true }];
  return { strokes, bounds: boundsOf(strokes, pen) };
}

/** What a note must keep off: the target most of all, then the mark, everything else, and the lines between. */
export interface Clutter {
  target: Box;
  mark: Box | null;
  obstacles: readonly Box[];
  lines: readonly Pt[];
}

const LINE_COST = 25;

const cost = (b: Box, { target, mark, obstacles, lines }: Clutter) => {
  const near = grow(b, 10);
  return (
    50 * overlap(b, grow(target, 4)) +
    (mark ? 8 * overlap(b, mark) : 0) +
    obstacles.reduce((sum, o) => sum + overlap(near, o), 0) +
    LINE_COST * lines.filter((p) => inside(p, near)).length
  );
};

const GAP = 12;
type Side = 'right' | 'below' | 'above' | 'left' | 'above-right' | 'below-right' | 'above-left' | 'below-left';

/** Each side a note may take beside a mark, in the order a reader looks for it. */
const SIDES: Record<Exclude<PenMark, 'arrow'>, Side[]> = {
  circle: ['above-right', 'right', 'below-right', 'above', 'below', 'left', 'above-left', 'below-left'],
  box: ['above-right', 'right', 'below-right', 'above', 'below', 'left', 'above-left', 'below-left'],
  underline: ['below', 'below-right', 'right', 'above', 'above-right', 'left', 'below-left', 'above-left'],
  strike: ['right', 'above-right', 'below-right', 'above', 'below', 'left', 'above-left', 'below-left'],
  cross: ['right', 'above-right', 'below-right', 'above', 'below', 'left', 'above-left', 'below-left'],
};

function beside(side: Side, size: { width: number; height: number }, m: Box, t: Box): Box {
  const midY = t.y + t.height / 2 - size.height / 2;
  const at = (x: number, y: number) => ({ x, y, ...size });
  switch (side) {
    case 'right':
      return at(right(m) + GAP, midY);
    case 'left':
      return at(m.x - GAP - size.width, midY);
    case 'above':
      return at(t.x + t.width / 2 - size.width / 2, m.y - GAP - size.height);
    case 'below':
      return at(t.x + t.width / 2 - size.width / 2, bottom(m) + GAP);
    case 'above-right':
      return at(right(m) - Math.min(m.width / 4, 40), m.y - size.height + 6);
    case 'below-right':
      return at(right(m) - Math.min(m.width / 4, 40), bottom(m) - 6);
    case 'above-left':
      return at(m.x - size.width + Math.min(m.width / 4, 40), m.y - size.height + 6);
    case 'below-left':
      return at(m.x - size.width + Math.min(m.width / 4, 40), bottom(m) - 6);
  }
}

/** How far a note may slide along its side to find a clear spot, as shares of its own width or height. */
const SLIDES = [0, -0.3, 0.3, -0.6, 0.6, -1, 1];

/** The least cluttered spot for a note of `size` beside a mark, inside `area`; nearer the reader's first choice on a tie. */
export function placeNote(mark: Exclude<PenMark, 'arrow'>, size: { width: number; height: number }, sketch: Sketch, clutter: Omit<Clutter, 'mark'>, area: Box): Box {
  const all = { ...clutter, mark: sketch.bounds };
  let best: { box: Box; score: number } | null = null;
  SIDES[mark].forEach((side, i) => {
    const base = beside(side, size, sketch.bounds, clutter.target);
    const across = side === 'left' || side === 'right';
    SLIDES.forEach((f, j) => {
      const box = keepInside({ ...base, x: base.x + (across ? 0 : f * size.width), y: base.y + (across ? f * (size.height + 8) : 0) }, area);
      const score = cost(box, all) + 40 * i + 30 * j;
      if (!best || score < best.score) best = { box, score };
    });
  });
  return best!.box;
}

/** Directions an arrow may come from, as unit vectors, in order of preference: from the upper right round. */
const DIRECTIONS: Pt[] = [
  [1, -1],
  [1, 0],
  [1, 1],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
].map(([x, y]) => ({ x: x! / Math.hypot(x!, y!), y: y! / Math.hypot(x!, y!) }));

/**
 * Where an arrow starts and its note sits: a free spot some way off the target, with the note on the
 * far side of the tail, chosen so neither the note nor the shaft crosses anything else on screen.
 */
export function placeArrow(size: { width: number; height: number }, given: Omit<Clutter, 'mark'>, area: Box): { tail: Pt; note: Box } {
  const { target, obstacles } = given;
  const c = center(target);
  const clutter = { ...given, mark: null };
  let best: { tail: Pt; note: Box; score: number } | null = null;
  for (const reach of [130, 200, 280]) {
    for (const d of DIRECTIONS) {
      const edge = edgePoint({ x: c.x + d.x * 1e4, y: c.y + d.y * 1e4 }, target, 10);
      const want = { x: edge.x + d.x * reach, y: edge.y + d.y * reach };
      const horizontal = Math.abs(d.x) > 0.5;
      const placed = keepInside(
        {
          x: horizontal ? (d.x > 0 ? want.x + 8 : want.x - 8 - size.width) : want.x - size.width / 2,
          y: horizontal ? want.y - size.height / 2 : d.y > 0 ? want.y + 6 : want.y - 6 - size.height,
          ...size,
        },
        area,
      );
      const near = grow(placed, 8);
      const tail = { x: clampTo(c.x, near.x, right(near)), y: clampTo(c.y, near.y, bottom(near)) };
      const tip = edgePoint(tail, target, 10);
      const shaft = Array.from({ length: 12 }, (_, i) => ({ x: tail.x + ((tip.x - tail.x) * (i + 0.5)) / 12, y: tail.y + ((tip.y - tail.y) * (i + 0.5)) / 12 }));
      const crossed = shaft.filter((p) => obstacles.some((o) => inside(p, o) && overlap(o, target) < o.width * o.height * 0.5)).length;
      const short = Math.hypot(tip.x - tail.x, tip.y - tail.y) < 70 ? 4000 : 0;
      const score = cost(placed, clutter) + 900 * crossed + short + reach;
      if (!best || score < best.score - 1) best = { tail, note: placed, score };
    }
  }
  return { tail: best!.tail, note: best!.note };
}

/** SVG path data through a stroke's points: a smooth curve through them, or straight lines when `sharp`. */
export function strokePath({ points, sharp }: Stroke): string {
  const f = (p: Pt) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  if (sharp || points.length < 3) return `M ${points.map(f).join(' L ')}`;
  let d = `M ${f(points[0]!)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [points[i - 1] ?? points[i]!, points[i]!, points[i + 1]!, points[i + 2] ?? points[i + 1]!];
    d += ` C ${f({ x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 })}, ${f({ x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 })}, ${f(p2)}`;
  }
  return d;
}

export const strokeLength = ({ points }: Stroke) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y), 0);
