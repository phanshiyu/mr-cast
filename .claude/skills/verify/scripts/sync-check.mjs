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
// `NN-<type>-step-K-say.png` (0.6 s into it) for stepped scenes. A step with a pen `mark` adds
// `NN-<type>-step-K-draw.png` halfway through the pen's stroke and `NN-<type>-step-K-next.png` once
// the next step has started and the mark has faded (the scene's end for the last step). `changed` is the share of pixels above
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
const normalize = await import(path.join(REPO, 'shared/normalize.mjs'));
// A storyboard enters through the same rename the CLI applies, so an older `arch` scene times as a graph.
const storyboard = (normalize.upgradeTypes ?? ((sb) => sb))(JSON.parse(readFileSync(path.join(dataDir, 'storyboard.json'), 'utf8')));
const voicePath = path.join(dataDir, 'voiceover.json');
const voiceover = !silent && existsSync(voicePath) ? JSON.parse(readFileSync(voicePath, 'utf8')) : null;
mkdirSync(outDir, { recursive: true });

const COMPOSITOR = path.join(REPO, 'node_modules/@remotion/compositor-darwin-arm64');
const env = { ...process.env, DYLD_LIBRARY_PATH: COMPOSITOR };
const W = 1920;
/** Frames after the next step starts by which a pen mark has faded (src/components/PenMarks.tsx), plus one. */
const MARK_CLEAR = 9;
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

/**
 * Share of pixels above the caption band that differ by more than 40 grey levels between the frame before
 * the pen starts and the frame before the step's voice, leaving out the mark itself: pixels within INK_REACH
 * of its ink. Near 0 when the scene had settled before the pen started, so the mark drew on still targets.
 */
const INK_REACH = 16;
async function movedUnderPen(beforeFile, inkedFile) {
  const rgb = await sharp(path.join(outDir, inkedFile)).extract({ left: 0, top: 0, width: W, height: CROP_H }).removeAlpha().raw().toBuffer();
  const ink = new Uint32Array((W + 1) * (CROP_H + 1));
  for (let y = 0; y < CROP_H; y++) {
    for (let x = 0; x < W; x++) {
      const i = 3 * (y * W + x);
      const inked = rgb[i] > 190 && rgb[i + 1] > 170 && rgb[i + 2] < 150 ? 1 : 0;
      ink[(y + 1) * (W + 1) + x + 1] = inked + ink[y * (W + 1) + x + 1] + ink[(y + 1) * (W + 1) + x] - ink[y * (W + 1) + x];
    }
  }
  const near = (x, y) => {
    const [x0, y0, x1, y1] = [Math.max(0, x - INK_REACH), Math.max(0, y - INK_REACH), Math.min(W, x + INK_REACH + 1), Math.min(CROP_H, y + INK_REACH + 1)];
    return ink[y1 * (W + 1) + x1] - ink[y0 * (W + 1) + x1] - ink[y1 * (W + 1) + x0] + ink[y0 * (W + 1) + x0] > 0;
  };
  const [a, b] = [await grey(beforeFile), await grey(inkedFile)];
  let n = 0;
  for (let y = 0; y < CROP_H; y++) for (let x = 0; x < W; x++) if (!near(x, y) && Math.abs(a[y * W + x] - b[y * W + x]) > 40) n++;
  return n / (W * CROP_H);
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
  const stepRows = [];
  for (const [k, segment] of segments.slice(1).entries()) stepRows.push(await stepRow(segment, k));
  async function stepRow(segment, k) {
    png(from + segment.voiceFrom - 1, `${name}-step-${k + 1}-pre.png`);
    png(from + segment.voiceFrom + Math.round(0.6 * FPS), `${name}-step-${k + 1}-say.png`);
    const mark = sceneSteps(scene)[k]?.mark;
    let moved = '';
    if (mark) {
      // Releases before 0.15 have no markFrom; their pen started PEN_DELAY frames after the step lit.
      const pen = segment.markFrom ?? segment.from + 3;
      png(from + pen - 1, `${name}-step-${k + 1}-pen-1.png`);
      png(from + Math.round((pen + segment.voiceFrom) / 2), `${name}-step-${k + 1}-draw.png`);
      const next = segments[k + 2];
      png(from + (next ? next.from + MARK_CLEAR : settledFrame(duration)), `${name}-step-${k + 1}-next.png`);
      moved = ` pen ${seconds(from + pen)} moved ${(100 * (await movedUnderPen(`${name}-step-${k + 1}-pen-1.png`, `${name}-step-${k + 1}-pre.png`))).toFixed(2)}%`;
    }
    return `step ${k + 1}${mark ? ` (${mark})` : ''} lit ${seconds(from + segment.from)}${moved} voice ${seconds(from + segment.voiceFrom)}`;
  }
  rows.push({ scene: name, chapter: scene.chapter ?? '', start: seconds(from), buildEnd: seconds(build), voiceStart: seconds(voice), lead: seconds(voice - build), changed: diff === null ? 'stepped' : `${(diff * 100).toFixed(2)}%`, steps: stepRows.join('; ') });
  from += duration;
}

console.log(['scene', 'chapter', 'start s', 'build end s', 'voice start s', 'voice - build s', 'changed voice-1 vs settled', 'steps'].join('\t'));
for (const r of rows) console.log([r.scene, r.chapter, r.start, r.buildEnd, r.voiceStart, r.lead, r.changed, r.steps].join('\t'));
console.log(`timeline ${seconds(from)} s · ffprobe ${probed.toFixed(2)} s · difference ${(probed - from / FPS).toFixed(2)} s`);
