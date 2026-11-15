// The real lines a flow stage's `code` shows: which lines of a hunk or snippet, and which of them are lit. The flow
// scene's layout and `validate` both read them from here, so what validate accepts is what the scene draws.

/** "47-60" or 47 as [first, last], or null when it is neither. */
export function parseSpan(ref) {
  if (typeof ref === 'number') return Number.isInteger(ref) && ref > 0 ? [ref, ref] : null;
  const m = typeof ref === 'string' && ref.match(/^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  return a >= 1 && a <= b ? [a, b] : null;
}

/** The file-line number a hunk's line is known by: the new file's, or the old file's for a deleted file. */
const numberOf = (hunk, line) => (hunk.status === 'deleted' ? line.oldLine : line.newLine);

/** The hunk's own span of file-line numbers, [first, last], or null when it has none. */
function hunkNumbers(hunk) {
  const numbers = hunk.lines.map((l) => numberOf(hunk, l)).filter((n) => n !== null);
  return numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : null;
}

/**
 * What a stage's `code` shows of `hunk`: `rows`, the lines `lines` names in order, with any removed line that sits
 * between them, each with its index in hunk.lines and whether `light` marks it. `problem` says why it cannot be
 * drawn: a malformed or missing range, one the hunk does not reach, or a `light` outside the shown lines.
 * @returns {{ problem: string | null, rows: { index: number, lit: boolean }[], first: number | null }}
 */
export function codeRows(hunk, code) {
  const none = (problem) => ({ problem, rows: [], first: null });
  const span = parseSpan(code?.lines);
  if (!span) return none(`lines: ${JSON.stringify(code?.lines)} is not a line number or an "a-b" range`);
  const own = hunkNumbers(hunk);
  const [a, b] = span;
  if (!own || a < own[0] || b > own[1])
    return none(
      `lines: ${a === b ? a : `${a}-${b}`} is outside ${hunk.id}${own ? ` (it has lines ${own[0]}-${own[1]})` : ''}`,
    );
  const picked = hunk.lines.flatMap((l, index) => {
    const n = numberOf(hunk, l);
    return n !== null && n >= a && n <= b ? [index] : [];
  });
  if (!picked.length) return none(`lines: ${hunk.id} has no line in ${a === b ? a : `${a}-${b}`}`);
  const from = picked[0];
  const to = picked[picked.length - 1];
  const rows = hunk.lines.flatMap((_l, index) => (index >= from && index <= to ? [{ index, lit: false }] : []));
  if (code.light !== undefined) {
    const lit = parseSpan(code.light);
    if (!lit) return none(`light: ${JSON.stringify(code.light)} is not a line number or an "a-b" range`);
    let any = false;
    for (const row of rows) {
      const n = numberOf(hunk, hunk.lines[row.index]);
      if (n !== null && n >= lit[0] && n <= lit[1]) {
        row.lit = true;
        any = true;
      }
    }
    if (!any) return none(`light: ${code.light} is not among the lines shown, ${a === b ? a : `${a}-${b}`}`);
  }
  return { problem: null, rows, first: numberOf(hunk, hunk.lines[from]) };
}

/** The hunk id a stage's `code` names, from `hunk` or `snippet`, or undefined. */
export const codeHunkId = (code) => (typeof code?.hunk === 'string' ? code.hunk : code?.snippet);
