// Line-ref parsing shared by the validator (plain Node) and the player (TS).

/** Line numbers named by refs like 12 or "12-18". Malformed refs are skipped; the validator reports them. */
export function expandLineRefs(refs = []) {
  const out = new Set();
  for (const ref of refs) {
    if (typeof ref === 'number') {
      out.add(ref);
      continue;
    }
    const [a, b = a] = String(ref).split('-').map((s) => parseInt(s, 10));
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
  }
  return out;
}

/** Maximal runs of consecutive line numbers, ascending, as [first, last] pairs. */
export function focusRanges(lines) {
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges = [];
  for (const n of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else ranges.push([n, n]);
  }
  return ranges;
}

/** The scene's focus ranges: focusLinesAfter (new-file numbers) first, then focusLinesBefore (old-file). */
export function sceneFocusRanges(scene) {
  return [
    ...focusRanges(expandLineRefs(scene.focusLinesAfter)).map((range) => ({ side: 'newLine', range })),
    ...focusRanges(expandLineRefs(scene.focusLinesBefore)).map((range) => ({ side: 'oldLine', range })),
  ];
}

/**
 * For each hunk line, the index into sceneFocusRanges(scene) of the range it falls in, or null.
 * With no focus on any line of the hunk, the changed lines form one range, id 0.
 */
export function lineFocusRanges(scene, hunk) {
  const ranges = sceneFocusRanges(scene);
  const ids = hunk.lines.map((line) => {
    const id = ranges.findIndex(({ side, range: [a, b] }) => {
      const n = line[side];
      return n !== null && n >= a && n <= b;
    });
    return id < 0 ? null : id;
  });
  if (ids.some((id) => id !== null)) return ids;
  return hunk.lines.map((line) => (line.type === 'context' ? null : 0));
}

/** Range ids in the order the single-column code view plays them: top to bottom by first line. */
export function focusStepOrder(scene, hunk) {
  return [...new Set(lineFocusRanges(scene, hunk).filter((id) => id !== null))];
}
