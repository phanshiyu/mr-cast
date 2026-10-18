import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { formatOutline } from '../bin/lib/summary.mjs';
import { compareRowSame } from '../shared/compare.mjs';
import { resolveRef, stepTargets } from '../shared/targets.mjs';

const bundled = await build({ entryPoints: [new URL('../src/utils/compareLayout.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { layoutCompare } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const compare = {
  type: 'compare',
  narration: 'The same order, under the old rules and the new ones.',
  sides: [{ title: 'Redis' }, { title: 'In-process LRU', tone: 'good' }],
  rows: [
    { label: 'Lookup', cells: ['One network hop', 'A map read'], verdict: [null, 'good'] },
    { label: 'Outage', cells: ['Requests fail', 'Keeps serving'], verdict: ['bad', 'good'] },
    { label: 'Code', cells: [{ code: 'await redis.get(key);', lang: 'ts' }, { code: 'lru.get(key);', lang: 'ts' }] },
    { label: 'Eviction', cells: ['By TTL', 'By TTL'] },
  ],
};

const terminal = {
  type: 'terminal',
  narration: 'The test run fails, then passes after the fix.',
  window: 'zsh: ~/app',
  entries: [
    { command: 'npm test', output: 'FAIL src/price.test.ts\n  Expected: 1299\n  Received: undefined', exit: 1 },
    { command: 'git apply fix.patch' },
    { command: 'npm test', output: 'Tests: [12 passed]{good}', exit: 0 },
  ],
};

const board = (...scenes) => ({ title: 'Primitives', scenes: [{ type: 'intent', narration: 'Two new scenes.', summary: 'Two new scenes', bullets: ['compare', 'terminal'] }, ...scenes] });
const check = (...scenes) => validateStoryboard(board(...scenes), {}, { mode: 'explain' });
const has = (list, text) => assert.ok(list.some((m) => m.includes(text)), `no message with ${JSON.stringify(text)} in:\n${list.join('\n')}`);

test('compare refs name rows, ranges, sides by index or title, and cells', () => {
  assert.deepEqual(resolveRef(compare, 1), ['r:1']);
  assert.deepEqual(resolveRef(compare, '0-2'), ['r:0', 'r:1', 'r:2']);
  assert.deepEqual(resolveRef(compare, 'side:Redis'), ['s:0']);
  assert.deepEqual(resolveRef(compare, 'side:1'), ['s:1']);
  assert.deepEqual(resolveRef(compare, '2@In-process LRU'), ['x:2/1']);
  assert.deepEqual(resolveRef(compare, '3@0'), ['x:3/0']);
  assert.equal(resolveRef(compare, 'side:After'), null);
  assert.equal(resolveRef(compare, '4@Redis'), null);
  assert.equal(resolveRef(compare, '@Redis'), null);
});

test('a compare without sides is titled Before and After', () => {
  const plain = { ...compare, sides: undefined };
  assert.deepEqual(resolveRef(plain, 'side:Before'), ['s:0']);
  assert.deepEqual(resolveRef(plain, '1@After'), ['x:1/1']);
});

test('a row is the same when its cells are equal, unless it says otherwise', () => {
  assert.equal(compareRowSame(compare.rows[3]), true);
  assert.equal(compareRowSame(compare.rows[0]), false);
  assert.equal(compareRowSame({ cells: ['By TTL', 'By TTL'], same: false }), false);
  assert.equal(compareRowSame({ cells: ['Fast', 'Faster'], same: true }), true);
  assert.equal(compareRowSame({ cells: [{ code: 'a()' }, { code: 'a()' }] }), true);
});

test('terminal refs name entries, ranges and output lines', () => {
  assert.deepEqual(resolveRef(terminal, 2), ['en:2']);
  assert.deepEqual(resolveRef(terminal, '0-1'), ['en:0', 'en:1']);
  assert.deepEqual(resolveRef(terminal, '0:2'), ['ln:0/2']);
  assert.equal(resolveRef(terminal, '0:3'), null);
  assert.equal(resolveRef(terminal, '1:0'), null, 'entry 1 printed nothing');
  assert.equal(resolveRef(terminal, '3'), null);
  assert.deepEqual(stepTargets({ ...terminal, steps: [{ focus: ['0:1', 2] }] }), [['ln:0/1', 'en:2']]);
});

test('a compare and a terminal with steps, marks and markup validate clean', async () => {
  const steps = { compare: [{ focus: '0-1', say: 'Lookups differ.' }, { focus: '2@1', mark: 'circle', note: 'no hop', say: 'The cache is a map read.' }, { focus: 3, say: 'Eviction is the same.' }] };
  const { errors, warnings } = await check(
    { ...compare, steps: steps.compare },
    { ...terminal, steps: [{ focus: 0, say: 'The tests fail.' }, { focus: '0:2', mark: 'underline', say: 'Nothing came back.' }, { focus: '1-2', say: 'After the fix the tests pass.' }] },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('compare rows need two cells, known verdicts and two distinct sides', async () => {
  const { errors } = await check({
    ...compare,
    sides: [{ title: 'A' }, { title: 'A' }],
    rows: [{ cells: ['only one'] }, { cells: ['a', { code: '' }], verdict: ['better', null] }],
  });
  has(errors, 'scenes[1].sides: both sides are titled "A"');
  has(errors, 'scenes[1].rows[0].cells: required array of two cells');
  has(errors, 'scenes[1].rows[1].cells[1]: must be text, { code, lang? } for a short snippet, or { image, fit? }');
  has(errors, 'scenes[1].rows[1].verdict[0]: must be one of good, bad, warn, or null');
});

test('compare steps that skip a row and a cell that cannot fit are reported', async () => {
  const long = 'This cell keeps going with words, '.repeat(12);
  const { errors, warnings } = await check({ ...compare, rows: [...compare.rows.slice(0, 3), { label: 'Eviction', cells: [long, 'By TTL'] }], steps: [{ focus: 0, say: 'Lookups differ.' }, { focus: 2, say: 'The code.' }] });
  has(errors, 'scenes[1].rows[3].cells[0]');
  has(warnings, 'scenes[1].steps: no step names rows 1, 3');
});

test('terminal entries need a command or output, one-line commands and whole exits', async () => {
  const { errors } = await check({ ...terminal, entries: [{ prompt: '#' }, { command: 'a\nb' }, { command: 'ls', exit: 1.5 }] });
  has(errors, 'scenes[1].entries[0]: give a command, an output, or both');
  has(errors, 'scenes[1].entries[1].command: one line');
  has(errors, 'scenes[1].entries[2].exit: must be a whole number');
});

test('unclosed markup in terminal output is reported where it is', async () => {
  const { errors } = await check({ ...terminal, entries: [{ command: 'ls', output: 'ok\nExpected `foo' }] });
  has(errors, 'scenes[1].entries[0].output: "Expected `foo" column');
});

test('a terminal wraps any line, however long', async () => {
  const unbroken = 'x'.repeat(600);
  const entries = [...terminal.entries, { command: 'cat build.log', output: `${unbroken}\n[ERROR]{bad} build failed at step 4 of 9` }];
  assert.deepEqual(await check({ ...terminal, entries }), { errors: [], warnings: [], coverage: null });
});

test('the outline names the sides and the failed commands', () => {
  const outline = formatOutline({ storyboard: board(compare, terminal), hunks: {}, coverage: null, seconds: 30, voiced: false });
  assert.match(outline, /Redis vs In-process LRU, 4 rows, 3 differ/);
  assert.match(outline, /zsh: ~\/app · 3 entries, 3 commands, 1 failed/);
});

test('a terminal entry with no command and empty output is rejected, since it draws nothing', async () => {
  const { errors } = await check({ ...terminal, entries: [{ output: '', exit: 2 }, { command: 'ls', output: '' }] });
  assert.deepEqual(errors, ['scenes[1].entries[0].output: empty, and the entry has no command, so it draws nothing; give a command or some output, or drop the entry']);
});

test('a prompt too long to leave the command room is reported, and a usual one fits', async () => {
  const long = await check({ ...terminal, entries: [{ prompt: `deploy@${'build-'.repeat(12)}:~/app $`, command: 'ls' }] });
  assert.deepEqual(long.errors, [
    'scenes[1].entries[0].prompt: "deploy@build-build-build-build-build-build-build-build-build-build-build-build-:~/app $" does not fit its prompt, even at 28px; shorten the prompt, e.g. "$" or "app=#"',
  ]);
  const usual = await check({ ...terminal, entries: [{ prompt: 'deploy@build-01:~/projects/app $', command: 'ls' }] });
  assert.deepEqual(usual.errors, []);
});

test('a compare cell breaks its line where it says "\\n", its row grows to hold it, and too many lines are reported', async () => {
  const scene = (cell) => ({ ...compare, rows: [{ label: 'Rise', cells: [cell, 'Fast'] }, { label: 'Crumb', cells: ['Tight', 'Open'] }] });
  const one = layoutCompare(scene('Slow, even'), 1712, 600);
  const two = layoutCompare(scene('Slow\neven'), 1712, 600);
  assert.deepEqual(two.rows[0].cells[0].text.lines.map((l) => l.map((r) => r.text).join('')), ['Slow', 'even']);
  assert.equal(two.rows[0].h - one.rows[0].h, 39);
  assert.equal(two.rows[1].y - one.rows[1].y, 39);
  assert.deepEqual((await validateStoryboard({ title: 't', scenes: [scene('Slow\neven')] }, {}, { mode: 'explain' })).errors, []);
  const { errors } = await validateStoryboard({ title: 't', scenes: [scene('One\ntwo\nthree\nfour')] }, {}, { mode: 'explain' });
  assert.deepEqual(errors, ['scenes[0].rows[0].cells[0]: "One\\ntwo\\nthree\\nfour" does not fit its compare cell, even at 18px; shorten the cell, or split the comparison into two scenes']);
});
