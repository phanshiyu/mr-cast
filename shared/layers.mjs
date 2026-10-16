// The way a layers scene's request token travels, shared by the scene (which moves it) and `validate`
// (which checks it). The route is the list of visits the token makes: down through the stops, and back
// up through them when the path returns or is answered early at `skip.at`.

import { resolveRef, stepTargets } from './targets.mjs';

const list = (v) => (Array.isArray(v) ? v : []);

/** The item key ("l:id" or "i:id") a path stop names, or null. */
export function stopKey(scene, ref) {
  const keys = typeof ref === 'string' ? resolveRef(scene, ref) : null;
  return keys?.length === 1 ? keys[0] : null;
}

/** Index of the layer an item key sits in, or -1. */
export function layerOf(scene, key) {
  const id = key.slice(2);
  return list(scene.layers).findIndex((l) => (key.startsWith('l:') ? l?.id === id : list(l?.items).some((it) => it?.id === id)));
}

/**
 * The token's visits in order, each a stop index, its item key and the leg ("down" or "up") it is on;
 * the stop it turns back at; and the keys of the stops it never reaches because a `skip` answered first.
 */
export function layerRoute(scene) {
  const path = scene?.path;
  const keys = list(path?.stops).map((ref) => stopKey(scene, ref));
  if (!keys.length) return { visits: [], turn: -1, skipped: [] };
  const at = path.skip ? keys.indexOf(stopKey(scene, path.skip.at)) : -1;
  const turn = at >= 0 ? at : keys.length - 1;
  const reached = keys.slice(0, turn + 1).map((key, stop) => ({ stop, key }));
  const back = at >= 0 || path.return === true ? [...reached].reverse().map((v) => ({ ...v, leg: 'up' })) : [];
  return { visits: [...reached.map((v) => ({ ...v, leg: 'down' })), ...back], turn, skipped: keys.slice(turn + 1).filter(Boolean) };
}

/**
 * Where the token is after each step, as an index into the route's visits (-1 before it has set out).
 * A step that focuses stops moves the token to the furthest of them, each at its first visit from where
 * the token is, so it never moves back along the route. `stuck` lists the steps that focus a stop the
 * token can no longer reach.
 */
export function tokenSteps(scene, hunks) {
  const { visits } = layerRoute(scene);
  const stopKeys = new Set(list(scene?.path?.stops).map((ref) => stopKey(scene, ref)));
  let pos = -1;
  const stuck = [];
  const positions = stepTargets(scene, hunks).map((keys, k) => {
    const stops = keys.filter((key) => stopKeys.has(key));
    const next = stops.map((key) => visits.findIndex((v, i) => i >= Math.max(pos, 0) && v.key === key));
    if (next.some((i) => i < 0)) stuck.push(k);
    pos = Math.max(pos, ...next);
    return pos;
  });
  return { positions, stuck };
}
