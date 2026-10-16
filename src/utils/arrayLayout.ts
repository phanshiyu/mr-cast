import { fitBlock, fitText, fitTextAt, type Fit } from '../../shared/textfit.mjs';
import { sceneStates, type SceneState } from '../../shared/state-steps.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { ArrayScene, Tone } from '../types';
import type { Box, LayoutBoxes } from './penGeometry';

const CELL_MAX_W = 200;
const CELL_GAP = 10;
/** Room a value keeps inside its cell, each side. */
const CELL_PAD = 10;
const LABEL_H = 50;
export const CHIP_H = 38;
const CHIP_GAP = 6;
export const ARROW_LEN = 30;
const INDEX_H = 34;
export const BAND_H = 36;
const BAND_GAP = 10;
/** Room a range keeps inside its band around its name. */
export const BAND_PAD = 14;

export interface ArrayLayout {
  /** Width of one slot: a cell and the gap after it. */
  slotW: number;
  cellW: number;
  cellH: number;
  /** Cells of the array, plus a slot past either end when a pointer ever points there. */
  ghosts: { left: boolean; right: boolean };
  count: number;
  label: Fit | null;
  /** Every value any state shows, fitted at one shared size, by its text. */
  values: Map<string, Fit>;
  pointers: { name: string; tone: Tone; fit: Fit }[];
  ranges: { name: string; tone: Tone; fit: Fit; y: number }[];
  /** Top of the cells, and of the index labels under them. */
  cellsY: number;
  indexY: number;
  width: number;
  height: number;
  room: Fit;
}

/** Left edge of cell `i` (-1 and `count` are the slots past either end). */
export const cellX = (layout: ArrayLayout, i: number) => (i + (layout.ghosts.left ? 1 : 0)) * layout.slotW;

/** Top of a pointer chip stacked `lane` chips above its cell's arrow. */
export const chipY = (layout: ArrayLayout, lane: number) => layout.cellsY - ARROW_LEN - CHIP_H - lane * (CHIP_H + CHIP_GAP);

/** Each shown pointer's lane in its cell's stack, in declaration order from the cell up. */
export function pointerLanes(scene: ArrayScene, state: SceneState): Map<string, number> {
  const taken = new Map<number, number>();
  const lanes = new Map<string, number>();
  for (const p of scene.pointers ?? []) {
    if (state.hidden[`ptr:${p.name}`]) continue;
    const at = state.places[`ptr:${p.name}`]![0];
    lanes.set(p.name, taken.get(at) ?? 0);
    taken.set(at, (taken.get(at) ?? 0) + 1);
  }
  return lanes;
}

const POINTER_TONES: Tone[] = ['accent', 'warn', 'good', 'bad'];

export function layoutArray(scene: ArrayScene, box: { width: number; height: number }): ArrayLayout {
  const states = sceneStates(scene);
  const count = scene.values.length;
  const places = states.flatMap((s) => (scene.pointers ?? []).map((p) => s.places[`ptr:${p.name}`]![0]));
  const ghosts = { left: places.includes(-1), right: places.includes(count) };
  const slots = count + Number(ghosts.left) + Number(ghosts.right);
  const slotW = Math.min(CELL_MAX_W, Math.floor(box.width / slots));
  const cellW = slotW - CELL_GAP;
  const cellH = Math.max(76, Math.min(124, Math.round(cellW * 0.72)));

  // One size for every value the scene ever shows, so a value that changes keeps its size.
  const texts = new Map<string, string>();
  scene.values.forEach((v, i) => texts.set(String(v), `values[${i}]`));
  (scene.steps ?? []).forEach((step, k) => Object.entries(step.set ?? {}).forEach(([ref, v]) => texts.has(String(v)) || texts.set(String(v), `steps[${k}].set[${JSON.stringify(ref)}]`)));
  const { size: max, min, lineHeight } = SLOTS.arrayValue;
  const fitAll = (size: number) => {
    const lines = Math.max(1, Math.min(SLOTS.arrayValue.lines, Math.floor((cellH - 12) / (size * lineHeight))));
    const slot = { ...sized(SLOTS.arrayValue, cellW - 2 * CELL_PAD), lines };
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
    tone: p.tone ?? (free.length ? free[next++ % free.length]! : POINTER_TONES[i % POINTER_TONES.length]!),
    fit: fitText(p.name, sized(SLOTS.pointerName, cellW - 12), `pointers[${i}].name`),
  }));
  const stack = Math.max(0, ...states.flatMap((s) => [...pointerLanes(scene, s).values()].map((lane) => lane + 1)));
  const label = scene.label ? fitText(scene.label, sized(SLOTS.arrayLabel, box.width), 'label') : null;
  const cellsY = (label ? LABEL_H : 0) + (stack ? stack * (CHIP_H + CHIP_GAP) - CHIP_GAP + ARROW_LEN : 0) + 8;
  const indexY = cellsY + cellH + 8;
  const rangesY = indexY + INDEX_H + 8;
  const ranges = (scene.ranges ?? []).map((r, i) => ({
    name: r.name,
    tone: r.tone ?? 'accent',
    fit: fitText(r.name, sized(SLOTS.rangeLabel, box.width), `ranges[${i}].name`),
    y: rangesY + i * (BAND_H + BAND_GAP),
  }));
  const height = ranges.length ? rangesY + ranges.length * (BAND_H + BAND_GAP) - BAND_GAP : indexY + INDEX_H;
  const fix = 'show fewer cells, pointers or ranges, or split the walk into two scenes';
  return { slotW, cellW, cellH, ghosts, count, label, values, pointers, ranges, cellsY, indexY, width: slots * slotW - CELL_GAP, height, room: fitBlock('values', 'array', height <= box.height, fix) };
}

/** The box of a cell, by index. */
export const cellBox = (layout: ArrayLayout, i: number): Box => ({ x: cellX(layout, i), y: layout.cellsY, width: layout.cellW, height: layout.cellH });

/** A range's band under the cells, spanning cells `a` to `b` (fractional while it moves). */
export const bandBox = (layout: ArrayLayout, y: number, [a, b]: readonly [number, number]): Box => ({ x: cellX(layout, a), y, width: cellX(layout, b) - cellX(layout, a) + layout.cellW, height: BAND_H });

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, where `state` puts it: a cell,
 * a pointer's chip and arrow, a range's band. A note keeps off the cells, chips, bands and index labels.
 */
export function arrayBoxes(scene: ArrayScene, layout: ArrayLayout, state: SceneState): LayoutBoxes {
  const boxes = new Map<string, Box>();
  for (let i = 0; i < layout.count; i++) boxes.set(`c:${i}`, cellBox(layout, i));
  const lanes = pointerLanes(scene, state);
  for (const p of layout.pointers) {
    const lane = lanes.get(p.name);
    if (lane === undefined) continue;
    const x = cellX(layout, state.places[`ptr:${p.name}`]![0]);
    const top = chipY(layout, lane);
    boxes.set(`ptr:${p.name}`, { x: x + 4, y: top, width: layout.cellW - 8, height: layout.cellsY - top });
  }
  for (const r of layout.ranges) {
    if (state.hidden[`rg:${r.name}`]) continue;
    boxes.set(`rg:${r.name}`, bandBox(layout, r.y, state.places[`rg:${r.name}`]!));
  }
  const indexes = { x: 0, y: layout.indexY, width: layout.width, height: INDEX_H };
  return { boxes, obstacles: [...boxes.values(), indexes] };
}
