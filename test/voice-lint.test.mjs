import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { speechText } from '../shared/speech.mjs';
import { spokenTexts } from '../shared/timing.mjs';

const voiceWarnings = async (...narrations) => {
  const scenes = narrations.map((narration) => ({ type: 'mermaid', narration, code: 'graph TD\n  a --> b' }));
  const { warnings } = await validateStoryboard({ title: 't', scenes }, {}, { mode: 'explain' });
  return warnings.filter((w) => /reads as code|status code|jargon|sentence of|opens with/.test(w));
};

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

test('code names, status codes and jargon in spoken text are warned with what to say', async () => {
  assert.deepEqual(await voiceWarnings('The route calls createOrder, then publishes order.created. Past twenty it answers 429. Each SKU is priced.'), [
    'scenes[0].narration: "createOrder" reads as code aloud; say "the create order function" or what it does. The screen shows the exact name',
    'scenes[0].narration: "order.created" reads as code aloud; say "order created", or what it is. The screen shows the exact name',
    'scenes[0].narration: "429" is a bare status code; say what it means, "too many requests", and the number only if it matters',
    'scenes[0].narration: "SKU" is jargon to a listener; say "product code", or explain it in a few words the first time',
  ]);
});

test('a scene opening on a bare pronoun or a long sentence is warned', async () => {
  const long = 'The limiter counts the request and then it checks the count against the limit and then it refuses the request when the count is over twenty in a minute.';
  assert.deepEqual(await voiceWarnings('It runs before every request.', long), [
    'scenes[0].narration: the scene opens with "It runs before", which points at nothing yet; name the subject, such as "The rate limiter ..."',
    'scenes[1].narration: a sentence of 29 words ("The limiter counts the request and then it chec..."); a listener cannot hold that, so split it into sentences of one idea each',
  ]);
});

test('plain speech passes: product names, explained terms, counts, and a status said with its meaning', async () => {
  assert.deepEqual(await voiceWarnings(
    'This is the rate limit function. Redis, a shared in-memory store, keeps one count per visitor on Node.js.',
    'The page loads 200 orders at a time. The limit is 200 per minute. On line 201, the function returns early. The server answers 429, too many requests.',
    'The steps are create, read and update, written in C++. The U.S. team awaits approval.',
    'Line ten returns a middleware. A middleware is a function that runs before the route.',
  ), []);
});
