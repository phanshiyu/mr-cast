import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/mr-cast.mjs', import.meta.url));

// The skill says to pass the same --pace, --voice or --no-voice to every command, so each command it names takes
// them, and ignores them where they do nothing.
test('every command the skill names accepts the settings flags', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-flags-')));
  try {
    const env = {
      ...process.env,
      MR_CAST_NO_UPDATE_CHECK: '1',
      MR_CAST_PROCS_SCAN: '0',
      XDG_CONFIG_HOME: path.join(dir, 'config'),
      XDG_CACHE_HOME: path.join(dir, 'cache'),
      XDG_STATE_HOME: path.join(dir, 'state'),
      CLAUDE_CONFIG_DIR: path.join(dir, 'claude'),
    };
    const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env, cwd: dir });
    const flagSets = [['--no-voice'], ['--pace', 'slower'], ['--voice', 'tiny-voca:f2'], ['--audience', 'preread']];
    // Commands that stop at a missing run or an argument still got past the flags: only "Unknown option" fails.
    const commands = [
      ['status'],
      ['schema'],
      ['schema', 'code'],
      ['ps'],
      ['stop', '--choices'],
      ['map'],
      ['hunk', 'h1'],
      ['snippet'],
    ];
    for (const command of commands)
      for (const flags of flagSets) {
        const r = run(...command, ...flags);
        assert.doesNotMatch(r.stderr, /Unknown option/, `${command.join(' ')} ${flags.join(' ')}: ${r.stderr}`);
      }
    assert.equal(run('status', '--no-voice').status, 0);
    assert.equal(run('schema', 'code', '--pace', 'faster').status, 0);
    assert.equal(run('ps', '--no-voice').status, 0);
    assert.match(run('status', '--bogus').stderr, /Unknown option/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
