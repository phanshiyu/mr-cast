import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEW_HEADING } from '../shared/review.mjs';
import { READING_HEADING } from '../shared/reading.mjs';

const CLI = fileURLToPath(new URL('../bin/mr-cast.mjs', import.meta.url));
const HUNKS = { s1: { id: 's1', file: 'qs.ts', oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, header: '', additions: 0, deletions: 0, status: 'source', lines: [{ type: 'context', oldNo: null, newNo: 1, text: 'a' }, { type: 'context', oldNo: null, newNo: 2, text: 'b' }] } };
// A code scene is fine for every audience but a pre-read, which shows no code.
const CODE_ONLY = { title: 'Quicksort', scenes: [{ type: 'code', hunkId: 's1', narration: 'The partition function walks the list once.' }] };
const PREREAD_ERROR = 'a pre-read puts no code on screen';

function setup() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-hook-')));
  const env = { XDG_CONFIG_HOME: path.join(tmp, 'config'), XDG_CACHE_HOME: path.join(tmp, 'cache'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude') };
  const repo = path.join(tmp, 'work');
  fs.mkdirSync(repo);
  const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, input, encoding: 'utf8', env: { ...process.env, ...env, MR_CAST_NO_UPDATE_CHECK: '1' } });
  const start = (args, name) => {
    assert.equal(run(['init', ...args]).status, 0);
    const dir = path.join(repo, '.mr-cast', name);
    fs.writeFileSync(path.join(dir, 'hunks.json'), JSON.stringify(HUNKS));
    fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify(CODE_ONLY));
    return dir;
  };
  const hook = (dir) => run(['hook'], JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(dir, 'storyboard.json') } }));
  const choices = path.join(env.XDG_CONFIG_HOME, 'mr-cast', 'last-choices.json');
  return { tmp, run, start, hook, choices, done: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

const meta = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));

test('the hook validates with the audience the run was given, never the last one chosen anywhere', () => {
  const { run, start, hook, choices, done } = setup();
  try {
    fs.mkdirSync(path.dirname(choices), { recursive: true });
    fs.writeFileSync(choices, JSON.stringify({ audience: 'preread' }));
    const quick = start(['--quick', '--title', 'Quicksort'], 'quick-quicksort');
    assert.equal(meta(quick).audience, 'familiar');
    assert.deepEqual([hook(quick).status, hook(quick).stderr], [0, '']);

    const full = start(['--title', 'Quicksort'], 'quicksort');
    assert.equal(run(['validate', '--audience', 'preread']).status, 1);
    assert.equal(meta(full).audience, 'preread');
    const blocked = hook(full);
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /^mr-cast validate --read-only --audience preread on /);
    assert.ok(blocked.stderr.includes(PREREAD_ERROR), blocked.stderr);

    assert.equal(run(['outline', '--audience', 'familiar']).status, 0);
    assert.equal(meta(full).audience, 'familiar');
    assert.deepEqual([hook(full).status, hook(full).stderr], [0, '']);
  } finally {
    done();
  }
});

test('a run started again with no --audience is a plain video, though it was a pre-read before', () => {
  const { tmp, run, hook, done } = setup();
  try {
    const repo = path.join(tmp, 'work');
    const git = (...args) => assert.equal(spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).status, 0);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(repo, 'qs.ts'), 'a\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'quicksort');
    fs.writeFileSync(path.join(repo, 'qs.ts'), 'a\nb\n');
    git('commit', '-qam', 'change');

    assert.equal(run(['extract', 'main', '--audience', 'preread']).status, 0);
    const dir = path.join(repo, '.mr-cast', 'quicksort');
    assert.equal(meta(dir).audience, 'preread');
    fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ ...CODE_ONLY, scenes: [{ ...CODE_ONLY.scenes[0], hunkId: 'h1' }] }));
    assert.equal(hook(dir).status, 2);

    assert.equal(run(['extract', 'main']).status, 0);
    assert.equal(meta(dir).audience, 'familiar');
    assert.deepEqual([hook(dir).status, hook(dir).stderr], [0, '']);

    assert.equal(run(['validate', '--audience', 'preread']).status, 1);
    assert.equal(run(['outline']).status, 0);
    assert.equal(meta(dir).audience, 'familiar');
  } finally {
    done();
  }
});

test('init with no --audience starts a plain video, though the run was a pre-read before', () => {
  const { start, run, hook, done } = setup();
  try {
    const dir = start(['--title', 'Quicksort', '--audience', 'preread'], 'quicksort');
    assert.equal(hook(dir).status, 2);
    assert.equal(run(['init', '--title', 'Quicksort']).status, 0);
    assert.equal(meta(dir).audience, 'familiar');
    assert.deepEqual([hook(dir).status, hook(dir).stderr], [0, '']);
  } finally {
    done();
  }
});

test('the hook\'s validate writes and removes nothing, where validate keeps review.md and reading.md in step', () => {
  const { run, start, hook, choices, done } = setup();
  try {
    const dir = start(['--title', 'Quicksort', '--audience', 'familiar', '--pace', 'slower'], 'quicksort');
    const own = { 'review.md': `${REVIEW_HEADING}Quicksort\n`, 'reading.md': `${READING_HEADING}Quicksort\n` };
    for (const [file, text] of Object.entries(own)) fs.writeFileSync(path.join(dir, file), text);
    const snapshot = () => [fs.readdirSync(dir).sort(), fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'), fs.readFileSync(choices, 'utf8')];
    const before = snapshot();
    assert.deepEqual([hook(dir).status, snapshot()], [0, before]);
    assert.equal(run(['validate', '--read-only', '--audience', 'preread']).status, 1);
    assert.deepEqual(snapshot(), before);

    assert.equal(run(['validate']).status, 0);
    assert.deepEqual(Object.keys(own).filter((f) => fs.existsSync(path.join(dir, f))), []);
  } finally {
    done();
  }
});

test('the hook shows what stopped validate when no line is an error, such as broken JSON or a missing hunks.json', () => {
  const { start, hook, done } = setup();
  try {
    const dir = start(['--title', 'Quicksort'], 'quicksort');
    fs.writeFileSync(path.join(dir, 'storyboard.json'), '{ "title": "Quicksort", }');
    const broken = hook(dir);
    assert.equal(broken.status, 2);
    assert.match(broken.stderr, /\nmr-cast: \S*storyboard\.json is not valid JSON at line 1 column \d+/);

    fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify(CODE_ONLY));
    fs.rmSync(path.join(dir, 'hunks.json'));
    const missing = hook(dir);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /\nmr-cast: \S*hunks\.json not found; run `mr-cast extract` or `mr-cast init` first/);
  } finally {
    done();
  }
});
