import { hasMarkup } from '../../shared/markup.mjs';
import { fitBlock, fitText, fitTextAt, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { Box, LayoutBoxes } from './penGeometry';
import { rowBadgeRoom } from './marks';
import type { TableCell, TableRow } from '../types';

/** Average advance per em, rounded up so estimated line lengths never overflow. */
const MONO_ADVANCE = 0.61;
const SANS_ADVANCE = 0.5;

const MAX_FONT = 30;
const MIN_FONT = 17;
const LINE_HEIGHT = 1.3;

export const HEADER_H = 44;
export const MARKER_W = 30;
export const PAD_X = 22;
export const COL_GAP = 28;
const ROW_GAP = 6;
const ARROW = ' → ';
/** Width of one header character: 17px uppercase with 2.5px letter spacing. */
const HEADER_CHAR_W = 13;

/**
 * Identifiers, paths, numbers with units and the like read as code, so they render in mono. Math, such as
 * "O(n²)" or "n × m", and a percentage, such as "66%", read as text whether or not they have spaces. A cell
 * with markup (`` `pollIntervalMs` ``) says how it reads itself, so it renders its markup like any other text.
 */
const CODE_LIKE = /^[^\s]+$/;
const CODE_MARKS = /[_./:=()[\]{}<>@#$\d]|[a-z][A-Z]/;
const MATH = /^[OΘΩ]\(|[¹²³⁰-₟×÷∀-⋿]/u;
const PERCENT = /^[~≈<>+\-−±]?\d[\d,]*(\.\d+)?%$/;
const isCodeLike = (text: string) =>
  CODE_LIKE.test(text.trim()) &&
  CODE_MARKS.test(text) &&
  !MATH.test(text) &&
  !PERCENT.test(text.trim()) &&
  !hasMarkup(text);
/**
 * A header is upper-cased unless it holds a formula or code, whose case means something: an operator, a backtick,
 * a brace or bracket, an underscore, a call such as "f(x)", or camelCase. "Latency (ms)" is upper-cased.
 */
const CASED_HEADER = /[\^_=`[\]{}<>\\|*+]|\w\(|[a-z][A-Z]/;

export type PlacedCell =
  | { kind: 'text'; mono: boolean; text: Fit }
  /** `inline` puts the struck value and the new one on one line; otherwise the new value goes under the old. */
  | { kind: 'change'; mono: boolean; inline: boolean; before: Fit; after: Fit };

export interface PlacedRow {
  row: TableRow;
  /** Added, removed, or modified (explicitly or because a cell holds a before and after). */
  change: 'added' | 'removed' | 'modified' | null;
  cells: PlacedCell[];
  y: number;
  h: number;
}

export interface TableLayout {
  font: number;
  lineHeight: number;
  /** Left edge and width of each column, in layout pixels from the row's left edge. */
  cols: { x: number; w: number }[];
  /** Each column's header, fitted to its column. */
  headers: Fit[];
  rows: PlacedRow[];
  width: number;
  height: number;
  /** Some cell needs more lines than it may take. */
  truncated: boolean;
  /** Below 1 when even the smallest font overflows: the table draws at `width / scale` and shrinks to fit. */
  scale: number;
  /** Whether the table fits the frame at a readable size. */
  room: Fit;
}

const cellText = (cell: TableCell) => (typeof cell === 'string' ? cell : `${cell.before}${ARROW}${cell.after}`);
/** Characters a cell takes on one line; a change cell's bold new value and gaps run about two wider. */
const cellChars = (cell: TableCell) => (typeof cell === 'string' ? cell.length : cellText(cell).length + 2);
/** Code-like cells render in mono a little smaller than the body text. */
const cellFont = (font: number, mono: boolean) => (mono ? Math.round(font * 0.92) : font);
const cellMono = (cell: TableCell) =>
  typeof cell === 'string' ? isCodeLike(cell) : isCodeLike(cell.before) && isCodeLike(cell.after);
const advance = (mono: boolean) => (mono ? MONO_ADVANCE : SANS_ADVANCE);
const charWidth = (font: number, mono: boolean) => cellFont(font, mono) * advance(mono);
function rowChange(row: TableRow): PlacedRow['change'] {
  if (row.change) return row.change;
  return row.cells.some((c) => typeof c !== 'string') ? 'modified' : null;
}

/**
 * Splits the text width between columns: each gets what its longest text needs when that fits, and
 * columns that need more share what is left equally, so one long column cannot starve the rest.
 */
function columnWidths(columns: readonly string[], rows: readonly TableRow[], textW: number, font: number): number[] {
  const need = columns.map((header, i) => {
    const header_ = header.length * HEADER_CHAR_W + 8;
    const cells = rows.map((r) => {
      const cell = r.cells[i];
      return cell === undefined ? 0 : cellChars(cell) * charWidth(font, cellMono(cell));
    });
    return Math.max(header_, ...cells, font * 3);
  });
  const widths = new Array<number>(columns.length).fill(0);
  let open = columns.map((_, i) => i);
  let left = textW;
  while (open.length) {
    const share = left / open.length;
    const fits = open.filter((i) => need[i]! <= share);
    if (!fits.length) {
      for (const i of open) widths[i] = share;
      break;
    }
    for (const i of fits) {
      widths[i] = need[i]!;
      left -= need[i]!;
    }
    open = open.filter((i) => !fits.includes(i));
  }
  // Spare width goes to the columns in proportion to their text, so short tables still span the panel.
  const spare = textW - widths.reduce((a, b) => a + b, 0);
  const total = widths.reduce((a, b) => a + b, 0);
  return widths.map((w) => w + (spare * w) / total);
}

/** Font size of a row's own badges, drawn at its right end. */
export const ROW_BADGE = 13;

/** A cell's text at the table's font, in at most `lines` lines of its column; the first column is bolder. */
function fitCell(
  text: string,
  mono: boolean,
  first: boolean,
  width: number,
  font: number,
  lines: number,
  path: string,
): Fit {
  const slot = mono ? SLOTS.tableCode : SLOTS.tableCell;
  return fitTextAt(text, { ...sized(slot, width), lines, weight: first ? 650 : 450 }, path, cellFont(font, mono));
}

/** Room an inline change takes besides its two values: the gaps around the arrow, and the arrow. */
const INLINE_ARROW = (font: number) => 2 * 0.4 * font + 0.85 * font;

/** How a state's rows are laid out: the rows every state draws, for column widths, and each row's own change mark. */
interface Sizing {
  every: readonly TableRow[];
  changes: readonly PlacedRow['change'][] | null;
  /** Prefix for the paths of this state's cells, such as "steps[2]: " for a state a step made. */
  at: string;
}

function attempt(
  columns: readonly string[],
  rows: readonly TableRow[],
  width: number,
  font: number,
  maxLines = 2,
  sizing: Sizing = { every: rows, changes: null, at: '' },
) {
  const lineHeight = Math.round(font * LINE_HEIGHT);
  const pad = Math.round(font * 0.5);
  const textW = width - 2 * PAD_X - MARKER_W - (columns.length - 1) * COL_GAP - rowBadgeRoom(rows, ROW_BADGE);
  const widths = columnWidths(columns, sizing.every, textW, font);
  const cols: TableLayout['cols'] = [];
  let x = PAD_X + MARKER_W;
  for (const w of widths) {
    cols.push({ x, w });
    x += w + COL_GAP;
  }

  let truncated = false;
  let y = HEADER_H;
  const placed: PlacedRow[] = rows.map((row, r) => {
    const cells = columns.map((_, i): PlacedCell => {
      const cell = row.cells[i] ?? '';
      const mono = cellMono(cell);
      const path = `${sizing.at}rows[${r}].cells[${i}]`;
      const first = i === 0;
      if (typeof cell === 'string') {
        const text = fitCell(cell.trim(), mono, first, widths[i]!, font, maxLines, path);
        truncated ||= !text.fits;
        return { kind: 'text', mono, text };
      }
      const before = fitCell(cell.before, mono, first, widths[i]!, font, maxLines, `${path}.before`);
      const after = fitCell(cell.after, mono, true, widths[i]!, font, maxLines, `${path}.after`);
      const inlineW = before.widths[0]! + after.widths[0]! + INLINE_ARROW(cellFont(font, mono));
      if (before.lines.length === 1 && after.lines.length === 1 && inlineW <= widths[i]!)
        return { kind: 'change', mono, inline: true, before, after };
      truncated ||= !before.fits || !after.fits;
      return { kind: 'change', mono, inline: false, before, after };
    });
    const lines = Math.max(
      ...cells.map((c) =>
        c.kind === 'text' ? c.text.lines.length : c.inline ? 1 : c.before.lines.length + c.after.lines.length,
      ),
    );
    const h = lines * lineHeight + 2 * pad;
    const out = { row, change: sizing.changes ? sizing.changes[r]! : rowChange(row), cells, y, h };
    y += h + ROW_GAP;
    return out;
  });
  const headers = columns.map((c, i) =>
    fitText(
      c,
      { ...sized(SLOTS.tableHeader, widths[i]! + COL_GAP / 2), upper: !CASED_HEADER.test(c) },
      `columns[${i}]`,
    ),
  );
  return {
    font,
    lineHeight,
    cols,
    headers,
    rows: placed,
    width,
    height: y - ROW_GAP,
    truncated,
    scale: 1,
    room: fitBlock('rows', 'table', true, ''),
  };
}

/**
 * Places a table in a box, so stills stay deterministic. Picks the largest font at which every cell fits
 * its two lines and the table fits the height; failing that, the smallest font with three lines a cell;
 * failing that, the smallest font laid out wider and scaled down, which `validate` reports.
 */
export function layoutTable(
  columns: readonly string[],
  rows: readonly TableRow[],
  width: number,
  height: number,
): TableLayout {
  return layoutTableStates(columns, [rows], width, height)[0]!;
}

/**
 * Places a table whose cells steps change, once per state, so every state draws at one font with the same
 * columns: the widths come from every value any state shows, and the font is the largest at which every
 * state fits. Each row keeps the change mark of its first state, so a value a step strikes is no diff.
 * `base` starts the path of each cell, such as "table." for the table beside a graph.
 */
export function layoutTableStates(
  columns: readonly string[],
  states: readonly (readonly TableRow[])[],
  width: number,
  height: number,
  base = '',
): TableLayout[] {
  const every = states.flat();
  const changes = states[0]!.map(rowChange);
  const at = (k: number, font: number, lines: number, w = width) =>
    attempt(columns, states[k]!, w, font, lines, { every, changes, at: k ? `steps[${k - 1}]: ${base}` : base });
  const all = (font: number, lines: number, w = width) => states.map((_, k) => at(k, font, lines, w));
  for (let font = MAX_FONT; font >= MIN_FONT; font--) {
    const result = all(font, 2);
    if (result.every((r) => r.height <= height && !r.truncated)) return result;
  }
  // At the smallest font a cell may take a third line; a table that still overflows draws smaller and is reported.
  const last = all(MIN_FONT, 3);
  const fix = 'shorten the cells, or split the table into two scenes';
  const tallest = Math.max(...last.map((r) => r.height));
  if (tallest <= height) return last;
  const scale = height / tallest;
  return all(MIN_FONT, 3, width / scale).map((r) => ({ ...r, scale, room: fitBlock('rows', 'table', false, fix) }));
}

/** The width and lines of a cell's text as the table scene draws it. */
function cellExtent(cell: PlacedCell, font: number): { width: number; lines: number } {
  if (cell.kind === 'text') return { width: cell.text.width, lines: cell.text.lines.length };
  if (cell.inline) return { width: cell.before.width + cell.after.width + INLINE_ARROW(font), lines: 1 };
  return {
    width: Math.max(cell.before.width, cell.after.width),
    lines: cell.before.lines.length + cell.after.lines.length,
  };
}

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, in layout units: a row, a
 * column from its header down, and the text of one cell. A note keeps off the headers and the text of every cell.
 */
export function tableBoxes(layout: TableLayout): LayoutBoxes {
  const boxes = new Map<string, Box>();
  const last = layout.rows[layout.rows.length - 1];
  layout.cols.forEach((col, c) =>
    boxes.set(`c:${c}`, { x: col.x - 10, y: 4, width: col.w + 20, height: (last ? last.y + last.h : HEADER_H) - 4 }),
  );
  layout.rows.forEach((row, r) => {
    boxes.set(`r:${r}`, { x: 0, y: row.y, width: layout.width, height: row.h });
    row.cells.forEach((cell, c) => {
      const extent = cellExtent(cell, cellFont(layout.font, cell.mono));
      const width = Math.min(layout.cols[c]!.w, extent.width);
      const height = extent.lines * layout.lineHeight;
      boxes.set(`x:${r}/${c}`, {
        x: layout.cols[c]!.x,
        y: row.y + (row.h - height) / 2,
        width: Math.max(24, width),
        height,
      });
    });
  });
  const obstacles = [
    { x: 0, y: 0, width: layout.width, height: HEADER_H },
    ...[...boxes].flatMap(([key, b]) => (key.startsWith('x:') ? [b] : [])),
  ];
  return { boxes, obstacles };
}

/** A table's rows as each state shows them: every cell's value in that state ("x:row/col"), hidden rows kept in place. */
export function stateRows(
  columns: readonly string[],
  rows: readonly TableRow[],
  states: readonly { values: Record<string, unknown> }[],
): TableRow[][] {
  return states.map((state) =>
    rows.map(
      (row, r) =>
        ({
          ...row,
          cells: columns.map((_, c) => (state.values[`x:${r}/${c}`] as TableCell | undefined) ?? row.cells[c] ?? ''),
        }) as TableRow,
    ),
  );
}
