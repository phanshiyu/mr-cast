import type { Finding, HunkMap, Hunk, Plan, ReadingScene, Storyboard } from '../src/types';

export declare const READ_FIRST_MAX: number;
export declare const CHECK_MAX: number;
export declare const READING_HEADING: string;
export declare const FLAG_WORDS: Record<Finding['severity'], string>;

export interface ReadingEntry {
  hunkId: string;
  /** "src/limiter.ts:12-30". */
  where: string;
  check: string;
  routine: boolean;
  /** 1-based among the non-routine items; null for a routine one. */
  number: number | null;
  finding: Finding | null;
  /** The scene that cites the hunk in `from` with the fewest hunks: its chapter, and its index to seek to. */
  explainedIn: { chapter: string; scene: number } | null;
  /** The plan topic of the scene that explains it, or null. */
  topic: string | null;
}

export interface ReadingGroup {
  /** A plan topic's title; null when no item has a topic. */
  title: string | null;
  items: ReadingEntry[];
}

export interface ReadingOrder {
  items: ReadingEntry[];
  readFirst: ReadingEntry[];
  /** The items to read, in runs by topic. */
  groups: ReadingGroup[];
  /** The routine items, one group per topic. */
  skim: ReadingGroup[];
}

export declare function readingScene(storyboard: Storyboard): ReadingScene | undefined;
export declare function hunkLocation(hunk: Hunk): string;
export declare function readingOrder(storyboard: Storyboard, hunks: HunkMap, plan?: Plan | null): ReadingOrder | null;
export declare function flagText(finding: Finding, line?: (text: string) => string): string;
export declare function readingChecklist(order: ReadingOrder): string;
export declare function readingMarkdown(storyboard: Storyboard, order: ReadingOrder, run?: { branch?: string; base?: string }): string;
export declare function readingLines(order: ReadingOrder): string[];
