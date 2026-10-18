import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voicedLines } from '../bin/lib/voice.mjs';
import { narrationKey } from '../shared/voice.mjs';

const storyboard = {
  scenes: [
    {
      type: 'graph',
      narration: 'The request reaches the limiter.',
      steps: [
        { focus: 'a', say: 'It checks the bucket.' },
        { focus: 'b', say: 'It answers 429.' },
      ],
    },
    { type: 'array', narration: 'The limits, sorted.', steps: [{ focus: 0, say: 'It checks the bucket.' }] },
  ],
};
const voiced = (...texts) => ({
  voice: 'af_heart',
  speed: 1,
  clips: Object.fromEntries(texts.map((t) => [narrationKey(t, 'af_heart', 1), { src: 'audio/x.wav' }])),
});

test('voicing counts spoken lines, each distinct text once, so it moves before a whole scene is voiced', () => {
  assert.deepEqual(voicedLines(storyboard, voiced()), { done: 0, total: 4 });
  assert.deepEqual(voicedLines(storyboard, voiced('The request reaches the limiter.')), { done: 1, total: 4 });
  assert.deepEqual(
    voicedLines(
      storyboard,
      voiced('The request reaches the limiter.', 'It checks the bucket.', 'It answers 429.', 'The limits, sorted.'),
    ),
    { done: 4, total: 4 },
  );
});
