import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const lines = (n) => Array.from({ length: n }, (_, i) => ({ type: 'add', oldLine: null, newLine: i + 1, text: `  step${i}();` }));
const hunk = (id, file, n) => ({
  id, file, oldFile: null, status: 'added', language: 'javascript', header: '', startLine: 1, oldStartLine: 0, endLine: n,
  additions: n, deletions: 0, beforeCode: '', afterCode: '', lines: lines(n),
});
// A 20-line change to the worker, and a 3-line config tweak.
const hunks = { h1: hunk('h1', 'src/worker.js', 20), h2: hunk('h2', 'src/config.js', 3) };
const intent = { type: 'intent', summary: 'Retries failed deliveries.', bullets: ['Stuck deliveries', 'No shared transaction'], narration: 'This branch retries deliveries.' };
const board = (skipped) => ({ title: 'Retries', scenes: [intent], skipped });
const ofScenes = (warnings, prefix) => warnings.filter((w) => w.startsWith(prefix));

test('a reviewer video warns about a substantial hunk skipped because the diagrams cover it, and the overview does not', async () => {
  const sb = board([{ hunkId: 'h1', reason: 'covered by the diagrams in this overview' }, { hunkId: 'h2', reason: 'covered by the diagrams' }]);
  const familiar = (await validateStoryboard(sb, hunks, { audience: 'familiar' })).warnings;
  assert.deepEqual(ofScenes(familiar, 'skipped['), [
    'skipped[0]: h1 src/worker.js (+20) is skipped as "covered by the diagrams in this overview", but a video for a reviewer shows every substantial hunk; add a code scene for it. Only the team\'s overview leaves code to the diagrams, and a topic the viewer chose brief its non-key hunks, with the reason "the viewer chose a brief look at this topic"',
  ]);
  const fresh = (await validateStoryboard(sb, hunks, { audience: 'new' })).warnings;
  assert.equal(ofScenes(fresh, 'skipped[0]').length, 1);
  assert.match(ofScenes(fresh, 'skipped[0]')[0], /a video for someone new to the code shows every substantial hunk/);
  const overview = (await validateStoryboard(sb, hunks, { audience: 'overview' })).warnings;
  assert.deepEqual(ofScenes(overview, 'skipped['), []);
});

test('a reviewer video may still skip a substantial hunk for a reason other than the diagrams', async () => {
  const { warnings } = await validateStoryboard(board([{ hunkId: 'h1', reason: 'generated lockfile' }]), hunks, { audience: 'familiar' });
  assert.deepEqual(ofScenes(warnings, 'skipped['), []);
});

test('a reviewer video may skip the non-key hunks of a topic the viewer chose brief, in those exact words', async () => {
  const skippedWarnings = async (reason) => ofScenes((await validateStoryboard(board([{ hunkId: 'h1', reason }]), hunks, { audience: 'familiar' })).warnings, 'skipped[');
  assert.deepEqual(await skippedWarnings('the viewer chose a brief look at this topic'), []);
  assert.equal((await skippedWarnings('a brief look at this topic; the diagrams cover it')).length, 1);
});

const cases = (n, status) => Array.from({ length: n }, (_, i) => ({ name: `case ${i}`, proves: `it handles ${i}`, ...(status ? { status } : {}) }));
const testsScene = (over) => ({ type: 'tests', subject: 'the worker', gaps: [], narration: 'The worker is tested.', ...over });
const warningsOf = async (scene) => (await validateStoryboard({ title: 'Retries', scenes: [scene] }, {}, { mode: 'explain' })).warnings;

test('narration that counts the tests differently from the cases on screen is warned', async () => {
  const warnings = await warningsOf(testsScene({ cases: cases(9), narration: 'Seven tests cover the retry decisions.' }));
  assert.deepEqual(ofScenes(warnings, 'scenes[0].narration: says'), ['scenes[0].narration: says "Seven tests", but the scene lists 9; say the number on screen']);
  assert.deepEqual(ofScenes(await warningsOf(testsScene({ cases: cases(9), narration: 'Nine tests cover the retry decisions.' })), 'scenes[0].narration: says'), []);
});

test('a count of new or existing tests is checked against the cases with that status', async () => {
  const scene = testsScene({ cases: [...cases(1, 'existing'), ...cases(2, 'added')], narration: 'Two new tests prove the fix, and one existing test covers paging.' });
  assert.deepEqual(ofScenes(await warningsOf(scene), 'scenes[0].narration: says'), []);
  const wrong = { ...scene, narration: 'Three new tests prove the fix.' };
  assert.deepEqual(ofScenes(await warningsOf(wrong), 'scenes[0].narration: says'), ['scenes[0].narration: says "Three new tests", but the scene lists 2 added; say the number on screen']);
});

test('a step that counts tests is checked against the cases it lights', async () => {
  const scene = testsScene({
    cases: cases(6),
    narration: 'Six tests cover the worker.',
    steps: [{ focus: '0-3', say: 'Four tests cover one attempt.' }, { focus: [4, 5], say: 'Three tests run a whole poll.' }],
  });
  assert.deepEqual(ofScenes(await warningsOf(scene), 'scenes[0].steps'), ['scenes[0].steps[1].say: says "Three tests", but the step lights 2; say the number it lights']);
});

test('the intent scene warns when it promises more or fewer things to check than it has bullets', async () => {
  const scene = { ...intent, bullets: ['Stuck deliveries', 'No shared transaction'], narration: 'There are three things to check.' };
  assert.deepEqual(ofScenes(await warningsOf(scene), 'scenes[0].narration: says'), ['scenes[0].narration: says "three things", but the scene has 2 bullets; say the number on screen']);
  assert.deepEqual(ofScenes(await warningsOf({ ...scene, narration: 'There are two things to check. The first thing is the claim.' }), 'scenes[0].narration: says'), []);
});

test('a count of the tests may leave out the removed ones', async () => {
  const scene = testsScene({ cases: [...cases(5), ...cases(1, 'removed')], narration: 'Five tests cover the lifecycle.' });
  assert.deepEqual(ofScenes(await warningsOf(scene), 'scenes[0].narration: says'), []);
  const wrong = { ...scene, narration: 'Four tests cover the lifecycle.' };
  assert.deepEqual(ofScenes(await warningsOf(wrong), 'scenes[0].narration: says'), ['scenes[0].narration: says "Four tests", but the scene lists 5, and 1 removed; say the number on screen']);
});
