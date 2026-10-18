import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { geoArea } from 'd3-geo';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { execFileSync } from 'node:child_process';
import {
  cameraOf,
  countriesAt,
  countryCode,
  loadWorld,
  mapLayout,
  mapProjection,
  onScreen,
  partialPath,
  zoomBetween,
} from '../shared/map.mjs';
import { walkStates } from '../shared/state-steps.mjs';

await loadWorld();

const check = async (scene) => validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' });
const errorsOf = async (scene) => (await check(scene)).errors;
const stage = { width: 1712, height: 734 };

const flight = {
  type: 'map',
  narration: 'A flight.',
  places: [
    { id: 'sin', at: [1.3644, 103.9915], label: 'Singapore' },
    { id: 'lhr', at: [51.47, -0.4543], label: 'London', side: 'left' },
  ],
  routes: [{ id: 'sin-lhr', stops: ['sin', 'lhr'] }],
  steps: [
    { trace: [{ ref: 'sin-lhr', when: 'London' }], say: 'It flies to London.' },
    {
      view: {
        box: [
          [0, 95],
          [10, 110],
        ],
      },
      focus: 'sin',
      say: 'Back at the start.',
    },
  ],
};

test('the bundled outline names countries by code and name, keeps 1:110m inside 1:50m, and winds every ring as d3-geo reads it', () => {
  assert.deepEqual(
    ['CAN', 'Canada', 'united states', 'United States of America', 'Kosovo', 'XYZ', 'can'].map(countryCode),
    ['CAN', 'CAN', 'USA', 'USA', 'KOS', null, null],
  );
  const [coarse, fine] = [countriesAt('110m'), countriesAt('50m')];
  assert.deepEqual([coarse.size, fine.size], [177, 242]);
  assert.deepEqual(
    [...coarse.keys()].filter((code) => !fine.has(code)),
    [],
  );
  const inverted = [...coarse.values(), ...fine.values()].filter((c) =>
    c.geometry.coordinates.some((p) => geoArea({ type: 'Polygon', coordinates: p }) > 2 * Math.PI),
  );
  assert.deepEqual(
    inverted.map((c) => c.code),
    [],
  );
});

test('a map scene fails on unknown countries, swapped points, bad stops, ids named like countries and a when the say lacks', async () => {
  const errors = await errorsOf({
    ...flight,
    tint: { Canda: 'good' },
    places: [...flight.places, { id: 'Canada', at: [103.99, 1.36] }, { id: 'x', at: 'Atlantis' }],
    routes: [{ id: 'r', stops: ['sin', 'sin', 'nowhere'] }],
    steps: [{ trace: [{ ref: 'r', when: 'Paris' }], say: 'It flies to London.' }],
  });
  assert.deepEqual(errors, [
    'scenes[0].places[2].id: "Canada" names the country CAN; pick an id no country is named by',
    'scenes[0].places[2].at: [103.99, 1.36] is no point; latitude runs -90 to 90 and longitude -180 to 180, so this reads as [lng, lat]; write [1.36, 103.99]',
    'scenes[0].places[3].at: "Atlantis" is no country; name one by its ISO 3166-1 alpha-3 code, such as "CAN", or its name',
    'scenes[0].routes[0].stops[2]: "nowhere" is no place id; places are "sin", "lhr", "Canada", "x"',
    'scenes[0].routes[0].stops[1]: is the same place as the stop before it, so that leg has no length; drop one',
  ]);
  assert.deepEqual(await errorsOf({ ...flight, tint: { Canda: 'good' } }), [
    'scenes[0].tint: Canda names no country, place, route, line or region; a tint key is a country code such as "CAN", or the id of a place, route, line or region; did you mean "Canada", "AND" or "CAN"?',
  ]);
  assert.deepEqual(
    await errorsOf({ ...flight, steps: [{ trace: [{ ref: 'sin-lhr', when: 'Paris' }], say: 'It flies to London.' }] }),
    [
      `scenes[0].steps[0].trace["sin-lhr"]: has "when": "Paris", which is not in the step's say; copy the words the route should arrive on`,
    ],
  );
  assert.deepEqual(await errorsOf({ ...flight, lines: [{ id: 'l', lat: 49, lng: 0 }] }), [
    'scenes[0].lines[0]: give lat for a parallel, such as 49, or lng for a meridian, such as 0; one of them',
  ]);
});

test('a route leg between opposite points of the globe fails, naming the stop, and one stop between them fixes it', async () => {
  const scene = (stops) => ({
    type: 'map',
    narration: 'A map.',
    places: [
      { id: 'quito', at: [-0.18, -78.47], label: 'Quito' },
      { id: 'opposite', at: [0.18, 101.53], label: 'Opposite' },
    ],
    routes: [{ id: 'r', stops }],
    steps: [{ trace: ['r'], say: 'Here it goes.' }],
  });
  const message = (k) =>
    `scenes[0].routes[0].stops[${k}]: is on the opposite side of the globe from the stop before it, so no one great circle joins them; add a stop between them on the way the route should go`;
  assert.deepEqual(
    await errorsOf(
      scene([
        [0, 0],
        [0, 180],
      ]),
    ),
    [message(1)],
  );
  assert.deepEqual(
    await errorsOf(
      scene([
        [10, 20],
        [-10, -160],
      ]),
    ),
    [message(1)],
  );
  assert.deepEqual(await errorsOf(scene([[0, 10], 'quito', 'opposite'])), [message(2)]);
  assert.deepEqual(
    await errorsOf(
      scene([
        [0, 0],
        [0, 90],
        [0, 180],
      ]),
    ),
    [],
  );
  assert.deepEqual(
    await errorsOf(
      scene([
        [0, 0],
        [0, 179.9],
      ]),
    ),
    [],
  );
});

test('a traced route is undrawn until its trace, which shows and lights it', () => {
  const { states, problems } = walkStates(flight);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    states.map((s) => Boolean(s.hidden['mr:sin-lhr'])),
    [true, false, false],
  );
});

test('validate warns on overlapping labels, labels off the stage, and a lit item the view leaves off screen', async () => {
  const { errors, warnings } = await check({
    ...flight,
    places: [
      ...flight.places,
      { id: 'cdg', at: [49.0, 2.55], label: 'Paris', side: 'left' },
      { id: 'nz', at: [-41, 174.8], label: 'Wellington, far away' },
    ],
    steps: [...flight.steps, { view: ['sin'], focus: 'lhr', say: 'London again.' }],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [
    'scenes[0]: the label "Wellington, far away" runs off the edge of the map at this view, so part of it is cut off; set its side to face into the map, or frame a wider view',
    'scenes[0]: the labels "London" and "Paris" overlap at this view; give one a side that points away, or frame a closer view',
    `scenes[0].steps[2]: lights "lhr", which this step's view leaves off the map; frame it with view, or light something on screen`,
  ]);
});

test('a view of one place frames the land round it', () => {
  const scene = { ...flight, view: ['sin'] };
  const { cameras, proj } = mapLayout(scene, stage);
  const [a, b] = [onScreen(proj, cameras[0], [99.99, 1.36]), onScreen(proj, cameras[0], [107.99, 1.36])];
  assert.ok(
    b[0] - a[0] > stage.width * 0.25 && b[0] - a[0] < stage.width,
    `8 degrees of longitude fill a good share of the width: ${a} ${b}`,
  );
});

test('a view frames its box, the zoom between two views starts and ends on them, and a trace is cut by length on the globe', () => {
  const scene = {
    type: 'map',
    narration: 'n',
    view: {
      box: [
        [48, -124],
        [50, -122],
      ],
    },
  };
  const proj = mapProjection(scene, stage);
  const camera = cameraOf(scene, scene.view, stage, proj);
  const [sw, ne] = [onScreen(proj, camera, [-124, 48]), onScreen(proj, camera, [-122, 50])];
  const centre = onScreen(proj, camera, [-123, 49]);
  assert.ok(
    Math.abs(centre[0] - stage.width / 2) < 2 && Math.abs(centre[1] - stage.height / 2) < 2,
    `centred: ${centre}`,
  );
  assert.ok(sw[1] > ne[1] && Math.abs(sw[1] - ne[1]) <= stage.height * 0.84 + 1, `framed with a margin: ${sw} ${ne}`);
  const world = { k: 1, x: 0, y: 0 };
  assert.deepEqual(
    [zoomBetween(world, camera, 0, stage), zoomBetween(world, camera, 1, stage)].map((c) =>
      [c.k, c.x, c.y].map(Math.round),
    ),
    [[1, 0, 0], [camera.k, camera.x, camera.y].map(Math.round)],
  );
  const half = partialPath(
    [
      [0, 0],
      [10, 0],
      [20, 0],
    ],
    0.75,
  );
  assert.deepEqual(
    half.map((p) => p.map((v) => Math.round(v * 1000) / 1000)),
    [
      [0, 0],
      [10, 0],
      [15, 0],
    ],
  );
});

test('the scene draws 1:110m for the world and 1:50m once a view zooms in or names a small country', () => {
  assert.equal(mapLayout({ type: 'map', narration: 'n' }, stage).detail, '110m');
  assert.equal(mapLayout({ type: 'map', narration: 'n', tint: { SGP: 'good' } }, stage).detail, '50m');
  assert.equal(mapLayout(flight, stage).detail, '50m');
});

// The scene as the player draws it after the trace, through react-dom/server with remotion's hooks stubbed.
const REMOTION = `import { createElement } from 'react';
export const AbsoluteFill = ({ children, style }) => createElement('div', { style }, children);
export const useCurrentFrame = () => 100000;
export const useVideoConfig = () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 });
export const spring = () => 1;
export const interpolate = (x, [a, b], [c, d]) => c + (d - c) * Math.min(1, Math.max(0, (x - a) / (b - a)));
export const Easing = { bezier: () => (t) => t, inOut: (f) => f, cubic: (t) => t };
export const delayRender = () => 0;
export const continueRender = () => {};`;
const root = new URL('..', import.meta.url).pathname;

test('the map scene draws every country, the traced route and its labels', async () => {
  const bundled = await build({
    stdin: {
      contents: `export { MapDiagram } from './src/components/MapDiagram.tsx'; export { renderToStaticMarkup } from 'react-dom/server'; export { createElement } from 'react'; export { sceneSegments } from './shared/timing.mjs'; export { loadWorld } from './shared/map.mjs';`,
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
  const {
    MapDiagram,
    renderToStaticMarkup,
    createElement,
    sceneSegments,
    loadWorld: loadBundledWorld,
  } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  await loadBundledWorld();
  const scene = { ...flight, steps: [flight.steps[0]] };
  const html = renderToStaticMarkup(
    createElement(MapDiagram, { scene, hunks: {}, durationInFrames: 300, segments: sceneSegments(scene) }),
  );
  // Every 1:110m country, the sphere, and the route.
  assert.equal((html.match(/<path /g) ?? []).length, countriesAt('110m').size + 2);
  assert.match(html, />Singapore<\/text>/);
  assert.match(html, />London<\/text>/);
  assert.doesNotMatch(html, /NaN/);
});

test('the outline is its own chunk, read only by loadWorld, so a player without a map scene never parses it', async () => {
  const bundled = await build({
    entryPoints: [`${root}shared/state-steps.mjs`],
    bundle: true,
    splitting: true,
    write: false,
    format: 'esm',
    outdir: '/out',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    logLevel: 'silent',
  });
  const [entry, ...chunks] = bundled.outputFiles;
  assert.match(entry.path, /state-steps\.js$/);
  assert.doesNotMatch(entry.text, /"Kosovo"/);
  assert.equal(chunks.filter((c) => c.text.includes('"Kosovo"')).length, 2);
  const before = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(`${root}shared/map.mjs`)}); try { m.countryCode('Canada'); } catch (e) { console.log(e.message); } await m.loadWorld(); console.log(m.countryCode('Canada'));`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(before, 'the world outline is not loaded; await loadWorld() before reading a map scene\nCAN\n');
});
