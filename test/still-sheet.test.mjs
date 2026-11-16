import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sheetNames } from '../bin/lib/stills.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a contact sheet holds twelve scenes; more go on numbered sheets', () => {
  assert.deepEqual(sheetNames(1), ['sheet.png']);
  assert.deepEqual(sheetNames(12), ['sheet.png']);
  assert.deepEqual(sheetNames(13), ['sheet-1.png', 'sheet-2.png']);
  assert.deepEqual(sheetNames(25), ['sheet-1.png', 'sheet-2.png', 'sheet-3.png']);
});

test('--sheet shows every scene as it ends, so scene indexes and --step are refused before anything renders', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-sheet-'));
  try {
    const dir = path.join(work, 'run');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'hunks.json'), '{}');
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ mode: 'explain' }));
    fs.writeFileSync(
      path.join(dir, 'storyboard.json'),
      JSON.stringify({
        title: 'T',
        scenes: [{ type: 'text', narration: 'One.', headline: 'One', items: ['a', 'b'] }],
      }),
    );
    const run = (...args) =>
      spawnSync(process.execPath, [path.join(ROOT, 'bin/mr-cast.mjs'), 'still', '--dir', dir, '--no-voice', ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          MR_CAST_NO_UPDATE_CHECK: '1',
          MR_CAST_PROCS_SCAN: '0',
          XDG_CONFIG_HOME: path.join(work, 'config'),
          XDG_CACHE_HOME: path.join(work, 'cache'),
          XDG_STATE_HOME: path.join(work, 'state'),
          CLAUDE_CONFIG_DIR: path.join(work, 'claude'),
        },
      });
    for (const args of [
      ['--sheet', '0'],
      ['--sheet', '--step', '0'],
    ]) {
      const res = run(...args);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /--sheet shows every scene as it ends/);
    }
    const help = spawnSync(process.execPath, [path.join(ROOT, 'bin/mr-cast.mjs'), 'still', '--help'], {
      encoding: 'utf8',
      env: { ...process.env, MR_CAST_NO_UPDATE_CHECK: '1', CLAUDE_CONFIG_DIR: path.join(work, 'claude') },
    });
    assert.match(help.stdout, /still \[sceneIndex\.\.\.\] \[--out dir\] \[--step k\] \[--sheet\]/);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
