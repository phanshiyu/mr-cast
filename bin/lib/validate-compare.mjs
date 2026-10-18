// Checks for the compare scene, mirroring src/types.ts. Pushes human/LLM-readable strings onto `errors`
// and `warnings`, like the checks in validate.mjs.

import { checkImageFit, checkImageSrc } from './validate-image.mjs';
import { TONES } from './validate-scenes.mjs';

const COMPARE_ROWS_MAX = 6;
/** A code cell is a short snippet; past this many lines it crowds its row. */
const CODE_LINES_MAX = 6;
const VERDICTS = ['good', 'bad', 'warn'];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

function checkCell(cell, q, errors, warnings) {
  if (typeof cell === 'string') return;
  if (cell && typeof cell === 'object' && !Array.isArray(cell) && 'image' in cell) {
    checkImageSrc(cell.image, `${q}.image`, errors);
    return checkImageFit(cell.fit, `${q}.fit`, errors);
  }
  if (!cell || typeof cell !== 'object' || Array.isArray(cell) || !isStr(cell.code)) {
    return errors.push(`${q}: must be text, { code, lang? } for a short snippet, or { image, fit? } for a picture`);
  }
  if (cell.lang !== undefined && typeof cell.lang !== 'string') errors.push(`${q}.lang: must be a string, e.g. "ts" or "json"`);
  const lines = cell.code.split('\n').length;
  if (lines > CODE_LINES_MAX) warnings.push(`${q}.code: ${lines} lines; a compare cell shows ${CODE_LINES_MAX}`);
}

export function checkCompare(s, p, errors, warnings) {
  if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
  if (s.sides !== undefined) {
    if (!Array.isArray(s.sides) || s.sides.length !== 2) errors.push(`${p}.sides: must be two sides, [{ title, tone? }, { title, tone? }]`);
    else {
      s.sides.forEach((side, j) => {
        const q = `${p}.sides[${j}]`;
        if (!isStr(side?.title)) errors.push(`${q}.title: required string, e.g. "Before", "Redis" or "Option A"`);
        if (side?.tone !== undefined && !TONES.includes(side.tone)) errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
      });
      if (isStr(s.sides[0]?.title) && s.sides[0].title === s.sides[1]?.title) errors.push(`${p}.sides: both sides are titled "${s.sides[0].title}"; give each its own title`);
    }
  }
  if (!Array.isArray(s.rows) || s.rows.length === 0) return errors.push(`${p}.rows: required non-empty array of { label?, cells: [left, right] }`);
  s.rows.forEach((row, j) => {
    const q = `${p}.rows[${j}]`;
    if (!row || typeof row !== 'object') return errors.push(`${q}: must be an object { label?, cells }`);
    if (row.label !== undefined && typeof row.label !== 'string') errors.push(`${q}.label: must be a string`);
    if (!Array.isArray(row.cells) || row.cells.length !== 2) errors.push(`${q}.cells: required array of two cells, one per side ("" for an empty one)`);
    else row.cells.forEach((cell, k) => checkCell(cell, `${q}.cells[${k}]`, errors, warnings));
    if (row.same !== undefined && typeof row.same !== 'boolean') errors.push(`${q}.same: must be true or false`);
    if (row.verdict !== undefined) {
      if (!Array.isArray(row.verdict) || row.verdict.length !== 2) errors.push(`${q}.verdict: must be two entries, one per side, each ${VERDICTS.map((v) => `"${v}"`).join(', ')} or null`);
      else row.verdict.forEach((v, k) => {
        if (v !== null && !VERDICTS.includes(v)) errors.push(`${q}.verdict[${k}]: must be one of ${VERDICTS.join(', ')}, or null`);
      });
    }
  });
  if (s.rows.length > COMPARE_ROWS_MAX) warnings.push(`${p}.rows: ${s.rows.length} rows; more than ${COMPARE_ROWS_MAX} get cramped`);
}
