// Renders the Walkthrough composition (src/remotion/index.ts) to MP4 or PNG stills.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { RenderInternals, ensureBrowser, openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { FPS, sceneDurationInFrames, sceneSegments, settledFrame } from '../../shared/timing.mjs';
import { cacheDir } from './cache.mjs';
import { whileUsing, withLock } from './lock.mjs';
import { sendFile } from './server.mjs';
import { AUDIO_NAME } from './voice.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRY = path.join(ROOT, 'src/remotion/index.ts');
const BUNDLE_CACHE = cacheDir('bundle');
const BROWSER_CACHE = cacheDir('remotion');
const COMPOSITION_ID = 'Walkthrough';
/** Bundles of other source hashes (another install, an older version) unused this long are deleted. */
const BUNDLE_MAX_IDLE_MS = 60 * 60 * 1000;
const TMP_PREFIX = '.tmp-';

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
  // The bundle also holds React, Mermaid, Lucide and the rest, so a dependency bump must rebundle: a release
  // changes package.json's version, and a clone's lockfile changes with every install.
  for (const file of ['package.json', 'pnpm-lock.yaml']) {
    if (existsSync(path.join(ROOT, file))) hash.update(await readFile(path.join(ROOT, file)));
  }
  for (const dir of ['src', 'shared']) {
    for (const file of await listFiles(path.join(ROOT, dir))) {
      hash.update(path.relative(ROOT, file));
      hash.update(await readFile(file));
    }
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * Deletes bundles and abandoned temp dirs of other hashes that no render has touched for an hour.
 * Renders running from another install touch their bundle on every use, so theirs stay.
 */
async function pruneBundles(key) {
  const now = Date.now();
  for (const name of await readdir(BUNDLE_CACHE)) {
    if (name === key) continue;
    const dir = path.join(BUNDLE_CACHE, name);
    try {
      if (now - (await stat(dir)).mtimeMs > BUNDLE_MAX_IDLE_MS) await rm(dir, { recursive: true, force: true });
    } catch { /* another process removed it */ }
  }
}

/**
 * Reuses the webpack bundle while src/ and shared/ are unchanged; bundling takes several seconds.
 * Concurrent renders share the cache: each bundles into its own temp dir and renames it into place, so
 * <cache>/bundle/<hash> only ever holds a complete bundle and is never deleted while its hash is current.
 */
async function getServeUrl() {
  const key = await sourceHash();
  const outDir = path.join(BUNDLE_CACHE, key);
  await mkdir(BUNDLE_CACHE, { recursive: true });
  if (!existsSync(path.join(outDir, 'index.html'))) {
    const tmp = await mkdtemp(path.join(BUNDLE_CACHE, `${TMP_PREFIX}${key}-`));
    try {
      // webpack's own cache would go to node_modules/.cache inside the package; the bundle cache makes it redundant.
      await bundle({ entryPoint: ENTRY, outDir: tmp, enableCaching: false });
      try {
        await rename(tmp, outDir);
      } catch (err) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(err.code)) throw err;
        // Another render finished first, or a pre-0.6 render left a partial bundle there.
        if (!existsSync(path.join(outDir, 'index.html'))) {
          await rm(outDir, { recursive: true, force: true });
          await rename(tmp, outDir);
        }
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  const now = new Date();
  await utimes(outDir, now, now);
  await pruneBundles(key);
  return outDir;
}

async function withRetry(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[mr-cast] ${label} failed (${err?.message ?? err}); retrying once`);
    return fn();
  }
}

/**
 * Serves .mr-cast/audio/*.wav on a random local port for the length of a render. The bundle is cached
 * by source hash, so clips cannot go into its public dir.
 */
async function serveAudio(dataDir) {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://127.0.0.1').pathname.match(/^\/audio\/([^/]+)$/)?.[1];
    if (req.method !== 'GET' || !name || !AUDIO_NAME.test(name)) {
      res.writeHead(404);
      return res.end();
    }
    sendFile(req, res, path.join(dataDir, 'audio', name));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

/**
 * Remotion has no option for where it downloads Chrome: it walks up from process.cwd() to the nearest
 * package.json and uses that folder's node_modules/.remotion. Our own package.json pins the walk to the cache.
 * The lock keeps concurrent renders from downloading into the same folder at once.
 */
async function ensureChrome() {
  await mkdir(BROWSER_CACHE, { recursive: true });
  return withLock(`${BROWSER_CACHE}.lock`, async () => {
    const pkg = path.join(BROWSER_CACHE, 'package.json');
    if (!existsSync(pkg)) await writeFile(pkg, '{ "private": true }\n');
    const cwd = process.cwd();
    process.chdir(BROWSER_CACHE);
    try {
      const status = await withRetry('downloading Chrome Headless Shell', () => ensureBrowser());
      if (!status.path) throw new Error(`Chrome Headless Shell is missing from ${BROWSER_CACHE} after downloading it`);
      return status.path;
    } finally {
      process.chdir(cwd);
    }
  }, (pid) => console.error(`mr-cast: waiting for another mr-cast (pid ${pid}) to finish downloading Chrome Headless Shell`));
}

async function prepare({ hunks, storyboard, voiceover = null, audioBaseUrl }) {
  const browserExecutable = await ensureChrome();
  const serveUrl = await getServeUrl();
  const inputProps = { storyboard, hunks, showCaptions: true, voiceover, audioBaseUrl };
  const browser = await withRetry('launching the browser', () => openBrowser('chrome', { browserExecutable }));
  try {
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, puppeteerInstance: browser });
    return { serveUrl, inputProps, browser, composition };
  } catch (err) {
    await browser.close({ silent: true });
    throw err;
  }
}

/** Marks the bundle and Chrome caches in use for the whole render, so `mr-cast prune` refuses to delete them. */
const usingCaches = (fn) => whileUsing([BUNDLE_CACHE, BROWSER_CACHE], fn);

export const renderVideo = (options) => usingCaches(() => renderVideoUsingCaches(options));

async function renderVideoUsingCaches({ hunks, storyboard, voiceover, dataDir, outFile, onProgress }) {
  const out = path.resolve(outFile);
  await mkdir(path.dirname(out), { recursive: true });
  const audio = voiceover ? await serveAudio(dataDir) : null;
  try {
    const { serveUrl, inputProps, browser, composition } = await prepare({ hunks, storyboard, voiceover, audioBaseUrl: audio?.url });
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
  } finally {
    await audio?.close();
  }
  await addChapters(out, videoChapters(storyboard, voiceover));
  return out;
}

/** One chapter per run of scenes with the same chapter title (the scene type without one), in milliseconds. */
export function videoChapters(storyboard, voiceover) {
  const chapters = [];
  let from = 0;
  for (const scene of storyboard.scenes) {
    const title = scene.chapter?.trim() || scene.type;
    const end = from + sceneDurationInFrames(scene, voiceover);
    const last = chapters[chapters.length - 1];
    if (last?.title === title) last.end = end;
    else chapters.push({ title, start: from, end });
    from = end;
  }
  const ms = (frames) => Math.round((frames / FPS) * 1000);
  return chapters.map((c) => ({ title: c.title, start: ms(c.start), end: ms(c.end) }));
}

/**
 * Writes chapter markers into the MP4 by remuxing it with the ffmpeg Remotion ships; nothing is re-encoded.
 * That ffmpeg reads no FFMETADATA files, so the chapters come from a concat script's `chapter` lines. The
 * script reads only the video stream, whose timestamps start at 0, so the chapters keep their exact times.
 */
async function addChapters(file, chapters) {
  const script = `${file}.chapters.ffconcat`;
  const tmp = `${file}.chapters.mp4`;
  const quoted = `'${file.replaceAll("'", "'\\''")}'`;
  const lines = chapters.map((c, i) => `chapter ${i} ${c.start / 1000} ${c.end / 1000}`);
  await writeFile(script, ['ffconcat version 1.0', `file ${quoted}`, 'stream', 'exact_stream_id 1', ...lines, ''].join('\n'));
  try {
    await RenderInternals.callFf({
      bin: 'ffmpeg',
      args: [
        '-y', '-v', 'error', '-i', file, '-f', 'concat', '-safe', '0', '-i', script,
        '-map', '0', '-map_chapters', '1', '-codec', 'copy',
        ...chapters.flatMap((c, i) => [`-metadata:c:${i}`, `title=${c.title}`]),
        tmp,
      ],
      indent: false, logLevel: 'error', binariesDirectory: null, cancelSignal: undefined,
    });
    await rename(tmp, file);
  } finally {
    await rm(script, { force: true });
    await rm(tmp, { force: true });
  }
}

/**
 * Each still shows its scene's settled end state, or with `step` the scene just before that step gives way to the
 * next. Stills take scene timing from `voiceover` but play no audio.
 */
export const renderStills = (options) => usingCaches(() => renderStillsUsingCaches(options));

/** The frame of a scene a still shows: its settled end, or the end of step `step`, two frames before the next starts. */
export function stillFrame(scene, voiceover, step) {
  if (step === undefined) return settledFrame(sceneDurationInFrames(scene, voiceover));
  const segment = sceneSegments(scene, voiceover)[step + 1];
  if (!segment) throw new Error(`the ${scene.type} scene has no step ${step}`);
  return segment.from + segment.durationInFrames - 2;
}

async function renderStillsUsingCaches({ hunks, storyboard, voiceover, outDir, scenes, step }) {
  const dir = path.resolve(outDir);
  await mkdir(dir, { recursive: true });
  const starts = [];
  let from = 0;
  for (const scene of storyboard.scenes) {
    const duration = sceneDurationInFrames(scene, voiceover);
    starts.push({ from, duration });
    from += duration;
  }
  const indices = scenes ?? storyboard.scenes.map((_, i) => i);
  const { serveUrl, inputProps, browser, composition } = await prepare({ hunks, storyboard, voiceover });
  const written = [];
  try {
    for (const index of indices) {
      const timing = starts[index];
      if (!timing) throw new Error(`scene ${index} does not exist (storyboard has ${starts.length} scenes)`);
      const output = path.join(dir, `scene-${String(index + 1).padStart(2, '0')}-${storyboard.scenes[index].type}${step === undefined ? '' : `-step-${step}`}.png`);
      await renderStill({
        composition,
        serveUrl,
        inputProps,
        output,
        frame: timing.from + stillFrame(storyboard.scenes[index], voiceover, step),
        puppeteerInstance: browser,
      });
      written.push(output);
    }
  } finally {
    await browser.close({ silent: true });
  }
  return written;
}

