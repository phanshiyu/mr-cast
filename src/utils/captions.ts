/** Greedy word wrap by character budget; each line holds the indices of its words. */
export function wrapWords(words: readonly string[], maxChars: number): number[][] {
  const lines: number[][] = [];
  let current: number[] = [];
  let length = 0;
  words.forEach((word, i) => {
    if (current.length && length + 1 + word.length > maxChars) {
      lines.push(current);
      current = [];
      length = 0;
    }
    length += (current.length ? 1 : 0) + word.length;
    current.push(i);
  });
  if (current.length) lines.push(current);
  return lines;
}

/** The page of `linesPerPage` wrapped lines that contains the current word. */
export function captionPage(narration: string, wordIndex: number, maxChars: number, linesPerPage = 2) {
  const words = narration.trim().split(/\s+/).filter(Boolean);
  const lines = wrapWords(words, maxChars);
  const current = Math.min(wordIndex, words.length - 1);
  const lineIndex = Math.max(0, lines.findIndex((l) => l.includes(current)));
  const start = Math.floor(lineIndex / linesPerPage) * linesPerPage;
  return { words, lines: lines.slice(start, start + linesPerPage) };
}
