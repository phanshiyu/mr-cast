// Checks for the compare scene, mirroring src/types.ts. Pushes human/LLM-readable strings onto `errors`
// and `warnings`, like the checks in validate.mjs.

import { checkImageFit, checkImageSrc } from './validate-image.mjs';
import { TONES } from './tones.mjs';
import { HUNK_LINES_MAX, isHunkCell, resolveHunkCell } from '../../shared/compare.mjs';

const COMPARE_ROWS_MAX = 6;
/** A code cell is a short snippet; past this many lines it crowds its row. */
const CODE_LINES_MAX = 6;
const MODES = ['changes', 'options'];
const VERDICTS = ['good', 'bad', 'warn'];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

function checkHunkCell(cell, q, hunks, errors, warnings) {
  const extra = Object.keys(cell).filter((k) => !['hunk', 'side', 'lines'].includes(k));
  if (extra.length) errors.push(`${q}: ${extra.join(', ')} not allowed in a hunk cell, which is { hunk, side, lines }`);
  if (!isStr(cell.hunk)) return errors.push(`${q}.hunk: required hunk id, e.g. "h11"`);
  if (cell.side !== 'old' && cell.side !== 'new') return errors.push(`${q}.side: must be "old" or "new"`);
  const read = resolveHunkCell(cell, hunks);
  if ('error' in read) return errors.push(`${q}: ${read.error}`);
  if (read.count > HUNK_LINES_MAX)
    warnings.push(
      `${q}: ${read.count} lines; a cell read from a hunk shows ${HUNK_LINES_MAX}, so narrow "${cell.lines}"`,
    );
}

function checkCell(cell, q, hunks, errors, warnings) {
  if (typeof cell === 'string') return;
  if (isHunkCell(cell)) return checkHunkCell(cell, q, hunks, errors, warnings);
  if (cell && typeof cell === 'object' && !Array.isArray(cell) && 'image' in cell) {
    checkImageSrc(cell.image, `${q}.image`, errors);
    return checkImageFit(cell.fit, `${q}.fit`, errors);
  }
  if (!cell || typeof cell !== 'object' || Array.isArray(cell) || !isStr(cell.code)) {
    return errors.push(
      `${q}: must be text, { code, lang? } for a short snippet, { hunk, side, lines } for lines of a hunk, or { image, fit? } for a picture`,
    );
  }
  if (cell.lang !== undefined && typeof cell.lang !== 'string')
    errors.push(`${q}.lang: must be a string, e.g. "ts" or "json"`);
  const lines = cell.code.split('\n').length;
  if (lines > CODE_LINES_MAX) warnings.push(`${q}.code: ${lines} lines; a compare cell shows ${CODE_LINES_MAX}`);
}

export function checkCompare(s, p, errors, warnings, hunks = {}) {
  if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
  if (s.mode !== undefined && !MODES.includes(s.mode))
    errors.push(
      `${p}.mode: must be one of ${MODES.join(', ')}; "options" is a decision against the alternative not taken`,
    );
  const options = s.mode === 'options';
  if (s.alternative !== undefined) {
    if (s.alternative !== 'mine') errors.push(`${p}.alternative: must be "mine", or left out`);
    else if (!options)
      errors.push(`${p}.alternative: only means something with "mode": "options"; add it, or remove alternative`);
  }
  const notOptions = (q) => `${q}.chosen: only means something with "mode": "options"; add it, or remove chosen`;
  if (s.sides !== undefined) {
    if (!Array.isArray(s.sides) || s.sides.length !== 2)
      errors.push(`${p}.sides: must be two sides, [{ title, tone? }, { title, tone? }]`);
    else {
      s.sides.forEach((side, j) => {
        const q = `${p}.sides[${j}]`;
        if (typeof side === 'string')
          errors.push(
            `${q}: is the string "${side}"; a side is an object, write { "title": ${JSON.stringify(side)} } (optionally with "tone")`,
          );
        else if (!isStr(side?.title)) errors.push(`${q}.title: required string, e.g. "Before", "Redis" or "Option A"`);
        if (side?.tone !== undefined && !TONES.includes(side.tone))
          errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
        if (side?.chosen !== undefined) {
          if (typeof side.chosen !== 'boolean') errors.push(`${q}.chosen: must be true or false`);
          else if (!options) errors.push(notOptions(q));
        }
      });
      if (s.sides.every((side) => side?.chosen === true))
        errors.push(`${p}.sides: both sides are chosen; mark only the one taken`);
      if (isStr(s.sides[0]?.title) && s.sides[0].title === s.sides[1]?.title)
        errors.push(`${p}.sides: both sides are titled "${s.sides[0].title}"; give each its own title`);
    }
  }
  if (!Array.isArray(s.rows) || s.rows.length === 0)
    return errors.push(`${p}.rows: required non-empty array of { label?, cells: [left, right] }`);
  s.rows.forEach((row, j) => {
    const q = `${p}.rows[${j}]`;
    if (!row || typeof row !== 'object') return errors.push(`${q}: must be an object { label?, cells }`);
    if (row.label !== undefined && typeof row.label !== 'string') errors.push(`${q}.label: must be a string`);
    if (!Array.isArray(row.cells) || row.cells.length !== 2)
      errors.push(`${q}.cells: required array of two cells, one per side ("" for an empty one)`);
    else row.cells.forEach((cell, k) => checkCell(cell, `${q}.cells[${k}]`, hunks, errors, warnings));
    if (row.chosen !== undefined) {
      if (row.chosen !== 0 && row.chosen !== 1)
        errors.push(`${q}.chosen: must be 0 or 1, the side this row took (0 is the left)`);
      else if (!options) errors.push(notOptions(q));
      else if (s.sides?.some((side) => side?.chosen === true))
        errors.push(`${q}.chosen: the sides are already marked chosen; mark the sides or the rows, not both`);
    }
    if (row.same !== undefined && typeof row.same !== 'boolean') errors.push(`${q}.same: must be true or false`);
    if (row.verdict !== undefined) {
      if (!Array.isArray(row.verdict) || row.verdict.length !== 2)
        errors.push(
          `${q}.verdict: must be two entries, one per side, each ${VERDICTS.map((v) => `"${v}"`).join(', ')} or null`,
        );
      else
        row.verdict.forEach((v, k) => {
          if (v !== null && !VERDICTS.includes(v))
            errors.push(`${q}.verdict[${k}]: must be one of ${VERDICTS.join(', ')}, or null`);
        });
    }
  });
  if (s.rows.length > COMPARE_ROWS_MAX)
    warnings.push(`${p}.rows: ${s.rows.length} rows; more than ${COMPARE_ROWS_MAX} get cramped`);
}
