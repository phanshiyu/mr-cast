import { READ_FIRST_MAX, flagText, type ReadingEntry, type ReadingOrder } from '../../shared/reading.mjs';
import { fitBlock, fitTextAt, measure, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';

const MAX_FONT = 30;
const LINE_HEIGHT = 1.3;
export const NUMBER_W = 52;
export const ROW_PAD_X = 22;
export const COL_GAP = 28;
const ROW_GAP = 12;
/** "Read first" above the rows, and the line that counts the rest below them. */
export const HEAD_H = 40;
export const MORE_H = 44;
/** The file:line column never takes more than this share of the row, so the check keeps its room. */
const WHERE_SHARE = 0.42;

export interface PlacedItem {
  item: ReadingEntry;
  y: number;
  h: number;
  where: Fit;
  explained: Fit | null;
  check: Fit;
  flag: Fit | null;
}

export interface ReadingLayout {
  rows: PlacedItem[];
  lineHeight: number;
  whereX: number;
  whereW: number;
  checkX: number;
  checkW: number;
  /** Items in the order but not on screen: the routine ones and any past READ_FIRST_MAX. */
  more: number;
  height: number;
  room: Fit;
}

/** `index` is each item's place in the scene's `items`, which a report names it by. */
function attempt(shown: readonly ReadingEntry[], index: (item: ReadingEntry) => number, width: number, font: number): Omit<ReadingLayout, 'more' | 'room'> {
  const lineHeight = Math.round(font * LINE_HEIGHT);
  const whereFont = Math.round(font * 0.8);
  const noteFont = Math.round(font * 0.62);
  const flagFont = Math.round(font * 0.76);
  const pad = Math.round(font * 0.5);
  const whereX = ROW_PAD_X + NUMBER_W + COL_GAP;
  const widest = Math.max(0, ...shown.map((i) => measure(i.where, { family: 'mono', weight: SLOTS.findingWhere.weight, size: whereFont })));
  const whereW = Math.ceil(Math.min(widest, (width - whereX) * WHERE_SHARE));
  const checkX = whereX + whereW + COL_GAP;
  const checkW = width - checkX - ROW_PAD_X;
  let y = HEAD_H;
  const rows = shown.map((item) => {
    const k = `items[${index(item)}]`;
    const where = fitTextAt(item.where, sized(SLOTS.findingWhere, whereW), `${k}.hunkId`, whereFont);
    const explained = item.explainedIn ? fitTextAt(`Explained in: ${item.explainedIn}`, sized(SLOTS.readingNote, whereW), `${k}.hunkId`, noteFont) : null;
    const check = fitTextAt(item.check, sized(SLOTS.readingCheck, checkW), `${k}.check`, font);
    const flag = item.finding ? fitTextAt(flagText(item.finding), sized(SLOTS.readingFlag, checkW), `${k}.flag`, flagFont) : null;
    const left = where.lineHeight + (explained ? explained.lineHeight + 4 : 0);
    const right = Math.max(1, check.lines.length) * lineHeight + (flag ? 6 + flag.lines.length * flag.lineHeight : 0);
    const h = Math.max(left, right) + 2 * pad;
    const row = { item, y, h, where, explained, check, flag };
    y += h + ROW_GAP;
    return row;
  });
  return { rows, lineHeight, whereX, whereW, checkX, checkW, height: Math.max(HEAD_H, y - ROW_GAP) };
}

/**
 * The reading scene's rows: the first READ_FIRST_MAX items to read, each with its number, file:line, the chapter
 * that explains it, the check and the finding it carries. Picks the largest font at which every text fits and the
 * rows, with the "+N" line, fit the height; one that does not fit at the smallest is reported, so `validate` fails.
 */
export function layoutReading(order: ReadingOrder, items: readonly { hunkId: string }[], width: number, height: number): ReadingLayout {
  const shown = order.readFirst.slice(0, READ_FIRST_MAX);
  const more = order.items.length - shown.length;
  const room = height - (more ? MORE_H : 0);
  const index = (item: ReadingEntry) => items.findIndex((i) => i.hunkId === item.hunkId);
  const fits = (l: Omit<ReadingLayout, 'more' | 'room'>) => l.height <= room && l.rows.every((r) => r.check.fits && (r.flag?.fits ?? true) && (r.explained?.fits ?? true));
  let last = attempt(shown, index, width, SLOTS.readingCheck.min);
  for (let font = MAX_FONT; font >= SLOTS.readingCheck.min; font--) {
    last = attempt(shown, index, width, font);
    if (fits(last)) return { ...last, more, room: fitBlock('items', 'reading scene', true, '') };
  }
  return { ...last, more, room: fitBlock('items', 'reading scene', last.height <= room, 'shorten the checks, or mark more items "routine": true') };
}
