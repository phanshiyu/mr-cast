// Checks for the scenes whose steps change what they show, `array` and `memory`, mirroring src/types.ts:
// their initial state here, and every step's `set`, `move`, `show` and `hide` through shared/state-steps.mjs,
// which the scenes draw from. Each pushes human/LLM-readable strings onto `errors` and `warnings`.

import { isPointer, walkStates } from '../../shared/state-steps.mjs';
import { didYouMean } from './suggest.mjs';
import { TONES } from './validate-scenes.mjs';

const ARRAY_CELLS_MAX = 16;
const ARRAY_POINTERS_MAX = 4;
const ARRAY_RANGES_MAX = 3;
const MEMORY_FRAMES_MAX = 4;
const MEMORY_OBJECTS_MAX = 6;
const MEMORY_ROWS_MAX = 6;
/** A hint lists every ref a change could name when there are no more than this. */
const NAMES_LISTED = 12;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isText = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const quoted = (names) => names.map((n) => JSON.stringify(n)).join(', ');

function checkTone(item, q, errors) {
  if (item.tone !== undefined && !TONES.includes(item.tone)) errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
  if (item.hidden !== undefined && typeof item.hidden !== 'boolean') errors.push(`${q}.hidden: must be true or false`);
}

/** Pointer and range names: required, short of ":" (refs write "ptr:lo"), and all different. */
function checkMarkerName(item, q, seen, errors) {
  if (!isStr(item?.name)) return errors.push(`${q}.name: required string, e.g. "lo"`);
  if (seen.has(item.name)) errors.push(`${q}.name: "${item.name}" is taken; pointer and range names must all be different, since a step moves one by its name`);
  seen.add(item.name);
}

export function checkArray(s, p, errors, warnings) {
  for (const k of ['title', 'label']) if (s[k] !== undefined && typeof s[k] !== 'string') errors.push(`${p}.${k}: must be a string`);
  if (!Array.isArray(s.values) || s.values.length === 0) return errors.push(`${p}.values: required non-empty array of cell values (text or numbers), left to right`);
  s.values.forEach((v, j) => {
    if (!isText(v)) errors.push(`${p}.values[${j}]: must be text or a number`);
  });
  const n = s.values.length;
  if (n > ARRAY_CELLS_MAX) warnings.push(`${p}.values: ${n} cells; past ${ARRAY_CELLS_MAX} each gets too narrow to read, so show the part the steps walk`);
  const names = new Set();
  if (s.pointers !== undefined) {
    if (!Array.isArray(s.pointers)) errors.push(`${p}.pointers: must be an array of { name, at, tone?, hidden? }`);
    else {
      s.pointers.forEach((ptr, j) => {
        const q = `${p}.pointers[${j}]`;
        if (!isRecord(ptr)) return errors.push(`${q}: must be { name, at, tone?, hidden? }`);
        checkMarkerName(ptr, q, names, errors);
        if (!Number.isInteger(ptr.at) || ptr.at < -1 || ptr.at > n) errors.push(`${q}.at: must be a cell index from 0 to ${n - 1}, or -1 or ${n} just past either end`);
        checkTone(ptr, q, errors);
      });
      if (s.pointers.length > ARRAY_POINTERS_MAX) warnings.push(`${p}.pointers: ${s.pointers.length} pointers; keep the ${ARRAY_POINTERS_MAX} the steps move`);
    }
  }
  if (s.ranges !== undefined) {
    if (!Array.isArray(s.ranges)) errors.push(`${p}.ranges: must be an array of { name, from, to, tone?, hidden? }`);
    else {
      s.ranges.forEach((r, j) => {
        const q = `${p}.ranges[${j}]`;
        if (!isRecord(r)) return errors.push(`${q}: must be { name, from, to, tone?, hidden? }`);
        checkMarkerName(r, q, names, errors);
        const ok = (v) => Number.isInteger(v) && v >= 0 && v < n;
        if (!ok(r.from) || !ok(r.to) || r.from > r.to) errors.push(`${q}: from and to are its first and last cell, from 0 to ${n - 1}, with from <= to`);
        checkTone(r, q, errors);
      });
      if (s.ranges.length > ARRAY_RANGES_MAX) warnings.push(`${p}.ranges: ${s.ranges.length} ranges; keep the ${ARRAY_RANGES_MAX} the narration names`);
    }
  }
  checkStateSteps(s, p, errors, warnings);
}

/** A frame's vars or an object's fields: a record of name to text, number or `{ ref }`. */
function checkValues(record, q, kind, ids, errors, warnings) {
  if (!isRecord(record)) return errors.push(`${q}: required object of ${kind} name to value, e.g. { "total": 0, "cart": { "ref": "c1" } }`);
  for (const [name, value] of Object.entries(record)) {
    const at = `${q}[${JSON.stringify(name)}]`;
    if (!name.trim()) errors.push(`${at}: a ${kind} needs a name`);
    if (isText(value)) continue;
    if (!isPointer(value) || Object.keys(value).length !== 1) errors.push(`${at}: must be text, a number, or { "ref": "<object id>" }`);
    else if (!ids.has(value.ref)) errors.push(`${at}: points at "${value.ref}", which is no object; objects are ${quoted([...ids])}${didYouMean(value.ref, [...ids])}`);
  }
  if (Object.keys(record).length > MEMORY_ROWS_MAX) warnings.push(`${q}: ${Object.keys(record).length} ${kind}s; show the ${MEMORY_ROWS_MAX} the narration names`);
}

export function checkMemory(s, p, errors, warnings) {
  if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
  const frames = Array.isArray(s.frames) ? s.frames : null;
  const objects = Array.isArray(s.objects) ? s.objects : null;
  if (!frames) errors.push(`${p}.frames: required array of { name, vars, hidden? }, outermost call first`);
  if (!objects) errors.push(`${p}.objects: required array of { id, type?, fields, hidden? } (may be empty)`);
  if (!frames || !objects) return;
  if (!frames.length && !objects.length) return errors.push(`${p}: no frames and no objects; give at least one`);
  const ids = new Set();
  objects.forEach((o, j) => {
    const q = `${p}.objects[${j}]`;
    if (!isStr(o?.id)) return errors.push(`${q}.id: required string, e.g. "c1"`);
    if (/[.:]/.test(o.id)) errors.push(`${q}.id: "${o.id}" has a "." or ":", which refs use to name a field or a frame; pick an id without them`);
    if (ids.has(o.id)) errors.push(`${q}.id: "${o.id}" is taken; every object id is different`);
    ids.add(o.id);
  });
  const names = new Set();
  frames.forEach((f, j) => {
    const q = `${p}.frames[${j}]`;
    if (!isRecord(f)) return errors.push(`${q}: must be { name, vars, hidden? }`);
    if (!isStr(f.name)) errors.push(`${q}.name: required string, the function's name`);
    else if (names.has(f.name)) errors.push(`${q}.name: "${f.name}" is taken; name each frame differently, such as "fact(3)" and "fact(2)" for a recursive call`);
    else if (ids.has(f.name)) errors.push(`${q}.name: "${f.name}" is also an object id; refs name either, so rename one`);
    names.add(f.name);
    checkValues(f.vars, `${q}.vars`, 'variable', ids, errors, warnings);
    if (f.hidden !== undefined && typeof f.hidden !== 'boolean') errors.push(`${q}.hidden: must be true or false`);
  });
  objects.forEach((o, j) => {
    const q = `${p}.objects[${j}]`;
    if (!isRecord(o)) return;
    if (o.type !== undefined && !isStr(o.type)) errors.push(`${q}.type: must be a non-empty string, e.g. "list"`);
    checkValues(o.fields, `${q}.fields`, 'field', ids, errors, warnings);
    if (o.hidden !== undefined && typeof o.hidden !== 'boolean') errors.push(`${q}.hidden: must be true or false`);
  });
  if (frames.length > MEMORY_FRAMES_MAX) warnings.push(`${p}.frames: ${frames.length} frames; keep the ${MEMORY_FRAMES_MAX} the story needs`);
  if (objects.length > MEMORY_OBJECTS_MAX) warnings.push(`${p}.objects: ${objects.length} objects; keep the ${MEMORY_OBJECTS_MAX} the story needs`);
  if (errors.length) return;
  checkStateSteps(s, p, errors, warnings);
}

/** Every step's changes, walked in order from the initial state, as the scene draws them. */
function checkStateSteps(s, p, errors, warnings) {
  for (const pr of walkStates(s).problems) {
    const at = pr.step < 0 ? `${p}.${pr.field}` : `${p}.steps[${pr.step}].${pr.field}${pr.ref ? `[${JSON.stringify(pr.ref)}]` : ''}`;
    const subject = pr.step < 0 ? `${pr.ref} ` : '';
    const close = pr.ref ? didYouMean(pr.ref, pr.names) : '';
    const hint = close || (pr.names.length && pr.names.length <= NAMES_LISTED ? `; it can be ${quoted(pr.names)}` : '');
    (pr.level === 'warning' ? warnings : errors).push(`${at}: ${subject}${pr.message}${hint}`);
  }
}
