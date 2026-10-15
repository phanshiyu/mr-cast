import type { CodeScene, Hunk, LineRef } from '../src/types';

export interface SceneFocusRange {
  side: 'newLine' | 'oldLine';
  range: [number, number];
}

export declare function expandLineRefs(refs?: readonly LineRef[]): Set<number>;
export declare function focusRanges(lines: Iterable<number>): [number, number][];
export declare function sceneFocusRanges(scene: CodeScene): SceneFocusRange[];
export declare function lineFocusRanges(scene: CodeScene, hunk: Hunk): (number | null)[];
export declare function focusStepOrder(scene: CodeScene, hunk: Hunk): number[];
