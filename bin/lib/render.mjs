// Renders a walkthrough to MP4, PNG stills or contact sheets with the Rust engine (bin/lib/engine.mjs).

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runEngine, stopEngines, writeProps } from './engine.mjs';
import { SHEET_SCENES, sheetNames } from './stills.mjs';

/** Stops what a render started. */
export async function stopRenders() {
  stopEngines();
}

const voiced = (voiceover) => Object.keys(voiceover?.clips ?? {}).length > 0;

/** Runs the engine on the run's props, written to `dir` for the length of the run. */
async function withProps(dir, options, fn) {
  const props = await writeProps(dir, options);
  try {
    return await fn(props);
  } finally {
    // Kept for debugging, to run the engine on by hand.
    if (process.env.MR_CAST_DEBUG === '1') console.error(`[engine] props in ${props}`);
    else await rm(props, { force: true });
  }
}

/**
 * Renders the MP4 in one encode: frames, the voice clips mixed at their frames as AAC, and a chapter marker per run of
 * scenes with one chapter title. `MR_CAST_CFR=1` sends every frame to the encoder instead of leaving repeats out.
 */
export async function renderVideo(options) {
  const { dataDir, outFile, voiceover, onProgress } = options;
  const out = path.resolve(outFile);
  await mkdir(path.dirname(out), { recursive: true });
  await withProps(dataDir ?? path.dirname(out), options, (props) =>
    runEngine(
      [
        'render',
        '--props',
        props,
        '--out',
        out,
        '--progress',
        'yes',
        ...(voiced(voiceover) && dataDir ? ['--media-dir', path.resolve(dataDir)] : []),
        ...(process.env.MR_CAST_CFR === '1' ? ['--cfr', 'yes'] : []),
      ],
      { onProgress },
    ),
  );
  return out;
}

/**
 * Each still shows its scene's settled end state (`stillFrame`), or with `step` the scene just before that step gives
 * way to the next (the engine picks the frame as
 * stills.mjs `stillFrame` does). Stills take scene timing from `voiceover` but play no audio. Returns the files, in scene order.
 */
export async function renderStills(options) {
  const { storyboard, dataDir, outDir, scenes, step } = options;
  const dir = path.resolve(outDir);
  await mkdir(dir, { recursive: true });
  const indices = scenes ?? storyboard.scenes.map((_, i) => i);
  for (const i of indices)
    if (!storyboard.scenes[i])
      throw new Error(`scene ${i} does not exist (storyboard has ${storyboard.scenes.length} scenes)`);
  return withProps(dataDir ?? dir, options, (props) =>
    runEngine([
      'still',
      '--props',
      props,
      '--scenes',
      indices.map((i) => i + 1).join(','),
      ...(step === undefined ? [] : ['--step', String(step)]),
      '--out-dir',
      dir,
    ]),
  );
}

/**
 * Contact sheets in `outDir`: `tiles` (each { scene: index, still: file name in outDir, label }) in a grid, twelve to
 * a sheet. Returns the sheets' paths.
 */
export async function renderSheets(options) {
  const { outDir, tiles, dataDir } = options;
  const dir = path.resolve(outDir);
  const names = sheetNames(tiles.length);
  // A sheet left by an earlier run, with more or fewer scenes, would be mistaken for this one.
  for (const old of (await readdir(dir)).filter((f) => /^sheet(?:-\d+)?\.png$/.test(f))) await rm(path.join(dir, old));
  return withProps(dataDir ?? dir, options, async (props) => {
    const written = [];
    for (const [i, name] of names.entries()) {
      const list = `${props}.tiles-${i}.json`;
      const chunk = tiles.slice(i * SHEET_SCENES, (i + 1) * SHEET_SCENES);
      await writeFile(list, JSON.stringify(chunk.map((t) => ({ scene: t.scene + 1, label: t.label }))));
      try {
        const output = path.join(dir, name);
        await runEngine(['sheet', '--props', props, '--tiles', list, '--out', output]);
        written.push(output);
      } finally {
        await rm(list, { force: true });
      }
    }
    return written;
  });
}
