import type { MarkupError, Run } from './markup.mjs';

export type Family = 'sans' | 'mono';

export interface Font {
  family: Family;
  weight: number;
  size: number;
  /** px added after every character, as CSS letter-spacing. */
  letterSpacing?: number;
  /** Drawn upper-case, as CSS text-transform. */
  upper?: boolean;
}

/** Where a text goes: its font, its width, how many lines it may take and how small it may get. */
export interface Slot {
  /** What the place is called in a report, e.g. "card title". */
  name: string;
  family: Family;
  /** The heaviest weight the text is drawn at, such as when its step lights it, so it fits then too. */
  weight: number;
  /** Largest size, in px. */
  size: number;
  /** Smallest size it can still be read at, in px. */
  min: number;
  /** Most lines it may wrap to. */
  lines: number;
  /** Line height as a multiple of the size. */
  lineHeight: number;
  /** Width in px, or the width it has on `lines` lines at `size` (a diamond is narrower the more lines it holds). */
  width: number | ((lines: number, size: number) => number);
  letterSpacing?: number;
  upper?: boolean;
  /** Evens out the line lengths, as a label is set, instead of filling each line in turn. */
  balanced?: boolean;
  /** false for text shown exactly as written, such as a path or a test's name. */
  markup?: boolean;
  /** Shrinks to this size on one line before wrapping at all. */
  oneLineMin?: number;
  /** What to do when it does not fit, said to the storyboard's author. */
  fix: string;
  /**
   * "warning" for text the author did not write and cannot shorten, such as a line of code or a file's
   * path: `validate` warns instead of failing when it does not fit.
   */
  severity?: 'warning';
}

/** A text fitted into a slot: exactly the lines a scene draws. */
export interface Fit {
  fit: true;
  path: string;
  text: string;
  slot: string;
  fix: string;
  size: number;
  /** The font it is measured in, at `size`: draw it in exactly this. */
  font: Font;
  lines: Run[][];
  widths: number[];
  /** Widest line, in px. */
  width: number;
  /** All lines, in px. */
  height: number;
  lineHeight: number;
  /** false when the text needs more room than the slot has at its smallest size. */
  fits: boolean;
  min: number;
  markupErrors: MarkupError[];
  /** Share of its characters (0 to 1) drawn bold, as code, marked or in a tone. */
  styled: number;
  severity?: 'warning';
}

export declare const READABLE_PX: number;
export declare const CODE_SCALE: number;
export declare const CODE_PAD: number;
export declare function boldWeight(weight: number): number;
export declare function measure(text: string, font: Font): number;
export declare function runFont(run: Run, font: Font): Font;
export declare function runsWidth(runs: readonly Run[], font: Font): number;
export declare function wrapRuns(
  runs: readonly Run[],
  font: Font,
  width: number,
  options?: { balanced?: boolean; force?: boolean },
): { lines: Run[][]; widths: number[]; ok: boolean };
export declare function slotRuns(text: string, slot: Slot): { runs: Run[]; errors: MarkupError[] };
export declare function fitText(text: string, slot: Slot, path: string): Fit;
/** The same text and slot at one given size, such as one title size shared by every card. */
export declare function fitTextAt(text: string, slot: Slot, path: string, size: number): Fit;
/** Lines that must not wrap, such as code, at the largest size where all of them fit the width and `height`. */
export declare function fitLines(lines: readonly string[], slot: Slot, height: number, path: string): Fit;
/** A whole block that must fit a space, such as a table's rows in the frame, as a report entry. */
export declare function fitBlock(path: string, slot: string, fits: boolean, fix: string): Fit;
