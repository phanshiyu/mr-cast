import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: [new URL('../src/utils/tableLayout.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { layoutTable } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const firstCell = (cell) => layoutTable(['Setting', 'Default'], [{ cells: [cell, '2 s'] }], 1712, 700).rows[0].cells[0];
const drawn = (fit) => fit.lines.flat().map((r) => (r.code ? `<code>${r.text}</code>` : r.text)).join('');

test('a table cell renders its inline markup instead of showing the backticks', () => {
  const marked = firstCell('`pollIntervalMs`');
  assert.equal(marked.mono, false);
  assert.equal(drawn(marked.text), '<code>pollIntervalMs</code>');
  // A bare identifier still reads as code and renders in mono, as before.
  const bare = firstCell('pollIntervalMs');
  assert.equal(bare.mono, true);
  assert.equal(drawn(bare.text), 'pollIntervalMs');
});

test('big-O and other math in a table cell reads as text, with spaces or without', () => {
  assert.deepEqual(['O(n²)', 'O(n log n)', 'O(1)', 'n × m'].map((cell) => firstCell(cell).mono), [false, false, false, false]);
  assert.equal(firstCell('max_retries').mono, true);
});

test('a table header is upper-cased unless it holds a formula or code', () => {
  const headers = layoutTable(['Hit rate', 'SHA-256', 'e^z', 'maxRetries', 'f(x)'], [{ cells: ['a', 'b', 'c', 'd', 'e'] }], 1712, 700).headers;
  assert.deepEqual(headers.map((h) => h.font.upper), [true, true, false, false, false]);
});
