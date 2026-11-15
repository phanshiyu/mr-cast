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
