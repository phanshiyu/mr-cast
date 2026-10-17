// Scenes whose steps change what they show: `array`, `memory` and `graph`. A scene's state at step k is its
// initial state with the changes of steps 0 to k applied in order; a step's changes land at its start. State
// keys are the item keys of shared/targets.mjs, so the item a step changes and the item it focuses share a name.
// Shared by the scenes (which draw each state) and `validate` (which reports every change that names nothing).

import { arrayRows, cellKey, markerRow, rowKey } from './arrays.mjs';
import { indexRange } from './steps.mjs';
import { memberKey, resolveRef, splitMemberKey } from './targets.mjs';
import { aType } from './words.mjs';
import { svgOf, textOf } from './svg.mjs';

const list = (v) => (Array.isArray(v) ? v : []);
const entries = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v) : []);
const isText = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
/** A memory value that points at an object: `{ "ref": "c1" }`. */
export const isPointer = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && typeof v.ref === 'string';

/** A table cell that strikes an old value beside a new one: `{ before, after }`. */
const isChange = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && typeof v.before === 'string' && typeof v.after === 'string' && Object.keys(v).length === 2;

/** Two values are the same when they read the same, or point at the same object. */
export const sameValue = (a, b) => {
  if (isPointer(a) || isPointer(b)) return isPointer(a) && isPointer(b) && a.ref === b.ref;
  if (isChange(a) || isChange(b)) return isChange(a) && isChange(b) && a.before === b.before && a.after === b.after;
  return String(a) === String(b);
};

/** The colours a `tint` takes: a tone, "dim", or "clear" to take the colour off. */
export const TINTS = ['neutral', 'accent', 'good', 'bad', 'warn', 'dim', 'clear'];

/** A table's cells as [item key, value], for a table scene or the table beside a graph. */
const tableCells = (table) => list(table?.rows).flatMap((r, i) => list(table?.columns).map((_, c) => [`x:${i}/${c}`, list(r?.cells)[c] ?? '']));
/** A table's rows that start hidden, as [item key, true]. */
const hiddenRows = (table) => list(table?.rows).flatMap((r, i) => (r?.hidden === true ? [[`r:${i}`, true]] : []));

/**
 * Per scene type: its initial state; the item kinds `set`, `show` and `hide` take, as key prefixes; how a
 * set value is checked; and how `move` places a pointer or a range, when the type has them.
 */
const MODELS = {
  array: {
    initial(scene) {
      const markers = [...list(scene.pointers).map((p) => [`ptr:${p?.name}`, [p?.at, p?.at], p?.hidden]), ...list(scene.ranges).map((r) => [`rg:${r?.name}`, [r?.from, r?.to], r?.hidden])];
      const rows = arrayRows(scene);
      return {
        values: Object.fromEntries(rows.flatMap((a) => a.values.map((v, i) => [cellKey(a.name, i), v]))),
        places: Object.fromEntries(markers.map(([key, place]) => [key, place])),
        hidden: Object.fromEntries([...markers.flatMap(([key, , hidden]) => (hidden === true ? [[key, true]] : [])), ...rows.flatMap((a) => (a.hidden ? [[rowKey(a.name), true]] : []))]),
      };
    },
    set: {
      prefixes: ['c:'],
      what: 'cell',
      help: (scene) => (Array.isArray(scene.arrays) ? 'a cell "name[i]", such as "left[0]"' : `a cell index from 0 to ${Math.max(0, list(scene.values).length - 1)}`),
    },
    show: {
      prefixes: ['ptr:', 'rg:', 'a:'],
      what: 'pointer or range',
      help: (scene) => `a pointer "ptr:name" or a range "range:name"${Array.isArray(scene.arrays) ? ', or an array "array:name"' : ''}`,
    },
    // A tint colours cells; a whole array's ref colours every cell of it.
    tint: {
      prefixes: ['c:', 'a:'],
      what: 'cell',
      help: (scene) => (Array.isArray(scene.arrays) ? 'a cell "left[0]", cells "left[0-3]", or an array "array:left"' : 'a cell index or an "a-b" range of cells'),
      expand: (scene, key) => (key.startsWith('a:') ? (arrayRows(scene).find((a) => rowKey(a.name) === key)?.values ?? []).map((_, i) => cellKey(key.slice(2), i)) : [key]),
    },
    callout: true,
    checkValue: (value) => (isText(value) ? null : 'must be text or a number'),
    move(scene, name, value) {
      const length = (marker) => (arrayRows(scene).find((a) => a.name === markerRow(scene, marker))?.values ?? []).length;
      const pointer = list(scene.pointers).find((p) => p?.name === name);
      if (pointer) {
        const n = length(pointer);
        const at = typeof value === 'string' && /^\s*-?\d+\s*$/.test(value) ? Number(value) : value;
        return Number.isInteger(at) && at >= -1 && at <= n ? { key: `ptr:${name}`, place: [at, at] } : { error: `a pointer moves to a cell index from 0 to ${n - 1}, or -1 or ${n} just past either end` };
      }
      const rangeOf = list(scene.ranges).find((r) => r?.name === name);
      if (rangeOf) {
        const n = length(rangeOf);
        const r = indexRange(value);
        return r && r[1] < n ? { key: `rg:${name}`, place: r } : { error: `a range moves to "a-b", its first and last cell, from 0 to ${n - 1}` };
      }
      return null;
    },
    moveNames: (scene) => [...list(scene.pointers), ...list(scene.ranges)].map((m) => m?.name).filter((n) => typeof n === 'string'),
  },
  table: {
    initial: (scene) => ({ values: Object.fromEntries(tableCells(scene)), places: {}, hidden: Object.fromEntries(hiddenRows(scene)) }),
    set: { prefixes: ['x:'], what: 'cell', help: () => 'a cell "Header@row", such as "Balance@2"' },
    show: { prefixes: ['r:'], what: 'row', help: () => 'a row index' },
    tint: { prefixes: ['r:', 'x:'], what: 'row or cell', help: () => 'a row index or a cell "Header@row"', expand: (_scene, key) => [key] },
    callout: true,
    checkValue: (value) => (typeof value === 'string' || isChange(value) ? null : 'must be text, or { "before": "4", "after": "3" } to strike the old value beside the new'),
    move: null,
    moveNames: () => [],
  },
  graph: {
    initial(scene) {
      const nodes = list(scene.nodes);
      return {
        values: Object.fromEntries([...nodes.map((n) => [`b:${n?.id}`, n?.badge ?? '']), ...tableCells(scene.table)]),
        places: {},
        hidden: Object.fromEntries([
          ...nodes.flatMap((n) => (n?.hidden === true ? [[`n:${n.id}`, true]] : [])),
          ...list(scene.edges).flatMap((e, i) => (e?.hidden === true ? [[`e:${i}`, true]] : [])),
          ...hiddenRows(scene.table),
        ]),
      };
    },
    // A node's set value is its badge, kept under "b:id" beside the node's own "n:id".
    set: {
      prefixes: ['n:', 'x:'],
      what: 'node or table cell',
      help: (scene) => `a node id, for its badge${scene.table ? ', or a table cell "Header@row"' : ''}`,
      key: (key) => (key.startsWith('n:') ? `b:${key.slice(2)}` : key),
    },
    show: { prefixes: ['n:', 'e:', 'r:'], what: 'node, edge or table row', help: () => 'a node id, an edge "from->to", or a table row "row:A"' },
    tint: {
      prefixes: ['n:', 'e:', 'g:', 'r:', 'x:'],
      what: 'node, edge or table row',
      help: () => 'a node id, an edge "from->to", a group "group:Name", or a table row "row:A" or cell "Header@row"',
      expand: (scene, key) => (key.startsWith('g:') ? list(scene.nodes).filter((n) => `g:${n?.group}` === key).map((n) => `n:${n.id}`) : [key]),
    },
    callout: true,
    checkValue(value, scene, key) {
      if (key.startsWith('b:')) return isText(value) ? null : 'is a badge, which must be text or a number ("" takes it off)';
      return typeof value === 'string' || isChange(value) ? null : 'must be text, or { "before": "4", "after": "3" } to strike the old value beside the new';
    },
    move: null,
    moveNames: () => [],
  },
  svg: {
    initial(scene) {
      const { ids } = svgOf(scene.svg);
      return {
        values: Object.fromEntries([...ids].flatMap(([id, node]) => (node?.tag === 'text' ? [[`s:${id}`, textOf(node)]] : []))),
        places: {},
        hidden: Object.fromEntries(list(scene.hidden).flatMap((id) => (ids.has(id) ? [[`s:${id}`, true]] : []))),
      };
    },
    // A step can rewrite a <text> element; the initial state holds each one's own text.
    set: { prefixes: ['s:'], what: '<text> element', help: () => 'the id of a <text> element' },
    show: { prefixes: ['s:'], what: 'element', help: () => 'an element id' },
    tint: { prefixes: ['s:'], what: 'element', help: () => 'an element id', expand: (_scene, key) => [key] },
    callout: true,
    checkValue(value, scene, key) {
      if (svgOf(scene.svg).ids.get(key.slice(2))?.tag !== 'text') return 'names an element that is not <text>; only text can be set';
      return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? null : 'must be text';
    },
    move: null,
    moveNames: () => [],
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
    tint: null,
    callout: true,
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

const copy = (state) => ({ values: { ...state.values }, places: { ...state.places }, hidden: { ...state.hidden }, tints: { ...state.tints }, callout: state.callout });

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
  let state = { ...model.initial(scene), tints: {}, callout: typeof scene.callout === 'string' ? scene.callout : '' };
  if (scene.callout !== undefined && !model.callout) problems.push({ step: -1, field: 'callout', ref: '', message: `${aType(scene.type)} scene draws no callout`, names: [], level: 'error' });
  const applyTints = (record, next, problem) => {
    if (record === undefined) return;
    if (!model.tint) return problem('tint', '', `${aType(scene.type)} scene takes no tint`);
    if (!record || typeof record !== 'object' || Array.isArray(record)) return problem('tint', '', `must be an object of ref to colour, e.g. { "3": "good" }; a colour is one of ${TINTS.join(', ')}`);
    for (const [ref, tint] of Object.entries(record)) {
      const keys = resolveRef(scene, ref);
      const named = keys?.length && keys.every((k) => model.tint.prefixes.some((p) => k.startsWith(p))) ? keys.flatMap((k) => model.tint.expand(scene, k)) : null;
      if (!named) problem('tint', ref, `names no ${model.tint.what}; a tint key is ${model.tint.help(scene)}`, refNamesOf(scene, model.tint.prefixes));
      else if (!TINTS.includes(tint)) problem('tint', ref, `${JSON.stringify(tint)} is no colour; a tint is one of ${TINTS.join(', ')}`);
      else for (const key of named) tint === 'clear' ? delete next.tints[key] : (next.tints[key] = tint);
    }
  };
  applyTints(scene.tint, state, (field, ref, message, names = [], level = 'error') => problems.push({ step: -1, field, ref, message, names, level }));
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
      if (Array.isArray(value) && value.every((r) => typeof r === 'string' || Number.isInteger(r))) return value;
      problem(field, '', `must be an array of refs: ${model.show.help(scene)}`);
      return [];
    };
    for (const [ref, value] of record('set')) {
      const named = oneKey(scene, ref, model.set.prefixes);
      if (!named) {
        problem('set', ref, `names no ${model.set.what}; a set key is ${model.set.help(scene)}`, setNames(scene, model));
        continue;
      }
      const key = model.set.key?.(named) ?? named;
      const bad = model.checkValue(value, scene, key);
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
    applyTints(step?.tint, next, problem);
    if (step?.callout !== undefined) {
      if (!model.callout) problem('callout', '', `${aType(scene.type)} scene draws no callout`);
      else if (typeof step.callout !== 'string') problem('callout', '', 'must be text; "" takes the callout away');
      else next.callout = step.callout;
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
    ...(Array.isArray(scene.arrays) ? scene.arrays.map((a) => `array:${a?.name}`) : []),
    ...(scene.type === 'graph' ? list(scene.nodes).map((n) => n?.id) : []),
    ...(scene.type === 'svg' ? svgOf(scene.svg).ids.keys() : []),
  ];
  return names.filter((ref) => oneKey(scene, ref, prefixes));
}

/** Every state of a scene: `[initial, during step 0, during step 1, ...]`. */
export const sceneStates = (scene) => walkStates(scene).states;

/** Whether a step changes anything. */
export const changesState = (step) => ['set', 'move', 'show', 'hide', 'tint', 'callout'].some((field) => step?.[field] !== undefined);

/**
 * The refs a step changes, as focus refs: what it sets, the pointers and ranges it moves, what it shows
 * and what it tints a tone. A step without `focus` focuses these, or what it dims when it changes nothing else.
 */
export function changedRefs(scene, step) {
  const moved = Object.keys(step?.move ?? {}).map((name) => (list(scene.ranges).some((r) => r?.name === name) ? `range:${name}` : `ptr:${name}`));
  const tints = Object.entries(step?.tint && typeof step.tint === 'object' ? step.tint : {});
  const refs = [...Object.keys(step?.set ?? {}), ...moved, ...list(step?.show), ...tints.flatMap(([ref, tint]) => (tint === 'clear' || tint === 'dim' ? [] : [ref]))];
  // What a step rules out recedes rather than lights, unless ruling it out is all the step does.
  return [...new Set(refs.length ? refs : tints.flatMap(([ref, tint]) => (tint === 'dim' ? [ref] : [])))];
}
