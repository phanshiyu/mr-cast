// Fits text into the place a scene draws it, shared by the player's layout code and `validate`, so the
// two can never disagree about whether a text fits.
//
// A slot says where a text goes: its font, the width it has, how many lines it may wrap to, and the
// smallest size it may shrink to and still be read. `fitText` wraps the text at the slot's largest
// size, then shrinks it a pixel at a time until it fits; at the smallest size it reports that it does
// not fit. Text is never cut: the scene draws exactly the lines returned here, and an overlong one
// runs past its box instead of losing words.
//
// Widths come from shared/font-metrics.mjs, measured in the browser that renders stills and videos.

import { ADVANCES, KERNING, MEASURED_CHARS, MEASURED_SIZES, MEASURED_WEIGHTS } from './font-metrics.mjs';
import { parseMarkup } from './markup.mjs';

/**
 * @typedef {'sans' | 'mono'} Family
 * @typedef {{ family: Family, weight: number, size: number, letterSpacing?: number, upper?: boolean }} Font
 * @typedef {import('./markup.mjs').Run} Run
 */

const INDEX = new Map([...MEASURED_CHARS].map((c, i) => [c, i]));

/** Text drawn smaller than this on screen, in px, is hard to read in a video. */
export const READABLE_PX = 15;

/** A code chip is drawn this much smaller than the text around it, with this much padding each side (em). */
export const CODE_SCALE = 0.9;
export const CODE_PAD = 0.22;

/** The weight `**bold**` draws at, over text of `weight`. */
export const boldWeight = (weight) => (weight >= 700 ? 800 : 700);

/** An accented letter measures as its base letter; anything else unmeasured as a wide letter. */
function indexOf(ch) {
  const known = INDEX.get(ch);
  if (known !== undefined) return known;
  const base = ch.normalize('NFD')[0];
  if (base && INDEX.has(base)) return INDEX.get(base);
  return -1;
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Where `value` falls in an ascending list: the index below it and how far towards the next. */
function bracket(list, value) {
  if (value <= list[0]) return [0, 0];
  for (let k = 0; k < list.length - 1; k++)
    if (value <= list[k + 1]) return [k, (value - list[k]) / (list[k + 1] - list[k])];
  return [list.length - 1, 0];
}

/** Advance of one character at `font`'s size and weight, in px, without letter spacing. */
function charWidth(ch, family, weight, size) {
  const i = indexOf(ch);
  if (i < 0) return (/[⺀-￯]/.test(ch) ? 1 : 0.62) * size;
  const byWeight = ADVANCES[family];
  const [w, tw] = bracket(MEASURED_WEIGHTS, weight);
  const at = (wk) => {
    const rows = byWeight[MEASURED_WEIGHTS[Math.min(wk, MEASURED_WEIGHTS.length - 1)]];
    if (rows.length === 1) return rows[0][i];
    const [s, ts] = bracket(MEASURED_SIZES, size);
    return lerp(rows[s][i], rows[Math.min(s + 1, rows.length - 1)][i], ts);
  };
  return lerp(at(w), at(w + 1), tw) * size;
}

const kernTables = new Map();
/** Kerning pairs of a family at a measured weight and band, in em. */
function kernTable(family, weight, band) {
  const key = `${family}${weight}${band}`;
  if (!kernTables.has(key)) {
    const list = KERNING[family]?.[weight]?.[band];
    kernTables.set(
      key,
      new Map(list ? list.split('\n').map((entry) => [entry.slice(0, 2), Number(entry.slice(2)) / 1000]) : []),
    );
  }
  return kernTables.get(key);
}

/** Kerning bands a size falls in: text up to 20px, display from 28px, both in between. */
const bandsAt = (size) => (size <= 20 ? ['text'] : size >= 28 ? ['display'] : ['text', 'display']);

/**
 * What the pair `a` then `b` takes off their advances, in px. Between two measured weights, or between
 * the text and display sizes, it takes the change nearer zero, so a width is never underestimated.
 */
function kerning(a, b, family, weight, size) {
  if (!a || family === 'mono') return 0;
  const pair = a + b;
  const [w, tw] = bracket(MEASURED_WEIGHTS, weight);
  const ws =
    tw === 0
      ? [MEASURED_WEIGHTS[w]]
      : [MEASURED_WEIGHTS[w], MEASURED_WEIGHTS[Math.min(w + 1, MEASURED_WEIGHTS.length - 1)]];
  let k = -Infinity;
  for (const wk of ws) for (const band of bandsAt(size)) k = Math.max(k, kernTable(family, wk, band).get(pair) ?? 0);
  return k * size;
}

/** Width of plain text in `font`, in px. */
export function measure(text, font) {
  const shown = font.upper ? String(text).toUpperCase() : String(text);
  let width = 0;
  let prev = '';
  for (const ch of shown) {
    width +=
      charWidth(ch, font.family, font.weight, font.size) +
      kerning(prev, ch, font.family, font.weight, font.size) +
      (font.letterSpacing ?? 0);
    prev = ch;
  }
  return width;
}

/** The font a run draws in over a base font. */
export function runFont(run, font) {
  if (run.code)
    return { family: 'mono', weight: run.bold ? 700 : Math.min(font.weight, 600), size: font.size * CODE_SCALE };
  return run.bold ? { ...font, weight: boldWeight(font.weight) } : font;
}

/**
 * How a line may break after character i: 1 after a run of spaces, 2 (only inside a word too wide for its
 * line) after / _ - : or . before a letter, or between a lower-case letter or digit and an upper-case one
 * ("PaymentProvider|Client"), and 0 elsewhere, including anywhere inside a code chip.
 */
function breaksAfter(chars) {
  return chars.map((c, i) => {
    const next = chars[i + 1];
    if (!next || /\s/.test(next.ch)) return 0;
    if (/\s/.test(c.ch)) return 1;
    if (c.run.code || next.run.code) return 0;
    if (/[/_\-:.]/.test(c.ch) && /\p{L}/u.test(next.ch)) return 2;
    return /[a-z0-9]/.test(c.ch) && /[A-Z]/.test(next.ch) ? 2 : 0;
  });
}

/** Characters with the run each belongs to and its width, code chips padded at their ends. */
function layoutChars(runs, font) {
  const chars = [];
  for (const run of runs) {
    const f = runFont(run, font);
    const shown = font.upper && !run.code ? run.text.toUpperCase() : run.text;
    const list = [...shown];
    list.forEach((ch, k) => {
      let w =
        charWidth(ch, f.family, f.weight, f.size) +
        kerning(list[k - 1], ch, f.family, f.weight, f.size) +
        (run.code ? 0 : (font.letterSpacing ?? 0));
      if (run.code && k === 0) w += CODE_PAD * font.size;
      if (run.code && k === list.length - 1) w += CODE_PAD * font.size;
      chars.push({ ch, run, w });
    });
  }
  return chars;
}

/**
 * Greedy wrap of `chars` at `width`: each line takes as many words as fit, and a written "\n" always
 * ends one. A word wider than a line on its own breaks at its level-2 points; one still too wide breaks
 * between characters when `force` is set, and otherwise runs past the width. Either way the wrap reports
 * `ok: false`. Spaces where a line breaks are dropped.
 */
function greedy(chars, breaks, width, force) {
  const lines = [];
  let ok = true;
  const span = (a, b) => {
    let end = b;
    while (end > a && /\s/.test(chars[end].ch)) end--;
    let w = 0;
    for (let i = a; i <= end; i++) w += chars[i].w;
    return w;
  };
  /** The last index at or after `from` that ends a piece at `level` or stronger (the text's end counts). */
  const pieceEnd = (from, level) => {
    let i = from;
    while (i < chars.length - 1 && !(breaks[i] && breaks[i] <= level)) i++;
    return i;
  };
  /** Whether a written line break ends chars a to b: a piece holds one only in the spaces at its end. */
  const broken = (a, b) => {
    for (let i = a; i <= b; i++) if (chars[i].ch === '\n') return true;
    return false;
  };
  let start = 0;
  while (start < chars.length) {
    while (start < chars.length && /\s/.test(chars[start].ch)) start++;
    if (start >= chars.length) break;
    let end = pieceEnd(start, 1);
    if (span(start, end) <= width + 0.01) {
      while (end < chars.length - 1 && !broken(start, end)) {
        const next = pieceEnd(end + 1, 1);
        if (span(start, next) > width + 0.01) break;
        end = next;
      }
    } else {
      const word = end;
      end = pieceEnd(start, 2);
      if (end < word && span(start, end) <= width + 0.01) {
        while (end < word) {
          const next = pieceEnd(end + 1, 2);
          if (span(start, next) > width + 0.01) break;
          end = next;
        }
      } else if (span(start, end) > width + 0.01) {
        ok = false;
        if (force) {
          let w = 0;
          let i = start;
          while (i <= end && w + chars[i].w <= width + 0.01) w += chars[i++].w;
          end = Math.max(start, i - 1);
        }
      }
    }
    lines.push([start, end]);
    start = end + 1;
  }
  return { lines, ok };
}

/** A line of characters as runs, trailing spaces dropped. */
function lineRuns(chars, [a, b]) {
  let end = b;
  while (end > a && /\s/.test(chars[end].ch)) end--;
  const runs = [];
  for (let i = a; i <= end; i++) {
    const { ch, run } = chars[i];
    const last = runs[runs.length - 1];
    if (last && last.source === run) last.text += ch;
    else runs.push({ ...run, text: ch, source: run });
  }
  return runs.map(({ source, ...run }) => run);
}

const lineWidth = (chars, [a, b]) => {
  let end = b;
  while (end > a && /\s/.test(chars[end].ch)) end--;
  let w = 0;
  for (let i = a; i <= end; i++) w += chars[i].w;
  return w;
};

/**
 * Wraps runs into lines no wider than `width` (or `width(lines)`), with no more lines than needed;
 * `balanced` evens out the lengths of the lines it takes, as a label is set.
 * @returns {{ lines: Run[][], widths: number[], ok: boolean }}
 */
export function wrapRuns(runs, font, width, { balanced = false, force = false } = {}) {
  const chars = layoutChars(runs, font);
  if (!chars.length) return { lines: [[]], widths: [0], ok: true };
  const breaks = breaksAfter(chars);
  let { lines, ok } = greedy(chars, breaks, width, force);
  if (balanced && lines.length > 1 && ok) {
    let [lo, hi] = [0, width];
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      const trial = greedy(chars, breaks, mid, false);
      if (trial.ok && trial.lines.length <= lines.length) hi = mid;
      else lo = mid;
    }
    lines = greedy(chars, breaks, hi, false).lines;
  }
  return { lines: lines.map((l) => lineRuns(chars, l)), widths: lines.map((l) => lineWidth(chars, l)), ok };
}

/**
 * @typedef {{
 *   name: string,
 *   family: Family,
 *   weight: number,
 *   size: number,
 *   min: number,
 *   lines: number,
 *   lineHeight: number,
 *   width: number | ((lines: number, size: number) => number),
 *   letterSpacing?: number,
 *   upper?: boolean,
 *   balanced?: boolean,
 *   markup?: boolean,
 *   oneLineMin?: number,
 *   fix: string,
 *   severity?: 'warning',
 * }} Slot
 *
 * @typedef {{
 *   fit: true,
 *   path: string,
 *   text: string,
 *   slot: string,
 *   fix: string,
 *   size: number,
 *   font: Font,
 *   lines: Run[][],
 *   widths: number[],
 *   width: number,
 *   height: number,
 *   lineHeight: number,
 *   fits: boolean,
 *   min: number,
 *   markupErrors: import('./markup.mjs').MarkupError[],
 *   styled: number,
 * }} Fit
 */

const slotWidth = (slot, lines, size) => (typeof slot.width === 'function' ? slot.width(lines, size) : slot.width);

/** The runs `text` draws as in `slot`: its markup parsed, or the text as it is when the slot takes none. */
function slotRuns(text, slot) {
  if (slot.markup === false) return { runs: [{ text: String(text ?? '') }], errors: [] };
  return parseMarkup(text);
}

/** Share of the characters (0 to 1) drawn bold, as code, marked or in a tone. */
function styledOf(runs) {
  const total = runs.reduce((n, r) => n + r.text.length, 0);
  return total ? runs.reduce((n, r) => n + (r.bold || r.code || r.mark || r.tone ? r.text.length : 0), 0) / total : 0;
}

const fontOf = (slot, size) => ({
  family: slot.family,
  weight: slot.weight,
  size,
  letterSpacing: slot.letterSpacing,
  upper: slot.upper,
});

/** The wrap of `runs` in at most `maxLines` lines at `size`, or null when it needs more or breaks a word. */
function attempt(runs, slot, size, maxLines) {
  for (let n = 1; n <= maxLines; n++) {
    const wrapped = wrapRuns(runs, fontOf(slot, size), slotWidth(slot, n, size), { balanced: slot.balanced });
    if (wrapped.ok && wrapped.lines.length <= n) return { ...wrapped, size, fits: true };
  }
  return null;
}

/**
 * Fits `text` into `slot`: at the largest size whose wrap takes at most `slot.lines` lines with no word
 * broken, else smaller, down to `slot.min`. With `oneLineMin`, the text first shrinks that far on one
 * line before it wraps. At `slot.min` a text that still does not fit wraps onto as many lines as it
 * needs, breaking a word only when one word is wider than the slot, and reports `fits: false`.
 * @param {string} text
 * @param {Slot} slot
 * @param {string} path  Where the text is in the storyboard, e.g. "nodes[2].label", for the report.
 * @returns {Fit}
 */
export function fitText(text, slot, path) {
  const { runs, errors } = slotRuns(text, slot);
  const done = (r) => ({
    fit: true,
    path,
    text: String(text ?? ''),
    slot: slot.name,
    fix: slot.fix,
    size: r.size,
    font: fontOf(slot, r.size),
    lines: r.lines,
    widths: r.widths,
    width: Math.max(0, ...r.widths),
    height: r.lines.length * r.size * slot.lineHeight,
    lineHeight: slot.lineHeight,
    fits: r.fits,
    min: slot.min,
    markupErrors: errors,
    styled: styledOf(runs),
    severity: slot.severity,
  });
  if (slot.oneLineMin !== undefined) {
    for (let size = slot.size; size >= slot.oneLineMin; size--) {
      const r = attempt(runs, slot, size, 1);
      if (r) return done(r);
    }
  }
  for (let size = slot.size; size >= slot.min; size--) {
    const r = attempt(runs, slot, size, slot.lines);
    if (r) return done(r);
  }
  const wrapped = wrapRuns(runs, fontOf(slot, slot.min), slotWidth(slot, slot.lines, slot.min), { force: true });
  return done({ ...wrapped, size: slot.min, fits: false });
}

/** The same text and slot at a size of the caller's choosing, such as one size shared by every card. */
export function fitTextAt(text, slot, path, size) {
  return fitText(text, { ...slot, size, min: size, oneLineMin: undefined }, path);
}

/** A whole block that must fit a space, such as a table's rows in the frame, as a report entry. */
export function fitBlock(path, slot, fits, fix) {
  return {
    fit: true,
    path,
    text: '',
    slot,
    fix,
    size: 0,
    font: { family: 'sans', weight: 400, size: 0 },
    lines: [],
    widths: [],
    width: 0,
    height: 0,
    lineHeight: 0,
    fits,
    min: 0,
    markupErrors: [],
    styled: 0,
  };
}

/**
 * Lines that must not wrap, such as code, at the largest size in [slot.min, slot.size] where every line
 * fits `slot.width` and all of them fit `height`. Reports `fits: false` at slot.min when they do not.
 * @param {string[]} lines
 * @param {Slot} slot
 * @param {number} height
 * @param {string} path
 * @returns {Fit}
 */
export function fitLines(lines, slot, height, path) {
  const width = typeof slot.width === 'function' ? slot.width(lines.length, slot.size) : slot.width;
  const widthsAt = (size) => lines.map((line) => measure(line, fontOf(slot, size)));
  let size = slot.size;
  while (
    size > slot.min &&
    (Math.max(0, ...widthsAt(size)) > width + 0.01 || lines.length * size * slot.lineHeight > height + 0.01)
  )
    size--;
  const widths = widthsAt(size);
  const fits = Math.max(0, ...widths) <= width + 0.01 && lines.length * size * slot.lineHeight <= height + 0.01;
  const widest = widths.indexOf(Math.max(0, ...widths));
  return {
    fit: true,
    path,
    text: lines[widest] ?? '',
    slot: slot.name,
    fix: slot.fix,
    size,
    font: fontOf(slot, size),
    lines: lines.map((text) => [{ text }]),
    widths,
    width: Math.max(0, ...widths),
    height: lines.length * size * slot.lineHeight,
    lineHeight: slot.lineHeight,
    fits,
    min: slot.min,
    markupErrors: [],
    styled: 0,
    severity: slot.severity,
  };
}
