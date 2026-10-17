import { arrayRows, cellKey, markerRow, rowKey } from '../../shared/arrays.mjs';
import { fitBlock, fitText, fitTextAt, type Fit } from '../../shared/textfit.mjs';
import { sceneStates, type SceneState } from '../../shared/state-steps.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { ArrayScene, Tone } from '../types';
import type { Box, LayoutBoxes } from './penGeometry';

const CELL_MAX_W = 200;
/** The narrowest a cell gets while the scene shrinks to fit its height. */
const CELL_MIN_W = 44;
const CELL_GAP = 10;
/** Extra room where an array is cut in two (`splits`). */
const SPLIT_GAP = 34;
/** Room a value keeps inside its cell, each side. */
const CELL_PAD = 10;
const LABEL_H = 50;
export const CHIP_H = 38;
const CHIP_GAP = 6;
export const ARROW_LEN = 30;
const INDEX_H = 34;
export const BAND_H = 36;
const BAND_GAP = 10;
/** Between one array's block and the next. */
const ROW_GAP = 30;
/** A hexagon's height for its width, point to point, and how far apart its rows sit. */
const HEX_H = 2 / Math.sqrt(3);
const HEX_PITCH = 0.75;
/** Room a range keeps inside its band around its name. */
export const BAND_PAD = 14;

/** One array as placed: its cells' row, the slots past either end, its label and its ranges' bands. */
export interface PlacedRow {
  name: string;
  /** Item key of the whole array, for show, hide and focus. */
  key: string;
  count: number;
  /** For each cell, how many splits come before it. */
  cutsBefore: number[];
  ghosts: { left: boolean; right: boolean };
  /** Left edge of its first slot, in the layout. */
  x: number;
  label: Fit | null;
  labelY: number;
  cellsY: number;
  indexY: number;
  /** The row's place in a hex grid, which sets it half a cell right on odd rows. */
  hexRow: number;
  width: number;
}

export interface ArrayLayout {
  hex: boolean;
  indexes: boolean;
  /** Width of one slot: a cell and the gap after it. */
  slotW: number;
  cellW: number;
  cellH: number;
  rows: PlacedRow[];
  /** Every cell's row, by item key. */
  cells: Map<string, { row: PlacedRow; index: number }>;
  /** Every value any state shows, fitted at one shared size, by its text. */
  values: Map<string, Fit>;
  pointers: { name: string; tone: Tone; fit: Fit; row: string }[];
  ranges: { name: string; tone: Tone; fit: Fit; y: number; row: string }[];
  width: number;
  height: number;
  room: Fit;
}

const rowOf = (layout: ArrayLayout, name: string) => layout.rows.find((r) => r.name === name)!;

/** Left edge of cell `i` of a row (-1 and `count` are the slots past either end). */
export function cellX(layout: ArrayLayout, row: PlacedRow, i: number): number {
  if (layout.hex) return row.x + i * layout.slotW + (row.hexRow % 2) * (layout.slotW / 2);
  const cuts = i < 0 ? 0 : i >= row.count ? (row.cutsBefore[row.count - 1] ?? 0) : row.cutsBefore[i]!;
  return row.x + (i + (row.ghosts.left ? 1 : 0)) * layout.slotW + cuts * SPLIT_GAP;
}

/** Top of a pointer chip stacked `lane` chips above its cell's arrow. */
export const chipY = (row: PlacedRow, lane: number) => row.cellsY - ARROW_LEN - CHIP_H - lane * (CHIP_H + CHIP_GAP);

/** Each shown pointer's lane in its cell's stack, in declaration order from the cell up. */
export function pointerLanes(scene: ArrayScene, state: SceneState): Map<string, number> {
  const taken = new Map<string, number>();
  const lanes = new Map<string, number>();
  for (const p of scene.pointers ?? []) {
    if (state.hidden[`ptr:${p.name}`]) continue;
    const at = `${markerRow(scene, p)}/${state.places[`ptr:${p.name}`]![0]}`;
    lanes.set(p.name, taken.get(at) ?? 0);
    taken.set(at, (taken.get(at) ?? 0) + 1);
  }
  return lanes;
}

const POINTER_TONES: Tone[] = ['accent', 'warn', 'good', 'bad'];

/** For each cell, how many of the array's splits come at or before it. */
const cutsOf = (count: number, splits: readonly number[]) => Array.from({ length: count }, (_, i) => splits.filter((s) => s <= i).length);

export function layoutArray(scene: ArrayScene, box: { width: number; height: number }): ArrayLayout {
  const states = sceneStates(scene);
  const hex = scene.cells === 'hex';
  const indexes = !hex && scene.indexes !== false;
  const multi = Array.isArray(scene.arrays);
  const source = arrayRows(scene);
  const pointersOn = (name: string) => (scene.pointers ?? []).filter((p) => markerRow(scene, p) === name);
  const rangesOn = (name: string) => (scene.ranges ?? []).filter((r) => markerRow(scene, r) === name);
  const shape = source.map((a, k) => {
    const places = states.flatMap((s) => pointersOn(a.name).map((p) => s.places[`ptr:${p.name}`]![0]));
    const ghosts = { left: places.includes(-1), right: places.includes(a.values.length) };
    const cuts = cutsOf(a.values.length, a.splits);
    const slots = a.values.length + Number(ghosts.left) + Number(ghosts.right);
    const stack = Math.max(0, ...states.map((s) => {
      const lanes = pointerLanes(scene, s);
      return Math.max(0, ...pointersOn(a.name).flatMap((p) => (lanes.has(p.name) ? [lanes.get(p.name)! + 1] : [])));
    }));
    const label = hex ? undefined : multi ? a.label : scene.label;
    return { a, k, ghosts, cuts, slots, stack, label };
  });
  const widest = Math.max(...shape.map((r) => (hex ? r.a.values.length + 0.5 : r.slots)));
  const cutRoom = Math.max(...shape.map((r) => (r.cuts.at(-1) ?? 0) * SPLIT_GAP));

  const place = (slotW: number) => {
    const cellW = slotW - (hex ? 6 : CELL_GAP);
    const cellH = hex ? Math.round(slotW * HEX_H) - 6 : Math.max(Math.min(76, Math.round(cellW * 0.9)), Math.min(124, Math.round(cellW * 0.72)));
    let y = 0;
    const rows: PlacedRow[] = shape.map((r, n) => {
      const label = r.label ? fitText(r.label, sized(SLOTS.arrayLabel, box.width), multi ? `arrays[${r.k}].label` : 'label') : null;
      const top = hex ? n * Math.round(slotW * HEX_H * HEX_PITCH) : y;
      const cellsY = top + (label ? LABEL_H : 0) + (r.stack ? r.stack * (CHIP_H + CHIP_GAP) - CHIP_GAP + ARROW_LEN : 0) + (hex ? 0 : 8);
      const indexY = cellsY + cellH + 8;
      const below = (indexes ? indexY + INDEX_H : cellsY + cellH) + rangesOn(r.a.name).length * (BAND_H + BAND_GAP);
      if (!hex) y = below + ROW_GAP;
      const width = hex ? (r.a.values.length + (n % 2) * 0.5) * slotW : r.slots * slotW - CELL_GAP + (r.cuts.at(-1) ?? 0) * SPLIT_GAP;
      return { name: r.a.name, key: rowKey(r.a.name), count: r.a.values.length, cutsBefore: r.cuts, ghosts: r.ghosts, x: 0, label, labelY: top, cellsY, indexY, hexRow: n, width };
    });
    const height = hex ? (rows.at(-1)?.cellsY ?? 0) + cellH : y - ROW_GAP;
    return { cellW, cellH, rows, height };
  };
  let slotW = Math.min(CELL_MAX_W, Math.floor((box.width - cutRoom) / widest));
  let placed = place(slotW);
  while (placed.height > box.height && slotW > CELL_MIN_W) placed = place(--slotW);
  const { cellW, cellH, rows, height } = placed;
  const width = hex ? Math.max(...rows.map((r) => r.width)) : Math.max(...rows.map((r) => r.width));
  // Arrays are centred one by one; a hex grid's rows keep one left edge, so they interlock.
  for (const row of rows) row.x = hex ? 0 : Math.round((width - row.width) / 2);
  const cells = new Map(rows.flatMap((row) => Array.from({ length: row.count }, (_, i) => [cellKey(row.name, i), { row, index: i }] as const)));

  // One size for every value the scene ever shows, so a value that changes keeps its size.
  const texts = new Map<string, string>();
  source.forEach((a, k) => a.values.forEach((v, i) => texts.has(String(v)) || texts.set(String(v), multi ? `arrays[${k}].values[${i}]` : `values[${i}]`)));
  (scene.steps ?? []).forEach((step, k) => Object.entries(step.set ?? {}).forEach(([ref, v]) => texts.has(String(v)) || texts.set(String(v), `steps[${k}].set[${JSON.stringify(ref)}]`)));
  const { size: max, min, lineHeight } = SLOTS.arrayValue;
  const valueW = hex ? cellW * 0.7 : cellW - 2 * CELL_PAD;
  const fitAll = (size: number) => {
    const lines = Math.max(1, Math.min(SLOTS.arrayValue.lines, Math.floor(((hex ? cellH * 0.55 : cellH) - 12) / (size * lineHeight))));
    const slot = { ...sized(SLOTS.arrayValue, valueW), lines };
    return new Map([...texts].map(([text, path]) => [text, fitTextAt(text, slot, path, size)]));
  };
  let values = fitAll(min);
  for (let size = max; size > min; size--) {
    const at = fitAll(size);
    if ([...at.values()].every((f) => f.fits)) {
      values = at;
      break;
    }
  }

  // A pointer without a tone takes the next one no pointer has asked for, so no two look alike while tones last.
  const free = POINTER_TONES.filter((t) => !(scene.pointers ?? []).some((p) => p.tone === t));
  let next = 0;
  const pointers = (scene.pointers ?? []).map((p, i) => ({
    name: p.name,
    row: markerRow(scene, p),
    tone: p.tone ?? (free.length ? free[next++ % free.length]! : POINTER_TONES[i % POINTER_TONES.length]!),
    fit: fitText(p.name, sized(SLOTS.pointerName, cellW - 12), `pointers[${i}].name`),
  }));
  const ranges = (scene.ranges ?? []).map((r, i) => {
    const row = rows.find((x) => x.name === markerRow(scene, r))!;
    const k = rangesOn(row.name).indexOf(r);
    return {
      name: r.name,
      row: row.name,
      tone: r.tone ?? 'accent',
      fit: fitText(r.name, sized(SLOTS.rangeLabel, box.width), `ranges[${i}].name`),
      y: (indexes ? row.indexY + INDEX_H : row.cellsY + cellH) + 8 + k * (BAND_H + BAND_GAP),
    };
  });
  const fix = multi ? 'show fewer arrays or cells, or split the walk into two scenes' : 'show fewer cells, pointers or ranges, or split the walk into two scenes';
  return { hex, indexes, slotW, cellW, cellH, rows, cells, values, pointers, ranges, width, height, room: fitBlock('values', 'array', height <= box.height, fix) };
}

/** The box of a cell, by its item key. */
export function cellBox(layout: ArrayLayout, key: string): Box {
  const { row, index } = layout.cells.get(key)!;
  return { x: cellX(layout, row, index) + (layout.hex ? 3 : 0), y: row.cellsY, width: layout.cellW, height: layout.cellH };
}

/** A slot's box past either end of a row, where a pointer can stand. */
export const ghostBox = (layout: ArrayLayout, row: PlacedRow, i: number): Box => ({ x: cellX(layout, row, i), y: row.cellsY, width: layout.cellW, height: layout.cellH });

/** A range's band under its array's cells, spanning cells `a` to `b` (fractional while it moves). */
export function bandBox(layout: ArrayLayout, rowName: string, y: number, [a, b]: readonly [number, number]): Box {
  const row = rowOf(layout, rowName);
  const at = (i: number) => {
    const lo = Math.floor(i);
    return cellX(layout, row, lo) + (cellX(layout, row, Math.min(row.count - 1, lo + 1)) - cellX(layout, row, lo)) * (i - lo);
  };
  return { x: at(a), y, width: at(b) - at(a) + layout.cellW, height: BAND_H };
}

/** The x of a pointer standing at a place that may be fractional while it moves. */
export function pointerX(layout: ArrayLayout, rowName: string, at: number): number {
  const row = rowOf(layout, rowName);
  const lo = Math.floor(at);
  return cellX(layout, row, lo) + (cellX(layout, row, lo + 1) - cellX(layout, row, lo)) * (at - lo);
}

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, where `state` puts it: a cell,
 * a whole array, a pointer's chip and arrow, a range's band. A note keeps off the cells, chips, bands and index labels.
 */
export function arrayBoxes(scene: ArrayScene, layout: ArrayLayout, state: SceneState): LayoutBoxes {
  const boxes = new Map<string, Box>();
  for (const key of layout.cells.keys()) boxes.set(key, cellBox(layout, key));
  for (const row of layout.rows) {
    if (state.hidden[row.key] || !row.name) continue;
    const first = cellBox(layout, cellKey(row.name, 0));
    const last = cellBox(layout, cellKey(row.name, row.count - 1));
    boxes.set(row.key, { x: first.x, y: first.y, width: last.x + last.width - first.x, height: layout.cellH });
  }
  const lanes = pointerLanes(scene, state);
  for (const p of layout.pointers) {
    const lane = lanes.get(p.name);
    if (lane === undefined) continue;
    const row = rowOf(layout, p.row);
    const x = cellX(layout, row, state.places[`ptr:${p.name}`]![0]);
    const top = chipY(row, lane);
    boxes.set(`ptr:${p.name}`, { x: x + 4, y: top, width: layout.cellW - 8, height: row.cellsY - top });
  }
  for (const r of layout.ranges) {
    if (state.hidden[`rg:${r.name}`]) continue;
    boxes.set(`rg:${r.name}`, bandBox(layout, r.row, r.y, state.places[`rg:${r.name}`]!));
  }
  const indexes = layout.indexes ? layout.rows.map((row) => ({ x: row.x, y: row.indexY, width: row.width, height: INDEX_H })) : [];
  return { boxes, obstacles: [...boxes.values(), ...indexes] };
}
