import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { formatValidation } from '../bin/lib/summary.mjs';
import { normalizeStoryboard } from '../shared/normalize.mjs';
import { resolveRef } from '../shared/targets.mjs';
import { testsMatrix, upgradeTests } from '../shared/tests.mjs';

const bundled = await build({
  entryPoints: [new URL('../src/utils/testsLayout.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { layoutTests } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const hunk = (id, file) => ({
  id,
  file,
  oldFile: null,
  status: 'added',
  language: 'typescript',
  header: '',
  startLine: 1,
  oldStartLine: 0,
  endLine: 1,
  additions: 1,
  deletions: 0,
  beforeCode: '',
  afterCode: '',
  lines: [{ type: 'add', oldLine: null, newLine: 1, text: 'x();' }],
});
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
  const { errors } = await run(
    matrix({
      outcomes: ['Result', 'Calls', 'Result'],
      situations: [
        ...matrix().situations,
        { id: 'ok', when: 'answers 200 again', expect: { Result: 'delivered', Waits: 'none' } },
      ],
      tests: [{ name: 'a', checks: ['retyr.Calls', 'retry.Cals', 'ok.Result'] }],
    }),
  );
  assert.deepEqual(errors, [
    'scenes[0].outcomes[2]: duplicate outcome "Result"',
    'scenes[0].situations[3].id: duplicate id "ok"',
    'scenes[0].situations[3].expect: "Waits" is no outcome; outcomes are "Result", "Calls"',
    'scenes[0].tests[0].checks[0]: "retyr.Calls" names no situation; a check is "situation.Outcome", with a situation id of "ok", "retry", "silent"; did you mean "retry"?',
    'scenes[0].tests[0].checks[1]: "retry.Cals" names no outcome "Cals"; outcomes are "Result", "Calls"; did you mean "Calls"?',
  ]);
});

test('a live test checking a cell with no promised value warns; a removed one, and gap beside expect, as said', async () => {
  const { errors, warnings } = await run(
    matrix({
      situations: [
        ...matrix().situations,
        { id: 'bad', when: 'answers 400', expect: { Result: 'failed' }, gap: 'nobody checks the calls' },
      ],
      tests: [
        { name: 'checks a bare cell', checks: ['bad.Calls'] },
        { name: 'used to check a bare cell', status: 'removed', checks: ['silent.Result'], was: 'hung' },
      ],
    }),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(at(warnings, 'scenes[0].situations'), [
    'scenes[0].situations[3].gap: is not drawn, since the situation has promises in expect; drop expect to draw the row as a gap, or drop gap',
  ]);
  assert.deepEqual(at(warnings, 'scenes[0].tests'), [
    'scenes[0].tests[0].checks[0]: "bad.Calls" is a cell with no expect value, so it draws a tick with nothing beside it; add "Calls" to situation "bad"\'s expect',
  ]);
});

test('each cell shows checked, unchecked, removed or nothing, with the status of the tests that check it', () => {
  const { rows, counts } = testsMatrix(matrix());
  const show = (r) => r.cells.map((c) => [c.outcome, c.state, c.status, c.was]);
  assert.deepEqual(show(rows[0]), [
    ['Result', 'checked', 'modified', ['threw']],
    ['Calls', 'unchecked', null, []],
  ]);
  assert.deepEqual(show(rows[1]), [
    ['Result', 'checked', 'added', []],
    ['Calls', 'checked', 'added', []],
  ]);
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
  assert.deepEqual(
    out.steps.map((s) => s.callout),
    [
      '[NEW]{good} retries a 503 until it succeeds',
      '[CHANGED]{accent} returns delivered on 200 · [REMOVED]{bad} throws when the receiver errors',
      '[NEW]{good} keeps \\`\\*\\` and \\[x\\] as written',
      '',
      'my own',
    ],
  );
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
  const line = formatValidation(result, {
    storyboard: normalizeStoryboard({ title: 'Retries', scenes: [matrix()] }, hunks),
    hunks,
    seconds: 10,
  }).at(-1);
  assert.match(line, /tests 1\/1 shown · tests scene: 3 tests, 1 gap$/);
});

test('a value too long for its cell, and a matrix too tall to read, are reported', async () => {
  const long = matrix({
    situations: [{ id: 'ok', when: 'answers 200', expect: { Result: 'delivered '.repeat(120), Calls: '1' } }],
    tests: [],
  });
  const { errors } = await run(long);
  assert.deepEqual(
    errors.map((e) => e.replace(/"delivered (delivered )+delivered "/, '"…"')),
    [
      'scenes[0].situations[0].expect.Result: "…" does not fit its promised value, even at 15px; shorten the value to a word or a number, e.g. "3" or "1, 4, 16 s", or use fewer outcomes',
    ],
  );
  const many = matrix({
    situations: Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`,
      when: `situation ${i}`,
      expect: { Result: 'ok', Calls: '1' },
    })),
    tests: [],
  });
  assert.deepEqual((await run(many)).errors, [
    'scenes[0].situations: the tests scene does not fit the screen at the smallest readable size; split the situations into two tests scenes, or use fewer outcomes',
  ]);
  const twelve = matrix({
    situations: Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      when: `situation ${i}`,
      expect: { Result: 'ok', Calls: '1' },
    })),
    tests: [],
  });
  assert.deepEqual((await run(twelve)).errors, []);
});

test('test names show in a column when every value fits beside it, else a count per row', () => {
  const wide = layoutTests(matrix(), 1712, 700);
  assert.deepEqual(
    wide.rows.map((r) => r.names.map((n) => [n.fit.text, n.removed])),
    [
      [
        ['returns delivered on 200', false],
        ['throws when the receiver errors', true],
      ],
      [['retries a 503 until it succeeds', false]],
      [],
    ],
  );
  const narrow = layoutTests(matrix(), 900, 700);
  assert.equal(narrow.namesCol, null);
  assert.deepEqual(
    narrow.rows.map((r) => r.count),
    ['', '', ''],
  );
  const shared = matrix({ tests: [...matrix().tests, { name: 'counts the calls on retry', checks: ['retry.Calls'] }] });
  assert.deepEqual(
    layoutTests(shared, 900, 700).rows.map((r) => r.count),
    ['1 test', '2 tests', ''],
  );
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
    steps: [
      { focus: [0, 'waits'], say: 'Two tests.' },
      { focus: 'gap:0', say: 'And a gap.' },
      { focus: 'missing', say: 'Nothing.' },
    ],
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
    steps: [
      { focus: ['case 1', 'case 2'], say: 'Two tests.' },
      { focus: 'gap 1', say: 'And a gap.' },
      { focus: 'missing', say: 'Nothing.' },
    ],
  });
  const { errors, coverage } = await run({ ...old, steps: old.steps.slice(0, 2) });
  assert.deepEqual(errors, []);
  assert.deepEqual(
    [coverage.tests, coverage.testsScene],
    [
      { shown: 1, total: 1 },
      { tests: 3, gaps: 1 },
    ],
  );
  const current = matrix();
  assert.equal(upgradeTests(current), current);
});

test('short test names fit under the TESTS header, in the matrix and in an older scene', async () => {
  const short = matrix({
    tests: [
      { name: 'a', checks: ['retry.Result'] },
      { name: 'ok', checks: ['ok.Result'] },
    ],
  });
  assert.deepEqual((await run(short)).errors, []);
  assert.equal(layoutTests(short, 1712, 700).namesCol.title.fits, true);
  const old = {
    type: 'tests',
    narration: 'Two tests cover delivery.',
    cases: [
      { name: 'a', proves: 'Retries' },
      { name: 'ok', proves: 'Delivers' },
    ],
  };
  assert.deepEqual((await run(old)).errors, []);
});

test('an older scene is reported in its own fields: cases, gaps and titles, not the matrix it reads as', async () => {
  const long = Array(40).fill('word').join(' ');
  const old = {
    type: 'tests',
    narration: 'Some tests cover delivery.',
    titles: { proves: 'Checks' },
    cases: [
      { name: 'retries a 503', proves: 'delivered', hunkId: 'nope' },
      { proves: 'unnamed', status: 'odd' },
      { name: 'throws', proves: long, status: 'removed' },
    ],
    gaps: [long, 7],
    steps: [{ focus: 9, say: 'Nothing.' }],
  };
  assert.deepEqual((await run(old)).errors, [
    'scenes[0].gaps[1]: required string, the gap',
    'scenes[0].cases[0].hunkId: "nope" not found in hunks.json',
    "scenes[0].cases[1].name: required string, the test's name as written in code",
    'scenes[0].cases[1].status: must be one of added, modified, removed, existing',
    'scenes[0].steps[0].focus: 9 names nothing in this scene, where a ref is a case\'s index or name, or "gap:0" for the first gap',
  ]);
  const fitting = {
    ...old,
    cases: [old.cases[0], { name: 'waits', proves: 'p' }, old.cases[2]].map(({ hunkId, ...c }) => c),
    gaps: [`${long} ${long}`],
    steps: undefined,
  };
  assert.deepEqual(
    (await run(fitting)).errors.map((m) => m.replace(`${long} ${long}`, 'LONGER').replace(long, 'LONG')),
    [
      'scenes[0].cases[2].proves: "LONG" does not fit its row, even at 15px; shorten what it proves',
      'scenes[0].gaps[0]: "LONGER" does not fit its row, even at 15px; shorten the gap',
    ],
  );
});

// Long names, as a real branch writes them: the names column wraps them and shrinks them before it reports one.
const LONG = 'returns the stored refs with their quoted lines when the reply names a tip, a commit and a base line';
const SHORT_VALUES = {
  outcomes: ['Result'],
  situations: [
    { id: 'a', when: 'names a tip', expect: { Result: 'stored' } },
    { id: 'b', when: 'names a bad place', expect: { Result: 'refused' } },
  ],
};
const named = (...names) =>
  matrix({
    ...SHORT_VALUES,
    tests: names.map((name, i) => ({ name, checks: [`${'ab'[i % 2]}.Result`] })),
  });

test('a long test name wraps onto a second line and shrinks before it is reported', async () => {
  const scene = named(LONG, 'is refused when a ref does not resolve');
  const layout = layoutTests(scene, 1712, 700);
  const first = layout.rows[0].names[0].fit;
  assert.equal(first.text, LONG, 'the name is drawn as written');
  assert.equal(first.fits, true);
  assert.ok(first.lines.length <= 2 && first.size >= 15);
  assert.deepEqual((await run(scene)).errors, []);
  assert.deepEqual(at((await run(scene)).warnings, 'scenes[0].tests'), []);
  const tooLong = named(`${LONG}, and then it keeps going ${LONG} ${LONG}`);
  const report = await run(tooLong);
  assert.ok(
    report.errors.some((m) => m.startsWith('scenes[0].tests[0].name') && m.includes('short `label`')),
    report.errors.join('\n'),
  );
});

test('a label is drawn in place of a name that cannot fit, and the name stays the title a step can focus', async () => {
  const huge = `${LONG}, and then it keeps going ${LONG} ${LONG}`;
  const scene = {
    ...named(huge),
    tests: [{ name: huge, label: 'stored refs keep their quote', checks: ['a.Result'] }],
    steps: [{ focus: huge, say: 'The stored refs keep their quote.' }],
  };
  assert.deepEqual((await run(scene)).errors, []);
  const layout = layoutTests(scene, 1712, 700);
  assert.equal(layout.rows[0].names[0].fit.text, 'stored refs keep their quote');
  assert.deepEqual(resolveRef(scene, huge, hunks), ['t:0', 'x:0/0']);
  assert.deepEqual(resolveRef(scene, 'stored refs keep their quote', hunks), ['t:0', 'x:0/0']);
  assert.match(
    normalizeStoryboard({ title: 'T', scenes: [scene] }, hunks).scenes[0].steps[0].callout,
    /stored refs keep their quote/,
  );
  const bad = await run({ ...scene, tests: [{ ...scene.tests[0], label: 3 }] });
  assert.ok(bad.errors.some((m) => m.startsWith('scenes[0].tests[0].label: must be a non-empty string')));
});

// A branch that adds 23 named tests in a test file, as `extract` reads them.
const addedNames = Array.from({ length: 23 }, (_, i) => `adds behaviour number ${i + 1}`);
const testHunks = {
  ...hunks,
  h2: {
    ...hunks.h2,
    lines: addedNames.map((name, i) => ({
      type: 'add',
      oldLine: null,
      newLine: i + 1,
      text: `  it('${name}', () => {});`,
    })),
  },
};
const branchMap = { tests: [{ file: 'test/deliver.test.ts', covers: [], adds: addedNames }] };

test('the footer says how many of the tests the branch adds the scene draws, from the diff', () => {
  const five = named('adds behaviour number 1', 'adds behaviour number 2');
  assert.equal(layoutTests(five, 1712, 700, testHunks).counts, '2 of 23 tests this branch adds');
  assert.equal(
    layoutTests(five, 1712, 700).counts,
    '2 tests',
    "with no added tests in the diff, the count is the scene's",
  );
  const mixed = matrix({ tests: [...matrix().tests, { name: 'adds behaviour number 3', checks: ['ok.Result'] }] });
  assert.equal(
    layoutTests(mixed, 1712, 700, testHunks).counts,
    '2 of 23 tests this branch adds · 1 changed · 1 removed · 1 unchecked · 1 gap',
  );
  const more = named(...addedNames.slice(0, 3));
  assert.equal(
    layoutTests(more, 1712, 700, { ...hunks, h2: { ...testHunks.h2, lines: testHunks.h2.lines.slice(0, 2) } }).counts,
    '3 tests',
    'never more drawn than the branch adds',
  );
});

test('validate warns when a test name is none the branch adds, and checks no name without a map', async () => {
  const scene = named('adds behaviour number 1', 'shortened name');
  const meta = { mode: 'diff', map: branchMap };
  const warned = (await validateStoryboard({ title: 'T', scenes: [scene] }, testHunks, meta)).warnings;
  assert.deepEqual(at(warned, 'scenes[0].tests'), [
    'scenes[0].tests[1].name: "shortened name"; no test this branch adds has this name; `name` is the test\'s title as written in code (see "adds" in map.json), and a short `label` is what the scene draws',
  ]);
  const quick = await validateStoryboard({ title: 'T', scenes: [scene] }, testHunks, { ...meta, quick: true });
  assert.deepEqual(at(quick.warnings, 'scenes[0].tests'), []);
  const none = await validateStoryboard({ title: 'T', scenes: [scene] }, testHunks, { mode: 'diff' });
  assert.deepEqual(at(none.warnings, 'scenes[0].tests'), []);
  const existing = { ...scene, tests: scene.tests.map((t) => ({ ...t, status: 'existing' })) };
  assert.deepEqual(
    at((await validateStoryboard({ title: 'T', scenes: [existing] }, testHunks, meta)).warnings, 'scenes[0].tests'),
    [],
  );
});

test('validate warns when a tests scene names none of the tests the branch adds', async () => {
  const meta = { mode: 'diff', map: branchMap };
  const warned = (await validateStoryboard({ title: 'T', scenes: [{ ...named(), tests: [] }] }, testHunks, meta))
    .warnings;
  assert.deepEqual(at(warned, 'scenes[0].tests'), [
    'scenes[0].tests: the branch adds 23 tests and this tests scene names none of them, so its footer reads "0 of 23 tests this branch adds"; list tests from "adds" in map.json, each with its `name`, `checks` and `hunkId` (fields: `mr-cast schema tests`, references/scenes/tests.md)',
  ]);
  const some = (await validateStoryboard({ title: 'T', scenes: [named('adds behaviour number 1')] }, testHunks, meta))
    .warnings;
  assert.deepEqual(at(some, 'scenes[0].tests'), []);
});

test('validate warns when a count of tests the scene states disagrees with the map', async () => {
  const meta = { mode: 'diff', map: branchMap };
  const say = async (over) =>
    at(
      (
        await validateStoryboard(
          { title: 'T', scenes: [{ ...named('adds behaviour number 1', 'adds behaviour number 2'), ...over }] },
          testHunks,
          meta,
        )
      ).warnings,
      'scenes[0].',
    ).filter((m) => m.includes('says'));
  assert.deepEqual(await say({ narration: 'Two new tests check delivery.' }), [
    'scenes[0].narration: says "Two new tests", but the map lists 23 tests this branch adds and the scene draws 2 of them; say "2 of the 23", or the number the map has',
  ]);
  assert.deepEqual(await say({ narration: 'Two of the 23 new tests check delivery.' }), []);
  assert.deepEqual(await say({ narration: 'The branch adds 23 tests.' }), []);
  assert.equal((await say({ narration: 'Fine.', title: '2 tests · 1 gap' })).length, 1);
  assert.equal(
    (await say({ narration: 'Fine.', steps: [{ focus: 'a', callout: '5 new tests', say: 'x' }] })).length,
    1,
  );
});
