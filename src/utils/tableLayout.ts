import type { TableCell, TableRow } from '../types';
import { wrapLabel } from './wrapLabel';

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
export const HEADER_FONT = 17;

/** Identifiers, paths, numbers with units and the like read as code, so they render in mono. */
const CODE_LIKE = /^[^\s]+$/;
const CODE_MARKS = /[_./:=()[\]{}<>@#$\d]|[a-z][A-Z]/;
export const isCodeLike = (text: string) => CODE_LIKE.test(text.trim()) && CODE_MARKS.test(text);

export type PlacedCell =
  | { kind: 'text'; mono: boolean; lines: string[] }
  /** `inline` puts the struck value and the new one on one line; otherwise the new value goes under the old. */
  | { kind: 'change'; mono: boolean; inline: boolean; before: string[]; after: string[] };

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
  rows: PlacedRow[];
  width: number;
  height: number;
  truncated: boolean;
  /** Below 1 when even the smallest font overflows: the table draws at `width / scale` and shrinks to fit. */
  scale: number;
}

const cellText = (cell: TableCell) => (typeof cell === 'string' ? cell : `${cell.before}${ARROW}${cell.after}`);
/** Characters a cell takes on one line; a change cell's bold new value and gaps run about two wider. */
const cellChars = (cell: TableCell) => (typeof cell === 'string' ? cell.length : cellText(cell).length + 2);
/** Code-like cells render in mono a little smaller than the body text. */
export const cellFont = (font: number, mono: boolean) => (mono ? Math.round(font * 0.92) : font);
const cellMono = (cell: TableCell) => (typeof cell === 'string' ? isCodeLike(cell) : isCodeLike(cell.before) && isCodeLike(cell.after));
const advance = (mono: boolean) => (mono ? MONO_ADVANCE : SANS_ADVANCE);
const charWidth = (font: number, mono: boolean) => cellFont(font, mono) * advance(mono);
/**
 * Wraps a code-like cell into at most two lines, breaking after separators such as `_`, `/`, `.` and
 * `:` rather than mid-word. Text that still does not fit is cut with an ellipsis.
 */
function wrapCode(text: string, chars: number): string[] {
  const clean = text.trim();
  if (clean.length <= chars) return [clean];
  const pieces = clean.split(/(?<=[_/.:\-])/);
  let first = '';
  while (pieces.length && first.length + pieces[0]!.length <= chars) first += pieces.shift()!;
  if (!first) return wrapLabel(clean, chars);
  const rest = pieces.join('');
  return [first, rest.length <= chars ? rest : `${rest.slice(0, chars - 1)}…`];
}

const cut = (original: string, lines: string[]) => lines[lines.length - 1]!.endsWith('…') && !original.trim().endsWith('…');

export function rowChange(row: TableRow): PlacedRow['change'] {
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

function attempt(columns: readonly string[], rows: readonly TableRow[], width: number, font: number) {
  const lineHeight = Math.round(font * LINE_HEIGHT);
  const pad = Math.round(font * 0.5);
  const textW = width - 2 * PAD_X - MARKER_W - (columns.length - 1) * COL_GAP;
  const widths = columnWidths(columns, rows, textW, font);
  const cols: TableLayout['cols'] = [];
  let x = PAD_X + MARKER_W;
  for (const w of widths) {
    cols.push({ x, w });
    x += w + COL_GAP;
  }

  let truncated = false;
  let y = HEADER_H;
  const placed: PlacedRow[] = rows.map((row) => {
    const cells = columns.map((_, i): PlacedCell => {
      const cell = row.cells[i] ?? '';
      const mono = cellMono(cell);
      const chars = Math.max(4, Math.floor(widths[i]! / charWidth(font, mono) + 0.01));
      if (typeof cell === 'string') {
        const lines = !cell.trim() ? [''] : mono ? wrapCode(cell, chars) : wrapLabel(cell, chars);
        truncated ||= cut(cell, lines);
        return { kind: 'text', mono, lines };
      }
      if (cellChars(cell) <= chars) return { kind: 'change', mono, inline: true, before: [cell.before], after: [cell.after] };
      const wrap = mono ? wrapCode : wrapLabel;
      const before = wrap(cell.before, chars);
      const after = wrap(cell.after, chars);
      truncated ||= cut(cell.before, before) || cut(cell.after, after);
      return { kind: 'change', mono, inline: false, before, after };
    });
    const lines = Math.max(...cells.map((c) => (c.kind === 'text' ? c.lines.length : c.inline ? 1 : c.before.length + c.after.length)));
    const h = lines * lineHeight + 2 * pad;
    const out = { row, change: rowChange(row), cells, y, h };
    y += h + ROW_GAP;
    return out;
  });
  return { font, lineHeight, cols, rows: placed, width, height: y - ROW_GAP, truncated, scale: 1 };
}

/**
 * Places a table in a box from character counts, so stills stay deterministic. Picks the largest font
 * at which no cell is cut and the table fits the height; failing that, the largest that fits the
 * height; failing that, the smallest font laid out wider and scaled down.
 */
export function layoutTable(columns: readonly string[], rows: readonly TableRow[], width: number, height: number): TableLayout {
  let fallback: TableLayout | null = null;
  for (let font = MAX_FONT; font >= MIN_FONT; font--) {
    const result = attempt(columns, rows, width, font);
    if (result.height > height) continue;
    if (!result.truncated) return result;
    fallback ??= result;
  }
  if (fallback) return fallback;
  const scale = height / attempt(columns, rows, width, MIN_FONT).height;
  return { ...attempt(columns, rows, width / scale, MIN_FONT), scale };
}
