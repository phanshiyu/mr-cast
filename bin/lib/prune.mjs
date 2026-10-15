// What `mr-cast prune` can delete, and deleting it. An artifact is one deletable thing:
//
//   run:.  run:<name>  explain:<name>    a whole walkthrough (the default run is .mr-cast/'s own files)
//   video:<run>/<file>.mp4                a rendered video          (<run> is ., <name> or explain/<name>)
//   stills:<run>  audio:<run>             PNG stills, voice-over clips; render and voice regenerate them
//   cache:bundle  cache:remotion  cache:models   the shared cache in ~/.cache/mr-cast
//
// Ids name places, not contents, so the same id means the same thing across listings. Deletion takes ids
// only from a fresh listing, so nothing outside .mr-cast/ and the cache can be named.

import fs from 'node:fs';
import path from 'node:path';
import { cacheDir, cacheRoot } from './cache.mjs';
import { UserError } from './errors.mjs';
import { liveHolder, usersOf, withLock } from './lock.mjs';
import { clearCurrent, isExplanationName, isRunName, readCurrent } from './runs.mjs';
import { plural } from './summary.mjs';

/**
 * @typedef {'run' | 'explain' | 'video' | 'stills' | 'audio' | 'cache'} Kind
 * @typedef {{
 *   id: string, kind: Kind, parent: string | null, path: string, bytes: number, modified: number,
 *   detail: string, busy: string | null, remove: string[], lock: string | null,
 * }} Artifact  `remove` is what deleting it removes; `lock` is a lock file to hold meanwhile.
 */

const CACHES = [
  { name: 'bundle', detail: 'player bundle; the next render rebuilds it in a few seconds', lock: false },
  { name: 'remotion', detail: 'Chrome Headless Shell; the next render downloads it again', lock: true },
  { name: 'models', detail: 'Kokoro voice model; the next voice-over downloads it again (about 90 MB)', lock: true },
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

function artifact({ id, kind, parent = null, at, remove, detail, busy = null, lock = null }) {
  const sizes = remove.map(measure);
  return {
    id, kind, parent, path: at, detail, busy, remove, lock,
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
  const parts = entries(dir)
    .filter((e) => e.isFile() && e.name.endsWith('.mp4'))
    .map((e) => artifact({ id: `video:${key}/${e.name}`, kind: 'video', parent, at: path.join(dir, e.name), remove: [path.join(dir, e.name)], detail: `video of ${label}` }));
  const stills = path.join(dir, 'stills');
  if (fs.existsSync(stills)) {
    parts.push(artifact({ id: `stills:${key}`, kind: 'stills', parent, at: stills, remove: [stills], detail: `${plural(count(stills), 'still')} of ${label}` }));
  }
  const audio = path.join(dir, 'audio');
  if (fs.existsSync(audio)) {
    // voiceover.json lists the clips; without them it would claim the narration is voiced.
    parts.push(artifact({ id: `audio:${key}`, kind: 'audio', parent, at: audio, remove: [audio, path.join(dir, 'voiceover.json')], detail: `${plural(count(audio), 'voice clip')} of ${label}` }));
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
    artifact({ id, kind, at: dir, remove, detail }),
    ...runParts(dir, key, id, label),
  ];
}

/** Every run in `dataRoot` (a .mr-cast directory), each followed by its parts. */
function listRuns(dataRoot) {
  const all = entries(dataRoot);
  const named = all.filter((e) => e.isDirectory() && isRunName(e.name));
  const own = all.filter((e) => !(e.isDirectory() && (isRunName(e.name) || e.name === 'explain')));
  const runs = [];
  if (own.length) {
    runs.push(...walkthrough({ id: 'run:.', kind: 'run', dir: dataRoot, key: '.', remove: own.map((e) => path.join(dataRoot, e.name)), noun: 'diff walkthrough' }));
  }
  for (const { name } of named) {
    const dir = path.join(dataRoot, name);
    runs.push(...walkthrough({ id: `run:${name}`, kind: 'run', dir, key: name, remove: [dir], noun: 'diff walkthrough' }));
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
    .map(({ name, detail, lock }) => ({ dir: cacheDir(name), name, detail, lock }))
    .filter(({ dir }) => fs.existsSync(dir))
    .map(({ dir, name, detail, lock }) => artifact({
      id: `cache:${name}`, kind: 'cache', at: dir, remove: [dir], detail,
      busy: cacheBusy(dir, lock), lock: lock ? `${dir}.lock` : null,
    }));
}

/**
 * Everything prune can delete under `dataRoot` and in the cache: each run followed by its parts, then the
 * cache. `olderThanDays` keeps only artifacts with nothing inside modified more recently than that.
 */
export function listArtifacts({ dataRoot, olderThanDays = null, now = Date.now() }) {
  const all = [...listRuns(dataRoot), ...listCache()];
  if (olderThanDays === null) return all;
  const cutoff = now - olderThanDays * 24 * 60 * 60 * 1000;
  return all.filter((a) => a.modified < cutoff);
}

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

/** The artifacts `ids` name in `listing`; throws, deleting nothing, on an unknown or busy id. */
export function resolveIds(listing, ids, listCommand = 'mr-cast prune') {
  const byId = new Map(listing.map((a) => [a.id, a]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) throw new UserError(`unknown id${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}; run \`${listCommand}\` to list what can be pruned`);
  const chosen = [...new Set(ids)].map((id) => byId.get(id));
  const busy = chosen.filter((a) => a.busy);
  if (busy.length) throw new UserError(`not pruning anything: ${busy.map((a) => `${a.id} is in use, ${a.busy}`).join('; ')}`);
  return chosen;
}

/**
 * Deletes `chosen` (from resolveIds). A part inside another chosen artifact goes with it. Removing the
 * current explanation clears .current, so a later `explain` command asks which one instead of guessing.
 * Returns { removed: [{ artifact, bytes, with }], skipped: [{ artifact, reason }] }: `with` names the
 * artifact that took a part along, and `skipped` holds cache directories a render started using since listing.
 */
export async function pruneArtifacts(chosen, dataRoot) {
  for (const a of chosen) assertContained(a, dataRoot);
  const container = (a) => chosen.find((b) => b !== a && a.remove.every((p) => b.remove.some((q) => q === p || inside(p, q))));
  const removed = [];
  const skipped = [];
  for (const a of chosen) {
    const outer = container(a);
    if (outer) {
      removed.push({ artifact: a, bytes: 0, with: outer.id });
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
  const explainRoot = path.join(dataRoot, 'explain');
  const current = readCurrent(explainRoot);
  if (current && removed.some(({ artifact }) => artifact.id === `explain:${current}`)) clearCurrent(explainRoot);
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
