import type { CompareRow, CompareScene, HunkMap } from '../src/types';

/** A compare scene's two side titles, "Before" and "After" unless it names its own. */
export declare function compareTitles(scene: Pick<CompareScene, 'sides'>): [string, string];
/** Whether a row reads the same on both sides: its own `same`, or else whether its two cells are equal. */
export declare function compareRowSame(row: CompareRow): boolean;
/** Whether a cell takes its code from a hunk: `{ hunk, side, lines }`. */
export declare function isHunkCell(
  cell: unknown,
): cell is { hunk: string; side: 'old' | 'new'; lines: string | number };
/** The most lines a code cell read from a hunk shows before it stops reading well. */
export declare const HUNK_LINES_MAX: number;
/** A line range written as 5 or "4-6", as [first, last], or null. */
export declare function lineRange(value: unknown): [number, number] | null;
/** The code a hunk cell shows, or the reason it names nothing. */
export declare function resolveHunkCell(
  cell: { hunk: string; side: unknown; lines: unknown },
  hunks: HunkMap,
): { code: string; lang: string; caption: string; count: number; error?: undefined } | { error: string };
/** The indexes into `hunk.lines` of the lines a hunk cell reads; empty for a bad side or range. */
export declare function hunkCellRows(cell: unknown, hunk: unknown): number[];
