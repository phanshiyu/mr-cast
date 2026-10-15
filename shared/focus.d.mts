import type { LineRef } from '../src/types';

export declare function expandLineRefs(refs?: readonly LineRef[]): Set<number>;
export declare function focusRanges(lines: Iterable<number>): [number, number][];
