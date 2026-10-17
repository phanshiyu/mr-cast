import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { formatSteps } from '../bin/lib/highlight.mjs';

const highlightWarnings = async (scene) =>
  (await validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' })).warnings.filter((w) => / not lit;|as the step starts, before its words/.test(w));

/** Pass one of bubble sort on [5, 1, 4, 2, 8], written the way the writers wrote it before 0.23. */
const passOne = (steps) => ({ type: 'array', narration: 'The first pass walks the list.', values: [5, 1, 4, 2, 8], pointers: [{ name: 'i', at: 0 }], steps });

test('a step whose words name a cell value it leaves dark warns with what is lit', async () => {
  const warnings = await highlightWarnings(
    passOne([
      { focus: '0-1', say: 'First we compare 5 and 1.' },
      { set: { 0: 1, 1: 5 }, say: 'Five is bigger than one, so they swap.' },
      { move: { i: 1 }, say: 'Next we compare 5 and 4, and five is bigger again.' },
    ]),
  );
  assert.deepEqual(warnings, [
    'scenes[0].steps[2]: says "4" (cell 2 = 4), which is not lit; it lights cell 1 = 5, pointer i at cell 1. Focus what the words name, or say only what is lit',
  ]);
});

test('a swap with no step lighting the pair before it warns; a compare step first does not', async () => {
  const swapFirst = await highlightWarnings(passOne([{ focus: '0-1', set: { 0: 1, 1: 5 }, say: 'Compare five and one. Five is bigger, so they swap.' }]));
  assert.deepEqual(swapFirst, [
    'scenes[0].steps[0]: swaps cell 0 and cell 1 as the step starts, before its words, and the step before did not light them, so the viewer never sees the pair before it moves; add a step before it that focuses them while the words compare them, then swap in this step',
  ]);
  const compareFirst = await highlightWarnings(
    passOne([
      { focus: '0-1', say: 'Compare five and one.' },
      { set: { 0: 1, 1: 5 }, say: 'Five is bigger, so they swap.' },
    ]),
  );
  assert.deepEqual(compareFirst, []);
});

test('numbers that count or name something else do not warn, though the scene holds those values', async () => {
  const warnings = await highlightWarnings({
    type: 'array',
    narration: 'Bubble sort makes passes.',
    values: [2, 1, 3, 4],
    steps: [
      { focus: '0-1', say: 'It takes two passes over the list, and pass three finds nothing.' },
      { set: { 0: 1, 1: 2 }, say: 'The two swap, because the one on the right is smaller.' },
      { focus: 3, say: 'The next pass can stop one cell earlier, so the next pass checks three cells.' },
    ],
  });
  assert.deepEqual(warnings, []);
});

test('a pointer or range named by its words counts as lit when the cell under it is', async () => {
  const warnings = await highlightWarnings({
    type: 'array',
    narration: 'Pass one ends.',
    values: [1, 2, 4, 5, 8],
    ranges: [{ name: 'final place', from: 4, to: 4 }],
    steps: [
      { focus: '3-4', say: 'Eight is now in its final place.' },
      { focus: '2-3', say: 'Four and five are in order, and five reaches its final place too.' },
    ],
  });
  assert.deepEqual(warnings, [
    'scenes[0].steps[1]: says "final place" (range final place at cell 4), which is not lit; it lights cell 2 = 4, cell 3 = 5. Focus what the words name, or say only what is lit',
  ]);
});

test('a diagram label warns only when the words name it in full and do not deny it', async () => {
  const warnings = await highlightWarnings({
    type: 'graph',
    narration: 'A request reaches the limiter first.',
    nodes: [
      { id: 'lim', label: 'Rate limiter' },
      { id: 'svc', label: 'Orders service' },
      { id: 'db', label: 'Database' },
    ],
    edges: [{ from: 'lim', to: 'svc' }, { from: 'svc', to: 'db' }],
    steps: [
      { focus: 'lim', say: 'The rate limiter counts the request, and the service waits.' },
      { focus: 'lim', say: 'A refused request never reaches the orders service.' },
      { focus: 'db', say: 'The orders service then saves the order.' },
    ],
  });
  assert.deepEqual(warnings, [
    'scenes[0].steps[2]: says "orders service" (node Orders service), which is not lit; it lights node Database. Focus what the words name, or say only what is lit',
  ]);
});

test('steps prints each step beside what it lights and changes, then the highlight warnings', () => {
  const text = formatSteps(
    { scenes: [{ type: 'intent', bullets: [] }, passOne([{ focus: '0-1', say: 'Compare five and one.' }, { set: { 0: 1, 1: 5 }, say: 'Five is bigger, so they swap.' }, { move: { i: 1 }, say: 'Next, five and four.' }])] },
    {},
  );
  assert.equal(
    text,
    [
      'scene 1 · array',
      '  intro   The first pass walks the list.',
      '  step 0  says    Compare five and one.',
      '          lit     cell 0 = 5; cell 1 = 1',
      '  step 1  says    Five is bigger, so they swap.',
      '          changes cell 0 5 → 1; cell 1 1 → 5',
      '          lit     cell 0 = 1; cell 1 = 5',
      '  step 2  says    Next, five and four.',
      '          changes pointer i 0 → 1',
      '          lit     cell 1 = 5; pointer i at cell 1',
      '  ! scenes[1].steps[2]: says "4" (cell 2 = 4), which is not lit; it lights cell 1 = 5, pointer i at cell 1. Focus what the words name, or say only what is lit',
    ].join('\n'),
  );
});
