import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const flow = (n) => ({
  type: 'flow',
  chapter: `Flow ${n}`,
  narration: 'A request passes each service in turn.',
  steps: Array.from({ length: n }, (_, i) => ({ actor: `Actor ${i}`, action: 'checks the request' })),
});
const errorsFor = async (n) => (await validateStoryboard({ title: 'Flows', scenes: [flow(n)] }, {}, { mode: 'explain' })).errors;

test('a flow whose rows are shorter than their actor and action is reported, and one with room passes', async () => {
  assert.deepEqual(await errorsFor(10), []);
  assert.deepEqual(await errorsFor(12), [
    'scenes[0] ("Flow 12").steps: the step list does not fit the screen at the smallest readable size; each step needs 77px and has 67px, so the rows overlap; use fewer steps, or split them across two flow scenes',
  ]);
  assert.deepEqual(await errorsFor(30), [
    'scenes[0] ("Flow 30").steps: the step list does not fit the screen at the smallest readable size; each step needs 77px and has 26px, so the rows overlap; use fewer steps, or split them across two flow scenes',
  ]);
});
