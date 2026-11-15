import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureExcluded } from '../bin/lib/git.mjs';

test('.mr-cast/ is added to the repository exclude file once, whatever the file held', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-exclude-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const file = path.join(root, '.git/info/exclude');
    fs.rmSync(file, { force: true });
    ensureExcluded(root);
    ensureExcluded(root);
    assert.equal(fs.readFileSync(file, 'utf8'), '.mr-cast/\n');
    fs.writeFileSync(file, '*.log');
    ensureExcluded(root);
    ensureExcluded(root);
    assert.equal(fs.readFileSync(file, 'utf8'), '*.log\n.mr-cast/\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
