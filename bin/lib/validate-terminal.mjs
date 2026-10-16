// Checks for the terminal scene, mirroring src/types.ts. Pushes human/LLM-readable strings onto `errors`
// and `warnings`, like the checks in validate.mjs.

import { outputLines } from '../../shared/terminal.mjs';

/** Past this many entries a session is two stories; the camera can scroll it, but the viewer loses the thread. */
const ENTRIES_MAX = 12;
/** Past this many output lines in one entry, trim the log to the lines the narration names. */
const OUTPUT_LINES_MAX = 30;
/** Without steps the whole session plays during the narration; past this many entries it races. */
const UNSTEPPED_MAX = 3;

export function checkTerminal(s, p, errors, warnings) {
  for (const k of ['title', 'window']) if (s[k] !== undefined && typeof s[k] !== 'string') errors.push(`${p}.${k}: must be a string`);
  if (!Array.isArray(s.entries) || s.entries.length === 0) return errors.push(`${p}.entries: required non-empty array of { command?, output?, prompt?, exit? }`);
  s.entries.forEach((entry, j) => {
    const q = `${p}.entries[${j}]`;
    if (!entry || typeof entry !== 'object') return errors.push(`${q}: must be an object { command?, output?, prompt?, exit? }`);
    if (entry.command === undefined && entry.output === undefined) errors.push(`${q}: give a command, an output, or both`);
    if (entry.command !== undefined) {
      if (typeof entry.command !== 'string' || !entry.command.trim()) errors.push(`${q}.command: must be a non-empty string`);
      else if (entry.command.includes('\n')) errors.push(`${q}.command: one line; put each command in its own entry`);
    }
    if (entry.output !== undefined && typeof entry.output !== 'string') errors.push(`${q}.output: must be a string, lines separated by "\\n"`);
    if (entry.prompt !== undefined && typeof entry.prompt !== 'string') errors.push(`${q}.prompt: must be a string, e.g. "$" or "app=#"`);
    if (entry.exit !== undefined && !Number.isInteger(entry.exit)) errors.push(`${q}.exit: must be a whole number, 0 for success`);
    const lines = outputLines(entry).length;
    if (lines > OUTPUT_LINES_MAX) warnings.push(`${q}.output: ${lines} lines; keep the lines the narration names and cut the rest, e.g. with "..."`);
  });
  if (s.steps === undefined && s.entries.length > UNSTEPPED_MAX) warnings.push(`${p}.steps: ${s.entries.length} entries play in one go during the narration; walk them in steps, one or two entries a step, so each command holds while it is explained`);
  if (s.entries.length > ENTRIES_MAX) warnings.push(`${p}.entries: ${s.entries.length} entries; more than ${ENTRIES_MAX} lose the thread, so split the session into two scenes`);
}
