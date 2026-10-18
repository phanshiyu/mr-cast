import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const lines = (n) =>
  Array.from({ length: n }, (_, i) => ({ type: 'add', oldLine: null, newLine: i + 1, text: `  step${i}();` }));
const hunk = (id, file, n) => ({
  id,
  file,
  oldFile: null,
  status: 'added',
  language: 'javascript',
  header: '',
  startLine: 1,
  oldStartLine: 0,
  endLine: n,
  additions: n,
  deletions: 0,
  beforeCode: '',
  afterCode: '',
  lines: lines(n),
});
// A 20-line change to the worker, and a 3-line config tweak.
const hunks = { h1: hunk('h1', 'src/worker.js', 20), h2: hunk('h2', 'src/config.js', 3) };
const intent = {
  type: 'intent',
  summary: 'Retries failed deliveries.',
  bullets: ['Stuck deliveries', 'No shared transaction'],
  narration: 'This branch retries deliveries.',
};
const ofScenes = (warnings, prefix) => warnings.filter((w) => w.startsWith(prefix));

test('skipped takes any reason; only an unknown hunk, a missing reason or a hunk also shown is reported', async () => {
  const check = async (skipped, scenes = [intent]) => validateStoryboard({ title: 'Retries', scenes, skipped }, hunks);
  const quiet = await check([
    { hunkId: 'h1', reason: 'covered by the diagrams' },
    { hunkId: 'h2', reason: 'config' },
  ]);
  assert.deepEqual([quiet.errors, ofScenes(quiet.warnings, 'skipped[')], [[], []]);
  assert.deepEqual(
    (await check([])).warnings.filter((w) => /h1|h2/.test(w)),
    [],
  );
  const broken = await check([{ hunkId: 'h9', reason: 'gone' }, { hunkId: 'h2' }]);
  assert.deepEqual(broken.errors, [
    'skipped[0].hunkId: "h9" not found in hunks.json',
    'skipped[1].reason: required string',
  ]);
  const shown = await check(
    [{ hunkId: 'h2', reason: 'config' }],
    [intent, { type: 'code', hunkId: 'h2', narration: 'The config.' }],
  );
  assert.deepEqual(ofScenes(shown.warnings, 'skipped['), [
    'skipped[0]: h2 is also shown in a scene; remove it from skipped or drop the scene',
  ]);
});

const cases = (n, status) =>
  Array.from({ length: n }, (_, i) => ({
    name: `case ${i}`,
    proves: `it handles ${i}`,
    ...(status ? { status } : {}),
  }));
const testsScene = (over) => ({
  type: 'tests',
  subject: 'the worker',
  gaps: [],
  narration: 'The worker is tested.',
  ...over,
});
const warningsOf = async (scene) =>
  (await validateStoryboard({ title: 'Retries', scenes: [scene] }, {}, { mode: 'explain' })).warnings;

test('narration that counts the tests differently from the cases on screen is warned', async () => {
  const warnings = await warningsOf(
    testsScene({ cases: cases(9), narration: 'Seven tests cover the retry decisions.' }),
  );
  assert.deepEqual(ofScenes(warnings, 'scenes[0].narration: says'), [
    'scenes[0].narration: says "Seven tests", but the scene lists 9; say the number on screen',
  ]);
  assert.deepEqual(
    ofScenes(
      await warningsOf(testsScene({ cases: cases(9), narration: 'Nine tests cover the retry decisions.' })),
      'scenes[0].narration: says',
    ),
    [],
  );
});

test('only the largest plain count in a text is the total, and one is never checked', async () => {
  const subjects = testsScene({
    cases: cases(9),
    narration: 'Nine tests cover it; one test checks the reset, and two tests check the limit.',
  });
  assert.deepEqual(ofScenes(await warningsOf(subjects), 'scenes[0].narration: says'), []);
  const wrong = testsScene({ cases: cases(9), narration: 'Seven tests cover it; one test checks the reset.' });
  assert.deepEqual(ofScenes(await warningsOf(wrong), 'scenes[0].narration: says'), [
    'scenes[0].narration: says "Seven tests", but the scene lists 9; say the number on screen',
  ]);
});

test('a step that is not an object is left to the step checks, not counted', async () => {
  const warnings = await warningsOf(
    testsScene({ cases: cases(2), narration: 'Two tests cover it.', steps: [null, 3] }),
  );
  assert.deepEqual(ofScenes(warnings, 'scenes[0].steps[0].say'), []);
  const intentWarnings = await warningsOf({ ...intent, steps: [null] });
  assert.deepEqual(ofScenes(intentWarnings, 'scenes[0].steps[0].say'), []);
});

test('a count of new or existing tests is checked against the cases with that status', async () => {
  const scene = testsScene({
    cases: [...cases(1, 'existing'), ...cases(2, 'added')],
    narration: 'Two new tests prove the fix, and one existing test covers paging.',
  });
  assert.deepEqual(ofScenes(await warningsOf(scene), 'scenes[0].narration: says'), []);
  const wrong = { ...scene, narration: 'Three new tests prove the fix.' };
  assert.deepEqual(ofScenes(await warningsOf(wrong), 'scenes[0].narration: says'), [
    'scenes[0].narration: says "Three new tests", but the scene lists 2 added; say the number on screen',
  ]);
  const oneExisting = {
    ...scene,
    narration: 'Two new tests prove the fix, and one existing test covers paging.',
    cases: [...cases(2, 'existing'), ...cases(2, 'added')],
  };
  assert.deepEqual(ofScenes(await warningsOf(oneExisting), 'scenes[0].narration: says'), [
    'scenes[0].narration: says "one existing test", but the scene lists 2 existing; say the number on screen',
  ]);
  const oneNew = { ...scene, narration: 'One new test proves the fix.' };
  assert.deepEqual(ofScenes(await warningsOf(oneNew), 'scenes[0].narration: says'), [
    'scenes[0].narration: says "One new test", but the scene lists 2 added; say the number on screen',
  ]);
});

test('a step that counts tests is checked against the cases it lights', async () => {
  const scene = testsScene({
    cases: cases(6),
    narration: 'Six tests cover the worker.',
    steps: [
      { focus: '0-3', say: 'Four tests cover one attempt.' },
      { focus: [4, 5], say: 'Three tests run a whole poll.' },
    ],
  });
  assert.deepEqual(ofScenes(await warningsOf(scene), 'scenes[0].steps'), [
    'scenes[0].steps[1].say: says "Three tests", but the step lights 2; say the number it lights',
  ]);
});

test('the intent scene warns when it promises more or fewer things to check than it has bullets', async () => {
  const scene = {
    ...intent,
    bullets: ['Stuck deliveries', 'No shared transaction'],
    narration: 'There are three things to check.',
  };
  assert.deepEqual(ofScenes(await warningsOf(scene), 'scenes[0].narration: says'), [
    'scenes[0].narration: says "three things", but the scene has 2 bullets; say the number on screen',
  ]);
  assert.deepEqual(
    ofScenes(
      await warningsOf({ ...scene, narration: 'There are two things to check. The first thing is the claim.' }),
      'scenes[0].narration: says',
    ),
    [],
  );
});

test('a count of the tests may leave out the removed ones', async () => {
  const scene = testsScene({
    cases: [...cases(5), ...cases(1, 'removed')],
    narration: 'Five tests cover the lifecycle.',
  });
  assert.deepEqual(ofScenes(await warningsOf(scene), 'scenes[0].narration: says'), []);
  const wrong = { ...scene, narration: 'Four tests cover the lifecycle.' };
  assert.deepEqual(ofScenes(await warningsOf(wrong), 'scenes[0].narration: says'), [
    'scenes[0].narration: says "Four tests", but the scene lists 5, and 1 removed; say the number on screen',
  ]);
});
