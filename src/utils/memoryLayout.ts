import { fitBlock, fitText, type Fit } from '../../shared/textfit.mjs';
import { isPointer, sceneStates, type SceneState } from '../../shared/state-steps.mjs';
import { memberKey, splitMemberKey } from '../../shared/targets.mjs';
import { memoryMembers } from '../../shared/storyboard-json.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { MemoryMembers, MemoryScene } from '../types';
import type { Box, LayoutBoxes, Pt } from './penGeometry';

export const ROW_H = 48;
export const HEAD_H = 50;
const PAD = 18;
const NAME_GAP = 20;
const CARD_GAP = 24;
export const PANEL_H = 46;
/** Room between the frames and the first column of objects, and between columns, where the arrows run. */
const MAIN_GAP = 190;
const COL_GAP = 150;
const COLUMNS_MAX = 3;
const VALUE_PAD = 14;
/** A value box that holds a reference holds only its dot. */
const REF_W = 58;
const VALUE_MAX = 320;
/** Below this scale the text reads smaller than the slots allow, so `validate` reports the scene. */
const SCALE_MIN = 0.72;
/** A small program draws up to this much larger, so it fills the frame. */
const SCALE_MAX = 1.3;
/** Gap between the ends of arrows that share an object. */
const END_GAP = 10;
/** How far below the lowest card the first lane runs, and the room under the last one. */
const LANE_GAP = 34;
const LANE_ROOM = 16;
/** Distance between routed arrows running side by side, along a lane or down a gap, and the first one's from its card. */
const ROUTE_STEP = 12;
const ROUTE_GAP = 18;
/** Places on each side of a gap: routes leave a column on the gap's left half and enter one on its right half. */
const ROUTES_PER_GAP = 5;
const CORNER = 14;
/** Cubic segments in every arrow, so an arrow that re-routes can blend between any two shapes. */
const SEGMENTS = 9;

export interface MemoryRow {
  /** Its state key, from `memberKey`: "v:frame/var" or "f:object/field". */
  key: string;
  name: Fit;
  /** Top, relative to its card. */
  y: number;
}

export interface MemoryCard {
  /** "fr:name" for a frame, "o:id" for an object. */
  key: string;
  title: Fit;
  /** -1 for the frames, else the object's column. */
  column: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rows: MemoryRow[];
  /** Left of the value boxes, relative to the card, and their width. */
  valueX: number;
  valueW: number;
}

export interface MemoryLayout {
  cards: MemoryCard[];
  /** Each card by its key, and each row's card and row by the row's key. */
  card: Map<string, MemoryCard>;
  row: Map<string, { card: MemoryCard; row: MemoryRow }>;
  /** Every text value any state shows, by its text. */
  values: Map<string, Fit>;
  panels: { frames: Fit | null; objects: Fit | null; objectsX: number };
  /**
   * Each reference that does not run straight into the next column, by "key>target": its place in the gaps
   * between columns, and its lane under the cards, or -1 when it keeps to its own column's gap.
   */
  routes: Map<string, { place: number; lane: number }>;
  /** The first lane's y. */
  laneY: number;
  width: number;
  height: number;
  /** The layout's size in the frame: above 1 for a small program, below 1 for one larger than the frame. */
  scale: number;
  room: Fit;
}

const ownerOf = (key: string) => splitMemberKey(key).ownerKey;

/**
 * Each object's column: 0 when no other object points at it, else one past the furthest object that does,
 * in any state, so a chain such as a linked list runs left to right. A reference that closes a cycle is
 * ignored, and columns past the last one share it.
 */
function columns(scene: MemoryScene, states: readonly SceneState[]): Map<string, number> {
  const keys = scene.objects.map((o) => `o:${o.id}`);
  const out = new Map<string, Set<string>>(keys.map((k) => [k, new Set()]));
  for (const s of states) {
    for (const [key, v] of Object.entries(s.values))
      if (key.startsWith('f:') && isPointer(v) && ownerOf(key) !== `o:${v.ref}`)
        out.get(ownerOf(key))!.add(`o:${v.ref}`);
  }
  const pointed = new Set([...out.values()].flatMap((t) => [...t]));
  const order: string[] = [];
  const state = new Map<string, 'open' | 'done'>();
  const forward = new Map<string, string[]>(keys.map((k) => [k, []]));
  const visit = (k: string) => {
    state.set(k, 'open');
    for (const t of out.get(k)!) {
      if (state.get(t) === 'open') continue;
      forward.get(k)!.push(t);
      if (!state.has(t)) visit(t);
    }
    state.set(k, 'done');
    order.unshift(k);
  };
  for (const k of [...keys.filter((k) => !pointed.has(k)), ...keys]) if (!state.has(k)) visit(k);
  const column = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const k of order) for (const t of forward.get(k)!) column.set(t, Math.max(column.get(t)!, column.get(k)! + 1));
  return new Map([...column].map(([k, c]) => [k, Math.min(COLUMNS_MAX - 1, c)]));
}

export function layoutMemory(scene: MemoryScene, box: { width: number; height: number }): MemoryLayout {
  const states = sceneStates(scene);
  // Every text a value box ever holds, with the storyboard path it first comes from.
  const texts = new Map<string, string>();
  const note = (value: unknown, path: string) => {
    if (!isPointer(value) && !texts.has(String(value))) texts.set(String(value), path);
  };
  scene.frames.forEach((f, i) =>
    memoryMembers(f.vars).forEach(([k, v]) => note(v, `frames[${i}].vars[${JSON.stringify(k)}]`)),
  );
  scene.objects.forEach((o, i) =>
    memoryMembers(o.fields).forEach(([k, v]) => note(v, `objects[${i}].fields[${JSON.stringify(k)}]`)),
  );
  (scene.steps ?? []).forEach((step, k) =>
    Object.entries(step.set ?? {}).forEach(([ref, v]) => note(v, `steps[${k}].set[${JSON.stringify(ref)}]`)),
  );
  const values = new Map(
    [...texts].map(([text, path]) => [text, fitText(text, sized(SLOTS.memoryValue, VALUE_MAX - 2 * VALUE_PAD), path)]),
  );
  /** Width a row's value box needs for every value it holds in any state. */
  const valueWidth = (key: string) =>
    Math.max(
      REF_W,
      ...states.map((s) =>
        isPointer(s.values[key]) ? REF_W : values.get(String(s.values[key]))!.width + 2 * VALUE_PAD,
      ),
    );

  const card = (
    key: string,
    title: Fit,
    members: MemoryMembers,
    kind: 'v' | 'f',
    owner: string,
    path: string,
  ): MemoryCard => {
    const rows = memoryMembers(members).map(([name], i) => ({
      key: memberKey(kind, owner, name),
      name: fitText(name, sized(SLOTS.memoryName, 260), `${path}[${JSON.stringify(name)}]`),
      y: HEAD_H + i * ROW_H,
    }));
    const nameW = Math.max(0, ...rows.map((r) => r.name.width));
    const valueW = Math.max(0, ...rows.map((r) => valueWidth(r.key)));
    const w = Math.max(title.width + 2 * PAD, PAD + nameW + NAME_GAP + valueW + PAD);
    return {
      key,
      title,
      column: -1,
      x: 0,
      y: 0,
      w,
      h: HEAD_H + rows.length * ROW_H + (rows.length ? 10 : 0),
      rows,
      valueX: w - PAD - valueW,
      valueW,
    };
  };
  const frames = scene.frames.map((f, i) =>
    card(
      `fr:${f.name}`,
      fitText(f.name, sized(SLOTS.frameName, 420), `frames[${i}].name`),
      f.vars,
      'v',
      f.name,
      `frames[${i}].vars`,
    ),
  );
  const objects = scene.objects.map((o, i) =>
    card(
      `o:${o.id}`,
      fitText(o.type ?? o.id, sized(SLOTS.objectType, 360), o.type ? `objects[${i}].type` : `objects[${i}].id`),
      o.fields,
      'f',
      o.id,
      `objects[${i}].fields`,
    ),
  );

  // Frames stack down the left, all one width, outermost call first.
  const framesW = Math.max(0, ...frames.map((c) => c.w));
  let y = PANEL_H;
  for (const c of frames) {
    const grow = framesW - c.w;
    Object.assign(c, { x: 0, y, w: framesW, valueX: c.valueX + grow });
    y += c.h + CARD_GAP;
  }
  // Objects go in columns by the objects that point at them, each column ordered by where its arrows come from.
  const column = columns(scene, states);
  const columnOf = (c: MemoryCard) => column.get(c.key)!;
  const placed = new Map<string, MemoryCard>(frames.map((c) => [c.key, c]));
  const rowY = new Map<string, number>();
  const sources = (c: MemoryCard) =>
    states.flatMap((s) =>
      Object.entries(s.values).flatMap(([key, v]) =>
        isPointer(v) && `o:${v.ref}` === c.key && rowY.has(key) ? [rowY.get(key)!] : [],
      ),
    );
  const markRows = (c: MemoryCard) => c.rows.forEach((r) => rowY.set(r.key, c.y + r.y + ROW_H / 2));
  frames.forEach(markRows);
  const objectsX = framesW + (frames.length ? MAIN_GAP : 0);
  let x = objectsX;
  for (let col = 0; col < COLUMNS_MAX; col++) {
    const here = objects.filter((c) => columnOf(c) === col);
    if (!here.length) continue;
    const mean = (c: MemoryCard) => {
      const ys = sources(c);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity;
    };
    const order = here.map((c, i) => ({ c, i, at: mean(c) })).sort((a, b) => a.at - b.at || a.i - b.i);
    const w = Math.max(...here.map((c) => c.w));
    let top = PANEL_H;
    for (const { c } of order) {
      Object.assign(c, { column: col, x, y: top, valueX: c.valueX + (w - c.w), w });
      top += c.h + CARD_GAP;
      placed.set(c.key, c);
      markRows(c);
    }
    x += w + COL_GAP;
  }
  const cards = [...frames, ...objects];
  const cardsBottom = Math.max(...cards.map((c) => c.y + c.h));
  // Every reference any state shows that does not run straight into the next column gets a place of its own,
  // shortest first, so routes along the lanes nest instead of crossing.
  const found = new Map<string, { key: string; target: string; kind: RouteKind }>();
  for (const s of states) {
    for (const [key, v] of Object.entries(s.values)) {
      if (!isPointer(v)) continue;
      const target = `o:${v.ref}`;
      const kind = routeKind(placed.get(ownerOf(key))!, placed.get(target)!);
      if (kind !== 'next') found.set(`${key}>${target}`, { key, target, kind });
    }
  }
  const span = (r: { key: string; target: string }) =>
    Math.abs(placed.get(ownerOf(r.key))!.x - placed.get(r.target)!.x);
  const routed = [...found].sort(([, a], [, b]) => span(a) - span(b));
  let lanes = 0;
  const routes = new Map(routed.map(([pair, r], place) => [pair, { place, lane: r.kind === 'same' ? -1 : lanes++ }]));
  const laneY = cardsBottom + LANE_GAP;
  const height = lanes ? laneY + (lanes - 1) * ROUTE_STEP + LANE_ROOM : cardsBottom;
  // A route out of the last column runs down the room to its right.
  const rightmost = Math.max(...cards.map((c) => c.x + c.w));
  const width = Math.max(
    framesW,
    x - (objects.length ? COL_GAP : 0),
    routed.length ? rightmost + ROUTE_GAP + Math.min(routed.length, ROUTES_PER_GAP) * ROUTE_STEP : 0,
  );
  const scale = Math.min(SCALE_MAX, box.width / width, box.height / height);
  const row = new Map(cards.flatMap((c) => c.rows.map((r) => [r.key, { card: c, row: r }] as const)));
  const panels = {
    frames: frames.length ? fitText('Frames', sized(SLOTS.panelTitle, framesW), 'frames') : null,
    objects: objects.length ? fitText('Objects', sized(SLOTS.panelTitle, 400), 'objects') : null,
    objectsX,
  };
  const fix = 'show fewer frames, objects or variables, or split the program into two scenes';
  return {
    cards,
    card: placed,
    row,
    values,
    panels,
    width,
    height,
    routes,
    laneY,
    scale,
    room: fitBlock('frames', 'memory', scale >= SCALE_MIN, fix),
  };
}

/** A row's value box. */
export function valueBox(layout: MemoryLayout, key: string): Box {
  const { card, row } = layout.row.get(key)!;
  return { x: card.x + card.valueX, y: card.y + row.y + 7, width: card.valueW, height: ROW_H - 14 };
}

/** A path from a reference's dot to the object it points at: its start, then three points per cubic segment. */
export interface Arrow {
  points: Pt[];
}

/**
 * How an arrow gets from a card to the one it points at: straight into the next column (`next`), or routed
 * through the gaps beside the columns, so it never passes behind a card: within its own column (`same`),
 * or along a lane under the cards to a column further right (`skip`) or no further right (`back`).
 */
type RouteKind = 'next' | 'same' | 'skip' | 'back';

function routeKind(from: MemoryCard, to: MemoryCard): RouteKind {
  if (to.column === from.column + 1) return 'next';
  if (to.column === from.column) return 'same';
  return to.column > from.column ? 'skip' : 'back';
}

const mix = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** Straight runs through `turns`, each corner rounded, as an arrow's points. */
function rounded(turns: Pt[]): Pt[] {
  const out = [turns[0]!];
  const line = (a: Pt, b: Pt) => out.push(mix(a, b, 1 / 3), mix(a, b, 2 / 3), b);
  let at = turns[0]!;
  for (let i = 1; i < turns.length - 1; i++) {
    const [prev, corner, next] = [turns[i - 1]!, turns[i]!, turns[i + 1]!];
    const r = Math.min(CORNER, dist(prev, corner) / 2, dist(corner, next) / 2);
    const [a, b] = [mix(corner, prev, r / (dist(prev, corner) || 1)), mix(corner, next, r / (dist(corner, next) || 1))];
    line(at, a);
    out.push(mix(a, corner, 0.55), mix(b, corner, 0.55), b);
    at = b;
  }
  line(at, turns.at(-1)!);
  return out;
}

/** `points` with still segments at its start, up to SEGMENTS. */
const padded = (points: Pt[]): Pt[] => [
  points[0]!,
  ...Array<Pt>(3 * (SEGMENTS - (points.length - 1) / 3)).fill(points[0]!),
  ...points.slice(1),
];

/**
 * The arrow of each reference `state` shows, by its row key, from the dot in its value box. An arrow into the
 * next column ends on the left of its object's header. Any other leaves its card into the gap on the right;
 * within the column it runs to the right of the object's header, and otherwise it runs along its lane under
 * the cards and up into the object: into its bottom when it is the lowest in its column and no further
 * right, else beside its header. Arrows into one side of an object end apart, in the order of their dots.
 */
export function arrowsOf(layout: MemoryLayout, state: SceneState): Map<string, Arrow> {
  const refs = Object.entries(state.values).flatMap(([key, v]) => {
    if (!isPointer(v) || !layout.row.has(key)) return [];
    const [from, to] = [layout.row.get(key)!.card, layout.card.get(`o:${v.ref}`)!];
    const kind = routeKind(from, to);
    const lowest = !layout.cards.some((c) => c !== to && c.column === to.column && c.y > to.y);
    const side = kind === 'next' || kind === 'skip' ? 'left' : kind === 'back' && lowest ? 'bottom' : 'right';
    return [{ key, from, to, kind, side, route: layout.routes.get(`${key}>${to.key}`) }];
  });
  const dot = (key: string): Pt => {
    const b = valueBox(layout, key);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const out = new Map<string, Arrow>();
  for (const { key, from, to, kind, side, route } of refs) {
    const start = dot(key);
    const peers = refs.filter((r) => r.to === to && r.side === side).map((r) => r.key);
    peers.sort(side === 'bottom' ? (a, b) => dot(b).x - dot(a).x : (a, b) => dot(a).y - dot(b).y);
    const spread = peers.indexOf(key) - (peers.length - 1) / 2;
    const ty = to.y + HEAD_H / 2 + spread * END_GAP;
    if (kind === 'next') {
      const reach = Math.max(60, (to.x - start.x) * 0.5);
      out.set(key, {
        points: padded([start, { x: start.x + reach, y: start.y }, { x: to.x - reach, y: ty }, { x: to.x, y: ty }]),
      });
      continue;
    }
    const offset = ROUTE_GAP + (route!.place % ROUTES_PER_GAP) * ROUTE_STEP;
    const gx = from.x + from.w + offset;
    const lane = layout.laneY + route!.lane * ROUTE_STEP;
    const tx = to.x + to.w / 2 + spread * 2 * END_GAP;
    const turns: Pt[] =
      kind === 'same'
        ? [start, { x: gx, y: start.y }, { x: gx, y: ty }, { x: to.x + to.w, y: ty }]
        : side === 'bottom'
          ? [start, { x: gx, y: start.y }, { x: gx, y: lane }, { x: tx, y: lane }, { x: tx, y: to.y + to.h }]
          : [start, { x: gx, y: start.y }, { x: gx, y: lane }, ...beside(to, side, offset, lane, ty)];
    out.set(key, { points: padded(rounded(turns)) });
  }
  return out;
}

/** The last turns of a lane route that ends beside an object's header, on its left or right, up the gap there. */
function beside(to: MemoryCard, side: string, offset: number, lane: number, ty: number): Pt[] {
  const [edge, x] = side === 'left' ? [to.x, to.x - offset] : [to.x + to.w, to.x + to.w + offset];
  return [
    { x, y: lane },
    { x, y: ty },
    { x: edge, y: ty },
  ];
}

/** Points along an arrow's segments that move, for keeping notes off it. */
export function arrowSamples({ points }: Arrow): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 3 < points.length; i += 3) {
    const [p0, c1, c2, p1] = [points[i]!, points[i + 1]!, points[i + 2]!, points[i + 3]!];
    if (dist(p0, p1) === 0 && dist(p0, c1) === 0) continue;
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const u = 1 - t;
      out.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
      });
    }
  }
  return out;
}

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, as `state` shows it: a frame's
 * or object's card and a variable's or field's row. A note keeps off the cards and the arrows.
 */
export function memoryBoxes(layout: MemoryLayout, state: SceneState): LayoutBoxes {
  const boxes = new Map<string, Box>();
  for (const c of layout.cards) {
    if (state.hidden[c.key]) continue;
    boxes.set(c.key, { x: c.x, y: c.y, width: c.w, height: c.h });
    for (const r of c.rows) boxes.set(r.key, { x: c.x + 6, y: c.y + r.y, width: c.w - 12, height: ROW_H });
  }
  const lines = [...arrowsOf(layout, state)].flatMap(([key, arrow]) => (boxes.has(key) ? arrowSamples(arrow) : []));
  return {
    boxes,
    obstacles: layout.cards
      .filter((c) => !state.hidden[c.key])
      .map((c) => ({ x: c.x, y: c.y, width: c.w, height: c.h })),
    lines,
  };
}
