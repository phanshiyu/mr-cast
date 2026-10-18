import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { formatValidation } from '../bin/lib/summary.mjs';
import { normalizeStoryboard } from '../shared/normalize.mjs';
import { resolveRef } from '../shared/targets.mjs';
import { testsMatrix, upgradeTests } from '../shared/tests.mjs';

const bundled = await build({ entryPoints: [new URL('../src/utils/testsLayout.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { layoutTests } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const hunk = (id, file) => ({ id, file, oldFile: null, status: 'added', language: 'typescript', header: '', startLine: 1, oldStartLine: 0, endLine: 1, additions: 1, deletions: 0, beforeCode: '', afterCode: '', lines: [{ type: 'add', oldLine: null, newLine: 1, text: 'x();' }] });
const hunks = { h1: hunk('h1', 'src/deliver.ts'), h2: hunk('h2', 'test/deliver.test.ts') };

// The webhook delivery matrix from examples/primitives/tests, cut down.
const matrix = (over = {}) => ({
  type: 'tests',
  title: 'Delivery tests',
  narration: 'Three tests check delivery.',
  when: 'When the receiver…',
  outcomes: ['Result', 'Calls'],
  situations: [
    { id: 'ok', when: 'answers 200', expect: { Result: 'delivered', Calls: '1' } },
    { id: 'retry', when: '503, 503, then 200', expect: { Result: 'delivered', Calls: '3' } },
    { id: 'silent', when: 'never answers', gap: 'nothing tries this: each try waits forever' },
  ],
  tests: [
    { name: 'retries a 503 until it succeeds', checks: ['retry.Result', 'retry.Calls'], hunkId: 'h2' },
    { name: 'returns delivered on 200', status: 'modified', checks: ['ok.Result'] },
    { name: 'throws when the receiver errors', status: 'removed', checks: ['ok.Result'], was: 'threw' },
  ],
  ...over,
});
const run = (scene, extra = {}) => validateStoryboard({ title: 'Retries', scenes: [scene], ...extra }, hunks);
const at = (list, prefix) => list.filter((m) => m.startsWith(prefix));

test('a check naming a missing situation or outcome, and duplicate ids and outcomes, fail', async () => {
  const { errors } = await run(matrix({
    outcomes: ['Result', 'Calls', 'Result'],
    situations: [...matrix().situations, { id: 'ok', when: 'answers 200 again', expect: { Result: 'delivered', Waits: 'none' } }],
    tests: [{ name: 'a', checks: ['retyr.Calls', 'retry.Cals', 'ok.Result'] }],
  }));
  assert.deepEqual(errors, [
    'scenes[0].outcomes[2]: duplicate outcome "Result"',
    'scenes[0].situations[3].id: duplicate id "ok"',
    'scenes[0].situations[3].expect: "Waits" is no outcome; outcomes are "Result", "Calls"',
    'scenes[0].tests[0].checks[0]: "retyr.Calls" names no situation; a check is "situation.Outcome", with a situation id of "ok", "retry", "silent"; did you mean "retry"?',
    'scenes[0].tests[0].checks[1]: "retry.Cals" names no outcome "Cals"; outcomes are "Result", "Calls"; did you mean "Calls"?',
  ]);
});

test('a live test checking a cell with no promised value warns; a removed one, and gap beside expect, as said', async () => {
  const { errors, warnings } = await run(matrix({
    situations: [...matrix().situations, { id: 'bad', when: 'answers 400', expect: { Result: 'failed' }, gap: 'nobody checks the calls' }],
    tests: [
      { name: 'checks a bare cell', checks: ['bad.Calls'] },
      { name: 'used to check a bare cell', status: 'removed', checks: ['silent.Result'], was: 'hung' },
    ],
  }));
  assert.deepEqual(errors, []);
  assert.deepEqual(at(warnings, 'scenes[0].situations'), ['scenes[0].situations[3].gap: is not drawn, since the situation has promises in expect; drop expect to draw the row as a gap, or drop gap']);
  assert.deepEqual(at(warnings, 'scenes[0].tests'), [
    'scenes[0].tests[0].checks[0]: "bad.Calls" is a cell with no expect value, so it draws a tick with nothing beside it; add "Calls" to situation "bad"\'s expect',
  ]);
});

test('each cell shows checked, unchecked, removed or nothing, with the status of the tests that check it', () => {
  const { rows, counts } = testsMatrix(matrix());
  const show = (r) => r.cells.map((c) => [c.outcome, c.state, c.status, c.was]);
  assert.deepEqual(show(rows[0]), [['Result', 'checked', 'modified', ['threw']], ['Calls', 'unchecked', null, []]]);
  assert.deepEqual(show(rows[1]), [['Result', 'checked', 'added', []], ['Calls', 'checked', 'added', []]]);
  assert.equal(rows[2].gap, true);
  assert.deepEqual(counts, { tests: 3, added: 1, modified: 1, removed: 1, existing: 0, gaps: 1, unchecked: 1 });
});

test('a ref is a situation, a cell, an outcome or a test, and a test lights every cell it checks', () => {
  const scene = matrix();
  assert.deepEqual(resolveRef(scene, 'retry'), ['s:retry', 'x:1/0', 'x:1/1']);
  assert.deepEqual(resolveRef(scene, 'silent'), ['s:silent']);
  assert.deepEqual(resolveRef(scene, 'ok.Calls'), ['x:0/1']);
  assert.deepEqual(resolveRef(scene, 'Calls'), ['o:1', 'x:0/1', 'x:1/1']);
  assert.deepEqual(resolveRef(scene, 'retries a 503 until it succeeds'), ['t:0', 'x:1/0', 'x:1/1']);
  assert.equal(resolveRef(scene, 'nothing'), null);
});

test('a step that focuses a test names it in the callout, as written, unless it sets its own', () => {
  const scene = matrix({
    tests: [...matrix().tests, { name: 'keeps `*` and [x] as written', checks: ['ok.Calls'] }],
    steps: [
      { focus: 'retries a 503 until it succeeds', say: 'One.' },
      { focus: ['returns delivered on 200', 'throws when the receiver errors'], say: 'Two.' },
      { focus: 'keeps `*` and [x] as written', say: 'Three.' },
      { focus: 'retry', say: 'Four.' },
      { focus: 'retries a 503 until it succeeds', callout: 'my own', say: 'Five.' },
    ],
  });
  const out = normalizeStoryboard({ title: 't', scenes: [scene] }, hunks).scenes[0];
  assert.deepEqual(out.steps.map((s) => s.callout), [
    '[NEW]{good} retries a 503 until it succeeds',
    '[CHANGED]{accent} returns delivered on 200 · [REMOVED]{bad} throws when the receiver errors',
    '[NEW]{good} keeps \\`\\*\\` and \\[x\\] as written',
    '',
    'my own',
  ]);
});

test('words naming a situation, an outcome or a test that the step leaves dark are warned', async () => {
  const steps = [
    { focus: 'ok', say: 'When the receiver answers 200 it is delivered at once.' },
    { focus: 'silent', say: 'A 503, 503, then 200 retries.' },
    { focus: 'retry.Calls', say: 'The retries a 503 until it succeeds test counts the calls.' },
    { focus: 'retries a 503 until it succeeds', say: 'It retries a 503 until it succeeds.' },
  ];
  const { warnings } = await run(matrix({ steps }));
  assert.deepEqual(at(warnings, 'scenes[0].steps'), [
    'scenes[0].steps[1]: says "503 503 then 200" (situation retry "503, 503, then 200"), which is not lit; it lights situation silent "never answers" gap: nothing tries this: each try waits forever. Focus what the words name, or say only what is lit',
  ]);
});

test('a test links its hunk, which counts as shown, and the summary counts tests and gaps', async () => {
  const result = await run(matrix());
  assert.deepEqual(result.coverage.tests, { shown: 1, total: 1 });
  assert.deepEqual(result.coverage.testsScene, { tests: 3, gaps: 1 });
  const line = formatValidation(result, { storyboard: normalizeStoryboard({ title: 'Retries', scenes: [matrix()] }, hunks), hunks, seconds: 10 }).at(-1);
  assert.match(line, /tests 1\/1 shown · tests scene: 3 tests, 1 gap$/);
});

test('a value too long for its cell, and a matrix too tall to read, are reported', async () => {
  const long = matrix({ situations: [{ id: 'ok', when: 'answers 200', expect: { Result: 'delivered '.repeat(120), Calls: '1' } }], tests: [] });
  const { errors } = await run(long);
  assert.deepEqual(errors.map((e) => e.replace(/"delivered (delivered )+delivered "/, '"…"')), [
    'scenes[0].situations[0].expect.Result: "…" does not fit its promised value, even at 15px; shorten the value to a word or a number, e.g. "3" or "1, 4, 16 s", or use fewer outcomes',
  ]);
  const many = matrix({ situations: Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, when: `situation ${i}`, expect: { Result: 'ok', Calls: '1' } })), tests: [] });
  assert.deepEqual((await run(many)).errors, [
    'scenes[0].situations: the tests scene does not fit the screen at the smallest readable size; split the situations into two tests scenes, or use fewer outcomes',
  ]);
  const twelve = matrix({ situations: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, when: `situation ${i}`, expect: { Result: 'ok', Calls: '1' } })), tests: [] });
  assert.deepEqual((await run(twelve)).errors, []);
});

test('test names show in a column when every value fits beside it, else a count per row', () => {
  const wide = layoutTests(matrix(), 1712, 700);
  assert.deepEqual(wide.rows.map((r) => r.names.map((n) => [n.fit.text, n.removed])), [
    [['returns delivered on 200', false], ['throws when the receiver errors', true]],
    [['retries a 503 until it succeeds', false]],
    [],
  ]);
  const narrow = layoutTests(matrix(), 900, 700);
  assert.equal(narrow.namesCol, null);
  assert.deepEqual(narrow.rows.map((r) => r.count), ['', '', '']);
  const shared = matrix({ tests: [...matrix().tests, { name: 'counts the calls on retry', checks: ['retry.Calls'] }] });
  assert.deepEqual(layoutTests(shared, 900, 700).rows.map((r) => r.count), ['1 test', '2 tests', '']);
});

test('an older scene with cases and gaps reads as a matrix with one outcome, and still validates', async () => {
  const old = {
    type: 'tests',
    subject: 'deliver',
    narration: 'Two tests cover delivery, and one is removed.',
    titles: { proves: 'Checks' },
    cases: [
      { name: 'retries a 503', proves: 'Two errors, then **delivered**', hunkId: 'h2', badge: 'edge case' },
      { name: 'waits', proves: 'The waits grow', status: 'existing' },
      { name: 'throws on 500', proves: 'A 500 threw', status: 'removed' },
    ],
    gaps: ['A receiver that never answers'],
    steps: [{ focus: [0, 'waits'], say: 'Two tests.' }, { focus: 'gap:0', say: 'And a gap.' }, { focus: 'missing', say: 'Nothing.' }],
  };
  assert.deepEqual(upgradeTests(old), {
    type: 'tests',
    subject: 'deliver',
    narration: 'Two tests cover delivery, and one is removed.',
    when: 'Test',
    outcomes: ['Checks'],
    situations: [
      { id: 'case 1', when: 'retries a 503', expect: { Checks: 'Two errors, then **delivered**' } },
      { id: 'case 2', when: 'waits', expect: { Checks: 'The waits grow' } },
      { id: 'case 3', when: 'throws on 500' },
      { id: 'gap 1', when: 'A receiver that never answers', gap: 'Not tested' },
    ],
    tests: [
      { name: 'retries a 503', checks: ['case 1.Checks'], hunkId: 'h2' },
      { name: 'waits', status: 'existing', checks: ['case 2.Checks'] },
      { name: 'throws on 500', status: 'removed', checks: ['case 3.Checks'], was: 'A 500 threw' },
    ],
    steps: [{ focus: ['case 1', 'case 2'], say: 'Two tests.' }, { focus: 'gap 1', say: 'And a gap.' }, { focus: 'missing', say: 'Nothing.' }],
  });
  const { errors, coverage } = await run({ ...old, steps: old.steps.slice(0, 2) });
  assert.deepEqual(errors, []);
  assert.deepEqual([coverage.tests, coverage.testsScene], [{ shown: 1, total: 1 }, { tests: 3, gaps: 1 }]);
  const current = matrix();
  assert.equal(upgradeTests(current), current);
});
