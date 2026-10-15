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
