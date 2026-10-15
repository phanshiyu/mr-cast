import { rowBadgeRoom } from './marks';
import type { TestCase } from '../types';
import { wrapLabel } from './wrapLabel';

/** Average advance per em, rounded up so estimated line lengths never overflow. */
const MONO_ADVANCE = 0.61;
const SANS_ADVANCE = 0.49;

const MAX_FONT = 25;
/** With no matrix on screen the gaps are the whole story, so they may run larger. */
const MAX_FONT_NO_CASES = 29;
const MIN_FONT = 15;
const LINE_HEIGHT = 1.3;

export const MATRIX_HEADER_H = 40;
export const CHECK_W = 44;
export const STATUS_W = 138;
export const COL_GAP = 22;
export const ROW_PAD_X = 18;
const ROW_GAP = 6;
const SECTION_GAP = 24;
export const GAPS_HEADER_H = 52;
export const GAPS_PAD = 20;
const GAP_ITEM_GAP = 10;
export const GAP_MARKER_W = 34;
/** The "No tests in this change" card that replaces the matrix when a scene has no cases. */
export const EMPTY_CARD_H = 196;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedCase extends Box {
  test: TestCase;
  name: string[];
  proves: string[];
}

export interface PlacedGap extends Box {
  lines: string[];
}

export interface TestsLayout {
  /** Body text size; the test name renders slightly smaller in mono. */
  font: number;
  nameFont: number;
  lineHeight: number;
  /** Absent when the scene has no cases: the empty card takes the matrix's place. */
  matrix: (Box & { nameX: number; nameW: number; provesX: number; provesW: number }) | null;
  emptyCard: Box | null;
  rows: PlacedCase[];
  gapsPanel: Box;
  gaps: PlacedGap[];
  /** Some text still needed a third line at the smallest font and was cut. */
  truncated: boolean;
  /** Total height in layout pixels. */
  height: number;
  /** Below 1 when even the smallest font overflows: the scene draws at `width / scale` and shrinks to fit. */
  scale: number;
}

const cut = (original: string, lines: string[]) => lines[lines.length - 1]!.endsWith('…') && !original.trim().endsWith('…');

function attempt(cases: readonly TestCase[], gaps: readonly string[], width: number, font: number) {
  const lineHeight = Math.round(font * LINE_HEIGHT);
  const nameFont = Math.round(font * 0.92);
  const pad = Math.round(font * 0.45);
  let truncated = false;
  let y = 0;

  let matrix: TestsLayout['matrix'] = null;
  let emptyCard: Box | null = null;
  const rows: PlacedCase[] = [];
  if (cases.length) {
    const textW = width - CHECK_W - STATUS_W - 2 * ROW_PAD_X - 3 * COL_GAP - rowBadgeRoom(cases, ROW_BADGE);
    const nameW = Math.round(textW * 0.42);
    const provesW = textW - nameW;
    const nameX = ROW_PAD_X + CHECK_W + COL_GAP + STATUS_W + COL_GAP;
    const provesX = nameX + nameW + COL_GAP;
    const nameChars = Math.floor(nameW / (nameFont * MONO_ADVANCE));
    const provesChars = Math.floor(provesW / (font * SANS_ADVANCE));
    let rowY = MATRIX_HEADER_H;
    for (const test of cases) {
      const name = wrapLabel(test.name, nameChars);
      const proves = wrapLabel(test.proves, provesChars);
      truncated ||= cut(test.name, name) || cut(test.proves, proves);
      const h = Math.max(name.length, proves.length) * lineHeight + 2 * pad;
      rows.push({ test, name, proves, x: 0, y: rowY, w: width, h });
      rowY += h + ROW_GAP;
    }
    const h = rowY - ROW_GAP + 6;
    matrix = { x: 0, y, w: width, h, nameX, nameW, provesX, provesW };
    y += h;
  } else {
    emptyCard = { x: 0, y, w: width, h: EMPTY_CARD_H };
    y += EMPTY_CARD_H;
  }
  y += SECTION_GAP;

  // Gaps sit in two columns once there are enough of them to fill a row.
  const cols = gaps.length >= 2 ? 2 : 1;
  const itemW = (width - 2 * GAPS_PAD - (cols - 1) * GAP_ITEM_GAP) / cols;
  const gapChars = Math.floor((itemW - GAP_MARKER_W - 2 * pad) / (font * SANS_ADVANCE));
  const wrapped = gaps.map((g) => {
    const lines = wrapLabel(g, gapChars);
    truncated ||= cut(g, lines);
    return lines;
  });
  const placedGaps: PlacedGap[] = [];
  let gy = y + GAPS_HEADER_H;
  for (let i = 0; i < wrapped.length; i += cols) {
    const band = wrapped.slice(i, i + cols);
    const h = Math.max(...band.map((l) => l.length)) * lineHeight + 2 * pad;
    band.forEach((lines, c) => placedGaps.push({ lines, x: GAPS_PAD + c * (itemW + GAP_ITEM_GAP), y: gy, w: itemW, h }));
    gy += h + GAP_ITEM_GAP;
  }
  const gapsH = gaps.length ? gy - GAP_ITEM_GAP - y + GAPS_PAD : GAPS_HEADER_H + lineHeight + GAPS_PAD;
  const gapsPanel = { x: 0, y, w: width, h: gapsH };

  return { font, nameFont, lineHeight, matrix, emptyCard, rows, gapsPanel, gaps: placedGaps, truncated, height: y + gapsH, scale: 1 };
}

/**
 * Places the test matrix and the "Not tested" panel in a box, from character counts so stills stay
 * deterministic. Picks the largest font at which every line fits on two lines and the whole stack
 * fits the height; failing that, the largest that fits the height; failing that, the smallest font
 * laid out wider and scaled down, so text never runs into the caption band.
 */
/** Font size of a case's own badges, drawn at its right end. */
export const ROW_BADGE = 13;

export function layoutTests(cases: readonly TestCase[], gaps: readonly string[], width: number, height: number): TestsLayout {
  let fallback: TestsLayout | null = null;
  for (let font = cases.length ? MAX_FONT : MAX_FONT_NO_CASES; font >= MIN_FONT; font--) {
    const result = attempt(cases, gaps, width, font);
    if (result.height > height) continue;
    if (!result.truncated) return result;
    fallback ??= result;
  }
  if (fallback) return fallback;
  // A wider layout wraps less, so it is never taller: scaling by the first estimate always fits.
  const scale = height / attempt(cases, gaps, width, MIN_FONT).height;
  return { ...attempt(cases, gaps, width / scale, MIN_FONT), scale };
}
