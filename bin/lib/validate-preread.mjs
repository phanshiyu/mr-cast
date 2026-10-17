// The pre-read (`--audience preread`): a video with no code on screen, which ends on the order in which to read
// the code. A terminal session is not source code, so it stays allowed; a code scene and a code cell in a compare
// do not.

import { READ_FIRST_MAX, hunkSpan, readingOrder } from '../../shared/reading.mjs';
import { sceneChapter } from '../../shared/chapters.mjs';
import { findingLocation, lineSpan } from '../../shared/review.mjs';
import { didYouMean } from './suggest.mjs';

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

function checkFrom(s, p, hunks, preread, errors, warnings) {
  if (s.from === undefined) return;
  if (s.type === 'code' || s.type === 'reading') return errors.push(`${p}.from: ${s.type === 'code' ? 'a code scene shows its own hunk' : 'the reading scene lists hunks in items'}; "from" is for a diagram that explains code without showing it`);
  if (!Array.isArray(s.from) || s.from.length === 0 || !s.from.every(isStr)) return errors.push(`${p}.from: must be a non-empty array of hunk ids, the code this scene explains`);
  if (!preread) warnings.push(`${p}.from: only a pre-read (--audience preread) reads "from", so it does nothing here`);
  s.from.forEach((id, j) => {
    if (!Object.hasOwn(hunks, id)) errors.push(`${p}.from[${j}]: "${id}" not found in hunks.json`);
  });
}

function checkItems(s, p, hunks, findings, errors, warnings) {
  if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
  if (s.steps !== undefined) errors.push(`${p}.steps: a reading scene takes no steps`);
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
    else if (item.routine !== true && !isStr(item.check)) errors.push(`${q}.check: required, what to verify there; set "routine": true for a change to skim`);
    if (item.flag !== undefined) checkFlag(item, q, hunks, findings, errors);
    if (isStr(item.hunkId) && Object.hasOwn(hunks, item.hunkId)) checkLines(item, q, hunks[item.hunkId], errors);
  });
  if (readFirst > READ_FIRST_MAX) warnings.push(`${p}.items: ${readFirst} items to read first; the scene shows the first ${READ_FIRST_MAX} and counts the rest, which reading.md and the player's Reading order panel list`);
}

/** `lines` lies inside the hunk's own lines. */
function checkLines(item, q, hunk, errors) {
  const { file, range } = hunkSpan(hunk);
  if (!range || item.lines === undefined) return;
  const where = `${file}:${range[0]}-${range[1]}`;
  const own = lineSpan(item.lines);
  if (!own) return errors.push(`${q}.lines: must be "a-b" or a line number, such as "${range[0]}-${Math.min(range[1], range[0] + 9)}"`);
  if (own[0] < range[0] || own[1] > range[1]) errors.push(`${q}.lines: ${item.lines} is outside ${item.hunkId}, which covers ${where}; name lines inside it`);
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

/**
 * The narration's "item 4" names a numbered item of the reading order, as grouped by topic.
 */
function checkItemRefs(sb, hunks, warnings) {
  const numbered = readingOrder(sb, hunks)?.readFirst ?? [];
  const count = numbered.length;
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
    if (preread && s.type === 'code') errors.push(`${p} is a code scene, and a pre-read puts no code on screen; cite the hunk in a diagram's "from" or list it in the reading order`);
    if (preread && s.type === 'compare' && Array.isArray(s.rows)) {
      s.rows.forEach((row, j) => (Array.isArray(row?.cells) ? row.cells : []).forEach((cell, k) => {
        if (cell && typeof cell === 'object' && 'code' in cell) errors.push(`${p}.rows[${j}].cells[${k}]: a code snippet, and a pre-read puts no code on screen; use a text cell`);
      }));
    }
    if (preread && s.type === 'review') errors.push(`${p}: a pre-read ends on the reading order, which carries the findings; remove the review scene and flag each finding on its reading item`);
    if (preread && Array.isArray(s.steps)) {
      s.steps.forEach((step, j) => {
        if (step?.flag !== undefined) errors.push(`${p}.steps[${j}].flag: a pre-read carries its findings on the reading order; flag it on the reading item of its hunk`);
      });
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
  if (preread && mode === 'diff' && !readings.length) warnings.push('a pre-read with no reading scene has no reading order, so no reading.md is written; add { "type": "reading", "items": [...] }');
  if (preread && findings.size) {
    const flagged = new Set(readings.flatMap((i) => (Array.isArray(sb.scenes[i].items) ? sb.scenes[i].items.map((it) => it?.flag) : [])));
    for (const id of findings.keys()) if (!flagged.has(id)) warnings.push(`findings: "${id}" is flagged on no reading item; set "flag": "${id}" on the item of its hunk, so the reader meets it there`);
  }
  if (readings.length) checkItemRefs(sb, hunks, warnings);
  return listed;
}
