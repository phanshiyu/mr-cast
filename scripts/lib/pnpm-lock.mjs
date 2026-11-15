// Reads the parts of pnpm-lock.yaml that say which package versions an install holds, and works out which of them ship.
// The lock file is YAML, but only maps and plain or quoted keys matter here, so this reads just those, with no parser
// dependency. A flow value such as `{}` or `{integrity: ...}` is kept as text.

/** Dev dependencies whose output is in dist/: src/index.css imports tailwindcss, and Vite writes the CSS it builds. */
export const BUNDLED_DEV_DEPENDENCIES = ['tailwindcss'];

function splitKey(text) {
  if (text.startsWith("'")) {
    const end = text.indexOf("':", 1);
    if (end !== -1) return [text.slice(1, end), text.slice(end + 2).trim()];
  }
  const end = text.search(/:(\s|$)/);
  if (end === -1) return null;
  return [text.slice(0, end), text.slice(end + 1).trim()];
}

/** Turns the indented maps of a YAML document into nested objects; any other value stays a string. */
function parseYamlMaps(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#') || raw.trimStart().startsWith('- ')) continue;
    const indent = raw.length - raw.trimStart().length;
    const pair = splitKey(raw.trim());
    if (!pair) continue;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const [key, value] = pair;
    if (value === '' || value === '{}') {
      parent[key] = {};
      stack.push({ indent, node: parent[key] });
    } else {
      parent[key] = value;
    }
  }
  return root;
}

/** The lock file holds the install's own document last; pnpm's tool versions come first in a document of their own. */
export function parseLock(text) {
  const documents = text.split(/^---$/m);
  return parseYamlMaps(documents[documents.length - 1]);
}

function snapshotKey(name, version) {
  return /^\d/.test(version) || !version.includes('@') ? `${name}@${version}` : version;
}

function plain(key) {
  const peers = key.indexOf('(');
  return peers === -1 ? key : key.slice(0, peers);
}

/**
 * Every name@version that the packages named in `roots` need, found by walking the lock file's snapshots.
 * A root the importer does not list is skipped, so a root that left the lock file shows as removed.
 */
export function shippedVersions(lock, roots) {
  const importer = lock.importers?.['.'] ?? {};
  const direct = { ...importer.devDependencies, ...importer.dependencies };
  const snapshots = lock.snapshots ?? {};
  const seen = new Set();
  const found = new Set();
  const queue = [];
  for (const name of roots) {
    const entry = direct[name];
    if (entry?.version) queue.push(snapshotKey(name, entry.version));
  }
  while (queue.length) {
    const key = queue.pop();
    // Type declarations never run, so a peer such as @types/node does not make a release.
    if (key.startsWith('@types/')) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    found.add(plain(key));
    const snapshot = snapshots[key];
    if (!snapshot || typeof snapshot !== 'object') continue;
    for (const group of [snapshot.dependencies, snapshot.optionalDependencies]) {
      for (const [name, version] of Object.entries(group ?? {})) queue.push(snapshotKey(name, version));
    }
  }
  return found;
}

function byName(versions) {
  const names = new Map();
  for (const entry of versions) {
    const at = entry.lastIndexOf('@');
    const name = entry.slice(0, at);
    if (!names.has(name)) names.set(name, new Set());
    names.get(name).add(entry.slice(at + 1));
  }
  return names;
}

/** The packages whose versions differ between two sets, each with the versions it left and the versions it gained. */
export function changedPackages(before, after) {
  const was = byName(before);
  const now = byName(after);
  const changes = [];
  for (const name of [...new Set([...was.keys(), ...now.keys()])].sort()) {
    const from = [...(was.get(name) ?? [])].filter((v) => !now.get(name)?.has(v)).sort();
    const to = [...(now.get(name) ?? [])].filter((v) => !was.get(name)?.has(v)).sort();
    if (from.length || to.length) changes.push({ name, from, to });
  }
  return changes;
}
