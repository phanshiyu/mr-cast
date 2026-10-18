import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { sceneSegments } from '../shared/timing.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const load = async (file) => {
  const out = await build({
    entryPoints: [new URL(file, import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};
const { layoutCode } = await load('../src/utils/codeLayout.ts');
const { typingSchedule } = await load('../src/utils/codeTyping.ts');

const demo = new URL('../examples/primitives/code-typing/', import.meta.url);
const hunks = JSON.parse(fs.readFileSync(new URL('hunks.json', demo), 'utf8'));
const board = JSON.parse(fs.readFileSync(new URL('storyboard.json', demo), 'utf8'));
const [fizz, retry] = board.scenes;

test('a typing scene types each step in turn, within its words, and keeps the lines no step names', () => {
  const layout = layoutCode(fizz, hunks.s1);
  const texts = layout.slots.map((slot) => hunks.s1.lines[slot.left].text);
  const segments = sceneSegments(fizz, null);
  const { lines, ends } = typingSchedule(texts, layout.slots, layout.stepCount, segments, 2000);
  // Line 9, blank and named by no step, is there from the start; every other line is typed by its step.
  assert.deepEqual(
    lines.map((l, r) => (l ? layout.slots[r].step : null)),
    [0, 0, 1, 2, 2, 2, 2, 2, null, 3],
  );
  lines.forEach((line, r) => {
    if (!line) return;
    const [segment, next] = [segments[layout.slots[r].step + 1], segments[layout.slots[r].step + 2]];
    assert.ok(line.from > segment.from && (!next || line.from < next.from), `line ${r} starts in its step`);
    assert.ok(line.perFrame >= 0.6 && line.perFrame <= 3, `line ${r} types at ${line.perFrame} characters a frame`);
  });
  ends.forEach((end, k) =>
    assert.ok(!segments[k + 2] || end <= segments[k + 2].from - 6, `step ${k} is typed before the next starts`),
  );
});

test('a typing scene of a diff draws no removed lines, and output puts the code beside a pane', () => {
  const layout = layoutCode(retry, hunks.h1);
  assert.deepEqual(
    layout.slots.map((s) => hunks.h1.lines[s.left].type),
    ['context', 'add', 'add', 'add', 'add', 'add', 'context'],
  );
  assert.equal(layout.view, 'morph');
  assert.deepEqual(
    layout.output.lines.map((l) => [l.step, l.fit.text]),
    [
      [0, '$ npm test'],
      [0, '[✗ retries a 503]{bad} expected 1 call to be 3'],
      [1, '$ npm test'],
      [1, '[✓ retries a 503]{good}'],
      [1, '[✓ gives up after three tries]{good}'],
    ],
  );
  assert.ok(layout.output.x > layout.panelW);
  assert.equal(layoutCode({ ...retry, steps: retry.steps.map(({ output, ...s }) => s) }, hunks.h1).output, null);
});

test('validate names typing and output that cannot play', async () => {
  const check = async (scene) =>
    (await validateStoryboard({ title: 't', scenes: [scene] }, hunks, { mode: 'diff' })).errors;
  assert.deepEqual(await check({ type: 'code', hunkId: 'h1', narration: 'x', typing: true }), [
    'scenes[0].typing: each step types its lines, so the scene needs steps',
  ]);
  assert.deepEqual(await check({ ...retry, view: 'split' }), [
    'scenes[0].view: a typing scene draws its code in one column; drop view "split"',
  ]);
  assert.deepEqual(await check({ ...retry, steps: [{ oldLines: 2, say: 'gone' }, retry.steps[1]] }), [
    'scenes[0].steps[0].oldLines: a typing scene writes the new code and draws no removed lines; type new lines with lines, or drop typing',
  ]);
  assert.deepEqual(
    await check({
      ...retry,
      steps: [
        { ...retry.steps[0], outputWhen: 'it prints' },
        { ...retry.steps[1], output: undefined, outputWhen: 'three' },
      ],
    }),
    [
      'scenes[0].steps[0].outputWhen: "it prints" is not in the step\'s say',
      'scenes[0].steps[1].outputWhen: the step has no output to print',
    ],
  );
  assert.deepEqual(await check({ ...retry, steps: retry.steps.map((s) => ({ ...s, label: 'a step' })) }), [
    'scenes[0].steps: the output pane and the step diagram both sit beside the code; drop the labels or the output',
  ]);
});
