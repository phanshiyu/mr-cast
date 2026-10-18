#!/usr/bin/env node
// Renders every storyboard under examples/ to <out>/<name>.mp4, where <name> is its path under examples/ with
// slashes as dashes (examples/primitives/array is primitives-array.mp4), since release assets are flat. Each renders
// with the audience its meta.json records. `--shard i/n` renders the i-th (1-based) of n groups of about equal spoken
// length, so n runners split the work. Renders a copy of each example, so nothing is written into examples/. Voices with the
// default Kitten model in $XDG_CACHE_HOME/mr-cast. Exits 1 when any example fails to render.
// `--list` prints the chosen examples and their flags instead of rendering.
// usage: node scripts/render-examples.mjs <out dir> [--shard i/n] [--list] [name...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, copyExample, findExamples } from './lib/examples.mjs';

const USAGE = 'usage: node scripts/render-examples.mjs <out dir> [--shard i/n] [--list] [name...]';
const args = process.argv.slice(2);
const list = args.includes('--list');
if (list) args.splice(args.indexOf('--list'), 1);
const shardAt = args.indexOf('--shard');
const shard = shardAt < 0 ? '1/1' : args.splice(shardAt, 2)[1];
const [, index, count] = /^(\d+)\/(\d+)$/.exec(shard ?? '')?.map(Number) ?? [];
const [outArg, ...only] = args;
if (!outArg || !(count >= 1 && index >= 1 && index <= count)) {
  console.error(USAGE);
  process.exit(2);
}
const out = path.resolve(outArg);

const examples = findExamples();
const unknown = only.filter((name) => !examples.some((e) => e.name === name));
if (unknown.length) {
  console.error(`unknown example: ${unknown.join(', ')}; known: ${examples.map((e) => e.name).join(', ')}`);
  process.exit(2);
}
const chosen = shardOf(only.length ? examples.filter((e) => only.includes(e.name)) : examples, index, count);

/** The words an example speaks, which render time follows. */
function spokenWords(example) {
  const { scenes } = JSON.parse(fs.readFileSync(path.join(example.dir, 'storyboard.json'), 'utf8'));
  const texts = scenes
    .flatMap((s) => [s.narration, ...(s.steps ?? []).map((st) => st.say)])
    .filter((t) => typeof t === 'string');
  return texts.join(' ').split(/\s+/).length;
}

/** Deals the examples, longest first, each to the group with the fewest words so far, and returns group `i`. */
function shardOf(list, i, n) {
  const groups = Array.from({ length: n }, () => ({ words: 0, examples: [] }));
  for (const example of list
    .map((e) => ({ e, words: spokenWords(e) }))
    .sort((a, b) => b.words - a.words || a.e.name.localeCompare(b.e.name))) {
    const group = groups.reduce((min, g) => (g.words < min.words ? g : min));
    group.words += example.words;
    group.examples.push(example.e);
  }
  return groups[i - 1].examples.sort((a, b) => a.name.localeCompare(b.name));
}
if (list) {
  for (const e of chosen) console.log([e.name, ...e.flags].join(' '));
  process.exit(0);
}

fs.mkdirSync(out, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-render-'));
const failed = [];
try {
  for (const example of chosen) {
    const dir = path.join(work, example.name);
    copyExample(example, dir);
    const video = path.join(out, `${example.name}.mp4`);
    const started = Date.now();
    const res = spawnSync(
      process.execPath,
      [path.join(ROOT, 'bin/mr-cast.mjs'), 'render', '--dir', dir, '--out', video, ...example.flags],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          MR_CAST_NO_UPDATE_CHECK: '1',
          XDG_CONFIG_HOME: path.join(work, 'config'),
          XDG_STATE_HOME: path.join(work, 'state'),
          CLAUDE_CONFIG_DIR: path.join(work, 'claude'),
        },
      },
    );
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    const flags = example.flags.length ? ` ${example.flags.join(' ')}` : '';
    if (res.status === 0 && fs.existsSync(video)) {
      console.log(`${example.name}${flags}: ${video} (${(fs.statSync(video).size / 1e6).toFixed(1)} MB, ${seconds}s)`);
    } else {
      failed.push(example.name);
      console.log(`${example.name}${flags}: FAILED (exit ${res.status})`);
      process.stderr.write(res.stderr);
    }
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`shard ${index}/${count}: ${chosen.length - failed.length} of ${chosen.length} rendered`);
if (failed.length) console.error(`failed: ${failed.join(', ')}`);
process.exit(failed.length ? 1 : 0);
