// Checks for the layers scene, mirroring src/types.ts: its bands, their items, and the path a request
// takes through them. Pushes human/LLM-readable strings onto `errors` and `warnings`, like validate.mjs.

import { layerOf, layerRoute, stopKey, tokenSteps } from '../../shared/layers.mjs';
import { checkNodeFields } from './validate-diagram.mjs';
import { TONES } from './validate-scenes.mjs';

// More layers than this and each band gets too thin to read.
export const LAYERS_MAX = 7;
const ITEMS_MAX = 5;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

function checkPath(s, p, errors, warnings) {
  const path = s.path;
  if (!path || typeof path !== 'object' || Array.isArray(path))
    return errors.push(`${p}.path: must be { label?, stops, return?, reply?, skip? }`);
  for (const k of ['label', 'reply'])
    if (path[k] !== undefined && !isStr(path[k])) errors.push(`${p}.path.${k}: must be a non-empty string`);
  if (path.return !== undefined && typeof path.return !== 'boolean')
    errors.push(`${p}.path.return: must be true or false`);
  if (!Array.isArray(path.stops) || path.stops.length === 0)
    return errors.push(`${p}.path.stops: required non-empty array of layer or item ids, top to bottom`);
  const keys = [];
  path.stops.forEach((ref, j) => {
    const q = `${p}.path.stops[${j}]`;
    const key = stopKey(s, ref);
    if (!key)
      return errors.push(
        `${q}: ${JSON.stringify(ref)} names no layer or item; a stop is a layer id, an item id or "layer.item"`,
      );
    if (keys.includes(key))
      return errors.push(
        `${q}: ${JSON.stringify(ref)} is already a stop; list each stop once, and set return to come back up`,
      );
    const prev = keys[keys.length - 1];
    if (prev && layerOf(s, key) < layerOf(s, prev)) {
      errors.push(
        `${q}: ${JSON.stringify(ref)} sits above the stop before it; stops go down the stack in order, since the screen's order is the real order, and return brings the token back up`,
      );
    }
    keys.push(key);
  });
  if (path.reply !== undefined && path.return !== true)
    warnings.push(`${p}.path.reply: the token says it on its way back up, so set "return": true`);
  if (path.skip === undefined) return;
  const skip = path.skip;
  if (!skip || typeof skip !== 'object') return errors.push(`${p}.path.skip: must be { at, reply, tone? }`);
  if (!isStr(skip.reply))
    errors.push(
      `${p}.path.skip.reply: required string, what comes back from the stop that answers, e.g. "429 Too Many Requests"`,
    );
  if (skip.tone !== undefined && !TONES.includes(skip.tone))
    errors.push(`${p}.path.skip.tone: must be one of ${TONES.join(', ')}`);
  const at = keys.indexOf(stopKey(s, skip.at));
  if (at < 0)
    errors.push(
      `${p}.path.skip.at: ${JSON.stringify(skip.at)} is not one of the stops; name the stop that answers early`,
    );
  else if (at === keys.length - 1)
    errors.push(
      `${p}.path.skip.at: ${JSON.stringify(skip.at)} is the last stop, so nothing is skipped; list the stops it would have reached after it, or use return`,
    );
}

/** The token moves only as steps reach its stops, so a walk that never moves it, or never brings it back, is a slip. */
function checkWalk(s, p, warnings) {
  const { visits } = layerRoute(s);
  const { positions, stuck } = tokenSteps(s);
  for (const k of stuck)
    warnings.push(
      `${p}.steps[${k}]: focuses a stop the token has passed or never reaches, so it does not move there; the token only moves on along its path`,
    );
  const last = positions[positions.length - 1] ?? -1;
  if (last < 0)
    return warnings.push(
      `${p}.steps: no step focuses a path stop, so the token never moves; focus each stop in order, or leave the path off`,
    );
  const turn = visits.findIndex((v) => v.leg === 'up');
  const again = visits[turn - 1]?.stop === 0 ? ' again, after the step that brings the token to it' : '';
  if (turn >= 0 && last < turn)
    warnings.push(
      `${p}.steps: no step brings the token back up, so its reply never shows; end with a step that focuses the first stop${again}`,
    );
}

export function checkLayers(s, p, errors, warnings) {
  if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
  if (!Array.isArray(s.layers) || s.layers.length === 0)
    return errors.push(`${p}.layers: required non-empty array of { id, label, caption?, items? }, top to bottom`);
  const before = errors.length;
  const ids = new Map();
  const claim = (id, q) => {
    if (!isStr(id)) return errors.push(`${q}.id: required string`);
    if (ids.has(id))
      return errors.push(`${q}.id: "${id}" is also ${ids.get(id)}; every layer and item needs its own id`);
    ids.set(id, q);
  };
  s.layers.forEach((layer, j) => {
    const q = `${p}.layers[${j}]`;
    if (!layer || typeof layer !== 'object')
      return errors.push(`${q}: must be an object { id, label, caption?, items? }`);
    claim(layer.id, q);
    if (!isStr(layer.label)) errors.push(`${q}.label: required string`);
    if (layer.caption !== undefined && typeof layer.caption !== 'string') errors.push(`${q}.caption: must be a string`);
    if (layer.items === undefined) return;
    if (!Array.isArray(layer.items))
      return errors.push(`${q}.items: must be an array of { id, label, icon?, caption? }`);
    layer.items.forEach((item, k) => {
      const r = `${q}.items[${k}]`;
      if (!item || typeof item !== 'object')
        return errors.push(`${r}: must be an object { id, label, icon?, caption? }`);
      claim(item.id, r);
      checkNodeFields(item, r, errors, warnings);
    });
    if (layer.items.length > ITEMS_MAX)
      warnings.push(`${q}.items: ${layer.items.length} items; a band holds ${ITEMS_MAX} at a readable size`);
  });
  if (s.layers.length > LAYERS_MAX)
    warnings.push(`${p}.layers: ${s.layers.length} layers; more than ${LAYERS_MAX} get too thin to read`);
  if (errors.length > before) return;
  if (s.path !== undefined) checkPath(s, p, errors, warnings);
  if (errors.length === before && s.path !== undefined && Array.isArray(s.steps) && s.steps.length)
    checkWalk(s, p, warnings);
}
