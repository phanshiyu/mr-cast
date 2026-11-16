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
interface Stroke {
  points: Pt[];
  sharp?: boolean;
}

/** A mark's strokes, drawn one after another, and the box they cover. */
interface Sketch {
  strokes: Stroke[];
  bounds: Box;
}

const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;
const center = (b: Box): Pt => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const grow = (b: Box, by: number): Box => ({
  x: b.x - by,
  y: b.y - by,
  width: b.width + 2 * by,
  height: b.height + 2 * by,
});

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
  /** The box of an item key that `boxes` does not list, such as a code line or text on it. */
  boxOf?: (key: string) => Box | null;
  /** Where ink shows, when content scrolls out of part of the area, such as a code scene's viewport. */
  clip?: Box;
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
export const centredStage = (
  area: { width: number; height: number },
  size: { width: number; height: number },
  scale: number,
): Stage => ({
  left: (area.width - size.width * scale) / 2,
  top: (area.height - size.height * scale) / 2,
  scale,
});

/** A box in layout units as it lands in the content box. */
const onStage = ({ left, top, scale }: Stage, b: Box): Box => ({
  x: left + b.x * scale,
  y: top + b.y * scale,
  width: b.width * scale,
  height: b.height * scale,
});

/** A layout's boxes as they land in a content box of `size`. */
export function staged(
  { boxes, obstacles, lines }: LayoutBoxes,
  stage: Stage,
  size: { width: number; height: number },
): MarkTargets {
  return {
    boxes: new Map([...boxes].map(([key, b]) => [key, onStage(stage, b)])),
    obstacles: obstacles?.map((b) => onStage(stage, b)),
    lines: lines?.map((p) => ({ x: stage.left + p.x * stage.scale, y: stage.top + p.y * stage.scale })),
    area: areaOf(size),
  };
}

/** A content box of this size, from its top-left corner. */
export const areaOf = (size: { width: number; height: number }): Box => ({
  x: 0,
  y: 0,
  width: size.width,
  height: size.height,
});

/** A box of `width` and `height` centred on a point. */
export const around = (p: Pt, width: number, height: number): Box => ({
  x: p.x - width / 2,
  y: p.y - height / 2,
  width,
  height,
});

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

const clampTo = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Numbers in [0, 1) from a seed, the same sequence every time. */
function random(seed: number): () => number {
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
  return grow(
    { x, y, width: Math.max(...points.map((p) => p.x)) - x, height: Math.max(...points.map((p) => p.y)) - y },
    pen,
  );
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

/** How far a ring may reach past the gap to an item beside its target, into that item's padding, so its wobble stays short of the text. */
const NEIGHBOUR_REACH = 4;
/** The least room a ring leaves beside its target, so the pen never crosses it. */
const RING_CLEAR = 10;
/** The smallest share of its size the ring's wobble draws it at. */
const WOBBLE_LOW = 0.94;

/** The gaps between the target and the nearest boxes level with it on its left and its right. */
function sideGaps(t: Box, obstacles: readonly Box[]): number {
  const level = obstacles.filter((o) => overlap(o, t) === 0 && o.y < bottom(t) && bottom(o) > t.y);
  const left = level.filter((o) => right(o) <= t.x).map((o) => t.x - right(o));
  const rightGaps = level.filter((o) => o.x >= right(t)).map((o) => o.x - right(t));
  return Math.min(Infinity, ...left, ...rightGaps);
}

/**
 * A ring around the target that clears its corners, drawn the way a hand rings something: starting at
 * the upper left, a little more than once round, wobbling and spiralling out so the ends overlap. It is
 * an ellipse where there is room; where items stand close beside the target, as cells in a row, it stays
 * in the gap between them and squares its shoulders (a superellipse) to still clear the corners.
 */
function ring(t: Box, area: Box, obstacles: readonly Box[], rand: Random): Stroke {
  const c = center(t);
  const [a, b] = [t.width / 2, t.height / 2];
  const roomY = Math.max(b + 4, Math.min(c.y - area.y, bottom(area) - c.y) - 6);
  const ry = Math.min(roomY, b + clampTo(0.35 * b + 10, 12, 36));
  const clears = a / Math.sqrt(Math.max(0.2, 1 - (b / ry) ** 2));
  const roomX = Math.max(a + 4, Math.min(c.x - area.x, right(area) - c.x) - 6);
  const free = Math.min(roomX, Math.max(a + 16, clears));
  const rx = Math.max(a + RING_CLEAR, Math.min(free, a + sideGaps(t, obstacles) + NEIGHBOUR_REACH));
  // The roundest shape that clears the corners, |x/rx|^n + |y/ry|^n <= 1. Hemmed in, it passes close to
  // them, so it clears them even where the wobble draws it smallest.
  const low = rx < free ? WOBBLE_LOW : 1;
  const [cx, cy] = [a / (low * rx), b / (low * ry)];
  let n = 2;
  while (n < 8 && cx ** n + cy ** n > 1 + 1e-9) n += 0.1;
  const tilt = jitter(rand, 0.03);
  const start = -2.2 + jitter(rand, 0.25);
  const sweep = 2 * Math.PI + 0.4 + rand() * 0.3;
  const [p1, p2] = [rand() * 6.28, rand() * 6.28];
  const steps = 64;
  const bend = (v: number) => Math.sign(v) * Math.abs(v) ** (2 / n);
  return {
    points: Array.from({ length: steps + 1 }, (_, i) => {
      const k = i / steps;
      const th = start + sweep * k;
      const r = 0.97 + 0.07 * k + 0.02 * Math.sin(2 * th + p1) + 0.012 * Math.sin(3 * th + p2);
      const x = rx * r * bend(Math.cos(th));
      const y = ry * r * bend(Math.sin(th));
      return { x: c.x + x * Math.cos(tilt) - y * Math.sin(tilt), y: c.y + x * Math.sin(tilt) + y * Math.cos(tilt) };
    }),
  };
}

/** A rectangle around the target, each side a separate push of the pen that runs a little past its corner. */
function frame(t: Box, rand: Random): Stroke {
  const m = 10;
  const corner = (x: number, y: number): Pt => ({ x: x + jitter(rand, 3), y: y + jitter(rand, 3) });
  const [tl, tr, br, bl] = [
    corner(t.x - m, t.y - m),
    corner(right(t) + m, t.y - m),
    corner(right(t) + m, bottom(t) + m),
    corner(t.x - m, bottom(t) + m),
  ];
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

/**
 * The strokes of a mark on `target`, kept inside `area` where the target leaves room, and a ring off the
 * `obstacles` beside it. Arrows are drawn by `arrowSketch`.
 */
export function sketchMark(
  mark: Exclude<PenMark, 'arrow'>,
  target: Box,
  area: Box,
  obstacles: readonly Box[],
  seed: number,
  pen: number,
): Sketch {
  const rand = random(seed);
  const t = target;
  const strokes: Stroke[] = (() => {
    switch (mark) {
      case 'circle':
        return [ring(t, area, obstacles, rand)];
      case 'box':
        return [frame(t, rand)];
      case 'underline': {
        const y = bottom(t) + 8;
        return [
          {
            points: line(
              { x: t.x - 6, y: y + jitter(rand, 2) },
              { x: right(t) + 8, y: y + jitter(rand, 3) },
              10,
              -2 - rand() * 3,
              0.8,
              rand,
            ),
          },
        ];
      }
      case 'strike': {
        const y = t.y + t.height / 2;
        return [
          {
            points: line(
              { x: t.x - 8, y: y + jitter(rand, 3) },
              { x: right(t) + 8, y: y + jitter(rand, 3) },
              10,
              jitter(rand, 3),
              0.8,
              rand,
            ),
          },
        ];
      }
      case 'cross': {
        const g = grow(t, 6);
        return [
          { points: line({ x: g.x, y: g.y }, { x: right(g), y: bottom(g) }, 10, jitter(rand, 5), 1, rand) },
          {
            points: line(
              { x: right(g), y: g.y + jitter(rand, 3) },
              { x: g.x + jitter(rand, 3), y: bottom(g) },
              10,
              jitter(rand, 5),
              1,
              rand,
            ),
          },
        ];
      }
    }
  })();
  return { strokes, bounds: boundsOf(strokes, pen) };
}
