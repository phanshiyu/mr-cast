// Pictures that carry across scenes, point titles and tones (docs/adr/0047-easy-to-follow-explainers.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { normalizeStoryboard } from '../shared/normalize.mjs';

const bar =
  '<svg viewBox="0 0 1200 300"><rect id="fit" x="40" y="120" width="700" height="80" class="tone-good"/><rect id="spill" x="740" y="120" width="170" height="80" class="tone-bad"/><text id="label" x="40" y="250" font-size="40">a 50-byte array</text></svg>';

const storyboard = (scenes, extra = {}) => ({ title: 'Bytes past the end', pictures: { bar }, scenes, ...extra });
const svgScene = (title, steps, more = {}) => ({
  type: 'svg',
  title,
  picture: 'bar',
  narration: 'Here is the array.',
  steps,
  ...more,
});
const check = (sb) => validateStoryboard(sb, {}, { mode: 'explain' });

test('a picture scene draws the picture, and the next scene on it starts as the first ended', () => {
  const sb = normalizeStoryboard(
    storyboard([
      svgScene(
        'The decoder fills the array',
        [{ show: ['fit'], tint: { fit: 'good' }, say: 'It fills fifty bytes.' }],
        {
          hidden: ['fit', 'spill'],
        },
      ),
      svgScene('Twelve bytes land past the end', [{ show: ['spill'], say: 'Twelve land past the end.' }]),
      svgScene('The fix stops at fifty', [{ focus: ['label'], say: 'Zero past the end.' }], { hidden: ['spill'] }),
    ]),
    {},
  );
  assert.equal(sb.scenes[0].svg, bar);
  assert.equal(sb.scenes[1].svg, bar);
  assert.deepEqual(sb.scenes[1].hidden, ['spill']);
  assert.deepEqual(sb.scenes[1].tint, { fit: 'good' });
  assert.deepEqual(sb.scenes[2].hidden, ['spill'], "a scene's own hidden wins over what it continues");
});

test('validate accepts a picture run, and a part hidden in one scene may be shown by the next', async () => {
  const { errors, warnings } = await check(
    storyboard([
      svgScene('The decoder fills the array', [{ show: ['fit'], say: 'It fills fifty bytes.' }], {
        hidden: ['fit', 'spill'],
      }),
      svgScene('Twelve bytes land past the end', [{ show: ['spill'], say: 'Twelve land past the end.' }]),
    ]),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    warnings.filter((w) => w.startsWith('scenes')),
    [],
  );
});

test('validate refuses a picture the storyboard lacks, a picture off svg, and a scene with both', async () => {
  const { errors } = await check(
    storyboard([
      svgScene('The decoder fills the array', [{ say: 'One.' }], { picture: 'queue' }),
      { type: 'text', title: 'A text scene has none', picture: 'bar', narration: 'Two.', bullets: ['a'] },
      svgScene('Both a picture and its own drawing', [{ say: 'Three.' }], { svg: bar }),
    ]),
  );
  assert.ok(errors.some((e) => e.startsWith('scenes[0].picture: "queue" is not in the storyboard\'s pictures')));
  assert.ok(errors.some((e) => e.startsWith('scenes[1].picture: only an svg scene draws a picture')));
  assert.ok(errors.some((e) => e.startsWith('scenes[2].picture: the scene has its own svg too')));
});

test('validate warns about a title under three words, and a tone tones gives no meaning', async () => {
  const { warnings } = await check(
    storyboard(
      [
        svgScene('The ripple', [{ tint: { label: 'warn' }, say: 'One.' }]),
        svgScene('Each carry waits for the one before', [{ say: 'Two.' }]),
      ],
      { tones: { good: 'bytes that fit', bad: 'bytes past the end' } },
    ),
  );
  assert.ok(warnings.some((w) => w.startsWith('scenes[0].title: "The ripple" names a topic')));
  assert.ok(!warnings.some((w) => w.startsWith('scenes[1].title')));
  assert.ok(warnings.some((w) => w.startsWith('tones: scenes[0] steps[0].tint uses "warn"')));
  assert.ok(!warnings.some((w) => /uses "(good|bad)"/.test(w)));
});

test('validate warns about a step that changes nothing, and words that hold the picture still too long', async () => {
  const long = Array.from({ length: 30 }, () => 'word').join(' ');
  const { warnings } = await check(
    storyboard([
      svgScene('The decoder fills the array', [
        { focus: ['fit'], say: 'One.' },
        { focus: ['fit'], say: 'The same part again.' },
        { show: ['spill'], say: long },
      ]),
    ]),
  );
  assert.ok(warnings.some((w) => w.startsWith('scenes[0].steps[1]: changes nothing on screen')));
  assert.ok(!warnings.some((w) => w.startsWith('scenes[0].steps[0]: changes nothing')));
  assert.ok(warnings.some((w) => w.startsWith('scenes[0].steps[2].say: 30 words while the picture holds still')));
});

test('a longer explanation without a picture, or one that does not end on its picture, is warned about', async () => {
  const text = (title) => ({ type: 'text', title, narration: 'One.', bullets: ['a'] });
  const none = await check({
    title: 'Five scenes',
    scenes: [
      'A first point here',
      'A second point here',
      'A third point here',
      'A fourth point here',
      'A fifth one',
    ].map(text),
  });
  assert.ok(none.warnings.some((w) => w.startsWith('pictures: none; a video of 5 scenes')));
  const left = await check(
    storyboard([
      svgScene('The decoder fills the array', [{ show: ['fit'], say: 'One.' }], { hidden: ['fit'] }),
      text('A second point here'),
      text('A third point here'),
    ]),
  );
  assert.ok(
    left.warnings.some((w) => w.startsWith('pictures: the video starts on "bar" but does not come back to it')),
  );
});

test('validate takes look "board" or "plain" and refuses any other look', async () => {
  for (const look of ['board', 'plain']) {
    const ok = await check(storyboard([svgScene('The decoder fills the array', [{ say: 'One.' }])], { look }));
    assert.ok(!ok.errors.some((e) => e.startsWith('look')));
  }
  const bad = await check(storyboard([svgScene('The decoder fills the array', [{ say: 'One.' }])], { look: 'chalk' }));
  assert.ok(bad.errors.some((e) => e.startsWith('look: must be "board" or "plain"')));
});

test('on the board, validate warns about a scene that is not drawn on the picture', async () => {
  const table = { type: 'table', title: 'Who is hit by this', columns: ['a'], rows: [['b']], narration: 'Hit.' };
  const res = await check(
    storyboard([svgScene('The decoder fills the array', [{ show: ['fit'], say: 'One.' }]), table]),
  );
  assert.ok(res.warnings.some((w) => w.startsWith('look: on the board, scene 1 (table) is a slide')));
  const plain = await check(
    storyboard([svgScene('The decoder fills the array', [{ show: ['fit'], say: 'One.' }]), table], { look: 'plain' }),
  );
  assert.ok(!plain.warnings.some((w) => w.includes('on the board')));
});

test('validate warns about handwriting the scene ends before the pen finishes', async () => {
  const long = 'update every service and restart it tonight';
  const scene = (when) =>
    svgScene('The decoder fills the array', [
      { show: ['fit'], say: 'Then update and restart.', draw: [{ write: long, at: [0.1, 0.8], when }] },
    ]);
  const late = await check(storyboard([scene('restart')]));
  assert.ok(late.warnings.some((w) => w.startsWith('scenes[0].steps[0].draw[0]: the pen is still writing')));
  const short = await check(
    storyboard([
      svgScene('The decoder fills the array', [
        { show: ['fit'], say: 'Then update and restart.', draw: [{ write: 'update', at: [0.1, 0.8] }] },
      ]),
    ]),
  );
  assert.ok(!short.warnings.some((w) => w.includes('still writing')));
});

test('an explanation is drawn on the board unless it asks for plain, and a branch is plain unless it asks', () => {
  const sb = (look) => ({ title: 'T', scenes: [], ...(look ? { look } : {}) });
  assert.equal(normalizeStoryboard(sb(), {}).look, 'board');
  assert.equal(normalizeStoryboard(sb('plain'), {}).look, undefined);
  const diff = { 'a.ts': { status: 'modified' } };
  assert.equal(normalizeStoryboard(sb(), diff).look, undefined);
  assert.equal(normalizeStoryboard(sb('board'), diff).look, 'board');
});
