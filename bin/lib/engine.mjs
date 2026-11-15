// Runs the Rust render engine (engine/, see docs/adr/0042-rust-engine.md): finds its binary and an ffmpeg, writes
// the props it draws from, and reports its progress.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserError } from './errors.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXE = (platform) => (platform === 'win32' ? 'mr-cast-engine.exe' : 'mr-cast-engine');

/** Whether `cmd` runs, as `cmd --version`. */
function runs(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** The newest modification time of the files under `p`. */
function newest(p) {
  const stat = fs.statSync(p, { throwIfNoEntry: false });
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.mtimeMs;
  let t = 0;
  for (const name of fs.readdirSync(p))
    if (name !== 'target' && name !== 'bin') t = Math.max(t, newest(path.join(p, name)));
  return t;
}

/**
 * Where the engine binary is, in this order: `MR_CAST_ENGINE`; the prebuilt binary the npm package ships for this
 * platform, `engine/bin/<platform>-<arch>/`; in a git checkout, `engine/target/release/`, which `build` is true for
 * when it is missing or older than the engine's sources and cargo can build it.
 * @returns {{ path: string, build: boolean }}
 */
export function locateEngine({
  env = process.env,
  root = ROOT,
  platform = process.platform,
  arch = process.arch,
  exists = fs.existsSync,
  hasCargo = () => runs('cargo'),
  sourcesNewer = (binary) => newest(path.join(root, 'engine')) > newest(binary),
} = {}) {
  if (env.MR_CAST_ENGINE) {
    if (!exists(env.MR_CAST_ENGINE)) throw new UserError(`MR_CAST_ENGINE=${env.MR_CAST_ENGINE} does not exist`);
    return { path: env.MR_CAST_ENGINE, build: false };
  }
  const shipped = path.join(root, 'engine', 'bin', `${platform}-${arch}`, EXE(platform));
  if (exists(shipped)) return { path: shipped, build: false };
  const checkout = exists(path.join(root, '.git')) && exists(path.join(root, 'engine', 'Cargo.toml'));
  const built = path.join(root, 'engine', 'target', 'release', EXE(platform));
  if (checkout) {
    const cargo = hasCargo();
    if (exists(built)) return { path: built, build: cargo && sourcesNewer(built) };
    if (cargo) return { path: built, build: true };
    throw new UserError(
      'the render engine is not built, and cargo is not installed to build it: install Rust from https://rustup.rs, or set MR_CAST_ENGINE to an mr-cast-engine binary',
    );
  }
  throw new UserError(
    `this install has no render engine for ${platform}-${arch}; reinstall with \`npm i -g @shiyuphan/mr-cast\`, or set MR_CAST_ENGINE to an mr-cast-engine binary`,
  );
}

let binary;
/** The engine binary, built first in a checkout whose engine is missing or older than its sources. */
function engineBinary() {
  if (binary) return binary;
  const found = locateEngine();
  if (found.build) {
    console.error('mr-cast: building the render engine (cargo build --release)');
    execFileSync(
      'cargo',
      ['build', '--release', '--quiet', '--manifest-path', path.join(ROOT, 'engine', 'Cargo.toml')],
      {
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );
    // Cargo leaves an up-to-date binary alone, so its time would stay older than a source that changed nothing.
    const now = new Date();
    fs.utimesSync(found.path, now, now);
  }
  binary = found.path;
  return binary;
}

/** The binary the `ffmpeg-static` package downloaded at install, or null. */
function staticFfmpeg() {
  try {
    const found = createRequire(import.meta.url)('ffmpeg-static');
    return typeof found === 'string' && fs.existsSync(found) ? found : null;
  } catch {
    return null;
  }
}

/**
 * The ffmpeg the engine encodes with: `MR_CAST_FFMPEG`, the `ffmpeg-static` package's (it has libx264), or `ffmpeg`
 * on the PATH.
 */
export function findFfmpeg({ env = process.env, bundled = staticFfmpeg, onPath = () => runs('ffmpeg') } = {}) {
  if (env.MR_CAST_FFMPEG) return env.MR_CAST_FFMPEG;
  const found = bundled();
  if (found) return found;
  if (onPath()) return 'ffmpeg';
  throw new UserError(
    'no ffmpeg to encode the video with: reinstall mr-cast so its ffmpeg downloads (`npm i -g @shiyuphan/mr-cast`), install one (`brew install ffmpeg`, `apt install ffmpeg`, `winget install ffmpeg`), or set MR_CAST_FFMPEG to its path',
  );
}

let colours;
/** src/engine/highlight.ts, bundled with esbuild on first use: the player's own highlighter. */
async function highlighter() {
  colours ??= (async () => {
    const { build } = await import('esbuild');
    const result = await build({
      entryPoints: [path.join(ROOT, 'src/engine/highlight.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      logLevel: 'silent',
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  })();
  return colours;
}

/**
 * Writes the props the engine draws from into `dir`: what Remotion's composition received, plus the syntax colours.
 * Returns the file, which the caller removes when the engine is done.
 */
export async function writeProps(dir, { storyboard, hunks, voiceover = null, images = {} }) {
  const { syntaxColours } = await highlighter();
  const file = path.join(dir, `.engine-props-${process.pid}-${Date.now()}.json`);
  const props = {
    storyboard,
    hunks,
    showCaptions: true,
    voiceover,
    images,
    highlight: syntaxColours(storyboard, hunks),
  };
  fs.writeFileSync(file, JSON.stringify(props));
  return file;
}

/** The engines running now, so a stopped render can stop them too. */
const running = new Set();

/** Stops every engine this process started, as `mr-cast stop` stops a render. */
export function stopEngines() {
  for (const child of running) child.kill('SIGTERM');
}

/** Reads `progress <done>/<total>` lines into a fraction; anything else is the engine's own output. */
export function parseProgress(line) {
  const m = /^progress (\d+)\/(\d+)$/.exec(line.trim());
  return m ? Number(m[1]) / Math.max(1, Number(m[2])) : null;
}

/**
 * Runs the engine with `args`. Its progress goes to `onProgress`; its stdout lines are returned; its other
 * stderr shows only when it fails.
 */
export function runEngine(args, { onProgress } = {}) {
  const bin = engineBinary();
  const ffmpeg = args[0] === 'render' ? findFfmpeg() : undefined;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(ffmpeg ? { MR_CAST_FFMPEG: ffmpeg } : {}) },
    });
    running.add(child);
    let stdout = '';
    let rest = '';
    const log = [];
    child.stdout.setEncoding('utf8').on('data', (d) => {
      stdout += d;
    });
    child.stderr.setEncoding('utf8').on('data', (d) => {
      const lines = (rest + d).split('\n');
      rest = lines.pop();
      for (const line of lines) {
        const fraction = parseProgress(line);
        if (fraction !== null) onProgress?.(fraction);
        else if (process.env.MR_CAST_DEBUG === '1') console.error(`[engine] ${line}`);
        else log.push(line);
      }
    });
    child.on('error', (err) => {
      running.delete(child);
      reject(new Error(`could not start the render engine ${bin}: ${err.message}`));
    });
    child.on('close', (code, signal) => {
      running.delete(child);
      if (rest) log.push(rest);
      if (code === 0) return resolve(stdout.split('\n').filter(Boolean));
      const said = log.filter((l) => l.trim()).join('\n');
      reject(
        new Error(
          `the render engine ${signal ? `was stopped (${signal})` : `failed (exit ${code})`}${said ? `:\n${said}` : ''}`,
        ),
      );
    });
  });
}
