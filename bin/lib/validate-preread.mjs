// The pre-read (`--audience preread`): a reviewer's video with no code on screen, which ends on the order in
// which to read the code. The diagrams build the model; the `reading` scene hands the code over. Coverage is
// the reading order's job: every substantial hunk is in it or in `skipped`. A terminal session is not source
// code, so it stays allowed; a code scene and a code cell in a compare do not.

import { CHECK_MAX, READ_FIRST_MAX } from '../../shared/reading.mjs';
import { plainText } from '../../shared/markup.mjs';
import { didYouMean } from './suggest.mjs';

/** More hunks than this behind one picture and the picture explains none of them well. */
export const FROM_MAX = 3;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const WORD = /[A-Za-z_$][\w$]*/g;
// A word written the way code names things: camelCase, PascalCase with an inner capital, or snake_case.
const CODE_NAME = /[a-z][A-Z]|[A-Za-z0-9]_[A-Za-z0-9]/;
// Keys whose strings are ids, refs or settings, never text on screen.
const NOT_TEXT = new Set(['type', 'from', 'to', 'id', 'topic', 'icon', 'focus', 'initial', 'tone', 'shape', 'layout', 'direction', 'style', 'change', 'show', 'hide', 'at', 'ref', 'mark', 'kind', 'lang', 'better', 'unit']);

/** Every string a scene shows or speaks, from any key that holds text. */
function sceneText(value, key = '', out = []) {
  if (typeof value === 'string') { if (!NOT_TEXT.has(key)) out.push(plainText(value)); }
  else if (Array.isArray(value)) value.forEach((v) => sceneText(v, key, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) sceneText(v, k, out);
  return out;
}

/**
 * The names a viewer would look for in the code of `hunk`: its file's base name, and each word of its added or
 * removed lines written as code names one (`checkLimit`, `MAX_REQUESTS`). Plain words such as `limit` are left
 * out, since narration says them anyway.
 */
export function hunkNames(hunk) {
  const base = hunk.file.split('/').at(-1);
  const words = hunk.lines.filter((l) => l.type !== 'context').flatMap((l) => l.text.match(WORD) ?? []);
  return { base, identifiers: new Set(words.filter((w) => CODE_NAME.test(w))) };
}

function namesOnScreen(scene, hunk) {
  const text = sceneText(scene).join('\n');
  const { base, identifiers } = hunkNames(hunk);
  if (text.includes(base)) return true;
  const said = new Set(text.match(WORD) ?? []);
  return [...identifiers].some((id) => said.has(id));
}

function checkFrom(s, p, hunks, preread, errors, warnings) {
  if (s.from === undefined) return;
  if (s.type === 'code' || s.type === 'reading') return errors.push(`${p}.from: ${s.type === 'code' ? 'a code scene shows its own hunk' : 'the reading scene lists hunks in items'}; "from" is for a diagram that explains code without showing it`);
  if (!Array.isArray(s.from) || s.from.length === 0 || !s.from.every(isStr)) return errors.push(`${p}.from: must be a non-empty array of hunk ids, the code this scene explains`);
  if (!preread) warnings.push(`${p}.from: only a pre-read (--audience preread) reads "from"; show the code in a code scene instead`);
  if (s.from.length > FROM_MAX) warnings.push(`${p}.from: ${s.from.length} hunks; one picture explains at most ${FROM_MAX}, so cite the ones it is about and draw the rest in their own scene`);
  s.from.forEach((id, j) => {
    if (!Object.hasOwn(hunks, id)) return errors.push(`${p}.from[${j}]: "${id}" not found in hunks.json`);
    if (!namesOnScreen(s, hunks[id])) {
      const { base, identifiers } = hunkNames(hunks[id]);
      const names = [base, ...[...identifiers].slice(0, 3)].map((n) => `\`${n}\``).join(', ');
      warnings.push(`${p}.from[${j}]: nothing on screen names ${id}; label the part it explains with its file or identifier, such as ${names}, so the viewer finds it in the code`);
    }
  });
}

function checkItems(s, p, hunks, findings, errors, warnings) {
  if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
  if (s.steps !== undefined) errors.push(`${p}.steps: a reading scene takes no steps; narrate the first three items and why they come first`);
  if (!Array.isArray(s.items) || s.items.length === 0) return errors.push(`${p}.items: required non-empty array of { hunkId, check }, in the order to read the code`);
  const seen = new Map();
  let readFirst = 0;
  s.items.forEach((item, j) => {
    const q = `${p}.items[${j}]`;
    if (!item || typeof item !== 'object') return errors.push(`${q}: must be an object { hunkId, check }`);
    if (!isStr(item.hunkId)) errors.push(`${q}.hunkId: required string`);
    else if (!Object.hasOwn(hunks, item.hunkId)) errors.push(`${q}.hunkId: "${item.hunkId}" not found in hunks.json`);
    else if (seen.has(item.hunkId)) errors.push(`${q}.hunkId: ${item.hunkId} is already items[${seen.get(item.hunkId)}]; list each hunk once`);
    else seen.set(item.hunkId, j);
    if (item.routine !== undefined && typeof item.routine !== 'boolean') errors.push(`${q}.routine: must be true or false`);
    if (item.routine !== true) readFirst++;
    if (item.check !== undefined && typeof item.check !== 'string') errors.push(`${q}.check: must be a string`);
    else if (item.routine !== true && !isStr(item.check)) errors.push(`${q}.check: required, what to verify there in under ${CHECK_MAX} characters; set "routine": true for a change to skim`);
    else if (isStr(item.check) && plainText(item.check).trim().length > CHECK_MAX) warnings.push(`${q}.check: ${plainText(item.check).trim().length} characters; say what to verify in under ${CHECK_MAX}`);
    if (item.flag !== undefined) checkFlag(item, q, hunks, findings, errors);
  });
  if (readFirst > READ_FIRST_MAX) warnings.push(`${p}.items: ${readFirst} items to read first; the scene shows ${READ_FIRST_MAX}, so mark the wiring and config "routine": true, and reading.md lists the rest`);
}

function checkFlag(item, q, hunks, findings, errors) {
  if (!findings.size) return errors.push(`${q}.flag: the storyboard has no findings; add the finding to "findings", or remove the flag`);
  const finding = findings.get(item.flag);
  if (!finding) return errors.push(`${q}.flag: no finding has id ${JSON.stringify(item.flag)}${typeof item.flag === 'string' ? didYouMean(item.flag, [...findings.keys()]) : ''}`);
  const hunk = Object.hasOwn(hunks, item.hunkId) ? hunks[item.hunkId] : null;
  if (hunk && finding.file !== hunk.file) errors.push(`${q}.flag: "${finding.id}" is about ${finding.file}, but ${item.hunkId} is in ${hunk.file}; flag it on that file's item`);
}

/** The narration's "item 4" names a numbered item of the reading order. */
function checkItemRefs(sb, count, warnings) {
  sb.scenes.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const texts = [[`scenes[${i}].narration`, s.narration], ...(Array.isArray(s.steps) ? s.steps.map((st, j) => [`scenes[${i}].steps[${j}].say`, st?.say]) : [])];
    for (const [path, text] of texts) {
      for (const m of String(text ?? '').matchAll(/\bitem (\d+)\b/gi)) {
        const n = Number(m[1]);
        if (n < 1 || n > count) warnings.push(`${path}: says "${m[0]}", but the reading order numbers ${count} items to read; name one of 1 to ${count}`);
      }
    }
  });
}

/**
 * Checks `from` on every scene, the reading scene, and in a pre-read the code it may not show. Returns the hunk
 * ids the reading order lists, which in a pre-read are what the video covers.
 */
export function checkPreread(sb, hunks, { preread, mode }, errors, warnings) {
  const findings = new Map((Array.isArray(sb.findings) ? sb.findings : []).filter((f) => isStr(f?.id)).map((f) => [f.id, f]));
  const listed = new Set();
  const readings = [];
  sb.scenes.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const p = `scenes[${i}]`;
    if (preread && s.type === 'code') errors.push(`${p} is a code scene, and a pre-read puts no code on screen; draw what the code does as a diagram, name its hunk in that scene's "from", and list it in the reading order`);
    if (preread && s.type === 'compare' && Array.isArray(s.rows)) {
      s.rows.forEach((row, j) => (Array.isArray(row?.cells) ? row.cells : []).forEach((cell, k) => {
        if (cell && typeof cell === 'object' && 'code' in cell) errors.push(`${p}.rows[${j}].cells[${k}]: a code snippet, and a pre-read puts no code on screen; write what the code does as text, with the real names and values`);
      }));
    }
    if (preread && s.type === 'review') errors.push(`${p}: a pre-read ends on the reading order, which carries the findings; remove the review scene and flag each finding on its reading item`);
    checkFrom(s, p, hunks, preread, errors, warnings);
    if (s.type !== 'reading') return;
    readings.push(i);
    checkItems(s, p, hunks, findings, errors, warnings);
    if (Array.isArray(s.items)) for (const item of s.items) if (isStr(item?.hunkId) && Object.hasOwn(hunks, item.hunkId)) listed.add(item.hunkId);
  });
  if (readings.length > 1) errors.push(`scenes[${readings[1]}]: one reading scene holds the whole reading order; merge the others into it`);
  const last = sb.scenes.length - 1;
  if (readings.length && readings[0] !== last) warnings.push(`scenes[${readings[0]}]: the reading scene hands the code to the viewer, so put it last, after the tests`);
  if (preread && mode === 'diff' && !readings.length) warnings.push('a pre-read ends on a reading scene, the order in which to read the code with what to check at each hunk; add one { "type": "reading", "items": [...] } last');
  if (preread && findings.size) {
    const flagged = new Set(readings.flatMap((i) => (Array.isArray(sb.scenes[i].items) ? sb.scenes[i].items.map((it) => it?.flag) : [])));
    for (const id of findings.keys()) if (!flagged.has(id)) warnings.push(`findings: "${id}" is flagged on no reading item; set "flag": "${id}" on the item of its hunk, so the reader meets it there`);
  }
  const count = readings.length && Array.isArray(sb.scenes[readings[0]].items) ? sb.scenes[readings[0]].items.filter((it) => it?.routine !== true).length : 0;
  if (readings.length) checkItemRefs(sb, count, warnings);
  return listed;
}
