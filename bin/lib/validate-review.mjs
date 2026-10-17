// Checks review mode: the storyboard's `findings`, the code steps that `flag` them, and the review scene
// that recaps them. A finding must sit on a line the diff shows and carry its evidence.

import { focusRanges } from '../../shared/focus.mjs';
import { plainText } from '../../shared/markup.mjs';
import { NOTE_MAX } from '../../shared/pen-marks.mjs';
import { SEVERITIES, findingLocation, lineSpan } from '../../shared/review.mjs';
import { didYouMean } from './suggest.mjs';

/** Past this many the recap is an audit, not the few things that clearly look wrong. */
const FINDINGS_MAX = 8;
/** One short line of evidence; longer reads as an essay in review.md. */
const EVIDENCE_MAX = 240;
/** A finding names a line or a short range, never most of a file. */
const FINDING_LINES_MAX = 50;
/** Words that say a flag is an opinion, not a fact the explanation states. */
const OPINION = /\b(i think|i'd|i would|looks? (off|wrong|risky|odd|broken|like)|seems?|worth|might|may|probably|suspect|appears?|not sure|wonder)\b/i;

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

function checkFinding(f, q, files, ids, errors, warnings) {
  if (!f || typeof f !== 'object') return errors.push(`${q}: must be an object { id, severity, file, line, claim, evidence }`);
  if (!isStr(f.id)) errors.push(`${q}.id: required string, named by the code step that flags it`);
  else if (ids.has(f.id)) errors.push(`${q}.id: duplicate id "${f.id}"`);
  else ids.add(f.id);
  if (!SEVERITIES.includes(f.severity)) errors.push(`${q}.severity: must be one of ${SEVERITIES.join(', ')}${typeof f.severity === 'string' ? didYouMean(f.severity, SEVERITIES) : ''}`);
  if (!isStr(f.claim)) errors.push(`${q}.claim: required, what looks wrong in one short line`);
  if (!isStr(f.evidence)) errors.push(`${q}.evidence: required, one short line on what the code does and an input that breaks it; a finding without evidence is a guess, so check it or drop it`);
  else if (f.evidence.trim().length > EVIDENCE_MAX) warnings.push(`${q}.evidence: ${f.evidence.trim().length} characters; keep it to one short line`);
  if (!isStr(f.file)) return errors.push(`${q}.file: required, the file's path as the diff names it`);
  const shown = files.get(f.file);
  if (!shown) return errors.push(`${q}.file: "${f.file}" is not a file this diff changes${didYouMean(f.file, [...files.keys()])}`);
  const span = lineSpan(f.line);
  if (!span) return errors.push(`${q}.line: ${JSON.stringify(f.line)} is not a line number or "a-b" range`);
  if (span[1] - span[0] >= FINDING_LINES_MAX) return errors.push(`${q}.line: ${f.line} spans ${span[1] - span[0] + 1} lines; point at the line or the few lines that look wrong`);
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
      if (isStr(step.say) && !OPINION.test(step.say)) {
        warnings.push(`scenes[${i}].steps[${j}].say: a flag is your opinion, so say it as one, such as "this looks off" or "I think", not as a fact of the change`);
      }
    });
  });
  for (const [id, f] of byId) {
    if (!flagged.has(id)) warnings.push(`findings: "${id}" (${findingLocation(f)}) is flagged on no code step; set "flag": "${id}" on the step that shows its line, so the video says it where the walkthrough reaches it`);
  }
}

/** The review scene recaps the findings at the end, and only when there are some. */
function checkRecap(sb, count, errors, warnings) {
  const recaps = sb.scenes.flatMap((s, i) => (s?.type === 'review' ? [i] : []));
  if (count === 0) {
    for (const i of recaps) errors.push(`scenes[${i}]: a review scene recaps the findings, and there are none; remove it, and say in the last scene's narration that nothing looked wrong`);
    return;
  }
  if (!recaps.length) return errors.push(`findings: ${count} ${count === 1 ? 'finding' : 'findings'} and no review scene; add one { "type": "review" } at the end to recap them`);
  if (recaps.length > 1) errors.push(`scenes[${recaps[1]}]: one review scene recaps every finding; remove the others`);
  const later = sb.scenes.findIndex((s, i) => i > recaps[0] && (s?.type === 'code' || s?.type === 'tests'));
  if (later >= 0) warnings.push(`scenes[${recaps[0]}]: the review scene comes before scenes[${later}] (${sb.scenes[later].type}); put the recap at the end, after the tests`);
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
  sb.findings.forEach((f, k) => checkFinding(f, `findings[${k}]`, files, ids, errors, warnings));
  if (sb.findings.length > FINDINGS_MAX) warnings.push(`findings: ${sb.findings.length} findings; flag only what clearly looks wrong, at most ${FINDINGS_MAX}`);
  const byId = new Map(sb.findings.filter((f) => isStr(f?.id)).map((f) => [f.id, f]));
  if (preread) return;
  checkFlags(sb, hunks, byId, errors, warnings);
  checkRecap(sb, sb.findings.length, errors, warnings);
}
