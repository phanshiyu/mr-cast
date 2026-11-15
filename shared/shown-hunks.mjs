// The hunks a scene puts on screen: the one a code scene shows, the lines a flow stop's `code` reads, a compare
// cell read from a hunk, and a tests scene's. `validate` counts coverage and the brief's checks from here, so
// every way a scene can show a hunk counts the same. `shownHunkLines` goes down to the lines: the changed lines each
// scene draws, which `validate` and `outline` count per part of the brief.

import { hunkCellRows, isHunkCell } from './compare.mjs';
import { codeHunkId, codeRows } from './flow-code.mjs';

const list = (v) => (Array.isArray(v) ? v : []);

/** The hunk ids `scene` shows, in the order it shows them; each may repeat, and may name a hunk that does not exist. */
export function shownHunkIds(scene) {
  switch (scene?.type) {
    case 'code':
      return [scene.hunkId];
    case 'flow':
      return list(scene.steps).map((st) => st?.code?.hunk);
    case 'tests':
      return list(scene.tests).map((t) => t?.hunkId);
    case 'compare':
      return list(scene.rows).flatMap((row) => list(row?.cells).map((cell) => cell?.hunk));
    default:
      return [];
  }
}

/** The indexes into `hunk.lines` of its changed (added or removed) lines. */
const changedRows = (hunk) => list(hunk?.lines).flatMap((l, i) => (l?.type === 'context' ? [] : [i]));

/**
 * The changed lines of each hunk that some scene draws, as hunk id to a set of indexes into `hunk.lines`: a code
 * scene's lines that a frame has on screen (`codeLines` gives them by scene index, from the player's own layout; a
 * scene it leaves out counts all of its hunk's changed lines), the lines a flow step's `code` shows, and the lines a
 * compare cell reads from a hunk. A tests scene and a reading item name a hunk but draw none of its lines.
 */
export function shownHunkLines(scenes, hunks, codeLines = new Map()) {
  const out = new Map();
  const add = (id, rows) => {
    const hunk = hunks?.[id];
    if (!hunk) return;
    const changed = new Set(changedRows(hunk));
    const set = out.get(id) ?? new Set();
    for (const i of rows) if (changed.has(i)) set.add(i);
    if (set.size) out.set(id, set);
  };
  list(scenes).forEach((scene, i) => {
    if (scene?.type === 'code') add(scene.hunkId, codeLines.get(i) ?? changedRows(hunks?.[scene.hunkId]));
    if (scene?.type === 'flow')
      for (const st of list(scene.steps)) {
        const id = codeHunkId(st?.code);
        const hunk = id === undefined ? undefined : hunks?.[id];
        if (hunk)
          add(
            id,
            codeRows(hunk, st.code).rows.map((r) => r.index),
          );
      }
    if (scene?.type === 'compare')
      for (const row of list(scene.rows))
        for (const cell of list(row?.cells))
          if (isHunkCell(cell) && hunks?.[cell.hunk]) add(cell.hunk, hunkCellRows(cell, hunks[cell.hunk]));
  });
  return out;
}
