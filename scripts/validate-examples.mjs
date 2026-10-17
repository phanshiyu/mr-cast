#!/usr/bin/env node
// Runs `mr-cast validate` on a copy of every example, so validate never writes into examples/.
// Exits 1 when any example is invalid. Runs with `pnpm validate:examples` and in CI.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examples = path.join(ROOT, 'examples');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-examples-'));
// The settings flags an example is written for; the rest are for the default audience.
const FLAGS = { preread: ['--audience', 'preread'] };
let failed = 0;
try {
  for (const name of fs.readdirSync(examples).sort()) {
    const source = path.join(examples, name);
    if (!fs.existsSync(path.join(source, 'storyboard.json'))) continue;
    const dir = path.join(work, name);
    fs.mkdirSync(dir);
    for (const file of fs.readdirSync(source).filter((f) => f.endsWith('.json'))) fs.copyFileSync(path.join(source, file), path.join(dir, file));
    const res = spawnSync(process.execPath, [path.join(ROOT, 'bin/mr-cast.mjs'), 'validate', '--dir', dir, ...(FLAGS[name] ?? [])], {
      encoding: 'utf8',
      env: { ...process.env, MR_CAST_NO_UPDATE_CHECK: '1', XDG_CONFIG_HOME: path.join(work, 'config'), CLAUDE_CONFIG_DIR: path.join(work, 'claude') },
    });
    const summary = res.stdout.trim().split('\n').at(-1);
    console.log(`${name}: ${summary}`);
    if (res.status !== 0 || /could not load Mermaid/.test(res.stderr)) {
      failed++;
      process.stderr.write(res.stderr);
    }
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
