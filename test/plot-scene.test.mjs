// The plot scene: its expression language, its steps, what validate reports, and what the player draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { exprOf } from '../shared/expr.mjs';
import { plotAxes } from '../shared/plot.mjs';
import { walkStates } from '../shared/state-steps.mjs';
import { resolveRef } from '../shared/targets.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { formatSteps } from '../bin/lib/highlight.mjs';

const check = async (scene) => validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' });
const value = (text, scope = {}) => exprOf(text).fn(scope);
const parseError = (text) => exprOf(text).error;

const growth = {
  type: 'plot',
  narration: 'Ten thousand dollars at seven percent.',
  x: { from: 0, to: 30, ticks: 5, label: 'years' },
  y: { from: 0, to: 80000, ticks: 20000, prefix: '$' },
  params: { year: 0 },
  functions: [{ id: 'growth', y: '10000 * 1.07^x', label: 'seven percent growth', hidden: true }],
  points: [{ id: 'marker', at: ['year', '10000 * 1.07^year'], label: '${10000 * 1.07^year:0}', side: 'left', hidden: true }],
  steps: [
    { trace: ['growth'], set: { year: 30 }, show: ['marker'], say: 'It bends upward over thirty years.' },
    { set: { year: 10 }, focus: 'marker', say: 'It doubles in about ten.' },
  ],
};

test('expressions compute with powers, unary minus, functions, constants and sums', () => {
  assert.equal(value('-x^2', { x: 3 }), -9);
  assert.equal(value('2^-1'), 0.5);
  assert.equal(value('max(1, 7, 3) + min(4, 2) + mod(-1, 3)'), 11);
  assert.equal(value('10000 * 1.07^10').toFixed(2), '19671.51');
  assert.equal(value('sum(k, 1, n, 4 / (pi * (2*k - 1)) * sin((2*k - 1) * x))', { n: 3, x: Math.PI / 2 }).toFixed(4), '1.1035');
  assert.equal(value('π / 2'), Math.PI / 2);
});

test('a sum whose bound is not whole adds its last term in part, so a tweened bound grows it smoothly', () => {
  assert.equal(value('sum(k, 1, n, k)', { n: 2 }), 3);
  assert.equal(value('sum(k, 1, n, k)', { n: 2.5 }), 4.5);
  assert.equal(value('sum(k, 1, n, k)', { n: 3 }), 6);
});

test('a parse error says what is wrong and where, and nothing reaches past the names it is given', () => {
  assert.deepEqual(parseError('2x'), { message: 'expected an operator before "x"; write "2*x" to multiply', at: 1 });
  assert.deepEqual(parseError('sin(x'), { message: 'expected ")" to close the "(" at column 4, found the end', at: 5 });
  assert.deepEqual(parseError('x**2'), { message: 'write a power with ^, as in x^2', at: 1 });
  assert.deepEqual(parseError('Math.sin(x)'), { message: 'unexpected "."; a name cannot be followed by a dot', at: 4 });
  assert.deepEqual(parseError('constructor(1)').message.slice(0, 33), '"constructor" is no function; the');
  assert.deepEqual(parseError('sin(1, 2)'), { message: 'sin takes 1 argument, found 2', at: 0 });
  assert.equal(value('constructor', {}), NaN);
  assert.equal(value('toString + 1', {}), NaN);
});

test('a step sets a parameter, traces a hidden line on, and a parameter\'s name lights the parts it moves', () => {
  const { states, problems } = walkStates(growth);
  assert.deepEqual(problems, []);
  assert.deepEqual(states.map((s) => [s.values['k:year'], Object.keys(s.hidden)]), [[0, ['p:growth', 'p:marker']], [30, []], [10, []]]);
  assert.deepEqual(resolveRef(growth, 'year'), ['p:marker']);
  assert.deepEqual(resolveRef(growth, 'growth'), ['p:growth']);
});

test('a part some step traces starts undrawn without hidden, as a map route does, so it is not drawn during the narration', () => {
  const scene = { ...growth, functions: [{ id: 'growth', y: '10000 * 1.07^x' }, { id: 'flat', y: '10000' }], points: [], steps: [{ say: 'First the flat line.' }, { trace: ['growth'], say: 'Then it grows.' }] };
  const { states, problems } = walkStates(scene);
  assert.deepEqual(problems, []);
  assert.deepEqual(states.map((s) => Object.keys(s.hidden)), [['p:growth'], ['p:growth'], []]);
});

test('validate fails on a parse error at its column, a name that is no parameter, and a point traced', async () => {
  const { errors } = await check({
    ...growth,
    functions: [{ id: 'growth', y: '10000 * (1.07^x' }, { id: 'real', y: '10000 * (1 + rate)^x' }],
    steps: [{ trace: ['marker'], set: { yaer: 3 }, say: 'Look.' }],
  });
  assert.deepEqual(errors, [
    'scenes[0].functions[0].y: "10000 * (1.07^x" column 16: expected ")" to close the "(" at column 9, found the end',
    'scenes[0].functions[1].y: "10000 * (1 + rate)^x" column 14: "rate" is no parameter; it can read "x", "year"',
    'scenes[0].steps[0].set["yaer"]: names no parameter; a set key is a parameter name: "year"; did you mean "year"?',
    'scenes[0].steps[0].trace["marker"]: is a point, which has no line to trace; show it instead',
  ]);
});

test('validate fails on an area between a line that does not exist, lines on a number line, and a when the step never says', async () => {
  const area = await check({ ...growth, areas: [{ id: 'gap', between: ['growth', 'reel'] }] });
  assert.deepEqual(area.errors, ['scenes[0].areas[0]: "reel" is no function id']);
  const line = await check({ type: 'plot', narration: 'n', x: { from: 0, to: 1 }, functions: [{ id: 'f', y: 'x' }] });
  assert.deepEqual(line.errors, ['scenes[0].functions[0]: a number line (a plot without y) draws points and vectors only; give the scene a y axis to draw functions']);
  const when = await check({ ...growth, steps: [{ ...growth.steps[0], when: 'thirty days' }] });
  assert.deepEqual(when.errors, ['scenes[0].steps[0].when: "thirty days" is not in the step\'s say; copy the words its changes should start on']);
});

test('validate warns where a line has no value, where a point leaves the plot, and where labels collide', async () => {
  const { errors, warnings } = await check({
    type: 'plot',
    narration: 'n',
    x: { from: 0, to: 10, ticks: 1 },
    y: { from: -5, to: 5 },
    params: { a: 1 },
    functions: [{ id: 'f', y: 'log(x)', label: 'log x' }],
    points: [
      { id: 'p', at: ['a', 2], label: 'a point with a long label', side: 'right' },
      { id: 'q', at: ['a + 0.5', 2], label: 'another long label', side: 'left' },
    ],
    steps: [{ set: { a: 20 }, say: 'Move it.' }],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [
    'scenes[0].functions[0].y: has no value at x = 0 (with a = 1) at the start, so its line breaks there; check the expression, or start it past that point with from',
    'scenes[0].points[1].label: "another long label" overlaps the label of "p" at the start; shorten one, give a point a side, or move the parts apart',
    'scenes[0].points[0].at: lands at (20, 2) (with a = 20) from step 0, outside the plot, so it is not drawn; move it inside the axes\' ranges',
    'scenes[0].points[1].at: lands at (20.5, 2) (with a = 20) from step 0, outside the plot, so it is not drawn; move it inside the axes\' ranges',
  ]);
});

test('validate warns when tick labels overlap, and fails on a step that would draw too many ticks', async () => {
  const axes = (ticks) => ({ type: 'plot', narration: 'n', x: { from: 0, to: 10000, ticks }, y: { from: 0, to: 1 }, points: [{ id: 'p', at: [1, 0.5] }] });
  assert.deepEqual((await check(axes(250))).warnings, ['scenes[0].x.ticks: the tick labels "250" and "500" overlap; use a larger step']);
  assert.deepEqual((await check(axes(100))).errors, ['scenes[0].x.ticks: a step of 100 draws 101 ticks; use a step of at least 250']);
});

test('equal units make a circle round, and the 0 where both axes cross is written once', () => {
  const axes = (equal) => plotAxes({ x: { from: -2, to: 2, ticks: 1 }, y: { from: -1.5, to: 1.5 }, equal }, { width: 1712, height: 804 });
  assert.deepEqual(axes(false).plot, { x: 16, y: 20, width: 1672, height: 764 });
  assert.deepEqual(axes(true).plot, { x: 342.6666666666667, y: 20, width: 1018.6666666666666, height: 764 });
  assert.deepEqual(axes(true).ticks.y.map((t) => t.text), ['−1.5', '−1.0', '−0.5', '0.5', '1.0', '1.5']);
  assert.deepEqual(axes(true).ticks.x.map((t) => t.text), ['−2', '−1', '0', '1', '2']);
});

test('the steps dump says what each step sets and traces, and the highlight check reads plot labels', async () => {
  const scene = { ...growth, steps: [growth.steps[0], { focus: 'marker', say: 'The seven percent growth keeps climbing.' }] };
  const dump = formatSteps({ title: 't', scenes: [scene] }, {});
  assert.match(dump, /changes year 0 → 30; shows growth; shows marker; traces growth/);
  assert.match(dump, /! scenes\[0\]\.steps\[1\]: says "7 percent growth" \(function growth "seven percent growth"\), which is not lit; it lights point marker\./);
});

test('ink circles a plot part by its id', async () => {
  const { errors } = await check({ ...growth, steps: [growth.steps[0], { ...growth.steps[1], draw: [{ circle: 'marker', note: 'doubled' }] }] });
  assert.deepEqual(errors, []);
});

// The scene as the player draws it, through react-dom/server with remotion's hooks stubbed, at frame 120.
const REMOTION = `import { createElement } from 'react';
export const AbsoluteFill = ({ children, style }) => createElement('div', { style }, children);
export const useCurrentFrame = () => 120;
export const useVideoConfig = () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 });
export const spring = () => 1;
export const interpolate = (x, [a, b], [c, d], o) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return c + (d - c) * (o?.easing ? o.easing(t) : t); };
export const Easing = { bezier: () => (t) => t, linear: (t) => t };
export const delayRender = () => 0;
export const continueRender = () => {};`;
const root = new URL('..', import.meta.url).pathname;
const bundled = await build({
  stdin: { contents: `export { PlotDiagram } from './src/components/PlotDiagram.tsx'; export { renderToStaticMarkup } from 'react-dom/server'; export { createElement } from 'react';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.woff2': 'empty' },
  banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(root)});` },
  plugins: [{ name: 'remotion', setup: (b) => {
    b.onResolve({ filter: /^remotion$/ }, (a) => ({ path: a.path, namespace: 'remotion' }));
    b.onLoad({ filter: /.*/, namespace: 'remotion' }, () => ({ contents: REMOTION, loader: 'js', resolveDir: root }));
  } }],
});
const { PlotDiagram, renderToStaticMarkup, createElement } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const segment = (from, voiceFrom, speakingFrames) => ({ text: 'It bends upward over thirty years.', from, markFrom: voiceFrom, voiceFrom, durationInFrames: 200, speakingFrames, clip: undefined });

test('a traced step moves its parameter across its words, so the marker rides the line as it draws', () => {
  // Step 0 starts at frame 60 and its words end at 165: at frame 120 the trace is 60/105 of the way, year 17.14.
  const html = renderToStaticMarkup(createElement(PlotDiagram, { scene: growth, hunks: {}, durationInFrames: 400, segments: [segment(0, 30, 20), segment(60, 75, 90), segment(260, 275, 60)] }));
  assert.match(html, />\$31,895<\/text>/);
  assert.match(html, />\$20k<\/text>/);
  assert.match(html, />seven percent growth<\/text>/);
});
