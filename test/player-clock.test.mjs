import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [new URL('../src/player/clock.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { clipTime, fullScale, nextLevel, playingScale, voiceClips } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const segment = (from, voiceFrom, durationInFrames, clip) => ({ from, voiceFrom, durationInFrames, clip });

test("each voice clip plays from its segment's voice frame and is cut where the segment ends", () => {
  const scenes = [
    { from: 0, segments: [segment(0, 30, 90, { src: 'audio/a.wav', seconds: 2 }), segment(90, 100, 40, null)] },
    { from: 130, segments: [segment(0, 25, 60, { src: 'audio/b.wav', seconds: 5 })] },
  ];
  const clips = voiceClips(scenes);
  assert.deepEqual(clips, [
    { src: 'audio/a.wav', from: 30, to: 90, seconds: 2 },
    { src: 'audio/b.wav', from: 155, to: 190, seconds: 5 },
  ]);
  assert.equal(clipTime(clips[0], 29), null);
  assert.equal(clipTime(clips[0], 30), 0);
  assert.equal(clipTime(clips[0], 45), 0.5);
  // Past its segment's end, and past its own length, the clip is silent.
  assert.equal(clipTime(clips[0], 90), null);
  assert.equal(clipTime(clips[1], 185), 1);
  assert.equal(clipTime(clips[1], 190), null);
  assert.equal(clipTime({ src: 'c', from: 0, to: 300, seconds: 1 }, 30), null);
});

test('the canvas draws at its device-pixel width, up to the video size', () => {
  assert.equal(fullScale(960, 1), 0.5);
  assert.equal(fullScale(960, 2), 1);
  assert.equal(fullScale(1600, 2), 1);
});

test('while playing, slow frames step the scale down, never below half, and fast ones step it back', () => {
  assert.equal(nextLevel(0, 30), 1);
  assert.equal(nextLevel(2, 40), 2);
  assert.equal(nextLevel(2, 5), 1);
  assert.equal(nextLevel(1, 15), 1);
  assert.equal(playingScale(1, 0), 1);
  assert.equal(playingScale(1, 2), 0.5);
  assert.equal(playingScale(0.6, 2), 0.5);
  assert.equal(playingScale(0.4, 2), 0.4);
});
