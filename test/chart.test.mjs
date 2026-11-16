import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const bundled = await build({
  entryPoints: [new URL('../src/utils/chartLayout.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { formatValue, layoutChart, valueLabels } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

test('a chart value below 10,000 prints as written up to four significant digits', () => {
  assert.equal(formatValue(3.125, { unit: 's' }), '3.125 s');
  assert.equal(formatValue(0.0243, { unit: '%' }), '0.0243%');
  assert.equal(formatValue(-1234.56, { unit: 'ms' }), '−1,235 ms');
  assert.equal(formatValue(0.1 + 0.2, {}), '0.3');
  assert.equal(formatValue(2 / 3, { unit: 'ms' }), '0.6667 ms');
  assert.equal(formatValue(Math.PI * 1000, {}), '3,142');
  assert.equal(formatValue(42, { unit: 'ms' }), '42 ms');
});

test('a chart prefix prints against the number, after a minus sign', () => {
  assert.equal(formatValue(35, { prefix: '$' }), '$35');
  assert.equal(formatValue(-1234.56, { prefix: '$' }), '−$1,235');
  assert.equal(formatValue(12345, { prefix: '$' }), '$12.3k');
  assert.equal(formatValue(4.5, { prefix: '~', unit: 'yr' }), '~4.5 yr');
});

test('a chart with a prefix prints it on each bar value and axis tick', () => {
  const scene = {
    type: 'chart',
    kind: 'bar',
    prefix: '$',
    narration: 'x',
    labels: ['2GB', '4GB'],
    series: [{ name: 'price', values: [45, 55] }],
  };
  const layout = layoutChart(scene, 1600, 700);
  assert.deepEqual(
    valueLabels(scene, layout).map((v) => v.text),
    ['$45', '$55'],
  );
  assert.deepEqual(
    layout.ticks.map((t) => formatValue(t, scene)),
    ['$0', '$20', '$40', '$60'],
  );
});

test('validate warns on a chart value label that runs into the one on its left, and only that one', async () => {
  const scene = {
    type: 'chart',
    kind: 'bar',
    unit: 'ms',
    narration: 'x',
    labels: ['a', 'b', 'c', 'd', 'e', 'f'],
    series: [
      { name: 'before', values: [1 / 3, 2 / 3, 1 / 7, 1, 2, 3] },
      { name: 'after', values: [1 / 3, 2 / 3, 1 / 7, 1, 2, 3] },
    ],
  };
  const { warnings } = await validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' });
  const fix =
    'does not fit its space beside the value on its left, even at 21px; the two values run into each other; round the values, shorten the unit, or use fewer labels or series';
  // As a still of this chart shows: the pairs over a, b and c run together, and "1 ms", "2 ms" and "3 ms" do not.
  assert.deepEqual(warnings, [
    `scenes[0].series[1].values[0]: "0.3333 ms" ${fix}`,
    `scenes[0].series[1].values[1]: "0.6667 ms" ${fix}`,
    `scenes[0].series[1].values[2]: "0.1429 ms" ${fix}`,
  ]);
});

test('a chart value of 10,000 or more is compacted to three significant digits', () => {
  assert.equal(formatValue(12345, { unit: 'req/s' }), '12.3k req/s');
  assert.equal(formatValue(3_400_000, {}), '3.4M');
});

test('validate names a chart badges field that is not true or false', async () => {
  const scene = {
    type: 'chart',
    kind: 'bar',
    narration: 'x',
    labels: ['p50'],
    series: [
      { name: 'before', values: [1] },
      { name: 'after', values: [2] },
    ],
  };
  const check = async (badges) =>
    (await validateStoryboard({ title: 't', scenes: [{ ...scene, badges }] }, {}, { mode: 'explain' })).errors;
  assert.deepEqual(await check(false), []);
  assert.deepEqual(await check('off'), ['scenes[0].badges: must be true or false']);
});

test('validate names a chart prefix that is not a string', async () => {
  const scene = {
    type: 'chart',
    kind: 'bar',
    narration: 'x',
    labels: ['p50'],
    series: [{ name: 'price', values: [1] }],
  };
  const check = async (prefix) =>
    (await validateStoryboard({ title: 't', scenes: [{ ...scene, prefix }] }, {}, { mode: 'explain' })).errors;
  assert.deepEqual(await check('$'), []);
  assert.deepEqual(await check(1), ['scenes[0].prefix: must be a string']);
});

const bundledTargets = await build({
  entryPoints: [new URL('../src/utils/chartTargets.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { chartStepTargets } = await import(
  `data:text/javascript;base64,${Buffer.from(bundledTargets.outputFiles[0].text).toString('base64')}`
);

test('handwriting beside a chart label has the bar above it and the label to be placed by', () => {
  const draw = [{ write: 'mostly the newer core,\nnot the clock', near: 'Pi 5', side: 'left' }];
  const scene = {
    type: 'chart',
    kind: 'bar',
    unit: '×',
    narration: 'x',
    labels: ['Pi 4', 'Pi 5'],
    series: [{ name: 'times the Pi 4', values: [1, 3] }],
    steps: [{ focus: 'Pi 5', say: 'Most of it is the core.', draw }],
  };
  const [bar, label] = [chartStepTargets(scene)[0].obstacles[1], chartStepTargets(scene)[0].boxes.get('l:1')];
  assert.deepEqual([bar.x, label.y], [1197.75, 767]);
});
