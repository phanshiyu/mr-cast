import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const flowchart = (overrides = {}) => ({
  type: 'graph',
  chapter: 'The decision',
  narration: 'Each request to the orders route passes the rate limiter first.',
  nodes: [
    { id: 'count', label: 'Count this minute', shape: 'step' },
    { id: 'over', label: 'Over twenty?', shape: 'decision' },
    { id: 'reject', label: 'Refuse', shape: 'terminal' },
    { id: 'next', label: 'Create the order', shape: 'terminal' },
  ],
  edges: [
    { from: 'count', to: 'over' },
    { from: 'over', to: 'reject', label: 'yes' },
    { from: 'over', to: 'next', label: 'no' },
  ],
  ...overrides,
});

const check = (scenes) => validateStoryboard({ title: 'How the limiter decides', scenes }, {}, { mode: 'explain' });

test('a quick video gets every correctness and text-fit check', async () => {
  const broken = flowchart({ edges: [{ from: 'count', to: 'missing' }] });
  assert.deepEqual((await check([broken])).errors, ['scenes[0].edges[0].to: unknown node id "missing"']);

  const long = flowchart({ nodes: [{ id: 'count', label: 'Count every single request this caller has sent in the current one minute window before deciding', shape: 'step' }], edges: [] });
  const { errors } = await check([long]);
  assert.deepEqual(errors, ['scenes[0] ("The decision").nodes[0].label: "Count every single request this caller has sent in the current one minute window before deciding" does not fit its card title, even at 16px; shorten the label, or move detail into its caption']);
});

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'mr-cast.mjs');

test('init --quick runs in quick-<slug>, and a full init of the same title starts from it', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-quick-')));
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(tmp, 'config'), XDG_CACHE_HOME: path.join(tmp, 'cache'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), MR_CAST_NO_UPDATE_CHECK: '1' };
  const cwd = path.join(tmp, 'work');
  fs.mkdirSync(cwd);
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8' });
  const runDir = (name) => path.join(cwd, '.mr-cast', name);
  const storyboard = { title: 'How the limiter decides', scenes: [flowchart()] };
  try {
    const quick = run('init', '--title', 'How the limiter decides', '--quick');
    assert.equal(quick.stdout.trim(), runDir('quick-how-the-limiter-decides'));
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(runDir('quick-how-the-limiter-decides'), 'meta.json'), 'utf8'))), ['mode', 'title', 'createdAt', 'quick', 'audience']);
    fs.writeFileSync(path.join(runDir('quick-how-the-limiter-decides'), 'storyboard.json'), JSON.stringify(storyboard));
    const validated = run('validate');
    assert.equal(validated.status, 0, validated.stderr);

    const full = run('init', '--title', 'How the limiter decides');
    assert.equal(full.stdout.trim(), runDir('how-the-limiter-decides'));
    assert.match(full.stderr, /note: started from the quick video in \.mr-cast\/quick-how-the-limiter-decides/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runDir('how-the-limiter-decides'), 'storyboard.json'), 'utf8')), storyboard);
    assert.equal(run('validate').status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runDir('quick-how-the-limiter-decides'), 'storyboard.json'), 'utf8')), storyboard);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('init --quick needs a title and never names a full run, and a full run that is reset or has snippets is not seeded from the quick one', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-quick-')));
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(tmp, 'config'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), MR_CAST_NO_UPDATE_CHECK: '1' };
  const cwd = path.join(tmp, 'work');
  fs.mkdirSync(cwd);
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8' });
  const full = path.join(cwd, '.mr-cast', 'limits');
  const read = (file) => JSON.parse(fs.readFileSync(path.join(full, file), 'utf8'));
  try {
    assert.equal(run('init', '--title', 'Limits').status, 0);
    const untitled = run('init', '--quick');
    assert.equal(untitled.status, 1);
    assert.match(untitled.stderr, /init --quick needs --title/);
    assert.equal(read('meta.json').quick, undefined);
    const named = run('init', '--name', 'limits', '--title', 'Limits', '--quick');
    assert.equal(named.status, 1);
    assert.match(named.stderr, /\.mr-cast\/limits holds a full video, which --quick would not make quick; pass another --name, or leave --name out/);
    assert.equal(read('meta.json').quick, undefined);

    assert.equal(run('init', '--title', 'Limits', '--quick').status, 0);
    const quickDir = path.join(cwd, '.mr-cast', 'quick-limits');
    fs.writeFileSync(path.join(quickDir, 'storyboard.json'), JSON.stringify({ title: 'Limits', scenes: [flowchart()] }));
    fs.writeFileSync(path.join(quickDir, 'hunks.json'), JSON.stringify({ q1: { id: 'q1' } }));

    fs.writeFileSync(path.join(full, 'hunks.json'), JSON.stringify({ s1: { id: 's1' } }));
    const kept = run('init', '--title', 'Limits');
    assert.doesNotMatch(kept.stderr, /started from the quick video/);
    assert.deepEqual(read('hunks.json'), { s1: { id: 's1' } });
    assert.equal(fs.existsSync(path.join(full, 'storyboard.json')), false);

    const reset = run('init', '--title', 'Limits', '--reset');
    assert.doesNotMatch(reset.stderr, /started from the quick video/);
    assert.deepEqual(read('hunks.json'), {});
    assert.equal(fs.existsSync(path.join(full, 'storyboard.json')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
