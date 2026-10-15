import type { DiffLine } from '../types';

/** One row of a side-by-side diff; each side is an index into hunk.lines, or null for a blank cell. */
export interface SplitRow {
  left: number | null;
  right: number | null;
}

/** Pairs each run of deletions with the run of additions that follows it, GitHub style. */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.type === 'context') {
      rows.push({ left: i, right: i });
      i++;
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    while (i < lines.length && lines[i]!.type === 'del') dels.push(i++);
    while (i < lines.length && lines[i]!.type === 'add') adds.push(i++);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    }
  }
  return rows;
}
