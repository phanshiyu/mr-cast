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
};
process.env.XDG_STATE_HOME = env.XDG_STATE_HOME;
fs.mkdirSync(env.MR_CAST_DIST, { recursive: true });
fs.writeFileSync(path.join(env.MR_CAST_DIST, 'index.html'), '<!doctype html>');

const { listProcesses, processTable, procsDir, selectProcs, stopChoices, stopProcesses } = await import('../bin/lib/procs.mjs');
const { startServer } = await import('../bin/lib/server.mjs');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(ROOT, 'bin', 'mr-cast.mjs');
const started = new Set();
after(() => {
  for (const child of started) child.kill('SIGKILL');
  fs.rmSync(tmp, { recursive: true, force: true });
});

const cli = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8' });

/** A directory holding one valid walkthrough, the current run. */
function runIn(name) {
  const cwd = path.join(tmp, name);
  fs.mkdirSync(cwd, { recursive: true });
  const dir = cli(cwd, 'init', '--title', name).stdout.trim();
  fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({ title: name, scenes: [{ type: 'text', narration: 'Requests over the limit wait.', headline: 'Requests wait' }] }));
  return { cwd, dir };
}

/** Starts `mr-cast <args>` in `cwd` and resolves once it prints a line matching `ready`. */
function startCli(cwd, args, ready) {
  const child = spawn(process.execPath, [BIN, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

const uid = process.getuid();
const row = (pid, started, command) => ({ pid, ppid: 1, uid, started, command });
const mrCast = (sub) => `${process.execPath} ${BIN} ${sub} --no-open`;
const writeEntry = (entry) => {
  fs.mkdirSync(procsDir(), { recursive: true });
  fs.writeFileSync(entryOf(entry.pid), JSON.stringify({ ppid: 1, version: '0.28.0', url: null, dir: null, run: null, repo: null, ...entry }));
};

test('an entry counts only while ps shows the same mr-cast process of this user; any other is stale and removed', () => {
  const T = 'Sun Oct 18 10:00:00 2026';
  writeEntry({ pid: 90001, kind: 'play', started: T, run: 'live' });
  writeEntry({ pid: 90002, kind: 'play', started: T, run: 'dead' });
  writeEntry({ pid: 90003, kind: 'play', started: T, run: 'reused' });
  writeEntry({ pid: 90004, kind: 'render', started: T, run: 'not-mr-cast' });
  writeEntry({ pid: 90005, kind: 'plan', started: T, run: 'other-user' });
  writeEntry({ pid: 90006, kind: 'voice', started: T, ppid: 90001, run: 'live' });
  const table = new Map([
    [90001, row(90001, T, mrCast('play'))],
    [90003, row(90003, 'Sun Oct 18 10:05:00 2026', mrCast('play'))],
    [90004, row(90004, T, '/bin/sleep 600')],
    [90005, { ...row(90005, T, mrCast('plan')), uid: uid + 1 }],
    [90006, row(90006, T, `${process.execPath} ${ROOT}/bin/lib/voice-child.mjs --voice-child`)],
    [90007, row(90007, 'Sun Oct 18 09:00:00 2026', `${process.execPath} ${BIN} render`)],
    [90008, row(90008, T, `${process.execPath} /elsewhere/bin/mr-cast.mjs play`)],
  ]);
  const listed = listProcesses({ ps: () => table });
  assert.deepEqual(listed.map((p) => [p.pid, p.kind, p.registered, p.parent]), [
    [90007, 'render', false, null],
    [90001, 'play', true, null],
    [90006, 'voice', true, 90001],
    // The reused pid runs mr-cast, so it is listed, but as a process that wrote no entry.
    [90003, 'play', false, null],
  ]);
  assert.deepEqual(fs.readdirSync(procsDir()).sort(), ['90001.json', '90006.json']);
  for (const pid of [90001, 90006]) fs.rmSync(entryOf(pid));
});

const proc = (pid, kind, fields = {}) => ({
  pid, ppid: 1, kind, started: 'x', version: '0.28.0', url: null, dir: null, run: null, repo: null, registered: true,
  startedAt: 0, viewers: kind === 'play' || kind === 'plan' ? 0 : null, idleSince: null, idleExit: 30, parent: null, ...fields,
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

test('stop --choices offers every process, the narrowing picks, and each process, with the command that stops it', () => {
  const four = LIST.filter((p) => p.pid !== 5);
  assert.deepEqual(stopChoices(four, NOW), {
    groups: [{
      name: 'Running processes',
      options: [
        { label: 'Every running mr-cast process', description: '3 processes; everything `mr-cast ps` lists; their pages stop working', command: ['stop', 'all'], ids: ['1', '2', '3', '4'] },
        { label: 'Servers with no page open', description: '2 processes; nobody is watching them; their pages stop working', command: ['stop', 'all', '--idle'], ids: ['1', '2', '4'] },
        { label: 'Running for over 2 hours', description: '2 processes; started more than 2 hours ago; their pages stop working', command: ['stop', 'all', '--older-than', '2h'], ids: ['1', '2', '3'] },
      ],
    }],
  });
  assert.deepEqual(stopChoices([LIST[0], LIST[1], LIST[4]], NOW).groups[0].options, [
    { label: 'Every running mr-cast process', description: '2 processes; everything `mr-cast ps` lists; their pages stop working, and a render writes no MP4', command: ['stop', 'all'], ids: ['1', '2', '5'] },
    { label: 'Player of limiter', description: 'pid 1, up 3h, no page open; its page stops working; `mr-cast play` starts it again', command: ['stop', '1'], ids: ['1', '2'] },
    { label: 'Render', description: 'pid 5, up 5m, unregistered; the render stops and writes no MP4', command: ['stop', '5'], ids: ['5'] },
  ]);
  assert.deepEqual(stopChoices([], NOW), { groups: [] });
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
  assert.equal(fs.existsSync(entryOf(other.pid)), false, 'the forged entry is dropped as stale');

  // A process that stopped being mr-cast after it was listed is not signalled either.
  const outcome = await stopProcesses([proc(other.pid, 'play', { started: processTable([other.pid]).get(other.pid).started })]);
  assert.equal(outcome[0].outcome, 'gone');
  assert.equal(other.exitCode, null);
  assert.equal(other.signalCode, null);
  other.kill('SIGKILL');
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
