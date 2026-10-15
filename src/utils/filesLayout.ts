import { badgesWidth } from './marks';
import type { ShownFile } from '../../shared/files.mjs';

const MONO_ADVANCE = 0.61;
const MAX_FONT = 26;
const MIN_FONT = 17;
export const PAD_X = 20;
export const MARKER_W = 26;
const COL_GAP = 40;
const COLUMN_GUTTER = 56;
/** Below this a single column of names stops reading at a glance, so the tree flows into two columns. */
const ONE_COLUMN_MIN_FONT = 21;
export const BAR_MAX = 110;
/** Widest "+1234 −1234" the counts column holds, in characters. */
const COUNT_CHARS = 11;

export type TreeRow =
  | { kind: 'dir'; name: string; depth: number }
  | { kind: 'file'; name: string; depth: number; file: ShownFile; note: string | undefined };

export interface PlacedRow {
  row: TreeRow;
  /** Left edge of the row's column. */
  x: number;
  y: number;
}

export interface FilesLayout {
  font: number;
  rowH: number;
  indent: number;
  /** Every row, column by column, top to bottom. */
  rows: PlacedRow[];
  /** Width of one column; a long tree flows into two. */
  width: number;
  nameX: number;
  nameW: number;
  /** Absent in an explanation, where files carry no line counts. */
  countsX: number | null;
  noteX: number;
  noteW: number;
  /** Largest additions + deletions of any file, which a full-length bar stands for. */
  maxLines: number;
  /** Size of the whole tree, every column included. */
  totalWidth: number;
  height: number;
  scale: number;
}

interface Dir {
  dirs: Map<string, Dir>;
  files: ShownFile[];
}

function buildTree(files: readonly ShownFile[]): Dir {
  const root: Dir = { dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      if (!dir.dirs.has(part)) dir.dirs.set(part, { dirs: new Map(), files: [] });
      dir = dir.dirs.get(part)!;
    }
    dir.files.push(file);
  }
  return root;
}

/** Directories first, then files, each alphabetical; a directory with one subdirectory and no files joins it, as in "src/orders/". */
function flatten(dir: Dir, depth: number, notes: Record<string, string>, out: TreeRow[]): TreeRow[] {
  for (const [name, child] of [...dir.dirs].sort(([a], [b]) => a.localeCompare(b))) {
    let label = name;
    let node = child;
    while (node.files.length === 0 && node.dirs.size === 1) {
      const [next, inner] = [...node.dirs][0]!;
      label += `/${next}`;
      node = inner;
    }
    out.push({ kind: 'dir', name: `${label}/`, depth });
    flatten(node, depth + 1, notes, out);
  }
  for (const file of [...dir.files].sort((a, b) => a.path.localeCompare(b.path))) {
    out.push({ kind: 'file', name: file.path.split('/').pop()!, depth, file, note: notes[file.path] });
  }
  return out;
}

export function treeRows(files: readonly ShownFile[], notes: Record<string, string>): TreeRow[] {
  return flatten(buildTree(files), 0, notes, []);
}

/**
 * Splits the rows into two columns at the directory nearest the middle. The second column repeats that
 * directory's ancestors at its top, so every file still shows where it lives.
 */
function splitColumns(rows: readonly TreeRow[]): TreeRow[][] {
  const middle = rows.length / 2;
  let at = -1;
  rows.forEach((r, i) => {
    if (r.kind === 'dir' && i > 0 && (at < 0 || Math.abs(i - middle) < Math.abs(at - middle))) at = i;
  });
  if (at < 0) at = Math.ceil(middle);
  const ancestors: TreeRow[] = [];
  for (let i = at - 1, depth = rows[at]!.depth; i >= 0 && depth > 0; i--) {
    const r = rows[i]!;
    if (r.kind === 'dir' && r.depth < depth) {
      ancestors.unshift(r);
      depth = r.depth;
    }
  }
  return [rows.slice(0, at), [...ancestors, ...rows.slice(at)]];
}

function attempt(columns: readonly TreeRow[][], totalWidth: number, font: number, counts: boolean) {
  const width = (totalWidth - (columns.length - 1) * COLUMN_GUTTER) / columns.length;
  const all = columns.flat();
  const rowH = Math.round(font * 1.72);
  const indent = Math.round(font * 1.25);
  const iconW = Math.round(font * 1.35);
  const nameX = PAD_X + MARKER_W;
  const nameNeed = Math.max(
    ...all.map((r) => r.depth * indent + iconW + r.name.length * font * MONO_ADVANCE + (r.kind === 'file' ? (r.file.test ? font * 3.4 : 0) + (r.file.badge ? badgesWidth([r.file.badge], Math.round(font * 0.58)) + 8 : 0) : 0)),
  );
  const hasNotes = all.some((r) => r.kind === 'file' && r.note);
  const nameW = Math.min(nameNeed + 8, width * (hasNotes ? 0.46 : 0.7));
  const countsX = counts ? nameX + nameW + COL_GAP : null;
  const noteX = (countsX ?? nameX + nameW) + (counts ? COUNT_CHARS * font * 0.62 + 14 + BAR_MAX : 0) + COL_GAP;
  const noteW = width - PAD_X - noteX;
  const rows = columns.flatMap((column, c) => column.map((row, i) => ({ row, x: c * (width + COLUMN_GUTTER), y: i * rowH })));
  const height = Math.max(...columns.map((column) => column.length)) * rowH;
  return { font, rowH, indent, rows, width, nameX, nameW, countsX, noteX, noteW, totalWidth, height };
}

/**
 * Picks the largest font at which the tree fits the height in one column, down to a size that still
 * reads at a glance; then the largest that fits in two columns; failing that, two columns scaled down.
 */
export function layoutFiles(rows: readonly TreeRow[], width: number, height: number): FilesLayout {
  const files = rows.flatMap((r) => (r.kind === 'file' ? [r.file] : []));
  const counts = files.some((f) => f.additions !== undefined || f.deletions !== undefined);
  const maxLines = Math.max(1, ...files.map((f) => (f.additions ?? 0) + (f.deletions ?? 0)));
  const options = [
    { columns: [rows.slice()], min: ONE_COLUMN_MIN_FONT },
    { columns: splitColumns(rows), min: MIN_FONT },
  ];
  for (const { columns, min } of options) {
    for (let font = MAX_FONT; font >= min; font--) {
      const result = attempt(columns, width, font, counts);
      if (result.height <= height) return { ...result, maxLines, scale: 1 };
    }
  }
  const columns = options[1]!.columns;
  const scale = height / attempt(columns, width, MIN_FONT, counts).height;
  return { ...attempt(columns, width / scale, MIN_FONT, counts), maxLines, scale };
}
