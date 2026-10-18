// Which mr-cast processes are running, and stopping them. Each long-lived process (the play and plan servers, render,
// and play's voice and download children) writes <pid>.json into procsDir() as it starts and removes it as it exits.
// A listing trusts an entry only while `ps` shows that pid owned by this user, started at the recorded time and running
// the recorded mr-cast command line. mr-cast 0.27.0 and older wrote no entry, so `ps` is also scanned for node running
// mr-cast. `mr-cast stop` signals only processes that pass the same check again just before each signal.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
 *   pid: number, ppid: number, kind: ProcKind, started: string, command: string, version: string | null, url: string | null,
 *   dir: string | null, run: string | null, repo: string | null, viewers?: number, idleSince?: string | null,
 *   idleExit?: number, exitsAt?: string | null,
 * }} Entry  What a process writes about itself. `started` is its start time and `command` its command line, both as
 *   `ps` prints them.
 * @typedef {Entry & {
 *   registered: boolean, startedAt: number, viewers: number | null, idleSince: number | null,
 *   idleExit: number | null, exitsAt: number | null, parent: number | null,
 * }} Proc  A verified running process. `viewers` is null where it is unknown or not a server; `exitsAt` is when an
 *   idle server exits, null while a page is open or a voicing runs; `parent` is the listed process a voice or download
 *   child belongs to.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PACKAGE = '@shiyuphan/mr-cast';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const SERVERS = new Set(['play', 'plan']);
const CHILDREN = new Set(['voice', 'download']);
const NODE = /^node(?:js)?[\d.]*$/;
/** Node options that run code instead of a script, so what follows them is not the script. */
const EVAL = new Set(['-e', '--eval', '-p', '--print']);
const MAIN = /(?:^|\/)bin\/mr-cast\.mjs$/;
const CHILD = /(?:^|\/)bin\/lib\/voice-child\.mjs$/;
const OLD_KINDS = new Set(['play', 'plan', 'render']);

/** Per user, beside other state that outlives a command; a stale entry is dropped by the next listing. */
export const procsDir = () =>
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'mr-cast', 'procs');

const entryFile = (pid) => path.join(procsDir(), `${pid}.json`);

/**
 * procsDir() when it is a directory of this user's and not a symlink, so no other user can plant or read entries;
 * made 0700 where it is missing or wider. Null otherwise, and then nothing is recorded or read.
 */
function ownDir({ create }) {
  const dir = procsDir();
  try {
    if (create) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.uid !== ownUid()) return null;
    if (st.mode & 0o077) fs.chmodSync(dir, 0o700);
    return dir;
  } catch {
    return null;
  }
}

/** A temp file a writer leaves behind only when it dies between writing and renaming; older than this, it is junk. */
const STALE_TMP_MS = 60_000;

/** Removes the entry of `pid`, as play does for a child it killed. */
export const removeEntry = (pid) => fs.rmSync(entryFile(pid), { force: true });

/**
 * The processes `ps` shows, by pid: every process, or only `pids`. Null when `ps` gave no answer, as where there is
 * no `ps` (Windows), so nothing is verified there and nothing is stopped. Start times are in UTC, so a process that
 * recorded itself under another TZ still matches.
 * @returns {Map<number, Row> | null}
 */
export function processTable(pids = null) {
  const out = spawnSync(
    'ps',
    [...(pids ? ['-p', pids.join(',')] : ['-A']), '-ww', '-o', 'pid=,ppid=,uid=,lstart=,command='],
    {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' },
      timeout: 5000,
    },
  );
  // `ps -p` exits 1, printing nothing, when none of the pids runs: an answer, unlike any other failure.
  if (out.error || out.signal || out.stderr?.trim() || !(out.status === 0 || (pids && out.status === 1))) return null;
  const rows = new Map();
  for (const line of out.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s+(.*)$/);
    if (m)
      rows.set(Number(m[1]), {
        pid: Number(m[1]),
        ppid: Number(m[2]),
        uid: Number(m[3]),
        started: m[4],
        command: m[5],
      });
  }
  return rows;
}

const ownUid = () => process.getuid?.() ?? -1;

/**
 * What `command`, a command line as `ps` prints it, runs when it is node running mr-cast or its voice child: the
 * script as written, which may be relative to the process's working directory, the kind, and what follows the script.
 * Null for anything else, such as a shell, `caffeinate` or `timeout` whose arguments name mr-cast. Arguments are split
 * on spaces, so a path holding a space never matches, which only hides that process.
 */
function mrCastCommand(command) {
  const [bin, ...args] = command.trim().split(/\s+/);
  if (!NODE.test(path.basename(bin ?? ''))) return null;
  const at = args.findIndex((a) => !a.startsWith('-'));
  if (at < 0 || args.slice(0, at).some((a) => EVAL.has(a.split('=')[0]))) return null;
  const [script, ...rest] = args.slice(at);
  if (CHILD.test(script)) return rest[0] === '--voice-child' ? { script, kind: 'voice', rest } : null;
  if (!MAIN.test(script)) return null;
  return { script, kind: rest[0] === 'explain' ? (rest[1] ?? null) : (rest[0] ?? null), rest };
}

/** Whether `row` is the process `entry` describes: this user's, started then, and running the mr-cast it recorded. */
const same = (row, entry) =>
  Boolean(row) &&
  row.uid === ownUid() &&
  row.started === entry.started &&
  row.command === entry.command &&
  mrCastCommand(row.command) !== null;

/** The run fields of a process working on run directory `dir`. */
export const runFields = (dir) => {
  if (!dir) return { dir: null, run: null, repo: null };
  const abs = path.resolve(dir);
  const parent = path.dirname(abs);
  return {
    dir: abs,
    run: path.basename(abs),
    repo: path.basename(parent) === '.mr-cast' ? path.dirname(parent) : null,
  };
};

/**
 * Records this process in the registry until it exits. `update` rewrites the entry, as a server does when a page
 * connects or leaves. Without `ps` nothing is recorded.
 * @param {Omit<Entry, 'pid' | 'ppid' | 'started' | 'command' | 'version'>} fields
 */
export function register(fields) {
  const row = processTable([process.pid])?.get(process.pid);
  if (!row) return { update() {}, remove() {} };
  const file = entryFile(process.pid);
  let entry = {
    pid: process.pid,
    ppid: process.ppid,
    started: row.started,
    command: row.command,
    version: VERSION,
    ...fields,
  };
  const write = () => {
    const dir = ownDir({ create: true });
    if (!dir) return;
    const tmp = path.join(dir, `${process.pid}.json.${randomBytes(6).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, file);
    } catch {
      // A registry it cannot write only hides this process from `mr-cast ps`.
      fs.rmSync(tmp, { force: true });
    }
  };
  const remove = () => fs.rmSync(file, { force: true });
  write();
  process.once('exit', remove);
  return {
    update(patch) {
      entry = { ...entry, ...patch };
      write();
    },
    remove,
  };
}

const parseTime = (text) => (text ? Date.parse(text) : NaN);
/** A start time as `ps` prints it, in UTC. */
const parseStarted = (text) => Date.parse(`${text} GMT`);

function readEntries() {
  const dir = ownDir({ create: false });
  let names = [];
  try {
    names = dir ? fs.readdirSync(dir) : [];
  } catch {
    /* none yet */
  }
  for (const name of names.filter((n) => n.endsWith('.tmp'))) {
    const file = path.join(dir, name);
    try {
      if (Date.now() - fs.lstatSync(file).mtimeMs > STALE_TMP_MS) fs.rmSync(file, { force: true });
    } catch {
      /* gone meanwhile */
    }
  }
  return names
    .filter((n) => /^\d+\.json$/.test(n))
    .map((name) => {
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
    const out =
      spawnSync('lsof', ['-a', '-p', String(pid), ...args, '-Fn'], { encoding: 'utf8', timeout: 5000 }).stdout ?? '';
    return (
      out
        .split('\n')
        .find((l) => l.startsWith('n'))
        ?.slice(1) ?? null
    );
  };
  const cwd = field(['-d', 'cwd']);
  const port = field(['-iTCP', '-sTCP:LISTEN', '-P', '-n'])?.match(/:(\d+)$/)?.[1] ?? null;
  return { cwd, port };
}

const packageOf = (root) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
};

/** A process of this user running an mr-cast that wrote no entry, as 0.27.0 and older do; null for anything else. */
function unregistered(row) {
  if (row.uid !== ownUid()) return null;
  const found = mrCastCommand(row.command);
  if (!found || !(found.kind === 'voice' || OLD_KINDS.has(found.kind))) return null;
  const { cwd, port } = lsofOf(row.pid);
  if (!cwd && !path.isAbsolute(found.script)) return null;
  const script = path.resolve(cwd ?? '/', found.script);
  const root = path.dirname(path.dirname(found.kind === 'voice' ? path.dirname(script) : script));
  if (packageOf(root)?.name !== PACKAGE) return null;
  const kind = /** @type {ProcKind} */ (found.kind);
  const name = row.command.match(/\s--name\s+(\S+)/)?.[1] ?? null;
  return {
    pid: row.pid,
    ppid: row.ppid,
    kind,
    started: row.started,
    command: row.command,
    version: null,
    registered: false,
    url: port && SERVERS.has(kind) ? `http://127.0.0.1:${port}${kind === 'plan' ? '/plan' : ''}` : null,
    dir: null,
    run: name,
    repo: kind === 'voice' ? null : cwd,
    startedAt: parseStarted(row.started),
    viewers: null,
    idleSince: null,
    idleExit: null,
    exitsAt: null,
    parent: null,
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
 * that `ps` shows. Entries are read before `ps` runs, so a process that registers meanwhile is in the table. An entry
 * is removed only when that table is whole, which it is when it shows this process: then a pid it lacks has exited,
 * and one it shows with another start time was reused. When `ps` fails nothing is listed and nothing is removed.
 * @returns {Proc[]}
 */
export function listProcesses({ ps = processTable } = {}) {
  const read = readEntries();
  const table = ps();
  if (!table?.has(process.pid)) return [];
  /** @type {Proc[]} */
  const procs = [];
  for (const { file, entry } of read) {
    const row = entry && table.get(entry.pid);
    if (row && same(row, entry)) {
      procs.push({
        ...entry,
        registered: true,
        startedAt: parseStarted(entry.started),
        url: entry.url ?? null,
        dir: entry.dir ?? null,
        run: entry.run ?? null,
        repo: entry.repo ?? null,
        version: entry.version ?? null,
        viewers: SERVERS.has(entry.kind) ? (entry.viewers ?? 0) : null,
        idleSince: SERVERS.has(entry.kind) ? parseTime(entry.idleSince) || null : null,
        idleExit: SERVERS.has(entry.kind) ? (entry.idleExit ?? null) : null,
        exitsAt: SERVERS.has(entry.kind) ? parseTime(entry.exitsAt) || null : null,
        parent: null,
      });
    } else if (!row || row.started !== entry.started) {
      fs.rmSync(file, { force: true });
    }
  }
  const known = new Set(procs.map((p) => p.pid));
  // The scan sees every mr-cast of this user on the machine, so tests and sandboxes turn it off to touch only their own.
  for (const row of process.env.MR_CAST_PROCS_SCAN === '0' ? [] : table.values()) {
    const old = known.has(row.pid) || row.pid === process.pid ? null : unregistered(row);
    if (old) procs.push(old);
  }
  const pids = new Set(procs.map((p) => p.pid));
  for (const p of procs) p.parent = CHILDREN.has(p.kind) && pids.has(p.ppid) ? p.ppid : null;
  return ordered(procs);
}

const DURATION = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "90m", "2h" or "1d" in milliseconds. */
function parseDuration(text, flag) {
  const m = String(text).match(/^(\d+)([mhd])$/);
  if (!m) throw new UserError(`${flag} takes a number and a unit, such as 30m, 2h or 1d (got "${text}")`);
  return Number(m[1]) * DURATION[m[2]];
}

/**
 * @typedef {{ targets: string[], olderThan: string | null, idle: boolean, repo?: string | null }} StopSelector
 *   `targets` are pids, run names or `all`; `olderThan` a duration such as "2h"; `idle` keeps only servers with no
 *   page open. A run name matches only a process of repository `repo`, or of any repository when it is null or absent,
 *   since run names such as `rate-limiter` repeat across repositories.
 */

/**
 * What `selector` stops in `list`: the processes it names that pass its filters, each with its children. Throws,
 * choosing nothing, on a target that names no listed process.
 */
export function selectProcs(list, selector, now = Date.now()) {
  const { targets } = selector;
  const repo = selector.repo ?? null;
  if (targets.length === 0)
    throw new UserError('name what to stop: a pid, a run name, or all; `mr-cast ps` lists them');
  const ofRun = (p, t) => p.run === t && (repo === null || p.repo === repo);
  const unknown = targets.filter((t) => t !== 'all' && !list.some((p) => String(p.pid) === t || ofRun(p, t)));
  if (unknown.length) {
    const why = (t) =>
      /^\d+$/.test(t)
        ? `pid ${t} is not a running mr-cast process of yours`
        : repo === null
          ? `no running mr-cast process has run "${t}"`
          : `no running mr-cast process of this repository has run "${t}"${list.some((p) => p.run === t) ? ' (--any-repo stops it in other repositories)' : ''}`;
    throw new UserError(`not stopping anything: ${unknown.map(why).join('; ')}; \`mr-cast ps\` lists them`);
  }
  const olderThanMs = selector.olderThan === null ? null : parseDuration(selector.olderThan, '--older-than');
  const named = (p) => targets.includes('all') || targets.includes(String(p.pid)) || targets.some((t) => ofRun(p, t));
  const fits = (p) => (olderThanMs === null || now - p.startedAt >= olderThanMs) && (!selector.idle || p.viewers === 0);
  const picked = new Set(list.filter((p) => named(p) && fits(p)).map((p) => p.pid));
  return list.filter((p) => picked.has(p.pid) || (p.parent !== null && picked.has(p.parent)));
}

/**
 * The pid targets that name no process at all any more: they exited since a listing or menu showed them, so `stop`
 * skips them rather than refusing the rest. A pid that runs something other than a listed mr-cast is not among them.
 */
export function exitedPids(list, targets, ps = processTable) {
  const unlisted = targets.filter((t) => /^\d+$/.test(t) && !list.some((p) => String(p.pid) === t));
  if (unlisted.length === 0) return [];
  const table = ps(unlisted.map(Number));
  return table ? unlisted.filter((t) => !table.has(Number(t))) : [];
}

const GRACE_MS = 5_000;
const POLL_MS = 100;

/**
 * Stops `procs`: SIGTERM, or `signal`, then SIGKILL for any still running after `graceMs`. Each signal goes only to a pid that `ps`
 * still shows as the same mr-cast process. Returns each process with its outcome: `stopped` after SIGTERM, `killed`
 * after SIGKILL, `gone` when it had exited already, or `failed` when it outlived both. Throws, signalling nothing, when
 * `ps` gives no answer before the first signal; a pid it cannot check later is not signalled again.
 * @returns {Promise<{ proc: Proc, outcome: 'stopped' | 'killed' | 'gone' | 'failed' }[]>}
 */
export async function stopProcesses(procs, { graceMs = GRACE_MS, ps = processTable, signal: first = 'SIGTERM' } = {}) {
  if (procs.length === 0) return [];
  const outcome = new Map();
  const alive = (table) => procs.filter((p) => !outcome.has(p.pid) && same(table?.get(p.pid), p));
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
      if (table) left = left.filter((p) => same(table.get(p.pid), p));
    }
    return left;
  };
  const before = ps(procs.map((p) => p.pid));
  if (!before)
    throw new UserError('could not run `ps` to check the processes before signalling them; nothing was stopped');
  const running = alive(before);
  for (const p of procs) if (!running.includes(p)) outcome.set(p.pid, 'gone');
  signal(running, first);
  const stubborn = await waitFor(running, graceMs);
  for (const p of running) if (!stubborn.includes(p)) outcome.set(p.pid, 'stopped');
  const again = ps(stubborn.map((p) => p.pid));
  const toKill = again ? alive(again) : [];
  for (const p of stubborn) if (!toKill.includes(p)) outcome.set(p.pid, again ? 'stopped' : 'failed');
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

/**
 * "1 open", "none · exits in 12m", "none · voicing" while a voicing holds off the idle exit, "none" with no idle exit,
 * "?" for an older mr-cast, and "" for what is not a server.
 */
function pageOf(p, now) {
  if (!SERVERS.has(p.kind)) return '';
  if (p.viewers === null) return '?';
  if (p.viewers > 0) return `${p.viewers} open`;
  if (!p.idleExit) return 'none';
  if (p.exitsAt === null) return 'none · voicing';
  return `none · exits in ${formatAge(Math.max(0, p.exitsAt - now) + 59_999)}`;
}

function whereOf(p) {
  if (p.parent !== null) return `with pid ${p.parent}`;
  const at = [p.run, home(p.repo)].filter(Boolean).join(' · ');
  return p.registered ? at : `unregistered${at ? ` · ${at}` : ''}`;
}

export function formatPs(list, now = Date.now()) {
  if (list.length === 0) return ['no mr-cast processes running'];
  const rows = list.map((p) => [
    String(p.pid),
    p.parent === null ? p.kind : `  ${p.kind}`,
    formatAge(now - p.startedAt),
    pageOf(p, now),
    p.url ?? '',
    whereOf(p),
  ]);
  const head = ['pid', 'kind', 'age', 'page', 'url', 'run'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) =>
    r
      .map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return [
    line(head),
    ...rows.map(line),
    '',
    'stop with `mr-cast stop <pid|run|all>`; --idle and --older-than 2h narrow it, --dry-run only prints',
  ];
}

export const procJson = (p) => ({
  pid: p.pid,
  ppid: p.ppid,
  kind: p.kind,
  registered: p.registered,
  parent: p.parent,
  startedAt: new Date(p.startedAt).toISOString(),
  url: p.url,
  repo: p.repo,
  run: p.run,
  dir: p.dir,
  version: p.version,
  viewers: p.viewers,
  idleSince: p.idleSince === null ? null : new Date(p.idleSince).toISOString(),
  idleExit: p.idleExit,
  exitsAt: p.exitsAt === null ? null : new Date(p.exitsAt).toISOString(),
});

const NOUNS = {
  play: 'player',
  plan: 'plan page',
  render: 'render',
  voice: 'voicing',
  download: 'voice model download',
};

/** "2 players and 1 render": the processes no other listed process owns. */
export function countLine(list) {
  const counts = new Map();
  for (const p of list.filter((q) => q.parent === null)) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => plural(n, NOUNS[kind]));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
}

const OLD = '2h';
const MAX_OPTIONS = 4;

const SHORT = {
  play: 'their pages stop working',
  plan: 'their pages stop working',
  render: 'a render writes no MP4',
  voice: 'the voicing stops',
  download: 'the download stops',
};

const CONSEQUENCE = {
  play: 'its page stops working; `mr-cast play` starts it again',
  plan: 'its page stops saving picks; `mr-cast plan` starts it again',
  render: 'the render stops and writes no MP4',
  voice: 'the voicing stops',
  download: 'the download stops and starts again on the next voice-over',
};

/**
 * The stop menu, shaped like prune's: one group with up to 4 options, each with the exact `command` that stops what its
 * description counts, `stop <pids>`, and those pids as `ids`. Only the processes listed now, not what `all` would
 * name when the user answers; and no children, which `stop` takes with their parent and which come and go with each
 * voicing. No group when nothing runs.
 */
export function stopChoices(list, now = Date.now()) {
  const tops = list.filter((p) => p.parent === null);
  if (tops.length === 0) return { groups: [] };
  const group = (label, selector, note) => {
    const chosen = selectProcs(list, selector, now);
    const top = chosen.filter((p) => p.parent === null);
    const consequences = [...new Set(top.map((p) => SHORT[p.kind]))].join(', and ');
    const ids = top.map((p) => String(p.pid));
    return { label, description: `${top.length} processes; ${note}; ${consequences}`, command: ['stop', ...ids], ids };
  };
  const all = { targets: ['all'], olderThan: null, idle: false };
  const options = [];
  if (tops.length > 1) options.push(group('Every running mr-cast process', all, 'everything `mr-cast ps` lists'));
  const idle = tops.filter((p) => p.viewers === 0).length;
  if (idle > 1 && idle < tops.length)
    options.push(group('Servers with no page open', { ...all, idle: true }, 'nobody is watching them'));
  const old = tops.filter((p) => now - p.startedAt >= parseDuration(OLD, OLD)).length;
  if (old > 1 && old < tops.length)
    options.push(group('Running for over 2 hours', { ...all, olderThan: OLD }, 'started more than 2 hours ago'));
  if (tops.length <= MAX_OPTIONS - options.length) {
    for (const p of tops) {
      const page = p.viewers === null ? null : p.viewers === 0 ? 'no page open' : plural(p.viewers, 'page') + ' open';
      const facts = [`pid ${p.pid}`, `up ${formatAge(now - p.startedAt)}`, page, !p.registered && 'unregistered']
        .filter(Boolean)
        .join(', ');
      const label = `${NOUNS[p.kind][0].toUpperCase()}${NOUNS[p.kind].slice(1)}${p.run ? ` of ${p.run}` : ''}${p.repo ? ` in ${path.basename(p.repo)}` : ''}`;
      options.push({
        label,
        description: `${facts}; ${CONSEQUENCE[p.kind]}`,
        command: ['stop', String(p.pid)],
        ids: [String(p.pid)],
      });
    }
  }
  return { groups: [{ name: 'Running processes', options }] };
}

export function formatStopChoices({ groups }) {
  if (groups.length === 0) return ['no mr-cast processes running'];
  return groups.flatMap((g) => [
    g.name,
    ...g.options.flatMap((o) => [`  ${o.label} · ${o.description}`, `    mr-cast ${o.command.join(' ')}`]),
  ]);
}
