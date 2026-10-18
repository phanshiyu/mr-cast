import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { changedRefs, walkStates } from '../shared/state-steps.mjs';

const check = async (scenes) => validateStoryboard({ title: 't', scenes: scenes.map((s) => ({ chapter: 'c', narration: 'n', ...s })) }, {}, { mode: 'explain' });
const about = (list, word) => list.filter((m) => m.includes(word));

const svg = { type: 'svg', svg: '<svg viewBox="0 0 1712 804"><path id="route" d="M0 400 L1700 400" stroke="var(--good)"/><text id="t" x="10" y="40" font-size="30">a</text></svg>' };
const plot = { type: 'plot', x: { from: 0, to: 10 }, y: { from: 0, to: 100 }, params: { k: 1 }, functions: [{ id: 'line', y: 'k * x * x' }], points: [{ id: 'dot', at: ['k', 'k'] }] };
const map = { type: 'map', places: [{ id: 'sin', at: [1.36, 103.99], label: 'Singapore' }, { id: 'lhr', at: [51.47, -0.45], label: 'London' }], routes: [{ id: 'flight', stops: ['sin', 'lhr'] }] };

test('svg, plot and map record a trace the same way: shown, keyed in the step state with its cue, and lit by the step', () => {
  const traced = [
    [{ ...svg, steps: [{ trace: [{ ref: 'route', when: 'east' }], say: 'It runs east.' }] }, 's:route', 'east'],
    [{ ...plot, steps: [{ trace: ['line'], say: 'It curves up.' }] }, 'p:line', null],
    [{ ...map, steps: [{ trace: [{ ref: 'flight', when: 'London' }], say: 'It lands in London.' }] }, 'mr:flight', 'London'],
  ];
  for (const [scene, key, cue] of traced) {
    const { states, problems } = walkStates(scene);
    assert.deepEqual(problems, [], scene.type);
    assert.deepEqual([states[0].traces, states[1].traces], [{}, { [key]: cue }], scene.type);
    assert.equal(states[1].hidden[key], undefined, scene.type);
    assert.deepEqual(changedRefs(scene, scene.steps[0]), [key.slice(key.indexOf(':') + 1)], scene.type);
  }
});

test('each scene refuses the trace entries it cannot take, in the same words', async () => {
  const { errors } = await check([
    { ...svg, steps: [{ trace: [{ id: 'route' }], say: 'Old shape.' }, { trace: ['t'], say: 'Text.' }] },
    { ...plot, steps: [{ trace: [{ ref: 'line', when: 'up' }], say: 'It goes up.' }, { trace: ['dot'], say: 'A point.' }] },
    { ...map, steps: [{ trace: ['sin'], say: 'A place.' }, { trace: [{ ref: 'flight', when: 'Paris' }], say: 'It lands.' }] },
    { type: 'array', values: [1, 2], steps: [{ trace: ['0'], say: 'No.' }] },
  ]);
  assert.deepEqual(about(errors, 'trace'), [
    'scenes[0].steps[0].trace[0]: must be an element id, or { "ref": "...", "when": "words of the say" }',
    'scenes[0].steps[1].trace["t"]: is a <text>, which has no line to draw on; trace a path, line, polyline, polygon, rect, circle, ellipse, or a <g> of them',
    'scenes[1].steps[0].trace[0]: must be a part id; the step\'s own "when" times the trace',
    'scenes[1].steps[1].trace["dot"]: is a point, which has no line to trace; show it instead',
    'scenes[2].steps[0].trace["sin"]: names no route or line; trace takes the id of a route or a line; it can be "flight"',
    'scenes[2].steps[1].trace["flight"]: has "when": "Paris", which is not in the step\'s say; copy the words the route should arrive on',
    'scenes[3].steps[0].trace: an array scene has nothing to trace; trace goes on the steps of svg, plot, map',
  ]);
});

test('a map moves its camera with view, and a picture that pans with kenBurns takes no step camera', async () => {
  const { errors } = await check([
    { ...map, steps: [{ camera: 'sin', say: 'Zoom.' }] },
    { type: 'image', src: 'nowhere.png', kenBurns: true, regions: [{ id: 'face', box: [0.1, 0.1, 0.2, 0.2] }], steps: [{ camera: 'face', say: 'A face.' }] },
  ]);
  assert.deepEqual(about(errors, 'camera'), [
    'scenes[0].steps[0].camera: a map moves its camera with `view`, which keeps labels their size as it zooms; write "view": refs, "world" or { "box": [[lat, lng], [lat, lng]] }',
    'scenes[1].steps[0].camera: the picture already pans and zooms with kenBurns; drop kenBurns to move the camera by step, or drop camera',
  ]);
});

test('validate knows where plot parts and chart bars are, so a camera that crops a lit one is reported', async () => {
  const race = { type: 'chart', kind: 'bar', horizontal: true, labels: ['a', 'b', 'c'], series: [{ name: 'n', values: [1, 2, 3] }] };
  const { errors, warnings } = await check([
    { ...plot, steps: [{ camera: { on: 'dot', zoom: 30 }, focus: ['dot', 'line'], say: 'Close on the dot.' }] },
    { ...race, steps: [{ set: { n: [3, 2, 1] }, sort: true, camera: { on: 'n@a', zoom: 20 }, focus: ['n@a', 'n@c'], say: 'A leads.' }] },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(about(warnings, 'camera'), [
    'scenes[0].steps[0].camera: the step lights "line", but it is out of the shot; frame it too, or lower the zoom',
    'scenes[1].steps[0].camera: the step lights "n@a", "n@c", but zoom 20 is too close to show all of it; frame it too, or lower the zoom',
  ]);
});
