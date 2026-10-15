import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMarkup, parseMarkup, plainText, styledShare } from '../shared/markup.mjs';

test('splits bold, code, marked and toned text into runs', () => {
  const { runs, errors } = parseMarkup('a **b** `c*d` ==e== [f **g**]{good}');
  assert.deepEqual(runs, [
    { text: 'a ' },
    { text: 'b', bold: true },
    { text: ' ' },
    { text: 'c*d', code: true },
    { text: ' ' },
    { text: 'e', mark: true },
    { text: ' ' },
    { text: 'f ', tone: 'good' },
    { text: 'g', bold: true, tone: 'good' },
  ]);
  assert.deepEqual(errors, []);
});

test('keeps ** and == literal when surrounded by spaces', () => {
  assert.deepEqual(parseMarkup('a ** b and x == y'), { runs: [{ text: 'a ** b and x == y' }], errors: [] });
});

test('a backslash keeps a markup character literal', () => {
  assert.deepEqual(parseMarkup('\\*\\*not bold\\*\\*').runs, [{ text: '**not bold**' }]);
});

test('reports an unclosed code span at its column and keeps it literal', () => {
  const { runs, errors } = parseMarkup('ab `cd');
  assert.deepEqual(runs, [{ text: 'ab `cd' }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].at, 4);
  assert.match(errors[0].message, /never closes/);
});

test('reports an unknown tone and leaves the brackets as text', () => {
  const { runs, errors } = parseMarkup('[x]{loud}');
  assert.deepEqual(runs, [{ text: '[x]{loud}' }]);
  assert.equal(errors[0].at, 4);
  assert.match(errors[0].message, /unknown tone "loud"/);
});

test('reports a mark nested in a tone', () => {
  const { errors } = parseMarkup('[a ==b==]{bad}');
  assert.equal(errors[0].at, 4);
  assert.match(errors[0].message, /a mark and a tone do not nest/);
});

test('plainText strips markup the way a voice reads it', () => {
  assert.equal(plainText('Call **`run()`** on [the queue]{warn}'), 'Call run() on the queue');
});

test('hasMarkup is true for styled or escaped text and false for plain text', () => {
  assert.equal(hasMarkup('**x**'), true);
  assert.equal(hasMarkup('a \\* b'), true);
  assert.equal(hasMarkup('plain words'), false);
});

test('styledShare is the fraction of characters drawn styled', () => {
  assert.equal(styledShare('ab**cd**'), 0.5);
  assert.equal(styledShare(''), 0);
});
