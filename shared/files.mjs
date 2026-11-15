// The file list a files scene shows, shared by the validator (plain Node) and the player (TS).

import { lineRange } from './compare.mjs';
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
 * order written), with the files each holds and their + and - totals, and the `does`, `after` and `check` each names. Parts holding no file are left out; files that
 * name no part, or one the scene does not list, go under "Other files". Null when the scene has no parts.
 */
export function sceneParts(scene, files) {
  if (!Array.isArray(scene?.parts)) return null;
  const named = scene.parts.filter((p) => typeof p?.name === 'string' && PART_WEIGHTS.includes(p.weight));
  const known = new Set(named.map((p) => p.name));
  const groups = named.map((p) => ({
    name: p.name,
    weight: p.weight,
    ...(typeof p.does === 'string' && p.does.trim() ? { does: p.does.trim() } : {}),
    ...(Array.isArray(p.after) ? { after: p.after.filter((n) => typeof n === 'string') } : {}),
    ...(p.check === true ? { check: true } : {}),
    ...(typeof p.risk === 'string' && p.risk.trim()
      ? { risk: p.risk.trim(), riskMore: Number.isInteger(p.riskMore) && p.riskMore > 0 ? p.riskMore : 0 }
      : {}),
    files: files.filter((f) => f.part === p.name),
  }));
  const rest = files.filter((f) => !known.has(f.part));
  if (rest.length) groups.push({ name: OTHER_PART, weight: 'routine', files: rest });
  return PART_WEIGHTS.flatMap((weight) => groups.filter((g) => g.weight === weight && g.files.length)).map((g) => ({
    ...g,
    additions: g.files.reduce((n, f) => n + (f.additions ?? 0), 0),
    deletions: g.files.reduce((n, f) => n + (f.deletions ?? 0), 0),
  }));
}

/**
 * A files scene with `"parts": "brief"` read into plain `parts` and `files`: the parts of `storyboard.brief.parts`
 * with their `does` and `after`, `check: true` on a part that holds a file named in `brief.check`, and the files
 * their hunks change. A file sits under each part that holds one of its hunks, with that part's share of its
 * changed lines, so a file split across parts is listed more than once. Any other scene, or one with no brief to
 * read, comes back as it is.
 */
export function expandBriefParts(scene, storyboard, hunks) {
  const list = storyboard?.brief?.parts;
  if (scene?.type !== 'files' || scene.parts !== 'brief' || !Array.isArray(list)) return scene;
  const parts = [];
  const shares = [];
  for (const part of list) {
    if (
      typeof part?.name !== 'string' ||
      !PART_WEIGHTS.includes(part.weight) ||
      parts.some((p) => p.name === part.name)
    )
      continue;
    parts.push({
      name: part.name,
      weight: part.weight,
      ...(typeof part.does === 'string' && part.does.trim() ? { does: part.does.trim() } : {}),
      ...(Array.isArray(part.after) ? { after: part.after.filter((n) => typeof n === 'string') } : {}),
    });
    const mine = new Map();
    for (const id of new Set(Array.isArray(part.hunks) ? part.hunks : [])) {
      const h = hunks?.[id];
      if (!h || h.status === 'source') continue;
      const share = mine.get(h.file) ?? { additions: 0, deletions: 0, ids: [] };
      share.ids.push(id);
      share.additions += h.additions;
      share.deletions += h.deletions;
      mine.set(h.file, share);
    }
    shares.push([part.name, mine]);
  }
  const diff = new Map(diffFiles(hunks ?? {}).map((f) => [f.path, f]));
  const order = [...new Set(shares.flatMap(([, mine]) => [...mine.keys()]))];
  const files = order.flatMap((path) =>
    shares.flatMap(([part, mine]) =>
      mine.has(path)
        ? [{ path, part, change: diff.get(path).change, ...pick(mine.get(path), ['additions', 'deletions']) }]
        : [],
    ),
  );
  if (!files.length) return scene;
  const asked = Array.isArray(storyboard.brief.check) ? storyboard.brief.check : [];
  const marked = parts.map((p) => {
    const held = asked.filter((c) => checkPart(c, shares, hunks) === p.name);
    if (!held.length) return p;
    const what = typeof held[0].what === 'string' ? held[0].what.trim() : '';
    return { ...p, check: true, ...(what ? { risk: what, riskMore: held.length - 1 } : {}) };
  });
  return { ...scene, parts: marked, files };
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

/**
 * The part a `brief.check` item falls in: the one holding its file, or when the file's hunks are split across parts,
 * the one whose hunks cover its line (the first holding the file when none does). Null when no part holds the file.
 */
function checkPart(item, shares, hunks) {
  const holders = shares.filter(([, mine]) => mine.has(item?.file));
  if (holders.length < 2) return holders[0]?.[0] ?? null;
  const range = lineRange(item.line);
  const covers = ([, mine]) =>
    range !== null &&
    mine
      .get(item.file)
      .ids.some((id) =>
        (hunks[id]?.lines ?? []).some(
          (l) => typeof l.newLine === 'number' && l.newLine >= range[0] && l.newLine <= range[1],
        ),
      );
  return (holders.find(covers) ?? holders[0])[0];
}
