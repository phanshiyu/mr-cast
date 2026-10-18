import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { narrationKey } from '../shared/voice.mjs';

// The voice children it starts record themselves in the process registry.
process.env.XDG_STATE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-voice-child-state-'));
const { ensureVoiceoverInChild, stopVoicing } = await import('../bin/lib/voice-child.mjs');

/** A run whose every clip is already on disk, so the child only reads and returns the voice-over. */
function voicedRun(count) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-voice-child-'));
  fs.mkdirSync(path.join(dir, 'audio'));
  const scenes = [];
  const clips = {};
  for (let i = 0; i < count; i++) {
    const text = `Scene number ${i} explains how the limiter counts requests per minute. It refuses the next one.`;
    scenes.push({ type: 'intent', narration: text, bullets: ['a'] });
    const key = narrationKey(text, 'af_heart', 1);
    fs.writeFileSync(path.join(dir, 'audio', `${key}.wav`), 'x');
    clips[key] = { src: `audio/${key}.wav`, seconds: 6.1, voice: 'af_heart', speed: 1, sentences: [{ words: 11, start: 0.1, end: 3.4 }, { words: 5, start: 3.7, end: 5 }] };
  }
  fs.writeFileSync(path.join(dir, 'voiceover.json'), JSON.stringify({ voice: 'af_heart', speed: 1, pauses: 1, clips }));
  return { dataDir: dir, storyboard: { scenes }, voice: 'af_heart', pace: { speed: 1, pauses: 1 } };
}

test('a voice-over of 600 clips, far past one IPC write, comes back whole from the child', async () => {
  const voiceover = await ensureVoiceoverInChild(voicedRun(600));
  assert.equal(Object.keys(voiceover.clips).length, 600);
});

test('an aborted voicing stops its child and returns null', async () => {
  const ctl = new AbortController();
  const voicing = ensureVoiceoverInChild({ ...voicedRun(600), signal: ctl.signal });
  ctl.abort();
  assert.equal(await voicing, null);
});

test('after stopVoicing, a later voicing starts no child and returns null', async () => {
  stopVoicing();
  const started = Date.now();
  assert.equal(await ensureVoiceoverInChild(voicedRun(1)), null);
  assert.ok(Date.now() - started < 50, 'returned without forking');
});
