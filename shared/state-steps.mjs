// Scenes whose steps change what they show: `array` and `memory`. A scene's state at step k is its initial
// state with the changes of steps 0 to k applied in order; a step's changes land at its start. State keys
// are the item keys of shared/targets.mjs, so the item a step changes and the item it focuses share a name.
// Shared by the scenes (which draw each state) and `validate` (which reports every change that names nothing).

import { indexRange } from './steps.mjs';
import { memberKey, resolveRef, splitMemberKey } from './targets.mjs';
import { aType } from './words.mjs';

const list = (v) => (Array.isArray(v) ? v : []);
const entries = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v) : []);
const isText = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
/** A memory value that points at an object: `{ "ref": "c1" }`. */
export const isPointer = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && typeof v.ref === 'string';

/** Two values are the same when they read the same, or point at the same object. */
export const sameValue = (a, b) => (isPointer(a) || isPointer(b) ? isPointer(a) && isPointer(b) && a.ref === b.ref : String(a) === String(b));

/**
 * Per scene type: its initial state; the item kinds `set`, `show` and `hide` take, as key prefixes; how a
 * set value is checked; and how `move` places a pointer or a range, when the type has them.
 */
const MODELS = {
  array: {
    initial(scene) {
      const markers = [...list(scene.pointers).map((p) => [`ptr:${p?.name}`, [p?.at, p?.at], p?.hidden]), ...list(scene.ranges).map((r) => [`rg:${r?.name}`, [r?.from, r?.to], r?.hidden])];
      return {
        values: Object.fromEntries(list(scene.values).map((v, i) => [`c:${i}`, v])),
        places: Object.fromEntries(markers.map(([key, place]) => [key, place])),
        hidden: Object.fromEntries(markers.flatMap(([key, , hidden]) => (hidden === true ? [[key, true]] : []))),
      };
    },
    set: { prefixes: ['c:'], what: 'cell', help: (scene) => `a cell index from 0 to ${Math.max(0, list(scene.values).length - 1)}` },
    show: { prefixes: ['ptr:', 'rg:'], what: 'pointer or range', help: () => 'a pointer "ptr:name" or a range "range:name"' },
    checkValue: (value) => (isText(value) ? null : 'must be text or a number'),
    move(scene, name, value) {
      const n = list(scene.values).length;
      if (list(scene.pointers).some((p) => p?.name === name)) {
        const at = typeof value === 'string' && /^\s*-?\d+\s*$/.test(value) ? Number(value) : value;
        return Number.isInteger(at) && at >= -1 && at <= n ? { key: `ptr:${name}`, place: [at, at] } : { error: `a pointer moves to a cell index from 0 to ${n - 1}, or -1 or ${n} just past either end` };
      }
      if (list(scene.ranges).some((r) => r?.name === name)) {
        const r = indexRange(value);
        return r && r[1] < n ? { key: `rg:${name}`, place: r } : { error: `a range moves to "a-b", its first and last cell, from 0 to ${n - 1}` };
      }
      return null;
    },
    moveNames: (scene) => [...list(scene.pointers), ...list(scene.ranges)].map((m) => m?.name).filter((n) => typeof n === 'string'),
  },
  memory: {
    initial(scene) {
      const owners = [...list(scene.frames).map((f) => [`fr:${f?.name}`, 'v', f?.name, f?.vars, f?.hidden]), ...list(scene.objects).map((o) => [`o:${o?.id}`, 'f', o?.id, o?.fields, o?.hidden])];
      return {
        values: Object.fromEntries(owners.flatMap(([, kind, owner, record]) => entries(record).map(([name, value]) => [memberKey(kind, owner, name), value]))),
        places: {},
        hidden: Object.fromEntries(owners.flatMap(([key, , , , hidden]) => (hidden === true ? [[key, true]] : []))),
      };
    },
    set: { prefixes: ['v:', 'f:'], what: 'variable or field', help: () => 'a variable "frame.var" or a field "object.field"' },
    show: { prefixes: ['fr:', 'o:'], what: 'frame or object', help: () => 'a frame "frame:name" or an object id' },
    checkValue(value, scene) {
      if (isText(value)) return null;
      if (!isPointer(value) || Object.keys(value).length !== 1) return 'must be text, a number, or { "ref": "<object id>" }';
      const ids = list(scene.objects).map((o) => o?.id);
      return ids.includes(value.ref) ? null : `points at "${value.ref}", which is no object; objects are ${ids.map((id) => JSON.stringify(id)).join(', ')}`;
    },
    move: null,
    moveNames: () => [],
  },
};

/** Scene types whose steps change state. */
export const STATE_TYPES = Object.keys(MODELS);

/** The one item key `ref` names, when it is of a kind in `prefixes`. */
function oneKey(scene, ref, prefixes) {
  const keys = resolveRef(scene, ref);
  return keys?.length === 1 && prefixes.some((p) => keys[0].startsWith(p)) ? keys[0] : null;
}

const copy = (state) => ({ values: { ...state.values }, places: { ...state.places }, hidden: { ...state.hidden } });

/** Variables and fields shown in `state` that point at an object hidden in it, by key, ref and the object's id. */
function danglingPointers(state) {
  return Object.entries(state.values).flatMap(([key, value]) => {
    if (!isPointer(value)) return [];
    const { owner, ownerKey, name } = splitMemberKey(key);
    const shown = !state.hidden[ownerKey];
    return shown && state.hidden[`o:${value.ref}`] ? [{ key, ref: `${owner}.${name}`, target: value.ref }] : [];
  });
}

/**
 * Every state of a scene, and every change that names nothing. `states[0]` is shown during the narration
 * and `states[k + 1]` from step k's start. A problem has the step, the field (`set`, `move`, `show` or
 * `hide`), the ref as written, a message, the refs it could have named, and a level.
 * @returns {{ states: import('./state-steps').SceneState[], problems: import('./state-steps').StateProblem[] }}
 */
export function walkStates(scene) {
  const model = MODELS[scene?.type];
  if (!model) return { states: [], problems: [] };
  const problems = [];
  const reported = new Set();
  const checkPointers = (state, step) => {
    for (const { key, ref, target } of model === MODELS.memory ? danglingPointers(state) : []) {
      if (reported.has(`${key}>${target}`)) continue;
      reported.add(`${key}>${target}`);
      const when = step < 0 ? 'at the start' : 'from this step';
      problems.push({ step, field: step < 0 ? 'objects' : 'set', ref, level: 'error', names: [], message: `points at "${target}" ${when}, but "${target}" is hidden then; show it in this step or an earlier one, or start it shown` });
    }
  };
  let state = model.initial(scene);
  const states = [state];
  checkPointers(state, -1);
  list(scene.steps).forEach((step, k) => {
    const next = copy(state);
    const problem = (field, ref, message, names = [], level = 'error') => problems.push({ step: k, field, ref, message, names, level });
    const record = (field) => {
      const value = step?.[field];
      if (value === undefined) return [];
      if (value && typeof value === 'object' && !Array.isArray(value)) return Object.entries(value);
      problem(field, '', `must be an object of ${field === 'set' ? 'ref to new value' : 'name to new place'}`);
      return [];
    };
    const refsOf = (field) => {
      const value = step?.[field];
      if (value === undefined) return [];
      if (Array.isArray(value) && value.every((r) => typeof r === 'string')) return value;
      problem(field, '', `must be an array of refs: ${model.show.help(scene)}`);
      return [];
    };
    for (const [ref, value] of record('set')) {
      const key = oneKey(scene, ref, model.set.prefixes);
      if (!key) {
        problem('set', ref, `names no ${model.set.what}; a set key is ${model.set.help(scene)}`, setNames(scene, model));
        continue;
      }
      const bad = model.checkValue(value, scene);
      if (bad) problem('set', ref, bad);
      else if (sameValue(next.values[key], value)) problem('set', ref, `already holds ${JSON.stringify(value)}, so nothing changes; drop it or set a new value`, [], 'warning');
      else next.values[key] = value;
    }
    for (const [name, value] of record('move')) {
      const moved = model.move?.(scene, name, value);
      if (!moved) {
        const names = model.moveNames(scene);
        problem('move', name, model.move ? `names no pointer or range; ${names.length ? `they are ${names.map((n) => JSON.stringify(n)).join(', ')}` : 'the scene has none'}` : `${aType(scene.type)} scene has nothing to move; use set`, names);
      } else if (moved.error) problem('move', name, `${JSON.stringify(value)} is no place; ${moved.error}`);
      else next.places[moved.key] = moved.place;
    }
    for (const field of ['show', 'hide']) {
      for (const ref of refsOf(field)) {
        const key = oneKey(scene, ref, model.show.prefixes);
        if (!key) problem(field, ref, `names no ${model.show.what}; ${field} takes ${model.show.help(scene)}`, showNames(scene, model));
        else if (field === 'show') delete next.hidden[key];
        else next.hidden[key] = true;
      }
    }
    checkPointers(next, k);
    states.push(next);
    state = next;
  });
  return { states, problems };
}

const setNames = (scene, model) => refNamesOf(scene, model.set.prefixes);
const showNames = (scene, model) => refNamesOf(scene, model.show.prefixes);
/** Refs of the scene that name one item of a kind in `prefixes`, for "did you mean" hints. */
function refNamesOf(scene, prefixes) {
  // Cells go unlisted: the message gives their range, and a near index is no likelier than any other.
  const names = [
    ...list(scene.pointers).map((p) => `ptr:${p?.name}`),
    ...list(scene.ranges).map((r) => `range:${r?.name}`),
    ...list(scene.frames).map((f) => `frame:${f?.name}`),
    ...list(scene.frames).flatMap((f) => entries(f?.vars).map(([v]) => `${f?.name}.${v}`)),
    ...list(scene.objects).map((o) => o?.id),
    ...list(scene.objects).flatMap((o) => entries(o?.fields).map(([k]) => `${o?.id}.${k}`)),
  ];
  return names.filter((ref) => oneKey(scene, ref, prefixes));
}

/** Every state of a scene: `[initial, during step 0, during step 1, ...]`. */
export const sceneStates = (scene) => walkStates(scene).states;

/** Whether a step changes anything. */
export const changesState = (step) => ['set', 'move', 'show', 'hide'].some((field) => step?.[field] !== undefined);

/**
 * The refs a step changes, as focus refs: what it sets, the pointers and ranges it moves, and what it
 * shows. A step without `focus` focuses these.
 */
export function changedRefs(scene, step) {
  const moved = Object.keys(step?.move ?? {}).map((name) => (list(scene.ranges).some((r) => r?.name === name) ? `range:${name}` : `ptr:${name}`));
  return [...Object.keys(step?.set ?? {}), ...moved, ...list(step?.show)];
}
