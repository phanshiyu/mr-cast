import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pairShapes, tweenShape, tweenTransform } from '../shared/svg-motion.mjs';
import { walkStates } from '../shared/state-steps.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';

// The scene as the player draws it at `globalThis.FRAME`, through react-dom/server with remotion's hooks stubbed.
const REMOTION = `import { createElement } from 'react';
export const AbsoluteFill = ({ children, style }) => createElement('div', { style }, children);
export const useCurrentFrame = () => globalThis.FRAME;
export const useVideoConfig = () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 600 });
export const spring = () => 1;
export const interpolate = (x, [a, b], [c, d]) => c + (d - c) * Math.min(1, Math.max(0, (x - a) / (b - a)));
export const Easing = { bezier: () => (t) => t };
export const delayRender = () => 0;
export const continueRender = () => {};`;
const root = new URL('..', import.meta.url).pathname;
const bundled = await build({
  stdin: { contents: `export { SvgDiagram } from './src/components/SvgDiagram.tsx'; export { renderToStaticMarkup } from 'react-dom/server'; export { createElement } from 'react';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.woff2': 'empty' },
  banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(root)});` },
  plugins: [{ name: 'remotion', setup: (b) => {
    b.onResolve({ filter: /^remotion$/ }, (a) => ({ path: a.path, namespace: 'remotion' }));
    b.onLoad({ filter: /.*/, namespace: 'remotion' }, () => ({ contents: REMOTION, loader: 'js', resolveDir: root }));
  } }],
});
const { SvgDiagram, renderToStaticMarkup, createElement } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

/** The narration over frames 0 to 99, then one segment a step, each 200 frames long with its voice 15 frames in. */
const segmentsFor = (scene) => [
  { from: 0, voiceFrom: 0, markFrom: 0, text: scene.narration, speakingFrames: 90 },
  ...scene.steps.map((step, k) => ({ from: 100 + 200 * k, voiceFrom: 115 + 200 * k, markFrom: 115 + 200 * k, text: step.say, speakingFrames: 150 })),
];
const drawnAt = (frame, scene) => {
  globalThis.FRAME = frame;
  return renderToStaticMarkup(createElement(SvgDiagram, { scene, hunks: {}, durationInFrames: 600, segments: segmentsFor(scene) }));
};
const svgScene = (svg, steps, extra = {}) => ({ type: 'svg', narration: 'A drawing.', svg, steps, ...extra });
const attr = (html, id, name) => new RegExp(`id="[^"]*-${id}"[^>]*?\\s${name}="([^"]*)"`).exec(html)?.[1] ?? new RegExp(`<[^>]*\\s${name}="([^"]*)"[^>]*id="[^"]*-${id}"`).exec(html)?.[1];

test('a move tweens a rotation about its pivot, outside the element\'s own transform', () => {
  assert.equal(tweenTransform('', 'rotate(90 350 350)', 0.5), 'rotate(45 350 350)');
  assert.equal(tweenTransform('translate(10 0)', 'translate(30 20)', 0.5), 'translate(20 10)');
  const scene = svgScene('<svg viewBox="0 0 400 400"><g id="needle" transform="rotate(-60 200 200)"><line x1="200" y1="200" x2="200" y2="80"/></g></svg>', [{ move: { needle: 'rotate(120 200 200)' }, say: 'It swings round.' }]);
  assert.equal(attr(drawnAt(50, scene), 'needle', 'transform'), 'rotate(-60 200 200)');
  assert.equal(attr(drawnAt(400, scene), 'needle', 'transform'), 'rotate(120 200 200) rotate(-60 200 200)');
  assert.equal(attr(drawnAt(100 + 7.5, scene), 'needle', 'transform'), 'rotate(60 200 200) rotate(-60 200 200)');
});

test('two transforms of different functions tween through a move, a turn and a scale', () => {
  assert.equal(tweenTransform('translate(100 0)', 'rotate(90)', 0.5), 'translate(50 0) rotate(45 0 0) scale(1 1)');
  assert.equal(tweenTransform('translate(100 0)', 'rotate(90)', 1), 'rotate(90 0 0)');
});

test('a morph pairs a circle of arcs with a square of lines curve for curve', () => {
  const circle = 'M 50 0 A 50 50 0 1 1 50 100 A 50 50 0 1 1 50 0 Z';
  const square = 'M0 0 H100 V100 H0 Z';
  const paired = pairShapes(circle, square);
  assert.equal(paired.from[0].curves.length, paired.to[0].curves.length);
  assert.equal(tweenShape(paired, 0), 'M50 0C77.614 0 100 22.386 100 50C100 77.614 77.614 100 50 100C22.386 100 0 77.614 0 50C0 22.386 22.386 0 50 0Z');
  assert.equal(tweenShape(paired, 1), 'M0 0C33.333 0 66.667 0 100 0C100 33.333 100 66.667 100 100C66.667 100 33.333 100 0 100C0 66.667 0 33.333 0 0Z');
  assert.throws(() => pairShapes('M0 0 L1 1 M5 5 L6 6', square), /draws 2 outlines and the other 1/);
});

test('a morphed path draws the other path\'s shape once the step settles, and its own again when named after itself', () => {
  const scene = svgScene('<svg viewBox="0 0 100 100"><path id="blob" d="M0 0 L10 0 L10 10 Z"/><path id="sq" d="M0 0 H50 V50 H0 Z"/></svg>', [
    { morph: { blob: 'sq' }, say: 'It squares up.' },
    { morph: { blob: 'blob' }, say: 'And back.' },
  ], { hidden: ['sq'] });
  assert.equal(attr(drawnAt(250, scene), 'blob', 'd'), 'M0 0 H50 V50 H0 Z');
  assert.match(attr(drawnAt(105, scene), 'blob', 'd'), /^M0 0C/);
  assert.equal(attr(drawnAt(450, scene), 'blob', 'd'), 'M0 0 L10 0 L10 10 Z');
  const { states, problems } = walkStates(scene);
  assert.deepEqual(states.map((s) => s.shapes), [{}, { 's:blob': 'sq' }, {}]);
  assert.deepEqual(problems, []);
});

test('a trace shows a hidden line and draws it on from its cue, then leaves it whole', () => {
  const scene = svgScene('<svg viewBox="0 0 1000 500"><line id="route" x1="0" y1="250" x2="1000" y2="250" stroke="var(--good)"/></svg>', [{ trace: [{ id: 'route', when: 'south' }], say: 'The route runs south round the coast.' }], { hidden: ['route'] });
  const offset = (frame) => attr(drawnAt(frame, scene), 'route', 'stroke-dashoffset');
  // "south" is the fourth of seven words, about 64 frames into the voice, which starts at 115; the stroke starts 3 frames early.
  assert.equal(offset(170), '1');
  assert.ok(Number(offset(190)) > 0 && Number(offset(190)) < 1);
  assert.equal(offset(290), undefined);
  assert.deepEqual(walkStates(scene).states.map((s) => [s.hidden['s:route'] === true, s.traces]), [[true, {}], [false, { 's:route': 'south' }]]);
});

test('a line with class flow draws a faint copy under dashes that march with the frame', () => {
  const scene = svgScene('<svg viewBox="0 0 1712 800"><path id="wire" class="flow" d="M0 0 H600" stroke="var(--accent)" stroke-width="3"/></svg>', [{ focus: 'wire', say: 'Current flows.' }]);
  const html = drawnAt(10, scene);
  assert.match(html, /<path d="M0 0 H600" stroke="#7c8cff" stroke-width="3" fill="none" stroke-opacity="0.25"><\/path>/);
  const dash = (frame) => /stroke-dasharray="([^"]*)" stroke-dashoffset="([^"]*)"/.exec(drawnAt(frame, scene)).slice(1);
  assert.deepEqual(dash(10), ['10 12', '-14']);
  assert.deepEqual(dash(20), ['10 12', '-28']);
});

const check = async (scene) => {
  const { errors, warnings } = await validateStoryboard({ title: 'Motion', scenes: [{ chapter: 'Motion', ...scene }] }, {}, { mode: 'explain' });
  return { errors, warnings };
};

test('validate names a move, trace or morph it cannot draw', async () => {
  const svg = '<svg viewBox="0 0 400 300" id="all"><path id="a" d="M0 0 L10 0 L10 10 Z"/><path id="two" d="M0 0 L1 1 M5 5 L6 6"/><text id="t" x="10" y="20" font-size="30">hi</text><rect id="r" width="10" height="10"/></svg>';
  const { errors } = await check(svgScene(svg, [
    { move: { all: 'translate(1 0)', a: 'skewX(10)', ghost: 'translate(1 0)' }, say: 'Move.' },
    { trace: ['t', { id: 'a', when: 'nowhere' }, 'nope'], say: 'Trace it.' },
    { morph: { a: 'two', r: 'a', t: 'r' }, say: 'Morph.' },
  ]));
  assert.deepEqual(errors, [
    'scenes[0].steps[0].move["all"]: is the root <svg>, which the scene places on its stage; wrap what moves in a <g id="..."> and move that',
    'scenes[0].steps[0].move["a"]: "skewX(10)" is no transform; a move is translate(x y), rotate(degrees cx cy) and scale(s), alone or in a row, such as "translate(300 0) rotate(90 50 50)", or "" to put it back',
    'scenes[0].steps[0].move["ghost"]: names no element id; it can be "all", "a", "two", "t", "r"',
    'scenes[0].steps[1].trace["t"]: is a <text>, which has no line to draw on; trace a path, line, polyline, polygon, rect, circle, ellipse, or a <g> of them',
    'scenes[0].steps[1].trace["a"]: has "when": "nowhere", which is not in the step\'s say; copy the words the line should start drawing on',
    'scenes[0].steps[1].trace["nope"]: names no element id in the drawing; it can be "all", "a", "two", "t", "r"',
    'scenes[0].steps[2].morph["a"]: cannot turn into "two": it draws 1 outline and the other 2; a morph pairs them one to one, so give both the same number of M…Z parts',
    'scenes[0].steps[2].morph["r"]: is a <rect>; only a <path> morphs, so draw it as one',
    'scenes[0].steps[2].morph["t"]: is a <text>; only a <path> morphs, so draw it as one',
  ]);
  const other = await check({ type: 'array', narration: 'n', values: [1, 2], steps: [{ trace: ['0'], focus: 0, say: 'Trace.' }] });
  assert.deepEqual(other.errors, ['scenes[0].steps[0].trace: an array scene takes no trace; trace and morph are steps of an svg scene']);
});

test('a hidden path that lends a morph its shape is not reported as never drawn', async () => {
  const svg = '<svg viewBox="0 0 400 300"><path id="a" d="M0 0 L100 0 L100 100 Z"/><path id="b" d="M0 0 H100 V100 H0 Z"/><path id="c" d="M0 0 H9"/></svg>';
  const { errors, warnings } = await check(svgScene(svg, [{ morph: { a: 'b' }, say: 'It squares up.' }], { hidden: ['b', 'c'] }));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.filter((w) => w.includes('never drawn')), ['scenes[0].hidden[1]: starts hidden and no step shows it, so it is never drawn']);
});

test('mr-cast steps lists what a step moves, traces and morphs, and where its camera points', async () => {
  const { stepViews } = await import('../bin/lib/highlight.mjs');
  const svg = '<svg viewBox="0 0 100 100"><path id="a" d="M0 0 L10 0 L10 10 Z"/><path id="b" d="M0 0 H50 V50 H0 Z"/><line id="l" x1="0" y1="0" x2="9" y2="9"/></svg>';
  const scene = svgScene(svg, [
    { move: { a: 'translate(5 0)' }, trace: [{ id: 'l', when: 'draws' }], say: 'It slides and the line draws.' },
    { morph: { a: 'b' }, move: { a: '' }, camera: { on: ['a', 'l'], zoom: 3 }, say: 'Closer.' },
    { camera: 'all', focus: 'a', say: 'Back.' },
  ], { hidden: ['b'] });
  assert.deepEqual(stepViews(scene, {}).map((v) => v.changes), [
    ['moves a "translate(5 0)"', 'traces l from "draws"'],
    ['moves a back', 'morphs a into b', 'camera on a, l at 3x'],
    ['camera on the whole scene'],
  ]);
});
