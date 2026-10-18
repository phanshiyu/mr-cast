// Checks shared by the quicksort, binary search and merge sort generators: the states a viewer sees, read back with
// the same walk the renderer uses, and every comparison a callout states.
import assert from 'node:assert/strict';
import { walkStates } from '../../shared/state-steps.mjs';

export { walkStates };

/** Callout text without markup: `[5]{accent}` becomes `5`, and `**` goes. */
export const plain = (t) => t.replace(/\[([^\]]*)\]\{\w+\}/g, '$1').replace(/\*\*/g, '');

/** The n cell values of array `name` (or of the scene's only array) in one state. */
export const row = (state, name, n) =>
  Array.from({ length: n }, (_, k) => state.values[name ? `c:${name}/${k}` : `c:${k}`]);

/** The sequence with runs of equal neighbours collapsed to one. */
export const distinct = (seq) => seq.filter((v, k) => k === 0 || JSON.stringify(v) !== JSON.stringify(seq[k - 1]));

/** Every "a < b", "a > b", "a = b" in a callout holds, and "a < b? yes/no" answers right. The midpoint formula adds up and matches the pointer. */
export function checkCallouts(scene, label) {
  walkStates(scene).states.forEach((state, k) => {
    const text = plain(state.callout ?? '');
    for (const m of text.matchAll(/(?<![+−×-] )(\d+) ([<>=]) (\d+)(\?\s*(yes|no))?/g)) {
      const [a, op, b] = [Number(m[1]), m[2], Number(m[3])];
      const truth = op === '<' ? a < b : op === '>' ? a > b : a === b;
      assert.ok(m[4] ? truth === (m[5] === 'yes') : truth, `${label} state ${k}: "${text}" is wrong`);
    }
    const f = text.match(/mid = (\d+) \+ ⌊\((\d+) − (\d+)\) \/ 2⌋ = (\d+)/);
    if (f) {
      const [L, R, L2, mid] = f.slice(1).map(Number);
      assert.ok(
        L === L2 && mid === L + Math.floor((R - L) / 2),
        `${label} state ${k}: formula "${text}" does not add up`,
      );
      assert.ok(
        state.places['ptr:L']?.[0] === L && state.places['ptr:R']?.[0] === R,
        `${label} state ${k}: L and R are not where the formula says`,
      );
      if (!state.hidden['ptr:mid'] && state.places['ptr:mid'])
        assert.ok(
          state.places['ptr:mid'][0] === mid,
          `${label} state ${k}: mid pointer at ${state.places['ptr:mid'][0]}, formula says ${mid}`,
        );
    }
  });
}
