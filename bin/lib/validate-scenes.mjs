// Checks for the table, chart, timeline and files scenes, mirroring src/types.ts. Each pushes
// human/LLM-readable strings onto `errors` and `warnings`, like the checks in validate.mjs.

const CHANGES = ['added', 'removed', 'modified'];
const TABLE_COLUMNS_MAX = 6;
const TABLE_ROWS_MAX = 10;
// A cell wraps to two lines; past this it is cut at a typical column width.
const TABLE_CELL_LONG = 70;
const HIGHLIGHT_STEPS_MAX = 5;

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
