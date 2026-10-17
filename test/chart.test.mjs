import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const bundled = await build({ entryPoints: [new URL('../src/utils/chartLayout.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { formatValue } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('a chart value below 10,000 prints with the digits it was written with', () => {
  assert.equal(formatValue(3.125, 's'), '3.125 s');
  assert.equal(formatValue(0.0243, '%'), '0.0243%');
  assert.equal(formatValue(-1234.56, 'ms'), '−1,234.56 ms');
  assert.equal(formatValue(0.1 + 0.2, undefined), '0.3');
  assert.equal(formatValue(42, 'ms'), '42 ms');
});

test('a chart value of 10,000 or more is compacted to three significant digits', () => {
  assert.equal(formatValue(12345, 'req/s'), '12.3k req/s');
  assert.equal(formatValue(3_400_000, undefined), '3.4M');
});

test('validate names a chart badges field that is not true or false', async () => {
  const scene = { type: 'chart', kind: 'bar', narration: 'x', labels: ['p50'], series: [{ name: 'before', values: [1] }, { name: 'after', values: [2] }] };
  const check = async (badges) => (await validateStoryboard({ title: 't', scenes: [{ ...scene, badges }] }, {}, { mode: 'explain' })).errors;
  assert.deepEqual(await check(false), []);
  assert.deepEqual(await check('off'), ['scenes[0].badges: must be true or false']);
});
