import { expandLineRefs, focusRanges } from '../../shared/focus.mjs';
import type { CodeScene, Hunk } from '../types';

/**
 * For each hunk line, the id of the focus range it falls in, or null. A range is a run of consecutive
 * focusLinesAfter (new-file) or focusLinesBefore (old-file) numbers. Ids are opaque; callers order
 * ranges by where they appear. With no focus on any line of the hunk, the changed lines form one range.
 */
export function lineFocusRanges(scene: CodeScene, hunk: Hunk): (number | null)[] {
  const ranges = [
    ...focusRanges(expandLineRefs(scene.focusLinesAfter)).map((r) => ({ side: 'newLine' as const, r })),
    ...focusRanges(expandLineRefs(scene.focusLinesBefore)).map((r) => ({ side: 'oldLine' as const, r })),
  ];
  const ids = hunk.lines.map((line) => {
    const id = ranges.findIndex(({ side, r: [a, b] }) => {
      const n = line[side];
      return n !== null && n >= a && n <= b;
    });
    return id < 0 ? null : id;
  });
  if (ids.some((id) => id !== null)) return ids;
  return hunk.lines.map((line) => (line.type === 'context' ? null : 0));
}
