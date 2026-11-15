import type { HunkMap } from '../src/types';

/** The test names on the added lines of a hunk's lines. */
export declare function testNames(lines: readonly { type: string; text: string }[] | undefined): string[];
/** The group names (`describe`, `context`, `suite`, `class Test…`) on the added lines of a hunk's lines; none of them is a test. */
export declare function groupNames(lines: readonly { type: string; text: string }[] | undefined): string[];
/** Every test name the changed test files of `hunks` add, in hunk order. */
export declare function addedTestNames(hunks: HunkMap | undefined): string[];
/** The added test names a change map lists; empty without a map. */
export declare function mapTestNames(map: unknown): string[];
