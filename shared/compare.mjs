// The compare scene's sides and rows, shared by the scene (which draws them) and the CLI (which checks and outlines them).

/** A compare scene's two side titles, "Before" and "After" unless it names its own. */
export const compareTitles = (scene) =>
  ['Before', 'After'].map((fallback, i) =>
    typeof scene?.sides?.[i]?.title === 'string' ? scene.sides[i].title : fallback,
  );

const cellKey = (cell) =>
  typeof cell === 'string'
    ? cell.trim()
    : cell && 'image' in cell
      ? `image\n${cell.image}`
      : cell && 'hunk' in cell
        ? `hunk\n${cell.hunk}\n${cell.side}\n${cell.lines}`
        : `${cell?.lang ?? ''}\n${cell?.code ?? ''}`;

/** Whether a row reads the same on both sides: its own `same`, or else whether its two cells are equal. */
export const compareRowSame = (row) =>
  row?.same ?? (Array.isArray(row?.cells) && row.cells.length === 2 && cellKey(row.cells[0]) === cellKey(row.cells[1]));

/** Whether a cell takes its code from a hunk: `{ hunk, side, lines }`. */
export const isHunkCell = (cell) => Boolean(cell) && typeof cell === 'object' && !Array.isArray(cell) && 'hunk' in cell;

/** The most lines a code cell read from a hunk shows before it stops reading well. */
export const HUNK_LINES_MAX = 8;

/** A line range written as 5 or "4-6", as [first, last], or null. */
export function lineRange(value) {
  const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(String(value));
  if (!m) return null;
  const [first, last] = [Number(m[1]), Number(m[2] ?? m[1])];
  return first >= 1 && last >= first ? [first, last] : null;
}

/**
 * The indexes into `hunk.lines` of the lines a hunk cell reads: the removed and context lines of the range by old-file
 * numbers for side "old", the added and context lines by new-file numbers for "new". Empty for a bad side or range.
 */
export function hunkCellRows(cell, hunk) {
  const range = lineRange(cell?.lines);
  if (!range || (cell?.side !== 'old' && cell?.side !== 'new')) return [];
  const old = cell.side === 'old';
  return (Array.isArray(hunk?.lines) ? hunk.lines : []).flatMap((l, i) => {
    const n = old ? l.oldLine : l.newLine;
    const ok =
      (l.type === 'context' || l.type === (old ? 'del' : 'add')) &&
      typeof n === 'number' &&
      n >= range[0] &&
      n <= range[1];
    return ok ? [i] : [];
  });
}

/**
 * The code a `{ hunk, side, lines }` cell shows, read from hunks.json: the old side is the removed and context
 * lines by old-file numbers, the new side the added and context lines by new-file numbers. Gives
 * `{ code, lang, caption, count }`, or `{ error }` for a hunk, side or range that does not exist.
 */
export function resolveHunkCell(cell, hunks) {
  const hunk = hunks?.[cell.hunk];
  if (!hunk) return { error: `no hunk "${cell.hunk}" in hunks.json; use an id from the hunk index` };
  if (cell.side !== 'old' && cell.side !== 'new') return { error: 'side must be "old" or "new"' };
  const range = lineRange(cell.lines);
  if (!range) return { error: `lines "${cell.lines}" must be a line number or a range like "4-6"` };
  const old = cell.side === 'old';
  const kept = hunkCellRows(cell, hunk).map((i) => hunk.lines[i]);
  if (!kept.length) {
    const own = (Array.isArray(hunk.lines) ? hunk.lines : []).map((l) => (old ? l.oldLine : l.newLine));
    const known = own.filter((n) => typeof n === 'number');
    const span = known.length ? `${Math.min(...known)}-${Math.max(...known)}` : 'none';
    return {
      error: `hunk ${cell.hunk} has no ${cell.side} lines in ${cell.lines} (its ${cell.side} lines are ${span})`,
    };
  }
  const nums = kept.map((l) => (old ? l.oldLine : l.newLine));
  const [a, b] = [nums[0], nums[nums.length - 1]];
  const file = old ? (hunk.oldFile ?? hunk.file) : hunk.file;
  return {
    code: kept.map((l) => l.text).join('\n'),
    lang: hunk.language,
    caption: `${file}:${a === b ? a : `${a}-${b}`}`,
    count: kept.length,
  };
}
