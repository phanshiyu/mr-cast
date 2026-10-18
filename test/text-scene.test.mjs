import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const bundled = await build({ entryPoints: [new URL('../src/utils/textLayout.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { countText, layoutText, textRects } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const check = (scene) => validateStoryboard({ title: 't', scenes: [{ narration: 'Here it is.', ...scene, type: 'text' }] }, {}, { mode: 'explain' });
const LEADS = ['headline', 'question', 'number', 'term', 'quote'];
const items = ['One', 'Two', 'Three', 'Four'];

test('a text scene draws one lead, and items or sides but not both', async () => {
  assert.deepEqual((await check({ headline: 'A', question: 'B?' })).errors, ['scenes[0]: sets headline and question; a text scene draws one lead, so keep one']);
  assert.deepEqual((await check({ kicker: 'Only a kicker' })).errors, ['scenes[0]: needs a lead (headline, question, number, term, quote) or two sides']);
  assert.deepEqual((await check({ headline: 'A', items: ['a'], sides: [{ term: 'X' }, { term: 'Y' }] })).errors, ['scenes[0]: has items and sides; the sides take the room items would, so put the items in a side']);
  assert.deepEqual((await check({ headline: 'A', items: [...items, ...items] })).errors, ['scenes[0].items: 8 items; the scene holds 6']);
  assert.deepEqual((await check({ sides: [{ label: 'L', items }, { label: 'R', items: [...items, 'Five'] }] })).errors, ['scenes[0].sides[1].items: 5 items; a side holds 4']);
  assert.deepEqual((await check({ headline: 'A', hidden: ['note'] })).errors, ['scenes[0].hidden: "note" names nothing in the scene']);
});

test('every lead validates as written', async () => {
  for (const lead of LEADS) assert.deepEqual(await check({ chapter: lead, [lead]: lead === 'number' ? '500 hours' : 'Short', note: 'A note' }), { errors: [], warnings: [], coverage: null }, lead);
});

test('a lead too long for the frame is reported under its own field name', async () => {
  const long = 'Words that go on far past what any frame can hold at a readable size. '.repeat(8).trim();
  for (const lead of LEADS) {
    const { errors } = await check({ chapter: lead, [lead]: lead === 'number' ? `1 ${long}` : long });
    assert.ok(errors.some((e) => e.startsWith(`scenes[0] ("${lead}").${lead}: "`) && e.includes('does not fit')), `${lead}: ${errors.join('\n')}`);
  }
});

test('text a step sets that does not fit is reported at the step that set it', async () => {
  const long = 'Words that go on far past what any frame can hold at a readable size. '.repeat(8).trim();
  const { errors } = await check({ headline: 'Once upon a', note: 'A tale', steps: [{ set: { headline: 'Once upon a time' }, say: 'Time.' }, { set: { headline: long }, say: 'And on.' }, { set: { note: long }, say: 'And on.' }] });
  assert.deepEqual(errors.map((e) => e.slice(0, e.indexOf(':'))), ['scenes[0].steps[1].set.headline', 'scenes[0].steps[2].set.note']);
});

test('a hidden ref that no step shows is reported once, naming the items it leaves out', async () => {
  const { warnings } = await check({ headline: 'A list', items, note: 'Below', hidden: ['0-3', 'note'], steps: [0, 1, 2].map((i) => ({ show: [i], say: `Item ${i}.` })) });
  assert.deepEqual(warnings, [
    'scenes[0].hidden[0]: "0-3" starts hidden and no step shows item 3, so it is never drawn',
    'scenes[0].hidden[1]: "note" starts hidden and no step shows it, so it is never drawn',
  ]);
});

test('a spoken count that disagrees with the items is reported', async () => {
  const { warnings } = await check({ headline: 'A list', items, narration: 'There are three things to know.' });
  assert.deepEqual(warnings, ['scenes[0].narration: says "three things", but the scene has 4 items; say the number on screen']);
});

test('a pen mark on a text step validates', async () => {
  assert.deepEqual((await check({ term: 'Access token', note: 'A key that runs out', steps: [{ focus: 'note', mark: 'underline', note: 'one hour', say: 'It runs out.' }] })).errors, []);
});

test('a number counts from 0 as the scene opens, and from the old figure when a step sets a new one', () => {
  const count = (number) => layoutText({ type: 'text', narration: '', number }).block.lead.count;
  const [from, to] = [count('500 hours'), count('720,000 hours')];
  assert.deepEqual([0, 0.5, 1].map((t) => countText(to, t)), ['0', '360,000', '720,000']);
  assert.deepEqual([0, 0.5, 1].map((t) => countText(to, t, from)), ['500', '360,250', '720,000']);
  assert.deepEqual([0, 1].map((t) => countText(count('$1.50'), t, count('$4'))), ['$4.00', '$1.50']);
  assert.equal(countText(count('9%'), 0.5, count('$4')), null);
});

test('a crowded text scene shrinks its items first, then its lead, and reports what will not fit rather than draw it unreadably small', () => {
  const item = (i) => `Point ${i} runs to two full lines on screen, so that six of them crowd the frame below the headline, the note and the badge above them all, and then it keeps going with more words`;
  const scene = { type: 'text', narration: '', kicker: 'A kicker', headline: 'A headline long enough to take all three of its lines on the screen at its full size, which is what it does here', note: 'A note under it that runs to two lines as well, since it is long', risk: 'high', items: [0, 1].map(item) };
  const sizes = (l) => [l.block.kicker.size, l.block.lead.main.size, l.block.note.size, ...l.items.map((f) => f.size)];
  assert.deepEqual(sizes(layoutText(scene)), [28, 68, 42, 36, 36]);
  const crowded = layoutText({ ...scene, items: [0, 1, 2, 3, 4, 5].map(item) });
  assert.deepEqual(sizes(crowded), [28, 44, 34, 24, 24, 24, 24, 24, 24]);
  assert.equal(crowded.room.fits, false);
});

test('a question over two sides keeps them clear of its question mark, and the fit check reports text that would run into it', async () => {
  const sides = [
    { label: 'ser', term: 'es', note: 'what something **is**' },
    { label: 'estar', term: 'está', note: 'where it is, and how it is **right now**' },
  ];
  const scene = { type: 'text', narration: '', kicker: 'Spanish has two verbs for “is”', question: '¿Es o está?', sides };
  const layout = layoutText(scene);
  const { box } = layout.mark;
  assert.deepEqual([layout.mark.size, Math.round(box.x)], [585, 1370]);
  // The sides share the 80% left of the mark: the right one starts at 749px and its note wraps to two lines there.
  const right = textRects(layout, 780, (1712 * 0.8 - 128) / 2).filter((r) => r.x > 700);
  assert.deepEqual(right.map((r) => Math.round(r.x)), [749, 749, 749]);
  assert.equal(layout.sides[1].block.note.lines.length, 2);
  assert.ok(right.every((r) => r.x + r.width < box.x));
  assert.equal(layout.clear.fits, true);
  assert.deepEqual((await check({ kicker: scene.kicker, question: scene.question, sides })).errors, []);
  // Laid out at the full width, as a headline's sides are, the right note runs under the mark: the check sees it.
  const wide = layoutText({ ...scene, question: undefined, headline: scene.question });
  const hits = textRects(wide, 780, (1712 - 128) / 2).filter((r) => r.x < box.x + box.width && box.x < r.x + r.width && r.y < box.y + box.height && box.y < r.y + r.height);
  assert.equal(hits.length, 1);
});
