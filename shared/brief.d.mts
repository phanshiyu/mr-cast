import type { Brief, HunkMap, Storyboard } from '../src/types';

export declare const QUESTIONS: string[];
export declare const GUIDE_HEADING: string;
export declare function missingQuestions(brief: Brief | undefined): string[];
export declare function briefLine(brief: Brief | undefined): string;
export declare function guideMarkdown(
  storyboard: Storyboard,
  hunks: HunkMap,
  meta?: { branch?: string; base?: string },
): string;
