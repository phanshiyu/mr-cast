import { fitBlock, fitText, fitTextAt, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { Box as PenBox, LayoutBoxes } from './penGeometry';
import { rowBadgeRoom } from './marks';
import type { TestCase, TestsScene } from '../types';


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
  name: Fit;
  proves: Fit;
}

export interface PlacedGap extends Box {
  text: Fit;
}

/** The scene's panel titles: its own words, or the defaults. */
export type TestsTitles = Required<NonNullable<TestsScene['titles']>>;
export const DEFAULT_TITLES: TestsTitles = { subject: 'Under test', proves: 'Proves', gaps: 'Not tested', none: 'No tests in this change' };

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
  /** Some text needs more lines than it may take. */
  truncated: boolean;
  /** Total height in layout pixels. */
  height: number;
  /** Below 1 when even the smallest font overflows: the scene draws at `width / scale` and shrinks to fit. */
  scale: number;
  /** Whether the matrix and gaps fit the frame at a readable size. */
  room: Fit;
  titles: { proves: Fit; gaps: Fit; none: Fit; subject: { title: Fit; text: Fit } | null };
}

function attempt(cases: readonly TestCase[], gaps: readonly string[], width: number, font: number, maxLines = 2) {
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
    let rowY = MATRIX_HEADER_H;
    for (const [i, test] of cases.entries()) {
      const name = fitTextAt(test.name, { ...sized(SLOTS.testName, nameW), lines: maxLines }, `cases[${i}].name`, nameFont);
      const proves = fitTextAt(test.proves, { ...sized(SLOTS.testProves, provesW), lines: maxLines }, `cases[${i}].proves`, font);
      truncated ||= !name.fits || !proves.fits;
      const h = Math.max(name.lines.length, proves.lines.length) * lineHeight + 2 * pad;
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
  const wrapped = gaps.map((g, i) => {
    const text = fitTextAt(g, { ...sized(SLOTS.testGap, itemW - GAP_MARKER_W - 2 * pad), lines: maxLines }, `gaps[${i}]`, font);
    truncated ||= !text.fits;
    return text;
  });
  const placedGaps: PlacedGap[] = [];
  let gy = y + GAPS_HEADER_H;
  for (let i = 0; i < wrapped.length; i += cols) {
    const band = wrapped.slice(i, i + cols);
    const h = Math.max(...band.map((t) => t.lines.length)) * lineHeight + 2 * pad;
    band.forEach((text, c) => placedGaps.push({ text, x: GAPS_PAD + c * (itemW + GAP_ITEM_GAP), y: gy, w: itemW, h }));
    gy += h + GAP_ITEM_GAP;
  }
  const gapsH = gaps.length ? gy - GAP_ITEM_GAP - y + GAPS_PAD : GAPS_HEADER_H + lineHeight + GAPS_PAD;
  const gapsPanel = { x: 0, y, w: width, h: gapsH };

  return { font, nameFont, lineHeight, matrix, emptyCard, rows, gapsPanel, gaps: placedGaps, truncated, height: y + gapsH, scale: 1, room: fitBlock('cases', 'tests scene', true, '') };
}

/** Room the "No tests" card's title has beside its icon. */
const EMPTY_TITLE_W = (width: number) => width - 2 * 52 - 112 - 40;

/** The scene's own panel titles and subject, fitted to where they sit. */
function titleFits(scene: TestsScene, layout: Omit<TestsLayout, 'titles'>, width: number): TestsLayout['titles'] {
  const titles: TestsTitles = { ...DEFAULT_TITLES, ...scene.titles };
  const at = (key: keyof TestsTitles) => (scene.titles?.[key] ? `titles.${key}` : '');
  const label = { ...SLOTS.panelTitle, size: 17, weight: 700 };
  return {
    proves: fitText(titles.proves, sized(label, layout.matrix?.provesW ?? width), at('proves')),
    gaps: fitText(titles.gaps, sized(SLOTS.panelTitle, width - 2 * GAPS_PAD - 24 - 12 - 80), at('gaps')),
    none: fitText(titles.none, sized(SLOTS.emptyTitle, EMPTY_TITLE_W(width)), at('none')),
    subject: scene.subject
      ? { title: fitText(titles.subject, sized({ ...SLOTS.panelTitle, size: 16, weight: 700 }, SUBJECT_W), at('subject')), text: fitText(scene.subject, sized(SLOTS.testSubject, SUBJECT_W), 'subject') }
      : null,
  };
}

/** The subject sits at the right end of the header, at most this wide. */
export const SUBJECT_W = 698;

/** Font size of a case's own badges, drawn at its right end. */
export const ROW_BADGE = 13;

/**
 * Places the test matrix and the "Not tested" panel in a box. Picks the largest font at which every text
 * fits its two lines and the whole stack fits the height; failing that, the smallest font with three
 * lines a text; failing that, the smallest font laid out wider and scaled down, so text never runs into
 * the caption band, which `validate` reports.
 */
export function layoutTests(scene: TestsScene, width: number, height: number): TestsLayout {
  const { cases, gaps } = scene;
  const done = (layout: Omit<TestsLayout, 'titles'>): TestsLayout => ({ ...layout, titles: titleFits(scene, layout, layout.matrix?.w ?? width / layout.scale) });
  for (let font = cases.length ? MAX_FONT : MAX_FONT_NO_CASES; font >= MIN_FONT; font--) {
    const result = attempt(cases, gaps, width, font);
    if (result.height <= height && !result.truncated) return done(result);
  }
  // At the smallest font a text may take a third line; a scene that still overflows draws smaller and is reported.
  const last = attempt(cases, gaps, width, MIN_FONT, 3);
  if (last.height <= height) return done(last);
  // A wider layout wraps less, so it is never taller: scaling by the first estimate always fits.
  const scale = height / last.height;
  return done({ ...attempt(cases, gaps, width / scale, MIN_FONT, 3), scale, room: fitBlock('cases', 'tests scene', false, 'split the cases into two tests scenes, or shorten them') });
}

const boxOf = (b: Box) => ({ x: b.x, y: b.y, width: b.w, height: b.h });

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, in layout units: a case's
 * row and a gap's line. A note keeps off the names, what they prove, and the gaps.
 */
export function testsBoxes(layout: TestsLayout): LayoutBoxes {
  const m = layout.matrix;
  const boxes = new Map<string, PenBox>([
    ...layout.rows.map((row, i): [string, PenBox] => [`c:${i}`, boxOf(row)]),
    ...layout.gaps.map((gap, i): [string, PenBox] => [`g:${i}`, boxOf(gap)]),
  ]);
  const obstacles = [
    ...layout.rows.flatMap((row) => (m ? [{ x: m.nameX, y: row.y, width: m.nameW, height: row.h }, { x: m.provesX, y: row.y, width: m.provesW, height: row.h }] : [boxOf(row)])),
    ...layout.gaps.map(boxOf),
  ];
  return { boxes, obstacles };
}
