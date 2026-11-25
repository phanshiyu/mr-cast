import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { formatOutline, formatValidation } from '../bin/lib/summary.mjs';
import { mixLine } from '../shared/brief.mjs';

const line = (type, newLine, text) => ({
  type,
  oldLine: type === 'add' ? null : newLine,
  newLine: type === 'del' ? null : newLine,
  text,
});
const hunk = (id, file, lines) => ({
  id,
  file,
  oldFile: null,
  status: 'modified',
  language: 'javascript',
  header: '',
  startLine: 1,
  oldStartLine: 1,
  endLine: lines.length,
  additions: lines.filter((l) => l.type === 'add').length,
  deletions: lines.filter((l) => l.type === 'del').length,
  beforeCode: '',
  afterCode: '',
  lines,
});
const hunks = {
  h1: hunk('h1', 'src/limiter.js', [line('del', 1, 'return true;'), line('add', 1, 'return count < 20;')]),
  h2: hunk('h2', 'src/server.js', [line('add', 1, 'app.use(rateLimit);')]),
  h3: hunk('h3', 'test/limiter.test.js', [line('add', 1, "test('refuses the twenty-first order', () => {});")]),
};
const code = (id = 'h1', over = {}) => ({ type: 'code', hunkId: id, narration: 'The limiter counts.', ...over });
const text = (over = {}) => ({
  type: 'text',
  headline: 'Orders are limited',
  narration: 'The branch limits orders.',
  ...over,
});
const warningsOf = async (scenes, meta = { mode: 'diff' }, extra = {}) =>
  (await validateStoryboard({ title: 'T', scenes, ...extra }, hunks, meta)).warnings;
const matching = (warnings, re) => warnings.filter((w) => re.test(w));

test('the mix line counts each type, most first, and names the longest run', () => {
  const scenes = [text(), ...Array.from({ length: 7 }, () => code()), { type: 'state' }];
  assert.equal(mixLine(scenes), 'scenes: 9 · code 7, text 1, state 1 · longest run: 7 code');
  assert.equal(mixLine([]), null);
  assert.equal(mixLine(undefined), null);
});

test('validate and outline print the mix line, for any video', async () => {
  const sb = { title: 'T', scenes: [text(), code(), code('h2')] };
  const result = await validateStoryboard(sb, hunks, { mode: 'diff' });
  const lines = formatValidation(result, { storyboard: sb, hunks, seconds: 5 });
  assert.equal(lines.at(-2), 'scenes: 3 · code 2, text 1 · longest run: 2 code');
  assert.match(lines.at(-1), /^✓ storyboard ok/);
  const outline = formatOutline({ storyboard: sb, hunks, coverage: result.coverage, seconds: 5, voiced: false });
  assert.ok(outline.split('\n').includes('scenes: 3 · code 2, text 1 · longest run: 2 code'));
});

test('four scenes of one type in a row are reported for a branch, three are not', async () => {
  const four = [text(), code(), code(), code(), code(), text()];
  assert.deepEqual(matching(await warningsOf(four), /in a row/), [
    'scenes[1] to scenes[4]: 4 code scenes in a row; the viewer sees 4 of the same kind without a change of view',
  ]);
  assert.deepEqual(matching(await warningsOf(four.slice(0, 4)), /in a row/), []);
  assert.deepEqual(matching(await warningsOf(four, { mode: 'diff', quick: true }), /in a row/), []);
  assert.deepEqual(matching(await warningsOf(four, { mode: 'explain' }), /in a row/), []);
});

const flow = (payload) => ({
  type: 'flow',
  narration: 'A request arrives.',
  steps: [{ actor: 'Client', action: 'sends it', payload }],
});

test('a flow payload that is a sentence is reported in every video; code and values are not', async () => {
  const sentence = 'the order was refused as the limit was hit';
  for (const meta of [{ mode: 'diff' }, { mode: 'explain' }, { mode: 'diff', quick: true }]) {
    const w = matching(await warningsOf([flow(sentence)], meta), /payload/);
    assert.deepEqual(w, [
      `scenes[0].steps[0].payload: "${sentence}" is 9 words with no digit, quote, bracket, equals sign or colon, so it reads as a sentence; payload is drawn as one line of code`,
    ]);
  }
  for (const ok of [
    'status pending, next try in 10 s',
    '{ ok: true }',
    'order = refused for this address now',
    'too short for one',
    'it says "no" to the order from this address',
  ]) {
    assert.deepEqual(matching(await warningsOf([flow(ok)]), /payload/), [], ok);
  }
});

const graph = (labels, over = {}) => ({
  type: 'graph',
  narration: 'The pieces.',
  nodes: labels.map((label, i) => ({ id: `n${i}`, label })),
  edges: [],
  ...over,
});

test('a diagram whose labels are mostly in an earlier one is named with the shared labels', async () => {
  const scenes = [
    graph(['Client', 'Gateway', 'Limiter', 'Orders']),
    text(),
    {
      type: 'sequence',
      narration: 'Over time.',
      participants: [
        { id: 'a', label: 'client' },
        { id: 'b', label: ' GATEWAY ' },
        { id: 'c', label: 'Limiter' },
        { id: 'd', label: 'Queue' },
      ],
      messages: [{ from: 'a', to: 'b', label: 'order' }],
    },
  ];
  assert.deepEqual(matching(await warningsOf(scenes, { mode: 'explain' }), /repeats/), []);
  const w = matching(
    await warningsOf(
      scenes.slice(0, 3).map((s, i) => (i === 2 ? { ...s, messages: [{ from: 'a', to: 'b', label: 'order' }] } : s)),
    ),
    /repeats/,
  );
  assert.equal(w.length, 0, 'three of five labels is under 70%');
  scenes[2].participants[3].label = 'Orders';
  scenes[2].messages[0].label = 'Orders';
  assert.deepEqual(matching(await warningsOf(scenes, { mode: 'explain' }), /repeats/), [
    'scenes[2] (sequence) repeats scenes[0] (graph): 4 of its 4 labels are in the earlier diagram ("client", "gateway", "limiter", "orders"); the viewer sees the same diagram again',
  ]);
});

test('a diagram with fewer than three labels is not called a repeat', async () => {
  assert.deepEqual(matching(await warningsOf([graph(['A', 'B']), graph(['A', 'B'])]), /repeats/), []);
});

const brief = (over = {}) => ({
  why: { text: 'Bots.', source: 'unknown' },
  case: { before: 'The twenty-first order was accepted.', after: 'It is refused.', cite: ['h1'] },
  ...over,
});
const caseWarnings = async (scene, over = {}) =>
  matching(
    await warningsOf([{ ...scene, answers: ['case'] }], { mode: 'diff' }, { brief: brief(over) }),
    /^case: a before and an after/,
  );

test('a case with a before and an after must be on screen in both states in a scene that answers it', async () => {
  const bad = /none of the 1 scene marked for "case" \(text\) puts both on screen/;
  assert.match((await caseWarnings(text()))[0], bad);
  assert.deepEqual(await caseWarnings(code('h1')), []);
  assert.match((await caseWarnings(code('h2')))[0], /code\)/, 'only added lines');
  assert.match(
    (await caseWarnings(code('h1', { typing: true, steps: [] })))[0],
    /code\)/,
    'typing hides removed lines',
  );
  assert.match(
    (await caseWarnings(code('h1'), { case: { before: 'a', after: 'b', cite: ['h2'] } }))[0],
    /code\)/,
    'not the cited hunk',
  );
  const compare = (cells) => ({ type: 'compare', narration: 'Two.', rows: [{ cells }] });
  assert.deepEqual(await caseWarnings(compare(['accepted', 'refused'])), []);
  assert.equal((await caseWarnings(compare(['same', 'same']))).length, 1);
  const table = (cell) => ({ type: 'table', narration: 'Rows.', columns: ['Order'], rows: [{ cells: [cell] }] });
  assert.deepEqual(await caseWarnings(table({ before: 'accepted', after: 'refused' })), []);
  assert.equal((await caseWarnings(table('accepted'))).length, 1);
  assert.deepEqual(
    await caseWarnings({
      type: 'terminal',
      narration: 'Runs.',
      entries: [
        { command: 'run', output: 'ok' },
        { command: 'run', output: 'refused' },
      ],
    }),
    [],
  );
  assert.equal(
    (await caseWarnings({ type: 'terminal', narration: 'Run.', entries: [{ command: 'run', output: 'ok' }] })).length,
    1,
  );
});

test('the case is not checked when it is unknown, when nothing answers it, or outside a branch', async () => {
  assert.deepEqual(await caseWarnings(text(), { case: 'unknown' }), []);
  const unanswered = await warningsOf([text()], { mode: 'diff' }, { brief: brief() });
  assert.deepEqual(matching(unanswered, /^case: a before and an after/), []);
  assert.deepEqual(
    matching(
      await warningsOf([{ ...text(), answers: ['case'] }], { mode: 'explain' }, { brief: brief() }),
      /a before and an after are written/,
    ),
    [],
  );
});

const map = (over = {}) => ({
  commits: [],
  files: { tests: [{ file: 'test/limiter.test.js', hunkIds: ['h3'] }] },
  tests: [{ file: 'test/limiter.test.js', covers: [], adds: ['refuses the twenty-first order', 'counts per address'] }],
  ...over,
});
const testWarnings = async (scenes, m = map()) =>
  matching(await warningsOf(scenes, { mode: 'diff', map: m }), /^tests:/);

test('tests the map lists are reported when no scene names one or shows a test hunk', async () => {
  const [w] = await testWarnings([text(), code('h1')]);
  assert.equal(
    w,
    'tests: this branch adds 2 named tests ("refuses the twenty-first order", "counts per address"), and no scene draws the name of any of them or shows a test hunk; the viewer hears of the tests but sees none',
  );
});

test('a test name in a table cell or a tests scene, or a test hunk, counts as shown; narration does not', async () => {
  assert.equal((await testWarnings([text({ narration: 'It refuses the twenty-first order.' })])).length, 1);
  const table = {
    type: 'table',
    narration: 'Rows.',
    columns: ['Test'],
    rows: [{ cells: ['Refuses the twenty-first order'] }],
  };
  assert.deepEqual(await testWarnings([table]), []);
  assert.deepEqual(await testWarnings([code('h3')]), []);
  const tests = {
    type: 'tests',
    narration: 'Tests.',
    outcomes: ['Result'],
    situations: [{ id: 'over', when: 'the 21st order', expect: { Result: 'refused' } }],
    tests: [{ name: 'counts per address', checks: ['over.Result'] }],
  };
  assert.deepEqual(await testWarnings([tests]), []);
  assert.deepEqual(await testWarnings([text(), code('h1')], map({ tests: [] })), []);
  assert.deepEqual(await testWarnings([text(), code('h1')], null), []);
  assert.deepEqual(matching(await warningsOf([text()], { mode: 'diff', quick: true, map: map() }), /^tests:/), []);
});
