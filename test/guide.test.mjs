import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guidePanel, sceneQuestions } from '../shared/guide.mjs';

const hunk = (id, file, start, n) => ({
  id,
  file,
  oldFile: null,
  lines: Array.from({ length: n }, (_, i) => ({ type: 'add', oldLine: null, newLine: start + i, text: 'x' })),
});
const hunks = { h1: hunk('h1', 'src/limiter.js', 10, 9), h2: hunk('h2', 'src/server.js', 40, 6) };
const brief = {
  why: { text: 'Bots placed thousands of orders a minute.', source: 'commit 7376000' },
  case: { before: 'The twenty-first order was accepted', after: 'It is refused with a 429.', cite: [] },
  approach: { text: 'Count orders per address.', decisions: [] },
  parts: [
    { name: 'The limiter', weight: 'core', hunks: ['h1'] },
    { name: 'Wiring', weight: 'support', hunks: ['h2'] },
  ],
  proof: { tested: ['A twenty-first order is refused'], untested: ['Two servers'] },
  check: [
    { file: 'src/server.js', line: '40-41', what: 'the limiter runs first', why: 'a refused order must not be saved' },
    { file: 'src/elsewhere.js', line: 3, what: 'a place no scene shows', why: 'it is not in the video' },
  ],
  ask: ['Why per server?'],
};
const scenes = [
  { type: 'text', answers: ['why', 'approach'] },
  { type: 'code', hunkId: 'h1', answers: ['case', 'parts'] },
  { type: 'code', hunkId: 'h2', answers: ['check', 'proof'] },
];

test('no brief, no guide, and a scene names the questions it answers in the six-question order', () => {
  assert.equal(guidePanel({ title: 'T', scenes }, hunks), null);
  assert.deepEqual(sceneQuestions({ answers: ['check', 'why'] }), ['Why', 'Check first']);
  assert.deepEqual(sceneQuestions({ type: 'text' }), []);
});

test('each question has its answer and the first scene that tells it', () => {
  const guide = guidePanel({ title: 'T', scenes, brief }, hunks);
  assert.deepEqual(
    guide.questions.map((q) => [q.label, q.scene]),
    [
      ['Why', 0],
      ['One case', 1],
      ['The idea', 0],
      ['The parts', 1],
      ['Proof', 2],
      ['Check first', 2],
    ],
  );
  assert.equal(guide.questions[1].answer, 'The twenty-first order was accepted. It is refused with a 429.');
  assert.equal(guide.questions[3].answer, '2 parts. Main: The limiter. 1 more.');
  assert.equal(guide.questions[4].answer, 'Tested: A twenty-first order is refused. Not tested: Two servers.');
  assert.deepEqual(guide.ask, ['Why per server?']);
});

test('a place to open first seeks to the scene that shows it, or to none', () => {
  const guide = guidePanel({ title: 'T', scenes, brief }, hunks);
  assert.deepEqual(
    guide.check.map((c) => [c.where, c.scene]),
    [
      ['src/server.js:40-41', 2],
      ['src/elsewhere.js:3', null],
    ],
  );
});

test('an answer of "unknown", or none, has no text, and a question no scene tells has no scene', () => {
  const sb = {
    title: 'T',
    scenes: [{ type: 'text' }],
    brief: { why: { source: 'unknown' }, case: 'unknown', parts: 'unknown' },
  };
  const guide = guidePanel(sb, hunks);
  assert.deepEqual(
    guide.questions.map((q) => q.answer),
    [null, null, null, null, null, null],
  );
  assert.deepEqual(
    guide.questions.map((q) => q.scene),
    [null, null, null, null, null, null],
  );
});
