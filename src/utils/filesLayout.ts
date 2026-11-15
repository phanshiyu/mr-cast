import { fitText, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import { badgesWidth } from './marks';
import type { Box, LayoutBoxes } from './penGeometry';
import type { ScenePart, ShownFile } from '../../shared/files.mjs';
import type { PartWeight } from '../types';

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
  | {
      kind: 'part';
      name: string;
      depth: number;
      weight: PartWeight;
      count: number;
      additions: number;
      deletions: number;
      /** Whether the files carry line counts, so the heading shows the totals. */
      counted: boolean;
    }
  | { kind: 'file'; name: string; depth: number; file: ShownFile; note: string | undefined; weight?: PartWeight }
  /** The quiet "+ N more" line that closes a part whose smaller files are not listed. */
  | { kind: 'more'; name: string; depth: number; weight: PartWeight };

/** How large a part's heading is drawn, against the tree's font: the core parts carry the eye. */
const PART_SCALE: Record<PartWeight, number> = { core: 1.12, support: 1, routine: 0.88 };
/** How strong a part's rows draw: routine parts are quiet, so the parts that matter stand out. */
export const PART_OPACITY: Record<PartWeight, number> = { core: 1, support: 0.88, routine: 0.58 };
/** Room, in rows, above each part's heading but the first. */
const PART_GAP = 0.55;
/** Widest "12 files  +1234 −1234" a part's heading holds at its right, in characters. */
const PART_COUNT_CHARS = 22;

export interface PlacedRow {
  row: TreeRow;
  /** Left edge of the row's column. */
  x: number;
  y: number;
  /** Its name, fitted to the name column, and a file's note, fitted to the note column. */
  name: Fit;
  note: Fit | null;
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

/** Most file rows a part-grouped list shows in all; a part's other files are counted in its "+ N more" line. */
const PARTS_FILE_ROWS = 26;
/** Each part's claim on those rows, by weight: the parts that matter get more. */
const PART_SHARE: Record<PartWeight, number> = { core: 3, support: 2, routine: 1 };

/**
 * How many files of each part to list. All of them when they fit; otherwise the rows are shared out by weight, a part
 * with fewer files than its share leaves the rest to the others, and every part lists at least one.
 */
function partCaps(parts: readonly ScenePart[], budget: number): number[] {
  const caps = parts.map(() => 0);
  let open = parts.map((_, i) => i);
  let left = budget;
  while (open.length) {
    const total = open.reduce((n, i) => n + PART_SHARE[parts[i]!.weight], 0);
    const share = (i: number) => Math.max(1, Math.floor((left * PART_SHARE[parts[i]!.weight]) / total));
    const small = open.filter((i) => parts[i]!.files.length <= share(i));
    if (!small.length) {
      for (const i of open) caps[i] = share(i);
      break;
    }
    for (const i of small) {
      caps[i] = parts[i]!.files.length;
      left -= caps[i]!;
    }
    open = open.filter((i) => !small.includes(i));
  }
  // Rows the shares left over (rounding, or a part that needs fewer) go to the parts with files still unlisted, in order.
  left = budget - caps.reduce((n, c) => n + c, 0);
  for (const i of parts.keys()) {
    const more = Math.min(left, Math.max(0, parts[i]!.files.length - caps[i]!));
    caps[i]! += more;
    left -= more;
  }
  return caps;
}

const size = (f: ShownFile) => (f.additions ?? 0) + (f.deletions ?? 0);

/** The rows of a part-grouped list: each part's heading, then its files by their file names (the whole path where two share one). */
function partRows(parts: readonly ScenePart[], notes: Record<string, string>): TreeRow[] {
  const caps = partCaps(parts, PARTS_FILE_ROWS);
  const counted = parts.some((g) => g.files.some((f) => f.additions !== undefined || f.deletions !== undefined));
  const names = parts.flatMap((g) => g.files.map((f) => f.path.split('/').pop()!));
  return parts.flatMap((g, p): TreeRow[] => {
    // The largest files, with any the writer gave a note; they stay in the order written.
    const ranked = [...g.files].sort(
      (a, b) => Number(Boolean(notes[b.path])) - Number(Boolean(notes[a.path])) || size(b) - size(a),
    );
    const listed = new Set(ranked.slice(0, caps[p]));
    const hidden = g.files.length - listed.size;
    return [
      {
        kind: 'part',
        name: g.name,
        depth: 0,
        weight: g.weight,
        count: g.files.length,
        additions: g.additions,
        deletions: g.deletions,
        counted,
      },
      ...g.files
        .filter((f) => listed.has(f))
        .map((file): TreeRow => {
          const base = file.path.split('/').pop()!;
          const shared = names.filter((n) => n === base).length > 1;
          return {
            kind: 'file',
            name: shared ? file.path : base,
            depth: 1,
            file,
            note: notes[file.path],
            weight: g.weight,
          };
        }),
      ...(hidden ? [{ kind: 'more' as const, name: `+ ${hidden} more`, depth: 1, weight: g.weight }] : []),
    ];
  });
}

/** The files as a tree by directory, or, with `parts`, grouped under their parts. */
export function treeRows(
  files: readonly ShownFile[],
  notes: Record<string, string>,
  parts: readonly ScenePart[] | null = null,
): TreeRow[] {
  return parts ? partRows(parts, notes) : flatten(buildTree(files), 0, notes, []);
}

/**
 * Splits the rows into two columns at the directory nearest the middle. The second column repeats that
 * directory's ancestors at its top, so every file still shows where it lives.
 */
function splitColumns(rows: readonly TreeRow[]): TreeRow[][] {
  const middle = rows.length / 2;
  let at = -1;
  rows.forEach((r, i) => {
    if ((r.kind === 'dir' || r.kind === 'part') && i > 0 && (at < 0 || Math.abs(i - middle) < Math.abs(at - middle)))
      at = i;
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

/**
 * A note on one line of its row, shrinking to three quarters of the tree's font; then on two lines, at a
 * size two lines of which fit the row.
 */
function noteFit(text: string, width: number, font: number, rowH: number, path: string): Fit {
  const slot = sized(SLOTS.fileNote, width);
  const one = fitText(text, { ...slot, size: Math.round(font * 0.92), min: Math.round(font * 0.72), lines: 1 }, path);
  if (one.fits) return one;
  const two = Math.min(Math.round(font * 0.72), Math.floor(rowH / (2 * SLOTS.fileNote.lineHeight)));
  return fitText(text, { ...slot, size: Math.max(two, SLOTS.fileNote.min), lines: 2 }, path);
}

function attempt(columns: readonly TreeRow[][], totalWidth: number, font: number, counts: boolean) {
  const width = (totalWidth - (columns.length - 1) * COLUMN_GUTTER) / columns.length;
  const all = columns.flat();
  const rowH = Math.round(font * 1.72);
  const indent = Math.round(font * 1.25);
  const iconW = Math.round(font * 1.35);
  const nameX = PAD_X + MARKER_W;
  const nameNeed = Math.max(
    ...all
      .filter((r) => r.kind !== 'part' && r.kind !== 'more')
      .map(
        (r) =>
          r.depth * indent +
          iconW +
          r.name.length * font * MONO_ADVANCE +
          (r.kind === 'file'
            ? (r.file.test ? font * 3.4 : 0) +
              (r.file.badge ? badgesWidth([r.file.badge], Math.round(font * 0.58)) + 8 : 0)
            : 0),
      ),
  );
  const hasNotes = all.some((r) => r.kind === 'file' && r.note);
  const nameW = Math.min(nameNeed + 8, width * (hasNotes ? 0.46 : 0.7));
  const countsX = counts ? nameX + nameW + COL_GAP : null;
  const noteX = (countsX ?? nameX + nameW) + (counts ? COUNT_CHARS * font * 0.62 + 14 + BAR_MAX : 0) + COL_GAP;
  const noteW = width - PAD_X - noteX;
  const extras = (r: TreeRow) =>
    r.kind === 'file'
      ? (r.file.test ? font * 3.4 : 0) + (r.file.badge ? badgesWidth([r.file.badge], Math.round(font * 0.58)) + 8 : 0)
      : 0;
  const name = (r: TreeRow) =>
    r.kind === 'part'
      ? partName(r)
      : fitText(
          r.name,
          { ...sized(SLOTS.fileName, nameW - r.depth * indent - iconW - extras(r)), size: font },
          r.kind === 'file' ? `files[${JSON.stringify(r.file.path)}]` : '',
        );
  const partH = (r: Extract<TreeRow, { kind: 'part' }>) => Math.round(font * PART_SCALE[r.weight]);
  const partCountsW = (r: Extract<TreeRow, { kind: 'part' }>) =>
    Math.round((r.counted ? PART_COUNT_CHARS : 9) * Math.round(font * 0.88) * 0.62);
  const partTagW = (r: Extract<TreeRow, { kind: 'part' }>) => Math.round(r.weight.length * partH(r) * 0.42 + 36);
  const partName = (r: Extract<TreeRow, { kind: 'part' }>) =>
    fitText(
      r.name,
      {
        ...sized(SLOTS.partName, width - 2 * PAD_X - partCountsW(r) - partTagW(r) - 12),
        size: partH(r),
      },
      `parts[${JSON.stringify(r.name)}]`,
    );
  const note = (r: TreeRow) =>
    r.kind === 'file' && r.note ? noteFit(r.note, noteW, font, rowH, `notes[${JSON.stringify(r.file.path)}]`) : null;
  const gap = Math.round(rowH * PART_GAP);
  const heights: number[] = [];
  const rows = columns.flatMap((column, c) => {
    let y = 0;
    const placed = column.map((row, i) => {
      if (row.kind === 'part' && i > 0) y += gap;
      const at = { row, x: c * (width + COLUMN_GUTTER), y, name: name(row), note: note(row) };
      y += rowH;
      return at;
    });
    heights.push(y);
    return placed;
  });
  const height = Math.max(...heights);
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

/**
 * The box of each file a step can focus, by its key in shared/targets.mjs, in layout units: its icon and
 * name. A note keeps off every name, line count and note.
 */
export function filesBoxes(layout: FilesLayout): LayoutBoxes {
  const iconW = Math.round(layout.font * 0.95) + Math.round(layout.font * 0.4);
  const boxes = new Map<string, Box>();
  const obstacles: Box[] = [];
  for (const { row, x, y, name: text, note } of layout.rows) {
    const left = x + layout.nameX + row.depth * layout.indent;
    const name = {
      x: left,
      y: y + 4,
      width: Math.min(iconW + text.width, layout.nameX + layout.nameW - (left - x)),
      height: layout.rowH - 8,
    };
    obstacles.push(name);
    if (row.kind === 'part') boxes.set(`p:${row.name}`, name);
    if (row.kind !== 'file') continue;
    boxes.set(`f:${row.file.path}`, name);
    if (layout.countsX !== null)
      obstacles.push({ x: x + layout.countsX, y, width: layout.noteX - layout.countsX - 12, height: layout.rowH });
    if (note)
      obstacles.push({ x: x + layout.noteX, y, width: Math.min(layout.noteW, note.width), height: layout.rowH });
  }
  return { boxes, obstacles };
}
