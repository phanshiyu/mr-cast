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

test('a spelled number is read whole, so "twenty three" names 23 and not 20', async () => {
  const scene = (say) => ({ type: 'array', narration: 'Sorted limits.', values: [5, 20, 23, 200, 205], steps: [{ focus: 2, say }] });
  assert.deepEqual(await highlightWarnings(scene('The middle cell holds twenty three.')), []);
  assert.deepEqual(await highlightWarnings(scene('Twenty-three sits left of two hundred and five.')), [
    'scenes[0].steps[0]: says "205" (cell 4 = 205), which is not lit; it lights cell 2 = 23. Focus what the words name, or say only what is lit',
  ]);
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

test('a memory step warns about a value its words name in a variable it leaves dark', async () => {
  const warnings = await highlightWarnings({
    type: 'memory',
    narration: 'The cart holds a list.',
    frames: [{ name: 'checkout', vars: { cart: { ref: 'c1' }, total: 12 } }],
    objects: [{ id: 'c1', type: 'Cart', fields: { first: 'mug', second: 'tea' } }],
    steps: [
      { focus: 'c1.first', say: 'The cart starts with a mug and tea.' },
      { set: { 'c1.second': 'cake' }, say: 'Tea becomes cake, and the total stays twelve.' },
    ],
  });
  assert.deepEqual(warnings, [
    'scenes[0].steps[0]: says "tea" (c1.second = "tea"), which is not lit; it lights object c1 (Cart), c1.first = "mug". Focus what the words name, or say only what is lit',
    'scenes[0].steps[1]: says "12" (checkout.total = 12), which is not lit; it lights object c1 (Cart), c1.second = "cake". Focus what the words name, or say only what is lit',
  ]);
});

test('a lit entity lights its fields, and a lit relation lights both entities with their fields', async () => {
  const er = (steps) => ({
    type: 'er',
    narration: 'Orders belong to users.',
    entities: [
      { id: 'orders', name: 'orders', fields: [{ name: 'id' }, { name: 'user_id' }] },
      { id: 'users', name: 'users', fields: [{ name: 'id' }, { name: 'email' }] },
      { id: 'carts', name: 'carts', fields: [{ name: 'cart_id' }] },
    ],
    relations: [{ from: 'orders', to: 'users', label: 'placed by', cardinality: 'one-to-many' }],
    steps,
  });
  assert.deepEqual(await highlightWarnings(er([
    { focus: 'orders', say: 'Each order stores a user_id.' },
    { focus: 0, say: 'The user_id points at users.' },
  ])), []);
  assert.deepEqual(await highlightWarnings(er([{ focus: 'orders', say: 'An order never holds a cart_id, but the cart keeps its cart_id here.' }, { focus: 'users', say: 'Each cart has a cart_id.' }])), [
    'scenes[0].steps[1]: says "cart id" (field carts.cart_id), which is not lit; it lights entity users. Focus what the words name, or say only what is lit',
  ]);
});

test('a number after a move or a pointer name is the index it lands on, not a cell value', async () => {
  const warnings = await highlightWarnings({
    type: 'array',
    narration: 'Binary search.',
    values: [10, 3, 7, 1, 12],
    pointers: [{ name: 'mid', at: 2 }],
    steps: [
      { move: { mid: 1 }, focus: 'ptr:mid', say: 'mid moves to 1.' },
      { move: { mid: 3 }, focus: 'ptr:mid', say: 'Then mid jumps to 3, so mid at 3 holds one.' },
      { focus: 'ptr:mid', say: 'It is bigger than 7.' },
    ],
  });
  assert.deepEqual(warnings, [
    'scenes[0].steps[2]: says "7" (cell 2 = 7), which is not lit; it lights cell 3 = 1, pointer mid at cell 3. Focus what the words name, or say only what is lit',
  ]);
});

test('an amount that ends a sentence and a denied value do not warn; a chart label lights with its series and keeps its case', async () => {
  const array = await highlightWarnings({ type: 'array', narration: 'A search.', values: [50, 3], steps: [{ focus: 1, say: 'Done in 50.' }] });
  assert.deepEqual(array, []);
  const memory = await highlightWarnings({
    type: 'memory',
    narration: 'Two counters.',
    frames: [{ name: 'main', vars: { count: 3, total: 5 } }],
    objects: [],
    steps: [{ focus: 'main.count', say: 'count is 3, not 5.' }],
  });
  assert.deepEqual(memory, []);
  const chart = (focus) => ({
    type: 'chart',
    kind: 'bar',
    narration: 'Revenue by quarter.',
    labels: ['Q1', 'Q2', 'Q3'],
    series: [{ name: 'Revenue 2024', values: [1, 2, 3] }, { name: 'Costs 2024', values: [1, 1, 1] }],
    steps: [{ focus, say: 'Revenue 2024 peaks in Q3.' }],
  });
  assert.deepEqual(await highlightWarnings(chart('series:Revenue 2024')), []);
  assert.deepEqual(await highlightWarnings(chart('series:Costs 2024')), [
    'scenes[0].steps[0]: says "Revenue 2024" (series Revenue 2024), which is not lit; it lights series Costs 2024. Focus what the words name, or say only what is lit',
  ]);
});

test('an error in another scene does not hide this scene\'s highlight warnings', async () => {
  const sorting = { type: 'array', narration: 'A list.', values: [5, 1, 4], steps: [{ focus: 0, say: 'Compare five and four.' }] };
  const { errors, warnings } = await validateStoryboard({ title: 't', scenes: [{ type: 'intent', bullets: ['a'] }, sorting] }, {}, { mode: 'explain' });
  assert.ok(errors.some((e) => e.startsWith('scenes[0].narration')));
  assert.deepEqual(warnings.filter((w) => / not lit;/.test(w)), [
    'scenes[1].steps[0]: says "4" (cell 2 = 4), which is not lit; it lights cell 0 = 5. Focus what the words name, or say only what is lit',
  ]);
});
