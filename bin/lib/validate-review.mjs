// Checks review mode: the storyboard's `findings`, the code steps that `flag` them, and the review scene
// that recaps them. A finding must sit on a line the diff shows.

import { focusRanges } from '../../shared/focus.mjs';
import { plainText } from '../../shared/markup.mjs';
import { NOTE_MAX } from '../../shared/pen-marks.mjs';
import { SEVERITIES, findingLocation, lineSpan } from '../../shared/review.mjs';
import { didYouMean } from './suggest.mjs';

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const ranges = (lines) => focusRanges([...lines]).map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');

/** New-file lines each changed file shows, across its diff hunks. */
function diffLines(hunks) {
  const out = new Map();
  for (const h of Object.values(hunks)) {
    if (h.status === 'source') continue;
    const lines = out.get(h.file) ?? new Set();
    for (const l of h.lines) if (l.newLine !== null) lines.add(l.newLine);
    out.set(h.file, lines);
  }
  return out;
}

function checkFinding(f, q, files, ids, errors) {
  if (!f || typeof f !== 'object') return errors.push(`${q}: must be an object { id, severity, file, line, claim, evidence }`);
  if (!isStr(f.id)) errors.push(`${q}.id: required string, named by the code step that flags it`);
  else if (ids.has(f.id)) errors.push(`${q}.id: duplicate id "${f.id}"`);
  else ids.add(f.id);
  if (!SEVERITIES.includes(f.severity)) errors.push(`${q}.severity: must be one of ${SEVERITIES.join(', ')}${typeof f.severity === 'string' ? didYouMean(f.severity, SEVERITIES) : ''}`);
  if (!isStr(f.claim)) errors.push(`${q}.claim: required, what looks wrong in one short line`);
  if (!isStr(f.evidence)) errors.push(`${q}.evidence: required string, written to review.md`);
  if (!isStr(f.file)) return errors.push(`${q}.file: required, the file's path as the diff names it`);
  const shown = files.get(f.file);
  if (!shown) return errors.push(`${q}.file: "${f.file}" is not a file this diff changes${didYouMean(f.file, [...files.keys()])}`);
  const span = lineSpan(f.line);
  if (!span) return errors.push(`${q}.line: ${JSON.stringify(f.line)} is not a line number or "a-b" range`);
  // A range longer than the lines the diff shows cannot lie inside them, so it is reported without being expanded.
  if (span[1] - span[0] + 1 > shown.size) return errors.push(`${q}.line: ${f.file} lines ${f.line} are not all in the diff, which shows its lines ${ranges(shown)}; point at a line the diff shows`);
  const missing = Array.from({ length: span[1] - span[0] + 1 }, (_, i) => span[0] + i).filter((n) => !shown.has(n));
  if (missing.length) errors.push(`${q}.line: ${f.file} line ${ranges(missing)} is not in the diff, which shows its lines ${ranges(shown)}; point at a line the diff shows`);
}

/** Every code step that flags a finding: on the finding's file, over one of its lines, worded as an opinion. */
function checkFlags(sb, hunks, byId, errors, warnings) {
  const flagged = new Set();
  sb.scenes.forEach((s, i) => {
    if (!Array.isArray(s?.steps)) return;
    s.steps.forEach((step, j) => {
      if (step?.flag === undefined) return;
      const q = `scenes[${i}].steps[${j}].flag`;
      if (s.type !== 'code') return errors.push(`${q}: only a code step flags a finding, on the lines it shows`);
      if (!byId.size) return errors.push(`${q}: the storyboard has no findings; add the finding to "findings", or remove the flag`);
      const finding = byId.get(step.flag);
      if (!finding) return errors.push(`${q}: no finding has id ${JSON.stringify(step.flag)}${typeof step.flag === 'string' ? didYouMean(step.flag, [...byId.keys()]) : ''}`);
      flagged.add(finding.id);
      const hunk = typeof s.hunkId === 'string' && Object.hasOwn(hunks, s.hunkId) ? hunks[s.hunkId] : undefined;
      if (!hunk) return;
      if (hunk.file !== finding.file) return errors.push(`${q}: "${finding.id}" is about ${finding.file}, but this scene shows ${hunk.file}`);
      if (step.lines === undefined) return errors.push(`${q}: "${finding.id}" points at new-file lines; flag it on a step with lines, not oldLines`);
      const [own, at] = [lineSpan(step.lines), lineSpan(finding.line)];
      if (own && at && (at[1] < own[0] || own[1] < at[0])) {
        errors.push(`${q}: the step highlights lines ${step.lines}, but "${finding.id}" is at ${findingLocation(finding)}; flag it on the step that shows that line`);
      }
      if (step.note === undefined && isStr(finding.claim) && plainText(finding.claim).trim().length > NOTE_MAX) {
        errors.push(`scenes[${i}].steps[${j}]: the pen note defaults to the claim of "${finding.id}", which is ${plainText(finding.claim).trim().length} characters; give the step a "note" of up to ${NOTE_MAX}`);
      }
    });
  });
  const drawn = sb.scenes.some((s) => s?.type === 'review') ? 'the video draws it only in the review scene' : 'it is drawn nowhere in the video, only in review.md';
  for (const [id, f] of byId) {
    if (!flagged.has(id)) warnings.push(`findings: "${id}" (${findingLocation(f)}) is flagged on no code step, so ${drawn}; set "flag": "${id}" on a step that shows its line to mark it there`);
  }
}

/** The review scene lists the findings, so it needs some. */
function checkRecap(sb, count, errors) {
  if (count) return;
  sb.scenes.forEach((s, i) => {
    if (s?.type === 'review') errors.push(`scenes[${i}]: a review scene lists the findings, and there are none, so it would be empty; remove it`);
  });
}

/** `preread`: a pre-read flags its findings on reading items, which validate-preread checks, and has no review scene. */
export function checkReview(sb, hunks, mode, errors, warnings, { preread = false } = {}) {
  const reviewScenes = sb.scenes.some((s) => s?.type === 'review');
  if (sb.findings === undefined) {
    if (reviewScenes) errors.push('findings: the review scene recaps "findings", and the storyboard has none; add them, or "findings": [] when nothing looks wrong');
    checkFlags(sb, hunks, new Map(), errors, warnings);
    return;
  }
  if (!Array.isArray(sb.findings)) return errors.push('findings: must be an array of { id, severity, file, line, claim, evidence }, or [] when nothing looks wrong');
  if (mode === 'explain') return errors.push('findings: a review flags what looks wrong in a diff, and an explanation has none; remove findings and the review scene');
  const files = diffLines(hunks);
  const ids = new Set();
  sb.findings.forEach((f, k) => checkFinding(f, `findings[${k}]`, files, ids, errors));
  const byId = new Map(sb.findings.filter((f) => isStr(f?.id)).map((f) => [f.id, f]));
  if (preread) return;
  checkFlags(sb, hunks, byId, errors, warnings);
  checkRecap(sb, sb.findings.length, errors);
}
