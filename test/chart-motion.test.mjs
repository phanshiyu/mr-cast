import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { normalizeStoryboard } from '../shared/normalize.mjs';
import { walkStates } from '../shared/state-steps.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const bundled = await build({ entryPoints: [new URL('../src/utils/chartLayout.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { between, chartOrder, chartStates } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const race = (steps, extra = {}) => ({
  type: 'chart',
  kind: 'bar',
  horizontal: true,
  sort: true,
  narration: 'Services by language.',
  labels: ['Python', 'Java', 'Go'],
  series: [{ name: 'services', values: [24, 31, 6] }],
  steps,
  ...extra,
});
const check = async (scene) => validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' });

test('a chart step sets a series by name or one value, and later steps keep it', () => {
  const scene = race([
    { set: { services: [27, 30, 14] }, callout: '2021', say: 'Go doubles.' },
    { set: { 'services@Go': 33 }, sort: false, say: 'Go leads.' },
  ]);
  const { states, problems } = walkStates(scene);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    states.map((s) => [s.values, s.sort, s.callout]),
    [
      [{ 'p:0/0': 24, 'p:0/1': 31, 'p:0/2': 6 }, true, ''],
      [{ 'p:0/0': 27, 'p:0/1': 30, 'p:0/2': 14 }, true, '2021'],
      [{ 'p:0/0': 27, 'p:0/1': 30, 'p:0/2': 33 }, false, '2021'],
    ],
  );
});

test('validate names a chart set that names nothing, has the wrong length or holds a negative bar', async () => {
  const { errors, warnings } = await check(
    race([
      { set: { servics: [1, 2, 3] }, focus: 'Go', say: 'a' },
      { set: { services: [1, 2] }, focus: 'Go', say: 'b' },
      { set: { 'services@Go': -1 }, focus: 'Go', say: 'c' },
      { set: { 'services@Go': [1] }, focus: 'Go', say: 'd' },
      { set: { 'services@Java': 31 }, focus: 'Java', say: 'e' },
      { show: ['Go'], focus: 'Go', say: 'f' },
    ]),
  );
  assert.deepEqual(errors, [
    'scenes[0].steps[0].set["servics"]: names no series or value; a set key is a series name ("services"), or a value "series@label"; did you mean "services"?',
    'scenes[0].steps[1].set["services"]: has 2 values for 3 labels; give one value per label',
    'scenes[0].steps[2].set["services@Go"]: is below 0; bars start at zero, so values must be 0 or more',
    'scenes[0].steps[3].set["services@Go"]: is one value, so it takes one number; set the series by its name to give every label a value',
    'scenes[0].steps[5].show: a chart scene draws every part from the start, so it takes no show; set values from 0 to grow them',
  ]);
  assert.deepEqual(warnings, ['scenes[0].steps[4].set["services@Java"]: already holds 31, so nothing changes; drop it or set a new value']);
});

test('validate keeps pies to one series, bars to sort and stack, and annotations to vertical charts', async () => {
  const pie = { type: 'chart', kind: 'pie', narration: 'x', labels: ['a', 'b'], series: [{ name: 's', values: [1, 2] }, { name: 't', values: [3, 4] }], annotation: { at: 'a', text: 'here' } };
  assert.deepEqual((await check(pie)).errors, [
    'scenes[0].series: a pie draws one series, one slice per label; give one series, or use kind "bar"',
    'scenes[0].annotation: only a vertical bar or line chart draws an annotation; say it, or put it in the callout',
  ]);
  const line = { type: 'chart', kind: 'line', narration: 'x', labels: ['a', 'b'], series: [{ name: 's', values: [1, 2] }], horizontal: true, stacked: true, sort: true };
  assert.deepEqual((await check(line)).errors, [
    'scenes[0].horizontal: only a bar chart is drawn horizontally; drop it, or use kind "bar"',
    'scenes[0].stacked: only a bar chart is drawn stacked; drop it, or use kind "bar"',
    'scenes[0].sort: a line chart keeps its labels in order; sort orders bars and slices',
  ]);
  const empty = { type: 'chart', kind: 'donut', narration: 'x', labels: ['a', 'b'], series: [{ name: 's', values: [1, 2] }], steps: [{ set: { s: [0, 0] }, say: 'gone' }] };
  assert.deepEqual((await check(empty)).errors, ['scenes[0].steps[0].set: every slice is 0 from this step, so the donut has nothing to draw']);
  const sortLine = { ...line, horizontal: undefined, stacked: undefined, sort: undefined, steps: [{ sort: true, focus: 'a', say: 'x' }] };
  assert.deepEqual((await check(sortLine)).errors, ['scenes[0].steps[0].sort: a line chart keeps its labels in order; sort orders bars and slices']);
});

test('sorted bars rank by value, largest first, a stack by its total, and ties keep the order of labels', () => {
  const scene = { kind: 'bar', labels: ['a', 'b', 'c', 'd'], series: [{ name: 's', values: [] }, { name: 't', values: [] }] };
  const values = [[1, 9, 5, 6], [2, 0, 1, 1]];
  // Each label's place: by the last series, d and c tie and keep their order.
  assert.deepEqual(chartOrder(scene, values, true), [0, 3, 1, 2]);
  assert.deepEqual(chartOrder({ ...scene, stacked: true }, values, true), [3, 0, 2, 1]);
  assert.deepEqual(chartOrder(scene, values, false), [0, 1, 2, 3]);
});

test('a value between two keeps the decimals they are written with', () => {
  assert.equal(between(24, 31, 0.5), 28);
  assert.equal(between(24, 30, 0.33), 26);
  assert.equal(between(0.25, 0.5, 0.5), 0.38);
  assert.equal(between(3, 9, 1), 9);
});

test('a chart step that sets and names no focus lights what it sets, and an older "label" step still lights its label', () => {
  const scene = race([{ set: { services: [27, 30, 14] }, say: 'All three move.' }, { label: 'Go', say: 'Go.' }]);
  const [normalized] = normalizeStoryboard({ title: 't', scenes: [scene] }, {}).scenes;
  assert.deepEqual(normalized.steps.map((s) => s.focus), [['series:services'], 'Go']);
  assert.equal(normalized.steps[1].label, undefined);
  assert.deepEqual(chartStates(scene).map((s) => s.values), [[[24, 31, 6]], [[27, 30, 14]], [[27, 30, 14]]]);
});
