import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { HUNK_LINES_MAX, lineRange, resolveHunkCell } from '../shared/compare.mjs';

const hunks = JSON.parse(fs.readFileSync(new URL('../examples/primitives/compare-diff/hunks.json', import.meta.url)));

const bundled = await build({
  entryPoints: [new URL('../src/utils/compareLayout.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { layoutCompare } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const scene = (...cells) => ({
  type: 'compare',
  narration: 'The server reads its settings from one object.',
  rows: [{ label: 'Start', cells }],
});
const old = (lines, hunk = 'h8') => ({ hunk, side: 'old', lines });
const now = (lines, hunk = 'h8') => ({ hunk, side: 'new', lines });
const check = (...scenes) => validateStoryboard({ title: 'T', scenes }, hunks, { mode: 'diff' });
const has = (list, text) =>
  assert.ok(
    list.some((m) => m.includes(text)),
    `no ${JSON.stringify(text)} in:\n${list.join('\n')}`,
  );

test('a line range is a number or "a-b"', () => {
  assert.deepEqual(lineRange(4), [4, 4]);
  assert.deepEqual(lineRange('4-6'), [4, 6]);
  assert.equal(lineRange('6-4'), null);
  assert.equal(lineRange('x'), null);
  assert.equal(lineRange(0), null);
});

test('the old side is removed and context lines by old numbers, the new side added and context by new numbers', () => {
  const before = resolveHunkCell(old('1-6'), hunks);
  assert.equal(
    before.code,
    [
      "import { env } from './env';",
      "import { connect } from './db/pool';",
      '',
      "const port = Number(env('PORT')) || 3000;",
      "const db = connect(env('DATABASE_URL'));",
      'export const start = () => listen(port, db);',
    ].join('\n'),
  );
  assert.equal(before.caption, 'src/server.ts:1-6');
  assert.equal(before.lang, 'typescript');
  const after = resolveHunkCell(now('1-5'), hunks);
  assert.equal(after.code.split('\n').length, 5);
  assert.ok(after.code.startsWith("import { config } from './config';\nimport { connect }"));
  assert.ok(!after.code.includes('env('), 'no removed line on the new side');
});

test('a single line number reads one line, and the old side of a rename names the old file', () => {
  assert.equal(resolveHunkCell(now(1), hunks).code, "import { config } from './config';");
  assert.equal(resolveHunkCell(old(1, 'h2'), hunks).caption, '.env.example:1');
  assert.equal(resolveHunkCell(now(3, 'h2'), hunks).caption, 'config/example.env:3');
});

test('a hunk, side or range that does not exist is named', () => {
  assert.match(resolveHunkCell(old(1, 'h99'), hunks).error, /no hunk "h99"/);
  assert.match(resolveHunkCell({ hunk: 'h8', side: 'left', lines: 1 }, hunks).error, /side must be/);
  assert.match(resolveHunkCell(old('40-44'), hunks).error, /has no old lines in 40-44 \(its old lines are 1-6\)/);
  assert.match(resolveHunkCell(old('x'), hunks).error, /must be a line number or a range/);
  assert.match(resolveHunkCell(now(1, 'h6'), hunks).error, /has no new lines/);
});

test('validate accepts hunk cells and errors on a bad hunk, side or range', async () => {
  const good = await check(scene(old('4-6'), now('4-5')));
  assert.deepEqual(good.errors, []);
  const bad = await check(
    { ...scene(old(1, 'h99'), { hunk: 'h8', side: 'middle', lines: 1 }) },
    { ...scene(old('30-31'), { hunk: 'h8', side: 'new', lines: 'a' }) },
  );
  has(bad.errors, 'scenes[0].rows[0].cells[0]: no hunk "h99"');
  has(bad.errors, 'scenes[0].rows[0].cells[1].side: must be "old" or "new"');
  has(bad.errors, 'scenes[1].rows[0].cells[0]: hunk h8 has no old lines in 30-31');
  has(bad.errors, 'scenes[1].rows[0].cells[1]: lines "a" must be a line number');
});

test('a hunk cell over the limit is a warning that says how many lines it holds', async () => {
  const { errors, warnings } = await check(scene(old('1-6'), now('1-8', 'h4')));
  assert.deepEqual(errors, []);
  assert.deepEqual(
    warnings.filter((m) => m.includes('lines; a cell read from a hunk')),
    [],
  );
  const over = await check(scene(old('1-6'), now('1-10', 'h4')));
  has(over.warnings, `10 lines; a cell read from a hunk shows ${HUNK_LINES_MAX}`);
});

test('a hunk cell is laid out with its file and line numbers, and an unknown one as a quiet note', () => {
  const layout = layoutCompare(scene(old('4-6'), now('4-5')), 1700, 760, hunks);
  const [left, right] = layout.rows[0].cells;
  assert.equal(left.kind, 'code');
  assert.equal(left.caption.text, 'src/server.ts:4-6');
  assert.equal(right.caption.text, 'src/server.ts:4-5');
  assert.ok(left.capH > 0 && left.h > left.lines.height);
  const missing = layoutCompare(scene(old(1, 'h99'), now(1)), 1700, 760, hunks).rows[0].cells[0];
  assert.equal(missing.kind, 'text');
});

test('eight lines in two rows still fit the frame at a readable size', () => {
  const eight = {
    type: 'compare',
    narration: 'x',
    rows: [0, 1].map(() => ({ cells: [old('1-6'), now('1-8', 'h4')] })),
  };
  const layout = layoutCompare(eight, 1700, 760, hunks);
  assert.equal(layout.scale, 1);
  assert.ok(layout.rows[0].cells[1].lines.size >= 18, `code drawn at ${layout.rows[0].cells[1].lines.size}px`);
});

const options = (extra = {}) => ({
  type: 'compare',
  mode: 'options',
  narration: 'Two ways, and the one taken.',
  sides: [{ title: 'Delete the row', chosen: true }, { title: 'Rotate the key' }],
  rows: [{ label: 'Cost', cells: ['One delete', 'A rollout'] }],
  ...extra,
});

test('options mode draws no cue between the sides and marks the side taken and the one not', () => {
  const layout = layoutCompare(options(), 1700, 760, hunks);
  assert.equal(layout.options, true);
  assert.deepEqual(
    layout.sides.map((side) => side.taken),
    ['chosen', 'notTaken'],
  );
  assert.deepEqual(
    layout.rows[0].cells.map((cell) => cell.taken),
    ['chosen', 'notTaken'],
  );
  assert.equal(layout.rows[0].same, false);
  const same = options({ rows: [{ cells: ['Both', 'Both'] }] });
  assert.equal(layoutCompare(same, 1700, 760, hunks).rows[0].same, false, 'no "=" between options either');
  assert.equal(
    layoutCompare({ ...same, mode: undefined }, 1700, 760, hunks).rows[0].same,
    true,
    'default mode is unchanged',
  );
});

test('options mode without chosen marks nothing, and a row can say which side it took', () => {
  const none = layoutCompare(options({ sides: undefined }), 1700, 760, hunks);
  assert.deepEqual(
    none.rows[0].cells.map((c) => c.taken),
    [null, null],
  );
  const rows = layoutCompare(
    options({ sides: undefined, rows: [{ cells: ['a', 'b'], chosen: 1 }, { cells: ['c', 'd'] }] }),
    1700,
    760,
    hunks,
  );
  assert.deepEqual(
    rows.rows[0].cells.map((c) => [c.taken, c.tagged]),
    [
      ['notTaken', true],
      ['chosen', true],
    ],
  );
  assert.deepEqual(
    rows.rows[1].cells.map((c) => c.taken),
    [null, null],
  );
  assert.ok(rows.rows[0].h > rows.rows[1].h, 'a tagged row makes room for its labels');
});

test('the default mode ignores nothing: sides carry no taken marks', () => {
  const plain = layoutCompare({ ...options(), mode: undefined }, 1700, 760, hunks);
  assert.deepEqual(
    plain.sides.map((side) => side.taken),
    [null, null],
  );
  assert.equal(plain.options, false);
});

test('validate accepts options with chosen on a side or on rows, and rejects the rest', async () => {
  const ok = await check(options(), options({ sides: undefined, rows: [{ cells: ['a', 'b'], chosen: 0 }] }));
  assert.deepEqual(ok.errors, []);
  const bad = await check(
    options({ mode: 'versus' }),
    options({
      sides: [
        { title: 'A', chosen: true },
        { title: 'B', chosen: true },
      ],
    }),
    options({ rows: [{ cells: ['a', 'b'], chosen: 2 }] }),
    options({ rows: [{ cells: ['a', 'b'], chosen: 1 }] }),
    { ...options(), mode: undefined },
  );
  has(bad.errors, 'scenes[0].mode: must be one of changes, options');
  has(bad.errors, 'scenes[1].sides: both sides are chosen');
  has(bad.errors, 'scenes[2].rows[0].chosen: must be 0 or 1');
  has(bad.errors, 'scenes[3].rows[0].chosen: the sides are already marked chosen');
  has(bad.errors, 'scenes[4].sides[0].chosen: only means something with "mode": "options"');
});

test('a side written as a plain string is an error that says to write an object with a title', async () => {
  const bad = await check({ ...options(), mode: undefined, sides: ['Before', 'After'] });
  has(bad.errors, 'scenes[0].sides[0]: is the string "Before"; a side is an object, write { "title": "Before" }');
  has(bad.errors, 'scenes[0].sides[1]: is the string "After"');
  assert.deepEqual(
    (await check({ ...options(), mode: undefined, sides: [{ title: 'Old' }, { title: 'New' }] })).errors,
    [],
  );
});

// Two rows of two lines each, as real code reads: a hunk of `n`-character lines, old and new, in each row.
const wide = (n) => {
  const lines = (type, key, text) =>
    [0, 1].map((i) => ({ type, oldLine: key === 'old' ? 10 + i : null, newLine: key === 'new' ? 10 + i : null, text }));
  const hunk = {
    ...hunks.h8,
    lines: [...lines('del', 'old', 'o'.repeat(n)), ...lines('add', 'new', 'n'.repeat(n))],
  };
  return { h1: { ...hunk, id: 'h1' }, h2: { ...hunk, id: 'h2' } };
};
const wideScene = (label) => ({
  type: 'compare',
  narration: 'The same two lines, twice.',
  rows: ['h1', 'h2'].map((h) => ({
    ...(label ? { label: 'The key' } : {}),
    cells: [
      { hunk: h, side: 'old', lines: '10-11' },
      { hunk: h, side: 'new', lines: '10-11' },
    ],
  })),
});
const fitting = (n, label) => validateStoryboard({ title: 'T', scenes: [wideScene(label)] }, wide(n), { mode: 'diff' });

test("a hunk cell uses the side's width: lines up to 86 characters fit with no row label, 73 with one", async () => {
  assert.deepEqual((await fitting(86, false)).errors, []);
  assert.equal((await fitting(87, false)).errors.length, 4);
  assert.deepEqual((await fitting(73, true)).errors, []);
  assert.equal((await fitting(74, true)).errors.length, 4);
});

test('lines too long for the cell say how many characters fit at the smallest readable size and how many lines fit', async () => {
  const { errors } = await fitting(100, false);
  has(errors, 'scenes[0].rows[0].cells[0].code');
  has(errors, 'this cell holds lines of up to 86 characters at 15px, the smallest readable size (its longest is 100)');
  has(errors, 'the frame holds 30 lines of code in all, shared by the rows');
  const labelled = await fitting(100, true);
  has(labelled.errors, 'up to 73 characters at 15px');
});

test("hunk code steps down to the smallest readable size and no further, at the cell's full width", () => {
  const layout = layoutCompare(wideScene(false), 1712, 734, wide(86));
  const [left] = layout.rows[0].cells;
  assert.equal(left.lines.size, 15);
  assert.equal(layout.scale, 1);
  assert.equal(left.bleed, 16, 'the code block reaches 16px left of the cell column');
  assert.equal(left.codeW, layout.cellW + 32);
  const short = layoutCompare(wideScene(false), 1712, 734, wide(30)).rows[0].cells[0];
  assert.ok(short.lines.size > 15, 'short lines keep a larger size');
});

test('a typed code cell keeps its width and its own smallest size', () => {
  const typed = {
    type: 'compare',
    narration: 'x',
    rows: [{ cells: [{ code: 'const a = 1;' }, { code: 'const a = 2;' }] }],
  };
  const cell = layoutCompare(typed, 1712, 734, {}).rows[0].cells[0];
  assert.equal(cell.bleed, 0);
  assert.equal(cell.codeW, layoutCompare(typed, 1712, 734, {}).cellW);
});
