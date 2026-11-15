// The file list a files scene shows, shared by the validator (plain Node) and the player (TS).

import { isTestFile } from './test-files.mjs';

/** hunks.json status to the scene's change marking. */
const STATUS_CHANGE = { added: 'added', deleted: 'removed', modified: 'modified', renamed: 'modified' };

/** Changed files in hunks.json, in diff order, with summed line counts. Source snippets are not changes. */
export function diffFiles(hunks) {
  const byPath = new Map();
  for (const h of Object.values(hunks)) {
    if (h.status === 'source') continue;
    const file = byPath.get(h.file) ?? { path: h.file, change: STATUS_CHANGE[h.status], additions: 0, deletions: 0 };
    file.additions += h.additions;
    file.deletions += h.deletions;
    byPath.set(h.file, file);
  }
  return [...byPath.values()];
}

/**
 * The scene's files: its own `files`, with change and line counts filled in from the diff where it
 * leaves them out, or else every changed file in hunks.json. Each is marked when it is a test.
 */
export function sceneFiles(scene, hunks) {
  const diff = diffFiles(hunks);
  const entries = Array.isArray(scene.files)
    ? scene.files.map((f) => {
        const known = diff.find((d) => d.path === f.path);
        return {
          path: f.path,
          change: f.change ?? known?.change,
          additions: f.additions ?? known?.additions,
          deletions: f.deletions ?? known?.deletions,
          badge: f.badge,
          tone: f.tone,
          part: f.part,
        };
      })
    : diff;
  return entries.map((f) => ({ ...f, test: isTestFile(f.path) }));
}

/** How much a part matters, in the order they draw: the change itself first, what may be skimmed last. */
export const PART_WEIGHTS = ['core', 'support', 'routine'];

/** The group that holds files naming no part, when a scene has parts. It draws last and quietest. */
const OTHER_PART = 'Other files';

/**
 * The parts a files scene groups its files under, in drawing order (core, then support, then routine, each in the
 * order written), with the files each holds and their + and - totals. Parts holding no file are left out; files that
 * name no part, or one the scene does not list, go under "Other files". Null when the scene has no parts.
 */
export function sceneParts(scene, files) {
  if (!Array.isArray(scene?.parts)) return null;
  const named = scene.parts.filter((p) => typeof p?.name === 'string' && PART_WEIGHTS.includes(p.weight));
  const known = new Set(named.map((p) => p.name));
  const groups = named.map((p) => ({ name: p.name, weight: p.weight, files: files.filter((f) => f.part === p.name) }));
  const rest = files.filter((f) => !known.has(f.part));
  if (rest.length) groups.push({ name: OTHER_PART, weight: 'routine', files: rest });
  return PART_WEIGHTS.flatMap((weight) => groups.filter((g) => g.weight === weight && g.files.length)).map((g) => ({
    ...g,
    additions: g.files.reduce((n, f) => n + (f.additions ?? 0), 0),
    deletions: g.files.reduce((n, f) => n + (f.deletions ?? 0), 0),
  }));
}

/**
 * A files scene with `"parts": "brief"` read into plain `parts` and `files`: the parts of `storyboard.brief.parts`,
 * and the files their hunks change, each under the part that holds most of its changed lines (the first, on a tie)
 * with the file's whole line counts. Any other scene, or one with no brief to read, comes back as it is.
 */
export function expandBriefParts(scene, storyboard, hunks) {
  const list = storyboard?.brief?.parts;
  if (scene?.type !== 'files' || scene.parts !== 'brief' || !Array.isArray(list)) return scene;
  const parts = [];
  const lines = new Map();
  for (const part of list) {
    if (
      typeof part?.name !== 'string' ||
      !PART_WEIGHTS.includes(part.weight) ||
      parts.some((p) => p.name === part.name)
    )
      continue;
    parts.push({ name: part.name, weight: part.weight });
    for (const id of Array.isArray(part.hunks) ? part.hunks : []) {
      const h = hunks?.[id];
      if (!h || h.status === 'source') continue;
      const mine = lines.get(h.file) ?? new Map();
      mine.set(part.name, (mine.get(part.name) ?? 0) + h.additions + h.deletions);
      lines.set(h.file, mine);
    }
  }
  const diff = new Map(diffFiles(hunks ?? {}).map((f) => [f.path, f]));
  const files = [...lines].map(([path, byPart]) => {
    const part = parts.find((p) => byPart.get(p.name) === Math.max(...byPart.values()));
    const { change, additions, deletions } = diff.get(path);
    return { path, part: part.name, change, additions, deletions };
  });
  return files.length ? { ...scene, parts, files } : scene;
}
