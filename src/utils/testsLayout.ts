import { plainText } from '../../shared/markup.mjs';
import { fitBlock, fitText, fitTextAt, measure, type Fit, type Font, type Slot } from '../../shared/textfit.mjs';
import { isLive, testsMatrix, type MatrixCell, type MatrixRow, type TestsMatrix } from '../../shared/tests.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { TestsScene } from '../types';
import type { Box as PenBox, LayoutBoxes } from './penGeometry';

const MAX_FONT = 25;
const MIN_FONT = 15;
const COL_GAP = 12;
const ROW_GAP = 8;
/** Room between a cell's value and its tag. */
const TAG_GAP = 10;
/** The column titles' row, and the line under the matrix with the subject and the counts. */
export const HEAD_H = 40;
export const FOOT_H = 44;
const FOOT_GAP = 14;
const HEAD_SLOT = { ...SLOTS.tableHeader, size: 17 };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The word at the right of a cell. */
export type CellTag = 'NEW' | 'CHANGED' | 'unchecked' | 'REMOVED' | null;

export interface PlacedCell extends Box {
  cell: MatrixCell;
  /** The value with a tick when a test checks it; null for a cell no situation promises. */
  value: Fit | null;
  was: Fit | null;
  tag: CellTag;
}

export interface PlacedRow extends Box {
  row: MatrixRow;
  when: Fit;
  /** How many live tests check the row, drawn at the right of its header. */
  count: string;
  cells: PlacedCell[];
  /** The bar a gap row draws across the outcome columns, and its text. */
  bar: (Box & { text: Fit }) | null;
  /** The names of the tests that check the row, when the names column has room; a removed one is struck through. */
  names: { fit: Fit; removed: boolean }[];
}

export interface TestsLayout {
  matrix: TestsMatrix;
  font: number;
  tagFont: number;
  lineHeight: number;
  padX: number;
  /** The situations column, the outcome columns, and the test names column when it has room. */
  whenCol: { x: number; w: number; title: Fit };
  cols: { x: number; w: number; title: Fit }[];
  namesCol: { x: number; w: number; title: Fit } | null;
  rows: PlacedRow[];
  footY: number;
  subject: Fit | null;
  counts: string;
  /** Total width and height in layout pixels. */
  width: number;
  height: number;
  /** Below 1 when even the smallest font overflows: the scene draws at `width / scale` and shrinks to fit. */
  scale: number;
  /** Whether the matrix fits the frame at a readable size. */
  room: Fit;
}

const TAG_OF: Record<MatrixCell['state'], (cell: MatrixCell) => CellTag> = {
  checked: (c) => (c.status === 'added' ? 'NEW' : c.status === 'modified' ? 'CHANGED' : null),
  unchecked: () => 'unchecked',
  removed: () => 'REMOVED',
  none: () => null,
};

export const tagFont = (tag: NonNullable<CellTag>, size: number): Font =>
  tag === 'unchecked' ? { family: 'sans', weight: 600, size } : { family: 'sans', weight: 800, size, letterSpacing: 1 };
const tagWidth = (tag: CellTag, size: number) => (tag ? measure(tag, tagFont(tag, size)) + TAG_GAP : 0);

/** The text a cell shows: its promised value, ticked when a test checks it. */
const cellText = (cell: MatrixCell) => (cell.state === 'checked' ? `✓ ${cell.value ?? ''}`.trimEnd() : (cell.value ?? ''));

/** "7 tests · 4 new · 2 changed · 1 removed · 2 unchecked · 2 gaps": the counts under the matrix. */
export function countsLine({ counts }: TestsMatrix): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts = [counts.tests ? n(counts.tests, 'test') : 'no tests'];
  if (counts.added && counts.added < counts.tests) parts.push(`${counts.added} new`);
  if (counts.modified) parts.push(`${counts.modified} changed`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  if (counts.unchecked) parts.push(`${counts.unchecked} unchecked`);
  if (counts.gaps) parts.push(n(counts.gaps, 'gap'));
  return parts.join(' · ');
}

const rowCount = (scene: TestsScene, row: MatrixRow) => {
  const live = row.tests.filter((n) => (scene.tests[n]?.status ?? 'added') !== 'removed').length;
  return row.gap ? '' : live === 0 ? 'no test' : live === 1 ? '1 test' : `${live} tests`;
};


/**
 * Column widths for `room`: every column its natural width and an equal part of what is left; when they do not
 * all fit, the narrow ones keep theirs and the wide ones share the rest equally, so one long value never starves
 * the others.
 */
function shareWidths(natural: readonly number[], room: number): number[] {
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= room) return natural.map((n) => n + (room - total) / natural.length);
  const out = natural.map(() => 0);
  let open = natural.map((_, i) => i);
  let left = room;
  for (;;) {
    const share = left / open.length;
    const fitting = open.filter((i) => natural[i]! <= share);
    if (!fitting.length) break;
    for (const i of fitting) {
      out[i] = natural[i]!;
      left -= natural[i]!;
    }
    open = open.filter((i) => !fitting.includes(i));
    if (!open.length) return out;
  }
  for (const i of open) out[i] = left / open.length;
  return out;
}

function attempt(scene: TestsScene, matrix: TestsMatrix, width: number, font: number, maxLines = 2): Omit<TestsLayout, 'scale' | 'room'> & { fits: boolean } {
  const lineHeight = Math.round(font * 1.25);
  const padX = Math.round(font * 0.6);
  const padY = Math.round(font * 0.42);
  const small = Math.max(MIN_FONT, Math.round(font * 0.66));
  const { outcomes, rows } = matrix;
  const valueFont: Font = { family: 'sans', weight: 700, size: font };
  const whenFont: Font = { family: 'sans', weight: 600, size: font };
  const counted = rows.some((r) => r.tests.filter((n) => isLive(scene.tests[n])).length > 1);
  const countW = counted ? measure('99 tests', { family: 'sans', weight: 600, size: small }) + TAG_GAP : 0;

  const whenNat = Math.max(...rows.map((r) => measure(plainText(r.situation.when ?? ''), whenFont)), 0) + 2 * padX + countW;
  const whenW = Math.round(Math.min(Math.max(whenNat, width * 0.16), width * 0.34));
  const colNat = outcomes.map((o, col) =>
    Math.max(
      measure(o, { family: 'sans', weight: 700, size: HEAD_SLOT.size, letterSpacing: HEAD_SLOT.letterSpacing, upper: true }) + 2 * padX,
      ...rows.filter((r) => !r.gap).map((r) => {
        const cell = r.cells[col]!;
        return measure(plainText(cellText(cell)), valueFont) + tagWidth(TAG_OF[cell.state](cell), small) + 2 * padX;
      }),
    ),
  );

  const nameFont: Font = { family: 'mono', weight: 500, size: Math.max(MIN_FONT, Math.round(font * 0.76)) };
  const namesNat = scene.tests.length ? Math.max(...scene.tests.map((t) => measure(t.name, nameFont))) + 2 * padX : 0;
  const outcomeRoom = (namesW: number) => width - whenW - namesW - COL_GAP * (outcomes.length + (namesW ? 1 : 0));
  const natSum = colNat.reduce((a, b) => a + b, 0);
  const namesFit = Math.round(Math.min(namesNat, width * 0.3));
  // The names column only when every value still fits one line beside it.
  const namesW = namesNat && outcomeRoom(namesFit) >= natSum ? namesFit : 0;
  const room = outcomeRoom(namesW);
  const colW = shareWidths(colNat, room);

  let fits = true;
  const fitAt = (text: string, slot: Slot, w: number, path: string, size: number, lines = maxLines) => {
    const f = fitTextAt(text, { ...sized(slot, Math.max(1, w)), lines }, path, size);
    fits &&= f.fits;
    return f;
  };
  const whenCol = { x: 0, w: whenW, title: fitText(scene.when ?? 'When', sized(HEAD_SLOT, whenW - padX), scene.when ? 'when' : '') };
  let x = whenW + COL_GAP;
  const cols = outcomes.map((o, col) => {
    const placed = { x, w: Math.round(colW[col]!), title: fitText(o, sized(HEAD_SLOT, colW[col]! - padX), `outcomes[${col}]`) };
    x += placed.w + COL_GAP;
    return placed;
  });
  const namesCol = namesW ? { x, w: namesW, title: fitText('Tests', sized(HEAD_SLOT, namesW - padX), '') } : null;
  const right = namesCol ? namesCol.x + namesCol.w : x - COL_GAP;

  const placedRows: PlacedRow[] = [];
  let y = HEAD_H;
  rows.forEach((row, r) => {
    const sit = row.situation;
    // With the names column beside it a count would only repeat it, and with one test a row it says nothing a tick does not.
    const count = namesCol || !counted ? '' : rowCount(scene, row);
    const when = fitAt(sit.when ?? '', SLOTS.testWhen, whenW - 2 * padX - (count ? countW : 0), `situations[${r}].when`, font);
    let h = when.lines.length * lineHeight;
    let bar: PlacedRow['bar'] = null;
    const cells: PlacedCell[] = [];
    if (row.gap) {
      const barX = cols[0]?.x ?? whenW + COL_GAP;
      const text = fitAt(`✗ ${sit.gap}`, SLOTS.testGap, right - barX - 2 * padX, `situations[${r}].gap`, font);
      h = Math.max(h, text.lines.length * lineHeight);
      bar = { x: barX, y, w: right - barX, h: 0, text };
    } else {
      row.cells.forEach((cell, col) => {
        const tag = TAG_OF[cell.state](cell);
        const c = cols[col]!;
        const inner = c.w - 2 * padX - tagWidth(tag, small);
        const text = cellText(cell);
        const value = text ? fitAt(text, SLOTS.testValue, inner, cell.value === undefined ? '' : `situations[${r}].expect.${cell.outcome}`, font) : null;
        const wasPath = `tests[${cell.tests.find((n) => scene.tests[n]!.was)}].was`;
        const was = cell.was.length ? fitAt(cell.was.join(', '), SLOTS.testWas, inner, wasPath, small, 1) : null;
        h = Math.max(h, (value?.lines.length ?? 1) * lineHeight + (was ? Math.round(small * 1.25) : 0));
        cells.push({ cell, value, was, tag, x: c.x, y, w: c.w, h: 0 });
      });
    }
    const names = namesCol && !row.gap
      ? row.tests.map((n) => ({ fit: fitAt(scene.tests[n]!.name, SLOTS.testNames, namesCol.w - 2 * padX, `tests[${n}].name`, nameFont.size, 1), removed: !isLive(scene.tests[n]) }))
      : [];
    if (names.length) h = Math.max(h, names.length * Math.round(nameFont.size * 1.25));
    h += 2 * padY;
    for (const c of cells) c.h = h;
    if (bar) bar.h = h;
    placedRows.push({ row, when, count, cells, bar, names, x: 0, y, w: right, h });
    y += h + ROW_GAP;
  });
  const footY = y - ROW_GAP + FOOT_GAP;
  const subject = scene.subject ? fitText(scene.subject, sized(SLOTS.testSubject, right * 0.55), 'subject') : null;
  if (subject && !subject.fits) fits = false;
  return { matrix, font, tagFont: small, lineHeight, padX, whenCol, cols, namesCol, rows: placedRows, footY, subject, counts: countsLine(matrix), width: right, height: footY + FOOT_H, fits };
}

/**
 * Places the matrix in a box. Picks the largest font at which every text fits its two lines and the whole
 * matrix fits the height; failing that, the smallest font with three lines a text; failing that, the smallest
 * font laid out wider and scaled down, which `validate` reports.
 */
export function layoutTests(scene: TestsScene, width: number, height: number): TestsLayout {
  const matrix = testsMatrix(scene);
  const ok = fitBlock('situations', 'tests scene', true, '');
  for (let font = MAX_FONT; font >= MIN_FONT; font--) {
    const { fits, ...result } = attempt(scene, matrix, width, font);
    if (fits && result.height <= height) return { ...result, scale: 1, room: ok };
  }
  const { fits: _, ...last } = attempt(scene, matrix, width, MIN_FONT, 3);
  if (last.height <= height) return { ...last, scale: 1, room: ok };
  // A wider layout wraps less, so it is never taller: scaling by the first estimate always fits.
  const scale = height / last.height;
  const { fits: __, ...wide } = attempt(scene, matrix, width / scale, MIN_FONT, 3);
  return { ...wide, scale, room: fitBlock('situations', 'tests scene', false, 'split the situations into two tests scenes, or use fewer outcomes') };
}

const boxOf = (b: Box): PenBox => ({ x: b.x, y: b.y, width: b.w, height: b.h });

/**
 * The box of each item a step can focus, by its key in shared/tests.mjs, in layout units: a situation's row,
 * a cell, and an outcome's column. A note keeps off the headers, the cells and the bars.
 */
export function testsBoxes(layout: TestsLayout): LayoutBoxes {
  const boxes = new Map<string, PenBox>();
  const obstacles: PenBox[] = [];
  for (const row of layout.rows) {
    boxes.set(row.row.key, boxOf(row));
    obstacles.push({ x: 0, y: row.y, width: layout.whenCol.w, height: row.h });
    for (const c of row.cells) {
      boxes.set(c.cell.key, boxOf(c));
      obstacles.push(boxOf(c));
    }
    if (row.bar) obstacles.push(boxOf(row.bar));
    if (layout.namesCol && row.names.length) obstacles.push({ x: layout.namesCol.x, y: row.y, width: layout.namesCol.w, height: row.h });
  }
  // The column titles above the rows and the counts under them.
  obstacles.push({ x: 0, y: 0, width: layout.width, height: HEAD_H }, { x: 0, y: layout.footY, width: layout.width, height: FOOT_H });
  const last = layout.rows.at(-1);
  layout.cols.forEach((c, col) => boxes.set(`o:${col}`, { x: c.x, y: 0, width: c.w, height: last ? last.y + last.h : HEAD_H }));
  return { boxes, obstacles };
}
