// What `mr-cast prune` can delete, and deleting it. An artifact is one deletable thing:
//
//   run:<name>                            a whole walkthrough in .mr-cast/<name>, of a branch or an explanation
//   run:.  explain:<name>                 a walkthrough mr-cast 0.11 left in .mr-cast/ or .mr-cast/explain/<name>
//   video:<run>/<file>.mp4                a rendered video          (<run> is <name>, . or explain/<name>)
//   stills:<run>  audio:<run>             PNG stills, voice-over clips; render and voice regenerate them
//   cache:bundle  cache:remotion  cache:models   the shared cache in ~/.cache/mr-cast
//
// Ids name places, not contents, so the same id means the same thing across listings. Deletion takes
// artifacts only from a fresh listing, picked by `select`, so nothing outside .mr-cast/ and the cache can be named.

import fs from 'node:fs';
import path from 'node:path';
import { cacheDir, cacheRoot } from './cache.mjs';
import { UserError } from './errors.mjs';
import { liveHolder, usersOf, withLock } from './lock.mjs';
import { CURRENT_FILE, clearCurrent, isExplanationName, isRunName, readCurrent, readRunMeta } from './runs.mjs';
import { plural } from './summary.mjs';

/**
 * @typedef {'run' | 'explain' | 'video' | 'stills' | 'audio' | 'cache'} Kind
 * @typedef {{
 *   id: string, kind: Kind, parent: string | null, path: string, bytes: number, modified: number,
 *   label: string, detail: string, busy: string | null, remove: string[], lock: string | null,
 * }} Artifact  `remove` is what deleting it removes; `lock` is a lock file to hold meanwhile.
 * @typedef {{
 *   ids: string[], kinds: Kind[] | null, all: boolean, except: string[], olderThanDays: number | null,
 * }} Selector  Picks ids, every artifact of `kinds`, or `all`, then drops `except` and anything newer than `olderThanDays`.
 */

export const KINDS = /** @type {Kind[]} */ (['run', 'explain', 'video', 'stills', 'audio', 'cache']);
const DAY_MS = 24 * 60 * 60 * 1000;

const CACHES = [
  { name: 'bundle', label: 'Player bundle', detail: 'player bundle; the next render rebuilds it in a few seconds', lock: false },
  { name: 'remotion', label: 'Chrome cache', detail: 'Chrome Headless Shell; the next render downloads it again', lock: true },
  { name: 'models', label: 'Voice model', detail: 'Kokoro voice model; the next voice-over downloads it again (about 90 MB)', lock: true },
];

/** Total size and newest mtime under `p`, without following symlinks. */
function measure(p) {
  let stat;
  try { stat = fs.lstatSync(p); } catch { return { bytes: 0, modified: 0 }; }
  let bytes = stat.isDirectory() ? 0 : stat.size;
  let modified = stat.mtimeMs;
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(p)) {
      const inner = measure(path.join(p, name));
      bytes += inner.bytes;
      modified = Math.max(modified, inner.modified);
    }
  }
  return { bytes, modified };
}

function artifact({ id, kind, parent = null, at, remove, label, detail, busy = null, lock = null }) {
  const sizes = remove.map(measure);
  return {
    id, kind, parent, path: at, label, detail, busy, remove, lock,
    bytes: sizes.reduce((n, s) => n + s.bytes, 0),
    modified: Math.max(0, ...sizes.map((s) => s.modified)),
  };
}

/** A non-empty string field of a JSON file, or null. */
const readField = (file, field) => {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))[field];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
};

const entries = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
};

const count = (dir) => entries(dir).filter((e) => e.isFile()).length;

/** The videos, stills and voice-over inside one run directory. */
function runParts(dir, key, parent, label) {
  const videos = entries(dir).filter((e) => e.isFile() && e.name.endsWith('.mp4'));
  const parts = videos.map((e) => artifact({
    id: `video:${key}/${e.name}`, kind: 'video', parent, at: path.join(dir, e.name), remove: [path.join(dir, e.name)],
    label: `Video of ${label}${videos.length > 1 ? ` (${e.name})` : ''}`, detail: `video of ${label}`,
  }));
  const stills = path.join(dir, 'stills');
  if (fs.existsSync(stills)) {
    parts.push(artifact({ id: `stills:${key}`, kind: 'stills', parent, at: stills, remove: [stills], label: `Stills of ${label}`, detail: `${plural(count(stills), 'still')} of ${label}` }));
  }
  const audio = path.join(dir, 'audio');
  if (fs.existsSync(audio)) {
    // voiceover.json lists the clips; without them it would claim the narration is voiced.
    parts.push(artifact({ id: `audio:${key}`, kind: 'audio', parent, at: audio, remove: [audio, path.join(dir, 'voiceover.json')], label: `Voice clips of ${label}`, detail: `${plural(count(audio), 'voice clip')} of ${label}` }));
  }
  return parts;
}

function walkthrough({ id, kind, dir, key, remove, noun }) {
  const meta = path.join(dir, 'meta.json');
  const title = readField(path.join(dir, 'storyboard.json'), 'title') ?? readField(meta, 'title');
  const branch = readField(meta, 'branch');
  const label = title ? `"${title}"` : `${noun} ${key}`;
  const detail = `${noun} ${title ? label : '(no storyboard yet)'}${branch ? ` · branch ${branch}` : ''}`;
  return [
    artifact({ id, kind, at: dir, remove, label, detail }),
    ...runParts(dir, key, id, label),
  ];
}

/** Every run in `dataRoot` (a .mr-cast directory), each followed by its parts. */
function listRuns(dataRoot) {
  const all = entries(dataRoot);
  const named = all.filter((e) => e.isDirectory() && isRunName(e.name));
  const own = all.filter((e) => !(e.isDirectory() && (isRunName(e.name) || e.name === 'explain')) && !e.name.startsWith(CURRENT_FILE));
  const runs = [];
  if (own.length) {
    runs.push(...walkthrough({ id: 'run:.', kind: 'run', dir: dataRoot, key: '.', remove: own.map((e) => path.join(dataRoot, e.name)), noun: 'diff walkthrough' }));
  }
  for (const { name } of named) {
    const dir = path.join(dataRoot, name);
    const explanation = readRunMeta(dir)?.mode === 'explain';
    runs.push(...walkthrough({ id: `run:${name}`, kind: explanation ? 'explain' : 'run', dir, key: name, remove: [dir], noun: explanation ? 'explanation' : 'diff walkthrough' }));
  }
  const explainRoot = path.join(dataRoot, 'explain');
  for (const { name } of entries(explainRoot).filter((e) => e.isDirectory() && isExplanationName(e.name))) {
    const dir = path.join(explainRoot, name);
    runs.push(...walkthrough({ id: `explain:${name}`, kind: 'explain', dir, key: `explain/${name}`, remove: [dir], noun: 'explanation' }));
  }
  return runs;
}

/** Why a cache directory must not be deleted now, or null. */
function cacheBusy(dir, lock) {
  const holder = lock ? liveHolder(`${dir}.lock`) : null;
  if (holder) return `mr-cast pid ${holder} is downloading into it`;
  const users = usersOf(dir);
  return users.length ? `a render (pid ${users.join(', ')}) is using it` : null;
}

function listCache() {
  return CACHES
    .map((c) => ({ ...c, dir: cacheDir(c.name) }))
    .filter(({ dir }) => fs.existsSync(dir))
    .map(({ dir, name, label, detail, lock }) => artifact({
      id: `cache:${name}`, kind: 'cache', at: dir, remove: [dir], label, detail,
      busy: cacheBusy(dir, lock), lock: lock ? `${dir}.lock` : null,
    }));
}

/** Everything prune can delete under `dataRoot` and in the cache: each run followed by its parts, then the cache. */
export const listArtifacts = (dataRoot) => [...listRuns(dataRoot), ...listCache()];

/** The artifacts with nothing inside modified in the last `days` days; all of them when `days` is null. */
export const olderThan = (listing, days, now = Date.now()) => (days === null ? listing : listing.filter((a) => a.modified < now - days * DAY_MS));

const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Throws unless every path `a` removes lies strictly inside `dataRoot` or the cache. */
function assertContained(a, dataRoot) {
  for (const p of a.remove) {
    if (!inside(p, dataRoot) && !inside(p, cacheRoot())) {
      throw new Error(`refusing to delete ${p} for ${a.id}: outside ${dataRoot} and ${cacheRoot()}`);
    }
  }
}

/**
 * What `selector` picks from `listing` (a whole, unfiltered listing): `chosen` to delete and `inUse`, the busy
 * artifacts it matched, which are never chosen. Excepting an artifact keeps its parts and the walkthrough
 * holding it. Throws, choosing nothing, on an unknown id, a busy id named outright, or an unknown --except.
 */
export function select(listing, selector, { now = Date.now(), listCommand = 'mr-cast prune' } = {}) {
  const pool = olderThan(listing, selector.olderThanDays, now);
  const inPool = new Set(pool.map((a) => a.id));
  const unknown = [...new Set(selector.ids)].filter((id) => !inPool.has(id));
  if (unknown.length) throw new UserError(`unknown id${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}; run \`${listCommand}\` to list what can be pruned`);
  const except = new Set(selector.except);
  const unknownExcept = [...except].filter((id) => !listing.some((a) => a.id === id));
  if (unknownExcept.length) throw new UserError(`unknown --except id${unknownExcept.length === 1 ? '' : 's'}: ${unknownExcept.join(', ')}; run \`mr-cast prune\` to list the ids`);
  const named = new Set(selector.ids);
  const busyNamed = pool.filter((a) => named.has(a.id) && a.busy);
  if (busyNamed.length) throw new UserError(`not pruning anything: ${busyNamed.map((a) => `${a.id} is in use, ${a.busy}`).join('; ')}`);
  const kept = (a) => except.has(a.id) || except.has(a.parent) || listing.some((b) => b.parent === a.id && except.has(b.id));
  const picked = pool.filter((a) => (selector.all || named.has(a.id) || selector.kinds?.includes(a.kind)) && !kept(a));
  return { chosen: picked.filter((a) => !a.busy), inUse: picked.filter((a) => a.busy) };
}

/**
 * What deleting `chosen` removes, in order: each artifact with its bytes, or with `with` naming the chosen
 * artifact that contains it, whose bytes already count it.
 */
export function removalPlan(chosen) {
  const container = (a) => chosen.find((b) => b !== a && a.remove.every((p) => b.remove.some((q) => q === p || inside(p, q))));
  return chosen.map((artifact) => {
    const outer = container(artifact);
    return outer ? { artifact, bytes: 0, with: outer.id } : { artifact, bytes: artifact.bytes, with: null };
  });
}

/**
 * Deletes `chosen` (from select). A part inside another chosen artifact goes with it. Removing the
 * current run clears .current, so a later command asks which run instead of guessing.
 * Returns { removed: [{ artifact, bytes, with }], skipped: [{ artifact, reason }] }: `with` names the
 * artifact that took a part along, and `skipped` holds cache directories a render started using since listing.
 */
export async function pruneArtifacts(chosen, dataRoot) {
  for (const a of chosen) assertContained(a, dataRoot);
  const removed = [];
  const skipped = [];
  for (const step of removalPlan(chosen)) {
    const a = step.artifact;
    if (step.with) {
      removed.push(step);
      continue;
    }
    const remove = () => {
      const busy = a.kind === 'cache' ? cacheBusy(a.path, false) : null;
      if (busy) return skipped.push({ artifact: a, reason: busy });
      for (const p of a.remove) fs.rmSync(p, { recursive: true, force: true });
      removed.push({ artifact: a, bytes: a.bytes, with: null });
    };
    if (a.lock) await withLock(a.lock, remove);
    else remove();
  }
  const current = readCurrent(dataRoot);
  if (current && removed.some(({ artifact }) => artifact.id === `run:${current}`)) clearCurrent(dataRoot);
  return { removed, skipped };
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit++;
  }
  return `${unit === 0 || n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[unit]}`;
}

export function formatAge(modified, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - modified) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

const listed = (listing) => new Set(listing.map((a) => a.id));

/** Bytes deletable now, counting a listed run's parts once (they are inside it) and skipping busy artifacts. */
export function reclaimable(listing) {
  const ids = listed(listing);
  return listing.filter((a) => !ids.has(a.parent) && !a.busy).reduce((n, a) => n + a.bytes, 0);
}

export function formatListing(listing, { now = Date.now() } = {}) {
  if (listing.length === 0) return ['nothing to prune'];
  const ids = listed(listing);
  const rows = listing.map((a) => [
    ids.has(a.parent) ? `  ${a.id}` : a.id,
    formatBytes(a.bytes),
    formatAge(a.modified, now),
    a.busy ? `${a.detail} · in use: ${a.busy}` : a.detail,
  ]);
  const head = ['id', 'size', 'age', 'what'];
  const widths = [0, 1, 2].map((i) => Math.max(head[i].length, ...rows.map((r) => r[i].length)));
  const line = (r) => [r[0].padEnd(widths[0]), r[1].padStart(widths[1]), r[2].padStart(widths[2]), r[3]].join('  ');
  return [line(head), ...rows.map(line), '', `reclaimable: ${formatBytes(reclaimable(listing))} · prune with \`mr-cast prune <id>...\``];
}

export const listingJson = (listing, dataRoot) => ({
  dataDir: dataRoot,
  cacheDir: cacheRoot(),
  reclaimableBytes: reclaimable(listing),
  artifacts: listing.map((a) => ({
    id: a.id, kind: a.kind, parent: a.parent, path: a.path, bytes: a.bytes,
    modified: new Date(a.modified).toISOString(), detail: a.detail, busy: a.busy,
  })),
});

/** The CLI arguments that make `select` pick what `selector` picks. */
export const pruneCommand = (selector) => [
  'prune', ...selector.ids,
  ...(selector.kinds ? ['--kind', selector.kinds.join(',')] : []),
  ...(selector.all ? ['--all'] : []),
  ...(selector.olderThanDays === null ? [] : ['--older-than', String(selector.olderThanDays)]),
  ...selector.except.flatMap((id) => ['--except', id]),
];

const OLD_DAYS = 30;
const MAX_OPTIONS = 4;

/** The menu groups, as the prune skill shows them. `aged` groups offer "not changed in 30 days". */
const GROUPS = [
  { name: 'Rendered videos', kinds: ['video'], all: 'All rendered videos', aged: 'Videos not changed in 30 days', consequence: 'the walkthrough stays, so render makes the video again' },
  { name: 'Stills and voice clips', kinds: ['stills', 'audio'], all: 'All stills and voice clips', aged: 'Stills and voice clips not changed in 30 days', consequence: 'still and voice make them again; voice clips take a few seconds per scene to speak again' },
  { name: 'Walkthroughs', kinds: ['run', 'explain'], all: 'All walkthroughs', aged: 'Walkthroughs not changed in 30 days', consequence: 'deletes the storyboard and everything inside' },
  { name: 'Cache', kinds: ['cache'], all: 'All cached downloads', aged: null, consequence: null },
];

const selectorOf = (fields) => ({ ids: [], kinds: null, all: false, except: [], olderThanDays: null, ...fields });

/**
 * The prune menu for `listing`: per group with something deletable, up to 4 options, each with the exact
 * `command` that deletes what its description counts. Busy artifacts appear only in `inUse`.
 */
export function pruneChoices(listing, now = Date.now()) {
  const option = (label, selector, note) => {
    const { chosen } = select(listing, selector, { now });
    const bytes = removalPlan(chosen).reduce((n, r) => n + r.bytes, 0);
    const size = chosen.length > 1 ? `${formatBytes(bytes)} in ${plural(chosen.length, 'item')}` : formatBytes(bytes);
    return { label, description: `${size}; ${note}`, command: pruneCommand(selector), ids: chosen.map((a) => a.id), bytes };
  };
  const groups = GROUPS.flatMap((g) => {
    const items = listing.filter((a) => g.kinds.includes(a.kind) && !a.busy);
    if (items.length === 0) return [];
    const options = [];
    if (items.length > 1) options.push(option(g.all, selectorOf({ kinds: g.kinds }), g.consequence ?? 'each is downloaded or rebuilt again when next needed'));
    const old = olderThan(items, OLD_DAYS, now).length;
    if (g.aged && old > 0 && old < items.length) options.push(option(g.aged, selectorOf({ kinds: g.kinds, olderThanDays: OLD_DAYS }), g.consequence));
    if (items.length <= MAX_OPTIONS - options.length) {
      for (const a of items) {
        const age = a.kind === 'cache' ? `downloaded ${formatAge(a.modified, now)} ago` : `changed ${formatAge(a.modified, now)} ago`;
        options.push(option(a.label, selectorOf({ ids: [a.id] }), `${age}; ${g.consequence ?? a.detail}`));
      }
    }
    return [{ name: g.name, options }];
  });
  return { groups, inUse: listing.filter((a) => a.busy).map((a) => ({ id: a.id, label: a.label, busy: a.busy })) };
}

export function formatChoices({ groups, inUse }) {
  if (groups.length === 0 && inUse.length === 0) return ['nothing to prune'];
  return [
    ...groups.flatMap((g) => [g.name, ...g.options.flatMap((o) => [`  ${o.label} · ${o.description}`, `    mr-cast ${o.command.join(' ')}`])]),
    ...inUse.map((a) => `in use, not offered: ${a.id} · ${a.busy}`),
  ];
}
