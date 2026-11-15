import type { HunkMap, Scene } from '../src/types';

/** The hunk ids `scene` shows, in the order it shows them; each may repeat, and may name a hunk that does not exist. */
export declare function shownHunkIds(scene: Scene | undefined): readonly unknown[];

/** The ids of diff hunks whose added lines a code scene on a snippet puts on screen. */
export declare function snippetHunkIds(scenes: readonly Scene[], hunks: HunkMap): string[];

/** The changed lines of each hunk that some scene draws, as hunk id to indexes into the hunk's lines. */
export declare function shownHunkLines(
  scenes: readonly Scene[],
  hunks: HunkMap,
  codeLines?: ReadonlyMap<number, readonly number[]>,
): Map<string, Set<number>>;
