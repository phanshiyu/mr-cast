import type { Change, Marks } from '../types';

/** The one set of words for what a diff does to something. Every badge and legend says these. */
export const CHANGE_WORD: Record<Change, string> = { added: 'new', modified: 'changed', removed: 'removed' };

/** The words of an item's badges, change first, so a layout can size them before they are drawn. */
export const badgeWords = (item: Marks): string[] => [...(item.change ? [CHANGE_WORD[item.change]] : []), ...(item.badge ? [item.badge] : [])];

/** Width a run of uppercase badges at `size` takes, gaps included, estimated from character counts. */
export const badgesWidth = (words: readonly string[], size: number) =>
  words.reduce((sum, word, i) => sum + (i ? 6 : 0) + Math.ceil(word.length * (size * 0.76 + 1) + 2 * Math.floor(size * 0.75) + 2), 0);

/** Room to keep free at the right end of rows for their own badges: the widest run plus a gap. */
export const rowBadgeRoom = (rows: readonly Marks[], size: number) => Math.max(0, ...rows.map((r) => (r.badge ? badgesWidth([r.badge], size) + 24 : 0)));
