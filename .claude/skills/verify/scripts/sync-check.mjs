#!/usr/bin/env node
// Checks a rendered MP4 against the scene timing the composition used: every diagram is fully drawn
// one frame before its narration's voice, and every step's items are on screen before its words.
//
//   node sync-check.mjs <data dir> <mp4> <out dir> [--no-voice]
//
// <data dir> holds storyboard.json (and voiceover.json for a voiced render). For each scene it prints
// the scene's start, its narration's voice start and its declared build end, and writes PNG frames to
// <out dir>: `NN-<type>-voice-1.png` one frame before the narration's voice and `NN-<type>-settled.png`
// at the scene's settled end, plus `NN-<type>-step-K-pre.png` (one frame before step K's voice) and
// `NN-<type>-step-K-say.png` (0.6 s into it) for stepped scenes. `changed` is the share of pixels above
// the caption band that differ by more than 40 grey levels between the voice-1 frame and the settled
// frame; for a scene without steps it stays near 0 when the build was complete before the voice.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// MR_CAST_REPO points at another checkout, such as an older release, to time its render with its own code.
const REPO = process.env.MR_CAST_REPO ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const timing = await import(path.join(REPO, 'shared/timing.mjs'));
const { FPS, sceneSegments, sceneDurationInFrames, settledFrame } = timing;
const buildFrames = timing.buildFrames ?? (() => 0);
const sceneSteps = existsSync(path.join(REPO, 'shared/steps.mjs')) ? (await import(path.join(REPO, 'shared/steps.mjs'))).sceneSteps : (scene) => timing.spokenTexts(scene).slice(1);

const [dataDir, mp4, outDir] = process.argv.slice(2);
if (!dataDir || !mp4 || !outDir) {
  console.error('usage: sync-check.mjs <data dir> <mp4> <out dir> [--no-voice]');
  process.exit(2);
}
const silent = process.argv.includes('--no-voice');
const storyboard = JSON.parse(readFileSync(path.join(dataDir, 'storyboard.json'), 'utf8'));
const voicePath = path.join(dataDir, 'voiceover.json');
const voiceover = !silent && existsSync(voicePath) ? JSON.parse(readFileSync(voicePath, 'utf8')) : null;
mkdirSync(outDir, { recursive: true });

const COMPOSITOR = path.join(REPO, 'node_modules/@remotion/compositor-darwin-arm64');
const env = { ...process.env, DYLD_LIBRARY_PATH: COMPOSITOR };
const W = 1920;
const CROP_H = 920;

// The middle of a frame's interval, so the decoder lands on that frame and not its neighbour.
const at = (frame) => ((frame + 0.5) / FPS).toFixed(4);
const png = (frame, file) =>
  execFileSync(path.join(COMPOSITOR, 'ffmpeg'), ['-v', 'error', '-y', '-ss', at(frame), '-i', mp4, '-frames:v', '1', path.join(outDir, file)], { env });
const { default: sharp } = await import(path.join(REPO, 'node_modules/sharp/lib/index.js'));
const grey = (file) => sharp(path.join(outDir, file)).extract({ left: 0, top: 0, width: W, height: CROP_H }).greyscale().raw().toBuffer();
function changed(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 40) n++;
  return n / a.length;
}

const probed = Number(
  execFileSync(path.join(COMPOSITOR, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { env }).toString().trim(),
);
const seconds = (frames) => (frames / FPS).toFixed(2);
const rows = [];
let from = 0;
for (const [i, scene] of storyboard.scenes.entries()) {
  const segments = sceneSegments(scene, voiceover);
  const duration = sceneDurationInFrames(scene, voiceover);
  const name = `${String(i + 1).padStart(2, '0')}-${scene.type}`;
  const voice = from + segments[0].voiceFrom;
  const build = from + buildFrames(scene.type);
  png(voice - 1, `${name}-voice-1.png`);
  png(from + settledFrame(duration), `${name}-settled.png`);
  const steps = sceneSteps(scene).length;
  const diff = steps ? null : changed(await grey(`${name}-voice-1.png`), await grey(`${name}-settled.png`));
  const stepRows = segments.slice(1).map((segment, k) => {
    png(from + segment.voiceFrom - 1, `${name}-step-${k + 1}-pre.png`);
    png(from + segment.voiceFrom + Math.round(0.6 * FPS), `${name}-step-${k + 1}-say.png`);
    return `step ${k + 1} lit ${seconds(from + segment.from)} voice ${seconds(from + segment.voiceFrom)}`;
  });
  rows.push({ scene: name, chapter: scene.chapter ?? '', start: seconds(from), buildEnd: seconds(build), voiceStart: seconds(voice), lead: seconds(voice - build), changed: diff === null ? 'stepped' : `${(diff * 100).toFixed(2)}%`, steps: stepRows.join('; ') });
  from += duration;
}

console.log(['scene', 'chapter', 'start s', 'build end s', 'voice start s', 'voice - build s', 'changed voice-1 vs settled', 'steps'].join('\t'));
for (const r of rows) console.log([r.scene, r.chapter, r.start, r.buildEnd, r.voiceStart, r.lead, r.changed, r.steps].join('\t'));
console.log(`timeline ${seconds(from)} s · ffprobe ${probed.toFixed(2)} s · difference ${(probed - from / FPS).toFixed(2)} s`);
