// Checks for the scenes whose steps change what they show, `array`, `memory` and `graph`, mirroring src/types.ts:
// their initial state here, and every step's `set`, `move`, `show`, `hide`, `tint` and `callout` through shared/state-steps.mjs,
// which the scenes draw from. Each pushes human/LLM-readable strings onto `errors` and `warnings`.

import { isPointer, walkStates } from '../../shared/state-steps.mjs';
import { didYouMean } from './suggest.mjs';
import { TONES } from './validate-scenes.mjs';

const ARRAY_CELLS_MAX = 16;
/** A table beside a graph has about 40% of the frame. */
const GRAPH_TABLE_COLUMNS = 4;
const GRAPH_TABLE_ROWS = 8;
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

/** An array's values and its splits, at `q` (the scene, or one of its `arrays`). */
function checkValuesOf(a, q, errors, warnings) {
  if (!Array.isArray(a.values) || a.values.length === 0) return errors.push(`${q}.values: required non-empty array of cell values (text or numbers), left to right`);
  a.values.forEach((v, j) => {
    if (!isText(v)) errors.push(`${q}.values[${j}]: must be text or a number`);
  });
  const n = a.values.length;
  if (n > ARRAY_CELLS_MAX) warnings.push(`${q}.values: ${n} cells; past ${ARRAY_CELLS_MAX} each gets too narrow to read`);
  if (a.splits !== undefined && (!Array.isArray(a.splits) || !a.splits.every((i) => Number.isInteger(i) && i >= 1 && i < n))) {
    errors.push(`${q}.splits: must be cell indexes from 1 to ${n - 1}, each the cell a cut comes before`);
  }
}

export function checkArray(s, p, errors, warnings) {
  const before = errors.length;
  for (const k of ['title', 'label', 'callout']) if (s[k] !== undefined && typeof s[k] !== 'string') errors.push(`${p}.${k}: must be a string`);
  if (s.cells !== undefined && !['box', 'hex'].includes(s.cells)) errors.push(`${p}.cells: must be "box" or "hex"`);
  if (s.indexes !== undefined && typeof s.indexes !== 'boolean') errors.push(`${p}.indexes: must be true or false`);
  const lengths = new Map();
  if (s.arrays !== undefined) {
    if (s.values !== undefined) return errors.push(`${p}: has both values and arrays; give values for one array, or arrays for several`);
    if (s.label !== undefined) errors.push(`${p}.label: with arrays each array has its own label; move it onto one`);
    if (s.splits !== undefined) errors.push(`${p}.splits: with arrays each array has its own splits; move them onto one`);
    if (!Array.isArray(s.arrays) || s.arrays.length === 0) return errors.push(`${p}.arrays: must be a non-empty array of { name, values, label?, splits?, hidden? }`);
    s.arrays.forEach((a, j) => {
      const q = `${p}.arrays[${j}]`;
      if (!isRecord(a)) return errors.push(`${q}: must be { name, values, label?, splits?, hidden? }`);
      if (!isStr(a.name)) errors.push(`${q}.name: required string, e.g. "left"`);
      else if (/[[\]:]/.test(a.name)) errors.push(`${q}.name: "${a.name}" has a "[", "]" or ":", which refs use; pick a name without them`);
      else if (lengths.has(a.name)) errors.push(`${q}.name: "${a.name}" is taken; every array has its own name`);
      if (a.label !== undefined && typeof a.label !== 'string') errors.push(`${q}.label: must be a string`);
      if (a.hidden !== undefined && typeof a.hidden !== 'boolean') errors.push(`${q}.hidden: must be true or false`);
      checkValuesOf(a, q, errors, warnings);
      if (isStr(a.name)) lengths.set(a.name, Array.isArray(a.values) ? a.values.length : 0);
    });
  } else {
    checkValuesOf(s, p, errors, warnings);
    lengths.set('', Array.isArray(s.values) ? s.values.length : 0);
  }
  if (errors.length > before) return;
  const multi = s.arrays !== undefined;
  const hex = s.cells === 'hex';
  /** The length of the array a marker sits on, or null with an error when it names none. */
  const onArray = (item, q) => {
    if (item.array === undefined) return lengths.get(multi ? s.arrays[0].name : '');
    if (!multi) return errors.push(`${q}.array: names an array, but the scene has one array in values; drop it`), null;
    if (lengths.has(item.array)) return lengths.get(item.array);
    errors.push(`${q}.array: "${item.array}" is no array; arrays are ${quoted([...lengths.keys()])}${didYouMean(String(item.array), [...lengths.keys()])}`);
    return null;
  };
  const names = new Set();
  if (s.pointers !== undefined) {
    if (!Array.isArray(s.pointers)) errors.push(`${p}.pointers: must be an array of { name, at, array?, tone?, hidden? }`);
    else if (hex && s.pointers.length) errors.push(`${p}.pointers: a hex grid draws no pointers, since its rows interlock; light cells with focus or tint instead`);
    else {
      s.pointers.forEach((ptr, j) => {
        const q = `${p}.pointers[${j}]`;
        if (!isRecord(ptr)) return errors.push(`${q}: must be { name, at, array?, tone?, hidden? }`);
        checkMarkerName(ptr, q, names, errors);
        const n = onArray(ptr, q);
        if (n === null) return;
        if (!Number.isInteger(ptr.at) || ptr.at < -1 || ptr.at > n) errors.push(`${q}.at: must be a cell index from 0 to ${n - 1}, or -1 or ${n} just past either end`);
        checkTone(ptr, q, errors);
      });
    }
  }
  if (s.ranges !== undefined) {
    if (!Array.isArray(s.ranges)) errors.push(`${p}.ranges: must be an array of { name, from, to, array?, tone?, hidden? }`);
    else if (hex && s.ranges.length) errors.push(`${p}.ranges: a hex grid draws no ranges, since its rows interlock; colour cells with tint instead`);
    else {
      s.ranges.forEach((r, j) => {
        const q = `${p}.ranges[${j}]`;
        if (!isRecord(r)) return errors.push(`${q}: must be { name, from, to, array?, tone?, hidden? }`);
        checkMarkerName(r, q, names, errors);
        const n = onArray(r, q);
        if (n === null) return;
        const ok = (v) => Number.isInteger(v) && v >= 0 && v < n;
        if (!ok(r.from) || !ok(r.to) || r.from > r.to) errors.push(`${q}: from and to are its first and last cell, from 0 to ${n - 1}, with from <= to`);
        checkTone(r, q, errors);
      });
    }
  }
  if (errors.length > before) return;
  checkStateSteps(s, p, errors, warnings);
}

/** A graph's table, hidden nodes and edges, tints, callout and the changes its steps make. Runs once the graph itself is valid. */
export function checkGraphState(s, p, errors, warnings) {
  const before = errors.length;
  if (s.callout !== undefined && typeof s.callout !== 'string') errors.push(`${p}.callout: must be a string`);
  for (const [field, items] of [['nodes', s.nodes], ['edges', s.edges]]) {
    items.forEach((item, j) => {
      if (item?.hidden !== undefined && typeof item.hidden !== 'boolean') errors.push(`${p}.${field}[${j}].hidden: must be true or false`);
    });
  }
  const t = s.table;
  if (t !== undefined) {
    if (!isRecord(t)) return errors.push(`${p}.table: must be { columns, rows }`);
    if (!Array.isArray(t.columns) || t.columns.length === 0 || !t.columns.every(isStr)) return errors.push(`${p}.table.columns: required non-empty array of headers`);
    if (new Set(t.columns).size !== t.columns.length) errors.push(`${p}.table.columns: every header must differ, since a cell ref "Header@row" names one`);
    if (t.columns.length > GRAPH_TABLE_COLUMNS) warnings.push(`${p}.table.columns: ${t.columns.length} columns; beside a graph more than ${GRAPH_TABLE_COLUMNS} get cramped`);
    if (!Array.isArray(t.rows) || t.rows.length === 0) return errors.push(`${p}.table.rows: required non-empty array of { cells }`);
    if (t.rows.length > GRAPH_TABLE_ROWS) warnings.push(`${p}.table.rows: ${t.rows.length} rows; beside a graph more than ${GRAPH_TABLE_ROWS} get cramped`);
    t.rows.forEach((r, j) => {
      const q = `${p}.table.rows[${j}]`;
      if (!isRecord(r) || !Array.isArray(r.cells)) return errors.push(`${q}: must be { cells }`);
      if (r.cells.length !== t.columns.length) errors.push(`${q}.cells: ${r.cells.length} cells for ${t.columns.length} columns; give one per column`);
      r.cells.forEach((c, k) => {
        if (typeof c !== 'string' && !(isRecord(c) && typeof c.before === 'string' && typeof c.after === 'string')) errors.push(`${q}.cells[${k}]: must be text or { before, after }`);
      });
    });
  }
  if (errors.length > before) return;
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
}

export function checkMemory(s, p, errors, warnings) {
  const before = errors.length;
  for (const k of ['title', 'callout']) if (s[k] !== undefined && typeof s[k] !== 'string') errors.push(`${p}.${k}: must be a string`);
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
  if (errors.length > before) return;
  checkStateSteps(s, p, errors, warnings);
}

/** Every step's changes, walked in order from the initial state, as the scene draws them. */
export function checkStateSteps(s, p, errors, warnings) {
  for (const pr of walkStates(s).problems) {
    const at = pr.step < 0 ? `${p}.${pr.field}` : `${p}.steps[${pr.step}].${pr.field}${pr.ref ? `[${JSON.stringify(pr.ref)}]` : ''}`;
    const subject = pr.step < 0 ? `${pr.ref} ` : '';
    const close = pr.ref ? didYouMean(pr.ref, pr.names) : '';
    const hint = close || (pr.names.length && pr.names.length <= NAMES_LISTED ? `; it can be ${quoted(pr.names)}` : '');
    (pr.level === 'warning' ? warnings : errors).push(`${at}: ${subject}${pr.message}${hint}`);
  }
}
