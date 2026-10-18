// A name such as "constructor", "toString" or "__proto__" written where a storyboard picks from a fixed table (a
// scene type, a projection, a transform function, a palette colour) is an unknown name, never a prototype member.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { sceneChapter } from '../shared/chapters.mjs';
import { legacyFocusKeys } from '../shared/normalize.mjs';
import { sceneSteps } from '../shared/steps.mjs';
import { refNames, resolveRef } from '../shared/targets.mjs';
import { buildFrames } from '../shared/timing.mjs';

const NAMES = ['constructor', 'toString', '__proto__'];
const check = (scene) => validateStoryboard({ title: 'T', scenes: [scene] }, {}, { mode: 'explain' });

test('a scene type named like a prototype member is an unknown type, and nothing looks it up', async () => {
  for (const type of NAMES) {
    const { errors } = await check({ type, narration: 'A thing.', steps: [{ say: 'It is here.' }] });
    assert.equal(errors.length, 1, type);
    assert.match(errors[0], new RegExp(`^scenes\\[0\\]\\.type: must be one of text, graph, .* \\(got "${type}"\\)$`));
    assert.deepEqual(
      [
        sceneChapter({ type }),
        buildFrames(type),
        sceneSteps({ type, steps: [{}] }),
        legacyFocusKeys(type),
        resolveRef({ type }, 'x'),
        refNames({ type }),
      ],
      [type, 0, [], [], null, []],
      type,
    );
  }
});

test('a move whose function is named like a prototype member is no transform', async () => {
  const scene = (move) => ({
    type: 'svg',
    narration: 'A drawing.',
    svg: '<svg viewBox="0 0 400 400"><g id="needle"><line x1="200" y1="200" x2="200" y2="80"/></g></svg>',
    steps: [{ move: { needle: move }, say: 'It swings round.' }],
  });
  for (const name of NAMES) {
    const { errors } = await check(scene(`${name}(1)`));
    assert.deepEqual(errors, [
      `scenes[0].steps[0].move["needle"]: "${name}(1)" is no transform; a move is translate(x y), rotate(degrees cx cy) and scale(s), alone or in a row, such as "translate(300 0) rotate(90 50 50)", or "" to put it back`,
    ]);
  }
  assert.deepEqual((await check(scene('rotate(30 200 200)'))).errors, []);
});

test('a map projection named like a prototype member is no projection', async () => {
  const map = (projection) => ({
    type: 'map',
    narration: 'A map.',
    projection,
    places: [{ id: 'a', at: [10, 10], label: 'A' }],
  });
  for (const name of NAMES)
    assert.deepEqual(
      (await check(map(name))).errors,
      ['scenes[0].projection: must be one of equal-earth, natural-earth, mercator'],
      name,
    );
});

test('an svg colour named like a prototype member is no palette colour', async () => {
  for (const name of NAMES) {
    const { errors } = await check({
      type: 'svg',
      narration: 'A drawing.',
      svg: `<svg viewBox="0 0 100 100"><rect id="a" width="10" height="10" fill="var(--${name})"/></svg>`,
    });
    assert.deepEqual(errors, [
      `scenes[0].svg: <svg> <rect id="a">: var(--${name}) is no palette colour; they are --text, --muted, --faint, --bg, --surface, --border, --accent, --good, --bad, --warn, --neutral`,
    ]);
  }
});
