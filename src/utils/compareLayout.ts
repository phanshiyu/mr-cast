import { compareRowSame, compareTitles } from '../../shared/compare.mjs';
import { fitBlock, fitLines, fitText, fitTextAt, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { CompareCell, CompareRow, CompareScene, ImageFit, Tone, Verdict } from '../types';
import type { Box, LayoutBoxes } from './penGeometry';

/** Height of a side's title band, above its first row. */
export const HEADER_H = 66;
/** Padding inside a side's frame, left and right of its cells. */
const PANEL_PAD = 26;
/** Room between the two sides, where each row's "=" or arrow sits. */
const GUTTER = 88;
const LABEL_GAP = 30;
const LABEL_MIN = 200;
const LABEL_MAX = 360;
/** Room a verdict's icon takes at the right of each cell, when any row has a verdict. */
export const VERDICT_W = 44;
/** Padding around a snippet inside its code block. */
export const CODE_PAD = 12;
const BOTTOM_PAD = 14;
const MAX_FONT = 30;
const MIN_FONT = 18;

export type PlacedCompareCell = (
  | { kind: 'text'; text: Fit }
  | { kind: 'code'; code: string; lang: string; lines: Fit }
  | { kind: 'image'; src: string; fit: ImageFit }
) & {
  verdict: Verdict | null;
  /** Height of its text or code block, in layout pixels. */
  h: number;
};

export interface PlacedCompareRow {
  row: CompareRow;
  index: number;
  same: boolean;
  label: Fit | null;
  cells: [PlacedCompareCell, PlacedCompareCell];
  y: number;
  h: number;
}

export interface CompareSidePlaced {
  x: number;
  w: number;
  title: Fit;
  tone: Tone;
}

export interface CompareLayout {
  width: number;
  height: number;
  font: number;
  /** Width of the row label column, 0 when no row has a label. */
  labelW: number;
  sides: [CompareSidePlaced, CompareSidePlaced];
  /** Where the cells start inside a side, and how wide they are. */
  cellX: number;
  cellW: number;
  rows: PlacedCompareRow[];
  /** Below 1 when even the smallest font overflows: the comparison draws at `width / scale` and shrinks to fit. */
  scale: number;
  room: Fit;
}

const codeLines = (code: string) => code.replace(/\s+$/, '').split('\n');

function fitCell(cell: CompareCell, width: number, font: number, path: string): PlacedCompareCell {
  if (typeof cell === 'string') {
    const text = fitTextAt(cell.trim(), sized(SLOTS.compareCell, width), path, font);
    return { kind: 'text', text, verdict: null, h: text.height };
  }
  // A picture takes a 16:9 box the cell's width, the same on both sides whatever each picture's shape.
  if ('image' in cell)
    return {
      kind: 'image',
      src: cell.image,
      fit: cell.fit ?? 'contain',
      verdict: null,
      h: Math.round((width * 9) / 16),
    };
  const slot = {
    ...sized(SLOTS.compareCode, width - 2 * CODE_PAD),
    size: Math.min(SLOTS.compareCode.size, Math.round(font * 0.8)),
  };
  const lines = fitLines(codeLines(cell.code), slot, Infinity, `${path}.code`);
  return {
    kind: 'code',
    code: codeLines(cell.code).join('\n'),
    lang: cell.lang ?? 'plain',
    lines,
    verdict: null,
    h: lines.height + 2 * CODE_PAD,
  };
}

/** A row's two snippets drawn at the smaller of their sizes, so the eye compares like with like. */
function shareCodeSize(cells: PlacedCompareCell[], width: number, path: string): PlacedCompareCell[] {
  const code = cells.flatMap((c) => (c.kind === 'code' ? [c] : []));
  if (code.length < 2) return cells;
  const size = Math.min(...code.map((c) => c.lines.size));
  return cells.map((c, k) => {
    if (c.kind !== 'code') return c;
    const lines = fitLines(
      c.code.split('\n'),
      { ...sized(SLOTS.compareCode, width - 2 * CODE_PAD), size, min: size },
      Infinity,
      `${path}.cells[${k}].code`,
    );
    return { ...c, lines, h: lines.height + 2 * CODE_PAD };
  });
}

function labelWidth(rows: readonly CompareRow[], width: number): number {
  const labels = rows.flatMap((r) => (typeof r.label === 'string' && r.label.trim() ? [r.label] : []));
  if (!labels.length) return 0;
  const widest = Math.max(
    ...labels.map((l) => fitText(l, sized({ ...SLOTS.compareLabel, lines: 1 }, Infinity), '').width),
  );
  return Math.round(Math.min(LABEL_MAX, width * 0.22, Math.max(LABEL_MIN, widest + 8)));
}

function attempt(scene: CompareScene, width: number, font: number) {
  const labelW = labelWidth(scene.rows, width);
  const sideW = (width - labelW - (labelW ? LABEL_GAP : 0) - GUTTER) / 2;
  const x0 = labelW ? labelW + LABEL_GAP : 0;
  const titles = compareTitles(scene);
  const sides = [0, 1].map(
    (j): CompareSidePlaced => ({
      x: j === 0 ? x0 : x0 + sideW + GUTTER,
      w: sideW,
      title: fitText(titles[j]!, sized(SLOTS.sideTitle, sideW - 2 * PANEL_PAD), `sides[${j}].title`),
      tone: scene.sides?.[j]?.tone ?? (j === 0 ? 'neutral' : 'accent'),
    }),
  ) as [CompareSidePlaced, CompareSidePlaced];
  const verdicts = scene.rows.some((r) => r.verdict?.some(Boolean));
  const cellW = sideW - 2 * PANEL_PAD - (verdicts ? VERDICT_W : 0);
  const labelFont = Math.max(SLOTS.compareLabel.min, Math.min(SLOTS.compareLabel.size, Math.round(font * 0.87)));
  const pad = Math.round(font * 0.62);
  let y = HEADER_H;
  let fits = true;
  const rows = scene.rows.map((row, i): PlacedCompareRow => {
    const path = `rows[${i}]`;
    const fitted = shareCodeSize(
      row.cells.slice(0, 2).map((cell, k) => fitCell(cell, cellW, font, `${path}.cells[${k}]`)),
      cellW,
      path,
    ).map((c, k) => ({ ...c, verdict: row.verdict?.[k] ?? null }));
    const label =
      typeof row.label === 'string' && row.label.trim()
        ? fitTextAt(row.label, sized(SLOTS.compareLabel, labelW), `${path}.label`, labelFont)
        : null;
    fits &&=
      fitted.every((c) => (c.kind === 'text' ? c.text.fits : c.kind === 'code' ? c.lines.fits : true)) &&
      (label?.fits ?? true);
    const h = Math.max(label?.height ?? 0, ...fitted.map((c) => c.h)) + 2 * pad;
    const placed = {
      row,
      index: i,
      same: compareRowSame(row),
      label,
      cells: fitted as PlacedCompareRow['cells'],
      y,
      h,
    };
    y += h;
    return placed;
  });
  return {
    width,
    height: y + BOTTOM_PAD,
    font,
    labelW,
    sides,
    cellX: PANEL_PAD,
    cellW,
    rows,
    scale: 1,
    room: fitBlock('rows', 'comparison', true, ''),
    fits,
  };
}

/**
 * Places a comparison in a box. Picks the largest font at which every cell and label fits and the rows fit
 * the height; failing that, the smallest font laid out wider and scaled down, which `validate` reports.
 */
export function layoutCompare(scene: CompareScene, width: number, height: number): CompareLayout {
  for (let font = MAX_FONT; font >= MIN_FONT; font -= 2) {
    const { fits, ...result } = attempt(scene, width, font);
    if (fits && result.height <= height) return result;
  }
  const { fits: _, ...last } = attempt(scene, width, MIN_FONT);
  if (last.height <= height) return last;
  const scale = height / last.height;
  const { fits: __, ...wide } = attempt(scene, width / scale, MIN_FONT);
  return {
    ...wide,
    scale,
    room: fitBlock('rows', 'comparison', false, 'shorten the cells, or split the comparison into two scenes'),
  };
}

/** A cell's text or code block, in layout units: where a pen mark draws and the note keeps off. */
function cellBox(layout: CompareLayout, row: PlacedCompareRow, side: 0 | 1): Box {
  const cell = row.cells[side];
  const width =
    cell.kind === 'text' ? cell.text.width : cell.kind === 'code' ? cell.lines.width + 2 * CODE_PAD : layout.cellW;
  return {
    x: layout.sides[side].x + layout.cellX,
    y: row.y + (row.h - cell.h) / 2,
    width: Math.max(24, Math.min(layout.cellW, width)),
    height: cell.h,
  };
}

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, in layout units: a row across both
 * sides, a side's whole frame, and one cell's text. A note keeps off the titles, the labels, and every row shown
 * by `shownThrough` (all of them by default) from one side's edge to the other, so it lands in free space.
 */
export function compareBoxes(layout: CompareLayout, shownThrough = Infinity): LayoutBoxes {
  const boxes = new Map<string, Box>();
  const left = layout.sides[0].x;
  const right = layout.sides[1].x + layout.sides[1].w;
  layout.sides.forEach((side, j) => boxes.set(`s:${j}`, { x: side.x, y: 0, width: side.w, height: layout.height }));
  const obstacles: Box[] = layout.sides.map((side) => ({ x: side.x, y: 0, width: side.w, height: HEADER_H }));
  layout.rows.forEach((row) => {
    boxes.set(`r:${row.index}`, {
      x: row.label ? 0 : left,
      y: row.y,
      width: right - (row.label ? 0 : left),
      height: row.h,
    });
    ([0, 1] as const).forEach((side) => boxes.set(`x:${row.index}/${side}`, cellBox(layout, row, side)));
    if (row.label)
      obstacles.push({
        x: 0,
        y: row.y + (row.h - row.label.height) / 2,
        width: row.label.width,
        height: row.label.height,
      });
    if (row.index <= shownThrough) obstacles.push({ x: left, y: row.y, width: right - left, height: row.h });
  });
  return { boxes, obstacles };
}
