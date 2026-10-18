import type { Finding, HunkMap, Hunk, Plan, Storyboard } from '../src/types';

export declare const READ_FIRST_MAX: number;
export declare const CHECK_MAX: number;
export declare const READING_HEADING: string;

export interface ReadingEntry {
  hunkId: string;
  /** "src/limiter.ts:12-30". */
  where: string;
  /** The lines of routine hunks of the same file that ride on this item, such as "1-6", so the file is never also on a skim line. */
  also: string[];
  check: string;
  routine: boolean;
  /** 1-based in `readFirst`, the items to read grouped by topic; null for a routine one. */
  number: number | null;
  finding: Finding | null;
  /** The scene that cites the hunk in `from` with the fewest hunks: its chapter, and its index to seek to. */
  explainedIn: { chapter: string; scene: number } | null;
  /** The topic id of the scene that explains it, which groups the items, or null. */
  topicId: string | null;
  /** The plan's title for that topic, or null. */
  topic: string | null;
}

export interface ReadingGroup {
  /** A plan topic's title; null when no item has a topic. */
  title: string | null;
  items: ReadingEntry[];
}

export interface ReadingOrder {
  items: ReadingEntry[];
  /** The items to read, grouped by topic, in their numbered order. */
  readFirst: ReadingEntry[];
  /** The items to read by topic: each topic once, in the order the reading order first reaches it. */
  groups: ReadingGroup[];
  /** The routine items not riding on an item of their file, one group per topic. */
  skim: ReadingGroup[];
}

export declare function hunkSpan(hunk: Hunk): {
  file: string;
  side: 'newLine' | 'oldLine';
  range: [number, number] | null;
};
export declare function alsoText(item: ReadingEntry): string;
export declare function readingOrder(storyboard: Storyboard, hunks: HunkMap, plan?: Plan | null): ReadingOrder | null;
export declare function flagText(finding: Finding, line?: (text: string) => string): string;
export declare function readingChecklist(order: ReadingOrder): string;
export declare function readingMarkdown(
  storyboard: Storyboard,
  order: ReadingOrder,
  run?: { branch?: string; base?: string },
): string;
export declare function readingLines(order: ReadingOrder): string[];
