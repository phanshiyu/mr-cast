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
        return { path: f.path, change: f.change ?? known?.change, additions: f.additions ?? known?.additions, deletions: f.deletions ?? known?.deletions };
      })
    : diff;
  return entries.map((f) => ({ ...f, test: isTestFile(f.path) }));
}
