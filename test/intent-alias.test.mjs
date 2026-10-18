import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoryboard } from '../shared/normalize.mjs';
import { formatSchema } from '../bin/lib/schema.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const root = new URL('..', import.meta.url).pathname;
const intent = (fields) => ({ type: 'intent', chapter: 'Why', narration: 'Orders now have a limit.', summary: 'Limit orders to 20 a minute', risk: 'low', bullets: ['Per visitor', 'Retry after a minute'], ...fields });
const validate = (scenes, extra = {}) => validateStoryboard({ title: 'Rate limits', subtitle: 'feature → main', scenes, ...extra }, {}, { mode: 'explain' });

test('an intent scene draws as a text scene: summary as headline, bullets as items, the title line as kicker', () => {
  const out = normalizeStoryboard({ title: 'Rate *limits*', subtitle: 'feature → main', scenes: [intent({ steps: [{ focus: 1, say: 'Then retry.' }] })] }, {});
  assert.deepEqual(out.scenes[0], {
    type: 'text',
    chapter: 'Why',
    narration: 'Orders now have a limit.',
    risk: 'low',
    kicker: 'Rate \\*limits\\* · [feature → main]{neutral}',
    headline: 'Limit orders to 20 a minute',
    items: ['Per visitor', 'Retry after a minute'],
    diffstat: true,
    steps: [{ focus: 1, say: 'Then retry.' }],
  });
});

test('a well-formed intent scene validates as it did', async () => {
  assert.deepEqual(await validate([intent({ steps: [{ focus: 1, say: 'Then retry.' }] })]), { errors: [], warnings: [], coverage: null });
});

test('an intent scene is reported by its own field names, not the text scene it draws as', async () => {
  const long = 'A bullet far too long to fit on two lines at any readable size, since it rambles on and on about every detail of the limiter, the proxy, the headers and the retry';
  const { errors, warnings } = await validate([intent({ narration: 'There are three things to check.', bullets: ['Per visitor', long], steps: [{ focus: 4, say: 'x' }] })]);
  assert.deepEqual(errors, ['scenes[0].steps[0].focus: 4 names nothing in this scene, where a ref is a bullet index or "a-b" range, "note", "kicker", the lead\'s field name such as "headline", or a side "left" or "right"']);
  assert.deepEqual(warnings, ['scenes[0].narration: says "three things", but the scene has 2 bullets; say the number on screen']);
});

test('text that does not fit an intent scene names the bullet, the summary or the storyboard title', async () => {
  const long = 'A bullet far too long to fit on two lines at any readable size. '.repeat(8).trim();
  const title = 'A storyboard title so long that the line above the summary cannot hold it. '.repeat(3).trim();
  const { errors } = await validate([intent({ bullets: ['Per visitor', long] })], { title });
  assert.deepEqual(errors, [
    `title: "${title} · [feature → main]{neutral}" does not fit its title, even at 20px; shorten the title`,
    `scenes[0] ("Why").bullets[1]: "${long}" does not fit its bullet, even at 24px; shorten the bullet or split it in two`,
  ]);
});

test('an intent scene missing its own fields reports them once, and the rest of the scene is still checked', async () => {
  const { errors } = await validate([{ type: 'intent', bullets: 'one' }]);
  assert.deepEqual(errors, ['scenes[0].summary: required string', 'scenes[0].bullets: required array of strings', 'scenes[0].narration: required string']);
});

test('mr-cast schema lists text and no longer intent', () => {
  assert.match(formatSchema(root), /scene's fields: text, graph,/);
  assert.match(formatSchema(root, 'text'), /interface TextScene extends SceneBase, TextLead/);
  assert.throws(() => formatSchema(root, 'intent'), /no scene type or schema type "intent"/);
});
