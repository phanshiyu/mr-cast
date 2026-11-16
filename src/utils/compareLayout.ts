import { compareRowSame, compareTitles, isHunkCell, resolveHunkCell } from '../../shared/compare.mjs';
import { fitBlock, fitLines, fitText, fitTextAt, measure, type Fit } from '../../shared/textfit.mjs';
import { CODE_READABLE_MIN } from '../components/theme';
import { SLOTS, sized } from '../fit/slots';
import type { CompareCell, CompareRow, CompareScene, HunkMap, ImageFit, Tone, Verdict } from '../types';

/** Height of a side's title band, above its first row. */
const HEADER_H = 66;
/** Padding inside a side's frame, left and right of its cells. */
const PANEL_PAD = 26;
/** Room between the two sides, where each row's "=" or arrow sits. */
const GUTTER = 88;
/** A comparison that reads lines from a hunk needs every pixel for code, so its arrows are shorter. */
const HUNK_GUTTER = 64;
/** In `mode: "options"` nothing sits between the sides, so they sit closer. */
const OPTIONS_GUTTER = 40;
/** Room for the "Chosen" or "Not taken" label in a side's title band, and over a row's cell. */
const TAG_W = 150;
const TAG_H = 32;
const LABEL_GAP = 30;
const LABEL_MIN = 200;
const LABEL_MAX = 360;
/** Room a verdict's icon takes at the right of each cell, when any row has a verdict. */
const VERDICT_W = 44;
/** Padding around a snippet inside its code block. */
const CODE_PAD = 12;
/** Room kept between a hunk's code block and the edge of its side, which is all the code gives up to the side's padding. */
const HUNK_EDGE = 10;
const BOTTOM_PAD = 14;
const MAX_FONT = 30;
const MIN_FONT = 18;

export type Taken = 'chosen' | 'notTaken';

export type PlacedCompareCell = (
  | { kind: 'text'; text: Fit }
  | {
      kind: 'code';
      code: string;
      lang: string;
      lines: Fit;
      caption: Fit | null;
      capH: number;
      /** Lines read from a hunk: the block takes the side's whole width, so `bleed` px of it sit left of the cell column. */
      bleed: number;
      /** The width its lines may take, in px, for fitting them again. */
      codeW: number;
    }
  | { kind: 'image'; src: string; fit: ImageFit }
) & {
  verdict: Verdict | null;
  /** In `mode: "options"`: the option taken, or the one not taken. */
  taken: Taken | null;
  /** Whether the cell carries its own "Chosen" or "Not taken" label above its content, as a row's `chosen` asks. */
  tagged: boolean;
  /** Height of its text or code block, in layout pixels. */
  h: number;
};

export interface PlacedCompareRow {
  row: CompareRow;
  index: number;
  same: boolean;
  label: Fit | null;
  cells: [PlacedCompareCell, PlacedCompareCell];
  y: number;
  h: number;
}

export interface CompareSidePlaced {
  x: number;
  w: number;
  title: Fit;
  tone: Tone;
  /** In `mode: "options"`, when the side is marked taken or the other is. */
  taken: Taken | null;
}

export interface CompareLayout {
  width: number;
  height: number;
  font: number;
  /** `mode: "options"`: no cue between the sides. */
  options: boolean;
  /** `alternative: "mine"`: the way not taken is the writer's own idea, so its label reads "Another way". */
  mine: boolean;
  /** Width of the row label column, 0 when no row has a label. */
  labelW: number;
  sides: [CompareSidePlaced, CompareSidePlaced];
  /** Where the cells start inside a side, and how wide they are. */
  cellX: number;
  cellW: number;
  rows: PlacedCompareRow[];
  /** Below 1 when even the smallest font overflows: the comparison draws at `width / scale` and shrinks to fit. */
  scale: number;
  room: Fit;
}

const codeLines = (code: string) => code.replace(/\s+$/, '').split('\n');
/** What a cell is fitted into: the width of the cell column, how much wider a hunk's code may be, and the frame's height. */
interface Room {
  width: number;
  /** How far a hunk's code block reaches left of the cell column, and how much wider than the column it is in all. */
  bleed: number;
  extra: number;
  frameH: number;
  /** The width a hunk's code would have with no row labels and no verdict marks, which take room from every cell. */
  free: number;
  /** What narrows it, as words: "the row labels", "the verdict marks" or both. */
  narrowedBy: string;
}

function fitCell(cell: CompareCell, room: Room, font: number, path: string, hunks: HunkMap): PlacedCompareCell {
  const { width } = room;
  if (isHunkCell(cell)) {
    const read = resolveHunkCell(cell, hunks);
    if ('error' in read) return fitCell(`Not shown: ${read.error}`, room, font, path, hunks);
    return fitCode(read.code, read.lang, read.caption, width + room.extra, font, path, room);
  }
  if (typeof cell === 'string') {
    const text = fitTextAt(cell.trim(), sized(SLOTS.compareCell, width), path, font);
    return { kind: 'text', text, verdict: null, taken: null, tagged: false, h: text.height };
  }
  // A picture takes a 16:9 box the cell's width, the same on both sides whatever each picture's shape.
  if ('image' in cell)
    return {
      kind: 'image',
      src: cell.image,
      fit: cell.fit ?? 'contain',
      verdict: null,
      taken: null,
      tagged: false,
      h: Math.round((width * 9) / 16),
    };
  return fitCode(cell.code, cell.lang ?? 'plain', null, width, font, path, null);
}

/**
 * The slot for a snippet. Lines read from a hunk step down to the smallest size the project reads code at, and a line
 * too long for that says how many characters fit and how many lines the frame holds.
 */
function codeSlot(width: number, size: number, hunk: Room | null, widest: number, captioned: boolean) {
  const slot = { ...sized(SLOTS.compareCode, width - 2 * CODE_PAD), size };
  if (!hunk) return slot;
  const font = { family: 'mono' as const, weight: slot.weight, size: CODE_READABLE_MIN };
  const charW = measure('0'.repeat(100), font) / 100;
  const chars = Math.floor((slot.width as number) / charW);
  const free = Math.floor((hunk.free - 2 * CODE_PAD) / charW);
  const cause =
    free > chars ? `; ${hunk.narrowedBy} take room from it, and without them a cell holds up to ${free}` : '';
  const lineH = CODE_READABLE_MIN * slot.lineHeight;
  const room =
    hunk.frameH - HEADER_H - BOTTOM_PAD - 2 * Math.round(MIN_FONT * 0.62) - 2 * CODE_PAD - (captioned ? 24 : 0);
  return {
    ...slot,
    min: CODE_READABLE_MIN,
    fix: `this cell holds lines of up to ${chars} characters at ${CODE_READABLE_MIN}px, the smallest readable size (its longest is ${widest})${cause}, and the frame holds ${Math.floor(room / lineH)} lines of code in all, shared by the rows; narrow \`lines\` to fewer or shorter lines, or show the code in a code scene`,
  };
}

function fitCode(
  code: string,
  lang: string,
  caption: string | null,
  width: number,
  font: number,
  path: string,
  hunk: Room | null,
): PlacedCompareCell {
  const text = codeLines(code);
  const widest = Math.max(0, ...text.map((l) => l.length));
  const slot = codeSlot(
    width,
    Math.max(hunk ? CODE_READABLE_MIN : 0, Math.min(SLOTS.compareCode.size, Math.round(font * 0.8))),
    hunk,
    widest,
    caption !== null,
  );
  const lines = fitLines(text, slot, Infinity, `${path}.code`);
  const cap = caption
    ? fitText(
        caption,
        { ...sized(SLOTS.compareCaption, width - 2 * CODE_PAD), size: Math.max(12, Math.round(lines.size * 0.75)) },
        `${path}.caption`,
      )
    : null;
  const capH = cap ? cap.height + 6 : 0;
  return {
    kind: 'code',
    code: text.join('\n'),
    lang,
    lines,
    caption: cap,
    capH,
    bleed: hunk ? hunk.bleed : 0,
    codeW: width,
    verdict: null,
    taken: null,
    tagged: false,
    h: lines.height + capH + 2 * CODE_PAD,
  };
}

/** A row's two snippets drawn at the smaller of their sizes, so the eye compares like with like. */
function shareCodeSize(cells: PlacedCompareCell[], path: string): PlacedCompareCell[] {
  const code = cells.flatMap((c) => (c.kind === 'code' ? [c] : []));
  if (code.length < 2) return cells;
  const size = Math.min(...code.map((c) => c.lines.size));
  return cells.map((c, k) => {
    if (c.kind !== 'code') return c;
    const lines = fitLines(
      c.code.split('\n'),
      { ...sized(SLOTS.compareCode, c.codeW - 2 * CODE_PAD), size, min: size, fix: c.lines.fix },
      Infinity,
      `${path}.cells[${k}].code`,
    );
    return { ...c, lines, h: lines.height + c.capH + 2 * CODE_PAD };
  });
}

function labelWidth(rows: readonly CompareRow[], width: number): number {
  const labels = rows.flatMap((r) => (typeof r.label === 'string' && r.label.trim() ? [r.label] : []));
  if (!labels.length) return 0;
  const widest = Math.max(
    ...labels.map((l) => fitText(l, sized({ ...SLOTS.compareLabel, lines: 1 }, Infinity), '').width),
  );
  return Math.round(Math.min(LABEL_MAX, width * 0.22, Math.max(LABEL_MIN, widest + 8)));
}

function attempt(scene: CompareScene, width: number, font: number, hunks: HunkMap, frameH: number) {
  const labelW = labelWidth(scene.rows, width);
  const options = scene.mode === 'options';
  const gutter = options ? OPTIONS_GUTTER : scene.rows.some((r) => r.cells.some(isHunkCell)) ? HUNK_GUTTER : GUTTER;
  const sideW = (width - labelW - (labelW ? LABEL_GAP : 0) - gutter) / 2;
  const x0 = labelW ? labelW + LABEL_GAP : 0;
  const titles = compareTitles(scene);
  const sideChosen = options ? [0, 1].findIndex((j) => scene.sides?.[j]?.chosen === true) : -1;
  const sides = [0, 1].map(
    (j): CompareSidePlaced => ({
      x: j === 0 ? x0 : x0 + sideW + gutter,
      w: sideW,
      title: fitText(
        titles[j]!,
        sized(SLOTS.sideTitle, sideW - 2 * PANEL_PAD - (sideChosen >= 0 ? TAG_W : 0)),
        `sides[${j}].title`,
      ),
      tone: scene.sides?.[j]?.tone ?? ((sideChosen < 0 ? j === 1 : sideChosen === j) ? 'accent' : 'neutral'),
      taken: sideChosen < 0 ? null : sideChosen === j ? 'chosen' : 'notTaken',
    }),
  ) as [CompareSidePlaced, CompareSidePlaced];
  const verdicts = scene.rows.some((r) => r.verdict?.some(Boolean));
  const cellW = sideW - 2 * PANEL_PAD - (verdicts ? VERDICT_W : 0);
  // A hunk's code gives up less of the side to padding; with a verdict mark at the right it keeps that room.
  const bleed = PANEL_PAD - HUNK_EDGE;
  const free = (width - gutter) / 2 - 2 * PANEL_PAD + 2 * bleed;
  const room: Room = {
    width: cellW,
    bleed,
    extra: bleed + (verdicts ? 0 : bleed),
    frameH,
    free,
    narrowedBy: [labelW ? 'the row labels' : '', verdicts ? 'the verdict marks' : ''].filter(Boolean).join(' and '),
  };
  const labelFont = Math.max(SLOTS.compareLabel.min, Math.min(SLOTS.compareLabel.size, Math.round(font * 0.87)));
  const pad = Math.round(font * 0.62);
  let y = HEADER_H;
  let fits = true;
  const rows = scene.rows.map((row, i): PlacedCompareRow => {
    const path = `rows[${i}]`;
    const fitted = shareCodeSize(
      row.cells.slice(0, 2).map((cell, k) => fitCell(cell, room, font, `${path}.cells[${k}]`, hunks)),
      path,
    ).map((c, k): PlacedCompareCell => {
      const tagged = options && (row.chosen === 0 || row.chosen === 1);
      const taken: Taken | null = tagged ? (row.chosen === k ? 'chosen' : 'notTaken') : (sides[k]!.taken ?? null);
      return { ...c, verdict: row.verdict?.[k] ?? null, taken, tagged, h: c.h + (tagged ? TAG_H : 0) };
    });
    const label =
      typeof row.label === 'string' && row.label.trim()
        ? fitTextAt(row.label, sized(SLOTS.compareLabel, labelW), `${path}.label`, labelFont)
        : null;
    fits &&=
      fitted.every((c) => (c.kind === 'text' ? c.text.fits : c.kind === 'code' ? c.lines.fits : true)) &&
      (label?.fits ?? true);
    const h = Math.max(label?.height ?? 0, ...fitted.map((c) => c.h)) + 2 * pad;
    const placed = {
      row,
      index: i,
      same: !options && compareRowSame(row),
      label,
      cells: fitted as PlacedCompareRow['cells'],
      y,
      h,
    };
    y += h;
    return placed;
  });
  return {
    width,
    height: y + BOTTOM_PAD,
    font,
    options,
    mine: options && scene.alternative === 'mine',
    labelW,
    sides,
    cellX: PANEL_PAD,
    cellW,
    rows,
    scale: 1,
    room: fitBlock('rows', 'comparison', true, ''),
    fits,
  };
}

/**
 * Places a comparison in a box. Picks the largest font at which every cell and label fits and the rows fit
 * the height; failing that, the smallest font laid out wider and scaled down, which `validate` reports.
 */
export function layoutCompare(scene: CompareScene, width: number, height: number, hunks: HunkMap = {}): CompareLayout {
  for (let font = MAX_FONT; font >= MIN_FONT; font -= 2) {
    const { fits, ...result } = attempt(scene, width, font, hunks, height);
    if (fits && result.height <= height) return result;
  }
  const { fits: _, ...last } = attempt(scene, width, MIN_FONT, hunks, height);
  if (last.height <= height) return last;
  const scale = height / last.height;
  const { fits: __, ...wide } = attempt(scene, width / scale, MIN_FONT, hunks, height);
  return {
    ...wide,
    scale,
    room: fitBlock('rows', 'comparison', false, 'shorten the cells, or split the comparison into two scenes'),
  };
}
