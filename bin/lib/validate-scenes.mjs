// Checks for the table, chart, timeline and files scenes and a flow's spoken steps, mirroring
// src/types.ts. Each pushes human/LLM-readable strings onto `errors` and `warnings`, like the checks in validate.mjs.

import { diffFiles, sceneFiles } from '../../shared/files.mjs';
import { walkStates } from '../../shared/state-steps.mjs';
import { checkStateSteps } from './validate-state.mjs';
import { TONES } from './tones.mjs';

const TABLE_COLUMNS_MAX = 6;
const TABLE_ROWS_MAX = 10;
const CHART_KINDS = ['bar', 'line', 'pie', 'donut'];
/** Past this many slices the palette repeats a colour. */
const PIE_SLICES_MAX = 8;
const CHART_LABELS_MAX = 12;
const CHART_SERIES_MAX = 4;
// Past this many bars each one gets too thin to carry its value label.
const CHART_BARS_MAX = 24;
const TIME_UNITS = ['ms', 's', 'min', 'h', 'd', 'wk', 'mo', 'yr'];
const TIMELINE_EVENTS_MAX = 8;
const FILES_MAX = 18;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isText = (v) => typeof v === 'string';

/** An optional ordered list of unique items, each checked by `valid`. */
function checkHighlight(list, path, errors, { plural, one }, valid) {
  if (list === undefined) return;
  if (!Array.isArray(list)) return errors.push(`${path}: must be an array of ${plural}`);
  const seen = new Set();
  list.forEach((item, i) => {
    if (!valid(item)) errors.push(`${path}[${i}]: ${JSON.stringify(item)} is not ${one}`);
    else if (seen.has(item))
      errors.push(`${path}[${i}]: ${JSON.stringify(item)} is listed twice; each step spotlights a different one`);
    seen.add(item);
  });
}

export function checkTable(s, p, errors, warnings) {
  const before = errors.length;
  if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
  if (!Array.isArray(s.columns) || s.columns.length === 0 || !s.columns.every(isStr)) {
    return errors.push(`${p}.columns: required non-empty array of header strings`);
  }
  if (s.columns.length > TABLE_COLUMNS_MAX)
    warnings.push(`${p}.columns: ${s.columns.length} columns; more than ${TABLE_COLUMNS_MAX} get cramped`);
  if (!Array.isArray(s.rows) || s.rows.length === 0)
    return errors.push(`${p}.rows: required non-empty array of { cells, change? }`);
  s.rows.forEach((row, j) => {
    const q = `${p}.rows[${j}]`;
    if (!Array.isArray(row?.cells)) return errors.push(`${q}.cells: required array with one cell per column`);
    if (row.cells.length !== s.columns.length)
      errors.push(
        `${q}.cells: ${row.cells.length} cell${row.cells.length === 1 ? '' : 's'} for ${s.columns.length} columns; give one cell per column ("" for an empty one)`,
      );
    row.cells.forEach((cell, k) => {
      const c = `${q}.cells[${k}]`;
      if (isText(cell)) return;
      if (!cell || typeof cell !== 'object' || !isText(cell.before) || !isText(cell.after)) {
        return errors.push(`${c}: must be a string, or { before, after } strings for a value this change replaced`);
      }
      if (row.change === 'added' || row.change === 'removed')
        errors.push(
          `${c}: ${row.change === 'added' ? 'an added' : 'a removed'} row has no old and new values; use plain text, or mark the row "modified"`,
        );
    });
  });
  if (s.rows.length > TABLE_ROWS_MAX)
    warnings.push(`${p}.rows: ${s.rows.length} rows; more than ${TABLE_ROWS_MAX} get cramped`);
  const rows = s.rows.length;
  const isRow = (n) => Number.isInteger(n) && n >= 0 && n < rows;
  const what = { plural: 'row indexes', one: `a row index from 0 to ${rows - 1}` };
  checkHighlight(s.highlight, `${p}.highlight`, errors, what, isRow);
  if (s.callout !== undefined && typeof s.callout !== 'string') errors.push(`${p}.callout: must be a string`);
  s.rows.forEach((row, j) => {
    if (row?.hidden !== undefined && typeof row.hidden !== 'boolean')
      errors.push(`${p}.rows[${j}].hidden: must be true or false`);
  });
  if (errors.length === before) checkStateSteps(s, p, errors, warnings);
}

export function checkChart(s, p, errors, warnings) {
  const before = errors.length;
  for (const k of ['title', 'unit', 'prefix', 'callout'])
    if (s[k] !== undefined && typeof s[k] !== 'string') errors.push(`${p}.${k}: must be a string`);
  if (!CHART_KINDS.includes(s.kind)) errors.push(`${p}.kind: must be one of ${CHART_KINDS.join(', ')}`);
  const pie = s.kind === 'pie' || s.kind === 'donut';
  if (s.better !== undefined && !['lower', 'higher'].includes(s.better))
    errors.push(`${p}.better: must be "lower" or "higher"`);
  for (const k of ['badges', 'horizontal', 'stacked', 'sort'])
    if (s[k] !== undefined && typeof s[k] !== 'boolean') errors.push(`${p}.${k}: must be true or false`);
  for (const k of ['horizontal', 'stacked'])
    if (s[k] === true && s.kind !== 'bar')
      errors.push(
        `${p}.${k}: only a bar chart is drawn ${k === 'horizontal' ? 'horizontally' : 'stacked'}; drop it, or use kind "bar"`,
      );
  if (s.sort === true && s.kind === 'line')
    errors.push(`${p}.sort: a line chart keeps its labels in order; sort orders bars and slices`);
  if (!Array.isArray(s.labels) || s.labels.length === 0 || !s.labels.every(isStr))
    return errors.push(`${p}.labels: required non-empty array of strings, one per ${pie ? 'slice' : 'x position'}`);
  const n = s.labels.length;
  if (new Set(s.labels).size !== n) errors.push(`${p}.labels: each label must be different`);
  if (n > CHART_LABELS_MAX) warnings.push(`${p}.labels: ${n} labels; more than ${CHART_LABELS_MAX} get cramped`);
  else if (pie && n > PIE_SLICES_MAX)
    warnings.push(`${p}.labels: ${n} slices; past ${PIE_SLICES_MAX} their colours are hard to tell apart`);
  if (s.kind === 'line' && n < 2)
    warnings.push(`${p}.labels: a line needs at least two labels; use kind "bar" for one`);
  if (!Array.isArray(s.series) || s.series.length === 0)
    return errors.push(`${p}.series: required non-empty array of { name, values, tone? }`);
  const names = new Set();
  s.series.forEach((series, j) => {
    const q = `${p}.series[${j}]`;
    if (!isStr(series?.name)) errors.push(`${q}.name: required string`);
    else if (names.has(series.name)) errors.push(`${q}.name: duplicate series name "${series.name}"`);
    else names.add(series.name);
    if (series?.tone !== undefined && !TONES.includes(series.tone))
      errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
    if (!Array.isArray(series?.values) || !series.values.every((v) => typeof v === 'number' && Number.isFinite(v)))
      return errors.push(`${q}.values: required array of numbers`);
    if (series.values.length !== n)
      errors.push(`${q}.values: ${series.values.length} values for ${n} labels; give one value per label`);
    if (s.kind === 'bar' && series.values.some((v) => v < 0))
      errors.push(`${q}.values: bars start at zero, so values must be 0 or more; use kind "line" for negative values`);
    if (pie && series.values.some((v) => v < 0))
      errors.push(`${q}.values: a slice is a share of the whole, so values must be 0 or more`);
  });
  if (pie && s.series.length !== 1)
    errors.push(`${p}.series: a ${s.kind} draws one series, one slice per label; give one series, or use kind "bar"`);
  if (s.series.length > CHART_SERIES_MAX)
    warnings.push(`${p}.series: ${s.series.length} series; more than ${CHART_SERIES_MAX} are hard to tell apart`);
  const bars = n * (s.stacked === true ? 1 : s.series.length);
  if (s.kind === 'bar' && bars > CHART_BARS_MAX)
    warnings.push(`${p}: ${bars} bars; past ${CHART_BARS_MAX} a bar is too thin to carry its value`);
  if (s.stacked === true && s.series.length === 1)
    warnings.push(`${p}.stacked: one series has nothing to stack, so the chart draws as without it`);
  const note = s.annotation;
  if (note !== undefined) {
    if (pie || s.horizontal === true)
      errors.push(
        `${p}.annotation: only a vertical bar or line chart draws an annotation; say it, or put it in the callout`,
      );
    else if (!note || typeof note !== 'object') errors.push(`${p}.annotation: must be { at, series?, text }`);
    else {
      if (!isStr(note.text)) errors.push(`${p}.annotation.text: required string`);
      if (!s.labels.includes(note.at))
        errors.push(
          `${p}.annotation.at: ${JSON.stringify(note.at)} is not one of the labels (${s.labels.map((l) => JSON.stringify(l)).join(', ')})`,
        );
      if (note.series !== undefined && !names.has(note.series))
        errors.push(`${p}.annotation.series: ${JSON.stringify(note.series)} is not a series name`);
    }
  }
  if (errors.length > before) return;
  checkStateSteps(s, p, errors, warnings);
  if (!pie || errors.length > before) return;
  walkStates(s).states.forEach((state, k) => {
    if (Object.values(state.values).some((v) => v > 0)) return;
    errors.push(
      k === 0
        ? `${p}.series[0].values: every slice is 0, so the ${s.kind} has nothing to draw`
        : `${p}.steps[${k - 1}].set: every slice is 0 from this step, so the ${s.kind} has nothing to draw`,
    );
  });
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function checkTimeline(s, p, errors, warnings) {
  if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
  if (!TIME_UNITS.includes(s.unit)) errors.push(`${p}.unit: must be one of ${TIME_UNITS.join(', ')}`);
  if (!Array.isArray(s.events) || s.events.length === 0)
    errors.push(`${p}.events: required non-empty array of { at, label, detail?, tone? }`);
  else {
    s.events.forEach((e, j) => {
      const q = `${p}.events[${j}]`;
      if (!isNum(e?.at)) errors.push(`${q}.at: required number, in the scene's unit`);
      if (!isStr(e?.label)) errors.push(`${q}.label: required string`);
      if (e?.detail !== undefined && !isText(e.detail)) errors.push(`${q}.detail: must be a string`);
      if (e?.tone !== undefined && !TONES.includes(e.tone))
        errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
    });
    if (s.events.length > TIMELINE_EVENTS_MAX)
      warnings.push(`${p}.events: ${s.events.length} events; more than ${TIMELINE_EVENTS_MAX} get cramped`);
  }
  if (Array.isArray(s.events) && s.events.length) {
    const ats = s.events.map((e) => e?.at);
    if (s.steps !== undefined && ats.some((at, j) => j > 0 && at < ats[j - 1]))
      errors.push(`${p}.events: steps walk the events left to right, so list them in order of at`);
  }
  if (s.spans === undefined) return;
  if (!Array.isArray(s.spans)) return errors.push(`${p}.spans: must be an array of { from, to, label, tone? }`);
  s.spans.forEach((span, j) => {
    const q = `${p}.spans[${j}]`;
    if (!isNum(span?.from) || !isNum(span?.to))
      errors.push(`${q}: from and to are required numbers, in the scene's unit`);
    else if (span.from >= span.to) errors.push(`${q}: from (${span.from}) must be before to (${span.to})`);
    if (!isStr(span?.label)) errors.push(`${q}.label: required string`);
    if (span?.tone !== undefined && !TONES.includes(span.tone))
      errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
  });
}

const isCount = (v) => Number.isInteger(v) && v >= 0;

export function checkFiles(s, p, errors, warnings, hunks, mode) {
  if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
  if (s.files === undefined) {
    if (mode === 'explain')
      return errors.push(
        `${p}.files: required in an explanation, which has no diff to list; give each file as { path }`,
      );
    if (diffFiles(hunks).length === 0)
      return errors.push(`${p}.files: hunks.json has no changed files to list; give each file as { path }`);
  } else if (!Array.isArray(s.files) || s.files.length === 0) {
    return errors.push(`${p}.files: must be a non-empty array of { path, change?, additions?, deletions? }`);
  } else {
    const known = new Set(diffFiles(hunks).map((f) => f.path));
    const seen = new Set();
    const unknown = [];
    s.files.forEach((f, j) => {
      const q = `${p}.files[${j}]`;
      if (!isStr(f?.path)) return errors.push(`${q}.path: required string`);
      if (seen.has(f.path)) errors.push(`${q}.path: "${f.path}" is listed twice`);
      seen.add(f.path);
      for (const k of ['additions', 'deletions'])
        if (f[k] !== undefined && !isCount(f[k])) errors.push(`${q}.${k}: must be a whole number of lines, 0 or more`);
      if (mode !== 'explain' && !known.has(f.path)) unknown.push(f.path);
    });
    if (unknown.length) {
      const list = unknown.slice(0, 4).join(', ') + (unknown.length > 4 ? `, ... ${unknown.length - 4} more` : '');
      warnings.push(
        `${p}.files: ${unknown.length === 1 ? 'path is' : `${unknown.length} paths are`} not changed in hunks.json (${list}); check them against the hunk index`,
      );
    }
  }
  const paths = new Set(sceneFiles(s, hunks).map((f) => f.path));
  if (paths.size > FILES_MAX) warnings.push(`${p}: ${paths.size} files; more than ${FILES_MAX} get cramped`);
  if (s.notes !== undefined) {
    if (!s.notes || typeof s.notes !== 'object' || Array.isArray(s.notes))
      errors.push(`${p}.notes: must be an object of { "path": "note" }`);
    else
      for (const [path, note] of Object.entries(s.notes)) {
        const q = `${p}.notes[${JSON.stringify(path)}]`;
        if (!paths.has(path)) errors.push(`${q}: not one of the files this scene lists`);
        if (!isStr(note)) errors.push(`${q}: must be a non-empty string`);
      }
  }
  const what = { plural: 'file paths', one: 'a path this scene lists' };
  checkHighlight(s.highlight, `${p}.highlight`, errors, what, (path) => paths.has(path));
}

/** A flow speaks per step when its steps carry `say`: every step, or none. */
export function checkFlowSays(s, p, errors) {
  const said = s.steps.filter((step) => step?.say !== undefined);
  if (!said.length) return;
  if (said.length < s.steps.length)
    return errors.push(
      `${p}.steps: ${said.length} of ${s.steps.length} steps have a say; give every step a say to speak each one as it becomes current, or none`,
    );
  s.steps.forEach((step, j) => {
    if (!isStr(step.say)) errors.push(`${p}.steps[${j}].say: must be a non-empty string`);
  });
}
