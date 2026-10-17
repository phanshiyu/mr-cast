import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-prune-')));
process.env.XDG_CACHE_HOME = path.join(tmp, 'never-used');
const { listArtifacts, pruneChoices, removalPlan, select } = await import('../bin/lib/prune.mjs');

const BIN = fileURLToPath(new URL('../bin/mr-cast.mjs', import.meta.url));
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const write = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x'.repeat(bytes));
};
const age = (p, days) => {
  const when = new Date(NOW - days * DAY);
  if (fs.statSync(p).isDirectory()) for (const name of fs.readdirSync(p)) age(path.join(p, name), days);
  fs.utimesSync(p, when, when);
};

/**
 * A repo-less directory with two walkthroughs and the three caches, the Chrome one in use by this process:
 *   run:rate-limit  40 days old, branch walkthrough with a video, stills and voice clips
 *   run:retry       today, explanation with a video
 */
let n = 0;
function fixture() {
  const root = path.join(tmp, `case-${n++}`);
  const data = path.join(root, 'repo', '.mr-cast');
  const rate = path.join(data, 'rate-limit');
  fs.mkdirSync(rate, { recursive: true });
  fs.writeFileSync(path.join(rate, 'storyboard.json'), JSON.stringify({ title: 'Rate limiter' }));
  fs.writeFileSync(path.join(rate, 'meta.json'), JSON.stringify({ branch: 'rate-limit' }));
  write(path.join(rate, 'rate-limiter.mp4'), 1000);
  write(path.join(rate, 'stills', 'scene-0.png'), 200);
  write(path.join(rate, 'audio', 'clip-0.wav'), 300);
  fs.writeFileSync(path.join(rate, 'voiceover.json'), '{}');
  age(rate, 40);
  const retry = path.join(data, 'retry');
  fs.mkdirSync(retry, { recursive: true });
  fs.writeFileSync(path.join(retry, 'storyboard.json'), JSON.stringify({ title: 'Retry backoff' }));
  fs.writeFileSync(path.join(retry, 'meta.json'), JSON.stringify({ mode: 'explain' }));
  write(path.join(retry, 'retry-backoff.mp4'), 2000);
  const cache = path.join(root, 'cache');
  write(path.join(cache, 'mr-cast', 'bundle', 'index.js'), 50);
  write(path.join(cache, 'mr-cast', 'remotion', 'chrome'), 5000);
  write(path.join(cache, 'mr-cast', 'models', 'kokoro.onnx'), 4000);
  write(path.join(cache, 'mr-cast', 'remotion.users', String(process.pid)), 0);
  process.env.XDG_CACHE_HOME = cache;
  const env = { ...process.env, XDG_CACHE_HOME: cache, XDG_CONFIG_HOME: path.join(root, 'config'), CLAUDE_CONFIG_DIR: path.join(root, 'claude'), MR_CAST_NO_UPDATE_CHECK: '1' };
  const cwd = path.join(root, 'repo');
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8' });
  return { data, cache, run, list: () => listArtifacts(data) };
}

const selector = (fields) => ({ ids: [], kinds: null, all: false, except: [], olderThanDays: null, ...fields });
const ids = (artifacts) => artifacts.map((a) => a.id);
const filesUnder = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).sort();

test('--kind picks every artifact of its kinds, and --older-than narrows it', () => {
  const { list } = fixture();
  assert.deepEqual(ids(select(list(), selector({ kinds: ['video'] }), { now: NOW }).chosen), ['video:rate-limit/rate-limiter.mp4', 'video:retry/retry-backoff.mp4']);
  assert.deepEqual(ids(select(list(), selector({ kinds: ['video'], olderThanDays: 30 }), { now: NOW }).chosen), ['video:rate-limit/rate-limiter.mp4']);
  assert.deepEqual(ids(select(list(), selector({ kinds: ['run', 'explain'], olderThanDays: 30 }), { now: NOW }).chosen), ['run:rate-limit']);
  assert.deepEqual(ids(select(list(), selector({ kinds: ['stills', 'audio'] }), { now: NOW }).chosen), ['stills:rate-limit', 'audio:rate-limit']);
});

test('deleting a part leaves its walkthrough as old as its newest file, not its directory', () => {
  const { list, run } = fixture();
  const result = run('prune', 'video:rate-limit/rate-limiter.mp4');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(ids(select(list(), selector({ kinds: ['run', 'explain'], olderThanDays: 30 }), { now: Date.now() }).chosen), ['run:rate-limit']);
});

test('--except keeps a walkthrough with its parts, and keeps the walkthrough holding an excepted part', () => {
  const { list } = fixture();
  assert.deepEqual(ids(select(list(), selector({ all: true, except: ['run:rate-limit'] }), { now: NOW }).chosen), ['run:retry', 'video:retry/retry-backoff.mp4', 'cache:bundle', 'cache:models']);
  assert.deepEqual(ids(select(list(), selector({ all: true, except: ['stills:rate-limit'] }), { now: NOW }).chosen), [
    'video:rate-limit/rate-limiter.mp4', 'audio:rate-limit', 'run:retry', 'video:retry/retry-backoff.mp4', 'cache:bundle', 'cache:models',
  ]);
  assert.throws(() => select(list(), selector({ all: true, except: ['run:nope'] })), /unknown --except id: run:nope/);
});

test('a busy artifact is never selected and is reported; naming it outright deletes nothing', () => {
  const { list } = fixture();
  const { chosen, inUse } = select(list(), selector({ kinds: ['cache'] }), { now: NOW });
  assert.deepEqual(ids(chosen), ['cache:bundle', 'cache:models']);
  assert.deepEqual(inUse.map((a) => [a.id, a.busy]), [['cache:remotion', `a render (pid ${process.pid}) is using it`]]);
  assert.throws(() => select(list(), selector({ ids: ['cache:remotion', 'cache:models'] })), /not pruning anything: cache:remotion is in use/);
  assert.throws(() => select(list(), selector({ ids: ['run:retry'], olderThanDays: 30 }), { now: NOW, listCommand: 'mr-cast prune --older-than 30' }), /unknown id: run:retry; run `mr-cast prune --older-than 30`/);
});

test('a walkthrough selected with its parts counts their bytes once', () => {
  const { list } = fixture();
  const plan = removalPlan(select(list(), selector({ ids: ['run:rate-limit'], kinds: ['video', 'stills'] }), { now: NOW }).chosen);
  assert.deepEqual(plan.map((r) => [r.artifact.id, r.bytes, r.with]), [
    ['run:rate-limit', 1000 + 200 + 300 + 2 + 24 + 23, null],
    ['video:rate-limit/rate-limiter.mp4', 0, 'run:rate-limit'],
    ['stills:rate-limit', 0, 'run:rate-limit'],
    ['video:retry/retry-backoff.mp4', 2000, null],
  ]);
});

test('--dry-run prints what would go and removes nothing', () => {
  const { data, cache, run } = fixture();
  const before = [...filesUnder(data), ...filesUnder(cache)];
  const text = run('prune', '--kind', 'run,explain', '--older-than', '30', '--dry-run');
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout, [
    'would remove run:rate-limit · 1.5 KB · .mr-cast/rate-limit',
    'would free 1.5 KB',
    '',
  ].join('\n'));
  const json = run('prune', '--all', '--except', 'run:retry', '--dry-run', '--json');
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), {
    dryRun: true,
    artifacts: [
      { id: 'run:rate-limit', kind: 'run', path: path.join(data, 'rate-limit'), bytes: 1549, with: null },
      { id: 'video:rate-limit/rate-limiter.mp4', kind: 'video', path: path.join(data, 'rate-limit', 'rate-limiter.mp4'), bytes: 0, with: 'run:rate-limit' },
      { id: 'stills:rate-limit', kind: 'stills', path: path.join(data, 'rate-limit', 'stills'), bytes: 0, with: 'run:rate-limit' },
      { id: 'audio:rate-limit', kind: 'audio', path: path.join(data, 'rate-limit', 'audio'), bytes: 0, with: 'run:rate-limit' },
      { id: 'cache:bundle', kind: 'cache', path: path.join(cache, 'mr-cast', 'bundle'), bytes: 50, with: null },
      { id: 'cache:models', kind: 'cache', path: path.join(cache, 'mr-cast', 'models'), bytes: 4000, with: null },
    ],
    inUse: [{ id: 'cache:remotion', busy: `a render (pid ${process.pid}) is using it` }],
    skipped: [],
    bytes: 1549 + 50 + 4000,
  });
  assert.deepEqual([...filesUnder(data), ...filesUnder(cache)], before);
});

test('--choices groups the menu, and each option command removes exactly the ids it lists', () => {
  const { run } = fixture();
  const out = run('prune', '--choices', '--json');
  assert.equal(out.status, 0, out.stderr);
  const choices = JSON.parse(out.stdout);
  assert.deepEqual(choices.groups.map((g) => [g.name, g.options.map((o) => [o.label, o.command.join(' ')])]), [
    ['Rendered videos', [
      ['All rendered videos', 'prune --kind video'],
      ['Videos not changed in 30 days', 'prune --kind video --older-than 30'],
      ['Video of "Rate limiter"', 'prune video:rate-limit/rate-limiter.mp4'],
      ['Video of "Retry backoff"', 'prune video:retry/retry-backoff.mp4'],
    ]],
    ['Stills and voice clips', [
      ['All stills and voice clips', 'prune --kind stills,audio'],
      ['Stills of "Rate limiter"', 'prune stills:rate-limit'],
      ['Voice clips of "Rate limiter"', 'prune audio:rate-limit'],
    ]],
    ['Walkthroughs', [
      ['All walkthroughs', 'prune --kind run,explain'],
      ['Walkthroughs not changed in 30 days', 'prune --kind run,explain --older-than 30'],
      ['"Rate limiter"', 'prune run:rate-limit'],
      ['"Retry backoff"', 'prune run:retry'],
    ]],
    ['Cache', [
      ['All cached downloads', 'prune --kind cache'],
      ['Player bundle', 'prune cache:bundle'],
      ['Voice model', 'prune cache:models'],
    ]],
  ]);
  assert.equal(choices.groups[0].options[0].description, '3.0 KB in 2 items; the walkthrough stays, so render makes the video again');
  assert.deepEqual(choices.inUse, [{ id: 'cache:remotion', label: 'Chrome cache', busy: `a render (pid ${process.pid}) is using it` }]);

  for (const option of choices.groups.flatMap((g) => g.options)) {
    const { list, run: runHere } = fixture();
    const before = list();
    const result = runHere(...option.command);
    assert.equal(result.status, 0, `${option.label}: ${result.stderr}`);
    const gone = before.filter((a) => option.ids.includes(a.id) || option.ids.includes(a.parent));
    assert.deepEqual(ids(list()), ids(before.filter((a) => !gone.includes(a))), option.label);
    for (const a of gone) assert.equal(fs.existsSync(a.path), false, `${option.label}: ${a.id} removed`);
    assert.match(result.stdout, new RegExp(`freed ${option.description.split(/[ ;]/).slice(0, 2).join(' ').replace('.', '\\.')}\n$`), option.label);
  }
});

test('selector errors name the fix', () => {
  const { run } = fixture();
  assert.match(run('prune', '--kind', 'videos').stderr, /unknown --kind videos; kinds are run, explain, video, stills, audio, cache/);
  assert.match(run('prune', '--dry-run').stderr, /--except and --dry-run need ids, --kind or --all/);
  assert.match(run('prune', '--choices', '--kind', 'video').stderr, /--choices takes only --json/);
});
