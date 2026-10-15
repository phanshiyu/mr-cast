// Renders the Walkthrough composition (src/remotion/index.ts) to MP4 or PNG stills.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { sceneDurationInFrames } from '../../shared/timing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRY = path.join(ROOT, 'src/remotion/index.ts');
const CACHE = path.join(ROOT, '.cache/bundle');
const COMPOSITION_ID = 'Walkthrough';

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)])),
  );
  return nested.flat().sort();
}

async function sourceHash() {
  const hash = createHash('sha256');
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'node_modules/remotion/package.json'), 'utf8'));
  hash.update(pkg.version);
  for (const dir of ['src', 'shared']) {
    for (const file of await listFiles(path.join(ROOT, dir))) {
      hash.update(path.relative(ROOT, file));
      hash.update(await readFile(file));
    }
  }
  return hash.digest('hex').slice(0, 16);
}

/** Reuses the webpack bundle while src/ and shared/ are unchanged; bundling takes several seconds. */
async function getServeUrl() {
  const key = await sourceHash();
  const outDir = path.join(CACHE, key);
  if (existsSync(path.join(outDir, 'index.html'))) return outDir;
  await rm(outDir, { recursive: true, force: true });
  await mkdir(CACHE, { recursive: true });
  const serveUrl = await bundle({ entryPoint: ENTRY, outDir });
  for (const stale of await readdir(CACHE)) {
    if (stale !== key) await rm(path.join(CACHE, stale), { recursive: true, force: true });
  }
  return serveUrl;
}

async function withRetry(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[mr-cast] ${label} failed (${err?.message ?? err}); retrying once`);
    return fn();
  }
}

async function prepare({ hunks, storyboard }) {
  await withRetry('downloading Chrome Headless Shell', () => ensureBrowser());
  const serveUrl = await getServeUrl();
  const inputProps = { storyboard, hunks, showCaptions: true };
  const browser = await withRetry('launching the browser', () => openBrowser('chrome'));
  try {
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, puppeteerInstance: browser });
    return { serveUrl, inputProps, browser, composition };
  } catch (err) {
    await browser.close({ silent: true });
    throw err;
  }
}

export async function renderVideo({ hunks, storyboard, outFile, onProgress }) {
  const out = path.resolve(outFile);
  await mkdir(path.dirname(out), { recursive: true });
  const { serveUrl, inputProps, browser, composition } = await prepare({ hunks, storyboard });
  try {
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: 'h264',
      outputLocation: out,
      puppeteerInstance: browser,
      onProgress: ({ progress }) => onProgress?.(progress),
    });
  } finally {
    await browser.close({ silent: true });
  }
  return out;
}

export async function renderStills({ hunks, storyboard, outDir, scenes }) {
  const dir = path.resolve(outDir);
  await mkdir(dir, { recursive: true });
  const starts = [];
  let from = 0;
  for (const scene of storyboard.scenes) {
    const duration = sceneDurationInFrames(scene.narration);
    starts.push({ from, duration });
    from += duration;
  }
  const indices = scenes ?? storyboard.scenes.map((_, i) => i);
  const { serveUrl, inputProps, browser, composition } = await prepare({ hunks, storyboard });
  const written = [];
  try {
    for (const index of indices) {
      const timing = starts[index];
      if (!timing) throw new Error(`scene ${index} does not exist (storyboard has ${starts.length} scenes)`);
      const output = path.join(dir, `scene-${String(index + 1).padStart(2, '0')}-${storyboard.scenes[index].type}.png`);
      await renderStill({
        composition,
        serveUrl,
        inputProps,
        output,
        frame: timing.from + Math.floor(timing.duration * 0.6),
        puppeteerInstance: browser,
      });
      written.push(output);
    }
  } finally {
    await browser.close({ silent: true });
  }
  return written;
}

