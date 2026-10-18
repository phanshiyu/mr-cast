// Checks for the tests scene's matrix, mirroring TestsScene in src/types.ts. A storyboard written before 0.27, with
// `cases` and `gaps`, reaches here already read as a matrix (shared/tests.mjs upgradeTests).

import { isGapRow, isLive } from '../../shared/tests.mjs';
import { didYouMean } from './suggest.mjs';

const TEST_STATUSES = ['added', 'modified', 'removed', 'existing'];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** The situation and outcome a check names, or what is wrong with it. */
function readCheck(ref, situations, outcomes) {
  const ids = [...new Set(situations.map((s) => s?.id).filter(isStr))];
  const id = ids.filter((i) => ref.startsWith(`${i}.`)).sort((a, b) => b.length - a.length)[0];
  if (!id)
    return {
      error: `names no situation; a check is "situation.Outcome", with a situation id of ${ids.map((i) => JSON.stringify(i)).join(', ') || '(none)'}${didYouMean(ref.split('.')[0], ids)}`,
    };
  const outcome = ref.slice(id.length + 1);
  if (!outcomes.includes(outcome))
    return {
      error: `names no outcome "${outcome}"; outcomes are ${outcomes.map((o) => JSON.stringify(o)).join(', ') || '(none)'}${didYouMean(outcome, outcomes)}`,
    };
  return { situation: situations.find((s) => s?.id === id), outcome };
}

export function checkTests(s, p, hunks, errors, warnings) {
  for (const k of ['title', 'subject', 'when'])
    if (s[k] !== undefined && typeof s[k] !== 'string') errors.push(`${p}.${k}: must be a string`);

  const outcomes = [];
  if (!Array.isArray(s.outcomes))
    errors.push(`${p}.outcomes: required array of the outcomes the code promises, e.g. ["Result", "Calls"]`);
  else
    s.outcomes.forEach((o, j) => {
      if (!isStr(o)) errors.push(`${p}.outcomes[${j}]: must be a non-empty string`);
      else if (outcomes.includes(o)) errors.push(`${p}.outcomes[${j}]: duplicate outcome "${o}"`);
      else outcomes.push(o);
    });

  const situations = [];
  if (!Array.isArray(s.situations)) errors.push(`${p}.situations: required array of { id, when, expect?, gap? }`);
  else {
    const ids = new Set();
    s.situations.forEach((sit, j) => {
      const q = `${p}.situations[${j}]`;
      if (!isObject(sit)) return errors.push(`${q}: must be an object`);
      if (!isStr(sit.id)) errors.push(`${q}.id: required string`);
      else if (ids.has(sit.id)) errors.push(`${q}.id: duplicate id "${sit.id}"`);
      else ids.add(sit.id);
      if (typeof sit.when !== 'string') errors.push(`${q}.when: required string, the situation in plain words`);
      if (sit.expect !== undefined) {
        if (!isObject(sit.expect))
          errors.push(`${q}.expect: must be an object of outcome to promised value, e.g. { "Calls": "3" }`);
        else
          for (const [outcome, value] of Object.entries(sit.expect)) {
            if (!outcomes.includes(outcome))
              errors.push(
                `${q}.expect: "${outcome}" is no outcome; outcomes are ${outcomes.map((o) => JSON.stringify(o)).join(', ') || '(none)'}${didYouMean(outcome, outcomes)}`,
              );
            else if (typeof value !== 'string')
              errors.push(`${q}.expect.${outcome}: must be a string, the promised value`);
          }
      }
      if (sit.gap !== undefined && typeof sit.gap !== 'string')
        errors.push(`${q}.gap: must be a string, what goes wrong when nothing tries this`);
      else if (isStr(sit.gap) && !isGapRow(sit))
        warnings.push(
          `${q}.gap: is not drawn, since the situation has promises in expect; drop expect to draw the row as a gap, or drop gap`,
        );
      situations.push(sit);
    });
  }

  if (!Array.isArray(s.tests))
    return errors.push(`${p}.tests: required array of { name, checks } (use [] when nothing tests it)`);
  s.tests.forEach((t, j) => {
    const q = `${p}.tests[${j}]`;
    if (!isObject(t)) return errors.push(`${q}: must be an object`);
    if (!isStr(t.name)) errors.push(`${q}.name: required string, the test's name as written in code`);
    if (t.status !== undefined && !TEST_STATUSES.includes(t.status))
      errors.push(`${q}.status: must be one of ${TEST_STATUSES.join(', ')}`);
    if (t.hunkId !== undefined && !(isStr(t.hunkId) && hunks && Object.hasOwn(hunks, t.hunkId)))
      errors.push(`${q}.hunkId: "${t.hunkId}" not found in hunks.json`);
    if (t.was !== undefined && typeof t.was !== 'string')
      errors.push(`${q}.was: must be a string, what its cells held before the diff`);
    if (!Array.isArray(t.checks))
      return errors.push(
        `${q}.checks: required array of the cells it asserts, each "situation.Outcome" (may be empty)`,
      );
    t.checks.forEach((ref, k) => {
      const c = `${q}.checks[${k}]`;
      if (typeof ref !== 'string') return errors.push(`${c}: must be a string "situation.Outcome"`);
      const read = readCheck(ref, situations, outcomes);
      if (read.error) return errors.push(`${c}: "${ref}" ${read.error}`);
      const promised = isObject(read.situation.expect) && typeof read.situation.expect[read.outcome] === 'string';
      if (!promised && isLive(t))
        warnings.push(
          `${c}: "${ref}" is a cell with no expect value, so it draws a tick with nothing beside it; add "${read.outcome}" to situation "${read.situation.id}"'s expect`,
        );
    });
  });
}
