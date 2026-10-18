import type { Tone } from '../src/types';

/** A piece of text in one style. Bold and code may sit inside a mark or a tone. */
export interface Run {
  text: string;
  bold?: boolean;
  code?: boolean;
  mark?: boolean;
  tone?: Tone;
}

/** A problem in a text's markup, at its 1-based column. */
export interface MarkupError {
  at: number;
  message: string;
}

/** Splits text into styled runs; malformed markup stays literal and is reported in `errors`. */
export declare function parseMarkup(src: string): { runs: Run[]; errors: MarkupError[] };
/** The text without its markup, as a voice reads it. */
export declare function plainText(src: string): string;
/** Whether the text has any markup in it. */
export declare function hasMarkup(src: string): boolean;
/** Share of the characters (0 to 1) that are bold, code, marked or toned. */
export declare function styledShare(src: string): number;
