// The ink board: a step's `draw` stays until a step erases it, and validate names every ref, cue and id that does not
// hold before anything renders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { inkBoard } from '../shared/ink.mjs';
import { cueFrame, cueWord, sceneSegments } from '../shared/timing.mjs';

const errorsOf = async (scene, hunks = {}) => (await validateStoryboard({ title: 't', scenes: [scene] }, hunks, { mode: 'explain' })).errors;

const graph = (steps) => ({
  type: 'graph',
  narration: 'Three places joined by roads.',
  nodes: [
    { id: 'S', label: 'S' },
    { id: 'A', label: 'A' },
    { id: 'B', label: 'B' },
  ],
  edges: [
    { from: 'S', to: 'A' },
    { from: 'S', to: 'B' },
    { from: 'B', to: 'A' },
  ],
  steps,
});

const board = (scene) => inkBoard(scene).items.map((it) => ({ step: it.step, verb: it.verb, id: it.id, until: it.until }));

test('ink stays on the board until a step erases it, by id or all at once', () => {
  const scene = graph([
    { focus: 'S', say: 'Start at S.', draw: [{ circle: 'S', id: 'start' }, { write: 'd = 0', near: 'S' }] },
    { focus: 'A', say: 'A costs four.', draw: [{ underline: 'A', id: 'four' }] },
    { focus: 'B', say: 'B costs two.', erase: ['start'], draw: [{ tick: 'B' }] },
    { focus: 'A', say: 'A again.', erase: true },
  ]);
  assert.deepEqual(board(scene), [
    { step: 0, verb: 'circle', id: 'start', until: 2 },
    { step: 0, verb: 'write', id: undefined, until: 3 },
    { step: 1, verb: 'underline', id: 'four', until: 3 },
    { step: 2, verb: 'tick', id: undefined, until: 3 },
  ]);
});

test('an erase lands before the step draws, so a step can redraw an id it erases', () => {
  const scene = graph([
    { focus: 'A', say: 'A is four.', draw: [{ write: '4', near: 'A', id: 'd' }] },
    { focus: 'A', say: 'Now three.', erase: ['d'], draw: [{ write: '3', near: 'A', id: 'd' }] },
  ]);
  assert.deepEqual(inkBoard(scene).problems, []);
  assert.deepEqual(board(scene), [
    { step: 0, verb: 'write', id: 'd', until: 1 },
    { step: 1, verb: 'write', id: 'd', until: Infinity },
  ]);
});

test('targets resolve to scene keys, items on the board and stage points', () => {
  const scene = graph([{ focus: 'B', say: 'Two plus one.', draw: [{ write: '2 + 1', near: 'B', id: 'sum' }, { arrow: ['sum', 'A'] }, { arrow: [[0.1, 0.9], 'B->A'] }] }]);
  assert.deepEqual(
    inkBoard(scene).items.map((it) => it.targets),
    [[{ keys: ['n:B'] }], [{ ink: 'sum' }, { keys: ['n:A'] }], [{ point: [0.1, 0.9] }, { keys: ['e:2'] }]],
  );
});

test('validate fails on a ref that names nothing, with the names close to it', async () => {
  assert.deepEqual(await errorsOf(graph([{ focus: 'S', say: 'x', draw: [{ circle: 'Q' }, { box: ['S', 'BB'] }] }])), [
    'scenes[0].steps[0].draw[0].circle: "Q" names nothing in this graph; did you mean "S", "A" or "B"?',
    'scenes[0].steps[0].draw[1].box[1]: "BB" names nothing in this graph; did you mean "B", "S" or "A"?',
  ]);
});

test('validate fails on a when the say does not contain, and matches words without case or punctuation', async () => {
  assert.deepEqual(await errorsOf(graph([{ focus: 'S', say: 'Two plus one, which is three.', draw: [{ circle: 'S', when: 'which is THREE' }, { tick: 'A', when: 'is four' }] }])), [
    'scenes[0].steps[0].draw[1].when: "is four" is not in the step\'s say; copy the words the item should start on',
  ]);
});

test('validate fails on an erase of an id never drawn, or not on the board yet', async () => {
  assert.deepEqual(
    await errorsOf(
      graph([
        { focus: 'S', say: 'x', erase: ['later', 'nope'] },
        { focus: 'A', say: 'y', draw: [{ circle: 'A', id: 'later' }] },
      ]),
    ),
    [
      'scenes[0].steps[0].erase[0]: "later" is not on the board at this step; it is drawn later or already erased',
      'scenes[0].steps[0].erase[1]: no item has the id "nope"; give the item to erase an "id"',
    ],
  );
});

test('validate fails on an arrow from an id drawn later in the scene or later in the step', async () => {
  assert.deepEqual(
    await errorsOf(
      graph([
        { focus: 'S', say: 'x', draw: [{ arrow: ['sum', 'A'] }, { write: '2 + 1', near: 'B', id: 'sum' }] },
        { focus: 'A', say: 'y', erase: true, draw: [{ arrow: ['sum', 'A'] }] },
      ]),
    ),
    [
      'scenes[0].steps[0].draw[0].arrow[0]: "sum" is an item id that is not on the board at this step; draw it in an earlier item or step',
      'scenes[0].steps[1].draw[0].arrow[0]: "sum" is an item id that is not on the board at this step; draw it in an earlier item or step',
    ],
  );
});

test('validate fails on items that draw nothing, two things, or a write with no place', async () => {
  assert.deepEqual(
    await errorsOf(graph([{ focus: 'S', say: 'x', draw: [{ note: 'hi' }, { circle: 'S', box: 'A' }, { write: 'hi' }, { circle: 'S', colour: 'good', side: 'up', at: [0.5, 0.5] }] }])),
    [
      'scenes[0].steps[0].draw[0]: names nothing to draw; give it one of circle, box, underline, strike, cross, tick, brace, arrow, write',
      'scenes[0].steps[0].draw[1]: names circle and box; an item draws one thing, so split it into 2 items',
      'scenes[0].steps[0].draw[2].write: needs "near", a ref or item id to write beside, or "at", an [x, y] point on the stage; give one',
      'scenes[0].steps[0].draw[3].colour: is not an ink field; an item takes one of circle, box, underline, strike, cross, tick, brace, arrow, write, and note, when, tone, side, id, near, at',
      'scenes[0].steps[0].draw[3].at: only "write" takes it; a circle goes on what it names',
      'scenes[0].steps[0].draw[3].side: must be one of above, below, left, right',
    ],
  );
});

test('validate fails on draw on a scene type without refs', async () => {
  const flow = { type: 'flow', narration: 'x', steps: [{ actor: 'a', action: 'b', say: 'c', draw: [{ circle: 0 }] }] };
  assert.ok((await errorsOf(flow)).includes('scenes[0].steps[0].draw: flow steps take no draw; ink goes on the steps of graph, sequence, er, state, table, chart, timeline, files, tests, compare, terminal, layers, array, memory, image, svg, plot, map, text, code'));
});

test('a code step names lines by number or range, and any other string as text on its own lines', () => {
  const hunk = {
    id: 'h1',
    lines: [
      { type: 'context', text: 'const max = 20;', oldLine: 1, newLine: 1 },
      { type: 'add', text: 'if (count > max) return 429;', oldLine: null, newLine: 2 },
      { type: 'add', text: 'count = count + 1;', oldLine: null, newLine: 3 },
    ],
  };
  const scene = { type: 'code', hunkId: 'h1', narration: 'x', steps: [{ lines: '2-3', say: 'y', draw: [{ circle: '429' }, { underline: '2-3' }, { box: 'count' }, { tick: 'max = 20' }] }] };
  const { items, problems } = inkBoard(scene, { h1: hunk });
  assert.deepEqual(items.map((it) => it.targets), [[{ keys: ['tx:1:24:3'] }], [{ keys: ['ln:1', 'ln:2'] }]]);
  assert.deepEqual(problems.map((p) => p.message), [
    '"count" occurs 3 times on the step\'s lines; lengthen it until it names one place',
    '"max = 20" is not on the step\'s lines; name a line number, an "a-b" range, or text copied exactly from the code',
  ]);
});

test('a cue is found among the spoken words and timed where the voice says it', () => {
  assert.equal(cueWord('But going S to B costs two plus one, which is three.', 'Two Plus one'), 6);
  assert.equal(cueWord('two plus one', 'plus two'), -1);
  const scene = graph([{ focus: 'S', say: 'one two three four five six seven eight nine ten' }]);
  const step = sceneSegments(scene)[1];
  // Ten words over the estimated reading time: "six" is word 5, halfway through, less the 3-frame lead.
  assert.equal(cueFrame(step, 'six'), step.voiceFrom + Math.round(step.speakingFrames / 2) - 3);
  assert.equal(cueFrame(step, 'eleven'), null);
});

test('validate warns when text written at a point lands on what the scene draws, and not when it is clear', async () => {
  const array = (at) => ({
    type: 'array',
    narration: 'Four cells.',
    values: [1, 2, 3, 4],
    steps: [{ focus: 0, say: 'The first cell.', draw: [{ write: 'start here', at }] }],
  });
  const warningsOf = async (scene) => (await validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' })).warnings.filter((w) => w.includes('.at:'));
  assert.deepEqual(await warningsOf(array([0.02, 0.9])), []);
  const onCells = await warningsOf(array([0.3, 0.42]));
  assert.equal(onCells.length, 1);
  assert.match(onCells[0], /^scenes\[0\]\.steps\[0\]\.draw\[0\]\.at: the text lands on "0"; move it to free space, or write it near a ref$/);
});

test('a step that only draws ink is not reported as moving nothing', async () => {
  const steps = (draw) => [
    { focus: 'S', say: 'Start at S.' },
    { focus: 'S', say: 'It costs nothing.', ...draw },
  ];
  const same = async (scene) => (await validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' })).warnings.filter((w) => w.includes('nothing moves'));
  assert.deepEqual(await same(graph(steps({}))), ['scenes[0].steps[1]: focuses the same as the step before it, so nothing moves; merge the two or point this one elsewhere']);
  assert.deepEqual(await same(graph(steps({ draw: [{ write: 'd = 0', near: 'S' }] }))), []);
});

test('the ink reference example validates with no errors and no warnings', async () => {
  const text = (await import('node:fs')).readFileSync(new URL('../skill/mr-cast/references/ink.md', import.meta.url), 'utf8');
  const scene = JSON.parse(/^```json\n([\s\S]*?)^```$/m.exec(text)[1]);
  const { errors, warnings } = await validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' });
  assert.deepEqual({ errors, warnings }, { errors: [], warnings: [] });
});

test('validate warns that markup in handwritten ink is dropped', async () => {
  const { warnings } = await validateStoryboard({ title: 't', scenes: [graph([{ focus: 'S', say: 'Start.', draw: [{ write: '**d** = 0', near: 'S' }, { circle: 'A', note: 'plain' }] }])] }, {}, { mode: 'explain' });
  assert.deepEqual(warnings.filter((w) => w.includes('handwritten')), ['scenes[0].steps[0].draw[0].write: ink is handwritten, so its markup is dropped and the words drawn plain; remove the markup']);
});

test('a step still shows the frame before the next step starts, and the last step its settled frame', async () => {
  const { stillFrame } = await import('../bin/lib/render.mjs');
  const scene = graph([
    { focus: 'S', say: 'Start at S.' },
    { focus: 'A', say: 'Then A.' },
  ]);
  const [, , last] = sceneSegments(scene);
  assert.equal(stillFrame(scene, null, 0), last.from - 2);
  assert.equal(stillFrame(scene, null, 1), last.from + last.durationInFrames - 8 - 2);
  assert.equal(stillFrame(scene, null, undefined), stillFrame(scene, null, 1));
  assert.throws(() => stillFrame(scene, null, 2), /the graph scene has no step 2/);
});

test('ink on a text scene names its items, its lead by field name, its note and its kicker', async () => {
  const text = (draw) => ({ type: 'text', narration: 'Three rules.', kicker: 'Rules', headline: 'Keep it small', note: 'and true', items: ['one', 'two', 'three'], steps: [{ focus: 1, say: 'The second rule.', draw }] });
  const scene = text([{ circle: 1 }, { underline: 'headline' }, { write: 'why?', near: 'note' }, { box: ['0-1', 'kicker'] }]);
  assert.deepEqual(inkBoard(scene).items.map((it) => it.targets), [[{ keys: ['b:1'] }], [{ keys: ['t:lead'] }], [{ keys: ['t:note'] }], [{ keys: ['b:0', 'b:1'] }, { keys: ['t:kicker'] }]]);
  assert.deepEqual(await errorsOf(text([{ box: 'nope' }])), ['scenes[0].steps[0].draw[0].box: "nope" names nothing in this text; did you mean "note"?']);
});

test('ink on an intent scene draws on its bullets, and validate names the scene as an intent', async () => {
  const intent = { type: 'intent', narration: 'Two changes.', summary: 'Retry webhooks', bullets: ['backoff', 'a cap'], steps: [{ focus: 1, say: 'And a cap.', draw: [{ circle: 1 }, { circle: 'zzz' }] }] };
  assert.deepEqual(await errorsOf(intent), ['scenes[0].steps[0].draw[1].circle: "zzz" names nothing in this intent']);
});

const matrix = (draw) => ({
  type: 'tests',
  narration: 'Retries.',
  outcomes: ['Result', 'Calls'],
  situations: [
    { id: 'ok', when: 'it answers 200', expect: { Result: 'sent', Calls: '1' } },
    { id: 'retry', when: 'it answers 500', expect: { Result: 'retried', Calls: '3' } },
    { id: 'down', when: 'it never answers', gap: 'nothing checks it' },
  ],
  tests: [
    { name: 'retries three times', status: 'added', checks: ['retry.Calls', 'retry.Result'] },
    { name: 'sends once', status: 'existing', checks: ['ok.Calls'] },
  ],
  steps: [{ focus: 'retry', say: 'On a 500 it retries.', draw }],
});

test('ink on a tests matrix names a cell, a situation, an outcome, a gap and a test by the cells it checks', async () => {
  const scene = matrix([{ circle: 'retry.Calls', note: '3 calls' }, { box: 'ok' }, { tick: 'Calls' }, { cross: 'down' }, { underline: 'retries three times' }]);
  assert.deepEqual(inkBoard(scene).items.map((it) => it.targets), [
    [{ keys: ['x:1/1'] }],
    [{ keys: ['s:ok', 'x:0/0', 'x:0/1'] }],
    [{ keys: ['o:1', 'x:0/1', 'x:1/1'] }],
    [{ keys: ['s:down'] }],
    [{ keys: ['t:0', 'x:1/1', 'x:1/0'] }],
  ]);
  assert.deepEqual(await errorsOf(matrix([{ circle: 'retry.Waits' }])), ['scenes[0].steps[0].draw[0].circle: "retry.Waits" names nothing in this tests; did you mean "retry"?']);
});

test('validate warns when text written at a point lands on a tests matrix, and not below it', async () => {
  const warningsOf = async (scene) => (await validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' })).warnings.filter((w) => w.includes('.at:'));
  assert.deepEqual(await warningsOf(matrix([{ write: 'here', at: [0.5, 0.3] }])), ['scenes[0].steps[0].draw[0].at: the text lands on "ok"; move it to free space, or write it near a ref']);
  assert.deepEqual(await warningsOf(matrix([{ write: 'here', at: [0.02, 0.97] }])), []);
});
