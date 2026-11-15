import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { codeRows } from '../shared/flow-code.mjs';

const lines = (from, texts, type = 'context') =>
  texts.map((text, i) => ({ type, oldLine: from + i, newLine: from + i, text }));
const body = Array.from({ length: 40 }, (_, i) => `const value${i} = compute(${i});`);
const hunks = {
  h5: {
    id: 'h5',
    file: 'src/limiter.ts',
    oldFile: null,
    status: 'modified',
    language: 'typescript',
    header: '',
    startLine: 10,
    oldStartLine: 10,
    endLine: 49,
    additions: 0,
    deletions: 0,
    beforeCode: '',
    afterCode: '',
    lines: lines(10, body),
  },
  s2: {
    id: 's2',
    file: 'src/server.ts',
    oldFile: null,
    status: 'source',
    language: 'typescript',
    header: '',
    startLine: 1,
    oldStartLine: 1,
    endLine: 3,
    additions: 0,
    deletions: 0,
    beforeCode: '',
    afterCode: '',
    lines: lines(1, ['a();', 'b();', 'c();']),
  },
};
const stage = (extra) => ({ actor: 'limiter', action: 'counts the request', ...extra });
const check = async (steps, meta = { mode: 'diff' }) =>
  validateStoryboard({ title: 'Flows', scenes: [{ type: 'flow', narration: 'One request.', steps }] }, hunks, meta);

test('a stage with real lines passes, and lines it shows count as shown hunks', async () => {
  const r = await check([
    stage({ code: { hunk: 'h5', lines: '12-20', light: '14-15' } }),
    stage({ code: { snippet: 's2', lines: 2 } }),
  ]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.coverage.shown, 1);
});

test('a hunk, snippet or range that does not exist is an error', async () => {
  const errors = async (code) => (await check([stage({ code })])).errors;
  assert.match((await errors({ hunk: 'h99', lines: '1-2' }))[0], /code\.hunk: "h99" not found in hunks.json/);
  assert.match((await errors({ snippet: 's9', lines: '1-2' }))[0], /code\.snippet: "s9" not found/);
  assert.match((await errors({ hunk: 'h5', lines: '5-20' }))[0], /lines: 5-20 is outside h5 \(it has lines 10-49\)/);
  assert.match(
    (await errors({ hunk: 'h5', lines: '12-20', light: '30' }))[0],
    /light: 30 is not among the lines shown/,
  );
  assert.match((await errors({ hunk: 's2', lines: '1-2' }))[0], /is a snippet; use "snippet"/);
  assert.match((await errors({ snippet: 'h5', lines: '12-13' }))[0], /is a diff hunk; use "hunk"/);
  assert.match((await errors({ hunk: 'h5' }))[0], /lines/);
});

test('code and payload together, and code in a pre-read, are errors', async () => {
  const both = await check([stage({ payload: '1', code: { hunk: 'h5', lines: '12-13' } })]);
  assert.match(both.errors[0], /code or payload, not both/);
  const pre = await check([stage({ code: { hunk: 'h5', lines: '12-13' } })], { mode: 'diff', audience: 'preread' });
  assert.ok(pre.errors.some((e) => /pre-read puts no code on screen/.test(e)));
});

test('a stretch that is too long is reported by the fit check, with what fits', async () => {
  assert.deepEqual((await check([stage({ code: { hunk: 'h5', lines: '12-25' } })])).errors, []);
  const long = await check([stage({ code: { hunk: 'h5', lines: '10-49' } })]);
  assert.equal(long.errors.length, 1);
  assert.match(long.errors[0], /steps\[0\]\.code/);
  assert.match(long.errors[0], /flow code/);
  assert.match(
    long.errors[0],
    /at the smallest readable size, 15px, a line can be 121 characters and 27 lines fit here/,
  );
});

test('lines of 100 and 120 characters fit, and 130 do not', async () => {
  const wide = (n) => ({ ...hunks.h5, lines: lines(10, ['x'.repeat(n), 'y'.repeat(n)]) });
  const run = async (n) =>
    validateStoryboard(
      {
        title: 'Flows',
        scenes: [{ type: 'flow', narration: 'One request.', steps: [stage({ code: { hunk: 'h5', lines: '10-11' } })] }],
      },
      { h5: wide(n) },
      { mode: 'diff' },
    );
  assert.deepEqual((await run(100)).errors, []);
  assert.deepEqual((await run(120)).errors, []);
  assert.equal((await run(130)).errors.length, 1);
});

test('removed lines between shown lines are kept, and light marks the lines', () => {
  const hunk = {
    id: 'hx',
    status: 'modified',
    lines: [
      { type: 'context', oldLine: 1, newLine: 1, text: 'a' },
      { type: 'del', oldLine: 2, newLine: null, text: 'old' },
      { type: 'add', oldLine: null, newLine: 2, text: 'new' },
      { type: 'context', oldLine: 3, newLine: 3, text: 'c' },
    ],
  };
  const { rows, first } = codeRows(hunk, { lines: '1-3', light: '2' });
  assert.deepEqual(rows, [
    { index: 0, lit: false },
    { index: 1, lit: false },
    { index: 2, lit: true },
    { index: 3, lit: false },
  ]);
  assert.equal(first, 1);
});
