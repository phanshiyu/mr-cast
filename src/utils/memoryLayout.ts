import { fitBlock, fitText, type Fit } from '../../shared/textfit.mjs';
import { isPointer, sceneStates, type SceneState } from '../../shared/state-steps.mjs';
import { memberKey, splitMemberKey } from '../../shared/targets.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { MemoryScene } from '../types';
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
/** Room under the cards for arrows that point back left, and their depth below the lowest card. */
const ARC_GAP = 34;
const ARC_ROOM = 30;

/** Whether an arrow from a row of `from` reaches `to` going right, into its header's left side. */
const ahead = (from: { x: number; w: number }, to: { x: number }) => to.x >= from.x + from.w;

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
  /** Where an arrow back to an object no further right runs, under every card. */
  arcY: number;
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
    for (const [key, v] of Object.entries(s.values)) if (key.startsWith('f:') && isPointer(v) && ownerOf(key) !== `o:${v.ref}`) out.get(ownerOf(key))!.add(`o:${v.ref}`);
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
  scene.frames.forEach((f, i) => Object.entries(f.vars).forEach(([k, v]) => note(v, `frames[${i}].vars[${JSON.stringify(k)}]`)));
  scene.objects.forEach((o, i) => Object.entries(o.fields).forEach(([k, v]) => note(v, `objects[${i}].fields[${JSON.stringify(k)}]`)));
  (scene.steps ?? []).forEach((step, k) => Object.entries(step.set ?? {}).forEach(([ref, v]) => note(v, `steps[${k}].set[${JSON.stringify(ref)}]`)));
  const values = new Map([...texts].map(([text, path]) => [text, fitText(text, sized(SLOTS.memoryValue, VALUE_MAX - 2 * VALUE_PAD), path)]));
  /** Width a row's value box needs for every value it holds in any state. */
  const valueWidth = (key: string) =>
    Math.max(REF_W, ...states.map((s) => (isPointer(s.values[key]) ? REF_W : values.get(String(s.values[key]))!.width + 2 * VALUE_PAD)));

  const card = (key: string, title: Fit, record: Record<string, unknown>, kind: 'v' | 'f', owner: string, path: string): MemoryCard => {
    const rows = Object.keys(record).map((name, i) => ({ key: memberKey(kind, owner, name), name: fitText(name, sized(SLOTS.memoryName, 260), `${path}[${JSON.stringify(name)}]`), y: HEAD_H + i * ROW_H }));
    const nameW = Math.max(0, ...rows.map((r) => r.name.width));
    const valueW = Math.max(0, ...rows.map((r) => valueWidth(r.key)));
    const w = Math.max(title.width + 2 * PAD, PAD + nameW + NAME_GAP + valueW + PAD);
    return { key, title, column: -1, x: 0, y: 0, w, h: HEAD_H + rows.length * ROW_H + (rows.length ? 10 : 0), rows, valueX: w - PAD - valueW, valueW };
  };
  const frames = scene.frames.map((f, i) => card(`fr:${f.name}`, fitText(f.name, sized(SLOTS.frameName, 420), `frames[${i}].name`), f.vars, 'v', f.name, `frames[${i}].vars`));
  const objects = scene.objects.map((o, i) => card(`o:${o.id}`, fitText(o.type ?? o.id, sized(SLOTS.objectType, 360), o.type ? `objects[${i}].type` : `objects[${i}].id`), o.fields, 'f', o.id, `objects[${i}].fields`));

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
    states.flatMap((s) => Object.entries(s.values).flatMap(([key, v]) => (isPointer(v) && `o:${v.ref}` === c.key && rowY.has(key) ? [rowY.get(key)!] : [])));
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
  const width = Math.max(framesW, x - (objects.length ? COL_GAP : 0));
  const cardsBottom = Math.max(...cards.map((c) => c.y + c.h));
  // A reference back to an object no further right runs under the cards, so the layout keeps room for it.
  const backward = states.some((s) => Object.entries(s.values).some(([key, v]) => isPointer(v) && !ahead(placed.get(ownerOf(key))!, placed.get(`o:${v.ref}`)!)));
  const arcY = cardsBottom + ARC_GAP;
  const height = backward ? arcY + ARC_ROOM : cardsBottom;
  const scale = Math.min(SCALE_MAX, box.width / width, box.height / height);
  const row = new Map(cards.flatMap((c) => c.rows.map((r) => [r.key, { card: c, row: r }] as const)));
  const panels = {
    frames: frames.length ? fitText('Frames', sized(SLOTS.panelTitle, framesW), 'frames') : null,
    objects: objects.length ? fitText('Objects', sized(SLOTS.panelTitle, 400), 'objects') : null,
    objectsX,
  };
  const fix = 'show fewer frames, objects or variables, or split the program into two scenes';
  return { cards, card: placed, row, values, panels, width, height, arcY, scale, room: fitBlock('frames', 'memory', scale >= SCALE_MIN, fix) };
}

/** A row's value box. */
export function valueBox(layout: MemoryLayout, key: string): Box {
  const { card, row } = layout.row.get(key)!;
  return { x: card.x + card.valueX, y: card.y + row.y + 7, width: card.valueW, height: ROW_H - 14 };
}

/** A cubic curve from a reference's dot to the object it points at. */
export interface Arrow {
  from: Pt;
  c1: Pt;
  c2: Pt;
  to: Pt;
}

/**
 * The arrow of each reference `state` shows, by its row key, from the dot in its value box. An arrow to an
 * object further right ends on the left of its header; one back to an object no further right runs under
 * the cards and up into the object's bottom. Arrows into one object end apart, in the order of their dots.
 */
export function arrowsOf(layout: MemoryLayout, state: SceneState): Map<string, Arrow> {
  const refs = Object.entries(state.values).flatMap(([key, v]) => (isPointer(v) && layout.row.has(key) ? [{ key, target: `o:${v.ref}` }] : []));
  const dot = (key: string): Pt => {
    const b = valueBox(layout, key);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const forward = (key: string, target: string) => ahead(layout.row.get(key)!.card, layout.card.get(target)!);
  const out = new Map<string, Arrow>();
  for (const { key, target } of refs) {
    const to = layout.card.get(target)!;
    const from = dot(key);
    const fwd = forward(key, target);
    const peers = refs.filter((r) => r.target === target && forward(r.key, r.target) === fwd).map((r) => r.key);
    const spread = (k: string) => peers.indexOf(k) - (peers.length - 1) / 2;
    if (fwd) {
      peers.sort((a, b) => dot(a).y - dot(b).y);
      const ty = to.y + HEAD_H / 2 + spread(key) * END_GAP;
      const reach = Math.max(60, (to.x - from.x) * 0.5);
      out.set(key, { from, c1: { x: from.x + reach, y: from.y }, c2: { x: to.x - reach, y: ty }, to: { x: to.x, y: ty } });
    } else {
      peers.sort((a, b) => dot(b).x - dot(a).x);
      const tx = to.x + to.w / 2 + spread(key) * 2 * END_GAP;
      const low = layout.arcY + ARC_ROOM / 2;
      out.set(key, { from, c1: { x: from.x + 160, y: low }, c2: { x: tx, y: low }, to: { x: tx, y: to.y + to.h } });
    }
  }
  return out;
}

/** A point along an arrow, `t` from 0 at its dot to 1 at its object. */
export function pointOn({ from, c1, c2, to }: Arrow, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
    y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
  };
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
  const lines = [...arrowsOf(layout, state)].flatMap(([key, arrow]) =>
    boxes.has(key) ? Array.from({ length: 9 }, (_, i) => pointOn(arrow, (i + 1) / 10)) : [],
  );
  return { boxes, obstacles: layout.cards.filter((c) => !state.hidden[c.key]).map((c) => ({ x: c.x, y: c.y, width: c.w, height: c.h })), lines };
}
