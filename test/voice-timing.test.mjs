import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locateEngine } from '../bin/lib/engine.mjs';
import { ENGINES } from '../bin/lib/voices.mjs';
import { FPS, sceneSegments, spokenAt, wordCount } from '../shared/timing.mjs';

// Voices with the real engine and model, so it runs where both are already there: a built engine, and the model in
// $XDG_CACHE_HOME/mr-cast/tiny-voca (`mr-cast voices --sample tiny-voca:m2` downloads it).
const ready = () => {
  try {
    return !locateEngine().build && ENGINES['tiny-voca'].downloaded();
  } catch {
    return false;
  }
};

const STORYBOARD = {
  title: 'Timing',
  scenes: [
    { type: 'text', narration: 'The limiter keeps a bucket per client. Each request takes one token from it.' },
    {
      type: 'text',
      narration: 'It refills 10 tokens every 2.5 seconds. A burst of 25 requests waits about 4 s, then runs.',
    },
  ],
};

/** The loudness of `seconds` of a 16-bit mono WAV from `from`. */
function rms(wav, from, seconds) {
  const rate = wav.readUInt32LE(24);
  const start = 44 + 2 * Math.floor(from * rate);
  const end = Math.min(wav.length, start + 2 * Math.floor(seconds * rate));
  let sum = 0;
  for (let i = start; i < end; i += 2) sum += (wav.readInt16LE(i) / 32768) ** 2;
  return Math.sqrt(sum / Math.max(1, (end - start) / 2));
}

test('each word starts where its sound is, and the caption lights it at that time', {
  skip: !ready() && 'no engine or voice model here',
}, async () => {
  process.env.XDG_STATE_HOME ??= fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-state-'));
  const { ensureVoiceover } = await import('../bin/lib/voice.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-voice-timing-'));
  try {
    const voiceover = await ensureVoiceover({
      dataDir: dir,
      storyboard: STORYBOARD,
      voice: 'tiny-voca:m2',
      pace: { speed: 1, pauses: 1 },
    });
    let checked = 0;
    for (const scene of STORYBOARD.scenes) {
      const segments = sceneSegments(scene, voiceover);
      const { clip, text, voiceFrom } = segments[0];
      assert.ok(clip, text);
      const wav = fs.readFileSync(path.join(dir, clip.src));
      const times = clip.sentences.flatMap((s) => s.times);
      assert.equal(times.length, wordCount(text), 'a time for every word');
      assert.equal(clip.sentences.length, 2, 'two sentences, each one call of the model');
      for (const [k, t] of times.entries()) {
        assert.ok(k === 0 || t >= times[k - 1], `word ${k} starts after the one before`);
        // The caption lights word k from the frame its sound starts in.
        const frame = voiceFrom + Math.ceil(t * FPS);
        if (k + 1 < times.length && Math.ceil(times[k + 1] * FPS) <= Math.ceil(t * FPS)) continue;
        assert.equal(spokenAt(segments, frame).word, k, `"${text.split(/\s+/)[k]}" lit at its frame`);
        // The word's start is speech: louder than the silence before the first word.
        assert.ok(rms(wav, t, 0.15) > 0.02, `"${text.split(/\s+/)[k]}" at ${t}s is sound`);
        checked++;
      }
      assert.ok(rms(wav, 0, Math.max(0.01, clip.sentences[0].start - 0.02)) < 0.01, 'quiet before the first word');
    }
    assert.ok(checked > 20, `${checked} words checked`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
