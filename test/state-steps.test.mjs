import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { normalizeStoryboard } from '../shared/normalize.mjs';
import { walkStates } from '../shared/state-steps.mjs';
import { parseStoryboard } from '../shared/storyboard-json.mjs';
import { resolveRef } from '../shared/targets.mjs';

const search = {
  type: 'array',
  narration: 'Binary search for five.',
  values: [1, 3, 4, 6],
  pointers: [{ name: 'lo', at: 0 }, { name: 'hi', at: 3 }, { name: 'mid', at: 1, hidden: true }],
  ranges: [{ name: 'window', from: 0, to: 3 }],
  steps: [
    { show: ['ptr:mid'], say: 'The middle is three.' },
    { move: { lo: 2, window: '2-3' }, set: { 1: 'x' }, say: 'The low end moves right.' },
    { hide: ['range:window'], focus: 'ptr:mid', say: 'The window is gone.' },
  ],
};

const cart = {
  type: 'memory',
  narration: 'The checkout holds a cart.',
  frames: [{ name: 'checkout', vars: { cart: { ref: 'c1' }, order: 'null' } }],
  objects: [
    { id: 'c1', type: 'Cart', fields: { items: { ref: 'l1' } } },
    { id: 'l1', type: 'list', fields: { 0: 'mug' } },
    { id: 'l2', type: 'list', fields: { 0: 'mug' }, hidden: true },
  ],
  steps: [
    { show: ['l2'], set: { 'checkout.order': { ref: 'l2' } }, say: 'The order gets its own list.' },
    { set: { 'c1.items': { ref: 'l2' }, 'l1.0': 'tea' }, say: 'The cart points at it too.' },
  ],
};

test('an array state is the initial state plus every change up to the step, in order', () => {
  const { states, problems } = walkStates(search);
  assert.deepEqual(problems, []);
  assert.deepEqual(states, [
    { values: { 'c:0': 1, 'c:1': 3, 'c:2': 4, 'c:3': 6 }, places: { 'ptr:lo': [0, 0], 'ptr:hi': [3, 3], 'ptr:mid': [1, 1], 'rg:window': [0, 3] }, hidden: { 'ptr:mid': true }, tints: {}, callout: '' },
    { values: { 'c:0': 1, 'c:1': 3, 'c:2': 4, 'c:3': 6 }, places: { 'ptr:lo': [0, 0], 'ptr:hi': [3, 3], 'ptr:mid': [1, 1], 'rg:window': [0, 3] }, hidden: {}, tints: {}, callout: '' },
    { values: { 'c:0': 1, 'c:1': 'x', 'c:2': 4, 'c:3': 6 }, places: { 'ptr:lo': [2, 2], 'ptr:hi': [3, 3], 'ptr:mid': [1, 1], 'rg:window': [2, 3] }, hidden: {}, tints: {}, callout: '' },
    { values: { 'c:0': 1, 'c:1': 'x', 'c:2': 4, 'c:3': 6 }, places: { 'ptr:lo': [2, 2], 'ptr:hi': [3, 3], 'ptr:mid': [1, 1], 'rg:window': [2, 3] }, hidden: { 'rg:window': true }, tints: {}, callout: '' },
  ]);
});

test('a memory step re-points a reference and edits a field, and later steps keep both', () => {
  const { states, problems } = walkStates(cart);
  assert.deepEqual(problems, []);
  assert.deepEqual(states.map((s) => [s.values['v:checkout/order'], s.values['f:c1/items'], s.values['f:l1/0'], s.hidden]), [
    ['null', { ref: 'l1' }, 'mug', { 'o:l2': true }],
    [{ ref: 'l2' }, { ref: 'l1' }, 'mug', {}],
    [{ ref: 'l2' }, { ref: 'l2' }, 'tea', {}],
  ]);
});

test('a pointer may stand just past either end, but no further', () => {
  const at = (n) => walkStates({ ...search, steps: [{ move: { hi: n }, say: 'x' }] });
  assert.deepEqual(at(4).states[1].places['ptr:hi'], [4, 4]);
  assert.deepEqual(at(-1).states[1].places['ptr:hi'], [-1, -1]);
  assert.deepEqual(at(5).problems.filter((p) => p.level === 'error').map((p) => p.message), ['5 is no place; a pointer moves to a cell index from 0 to 3, or -1 or 4 just past either end']);
});

test('a reference to an object that is hidden then is an error at the step that makes it', () => {
  const early = { ...cart, steps: [{ set: { 'checkout.order': { ref: 'l2' } }, say: 'Too soon.' }] };
  assert.deepEqual(walkStates(early).problems.filter((p) => p.level === 'error'), [
    { step: 0, field: 'set', ref: 'checkout.order', level: 'error', names: [], message: 'points at "l2" from this step, but "l2" is hidden then; show it in this step or an earlier one, or start it shown' },
  ]);
});

test('a step without focus focuses what it changes', () => {
  const sb = normalizeStoryboard({ title: 't', scenes: [search, cart] }, {});
  assert.deepEqual(sb.scenes[0].steps.map((s) => s.focus), [['ptr:mid'], ['1', 'ptr:lo', 'range:window'], 'ptr:mid']);
  assert.deepEqual(sb.scenes[1].steps.map((s) => s.focus), [['checkout.order', 'l2'], ['c1.items', 'l1.0']]);
});

test('array and memory refs resolve to the items the scenes draw', () => {
  assert.deepEqual(resolveRef(search, '1-2'), ['c:1', 'c:2']);
  assert.deepEqual(resolveRef(search, 'ptr:lo'), ['ptr:lo']);
  assert.deepEqual(resolveRef(search, 'range:window'), ['rg:window']);
  assert.equal(resolveRef(search, 'ptr:nope'), null);
  assert.equal(resolveRef(search, 4), null);
  assert.deepEqual(resolveRef(cart, 'frame:checkout'), ['fr:checkout']);
  assert.deepEqual(resolveRef(cart, 'checkout.cart'), ['v:checkout/cart']);
  assert.deepEqual(resolveRef(cart, 'c1'), ['o:c1']);
  assert.deepEqual(resolveRef(cart, 'l1.0'), ['f:l1/0']);
  assert.equal(resolveRef(cart, 'c1.total'), null);
});

const errorsOf = async (scene) => (await validateStoryboard({ title: 't', scenes: [scene] }, {})).errors;

test('validate names every change that names nothing, and the refs it could name', async () => {
  const bad = {
    ...search,
    steps: [{ set: { 7: 9 }, move: { low: 1 }, show: ['ptr:md'], say: 'Wrong refs.' }],
  };
  assert.deepEqual(await errorsOf(bad), [
    'scenes[0].steps[0].set["7"]: names no cell; a set key is a cell index from 0 to 3',
    'scenes[0].steps[0].move["low"]: names no pointer or range; they are "lo", "hi", "mid", "window"; did you mean "lo"?',
    'scenes[0].steps[0].show["ptr:md"]: names no pointer or range; show takes a pointer "ptr:name" or a range "range:name"; did you mean "ptr:mid", "ptr:lo" or "ptr:hi"?',
  ]);
  const typo = { ...cart, steps: [{ set: { 'checkout.ordr': 1, 'c1.items': { ref: 'l9' } }, say: 'Wrong refs.' }] };
  assert.deepEqual(await errorsOf(typo), [
    'scenes[0].steps[0].set["checkout.ordr"]: names no variable or field; a set key is a variable "frame.var" or a field "object.field"; did you mean "checkout.order" or "checkout.cart"?',
    'scenes[0].steps[0].set["c1.items"]: points at "l9", which is no object; objects are "c1", "l1", "l2"',
  ]);
});

test('validate requires a focus only on a step that changes nothing', async () => {
  const still = { ...search, steps: [{ say: 'Nothing happens.' }] };
  assert.deepEqual(await errorsOf(still), [
    'scenes[0].steps[0].focus: required, a cell index, an "a-b" range of cells, a pointer "ptr:name", or a range "range:name", or an array of them, unless the step changes something, which it then focuses',
  ]);
  assert.deepEqual(await errorsOf(search), []);
});

test('a variable, field or frame whose name holds "/" keeps its owner and name apart', async () => {
  const cache = {
    type: 'memory',
    narration: 'The cache keeps each response by its path.',
    frames: [{ name: 'serve/api', vars: { 'req/id': 7, cache: { ref: 'c' } } }],
    objects: [
      { id: 'c', type: 'dict', fields: { '/api/me': { ref: 'u' } } },
      { id: 'u', type: 'User', fields: { name: 'Ada' } },
      { id: 'v', type: 'User', fields: { name: 'Bo' }, hidden: true },
    ],
    steps: [{ set: { 'c./api/me': { ref: 'v' } }, say: 'Now the cache holds the other user.' }],
  };
  assert.deepEqual(resolveRef(cache, 'c./api/me'), ['f:c//api/me']);
  assert.deepEqual(resolveRef(cache, 'serve/api.req/id'), ['v:serve%2Fapi/req/id']);
  assert.deepEqual(walkStates(cache).problems.filter((p) => p.level === 'error').map((p) => [p.ref, p.message]), [
    ['c./api/me', 'points at "v" from this step, but "v" is hidden then; show it in this step or an earlier one, or start it shown'],
  ]);
  const shown = { ...cache, steps: [{ set: { 'c./api/me': { ref: 'v' } }, show: ['v'], say: 'Now the cache holds the other user.' }] };
  const r = await validateStoryboard({ title: 't', scenes: [shown] }, {}, { mode: 'explain' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.filter((w) => w.includes('could not check')), []);
});

test('validate requires a focus on a step that only hides, or whose changes are empty', async () => {
  const hideOnly = { ...search, steps: [{ hide: ['range:window'], say: 'The window is gone.' }] };
  assert.deepEqual(await errorsOf(hideOnly), [
    'scenes[0].steps[0].focus: required, a cell index, an "a-b" range of cells, a pointer "ptr:name", or a range "range:name", or an array of them, since this step only hides, and what it hides cannot be lit, so it lights nothing',
  ]);
  const empty = { ...cart, steps: [{ set: {}, say: 'Nothing moves.' }] };
  assert.deepEqual(await errorsOf(empty), [
    'scenes[0].steps[0].focus: required, a frame "frame:name", a variable "frame.var", an object id, or a field "object.field", or an array of them, since this step changes nothing, so it lights nothing',
  ]);
  assert.deepEqual(await errorsOf({ ...hideOnly, steps: [{ hide: ['range:window'], focus: 'ptr:lo', say: 'The window is gone.' }] }), []);
});

test('validate says "an array step"', async () => {
  const token = { ...search, steps: [{ focus: 'ptr:lo', mark: 'circle', token: 'lo', say: 'The low end starts at zero.' }] };
  assert.deepEqual(await errorsOf(token), ['scenes[0].steps[0].token: only code steps take a token; an array step marks its first focus ref']);
});

test('a later tint key wins over an earlier one it overlaps, a key such as "3" included', async () => {
  const written = `{ "title": "t", "scenes": [{
    "type": "array", "narration": "Six cells.", "values": [1, 2, 3, 4, 5, 6],
    "tint": { "0-5": "dim", "3": "good" },
    "steps": [{ "tint": { "0-5": "bad", "2": "clear" }, "say": "All but the third are bad." }]
  }] }`;
  // The render's props and the player's fetch carry the storyboard as JSON, so the order must survive a round trip.
  const storyboard = JSON.parse(JSON.stringify(parseStoryboard(written)));
  const { states, problems } = walkStates(storyboard.scenes[0]);
  assert.deepEqual(problems, []);
  assert.deepEqual(states.map((s) => s.tints), [
    { 'c:0': 'dim', 'c:1': 'dim', 'c:2': 'dim', 'c:3': 'good', 'c:4': 'dim', 'c:5': 'dim' },
    { 'c:0': 'bad', 'c:1': 'bad', 'c:3': 'bad', 'c:4': 'bad', 'c:5': 'bad' },
  ]);
  assert.deepEqual((await validateStoryboard(storyboard, {}, { mode: 'explain' })).errors, []);
});
