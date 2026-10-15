import type { CodeStep, FocusStep, Hunk, HunkMap, PenMark, Scene } from '../src/types';

export declare const PEN_MARKS: readonly PenMark[];
/** Longest note, in characters: it is written on one line beside the mark. */
export declare const NOTE_MAX: number;
/** Item keys a focus step's mark draws on: everything its first ref names. */
export declare function markedKeys(scene: Scene, step: FocusStep, hunks?: HunkMap): string[];
/** Every place a code step's `token` occurs in its lines, as a hunk line index and a character offset. */
export declare function tokenHits(hunk: Hunk, step: CodeStep): { line: number; at: number }[];
