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

// The chart as the player draws it, through react-dom/server with remotion's hooks stubbed, at frame 200.
const REMOTION = `import { createElement } from 'react';
export const AbsoluteFill = ({ children, style }) => createElement('div', { style }, children);
export const useCurrentFrame = () => 200;
export const useVideoConfig = () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 });
export const spring = () => 1;
export const interpolate = (x, [a, b], [c, d], o) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return c + (d - c) * (o?.easing ? o.easing(t) : t); };
export const Easing = { bezier: () => (t) => t, linear: (t) => t, out: (f) => f, inOut: (f) => f, cubic: (t) => t };
export const delayRender = () => 0;
export const continueRender = () => {};`;
const root = new URL('..', import.meta.url).pathname;
const player = await build({
  stdin: {
    contents: `export { Chart } from './src/components/Chart.tsx'; export { chartStepTargets } from './src/utils/chartTargets.ts'; export { renderToStaticMarkup } from 'react-dom/server'; export { createElement } from 'react';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  loader: { '.woff2': 'empty' },
  banner: {
    js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(root)});`,
  },
  plugins: [
    {
      name: 'remotion',
      setup: (b) => {
        b.onResolve({ filter: /^remotion$/ }, (a) => ({ path: a.path, namespace: 'remotion' }));
        b.onLoad({ filter: /.*/, namespace: 'remotion' }, () => ({
          contents: REMOTION,
          loader: 'js',
          resolveDir: root,
        }));
      },
    },
  ],
});
const { Chart, chartStepTargets, renderToStaticMarkup, createElement } = await import(
  `data:text/javascript;base64,${Buffer.from(player.outputFiles[0].text).toString('base64')}`
);
const drawn = (scene) =>
  renderToStaticMarkup(
    createElement(Chart, {
      scene,
      hunks: {},
      durationInFrames: 300,
      segments: [
        { text: 'x', from: 0, markFrom: 0, voiceFrom: 0, durationInFrames: 300, speakingFrames: 60, clip: undefined },
      ],
    }),
  );

test('a drawn chart prints its prefix on the values and axis, and its legend names only the series', () => {
  const html = drawn({
    type: 'chart',
    kind: 'bar',
    prefix: '$',
    narration: 'x',
    labels: ['2GB', '4GB'],
    series: [
      { name: 'price', values: [45, 55] },
      { name: 'sale', values: [40, 50] },
    ],
  });
  assert.match(html, />\$45</);
  assert.match(html, />\$60</);
  assert.doesNotMatch(html, /\$45 \$|45 \$/);
  const unit = drawn({
    type: 'chart',
    kind: 'bar',
    unit: '×',
    narration: 'x',
    labels: ['Pi 4', 'Pi 5'],
    series: [
      { name: 'times the Pi 4', values: [1, 3] },
      { name: 'claim', values: [1, 2] },
    ],
  });
  assert.match(unit, />3×</);
  assert.doesNotMatch(unit, /·/);
});

test('handwriting beside a chart label steps out past the foot of the bar above it, level with the label', () => {
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
  const segments = [
    { text: 'x', from: 0, markFrom: 0, voiceFrom: 0, durationInFrames: 30, speakingFrames: 20 },
    {
      text: 'Most of it is the core.',
      from: 30,
      markFrom: 30,
      voiceFrom: 30,
      durationInFrames: 270,
      speakingFrames: 60,
    },
  ];
  const html = renderToStaticMarkup(createElement(Chart, { scene, hunks: {}, durationInFrames: 300, segments }));
  const lines = [...html.matchAll(/left:([\d.]+)px;top:([\d.]+)px;height:\d+px;width:([\d.]+)px/g)].map((m) => ({
    left: +m[1],
    top: +m[2],
    right: +m[1] + +m[3] - 20,
  }));
  const [bar, label] = [chartStepTargets(scene)[0].obstacles[1], chartStepTargets(scene)[0].boxes.get('l:1')];
  assert.deepEqual([bar.x, label.y], [1197.75, 767]);
  // The first line ends 16px short of the bar's foot at 1197.75, not across it; the second is on the label's row.
  assert.deepEqual(lines, [
    { left: 782.75, top: 704, right: 1181.75 },
    { left: 782.75, top: 754, right: 1022.75 },
  ]);
});
