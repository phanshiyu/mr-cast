import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-procs-')));
const env = {
  ...process.env, XDG_CONFIG_HOME: path.join(tmp, 'config'), XDG_CACHE_HOME: path.join(tmp, 'cache'), XDG_STATE_HOME: path.join(tmp, 'state'),
  CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), MR_CAST_NO_UPDATE_CHECK: '1', MR_CAST_DIST: path.join(tmp, 'dist'),
  // Other mr-cast processes on this machine (other checkouts, other agents) must never be listed, replaced or stopped.
  MR_CAST_PROCS_SCAN: '0',
};
process.env.XDG_STATE_HOME = env.XDG_STATE_HOME;
process.env.MR_CAST_PROCS_SCAN = '0';

/** `fn` with the scan for unregistered processes on: only for listing, and only against a fake ps or with a filter. */
function withScan(fn) {
  process.env.MR_CAST_PROCS_SCAN = '1';
  try {
    return fn();
  } finally {
    process.env.MR_CAST_PROCS_SCAN = '0';
  }
}
fs.mkdirSync(env.MR_CAST_DIST, { recursive: true });
fs.writeFileSync(path.join(env.MR_CAST_DIST, 'index.html'), '<!doctype html>');

const { formatPs, listProcesses, processTable, procsDir, selectProcs, stopChoices, stopProcesses } = await import('../bin/lib/procs.mjs');
const { startServer } = await import('../bin/lib/server.mjs');
const { narrationKey } = await import('../shared/voice.mjs');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(ROOT, 'bin', 'mr-cast.mjs');
const started = new Set();
after(() => {
  for (const child of started) child.kill('SIGKILL');
  fs.rmSync(tmp, { recursive: true, force: true });
});

const cli = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8' });

/** A directory holding one valid walkthrough, the current run, named after `name`. */
function runIn(name, cwd = path.join(tmp, name)) {
  fs.mkdirSync(cwd, { recursive: true });
  const dir = cli(cwd, 'init', '--title', name).stdout.trim();
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ title: name, scenes: [{ type: 'text', narration: 'Requests over the limit wait.', headline: 'Requests wait' }] }));
  return { cwd, dir };
}

/** Starts `mr-cast <args>` in `cwd` and resolves once it prints a line matching `ready`. */
function startCli(cwd, args, ready, more = {}) {
  const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...env, ...more }, stdio: ['ignore', 'pipe', 'pipe'] });
  started.add(child);
  child.output = '';
  child.exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const seen = new Promise((resolve, reject) => {
    const check = (chunk) => {
      child.output += chunk;
      if (ready.test(child.output)) resolve(child);
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.exited.then(() => reject(new Error(`exited before ${ready}: ${child.output}`)));
  });
  return seen;
}

const entryOf = (pid) => path.join(procsDir(), `${pid}.json`);
const readEntry = (pid) => JSON.parse(fs.readFileSync(entryOf(pid), 'utf8'));
const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))]);

test('play records itself with its URL, run and pages, and removes the entry when it stops', async () => {
  const { cwd, dir } = runIn('registry');
  const play = await startCli(cwd, ['play', '--no-voice', '--no-open', '--port', '5310'], /mr-cast player: (\S+)/);
  const url = play.output.match(/mr-cast player: (\S+)/)[1];
  const entry = readEntry(play.pid);
  assert.deepEqual(
    { kind: entry.kind, ppid: entry.ppid, url: entry.url, dir: entry.dir, run: entry.run, repo: entry.repo, viewers: entry.viewers, idleExit: entry.idleExit },
    { kind: 'play', ppid: process.pid, url, dir, run: 'registry', repo: cwd, viewers: 0, idleExit: 30 },
  );
  assert.equal(entry.started, processTable([play.pid]).get(play.pid).started);

  const page = http.get(new URL('/events', url));
  await new Promise((resolve) => page.on('response', resolve));
  for (let i = 0; i < 50 && readEntry(play.pid).viewers !== 1; i++) await new Promise((r) => setTimeout(r, 20));
  const listed = listProcesses().find((p) => p.pid === play.pid);
  assert.deepEqual({ registered: listed.registered, viewers: listed.viewers, idleSince: listed.idleSince }, { registered: true, viewers: 1, idleSince: null });
  page.destroy();

  play.kill('SIGTERM');
  assert.deepEqual(await play.exited, { code: 0, signal: null });
  assert.equal(fs.existsSync(entryOf(play.pid)), false);
});

test('the registry is a 0700 directory of this user; a symlink in its place is neither written nor read', async () => {
  const { cwd } = runIn('private');
  fs.mkdirSync(procsDir(), { recursive: true });
  fs.chmodSync(procsDir(), 0o755);
  const play = await startCli(cwd, ['play', '--no-voice', '--no-open', '--port', '5640'], /mr-cast player:/);
  assert.equal(fs.statSync(procsDir()).mode & 0o777, 0o700);
  assert.equal(fs.existsSync(entryOf(play.pid)), true);
  play.kill('SIGTERM');
  await play.exited;

  const state = path.join(tmp, 'state-link');
  const target = path.join(tmp, 'planted');
  fs.mkdirSync(path.join(state, 'mr-cast'), { recursive: true });
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(state, 'mr-cast', 'procs'));
  const linked = await startCli(cwd, ['play', '--no-voice', '--no-open', '--port', '5670'], /mr-cast player:/, { XDG_STATE_HOME: state });
  assert.deepEqual(fs.readdirSync(target), [], 'nothing written through the symlink');
  fs.writeFileSync(path.join(target, `${linked.pid}.json`), JSON.stringify({ pid: linked.pid }));
  const listed = spawnSync(process.execPath, [BIN, 'ps', '--json'], { cwd, env: { ...env, XDG_STATE_HOME: state }, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).processes, []);
  assert.deepEqual(fs.readdirSync(target), [`${linked.pid}.json`], 'nothing read or removed through it either');
  linked.kill('SIGTERM');
  await linked.exited;
});

test('a listing removes a temp file a writer left a minute ago, and keeps a fresh one', () => {
  fs.mkdirSync(procsDir(), { recursive: true });
  const old = path.join(procsDir(), '90031.json.0a1b2c3d4e5f.tmp');
  const fresh = path.join(procsDir(), '90032.json.0a1b2c3d4e5f.tmp');
  fs.writeFileSync(old, '{');
  fs.writeFileSync(fresh, '{');
  const past = new Date(Date.now() - 120_000);
  fs.utimesSync(old, past, past);
  listProcesses();
  assert.deepEqual([fs.existsSync(old), fs.existsSync(fresh)], [false, true]);
  fs.rmSync(fresh);
});

const uid = process.getuid();
const row = (pid, started, command) => ({ pid, ppid: 1, uid, started, command });
const mrCast = (sub) => `${process.execPath} ${BIN} ${sub} --no-open`;
const writeEntry = (entry) => {
  fs.mkdirSync(procsDir(), { recursive: true });
  fs.writeFileSync(entryOf(entry.pid), JSON.stringify({ ppid: 1, version: '0.28.0', url: null, dir: null, run: null, repo: null, ...entry }));
};

const self = (started) => [process.pid, row(process.pid, started, `${process.execPath} --test`)];

test('an entry counts only while ps shows the same mr-cast process of this user; one ps shows exited or reused is removed', () => {
  const T = 'Sun Oct 18 10:00:00 2026';
  writeEntry({ pid: 90001, kind: 'play', started: T, command: mrCast('play'), run: 'live' });
  writeEntry({ pid: 90002, kind: 'play', started: T, run: 'dead' });
  writeEntry({ pid: 90003, kind: 'play', started: T, run: 'reused' });
  writeEntry({ pid: 90004, kind: 'render', started: T, run: 'not-mr-cast' });
  writeEntry({ pid: 90005, kind: 'plan', started: T, run: 'other-user' });
  writeEntry({ pid: 90006, kind: 'voice', started: T, command: `${process.execPath} ${ROOT}/bin/lib/voice-child.mjs --voice-child`, ppid: 90001, run: 'live' });
  const table = new Map([
    self(T),
    [90001, row(90001, T, mrCast('play'))],
    [90003, row(90003, 'Sun Oct 18 10:05:00 2026', mrCast('play'))],
    [90004, row(90004, T, '/bin/sleep 600')],
    [90005, { ...row(90005, T, mrCast('plan')), uid: uid + 1 }],
    [90006, row(90006, T, `${process.execPath} ${ROOT}/bin/lib/voice-child.mjs --voice-child`)],
    [90007, row(90007, 'Sun Oct 18 09:00:00 2026', `${process.execPath} ${BIN} render`)],
    [90008, row(90008, T, `${process.execPath} /elsewhere/bin/mr-cast.mjs play`)],
  ]);
  const listed = withScan(() => listProcesses({ ps: () => table }));
  assert.deepEqual(listed.map((p) => [p.pid, p.kind, p.registered, p.parent]), [
    [90007, 'render', false, null],
    [90001, 'play', true, null],
    [90006, 'voice', true, 90001],
    // The reused pid runs mr-cast, so it is listed, but as a process that wrote no entry.
    [90003, 'play', false, null],
  ]);
  // 90004 and 90005 are not listed, but ps shows those pids started then, so their entries go only once they exit.
  assert.deepEqual(fs.readdirSync(procsDir()).sort(), ['90001.json', '90004.json', '90005.json', '90006.json']);
  for (const pid of [90001, 90004, 90005, 90006]) fs.rmSync(entryOf(pid));
});

test('a failed, empty or partial ps lists nothing and removes no entry', () => {
  const T = 'Sun Oct 18 10:00:00 2026';
  writeEntry({ pid: 90011, kind: 'play', started: T, run: 'kept' });
  for (const ps of [() => null, () => new Map(), () => new Map([[90012, row(90012, T, '/bin/sleep 600')]])]) {
    assert.deepEqual(listProcesses({ ps }), []);
    assert.equal(fs.existsSync(entryOf(90011)), true);
  }
  assert.deepEqual(listProcesses({ ps: () => new Map([self(T)]) }), []);
  assert.equal(fs.existsSync(entryOf(90011)), false, 'a whole table without the pid means it exited');
});

test('a play started under another TZ stays listed and is replaced by the next play of its run', async () => {
  const { cwd, dir } = runIn('zones');
  const first = await startCli(cwd, ['play', '--no-voice', '--no-open', '--port', '5460'], /mr-cast player:/, { TZ: 'America/Los_Angeles' });
  const tz = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  try {
    assert.deepEqual(listProcesses().filter((p) => p.kind === 'play' && p.dir === dir).map((p) => [p.pid, p.registered]), [[first.pid, true]]);
    assert.equal(fs.existsSync(entryOf(first.pid)), true);
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
  const second = await startCli(cwd, ['play', '--no-voice', '--no-open', '--port', '5490'], /mr-cast player:/, { TZ: 'Europe/Berlin' });
  assert.match(second.output, new RegExp(`stopping the play server already running for this run \\(pid ${first.pid}, `));
  assert.deepEqual(await within(first.exited, 2000), { code: 0, signal: null });
  second.kill('SIGTERM');
  await second.exited;
});

test('only node running mr-cast counts: a wrapper whose arguments name mr-cast is not listed, and an entry needs its exact command', () => {
  const T = 'Sun Oct 18 10:00:00 2026';
  const node = process.execPath;
  writeEntry({ pid: 90021, kind: 'play', started: T, command: `${node} ${BIN} play --port 4747`, run: 'recorded' });
  const table = new Map([
    self(T),
    [90021, row(90021, T, `${node} ${BIN} play --port 4748`)],
    [90022, row(90022, T, `/bin/zsh -c source /Users/me/.claude/shell-snapshots/snapshot.sh && eval '${node} ${BIN} play --no-open' < /dev/null`)],
    [90023, row(90023, T, `caffeinate -i ${node} ${BIN} play`)],
    [90024, row(90024, T, `timeout 600 ${node} ${BIN} render`)],
    [90025, row(90025, T, `/bin/sh -c ${node} ${BIN} plan`)],
    [90026, row(90026, T, `${node} -e require('x') ${BIN} play`)],
    [90027, row(90027, T, `${node} --enable-source-maps ${BIN} render`)],
  ]);
  // 90021 runs another command line than its entry records, so it counts as a process that wrote no entry.
  assert.deepEqual(withScan(() => listProcesses({ ps: () => table })).map((p) => [p.pid, p.kind, p.registered]), [[90021, 'play', false], [90027, 'render', false]]);
  assert.equal(fs.existsSync(entryOf(90021)), true, 'same pid and start: not trusted, but not removed either');
  fs.rmSync(entryOf(90021));
});

/** Starts `command` with `args` in `cwd`, and resolves once its output matches `ready`. */
function startProcess(command, args, cwd, ready, more = {}) {
  const child = spawn(command, args, { cwd, env: { ...env, ...more }, stdio: ['ignore', 'pipe', 'pipe'] });
  started.add(child);
  child.output = '';
  child.exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return new Promise((resolve, reject) => {
    const check = (chunk) => {
      child.output += chunk;
      if (ready.test(child.output)) resolve(child);
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.exited.then(() => reject(new Error(`exited before ${ready}: ${child.output}`)));
  });
}

test('a shell that runs play is not listed, and stopping the play by pid leaves the shell running on', async () => {
  const { cwd } = runIn('wrapped');
  const shell = await startProcess('/bin/sh', ['-c', `${process.execPath} ${BIN} play --no-voice --no-open --port 5520; echo shell went on`], cwd, /mr-cast player:/);
  const mine = (list) => list.filter((p) => p.pid === shell.pid || p.ppid === shell.pid);
  const listed = mine(withScan(() => listProcesses()));
  assert.deepEqual(listed.map((p) => [p.kind, p.registered, p.pid === shell.pid]), [['play', true, false]]);
  const stopped = cli(cwd, 'stop', String(listed[0].pid), '--json');
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.deepEqual(JSON.parse(stopped.stdout).processes.map((p) => [p.pid, p.outcome]), [[listed[0].pid, 'stopped']]);
  assert.deepEqual(await within(shell.exited, 5000), { code: 0, signal: null });
  assert.match(shell.output, /shell went on/);
});

test('a play started with a relative script path is registered, listed and replaced, and one that recorded elsewhere is found', async () => {
  const { dir } = runIn('relative');
  const args = ['bin/mr-cast.mjs', 'play', '--dir', dir, '--no-voice', '--no-open'];
  const first = await startProcess(process.execPath, [...args, '--port', '5550'], ROOT, /mr-cast player:/);
  assert.deepEqual(listProcesses().filter((p) => p.pid === first.pid).map((p) => [p.kind, p.registered, p.dir]), [['play', true, dir]]);
  const second = await startProcess(process.execPath, [...args, '--port', '5580'], ROOT, /mr-cast player:/);
  assert.match(second.output, new RegExp(`stopping the play server already running for this run \\(pid ${first.pid}, `));
  assert.deepEqual(await within(first.exited, 2000), { code: 0, signal: null });
  second.kill('SIGTERM');
  await second.exited;

  const { dir: other } = runIn('relative-elsewhere');
  const elsewhere = await startProcess(process.execPath, ['bin/mr-cast.mjs', 'play', '--dir', other, '--no-voice', '--no-open', '--port', '5610'], ROOT, /mr-cast player:/, { XDG_STATE_HOME: path.join(tmp, 'state-elsewhere') });
  assert.deepEqual(withScan(() => listProcesses()).filter((p) => p.pid === elsewhere.pid).map((p) => [p.kind, p.registered, p.repo]), [['play', false, ROOT]]);
  elsewhere.kill('SIGTERM');
  await elsewhere.exited;
});

const proc = (pid, kind, fields = {}) => ({
  pid, ppid: 1, kind, started: 'x', command: 'x', version: '0.28.0', url: null, dir: null, run: null, repo: null, registered: true,
  startedAt: 0, viewers: kind === 'play' || kind === 'plan' ? 0 : null, idleSince: null, idleExit: 30, exitsAt: null, parent: null, ...fields,
});
const HOUR = 3_600_000;
const NOW = 10 * HOUR;
const LIST = [
  proc(1, 'play', { run: 'limiter', startedAt: NOW - 3 * HOUR, url: 'http://127.0.0.1:4747/#token=a' }),
  proc(2, 'voice', { run: 'limiter', startedAt: NOW - 3 * HOUR, parent: 1 }),
  proc(3, 'plan', { run: 'retry', startedAt: NOW - 3 * HOUR, viewers: 1 }),
  proc(4, 'play', { run: 'retry', startedAt: NOW - 10 * 60_000 }),
  proc(5, 'render', { startedAt: NOW - 5 * 60_000, registered: false }),
];
const pick = (targets, fields = {}) => selectProcs(LIST, { targets, olderThan: null, idle: false, ...fields }, NOW).map((p) => p.pid);

test('stop picks pids, runs or all, narrows by --idle and --older-than, and takes children with their parent', () => {
  assert.deepEqual(pick(['1']), [1, 2]);
  assert.deepEqual(pick(['retry']), [3, 4]);
  assert.deepEqual(pick(['all'], { idle: true }), [1, 2, 4]);
  assert.deepEqual(pick(['all'], { olderThan: '2h' }), [1, 2, 3]);
  assert.deepEqual(pick(['all'], { idle: true, olderThan: '2h' }), [1, 2]);
  assert.throws(() => pick([]), /name what to stop: a pid, a run name, or all/);
  assert.throws(() => pick(['1', '77', 'nope']), /not stopping anything: pid 77 is not a running mr-cast process of yours; no running mr-cast process has run "nope"/);
  assert.throws(() => pick(['all'], { olderThan: '2' }), /--older-than takes a number and a unit, such as 30m, 2h or 1d \(got "2"\)/);
});

test('stop <run> stops that run of this repository only, unless --any-repo', async () => {
  const here = runIn('shared-name', path.join(tmp, 'repo-a'));
  const there = runIn('shared-name', path.join(tmp, 'repo-b'));
  const a = await startCli(here.cwd, ['play', '--no-voice', '--no-open', '--port', '5700'], /mr-cast player:/);
  const b = await startCli(there.cwd, ['play', '--no-voice', '--no-open', '--port', '5730'], /mr-cast player:/);
  const wouldStop = (...args) => {
    const out = cli(here.cwd, 'stop', 'shared-name', '--dry-run', '--json', ...args);
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout).processes.map((p) => p.pid).sort();
  };
  assert.deepEqual(wouldStop(), [a.pid]);
  assert.deepEqual(wouldStop('--any-repo'), [a.pid, b.pid].sort());
  const repoC = path.join(tmp, 'repo-c');
  fs.mkdirSync(repoC);
  const elsewhere = cli(repoC, 'stop', 'shared-name', '--dry-run');
  assert.equal(elsewhere.status, 1);
  assert.match(elsewhere.stderr, /no running mr-cast process of this repository has run "shared-name" \(--any-repo stops it in other repositories\)/);
  for (const p of [a, b]) p.kill('SIGTERM');
  await Promise.all([a.exited, b.exited]);
});

test('ps says when an idle server exits, and that a voicing holds it off', () => {
  const lines = formatPs([
    proc(1, 'play', { run: 'idle', startedAt: NOW - HOUR, exitsAt: NOW + 11 * 60_000 + 1 }),
    proc(4, 'play', { run: 'voicing', startedAt: NOW - HOUR }),
    proc(3, 'plan', { run: 'kept', startedAt: NOW - HOUR, idleExit: 0 }),
  ], NOW);
  assert.deepEqual(lines.slice(1, 4).map((l) => l.split(/\s{2,}/)[3]), ['none · exits in 12m', 'none · voicing', 'none']);
});

test('stop --choices offers every process, the narrowing picks, and each process, with the command that stops it', () => {
  const four = LIST.filter((p) => p.pid !== 5);
  assert.deepEqual(stopChoices(four, NOW), {
    groups: [{
      name: 'Running processes',
      options: [
        { label: 'Every running mr-cast process', description: '3 processes; everything `mr-cast ps` lists; their pages stop working', command: ['stop', '1', '3', '4'], ids: ['1', '3', '4'] },
        { label: 'Servers with no page open', description: '2 processes; nobody is watching them; their pages stop working', command: ['stop', '1', '4'], ids: ['1', '4'] },
        { label: 'Running for over 2 hours', description: '2 processes; started more than 2 hours ago; their pages stop working', command: ['stop', '1', '3'], ids: ['1', '3'] },
      ],
    }],
  });
  assert.deepEqual(stopChoices([LIST[0], LIST[1], LIST[4]], NOW).groups[0].options, [
    { label: 'Every running mr-cast process', description: '2 processes; everything `mr-cast ps` lists; their pages stop working, and a render writes no MP4', command: ['stop', '1', '5'], ids: ['1', '5'] },
    { label: 'Player of limiter', description: 'pid 1, up 3h, no page open; its page stops working; `mr-cast play` starts it again', command: ['stop', '1'], ids: ['1'] },
    { label: 'Render', description: 'pid 5, up 5m, unregistered; the render stops and writes no MP4', command: ['stop', '5'], ids: ['5'] },
  ]);
  assert.deepEqual(stopChoices([], NOW), { groups: [] });
});

test('stop skips a pid that has exited since the menu listed it, and stops the rest', async () => {
  const { cwd } = runIn('menu');
  const play = await startCli(cwd, ['play', '--no-voice', '--no-open', '--port', '5760'], /mr-cast player:/);
  const gone = spawn(process.execPath, ['-e', '0']);
  await new Promise((resolve) => gone.on('exit', resolve));
  const out = cli(cwd, 'stop', String(gone.pid), String(play.pid));
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(out.stdout.trim().split('\n').map((l) => l.replace(/ · .*/, '')), [`skipped pid ${gone.pid}: it has exited already`, `stopped play ${play.pid}`]);
  assert.deepEqual(await within(play.exited, 2000), { code: 0, signal: null });
  const alone = cli(cwd, 'stop', String(gone.pid), '--json');
  assert.equal(alone.status, 0, alone.stderr);
  assert.deepEqual(JSON.parse(alone.stdout), { dryRun: false, processes: [], exited: [gone.pid] });
});

test('stop never signals a pid that is not a verified mr-cast process, even with a forged entry', async () => {
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  started.add(other);
  for (let i = 0; i < 50 && !processTable([other.pid]).get(other.pid); i++) await new Promise((r) => setTimeout(r, 20));
  writeEntry({ pid: other.pid, kind: 'play', started: processTable([other.pid]).get(other.pid).started, run: 'forged' });

  const refused = cli(tmp, 'stop', String(other.pid));
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr.trim(), `mr-cast: not stopping anything: pid ${other.pid} is not a running mr-cast process of yours; \`mr-cast ps\` lists them`);
  assert.equal(cli(tmp, 'stop', 'forged').status, 1);

  // A process that stopped being mr-cast after it was listed is not signalled either.
  const outcome = await stopProcesses([proc(other.pid, 'play', { started: processTable([other.pid]).get(other.pid).started })]);
  assert.equal(outcome[0].outcome, 'gone');
  assert.equal(other.exitCode, null);
  assert.equal(other.signalCode, null);
  other.kill('SIGKILL');
  await new Promise((resolve) => other.on('exit', resolve));
  listProcesses();
  assert.equal(fs.existsSync(entryOf(other.pid)), false, 'the forged entry goes once its pid has exited');
});

test('the server reports pages coming and going, and calls onIdle once none has been open for idle.ms', async () => {
  const dist = path.join(tmp, 'dist');
  const data = fs.mkdtempSync(path.join(tmp, 'data-'));
  const viewers = [];
  let idled = 0;
  let busy = true;
  const server = await startServer({ distDir: dist, dataDir: data, port: 0, onViewers: (n) => viewers.push(n), idle: { ms: 150, busy: () => busy, onIdle: () => idled++ } });
  try {
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(idled, 0, 'not while busy');
    busy = false;
    const page = http.get(new URL('/events', server.url));
    await new Promise((resolve) => page.on('response', resolve));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(idled, 0, 'not while a page is open');
    page.destroy();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(idled, 1, 'once the last page has been gone for idle.ms');
    assert.deepEqual(viewers, [1, 0]);
  } finally {
    await server.close();
  }
});

test('the idle count waits while busy, starts over once it is not, and reports when it would end', async () => {
  const dist = path.join(tmp, 'dist');
  const data = fs.mkdtempSync(path.join(tmp, 'data-'));
  const deadlines = [];
  let idled = 0;
  let busy = false;
  const server = await startServer({ distDir: dist, dataDir: data, port: 0, idle: { ms: 300, busy: () => busy, onDeadline: (ms) => deadlines.push(ms), onIdle: () => idled++ } });
  try {
    const start = Date.now();
    assert.equal(deadlines.length, 1);
    assert.ok(Math.abs(deadlines[0] - (start + 300)) < 50, 'counting from the start');
    await new Promise((r) => setTimeout(r, 150));
    busy = true;
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(idled, 0, 'not while busy, though the first count has run out');
    assert.equal(deadlines.at(-1), null);
    busy = false;
    const free = Date.now();
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(deadlines.at(-1) >= free + 300 - 100, 'a new count from when it stopped being busy');
    assert.equal(idled, 0);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(idled, 1);
  } finally {
    await server.close();
  }
});

/** A stalled model host: it answers each request with a few bytes and then nothing, until closed. */
async function stalledHub() {
  const requests = [];
  let arrived;
  const firstRequest = new Promise((resolve) => { arrived = resolve; });
  const server = http.createServer((req, res) => {
    requests.push(req);
    res.writeHead(200, { 'content-length': '78268016' });
    res.write('ONNX');
    arrived();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const close = () => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
  after(close);
  return { url: `http://127.0.0.1:${server.address().port}`, requests, firstRequest, close };
}

/** Gives the run's narration a clip on disk, so play serves it at once without a voice model. */
function voiceRun(dir, text) {
  const voice = 'kitten:luna';
  const src = 'audio/0000abcd.wav';
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, src), Buffer.alloc(44 + 4800));
  fs.writeFileSync(path.join(dir, 'voiceover.json'), JSON.stringify({ voice, speed: 1, pauses: 1, clips: { [narrationKey(text, voice, 1)]: { src, seconds: 0.2, voice, speed: 1 } } }));
}

test('an idle play does not exit while an edit is being voiced, and ps says so', async () => {
  const { cwd, dir } = runIn('edit-voicing');
  voiceRun(dir, 'Requests over the limit wait.');
  const hub = await stalledHub();
  const play = await startCli(cwd, ['play', '--no-open', '--port', '5790', '--idle-exit', '0.02'], /mr-cast player:/, { HF_ENDPOINT: hub.url });
  const board = JSON.parse(fs.readFileSync(path.join(dir, 'storyboard.json'), 'utf8'));
  board.scenes[0].narration = 'Requests over the limit wait their turn.';
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify(board));
  await within(hub.firstRequest, 5000);
  assert.equal(await within(play.exited, 2500), 'timeout', 'still running though no page opened for twice --idle-exit');
  const ps = cli(cwd, 'ps');
  assert.match(ps.stdout, new RegExp(`^${play.pid}\\s+play\\s+\\S+\\s+none · voicing\\s`, 'm'));
  await hub.close();
  assert.deepEqual(await within(play.exited, 5000), { code: 0, signal: null });
  assert.match(play.output, /no page has been open for 0\.02 minutes, so the player stopped/);
});

test('a play that replaces one downloading the voice model leaves that download running and waits for it', async () => {
  const { cwd } = runIn('first-run');
  const hub = await stalledHub();
  const more = { HF_ENDPOINT: hub.url, XDG_CACHE_HOME: path.join(tmp, 'cache-first-run') };
  const first = await startCli(cwd, ['play', '--no-open', '--port', '5820'], /mr-cast player:/, more);
  await within(hub.firstRequest, 5000);
  const download = listProcesses().find((p) => p.kind === 'download' && p.ppid === first.pid);
  assert.ok(download, 'the first play has a download child');
  const second = await within(startCli(cwd, ['play', '--no-open', '--port', '5850'], new RegExp(`waiting for another mr-cast \\(pid ${download.pid}\\) to finish downloading`), more), 10_000);
  assert.notEqual(second, 'timeout', 'the second play waits for the first one\'s download');
  assert.deepEqual(await within(first.exited, 2000), { code: 0, signal: null });
  assert.equal(processTable([download.pid]).get(download.pid)?.command, download.command, 'the download runs on');
  assert.deepEqual([hub.requests.length, hub.requests[0].socket.destroyed], [1, false], 'one download, never restarted');
  await hub.close();
  for (let i = 0; i < 100 && processTable([download.pid]).has(download.pid); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(processTable([download.pid]).has(download.pid), false, 'the download ends once it fails');
  second.kill('SIGTERM');
  await second.exited;
});

const RENDER_CACHE = process.env.MR_CAST_TEST_RENDER_CACHE;

/** The processes descended from `pid` that `ps` shows now. */
function descendants(pid) {
  const rows = [...processTable().values()];
  const found = [];
  for (let parents = [pid]; parents.length;) {
    const next = rows.filter((r) => parents.includes(r.ppid));
    found.push(...next);
    parents = next.map((r) => r.pid);
  }
  return found;
}

test('stop ends a render, which closes the Chrome it started before it exits', {
  skip: RENDER_CACHE ? false : 'MR_CAST_TEST_RENDER_CACHE names no XDG_CACHE_HOME holding Chrome Headless Shell',
}, async () => {
  const { cwd, dir } = runIn('render-stop');
  const scenes = Array.from({ length: 40 }, (_, i) => ({ type: 'text', narration: `Scene ${i} keeps the render busy for a few seconds more.`, headline: `Scene ${i}` }));
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ title: 'render-stop', scenes }));
  const render = await startCli(cwd, ['render', '--no-voice'], /rendering \d+%/, { XDG_CACHE_HOME: RENDER_CACHE });
  const chrome = descendants(render.pid).filter((r) => /chrome-headless-shell/.test(r.command));
  assert.ok(chrome.length > 0, 'Chrome runs under the render');
  const stopped = cli(cwd, 'stop', String(render.pid), '--json');
  assert.equal(stopped.status, 0, stopped.stderr);
  // 143 is the handler's own exit; a render without one dies of the signal.
  assert.deepEqual(await within(render.exited, 10_000), { code: 143, signal: null });
  for (let i = 0; i < 50 && chrome.some((r) => processTable([r.pid])?.has(r.pid)); i++) await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(chrome.filter((r) => processTable([r.pid])?.get(r.pid)?.started === r.started).map((r) => r.pid), [], 'no Chrome process is left');
});

test('play with --idle-exit stops by itself when no page opens, and removes its entry', async () => {
  const { cwd } = runIn('idle');
  const play = await startCli(cwd, ['play', '--no-voice', '--no-open', '--port', '5340', '--idle-exit', '0.01'], /mr-cast player:/);
  assert.deepEqual(await within(play.exited, 5000), { code: 0, signal: null });
  assert.match(play.output, /mr-cast: no page has been open for 0\.01 minutes, so the player stopped \(--idle-exit 0 keeps it running\)/);
  assert.equal(fs.existsSync(entryOf(play.pid)), false);
});

test('a second play of the same run replaces the first; a play of another run is left alone', async () => {
  const { cwd, dir } = runIn('twice');
  const other = runIn('other');
  const elsewhere = await startCli(other.cwd, ['play', '--no-voice', '--no-open', '--port', '5370'], /mr-cast player:/);
  const first = await startCli(cwd, ['play', '--no-voice', '--no-open', '--port', '5400'], /mr-cast player:/);
  const second = await startCli(cwd, ['play', '--no-voice', '--no-open', '--port', '5430'], /mr-cast player:/);
  assert.match(second.output, new RegExp(`mr-cast: stopping the play server already running for this run \\(pid ${first.pid}, http://127\\.0\\.0\\.1:\\d+/#token=\\w+\\); this one replaces it`));
  assert.deepEqual(await within(first.exited, 1000), { code: 0, signal: null });
  const plays = listProcesses().filter((p) => p.registered && p.kind === 'play');
  assert.deepEqual(plays.map((p) => [p.pid, p.dir]).sort(), [[elsewhere.pid, other.dir], [second.pid, dir]].sort());

  const stopped = cli(tmp, 'stop', String(second.pid), '--json');
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.deepEqual(JSON.parse(stopped.stdout).processes.map((p) => [p.pid, p.outcome]), [[second.pid, 'stopped']]);
  elsewhere.kill('SIGTERM');
  await elsewhere.exited;
});
