// The pre-read (`--audience preread`): a reviewer's video with no code on screen, which ends on the order in
// which to read the code. The diagrams build the model; the `reading` scene hands the code over. Coverage is
// the reading order's job: every substantial hunk is in it or in `skipped`. A terminal session is not source
// code, so it stays allowed; a code scene and a code cell in a compare do not.

import { CHECK_MAX, READ_FIRST_MAX } from '../../shared/reading.mjs';
import { plainText } from '../../shared/markup.mjs';
import { sceneChapter } from '../../shared/chapters.mjs';
import { findingLocation, lineSpan } from '../../shared/review.mjs';
import { didYouMean } from './suggest.mjs';

/** More hunks than this behind one picture and the picture explains none of them well. */
export const FROM_MAX = 3;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const WORD = /[A-Za-z_$][\w$]*/g;
// A word written the way code names things: camelCase, PascalCase with an inner capital, or snake_case.
const CODE_NAME = /[a-z][A-Z]|[A-Za-z0-9]_[A-Za-z0-9]/;
// Keys whose strings are ids, refs or settings, never text on screen.
const NOT_TEXT = new Set(['type', 'from', 'to', 'id', 'topic', 'icon', 'focus', 'initial', 'tone', 'shape', 'layout', 'direction', 'style', 'change', 'show', 'hide', 'at', 'ref', 'mark', 'kind', 'lang', 'better', 'unit', 'hunkId', 'flag']);
// Keys whose strings are spoken, not drawn: the subtitles show them, but no label does.
const SPOKEN = new Set(['narration', 'say']);

/** Every label a scene draws, as `[path, text]` with its markup, from any key that holds text other than the spoken ones. */
function sceneLabels(value, path, key = '', out = []) {
  if (typeof value === 'string') { if (!NOT_TEXT.has(key) && !SPOKEN.has(key)) out.push([path, value]); }
  else if (Array.isArray(value)) value.forEach((v, i) => sceneLabels(v, `${path}[${i}]`, key, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) sceneLabels(v, `${path}.${k}`, k, out);
  return out;
}

/**
 * The ways a label reads as code rather than names it, each `[pattern, what it is]`. Kept narrow, so an
 * identifier or a file name alone (`claimDue`, `limiter.ts`) and plain words never match.
 */
const CODE_SHAPES = [
  [/\{[^{}]*[A-Za-z_$][\w$]*\s*:[^{}]*\}/, 'an object literal'],
  [/=>/, 'an arrow function'],
  // A space on both sides, since `==marked==` is markup.
  [/\s(?:===?|!==?)\s|!=|===/, 'a comparison'],
  [/&&|\|\|/, 'a boolean expression'],
  [/\b[A-Za-z_$][\w$.]*\((?!s\)|es\))\s*[\w$'"`[{-]/, 'a call with arguments'],
  [/[\w$]\([^()]*\)\s*;\s*[A-Za-z_$]|[\w$];[A-Za-z_$]/, 'statements'],
];

/** What `text`, with its markup, writes as code, such as "an object literal", or null when it only names things. */
export function codeShape(text) {
  return CODE_SHAPES.find(([re]) => re.test(text))?.[1] ?? null;
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
  const text = sceneLabels(scene, '').map(([, t]) => plainText(t)).join('\n');
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
  if (!hunk) return;
  if (finding.file !== hunk.file) return errors.push(`${q}.flag: "${finding.id}" is about ${finding.file}, but ${item.hunkId} is in ${hunk.file}; flag it on that file's item`);
  const lines = hunk.lines.map((l) => l.newLine).filter((n) => n !== null);
  const at = lineSpan(finding.line);
  if (!at || !lines.length) return;
  const own = [Math.min(...lines), Math.max(...lines)];
  if (at[1] < own[0] || own[1] < at[0]) errors.push(`${q}.flag: "${finding.id}" is at ${findingLocation(finding)}, but ${item.hunkId} covers ${hunk.file}:${own[0]}-${own[1]}; flag it on the item of the hunk that holds that line`);
}

/**
 * The reading order names the chapter that explains each hunk, so two scenes that cite hunks under one chapter
 * label leave the reader unsure which scene it means.
 */
function checkExplainers(sb, warnings) {
  const byChapter = new Map();
  sb.scenes.forEach((s, i) => {
    if (!Array.isArray(s?.from) || !s.from.length) return;
    const chapter = sceneChapter(s);
    const first = byChapter.get(chapter);
    if (first === undefined) byChapter.set(chapter, i);
    else warnings.push(`scenes[${i}]: cites hunks in "from" under the chapter "${chapter}", as scenes[${first}] does, so the reading order's "Explained in" cannot tell them apart; give one its own "chapter"`);
  });
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
  const isScene = (s) => s && typeof s === 'object';
  if (!preread && sb.scenes.some((s) => isScene(s) && (s.type === 'reading' || s.from !== undefined))) {
    warnings.push('this storyboard is a pre-read; pass --audience preread');
  }
  sb.scenes.forEach((s, i) => {
    if (!isScene(s)) return;
    const p = `scenes[${i}]`;
    if (preread && s.type === 'code') errors.push(`${p} is a code scene, and a pre-read puts no code on screen; draw what the code does as a diagram, name its hunk in that scene's "from", and list it in the reading order`);
    if (preread && s.type === 'compare' && Array.isArray(s.rows)) {
      s.rows.forEach((row, j) => (Array.isArray(row?.cells) ? row.cells : []).forEach((cell, k) => {
        if (cell && typeof cell === 'object' && 'code' in cell) errors.push(`${p}.rows[${j}].cells[${k}]: a code snippet, and a pre-read puts no code on screen; write what the code does as text, with the real names and values`);
      }));
    }
    if (preread && s.type === 'review') errors.push(`${p}: a pre-read ends on the reading order, which carries the findings; remove the review scene and flag each finding on its reading item`);
    if (preread && Array.isArray(s.steps)) {
      s.steps.forEach((step, j) => {
        if (step?.flag !== undefined) errors.push(`${p}.steps[${j}].flag: a pre-read carries its findings on the reading order; flag it on the reading item of its hunk`);
      });
    }
    if (preread && s.type !== 'code') {
      for (const [path, text] of sceneLabels(s, p)) {
        const shape = codeShape(text);
        if (shape) warnings.push(`${path}: "${text}" is ${shape}, and a pre-read shows identifiers and file names, never expressions; say it in words with the real names and values`);
      }
    }
    checkFrom(s, p, hunks, preread, errors, warnings);
    if (s.type !== 'reading') return;
    if (!preread) warnings.push(`${p}: only a pre-read has a reading scene; pass --audience preread, or remove it`);
    readings.push(i);
    checkItems(s, p, hunks, findings, errors, warnings);
    if (Array.isArray(s.items)) for (const item of s.items) if (isStr(item?.hunkId) && Object.hasOwn(hunks, item.hunkId)) listed.add(item.hunkId);
  });
  checkExplainers(sb, warnings);
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
