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
function numberRuns(lines) {
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges = [];
  for (const n of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && n <= last[1] + 1) last[1] = Math.max(last[1], n);
    else ranges.push([n, n]);
  }
  return ranges;
}

/**
 * The focus ranges named by `refs`, ascending, as [first, last] pairs. Consecutive plain numbers join
 * into one range; each string ref ("12-18" or "13") stands alone, so touching strings stay separate
 * steps. Ranges that overlap merge.
 */
export function focusRanges(refs = []) {
  const numbers = refs.filter((ref) => typeof ref === 'number');
  const strings = refs.filter((ref) => typeof ref !== 'number').map((ref) => [...expandLineRefs([ref])]).filter((lines) => lines.length);
  const pieces = [...numberRuns(numbers), ...strings.map((lines) => [Math.min(...lines), Math.max(...lines)])].sort((x, y) => x[0] - y[0]);
  const ranges = [];
  for (const [a, b] of pieces) {
    const last = ranges[ranges.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else ranges.push([a, b]);
  }
  return ranges;
}

/**
 * A step's one range on its side. A malformed ref, which the validator reports, yields a range no
 * line falls in, so step k always stays range k and keeps its spoken segment.
 */
function stepRange(step) {
  const side = step?.lines === undefined && step?.oldLines !== undefined ? 'oldLine' : 'newLine';
  const range = focusRanges([side === 'oldLine' ? step.oldLines : step?.lines])[0] ?? [0, 0];
  return { side, range };
}

/** Indexes into `hunk.lines` of the lines a code step highlights. */
export function stepLines(hunk, step) {
  const { side, range: [a, b] } = stepRange(step);
  return hunk.lines.flatMap((line, i) => (line[side] !== null && line[side] >= a && line[side] <= b ? [i] : []));
}

/**
 * The scene's focus ranges. With `steps`, one per step in step order. Otherwise focusLinesAfter
 * (new-file numbers) first, then focusLinesBefore (old-file).
 */
export function sceneFocusRanges(scene) {
  if (Array.isArray(scene.steps) && scene.steps.length) return scene.steps.map(stepRange);
  return [
    ...focusRanges(scene.focusLinesAfter).map((range) => ({ side: 'newLine', range })),
    ...focusRanges(scene.focusLinesBefore).map((range) => ({ side: 'oldLine', range })),
  ];
}

/**
 * For each hunk line, the index into sceneFocusRanges(scene) of the range it falls in, or null.
 * With no focus on any line of the hunk, the changed lines form one range, id 0, or every line
 * when nothing changed (a source snippet).
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
  const changed = hunk.lines.some((line) => line.type !== 'context');
  return hunk.lines.map((line) => (changed && line.type === 'context' ? null : 0));
}

/** Range ids in the order the single-column code view plays them: top to bottom by first line. */
export function focusStepOrder(scene, hunk) {
  return [...new Set(lineFocusRanges(scene, hunk).filter((id) => id !== null))];
}
