#!/usr/bin/env node
// Renders every storyboard under examples/ to <out>/<name>.mp4, where <name> is its path under examples/ with
// slashes as dashes (examples/primitives/array is primitives-array.mp4), since release assets are flat.
// Renders a copy of each example, so nothing is written into examples/. Voices with the Kokoro model in
// $XDG_CACHE_HOME/mr-cast. Exits 1 when any example fails to render.
// usage: node scripts/render-examples.mjs <out dir> [name...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(ROOT, 'examples');
// The settings flags an example is written for, by name; the rest are for the default audience.
const FLAGS = { preread: ['--audience', 'preread'] };

const [outArg, ...only] = process.argv.slice(2);
if (!outArg) {
  console.error('usage: node scripts/render-examples.mjs <out dir> [name...]');
  process.exit(2);
}
const out = path.resolve(outArg);

/** Every directory under `dir` that holds a storyboard.json, as paths relative to examples/. */
function findExamples(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const sub = path.join(dir, e.name);
    const here = fs.existsSync(path.join(sub, 'storyboard.json')) ? [path.relative(EXAMPLES, sub)] : [];
    return [...here, ...findExamples(sub)];
  });
}

const examples = findExamples(EXAMPLES).map((rel) => ({ rel, name: rel.split(path.sep).join('-') }));
const unknown = only.filter((name) => !examples.some((e) => e.name === name));
if (unknown.length) {
  console.error(`unknown example: ${unknown.join(', ')}; known: ${examples.map((e) => e.name).join(', ')}`);
  process.exit(2);
}
const chosen = only.length ? examples.filter((e) => only.includes(e.name)) : examples;

fs.mkdirSync(out, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-render-'));
const failed = [];
try {
  for (const { rel, name } of chosen) {
    const source = path.join(EXAMPLES, rel);
    const dir = path.join(work, name);
    fs.mkdirSync(dir);
    for (const file of fs.readdirSync(source).filter((f) => f.endsWith('.json'))) fs.copyFileSync(path.join(source, file), path.join(dir, file));
    const video = path.join(out, `${name}.mp4`);
    const started = Date.now();
    const res = spawnSync(process.execPath, [path.join(ROOT, 'bin/mr-cast.mjs'), 'render', '--dir', dir, '--out', video, ...(FLAGS[name] ?? [])], {
      encoding: 'utf8',
      env: { ...process.env, MR_CAST_NO_UPDATE_CHECK: '1', XDG_CONFIG_HOME: path.join(work, 'config'), CLAUDE_CONFIG_DIR: path.join(work, 'claude') },
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    if (res.status === 0 && fs.existsSync(video)) {
      console.log(`${name}: ${video} (${(fs.statSync(video).size / 1e6).toFixed(1)} MB, ${seconds}s)`);
    } else {
      failed.push(name);
      console.log(`${name}: FAILED (exit ${res.status})`);
      process.stderr.write(res.stderr);
    }
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
if (failed.length) console.error(`failed: ${failed.join(', ')}`);
process.exit(failed.length ? 1 : 0);
