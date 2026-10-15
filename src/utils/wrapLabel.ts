const squash = (text: string) => text.trim().replace(/\s+/g, ' ');

/** The most even split of `text` into two lines of at most `maxChars` at a space, or null when there is none. */
export function splitInTwo(text: string, maxChars: number): [string, string] | null {
  const words = squash(text).split(' ');
  let best: [string, string] | null = null;
  for (let k = 1; k < words.length; k++) {
    const pair: [string, string] = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
    const longest = Math.max(pair[0].length, pair[1].length);
    if (longest <= maxChars && (!best || longest < Math.max(best[0].length, best[1].length))) best = pair;
  }
  return best;
}

/**
 * Splits an edge label into one or two lines of at most `maxChars`, breaking at a space so the two
 * lines come out as even as possible. Only text that cannot fit in two lines is cut, with an ellipsis.
 */
export function wrapLabel(text: string, maxChars: number): string[] {
  const clean = squash(text);
  if (clean.length <= maxChars) return [clean];
  const even = splitInTwo(clean, maxChars);
  if (even) return even;
  const words = clean.split(' ');
  let k = 0;
  while (k < words.length && words.slice(0, k + 1).join(' ').length <= maxChars) k++;
  const first = k ? words.slice(0, k).join(' ') : clean.slice(0, maxChars);
  const rest = (k ? words.slice(k).join(' ') : clean.slice(maxChars)).trim();
  return [first, rest.length <= maxChars ? rest : `${rest.slice(0, maxChars - 1).trimEnd()}…`];
}
