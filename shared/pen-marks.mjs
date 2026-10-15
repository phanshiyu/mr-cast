// Pen marks, shared by the scenes (which draw them) and `validate` (which checks them). A step's `mark`
// draws on what its first focus ref names, or on a code step's lines, or on its `token` among them.

import { stepLines } from './focus.mjs';
import { focusRefs, resolveRef } from './targets.mjs';

export const PEN_MARKS = ['circle', 'underline', 'box', 'arrow', 'strike', 'cross'];
/** Longest note, in characters: it is written on one line beside the mark. */
export const NOTE_MAX = 40;

/** Item keys a focus step's mark draws on: everything its first ref names. */
export function markedKeys(scene, step, hunks) {
  const first = focusRefs(step?.focus)[0];
  return first === undefined ? [] : (resolveRef(scene, first, hunks) ?? []);
}

/** Every place a code step's `token` occurs in its lines, as a hunk line index and a character offset. */
export function tokenHits(hunk, step) {
  const token = step?.token;
  if (typeof token !== 'string' || token === '') return [];
  return stepLines(hunk, step).flatMap((line) => {
    const text = hunk.lines[line].text;
    const hits = [];
    for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + 1)) hits.push({ line, at });
    return hits;
  });
}
