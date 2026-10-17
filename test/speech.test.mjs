import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechText } from '../shared/speech.mjs';
import { spokenTexts } from '../shared/timing.mjs';

test('the voice reads written shorthand as words', () => {
  assert.equal(speechText('Use a cache, e.g. Redis, for counters.'), 'Use a cache, for example, Redis, for counters.');
  assert.equal(speechText('It waits 5s, then 200 ms.'), 'It waits 5 seconds, then 200 milliseconds.');
  assert.equal(speechText('client -> limiter'), 'client to limiter');
  assert.equal(speechText('The limit is 20 req/min, shipped in v0.14.0.'), 'The limit is 20 requests per minute, shipped in version 0 point 14 point 0.');
  assert.equal(speechText('In the 90s, i.e. long ago.'), 'In the 90s, that is, long ago.');
});

test('the voice leaves counts, decades, routes, addresses and spacing as written', () => {
  for (const text of ['100s of requests', 'the 90s and mid-90s', 'two 747s', 'GET /v1/orders', 'IP 192.168.1.1', 'a <-> b', 'Two  spaces.  Here']) {
    assert.equal(speechText(text), text);
  }
  assert.equal(speechText('A --> B, as in e.g.'), 'A to B, as in for example');
});

test('spoken text drops markup, then says shorthand in words', () => {
  assert.deepEqual(spokenTexts({ type: 'graph', narration: 'Waits **5s**, e.g. now.' }), ['Waits 5 seconds, for example, now.']);
});
