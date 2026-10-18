import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boldWeight, fitBlock, fitLines, fitText, fitTextAt, measure, runFont, wrapRuns } from '../shared/textfit.mjs';

const mono = { family: 'mono', weight: 400, size: 10 };
const slot = {
  name: 'card title',
  family: 'mono',
  weight: 400,
  size: 20,
  min: 10,
  lines: 2,
  lineHeight: 1.2,
  width: 60,
  fix: 'shorten it',
};
const texts = (fit) => fit.lines.map((line) => line.map((r) => r.text).join(''));

test('measures monospace text as a fixed advance per character', () => {
  assert.equal(measure('abcd', mono), 24);
  assert.equal(measure('i', mono), measure('W', mono));
});

test('letter spacing adds to every character and upper draws capitals', () => {
  const sans = { family: 'sans', weight: 400, size: 20 };
  assert.equal(measure('a', { ...sans, letterSpacing: 2 }) - measure('a', sans), 2);
  assert.equal(measure('ab', { ...mono, upper: true }), measure('AB', mono));
});

test('bold draws at 700, or 800 over text already 700 or heavier', () => {
  assert.equal(boldWeight(400), 700);
  assert.equal(boldWeight(700), 800);
  assert.deepEqual(runFont({ text: 'x', code: true }, { family: 'sans', weight: 800, size: 20 }), {
    family: 'mono',
    weight: 600,
    size: 18,
  });
});

test('wraps greedily at spaces and drops the breaking space', () => {
  const wrapped = wrapRuns([{ text: 'aaaa bbbb cccc' }], mono, measure('aaaa bbbb', mono));
  assert.deepEqual(wrapped.lines, [[{ text: 'aaaa bbbb' }], [{ text: 'cccc' }]]);
  assert.equal(wrapped.ok, true);
});

test('breaks a too-wide identifier at a camel-case boundary', () => {
  const wrapped = wrapRuns([{ text: 'PaymentProviderClient' }], mono, measure('PaymentProvider', mono));
  assert.deepEqual(wrapped.lines, [[{ text: 'PaymentProvider' }], [{ text: 'Client' }]]);
});

test('force breaks an unbreakable word between characters and reports not ok', () => {
  const wrapped = wrapRuns([{ text: 'abcdefgh' }], mono, measure('abc', mono), { force: true });
  assert.deepEqual(wrapped.lines, [[{ text: 'abc' }], [{ text: 'def' }], [{ text: 'gh' }]]);
  assert.equal(wrapped.ok, false);
});

test('empty text wraps to one empty line', () => {
  assert.deepEqual(wrapRuns([], mono, 100), { lines: [[]], widths: [0], ok: true });
});

test('fitText shrinks to the largest size that fits the line limit', () => {
  const fit = fitText('aaaa bbbb cccc', slot, 'scenes[0].title');
  assert.equal(fit.size, 11);
  assert.deepEqual(texts(fit), ['aaaa bbbb', 'cccc']);
  assert.equal(fit.fits, true);
  assert.equal(fit.height, 2 * 11 * 1.2);
  assert.equal(fit.path, 'scenes[0].title');
  assert.equal(fit.slot, 'card title');
});

test('fitText reports a text too long at the smallest size without cutting it', () => {
  const fit = fitText('a'.repeat(28), slot, 'p');
  assert.equal(fit.size, 10);
  assert.equal(fit.fits, false);
  assert.equal(texts(fit).join(''), 'a'.repeat(28));
  assert.equal(fit.lines.length, 3);
});

test('fitText keeps markup styles on the fitted runs and reports the styled share', () => {
  const fit = fitText('**hi** `x`', slot, 'p');
  assert.deepEqual(fit.lines[0][0], { text: 'hi', bold: true });
  assert.equal(fit.styled, 0.75);
  assert.equal(fitText('**hi**', { ...slot, markup: false }, 'p').lines[0][0].text, '**hi**');
});

test('fitTextAt holds the given size and reports when it does not fit', () => {
  const fit = fitTextAt('aaaa bbbb cccc', slot, 'p', 20);
  assert.equal(fit.size, 20);
  assert.equal(fit.fits, false);
  assert.deepEqual(texts(fit), ['aaaa', 'bbbb', 'cccc']);
});

test('fitLines picks the largest size where the widest line fits and names it', () => {
  const fit = fitLines(['abc', 'abcdef'], { ...slot, width: measure('abcdef', { ...mono, size: 15 }) }, 1000, 'code');
  assert.equal(fit.size, 15);
  assert.equal(fit.text, 'abcdef');
  assert.equal(fit.fits, true);
});

test('fitLines shrinks for height when the lines are too many', () => {
  const fit = fitLines(['a', 'b', 'c'], { ...slot, width: 1000 }, 3 * 12 * 1.2, 'code');
  assert.equal(fit.size, 12);
  assert.equal(fitLines(['a', 'b', 'c'], { ...slot, width: 1000 }, 1, 'code').fits, false);
});

test('fitBlock makes a report entry for a block', () => {
  const block = fitBlock('scenes[1].rows', 'table', false, 'drop rows');
  assert.equal(block.fits, false);
  assert.equal(block.slot, 'table');
  assert.equal(block.fix, 'drop rows');
});
