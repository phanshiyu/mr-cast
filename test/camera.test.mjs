import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cameraShots, frameShot, tweenView, viewRect } from '../shared/camera.mjs';
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

const segmentsFor = (scene) => [
  { from: 0, voiceFrom: 0, markFrom: 0, text: scene.narration, speakingFrames: 90 },
  ...scene.steps.map((step, k) => ({ from: 100 + 200 * k, voiceFrom: 115 + 200 * k, markFrom: 115 + 200 * k, text: step.say, speakingFrames: 150 })),
];
const drawnAt = (frame, scene) => {
  globalThis.FRAME = frame;
  return renderToStaticMarkup(createElement(SvgDiagram, { scene, hunks: {}, durationInFrames: 600, segments: segmentsFor(scene) }));
};
/** The camera's transform at a frame, as [x, y, zoom]; null when the scene draws no camera. */
const cameraAt = (frame, scene) => {
  const m = /transform-origin:0 0;transform:translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([\d.e]+)\)/.exec(drawnAt(frame, scene));
  return m ? m.slice(1).map((n) => Math.round(Number(n) * 1000) / 1000) : null;
};

// A viewBox the size of the content box (1712 by 804 without a title), so viewBox units are px on stage.
const cell = '<svg viewBox="0 0 1712 804"><rect id="a" x="100" y="100" width="100" height="100"/><rect id="b" x="1400" y="600" width="100" height="100"/></svg>';
const scene = (steps, extra = {}) => ({ type: 'svg', narration: 'Two boxes.', svg: cell, steps, ...extra });

test('a step camera zooms on its ref with a margin, kept inside the scene, and pulls back on "all"', () => {
  const s = scene([{ camera: 'a', say: 'Look at a.' }, { camera: 'all', say: 'And back.' }]);
  assert.deepEqual(cameraAt(50, s), [0, 0, 1]);
  // a's box is 100 px with 48 px each side: 804 / 196 high. Its centre, x 150, is pulled right so the view stays on the stage.
  const zoom = Math.round((804 / 196) * 1000) / 1000;
  assert.deepEqual(cameraAt(250, s), [0, Math.round((402 - 150 * (804 / 196)) * 1000) / 1000, zoom]);
  assert.deepEqual(cameraAt(450, s), [0, 0, 1]);
});

test('a scene with no camera draws its content as it always has, with no camera wrapper', () => {
  const html = drawnAt(250, scene([{ focus: 'a', say: 'Look at a.' }]));
  assert.match(html, /<div style="flex:1;position:relative;min-height:0"><svg width="1776"/);
  assert.equal(cameraAt(250, scene([{ focus: 'a', say: 'Look at a.' }])), null);
});

test('a zoom straight in keeps one point still on screen the whole way', () => {
  const area = { width: 1600, height: 800 };
  const a = { x: 800, y: 400, zoom: 1 };
  const b = frameShot({ keys: ['k'], refs: ['k'], zoom: 4 }, () => ({ x: 1200, y: 100, width: 50, height: 50 }), area);
  assert.deepEqual(b, { x: 1225, y: 125, zoom: 4 });
  // The still point p satisfies (p - a) * za = (p - b) * zb: p = (b zb - a za) / (zb - za).
  const still = { x: (b.x * 4 - a.x) / 3, y: (b.y * 4 - a.y) / 3 };
  for (const t of [0.25, 0.5, 0.75]) {
    const v = tweenView(a, b, t);
    const screen = (p) => ({ x: Math.round((p.x - v.x) * v.zoom), y: Math.round((p.y - v.y) * v.zoom) });
    assert.deepEqual(screen(still), { x: Math.round(still.x - a.x), y: Math.round(still.y - a.y) });
  }
  assert.deepEqual(viewRect(b, area), { x: 1025, y: 25, width: 400, height: 200 });
});

test('a camera follows its ref and frames several refs together', () => {
  const { shots } = cameraShots({ type: 'array', narration: 'n', values: [1, 2, 3], pointers: [{ name: 'i', at: 0 }], steps: [{ camera: ['ptr:i', 2], say: 'a' }, { move: { i: 1 }, say: 'b' }, { camera: { on: 1, zoom: 2 }, say: 'c' }] });
  assert.deepEqual(shots, [null, { keys: ['ptr:i', 'c:2'], refs: ['ptr:i', 2], zoom: null }, { keys: ['ptr:i', 'c:2'], refs: ['ptr:i', 2], zoom: null }, { keys: ['c:1'], refs: [1], zoom: 2 }]);
});

const check = async (scenes, hunks = {}) => validateStoryboard({ title: 'Camera', scenes: scenes.map((s) => ({ chapter: 'Camera', narration: 'n', ...s })) }, hunks, { mode: 'explain' });

test('validate names a camera it cannot point', async () => {
  const { errors } = await check([
    scene([
      { camera: 'c', say: 'One.' },
      { camera: { on: 'a', zoom: 0.5 }, say: 'Two.' },
      { camera: [], say: 'Three.' },
      { camera: ['a', 'all'], say: 'Four.' },
      { camera: { at: 'a' }, say: 'Five.' },
      { camera: { zoom: 2 }, say: 'Six.' },
    ]),
    { type: 'flow', steps: [{ actor: 'A', action: 'acts', say: 'Seven.', camera: 'all' }] },
  ]);
  assert.deepEqual(errors, [
    'scenes[0].steps[0].camera: "c" names nothing in this svg; did you mean "a" or "b"?',
    'scenes[0].steps[1].camera.zoom: must be a number from 1, the whole scene\'s scale, to 40',
    'scenes[0].steps[2].camera: an empty list frames nothing; name a ref, or write "all"',
    'scenes[0].steps[3].camera: "all" frames the whole scene on its own; write "camera": "all"',
    'scenes[0].steps[4].camera.at: is not a camera field; a camera is { "on": refs, "zoom": 3 }; did you mean "on"?',
    'scenes[0].steps[5].camera.on: required: the ref or refs to frame',
    'scenes[1].steps[0].camera: a flow scene has no refs to frame; camera goes on the steps of graph, sequence, er, state, table, chart, timeline, files, tests, compare, terminal, layers, array, memory, svg, plot, text, code',
  ]);
});

test('a step that only moves the camera needs no focus, and counts as moving', async () => {
  const { errors, warnings } = await check([scene([{ focus: 'a', say: 'Look at a.' }, { camera: 'a', focus: 'a', say: 'Closer.' }, { camera: 'all', say: 'And back.' }])]);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.filter((w) => w.includes('nothing moves')), []);
});

test('validate warns when a zoom leaves a lit ref out of the shot', async () => {
  const { warnings } = await check([scene([{ camera: { on: 'a', zoom: 20 }, focus: 'a', say: 'Too close.' }, { camera: 'a', focus: ['a', 'b'], say: 'Both.' }])]);
  assert.deepEqual(warnings.filter((w) => w.includes('camera')), [
    'scenes[0].steps[0].camera: the step lights "a", but zoom 20 is too close to show all of it; frame it too, or lower the zoom',
    'scenes[0].steps[1].camera: the step lights "b", but it is out of the shot; frame it too, or lower the zoom',
  ]);
});

test('svg text too small for the whole scene reads once a camera zooms on it, but not while it shows unzoomed', async () => {
  const svg = '<svg viewBox="0 0 1712 804"><g id="detail"><rect x="800" y="400" width="40" height="20"/><text id="tiny" x="802" y="414" font-size="8">pin</text></g></svg>';
  const shown = (steps, hidden) => check([{ type: 'svg', svg, hidden, steps }]);
  const small = (r) => r.warnings.filter((w) => w.includes('too small to read'));
  assert.deepEqual(small(await shown([{ camera: 'detail', show: ['tiny'], say: 'Zoom in.' }, { camera: 'all', hide: ['tiny'], say: 'Back.' }], ['tiny'])), []);
  assert.deepEqual(small(await shown([{ camera: 'detail', focus: 'detail', say: 'Zoom in.' }], [])), [
    'scenes[0].svg: text "pin" (id "tiny") draws about 8.0 px tall on screen during the narration, too small to read; make its font-size at least 15 in viewBox units, or shrink the viewBox, or hide it until a step\'s camera zooms in on it',
  ]);
  assert.deepEqual(small(await shown([{ focus: 'detail', say: 'No camera.' }], [])), [
    'scenes[0].svg: text "pin" (id "tiny") draws about 8.0 px tall on screen, too small to read; make its font-size at least 15 in viewBox units, or shrink the viewBox',
  ]);
});

test('a code step\'s camera frames its lines or text on them', async () => {
  const hunks = { h: { id: 'h', file: 'a.js', lines: [{ type: 'context', oldLine: 1, newLine: 1, text: 'const a = 1;' }, { type: 'add', oldLine: null, newLine: 2, text: 'const b = 2;' }] } };
  const scenes = [{ type: 'code', hunkId: 'h', steps: [{ lines: '1-2', camera: 'const b', say: 'Look.' }, { lines: 2, camera: 'nope', say: 'Again.' }] }];
  assert.deepEqual(cameraShots(scenes[0], hunks).shots[1], { keys: ['tx:1:0:7'], refs: ['const b'], zoom: null });
  const { errors } = await check(scenes, hunks);
  assert.deepEqual(errors.filter((e) => e.includes('camera')), ['scenes[0].steps[1].camera: "nope" is not on the step\'s lines; name a line number, an "a-b" range, or text copied exactly from the code']);
});
