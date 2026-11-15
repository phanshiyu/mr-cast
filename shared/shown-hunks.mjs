// The hunks a scene puts on screen: the one a code scene shows, the lines a flow stop's `code` reads, a compare
// cell read from a hunk, and a tests scene's. `validate` counts coverage and the brief's checks from here, so
// every way a scene can show a hunk counts the same.

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
