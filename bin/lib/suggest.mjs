// "Did you mean" hints for names a storyboard gets wrong: icon names, step refs.

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[b.length];
}

/** Up to `limit` candidates close to `name`: a small edit away, or sharing a word with it, nearest first. */
export function closest(name, candidates, limit = 3) {
  const want = String(name).toLowerCase().trim();
  const words = want.split(/[\s\-_.:@>]+/).filter((w) => w.length > 2);
  const scored = [...new Set(candidates)].flatMap((candidate) => {
    const c = candidate.toLowerCase();
    const d = distance(want, c);
    if (d <= Math.max(2, Math.floor(want.length / 3))) return [{ candidate, score: d }];
    if (words.some((w) => c.split(/[\s\-_.:@>]+/).includes(w))) return [{ candidate, score: 10 + d }];
    return [];
  });
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.candidate);
}

/** `; did you mean "a" or "b"?`, or an empty string when nothing is close. */
export function didYouMean(name, candidates) {
  const hits = closest(name, candidates).map((c) => JSON.stringify(c));
  if (!hits.length) return '';
  return `; did you mean ${hits.length === 1 ? hits[0] : `${hits.slice(0, -1).join(', ')} or ${hits[hits.length - 1]}`}?`;
}
