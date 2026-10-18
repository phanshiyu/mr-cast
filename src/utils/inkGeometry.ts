// Geometry of the ink a step draws, beyond the shared pen marks: ticks, braces, arrows between two things, and a spot
// for handwriting that keeps off everything the scene shows. Pure and seeded, so a frame always draws the same ink.

import { bottom, center, grow, random, right, union, type Box, type Pt, type Sketch, type Stroke } from './penGeometry';

export type InkSide = 'above' | 'below' | 'left' | 'right';
type Size = { width: number; height: number };

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** A box moved the least distance that puts it inside `area`. */
export const keepIn = (b: Box, a: Box): Box => ({
  ...b,
  x: Math.min(Math.max(b.x, a.x), right(a) - b.width),
  y: Math.min(Math.max(b.y, a.y), bottom(a) - b.height),
});

function boundsOf(strokes: readonly Stroke[], pen: number): Box {
  const points = strokes.flatMap((s) => s.points);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return grow(
    {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
    pen,
  );
}

/** Where a line from the centre of `b` towards `p` leaves `b` grown by 10px. */
export function edgeToward(b: Box, p: Pt): Pt {
  const c = center(b);
  const g = grow(b, 10);
  const [dx, dy] = [p.x - c.x, p.y - c.y];
  const s = Math.min(dx ? g.width / 2 / Math.abs(dx) : Infinity, dy ? g.height / 2 / Math.abs(dy) : Infinity, 1);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** A check mark just right of the target. */
export function tickSketch(t: Box, seed: number, pen: number): Sketch {
  const rand = random(seed);
  const h = Math.min(46, Math.max(28, t.height * 0.8));
  const x = right(t) + 14;
  const y = t.y + t.height / 2 - h / 2;
  const j = () => (rand() - 0.5) * 3;
  const points = [
    { x: x + j(), y: y + h * 0.55 + j() },
    { x: x + h * 0.3, y: y + h * 0.95 },
    { x: x + h * 0.85 + j(), y: y + j() },
  ];
  return { strokes: [{ points, sharp: true }], bounds: grow({ x, y, width: h * 0.9, height: h }, pen) };
}

const BRACE_GAP = 12;
const BRACE_DEPTH = 22;
/** How far past its target a brace's point reaches, where its note starts. */
export const BRACE_REACH = BRACE_GAP + BRACE_DEPTH + 10;

/** A curly brace along one side of `t`, its point facing away at the middle. */
export function braceSketch(t: Box, side: InkSide, seed: number, pen: number): Sketch {
  const rand = random(seed);
  const along = side === 'above' || side === 'below';
  const len = along ? t.width : t.height;
  const n = 48;
  // Half profile: curls out from the item to the shoulder, runs flat, then out to the point at the middle.
  const ease = (a: number, b: number, x: number) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  const profile = (u: number) => 0.5 * ease(0, 0.18, u) + 0.5 * ease(0.82, 1, u);
  const points: Pt[] = Array.from({ length: n + 1 }, (_, i) => {
    const v = i / n;
    const out = BRACE_GAP + BRACE_DEPTH * profile(v < 0.5 ? v * 2 : (1 - v) * 2) + (rand() - 0.5) * 1.2;
    const pos = v * len;
    switch (side) {
      case 'below':
        return { x: t.x + pos, y: bottom(t) + out };
      case 'above':
        return { x: t.x + pos, y: t.y - out };
      case 'right':
        return { x: right(t) + out, y: t.y + pos };
      case 'left':
        return { x: t.x - out, y: t.y + pos };
    }
  });
  const strokes = [{ points }];
  return { strokes, bounds: boundsOf(strokes, pen) };
}

/** A box of `size` centred beyond side `side` of `t`, `off` px away. */
function besideBox(t: Box, side: InkSide, size: Size, off: number): Box {
  const c = center(t);
  switch (side) {
    case 'below':
      return { x: c.x - size.width / 2, y: bottom(t) + off, ...size };
    case 'above':
      return { x: c.x - size.width / 2, y: t.y - off - size.height, ...size };
    case 'right':
      return { x: right(t) + off, y: c.y - size.height / 2, ...size };
    case 'left':
      return { x: t.x - off - size.width, y: c.y - size.height / 2, ...size };
  }
}

/**
 * A box of `size` on side `side` of `t`, `off` px out, and further out past what it would land on that is part of the
 * target's own column or row and wider than it, such as the foot of a bar above its chart label. Level with `t`.
 */
export function besideClear(t: Box, side: InkSide, size: Size, off: number, obstacles: readonly Box[], area: Box): Box {
  const across = side === 'left' || side === 'right';
  const box = keepIn(besideBox(t, side, size, off), area);
  const spans = (o: Box) => (across ? o.x < right(t) && right(o) > t.x : o.y < bottom(t) && bottom(o) > t.y);
  const wider = obstacles.filter((o) => overlapArea(box, o) > 0 && overlapArea(o, t) === 0 && spans(o));
  if (!wider.length) return box;
  const past = union([t, ...wider])!;
  return keepIn(
    besideBox(across ? { ...past, y: t.y, height: t.height } : { ...past, x: t.x, width: t.width }, side, size, off),
    area,
  );
}

/** The target grown to take in what hangs off it on `side` within reach, such as index labels under cells, so a brace clears them. */
export function clearOf(t: Box, side: InkSide, obstacles: readonly Box[]): Box {
  const reach = 46;
  let out = t;
  for (const o of obstacles) {
    const spans =
      side === 'above' || side === 'below' ? o.x < right(t) && right(o) > t.x : o.y < bottom(t) && bottom(o) > t.y;
    if (!spans || overlapArea(o, t) > 0.5 * o.width * o.height) continue;
    const gap =
      side === 'below'
        ? o.y - bottom(t)
        : side === 'above'
          ? t.y - bottom(o)
          : side === 'right'
            ? o.x - right(t)
            : t.x - right(o);
    if (gap >= -4 && gap < reach)
      out = union([
        out,
        side === 'above' || side === 'below'
          ? { x: t.x, y: o.y, width: t.width, height: o.height }
          : { x: o.x, y: t.y, width: o.width, height: t.height },
      ])!;
  }
  return out;
}

type TextSide = 'right' | 'below' | 'above' | 'left' | 'above-right' | 'below-right' | 'above-left' | 'below-left';
const TEXT_SIDES: TextSide[] = [
  'right',
  'above-right',
  'above',
  'below',
  'below-right',
  'left',
  'above-left',
  'below-left',
];
/** Where text may go for an ink item that names its side. */
export const SIDE_ONLY: Record<InkSide, TextSide[]> = {
  above: ['above'],
  below: ['below'],
  left: ['left'],
  right: ['right'],
};
export const UNDER_FIRST: TextSide[] = ['below', 'below-right', 'right', 'above', 'left'];

/**
 * The clearest spot for text of `size` beside `mark` (the drawn mark, or the target itself), inside `area`. An
 * obstacle costs far more than a less preferred side; `crowded` says even the best spot covers something.
 */
export function placeText(
  mark: Box,
  target: Box,
  size: Size,
  obstacles: readonly Box[],
  area: Box,
  sides: readonly TextSide[] = TEXT_SIDES,
): { box: Box; crowded: boolean } {
  const G = 12;
  const at = (side: TextSide): Box => {
    const midY = target.y + target.height / 2 - size.height / 2;
    const midX = target.x + target.width / 2 - size.width / 2;
    switch (side) {
      case 'right':
        return { x: right(mark) + G, y: midY, ...size };
      case 'left':
        return { x: mark.x - G - size.width, y: midY, ...size };
      case 'above':
        return { x: midX, y: mark.y - G - size.height, ...size };
      case 'below':
        return { x: midX, y: bottom(mark) + G, ...size };
      case 'above-right':
        return { x: right(mark) - 10, y: mark.y - size.height + 4, ...size };
      case 'below-right':
        return { x: right(mark) - 10, y: bottom(mark) - 4, ...size };
      case 'above-left':
        return { x: mark.x - size.width + 10, y: mark.y - size.height + 4, ...size };
      case 'below-left':
        return { x: mark.x - size.width + 10, y: bottom(mark) - 4, ...size };
    }
  };
  let best: { box: Box; score: number } | null = null;
  sides.forEach((side, i) => {
    const across = side === 'left' || side === 'right';
    [0, -0.35, 0.35, -0.7, 0.7, -1.1, 1.1, 1.6, -1.6].forEach((f, j) => {
      const base = at(side);
      const box = keepIn(
        { ...base, x: base.x + (across ? 0 : f * size.width), y: base.y + (across ? f * (size.height + 6) : 0) },
        area,
      );
      const near = grow(box, 8);
      const score =
        80 * overlapArea(box, grow(target, 4)) +
        40 * overlapArea(box, mark) +
        15 * obstacles.reduce((sum, o) => sum + overlapArea(near, o), 0) +
        300 * i +
        200 * j;
      if (!best || score < best.score) best = { box, score };
    });
  });
  const box = best!.box;
  return { box, crowded: obstacles.some((o) => overlapArea(box, o) > 40) || overlapArea(box, target) > 40 };
}

/** A hand-drawn arrow from `tail` to just short of `target`, bowed out by at least `minBow` px so a short hop still reads. */
function bowedArrow(tail: Pt, target: Box, seed: number, minBow: number, pen: number, share?: number): Sketch {
  const rand = random(seed);
  const tip = edgeToward(target, tail);
  const len = Math.hypot(tip.x - tail.x, tip.y - tail.y) || 1;
  const nx = -(tip.y - tail.y) / len;
  const ny = (tip.x - tail.x) / len;
  // `share` of the length, signed to bend left or right of travel; by default 0.15, bending to the right of a downward run.
  const bow =
    share === undefined
      ? Math.max(minBow, len * 0.15) * (nx >= 0 ? 1 : -1)
      : Math.sign(share) * Math.max(minBow, len * Math.abs(share));
  const ctrl = { x: (tail.x + tip.x) / 2 + nx * bow, y: (tail.y + tip.y) / 2 + ny * bow };
  return headed(tail, ctrl, tip, 20, rand, pen);
}

/** An arc from `a` to `b` that bulges `bulge` px out (right of a downward run, above a sideways one), for close neighbours. */
export function swing(a: Pt, b: Pt, bulge: number, seed: number, pen: number): Sketch {
  const down = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
  // A negative bulge swings the other way: left of a downward run, below a sideways one.
  const ctrl = down
    ? { x: (bulge >= 0 ? Math.max(a.x, b.x) : Math.min(a.x, b.x)) + bulge * 1.6, y: (a.y + b.y) / 2 }
    : { x: (a.x + b.x) / 2, y: (bulge >= 0 ? Math.min(a.y, b.y) : Math.max(a.y, b.y)) - bulge * 1.6 };
  return headed(a, ctrl, b, 24, random(seed), pen);
}

/** A quadratic shaft from `a` through `ctrl` to `b` in `n` wavering pieces, then the two barbs of its head in one stroke. */
function headed(a: Pt, ctrl: Pt, b: Pt, n: number, rand: () => number, pen: number): Sketch {
  const shaft = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const w = i > 0 && i < n ? (rand() - 0.5) * 1.5 : 0;
    return {
      x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * ctrl.x + t * t * b.x + w,
      y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * ctrl.y + t * t * b.y + w,
    };
  });
  const last = shaft[n - 2]!;
  const angle = Math.atan2(b.y - last.y, b.x - last.x);
  const barb = (turn: number): Pt => ({ x: b.x - 22 * Math.cos(angle + turn), y: b.y - 22 * Math.sin(angle + turn) });
  const strokes: Stroke[] = [{ points: shaft }, { points: [barb(0.5), b, barb(-0.5)], sharp: true }];
  return { strokes, bounds: boundsOf(strokes, pen) };
}

/** How many of `points` fall inside an obstacle. */
const hits = (points: readonly Pt[], obstacles: readonly Box[]) =>
  points.filter((p) => obstacles.some((o) => p.x > o.x && p.x < right(o) && p.y > o.y && p.y < bottom(o))).length;

/**
 * The arrow from one box to another: a swing round the outside for close neighbours; otherwise whichever bowed arrow,
 * or swing round the side of both boxes, crosses the fewest `obstacles` on its way, the shallowest on a tie.
 */
export function linkSketch(
  source: Box | null,
  tail: Pt,
  target: Box,
  obstacles: readonly Box[],
  seed: number,
  pen: number,
): Sketch {
  const tip = edgeToward(target, tail);
  const len = Math.hypot(tip.x - tail.x, tip.y - tail.y) || 1;
  const vertical =
    source !== null && Math.abs(center(source).y - center(target).y) > Math.abs(center(source).x - center(target).x);
  const round = (side: 1 | -1, bulge: number): Sketch | null => {
    if (!source) return null;
    if (vertical) {
      const x = (b: Box) => (side > 0 ? right(b) + 12 : b.x - 12);
      return swing(
        { x: x(source), y: center(source).y },
        { x: x(target), y: center(target).y },
        side * bulge,
        seed,
        pen,
      );
    }
    const y = (b: Box) => (side > 0 ? b.y - 12 : bottom(b) + 12);
    return swing({ x: center(source).x, y: y(source) }, { x: center(target).x, y: y(target) }, side * bulge, seed, pen);
  };
  if (source && len < 140) return round(1, vertical ? 70 : 60)!;
  const others = obstacles.filter(
    (o) =>
      overlapArea(o, grow(target, 2)) < o.width * o.height * 0.5 &&
      (!source || overlapArea(o, grow(source, 2)) < o.width * o.height * 0.5),
  );
  const candidates: [Sketch | null, number][] = [
    ...[0.15, -0.15, 0.3, -0.3, 0.5, -0.5, 0.75, -0.75].map((bow): [Sketch, number] => [
      bowedArrow(tail, target, seed, 34, pen, bow),
      Math.abs(bow) * 40,
    ]),
    [round(1, 70), 40],
    [round(-1, 70), 45],
  ];
  let best: { sketch: Sketch; score: number } | null = null;
  for (const [sketch, cost] of candidates) {
    if (!sketch) continue;
    const score = 100 * hits(sketch.strokes[0]!.points, others) + cost;
    if (!best || score < best.score) best = { sketch, score };
  }
  return best!.sketch;
}

/** The point of a shaft furthest from the straight line between its ends: where a note along the arrow sits. */
export function shaftBulge(sketch: Sketch): Pt {
  const pts = sketch.strokes[0]!.points;
  const [a, b] = [pts[0]!, pts[pts.length - 1]!];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const off = (p: Pt) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
  return pts.reduce((m, p) => (off(p) > off(m) ? p : m), pts[Math.floor(pts.length / 2)]!);
}

/**
 * A spot for text level with `mark`, just past the last thing on its row, as a comment at the end of a line of code:
 * read as the mark's without an arrow. Null when the row runs to the edge or the spot covers something.
 */
export function rowEnd(mark: Box, size: Size, obstacles: readonly Box[], area: Box): Box | null {
  const y = mark.y + mark.height / 2 - size.height / 2;
  const band = { x: area.x, y, width: area.width, height: size.height };
  const end = Math.max(
    right(mark),
    ...obstacles.filter((o) => overlapArea(o, band) > 0 && o.x < right(mark) + 400).map(right),
  );
  const box = { x: end + 24, y, ...size };
  if (right(box) > right(area) || obstacles.some((o) => overlapArea(box, o) > 0)) return null;
  return box;
}

/** Text put where `placeText` found no clear spot: off in the nearest free space, with a leader arrow back to the mark. */
export function leader(
  mark: Box,
  size: Size,
  obstacles: readonly Box[],
  area: Box,
  seed: number,
  pen: number,
): { box: Box; strokes: Stroke[] } {
  const c = center(mark);
  let best: { box: Box; tail: Pt; score: number } | null = null;
  for (const reach of [90, 150, 220, 300, 400, 520]) {
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * 2 * Math.PI - Math.PI / 4;
      const d = { x: Math.cos(th), y: Math.sin(th) };
      const edge = edgeToward(mark, { x: c.x + d.x * 1e4, y: c.y + d.y * 1e4 });
      const want = { x: edge.x + d.x * reach, y: edge.y + d.y * reach };
      const box = keepIn({ x: d.x >= 0 ? want.x : want.x - size.width, y: want.y - size.height / 2, ...size }, area);
      const tail = {
        x: Math.min(Math.max(c.x, box.x - 6), right(box) + 6),
        y: Math.min(Math.max(c.y, box.y - 6), bottom(box) + 6),
      };
      const tip = edgeToward(mark, tail);
      const crossed = Array.from({ length: 10 }, (_, i) => ({
        x: tail.x + ((tip.x - tail.x) * (i + 0.5)) / 10,
        y: tail.y + ((tip.y - tail.y) * (i + 0.5)) / 10,
      })).filter((p) => obstacles.some((o) => p.x > o.x && p.x < right(o) && p.y > o.y && p.y < bottom(o))).length;
      const score =
        30 * obstacles.reduce((sum, o) => sum + overlapArea(grow(box, 8), o), 0) +
        30 * overlapArea(box, grow(mark, 6)) +
        2500 * crossed +
        4 * reach;
      if (!best || score < best.score) best = { box, tail, score };
    }
  }
  return { box: best!.box, strokes: bowedArrow(best!.tail, mark, seed, 12, pen).strokes };
}
