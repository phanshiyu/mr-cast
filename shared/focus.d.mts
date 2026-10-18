import type { CodeScene, CodeStep, Hunk, LineRef } from '../src/types';

export interface SceneFocusRange {
  side: 'newLine' | 'oldLine';
  range: [number, number];
}

export declare function expandLineRefs(refs?: readonly LineRef[]): Set<number>;
export declare function focusRanges(refs?: readonly LineRef[]): [number, number][];
export declare function sceneFocusRanges(scene: CodeScene): SceneFocusRange[];
export declare function lineFocusRanges(scene: CodeScene, hunk: Hunk): (number | null)[];
export declare function focusStepOrder(scene: CodeScene, hunk: Hunk): number[];
/** Indexes into `hunk.lines` of the lines a code step highlights. */
export declare function stepLines(hunk: Hunk, step: CodeStep): number[];
/** A code step's one range on its side; a malformed ref yields a range no line falls in. */
export declare function stepRange(step: CodeStep): SceneFocusRange;
