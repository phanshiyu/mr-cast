// Checks for the table, chart, timeline and files scenes, mirroring src/types.ts. Each pushes
// human/LLM-readable strings onto `errors` and `warnings`, like the checks in validate.mjs.

const CHANGES = ['added', 'removed', 'modified'];
const TABLE_COLUMNS_MAX = 6;
const TABLE_ROWS_MAX = 10;
// A cell wraps to two lines; past this it is cut at a typical column width.
const TABLE_CELL_LONG = 70;
const HIGHLIGHT_STEPS_MAX = 5;
export const TONES = ['neutral', 'accent', 'good', 'bad', 'warn'];
const CHART_KINDS = ['bar', 'line'];
const CHART_LABELS_MAX = 12;
const CHART_SERIES_MAX = 4;
// Past this many bars each one gets too thin to carry its value label.
const CHART_BARS_MAX = 24;
const ANNOTATION_LONG = 90;
const TIME_UNITS = ['ms', 's', 'min', 'h', 'd'];
const TIMELINE_EVENTS_MAX = 8;
const TIMELINE_SPANS_MAX = 4;
// An event label wraps to two lines in a card about 300 pixels wide.
const EVENT_LABEL_LONG = 48;
const EVENT_DETAIL_LONG = 60;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isText = (v) => typeof v === 'string';

/** An optional ordered list of unique items, each checked by `valid`. */
function checkHighlight(list, path, errors, warnings, { plural, one }, valid) {
  if (list === undefined) return;
  if (!Array.isArray(list)) return errors.push(`${path}: must be an array of ${plural}`);
  const seen = new Set();
  list.forEach((item, i) => {
    if (!valid(item)) errors.push(`${path}[${i}]: ${JSON.stringify(item)} is not ${one}`);
    else if (seen.has(item)) errors.push(`${path}[${i}]: ${JSON.stringify(item)} is listed twice; each step spotlights a different one`);
    seen.add(item);
  });
  if (list.length > HIGHLIGHT_STEPS_MAX) warnings.push(`${path}: ${list.length} steps; spotlight at most ${HIGHLIGHT_STEPS_MAX} so each holds long enough to read`);
}

export function checkTable(s, p, errors, warnings) {
  if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
  if (!Array.isArray(s.columns) || s.columns.length === 0 || !s.columns.every(isStr)) {
    return errors.push(`${p}.columns: required non-empty array of header strings`);
  }
  if (s.columns.length > TABLE_COLUMNS_MAX) warnings.push(`${p}.columns: ${s.columns.length} columns; more than ${TABLE_COLUMNS_MAX} get cramped, so drop or merge some`);
  if (!Array.isArray(s.rows) || s.rows.length === 0) return errors.push(`${p}.rows: required non-empty array of { cells, change? }`);
  s.rows.forEach((row, j) => {
    const q = `${p}.rows[${j}]`;
    if (!Array.isArray(row?.cells)) return errors.push(`${q}.cells: required array with one cell per column`);
    if (row.cells.length !== s.columns.length) errors.push(`${q}.cells: ${row.cells.length} cell${row.cells.length === 1 ? '' : 's'} for ${s.columns.length} columns; give one cell per column ("" for an empty one)`);
    if (row.change !== undefined && !CHANGES.includes(row.change)) errors.push(`${q}.change: must be one of ${CHANGES.join(', ')}`);
    row.cells.forEach((cell, k) => {
      const c = `${q}.cells[${k}]`;
      if (isText(cell)) {
        if (cell.trim().length > TABLE_CELL_LONG) warnings.push(`${c}: ${cell.trim().length} characters; keep a cell under ${TABLE_CELL_LONG} so it fits on two lines`);
        return;
      }
      if (!cell || typeof cell !== 'object' || !isText(cell.before) || !isText(cell.after)) {
        return errors.push(`${c}: must be a string, or { before, after } strings for a value this change replaced`);
      }
      if (row.change === 'added' || row.change === 'removed') errors.push(`${c}: ${row.change === 'added' ? 'an added' : 'a removed'} row has no old and new values; use plain text, or mark the row "modified"`);
    });
  });
  if (s.rows.length > TABLE_ROWS_MAX) warnings.push(`${p}.rows: ${s.rows.length} rows; more than ${TABLE_ROWS_MAX} get cramped, so split the table into two scenes`);
  const rows = s.rows.length;
  checkHighlight(s.highlight, `${p}.highlight`, errors, warnings, { plural: 'row indexes', one: `a row index from 0 to ${rows - 1}` }, (n) => Number.isInteger(n) && n >= 0 && n < rows);
}

export function checkChart(s, p, errors, warnings) {
  for (const k of ['title', 'unit']) if (s[k] !== undefined && typeof s[k] !== 'string') errors.push(`${p}.${k}: must be a string`);
  if (!CHART_KINDS.includes(s.kind)) errors.push(`${p}.kind: must be one of ${CHART_KINDS.join(', ')}`);
  if (s.better !== undefined && !['lower', 'higher'].includes(s.better)) errors.push(`${p}.better: must be "lower" or "higher"`);
  if (!Array.isArray(s.labels) || s.labels.length === 0 || !s.labels.every(isStr)) return errors.push(`${p}.labels: required non-empty array of strings, one per x position`);
  const n = s.labels.length;
  if (new Set(s.labels).size !== n) errors.push(`${p}.labels: each label must be different`);
  if (n > CHART_LABELS_MAX) warnings.push(`${p}.labels: ${n} labels; more than ${CHART_LABELS_MAX} get cramped`);
  if (s.kind === 'line' && n < 2) warnings.push(`${p}.labels: a line needs at least two labels; use kind "bar" for one`);
  if (!Array.isArray(s.series) || s.series.length === 0) return errors.push(`${p}.series: required non-empty array of { name, values, tone? }`);
  const names = new Set();
  s.series.forEach((series, j) => {
    const q = `${p}.series[${j}]`;
    if (!isStr(series?.name)) errors.push(`${q}.name: required string`);
    else if (names.has(series.name)) errors.push(`${q}.name: duplicate series name "${series.name}"`);
    else names.add(series.name);
    if (series?.tone !== undefined && !TONES.includes(series.tone)) errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
    if (!Array.isArray(series?.values) || !series.values.every((v) => typeof v === 'number' && Number.isFinite(v))) return errors.push(`${q}.values: required array of numbers`);
    if (series.values.length !== n) errors.push(`${q}.values: ${series.values.length} values for ${n} labels; give one value per label`);
    if (s.kind === 'bar' && series.values.some((v) => v < 0)) errors.push(`${q}.values: bars start at zero, so values must be 0 or more; use kind "line" for negative values`);
  });
  if (s.series.length > CHART_SERIES_MAX) warnings.push(`${p}.series: ${s.series.length} series; more than ${CHART_SERIES_MAX} are hard to tell apart`);
  if (s.kind === 'bar' && n * s.series.length > CHART_BARS_MAX) warnings.push(`${p}: ${n * s.series.length} bars; keep it to ${CHART_BARS_MAX} so each bar can carry its value`);
  const note = s.annotation;
  if (note === undefined) return;
  if (!note || typeof note !== 'object') return errors.push(`${p}.annotation: must be { at, series?, text }`);
  if (!isStr(note.text)) errors.push(`${p}.annotation.text: required string`);
  else if (note.text.trim().length > ANNOTATION_LONG) warnings.push(`${p}.annotation.text: ${note.text.trim().length} characters; keep it under ${ANNOTATION_LONG} so it fits on two lines`);
  if (!s.labels.includes(note.at)) errors.push(`${p}.annotation.at: ${JSON.stringify(note.at)} is not one of the labels (${s.labels.map((l) => JSON.stringify(l)).join(', ')})`);
  if (note.series !== undefined && !names.has(note.series)) errors.push(`${p}.annotation.series: ${JSON.stringify(note.series)} is not a series name`);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function checkTimeline(s, p, errors, warnings) {
  if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
  if (!TIME_UNITS.includes(s.unit)) errors.push(`${p}.unit: must be one of ${TIME_UNITS.join(', ')}`);
  if (!Array.isArray(s.events) || s.events.length === 0) errors.push(`${p}.events: required non-empty array of { at, label, detail?, tone? }`);
  else {
    s.events.forEach((e, j) => {
      const q = `${p}.events[${j}]`;
      if (!isNum(e?.at)) errors.push(`${q}.at: required number, in the scene's unit`);
      if (!isStr(e?.label)) errors.push(`${q}.label: required string`);
      else if (e.label.trim().length > EVENT_LABEL_LONG) warnings.push(`${q}.label: ${e.label.trim().length} characters; keep it under ${EVENT_LABEL_LONG} and move the rest to detail`);
      if (e?.detail !== undefined && !isText(e.detail)) errors.push(`${q}.detail: must be a string`);
      else if (e?.detail && e.detail.trim().length > EVENT_DETAIL_LONG) warnings.push(`${q}.detail: ${e.detail.trim().length} characters; keep it under ${EVENT_DETAIL_LONG}`);
      if (e?.tone !== undefined && !TONES.includes(e.tone)) errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
    });
    if (s.events.length > TIMELINE_EVENTS_MAX) warnings.push(`${p}.events: ${s.events.length} events; more than ${TIMELINE_EVENTS_MAX} get cramped, so split the timeline into two scenes`);
  }
  if (s.spans === undefined) return;
  if (!Array.isArray(s.spans)) return errors.push(`${p}.spans: must be an array of { from, to, label, tone? }`);
  s.spans.forEach((span, j) => {
    const q = `${p}.spans[${j}]`;
    if (!isNum(span?.from) || !isNum(span?.to)) errors.push(`${q}: from and to are required numbers, in the scene's unit`);
    else if (span.from >= span.to) errors.push(`${q}: from (${span.from}) must be before to (${span.to})`);
    if (!isStr(span?.label)) errors.push(`${q}.label: required string`);
    if (span?.tone !== undefined && !TONES.includes(span.tone)) errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
  });
  if (s.spans.length > TIMELINE_SPANS_MAX) warnings.push(`${p}.spans: ${s.spans.length} spans; keep the ${TIMELINE_SPANS_MAX} the narration names`);
}
