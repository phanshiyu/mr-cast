import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFrames,
  sceneDurationInFrames,
  sceneSegments,
  settledFrame,
  spokenAt,
  spokenTexts,
  wordCount,
} from '../shared/timing.mjs';
import { narrationKey } from '../shared/voice.mjs';

const thirteen = 'one two three four five six seven eight nine ten eleven twelve thirteen';
const graph = { type: 'graph', narration: thirteen, steps: [{ say: 'two **words**' }] };

test('build frames come from the scene type at 30 fps', () => {
  assert.equal(buildFrames('graph'), 45);
  assert.equal(buildFrames('code'), 0);
  assert.equal(buildFrames('unknown'), 0);
});

test('counts words across any whitespace', () => {
  assert.equal(wordCount('  a  b\nc '), 3);
  assert.equal(wordCount(null), 0);
});

test('a scene speaks its narration then each step say, without markup', () => {
  assert.deepEqual(spokenTexts(graph), [thirteen, 'two words']);
});

test('without a clip, the narration waits for the build and reads at 195 words a minute', () => {
  const [narration, step] = sceneSegments(graph);
  assert.deepEqual(
    {
      from: narration.from,
      voiceFrom: narration.voiceFrom,
      duration: narration.durationInFrames,
      speaking: narration.speakingFrames,
    },
    {
      from: 0,
      voiceFrom: 54,
      duration: 219,
      speaking: (13 / 195) * 60 * 30,
    },
  );
  assert.deepEqual(
    { from: step.from, voiceFrom: step.voiceFrom, duration: step.durationInFrames },
    { from: 219, voiceFrom: 228, duration: 99 },
  );
  assert.equal(sceneDurationInFrames(graph), 318);
});

test('a voice clip sets the speaking time and the tail follows it', () => {
  const voiceover = { voice: 'v', clips: { [narrationKey(thirteen, 'v')]: { seconds: 2 } } };
  const [narration] = sceneSegments({ type: 'code', narration: thirteen }, voiceover);
  assert.equal(narration.voiceFrom, 30);
  assert.equal(narration.speakingFrames, 60);
  assert.equal(narration.durationInFrames, 30 + 60 + 12);
});

test('a slower pace stretches pauses and reading time', () => {
  const [narration] = sceneSegments(
    { type: 'code', narration: thirteen },
    { voice: 'v', clips: {}, speed: 0.85, pauses: 1.5 },
  );
  assert.equal(narration.voiceFrom, 45);
  assert.equal(Math.ceil(narration.speakingFrames), 142);
});

test('settledFrame sits before the fade-out and never goes negative', () => {
  assert.equal(settledFrame(100), 90);
  assert.equal(settledFrame(5), 0);
});

test('spokenAt follows the latest started voice and spreads words evenly', () => {
  const segments = sceneSegments(graph);
  assert.deepEqual(spokenAt(segments, 0), { index: 0, text: thirteen, word: 0 });
  assert.deepEqual(spokenAt(segments, 54 + 90), { index: 0, text: thirteen, word: 9 });
  assert.deepEqual(spokenAt(segments, 228), { index: 1, text: 'two words', word: 0 });
});
