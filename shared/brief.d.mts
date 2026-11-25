import type { Brief, HunkMap, Storyboard } from '../src/types';

export declare const QUESTIONS: string[];
export declare const GUIDE_HEADING: string;
export interface ReadDecision {
  text: string;
  source: string;
  kind: 'stated' | 'code' | 'mine';
  cite: string[];
}
export declare function decisionLead(d: ReadDecision): string;
export declare function decisionsOf(approach: unknown): ReadDecision[];
export declare function missingQuestions(brief: Brief | undefined): string[];
export declare function briefLine(brief: Brief | undefined): string;
export declare function guideMarkdown(
  storyboard: Storyboard,
  hunks: HunkMap,
  meta?: { branch?: string; base?: string },
): string;
export interface CoreOnScreen {
  name: string;
  shown: number;
  total: number;
}
export declare function coreOnScreen(
  brief: Brief | undefined,
  hunks: HunkMap,
  lines: ReadonlyMap<string, ReadonlySet<number>>,
): CoreOnScreen[];
export declare function coreOnScreenLine(core: readonly CoreOnScreen[] | undefined): string;
export declare function runsOf(scenes: unknown[]): { type: string; from: number; length: number }[];
export declare function mixLine(scenes: unknown): string | null;
