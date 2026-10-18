// Which mr-cast processes are running, and stopping them. Each long-lived process (the play and plan servers, render,
// and play's voice and download children) writes <pid>.json into procsDir() as it starts and removes it as it exits.
// A listing trusts an entry only while `ps` shows that pid owned by this user, started at the recorded time and running
// mr-cast; any other entry is stale and removed. mr-cast 0.27 and older wrote no entry, so `ps` is also scanned for
// them. `mr-cast stop` signals only processes that pass the same check again just before each signal.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { UserError } from './errors.mjs';
import { plural } from './summary.mjs';

/**
 * @typedef {'play' | 'plan' | 'render' | 'voice' | 'download'} ProcKind
 * @typedef {{ pid: number, ppid: number, uid: number, started: string, command: string }} Row  One line of `ps`.
 * @typedef {{
 *   pid: number, ppid: number, kind: ProcKind, started: string, version: string | null, url: string | null,
 *   dir: string | null, run: string | null, repo: string | null, viewers?: number, idleSince?: string | null,
 *   idleExit?: number,
 * }} Entry  What a process writes about itself. `started` is its start time as `ps` prints it.
 * @typedef {Entry & {
 *   registered: boolean, startedAt: number, viewers: number | null, idleSince: number | null,
 *   idleExit: number | null, parent: number | null,
 * }} Proc  A verified running process. `viewers` is null where it is unknown or not a server; `parent` is the
 *   listed process a voice or download child belongs to.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PACKAGE = '@shiyuphan/mr-cast';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const SERVERS = new Set(['play', 'plan']);
const CHILDREN = new Set(['voice', 'download']);
const SCRIPT = /(?:^|\s)(\S*\/bin\/mr-cast\.mjs)\s+(?:explain\s+)?(\S+)/;
const CHILD_SCRIPT = /(?:^|\s)(\S*\/bin\/lib\/voice-child\.mjs)\s+--voice-child(?:\s|$)/;
const OLD_KINDS = new Set(['play', 'plan', 'render']);

/** Per user, beside other state that outlives a command; a stale entry is dropped by the next listing. */
export const procsDir = () => path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'mr-cast', 'procs');

const entryFile = (pid) => path.join(procsDir(), `${pid}.json`);

/** Removes the entry of `pid`, as play does for a child it killed. */
export const removeEntry = (pid) => fs.rmSync(entryFile(pid), { force: true });

/**
 * The processes `ps` shows, by pid: every process, or only `pids`. Empty where there is no `ps` (Windows), so nothing
 * is verified there and nothing is stopped.
 * @returns {Map<number, Row>}
 */
export function processTable(pids = null) {
  const out = spawnSync('ps', [...(pids ? ['-p', pids.join(',')] : ['-A']), '-ww', '-o', 'pid=,ppid=,uid=,lstart=,command='], {
    encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' },
  });
  const rows = new Map();
  for (const line of (out.stdout ?? '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s+(.*)$/);
    if (m) rows.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), uid: Number(m[3]), started: m[4], command: m[5] });
  }
  return rows;
}

const ownUid = () => process.getuid?.() ?? -1;

/** Whether `row` is the process `entry` describes: this user's, started then, and running mr-cast. */
const same = (row, entry) => Boolean(row) && row.uid === ownUid() && row.started === entry.started && (SCRIPT.test(row.command) || CHILD_SCRIPT.test(row.command));

/** The run fields of a process working on run directory `dir`. */
export const runFields = (dir) => {
  if (!dir) return { dir: null, run: null, repo: null };
  const abs = path.resolve(dir);
  const parent = path.dirname(abs);
  return { dir: abs, run: path.basename(abs), repo: path.basename(parent) === '.mr-cast' ? path.dirname(parent) : null };
};

/**
 * Records this process in the registry until it exits. `update` rewrites the entry, as a server does when a page
 * connects or leaves. Without `ps` nothing is recorded.
 * @param {Omit<Entry, 'pid' | 'ppid' | 'started' | 'version'>} fields
 */
export function register(fields) {
  const row = processTable([process.pid]).get(process.pid);
  if (!row) return { update() {}, remove() {} };
  const file = entryFile(process.pid);
  let entry = { pid: process.pid, ppid: process.ppid, started: row.started, version: VERSION, ...fields };
  const write = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    } catch { /* a registry it cannot write only hides this process from `mr-cast ps` */ }
  };
  const remove = () => fs.rmSync(file, { force: true });
  write();
  process.once('exit', remove);
  return { update(patch) { entry = { ...entry, ...patch }; write(); }, remove };
}

const parseTime = (text) => (text ? Date.parse(text) : NaN);

function readEntries(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n)); } catch { /* none yet */ }
  return names.map((name) => {
    const file = path.join(dir, name);
    try {
      const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { file, entry: entry?.pid === Number(name.slice(0, -5)) ? entry : null };
    } catch {
      return { file, entry: null };
    }
  });
}

/** The working directory and listening port of another process, from `lsof`; nulls where it cannot tell. */
function lsofOf(pid) {
  const field = (args) => {
    const out = spawnSync('lsof', ['-a', '-p', String(pid), ...args, '-Fn'], { encoding: 'utf8' }).stdout ?? '';
    return out.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? null;
  };
  const cwd = field(['-d', 'cwd']);
  const port = field(['-iTCP', '-sTCP:LISTEN', '-P', '-n'])?.match(/:(\d+)$/)?.[1] ?? null;
  return { cwd, port };
}

const packageOf = (root) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { return null; }
};

/** A process of this user running an mr-cast that wrote no entry, as 0.27 and older do; null for anything else. */
function unregistered(row) {
  if (row.uid !== ownUid()) return null;
  const main = row.command.match(SCRIPT);
  const child = main ? null : row.command.match(CHILD_SCRIPT);
  if (!(main && OLD_KINDS.has(main[2])) && !child) return null;
  const { cwd, port } = lsofOf(row.pid);
  const script = path.resolve(cwd ?? '/', (main ?? child)[1]);
  const root = path.dirname(path.dirname(main ? script : path.dirname(script)));
  const pkg = packageOf(root);
  if (pkg?.name !== PACKAGE) return null;
  const kind = /** @type {ProcKind} */ (main ? main[2] : 'voice');
  const name = row.command.match(/\s--name\s+(\S+)/)?.[1] ?? null;
  return {
    pid: row.pid, ppid: row.ppid, kind, started: row.started, version: null, registered: false,
    url: port && SERVERS.has(kind) ? `http://127.0.0.1:${port}${kind === 'plan' ? '/plan' : ''}` : null,
    dir: null, run: name, repo: main ? cwd : null, startedAt: parseTime(row.started),
    viewers: null, idleSince: null, idleExit: null, parent: null,
  };
}

/** Each process started first, followed by its children. */
function ordered(procs) {
  const byStart = [...procs].sort((a, b) => a.startedAt - b.startedAt || a.pid - b.pid);
  const tops = byStart.filter((p) => p.parent === null);
  return tops.flatMap((top) => [top, ...byStart.filter((p) => p.parent === top.pid)]);
}

/**
 * Every running mr-cast process of this user: the verified registry entries, and the processes of older versions
 * that `ps` shows. Stale entries are removed. Entries are read before `ps` runs, so a process that registers
 * meanwhile is in the table.
 * @returns {Proc[]}
 */
export function listProcesses({ ps = processTable } = {}) {
  const read = readEntries(procsDir());
  const table = ps();
  /** @type {Proc[]} */
  const procs = [];
  for (const { file, entry } of read) {
    if (!entry || !same(table.get(entry.pid), entry)) {
      fs.rmSync(file, { force: true });
      continue;
    }
    procs.push({
      ...entry, registered: true, startedAt: parseTime(entry.started),
      url: entry.url ?? null, dir: entry.dir ?? null, run: entry.run ?? null, repo: entry.repo ?? null, version: entry.version ?? null,
      viewers: SERVERS.has(entry.kind) ? entry.viewers ?? 0 : null,
      idleSince: SERVERS.has(entry.kind) ? parseTime(entry.idleSince) || null : null,
      idleExit: SERVERS.has(entry.kind) ? entry.idleExit ?? null : null,
      parent: null,
    });
  }
  const known = new Set(procs.map((p) => p.pid));
  for (const row of table.values()) {
    const old = known.has(row.pid) || row.pid === process.pid ? null : unregistered(row);
    if (old) procs.push(old);
  }
  const pids = new Set(procs.map((p) => p.pid));
  for (const p of procs) p.parent = CHILDREN.has(p.kind) && pids.has(p.ppid) ? p.ppid : null;
  return ordered(procs);
}

const DURATION = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "90m", "2h" or "1d" in milliseconds. */
export function parseDuration(text, flag) {
  const m = String(text).match(/^(\d+)([mhd])$/);
  if (!m) throw new UserError(`${flag} takes a number and a unit, such as 30m, 2h or 1d (got "${text}")`);
  return Number(m[1]) * DURATION[m[2]];
}

/**
 * @typedef {{ targets: string[], olderThan: string | null, idle: boolean }} StopSelector  `targets` are pids, run
 *   names or `all`; `olderThan` a duration such as "2h"; `idle` keeps only servers with no page open.
 */

/**
 * What `selector` stops in `list`: the processes it names that pass its filters, each with its children. Throws,
 * choosing nothing, on a target that names no listed process.
 */
export function selectProcs(list, selector, now = Date.now()) {
  const { targets } = selector;
  if (targets.length === 0) throw new UserError('name what to stop: a pid, a run name, or all; `mr-cast ps` lists them');
  const unknown = targets.filter((t) => t !== 'all' && !list.some((p) => String(p.pid) === t || p.run === t));
  if (unknown.length) {
    const why = (t) => (/^\d+$/.test(t) ? `pid ${t} is not a running mr-cast process of yours` : `no running mr-cast process has run "${t}"`);
    throw new UserError(`not stopping anything: ${unknown.map(why).join('; ')}; \`mr-cast ps\` lists them`);
  }
  const olderThanMs = selector.olderThan === null ? null : parseDuration(selector.olderThan, '--older-than');
  const named = (p) => targets.includes('all') || targets.includes(String(p.pid)) || (p.run !== null && targets.includes(p.run));
  const fits = (p) => (olderThanMs === null || now - p.startedAt >= olderThanMs) && (!selector.idle || p.viewers === 0);
  const picked = new Set(list.filter((p) => named(p) && fits(p)).map((p) => p.pid));
  return list.filter((p) => picked.has(p.pid) || (p.parent !== null && picked.has(p.parent)));
}

const GRACE_MS = 5_000;
const POLL_MS = 100;

/**
 * Stops `procs`: SIGTERM, then SIGKILL for any still running after `graceMs`. Each signal goes only to a pid that `ps`
 * still shows as the same mr-cast process. Returns each process with its outcome: `stopped` after SIGTERM, `killed`
 * after SIGKILL, `gone` when it had exited already, or `failed` when it outlived both.
 * @returns {Promise<{ proc: Proc, outcome: 'stopped' | 'killed' | 'gone' | 'failed' }[]>}
 */
export async function stopProcesses(procs, { graceMs = GRACE_MS, ps = processTable } = {}) {
  if (procs.length === 0) return [];
  const outcome = new Map();
  const alive = (table) => procs.filter((p) => !outcome.has(p.pid) && same(table.get(p.pid), p));
  const signal = (list, sig) => {
    for (const p of list) {
      try {
        process.kill(p.pid, sig);
      } catch (err) {
        if (err.code !== 'ESRCH') throw err;
      }
    }
  };
  const waitFor = async (list, ms) => {
    const deadline = Date.now() + ms;
    let left = list;
    while (left.length && Date.now() < deadline) {
      await sleep(POLL_MS);
      const table = ps(left.map((p) => p.pid));
      left = left.filter((p) => same(table.get(p.pid), p));
    }
    return left;
  };
  const first = alive(ps(procs.map((p) => p.pid)));
  for (const p of procs) if (!first.includes(p)) outcome.set(p.pid, 'gone');
  signal(first, 'SIGTERM');
  const stubborn = await waitFor(first, graceMs);
  for (const p of first) if (!stubborn.includes(p)) outcome.set(p.pid, 'stopped');
  const toKill = alive(ps(stubborn.map((p) => p.pid)));
  for (const p of stubborn) if (!toKill.includes(p)) outcome.set(p.pid, 'stopped');
  signal(toKill, 'SIGKILL');
  const survivors = await waitFor(toKill, graceMs);
  for (const p of toKill) outcome.set(p.pid, survivors.includes(p) ? 'failed' : 'killed');
  for (const p of procs) if (p.registered && outcome.get(p.pid) !== 'failed') removeEntry(p.pid);
  return procs.map((proc) => ({ proc, outcome: outcome.get(proc.pid) }));
}

export function formatAge(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

const home = (p) => (p && p.startsWith(os.homedir() + path.sep) ? `~${p.slice(os.homedir().length)}` : p);

/** "1 open", "none · exits in 12m", "none", "?" for an older mr-cast, and "" for what is not a server. */
function pageOf(p, now) {
  if (!SERVERS.has(p.kind)) return '';
  if (p.viewers === null) return '?';
  if (p.viewers > 0) return `${p.viewers} open`;
  if (!p.idleExit || !p.idleSince) return 'none';
  return `none · exits in ${formatAge(Math.max(0, p.idleSince + p.idleExit * 60_000 - now) + 59_999)}`;
}

function whereOf(p) {
  if (p.parent !== null) return `with pid ${p.parent}`;
  const at = [p.run, home(p.repo)].filter(Boolean).join(' · ');
  return p.registered ? at : `unregistered${at ? ` · ${at}` : ''}`;
}

export function formatPs(list, now = Date.now()) {
  if (list.length === 0) return ['no mr-cast processes running'];
  const rows = list.map((p) => [String(p.pid), p.parent === null ? p.kind : `  ${p.kind}`, formatAge(now - p.startedAt), pageOf(p, now), p.url ?? '', whereOf(p)]);
  const head = ['pid', 'kind', 'age', 'page', 'url', 'run'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd();
  return [line(head), ...rows.map(line), '', 'stop with `mr-cast stop <pid|run|all>`; --idle and --older-than 2h narrow it, --dry-run only prints'];
}

export const procJson = (p) => ({
  pid: p.pid, ppid: p.ppid, kind: p.kind, registered: p.registered, parent: p.parent,
  startedAt: new Date(p.startedAt).toISOString(), url: p.url, repo: p.repo, run: p.run, dir: p.dir, version: p.version,
  viewers: p.viewers, idleSince: p.idleSince === null ? null : new Date(p.idleSince).toISOString(), idleExit: p.idleExit,
});

const NOUNS = { play: 'player', plan: 'plan page', render: 'render', voice: 'voicing', download: 'voice model download' };

/** "2 players and 1 render": the processes no other listed process owns. */
export function countLine(list) {
  const counts = new Map();
  for (const p of list.filter((q) => q.parent === null)) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => plural(n, NOUNS[kind]));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '';
}

/** The CLI arguments that make `selectProcs` pick what `selector` picks. */
export const stopCommand = (selector) => [
  'stop', ...selector.targets, ...(selector.idle ? ['--idle'] : []), ...(selector.olderThan === null ? [] : ['--older-than', selector.olderThan]),
];

const OLD = '2h';
const MAX_OPTIONS = 4;

const SHORT = { play: 'their pages stop working', plan: 'their pages stop working', render: 'a render writes no MP4', voice: 'the voicing stops', download: 'the download stops' };

const CONSEQUENCE = {
  play: 'its page stops working; `mr-cast play` starts it again',
  plan: 'its page stops saving picks; `mr-cast plan` starts it again',
  render: 'the render stops and writes no MP4',
  voice: 'the voicing stops', download: 'the download stops and starts again on the next voice-over',
};

/**
 * The stop menu, shaped like prune's: one group with up to 4 options, each with the exact `command` that stops what its
 * description counts and the pids it stops as `ids`. No group when nothing runs.
 */
export function stopChoices(list, now = Date.now()) {
  const tops = list.filter((p) => p.parent === null);
  if (tops.length === 0) return { groups: [] };
  const group = (label, selector, note) => {
    const chosen = selectProcs(list, selector, now);
    const top = chosen.filter((p) => p.parent === null);
    const consequences = [...new Set(top.map((p) => SHORT[p.kind]))].join(', and ');
    return { label, description: `${top.length} processes; ${note}; ${consequences}`, command: stopCommand(selector), ids: chosen.map((p) => String(p.pid)) };
  };
  const all = { targets: ['all'], olderThan: null, idle: false };
  const options = [];
  if (tops.length > 1) options.push(group('Every running mr-cast process', all, 'everything `mr-cast ps` lists'));
  const idle = tops.filter((p) => p.viewers === 0).length;
  if (idle > 1 && idle < tops.length) options.push(group('Servers with no page open', { ...all, idle: true }, 'nobody is watching them'));
  const old = tops.filter((p) => now - p.startedAt >= parseDuration(OLD, OLD)).length;
  if (old > 1 && old < tops.length) options.push(group('Running for over 2 hours', { ...all, olderThan: OLD }, 'started more than 2 hours ago'));
  if (tops.length <= MAX_OPTIONS - options.length) {
    for (const p of tops) {
      const page = p.viewers === null ? null : p.viewers === 0 ? 'no page open' : plural(p.viewers, 'page') + ' open';
      const facts = [`pid ${p.pid}`, `up ${formatAge(now - p.startedAt)}`, page, !p.registered && 'unregistered'].filter(Boolean).join(', ');
      const label = `${NOUNS[p.kind][0].toUpperCase()}${NOUNS[p.kind].slice(1)}${p.run ? ` of ${p.run}` : ''}${p.repo ? ` in ${path.basename(p.repo)}` : ''}`;
      const selector = { targets: [String(p.pid)], olderThan: null, idle: false };
      options.push({ label, description: `${facts}; ${CONSEQUENCE[p.kind]}`, command: stopCommand(selector), ids: selectProcs(list, selector, now).map((q) => String(q.pid)) });
    }
  }
  return { groups: [{ name: 'Running processes', options }] };
}

export function formatStopChoices({ groups }) {
  if (groups.length === 0) return ['no mr-cast processes running'];
  return groups.flatMap((g) => [g.name, ...g.options.flatMap((o) => [`  ${o.label} · ${o.description}`, `    mr-cast ${o.command.join(' ')}`])]);
}
