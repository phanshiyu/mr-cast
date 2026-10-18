#!/usr/bin/env node
// Runs `mr-cast validate` on a copy of every example, with the audience its meta.json records, so validate never
// writes into examples/. Exits 1 when any example is invalid. Runs with `pnpm validate:examples` and in CI.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, copyExample, findExamples } from './lib/examples.mjs';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-examples-'));
let failed = 0;
try {
  for (const example of findExamples()) {
    const dir = path.join(work, example.name);
    copyExample(example, dir);
    const res = spawnSync(
      process.execPath,
      [path.join(ROOT, 'bin/mr-cast.mjs'), 'validate', '--dir', dir, ...example.flags],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          MR_CAST_NO_UPDATE_CHECK: '1',
          XDG_CONFIG_HOME: path.join(work, 'config'),
          CLAUDE_CONFIG_DIR: path.join(work, 'claude'),
        },
      },
    );
    const summary = res.stdout.trim().split('\n').at(-1);
    console.log(`${example.rel}: ${summary}`);
    if (res.status !== 0 || /could not load Mermaid/.test(res.stderr)) {
      failed++;
      process.stderr.write(res.stderr);
    }
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
