// Checks pen marks: a step's `mark`, its `note`, and a code step's `token`. What a mark draws on lives in
// shared/pen-marks.mjs, which the scenes use to draw it.

import { NOTE_MAX, PEN_MARKS, tokenHits } from '../../shared/pen-marks.mjs';
import { FOCUS_TYPES } from '../../shared/targets.mjs';
import { didYouMean } from './suggest.mjs';
import { aType } from '../../shared/words.mjs';

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

export function checkPenMarks(s, p, hunks, errors, warnings) {
  if (!Array.isArray(s.steps)) return;
  const code = s.type === 'code';
  const hunk = code && typeof s.hunkId === 'string' && Object.hasOwn(hunks, s.hunkId) ? hunks[s.hunkId] : undefined;
  s.steps.forEach((step, i) => {
    if (!step || typeof step !== 'object') return;
    const q = `${p}.steps[${i}]`;
    // A flagged step draws its finding's mark, a circle unless it names another.
    if (step.mark === undefined && (step.flag === undefined || !code)) {
      if (step.note !== undefined) errors.push(`${q}.note: needs a mark to sit beside; add "mark": "arrow" to point the note at the step's focus`);
      if (step.token !== undefined) errors.push(`${q}.token: needs a mark to draw on it, such as "mark": "circle"`);
      return;
    }
    if (!code && !FOCUS_TYPES.includes(s.type)) return errors.push(`${q}.mark: ${aType(s.type)} step has no focus to draw on; marks go on code steps and on diagram steps with a focus`);
    if (step.mark !== undefined && !PEN_MARKS.includes(step.mark)) errors.push(`${q}.mark: must be one of ${PEN_MARKS.join(', ')}${typeof step.mark === 'string' ? didYouMean(step.mark, PEN_MARKS) : ''}`);
    if (step.note !== undefined) {
      if (!isStr(step.note)) errors.push(`${q}.note: must be a non-empty string`);
      else if (step.note.trim().length > NOTE_MAX) errors.push(`${q}.note: ${step.note.trim().length} characters; a note is written on one line, so keep it to ${NOTE_MAX}`);
    }
    if (step.token === undefined) return;
    if (!code) return errors.push(`${q}.token: only code steps take a token; ${aType(s.type)} step marks its first focus ref`);
    if (!isStr(step.token)) return errors.push(`${q}.token: must be a non-empty string, text on the step's lines such as "max: 20"`);
    if (!hunk) return;
    const hits = tokenHits(hunk, step).length;
    const lines = step.lines === undefined ? `old lines ${step.oldLines}` : `lines ${step.lines}`;
    if (hits === 0) errors.push(`${q}.token: ${JSON.stringify(step.token)} is not on ${lines}; copy it exactly from the code, spaces included`);
    else if (hits > 1) errors.push(`${q}.token: ${JSON.stringify(step.token)} occurs ${hits} times on ${lines}; lengthen it until it names one place`);
  });
}
