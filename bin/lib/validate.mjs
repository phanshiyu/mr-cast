// Storyboard validation, mirroring src/types.ts. Returns human/LLM-readable error strings.

import { expandLineRefs, focusStepOrder, sceneFocusRanges } from '../../shared/focus.mjs';
import { isTestFile } from '../../shared/test-files.mjs';
import { FPS, sceneDurationInFrames } from '../../shared/timing.mjs';
import { checkGraph, checkIcon, checkNodeFields } from './validate-diagram.mjs';
import { checkFocusSteps } from './validate-focus.mjs';
import { checkHighlight } from './highlight.mjs';
import { checkLayers } from './validate-layers.mjs';
import { checkMarks } from './validate-marks.mjs';
import { checkPenMarks } from './validate-pen-marks.mjs';
import { checkReview } from './validate-review.mjs';
import { checkSpokenCounts } from './validate-counts.mjs';
import { checkFit, checkSpokenMarkup } from './validate-fit.mjs';
import { normalizeStoryboard, upgradeTypes } from '../../shared/normalize.mjs';
import { checkArray, checkMemory } from './validate-state.mjs';
import { TONES, checkChart, checkFiles, checkFlowSays, checkTable, checkTimeline } from './validate-scenes.mjs';
import { checkCompare } from './validate-compare.mjs';
import { checkTopics } from './validate-plan.mjs';
import { checkTerminal } from './validate-terminal.mjs';
import { checkPreread } from './validate-preread.mjs';

const RISKS = ['low', 'medium', 'high'];
const VIEWS = ['split', 'morph'];
const TYPES = ['intent', 'graph', 'code', 'flow', 'sequence', 'er', 'state', 'mermaid', 'tests', 'table', 'chart', 'timeline', 'files', 'review', 'reading', 'compare', 'terminal', 'layers', 'array', 'memory'];
const MESSAGE_KINDS = ['call', 'return', 'async'];
const CARDINALITIES = ['one-to-one', 'one-to-many', 'many-to-many'];
const TEST_STATUSES = ['added', 'modified', 'removed', 'existing'];
const TEST_CASES_MAX = 10;
const INTENT_BULLETS_MAX = 6;
const MAX_LINE_RANGE = 10000;
// The step diagram beside the code fits this many labelled nodes above the callout at its smallest font.
const LABELLED_STEPS_MAX = 6;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const plural = (n, word) => (n === 1 ? word : `${word}s`);

/** @returns {boolean} whether `ref` is a line number or an "a-b" range of reasonable size */
function checkLineRef(ref, path, errors) {
  if (typeof ref === 'number' && Number.isInteger(ref) && ref > 0) return true;
  const m = typeof ref === 'string' && ref.match(/^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/);
  if (!m) {
    errors.push(`${path}: ${JSON.stringify(ref)} is not a line number or "a-b" range`);
    return false;
  }
  if (m[2] !== undefined && Math.abs(m[2] - m[1]) > MAX_LINE_RANGE) {
    errors.push(`${path}: range ${JSON.stringify(ref)} spans more than ${MAX_LINE_RANGE} lines`);
    return false;
  }
  return true;
}

/** @returns {boolean} whether `refs` is present and every entry is a valid line ref */
function checkLineRefs(refs, path, errors) {
  if (refs === undefined) return false;
  if (!Array.isArray(refs)) {
    errors.push(`${path}: must be an array of line numbers or "a-b" ranges`);
    return false;
  }
  return refs.map((r, i) => checkLineRef(r, `${path}[${i}]`, errors)).every(Boolean);
}

/** The line numbers of `refs` that `hunk` has no line for on that side, with a description of what it has. */
function linesOutsideHunk(refs, hunk, side) {
  const valid = hunk.lines.map((l) => (side === 'new' ? l.newLine : l.oldLine)).filter((n) => n !== null);
  const missing = [...expandLineRefs(refs)].filter((n) => !valid.includes(n));
  const span = valid.length ? `${side}-file lines ${Math.min(...valid)}-${Math.max(...valid)}` : `no ${side}-file lines`;
  return { missing, span };
}

function checkFocusInHunk(refs, hunk, side, path, warnings) {
  const { missing, span } = linesOutsideHunk(refs, hunk, side);
  if (missing.length) warnings.push(`${path}: lines ${missing.join(', ')} are outside ${hunk.id} (${span})`);
}

const formatRange = ([a, b]) => (a === b ? `${a}` : `${a}-${b}`);

/** A code scene's `flow` names one step per focus range, in the order the ranges play. */
function checkCodeFlow(scene, hunk, refsOk, p, errors, warnings) {
  const { flow } = scene;
  if (!Array.isArray(flow) || flow.length === 0) return errors.push(`${p}.flow: must be a non-empty array of { label, outcome? }`);
  flow.forEach((step, j) => {
    const q = `${p}.flow[${j}]`;
    if (!isStr(step?.label)) return errors.push(`${q}.label: required string`);
    if (step.outcome !== undefined && typeof step.outcome !== 'string') errors.push(`${q}.outcome: must be a string`);
  });
  if (!refsOk) return;
  const ranges = sceneFocusRanges(scene);
  if (!ranges.length) return errors.push(`${p}.flow: needs focusLinesAfter or focusLinesBefore with one range per step`);
  if (!hunk) return;
  const order = focusStepOrder(scene, hunk);
  if (order.length === flow.length) return;
  const list = order.map((id) => (ranges[id] ? formatRange(ranges[id].range) : 'the changed lines')).join(', ');
  const plural = order.length === 1 ? 'range' : 'ranges';
  errors.push(`${p}.flow: ${flow.length} steps, but the focus has ${order.length} ${plural} (${list}); give each range exactly one step, in that top-to-bottom order`);
}

/**
 * A stepped code scene: each step names its lines on one side and what to say while they are
 * highlighted. The steps are the scene's only focus, play in the order written, and that order
 * must be the hunk's top-to-bottom order, so step k's words always play over step k's lines.
 */
function checkCodeSteps(scene, hunk, p, errors, warnings) {
  const { steps } = scene;
  if (!Array.isArray(steps) || steps.length === 0) return errors.push(`${p}.steps: must be a non-empty array of { lines, say }`);
  for (const key of ['focusLinesAfter', 'focusLinesBefore', 'flow']) {
    if (scene[key] !== undefined) errors.push(`${p}.${key}: not used with steps; give each step its lines (or oldLines) and its flow label`);
  }
  let refsOk = true;
  let labelled = 0;
  steps.forEach((step, j) => {
    const q = `${p}.steps[${j}]`;
    if (!step || typeof step !== 'object') { refsOk = false; return errors.push(`${q}: must be an object { lines, say }`); }
    const sides = ['lines', 'oldLines'].filter((k) => step[k] !== undefined);
    if (sides.length !== 1) {
      refsOk = false;
      errors.push(`${q}: set lines (a new-file line number or "a-b" range) or oldLines (old-file, for removed code), not ${sides.length ? 'both' : 'neither'}`);
    } else if (!checkLineRef(step[sides[0]], `${q}.${sides[0]}`, errors)) refsOk = false;
    if (!isStr(step.say)) errors.push(`${q}.say: required string, the words spoken while these lines are highlighted`);
    if (step.label !== undefined) {
      if (!isStr(step.label)) errors.push(`${q}.label: must be a non-empty string`);
      else labelled++;
    }
    if (step.outcome !== undefined && typeof step.outcome !== 'string') errors.push(`${q}.outcome: must be a string`);
  });
  if (labelled && labelled < steps.length) errors.push(`${p}.steps: ${labelled} of ${steps.length} steps have a label; label every step to draw the flow diagram beside the code, or none`);
  else if (labelled > LABELLED_STEPS_MAX) warnings.push(`${p}.steps: ${labelled} labelled steps; the step diagram beside the code fits ${LABELLED_STEPS_MAX}, so split the scene or drop the labels`);
  if (!refsOk) return;

  const ranges = sceneFocusRanges(scene);
  ranges.forEach(({ side, range: [a, b] }, j) => {
    const q = `${p}.steps[${j}].${side === 'oldLine' ? 'oldLines' : 'lines'}`;
    const earlier = ranges.findIndex((r, i) => i < j && r.side === side && r.range[0] <= b && a <= r.range[1]);
    if (earlier >= 0) errors.push(`${q}: ${formatRange([a, b])} overlaps steps[${earlier}] (${formatRange(ranges[earlier].range)}); each line belongs to one step`);
    if (!hunk) return;
    const { missing, span } = linesOutsideHunk([`${a}-${b}`], hunk, side === 'oldLine' ? 'old' : 'new');
    if (missing.length) errors.push(`${q}: lines ${missing.join(', ')} are outside ${hunk.id} (${span}), so the step would highlight nothing while its words play`);
  });
  if (!hunk) return;
  const order = focusStepOrder(scene, hunk);
  if (order.length === steps.length && order.some((id, k) => id !== k)) {
    errors.push(`${p}.steps: steps play in the order written, but their lines read top to bottom as steps ${order.map((id) => id + 1).join(', ')}; reorder the steps to match the code`);
  }
}

/**
 * What the video shows of the diff, for validate's summary line and the outline: the hunks a code scene, a tests
 * case or (in a pre-read) the reading order shows, and the ones `skipped` lists. Only a broken entry is an error.
 */
function checkCoverage(sb, hunks, audience, listed, errors, warnings) {
  const preread = audience === 'preread';
  const shownIds = sb.scenes.flatMap((s) => {
    if (s?.type === 'code') return [s.hunkId];
    if (s?.type === 'reading' && preread) return [...listed];
    if (s?.type === 'tests' && Array.isArray(s.cases)) return s.cases.map((c) => c?.hunkId);
    return [];
  });
  const shown = new Set(shownIds.filter((id) => typeof id === 'string' && Object.hasOwn(hunks, id)));
  const skipped = new Set();
  if (sb.skipped !== undefined && !Array.isArray(sb.skipped)) errors.push('skipped: must be an array of { hunkId, reason }');
  else (sb.skipped ?? []).forEach((entry, i) => {
    const p = `skipped[${i}]`;
    if (!isStr(entry?.hunkId)) errors.push(`${p}.hunkId: required string`);
    else if (!Object.hasOwn(hunks, entry.hunkId)) errors.push(`${p}.hunkId: "${entry.hunkId}" not found in hunks.json`);
    else if (shown.has(entry.hunkId)) warnings.push(`${p}: ${entry.hunkId} is also shown in a scene; remove it from skipped or drop the scene`);
    else skipped.add(entry.hunkId);
    if (!isStr(entry?.reason)) errors.push(`${p}.reason: required string`);
  });

  // A snippet (`mr-cast snippet`) is context the author chose to add, not a change of the diff.
  const changes = Object.values(hunks).filter((h) => h.status !== 'source');
  const tests = { shown: 0, total: 0 };
  for (const h of changes) {
    if (!isTestFile(h.file)) continue;
    tests.total++;
    if (shown.has(h.id)) tests.shown++;
  }
  const testsScenes = sb.scenes.filter((s) => s?.type === 'tests' && Array.isArray(s.cases) && Array.isArray(s.gaps));
  const testsScene = testsScenes.length
    ? { cases: testsScenes.reduce((n, s) => n + s.cases.length, 0), gaps: testsScenes.reduce((n, s) => n + s.gaps.length, 0) }
    : null;
  return { shown: [...shown].filter((id) => hunks[id].status !== 'source').length, skipped: skipped.size, total: changes.length, tests, testsScene, preread };
}

/** Checks a non-empty array of items with unique string ids; returns the id set, or null if the array is unusable. */
function checkIds(items, path, errors, checkItem) {
  if (!Array.isArray(items) || items.length === 0) { errors.push(`${path}: required non-empty array`); return null; }
  const ids = new Set();
  items.forEach((item, i) => {
    const q = `${path}[${i}]`;
    if (!isStr(item?.id)) errors.push(`${q}.id: required string`);
    else if (ids.has(item.id)) errors.push(`${q}.id: duplicate id "${item.id}"`);
    else ids.add(item.id);
    checkItem(item, q);
  });
  return ids;
}

/**
 * Mermaid's parser runs in Node except that it sanitizes labels with DOMPurify, which has no hooks or
 * sanitize() without a DOM. Validation discards the parsed labels, so pass-through stand-ins suffice.
 */
async function loadMermaidParser() {
  const { default: DOMPurify } = await import('dompurify');
  Object.assign(DOMPurify, { addHook() {}, removeHook() {}, removeHooks() {}, sanitize: (html) => html });
  const { default: mermaid } = await import('mermaid');
  return mermaid;
}

/** Mermaid's message on one line, without the caret line that only lines up in monospace. */
function mermaidMessage(err) {
  return String(err?.message ?? err).split('\n').map((l) => l.trim()).filter((l) => l && !/^-*\^$/.test(l)).join(' ');
}

async function checkMermaid(diagrams, errors, warnings) {
  if (diagrams.length === 0) return;
  let mermaid;
  try {
    mermaid = await loadMermaidParser();
  } catch (err) {
    warnings.push(`could not load Mermaid to check diagram syntax (${err.message}); run \`mr-cast still\` on mermaid scenes`);
    return;
  }
  for (const { p, code } of diagrams) {
    try {
      await mermaid.parse(code);
    } catch (err) {
      // Syntax errors are plain Errors; a TypeError means the Node stand-ins fell short, not that the diagram is wrong.
      if (err instanceof TypeError) warnings.push(`${p}.code: could not check Mermaid syntax (${err.message}); run \`mr-cast still\` on this scene`);
      else errors.push(`${p}.code: invalid Mermaid: ${mermaidMessage(err)}`);
    }
  }
}

/**
 * @param {{ mode?: 'diff' | 'explain', audience?: string, plan?: object | null }} meta  The mode from meta.json:
 *   "explain" (`mr-cast init`) narrates source snippets instead of a diff, so it has no coverage, risk or `skipped`.
 *   A pre-read (`audience` "preread") shows no code and lists the diff in its reading order; any other audience
 *   is a plain video. The run's plan.json as `readPlan` read it, when it has one: each scene's topic must name one
 *   of its topics. Errors are what would not render or name something that does not exist; warnings report what
 *   only rendering shows, such as text that does not fit, or two parts of the storyboard that disagree.
 */
export async function validateStoryboard(raw, hunks, { mode = 'diff', audience, plan = null } = {}) {
  // An older `arch` scene is a `graph`: renamed here so every check below sees one name.
  const sb = upgradeTypes(raw);
  const errors = [];
  const warnings = [];
  const diagrams = [];
  if (!sb || typeof sb !== 'object') return { errors: ['storyboard must be a JSON object'], warnings };
  if (!isStr(sb.title)) errors.push('title: required string');
  if (!Array.isArray(sb.scenes) || sb.scenes.length === 0) {
    errors.push('scenes: required non-empty array');
    return { errors, warnings };
  }

  sb.scenes.forEach((s, i) => {
    const p = `scenes[${i}]`;
    const errorsBefore = errors.length;
    if (!s || typeof s !== 'object') return errors.push(`${p}: must be an object`);
    if (!TYPES.includes(s.type)) return errors.push(`${p}.type: must be one of ${TYPES.join(', ')} (got ${JSON.stringify(s.type)})`);
    if (!isStr(s.narration)) errors.push(`${p}.narration: required string`);
    if (s.chapter !== undefined && typeof s.chapter !== 'string') errors.push(`${p}.chapter: must be a string`);

    switch (s.type) {
      case 'intent':
        if (!isStr(s.summary)) errors.push(`${p}.summary: required string`);
        if (s.risk !== undefined && !RISKS.includes(s.risk)) errors.push(`${p}.risk: must be one of ${RISKS.join(', ')}`);
        if (!Array.isArray(s.bullets) || !s.bullets.every(isStr)) errors.push(`${p}.bullets: required array of strings`);
        else if (s.bullets.length > INTENT_BULLETS_MAX) errors.push(`${p}.bullets: ${s.bullets.length} bullets; the card holds ${INTENT_BULLETS_MAX}, so keep the ones that matter most and say the rest`);
        break;

      case 'graph':
        checkGraph(s, p, errors, warnings);
        break;

      case 'code': {
        const hunk = isStr(s.hunkId) && hunks && Object.hasOwn(hunks, s.hunkId) ? hunks[s.hunkId] : undefined;
        if (!isStr(s.hunkId)) errors.push(`${p}.hunkId: required string`);
        else if (!hunk) errors.push(`${p}.hunkId: "${s.hunkId}" not found in hunks.json`);
        if (s.view !== undefined && !VIEWS.includes(s.view)) errors.push(`${p}.view: must be one of ${VIEWS.join(', ')}`);
        if (s.calloutText !== undefined && typeof s.calloutText !== 'string') errors.push(`${p}.calloutText: must be a string`);
        if (s.steps !== undefined) {
          checkCodeSteps(s, hunk, p, errors, warnings);
          break;
        }
        const afterOk = checkLineRefs(s.focusLinesAfter, `${p}.focusLinesAfter`, errors);
        const beforeOk = checkLineRefs(s.focusLinesBefore, `${p}.focusLinesBefore`, errors);
        if (hunk && afterOk) checkFocusInHunk(s.focusLinesAfter, hunk, 'new', `${p}.focusLinesAfter`, warnings);
        if (hunk && beforeOk) checkFocusInHunk(s.focusLinesBefore, hunk, 'old', `${p}.focusLinesBefore`, warnings);
        const refsOk = (afterOk || s.focusLinesAfter === undefined) && (beforeOk || s.focusLinesBefore === undefined);
        if (s.flow !== undefined) checkCodeFlow(s, refsOk ? hunk : undefined, refsOk, p, errors, warnings);
        break;
      }

      case 'flow':
        if (!Array.isArray(s.steps) || s.steps.length === 0) { errors.push(`${p}.steps: required non-empty array`); break; }
        s.steps.forEach((st, j) => {
          if (!isStr(st?.actor)) errors.push(`${p}.steps[${j}].actor: required string`);
          if (!isStr(st?.action)) errors.push(`${p}.steps[${j}].action: required string`);
          if (st?.payload !== undefined && typeof st.payload !== 'string') errors.push(`${p}.steps[${j}].payload: must be a string (stringify JSON yourself)`);
          checkIcon(st?.icon, `${p}.steps[${j}].icon`, errors);
          if (st?.tone !== undefined && !TONES.includes(st.tone)) errors.push(`${p}.steps[${j}].tone: must be one of ${TONES.join(', ')}`);
        });
        checkFlowSays(s, p, errors);
        break;

      case 'sequence': {
        const ids = checkIds(s.participants, `${p}.participants`, errors, (n, q) => checkNodeFields(n, q, errors, warnings));
        if (!ids) break;
        if (ids.size > 6) warnings.push(`${p}.participants: ${ids.size} participants; more than 6 get cramped`);
        if (!Array.isArray(s.messages) || s.messages.length === 0) { errors.push(`${p}.messages: required non-empty array`); break; }
        s.messages.forEach((m, j) => {
          const q = `${p}.messages[${j}]`;
          for (const k of ['from', 'to']) if (!ids.has(m?.[k])) errors.push(`${q}.${k}: unknown participant id ${JSON.stringify(m?.[k])}`);
          if (!isStr(m?.label)) errors.push(`${q}.label: required string`);
          if (m?.kind !== undefined && !MESSAGE_KINDS.includes(m.kind)) errors.push(`${q}.kind: must be one of ${MESSAGE_KINDS.join(', ')}`);
          if (m?.note !== undefined && typeof m.note !== 'string') errors.push(`${q}.note: must be a string`);
        });
        break;
      }

      case 'er': {
        const ids = checkIds(s.entities, `${p}.entities`, errors, (e, q) => {
          if (!isStr(e?.name)) errors.push(`${q}.name: required string`);
          if (!Array.isArray(e?.fields) || e.fields.length === 0) return errors.push(`${q}.fields: required non-empty array`);
          e.fields.forEach((f, k) => {
            if (!isStr(f?.name)) errors.push(`${q}.fields[${k}].name: required string`);
            if (f?.type !== undefined && typeof f.type !== 'string') errors.push(`${q}.fields[${k}].type: must be a string`);
          });
        });
        if (!ids) break;
        if (ids.size > 6) warnings.push(`${p}.entities: ${ids.size} entities; more than 6 get cramped`);
        if (!Array.isArray(s.relations)) { errors.push(`${p}.relations: required array (may be empty)`); break; }
        s.relations.forEach((r, j) => {
          const q = `${p}.relations[${j}]`;
          for (const k of ['from', 'to']) if (!ids.has(r?.[k])) errors.push(`${q}.${k}: unknown entity id ${JSON.stringify(r?.[k])}`);
          if (!CARDINALITIES.includes(r?.cardinality)) errors.push(`${q}.cardinality: must be one of ${CARDINALITIES.join(', ')}`);
        });
        break;
      }

      case 'state': {
        const ids = checkIds(s.states, `${p}.states`, errors, (n, q) => {
          if (!isStr(n?.label)) errors.push(`${q}.label: required string`);
          if (n?.final !== undefined && typeof n.final !== 'boolean') errors.push(`${q}.final: must be a boolean`);
        });
        if (!ids) break;
        if (ids.size > 10) warnings.push(`${p}.states: ${ids.size} states; more than 10 get cramped`);
        if (s.initial !== undefined && !ids.has(s.initial)) errors.push(`${p}.initial: unknown state id ${JSON.stringify(s.initial)}`);
        if (!Array.isArray(s.transitions)) { errors.push(`${p}.transitions: required array (may be empty)`); break; }
        s.transitions.forEach((t, j) => {
          const q = `${p}.transitions[${j}]`;
          for (const k of ['from', 'to']) if (!ids.has(t?.[k])) errors.push(`${q}.${k}: unknown state id ${JSON.stringify(t?.[k])}`);
          if (t?.label !== undefined && typeof t.label !== 'string') errors.push(`${q}.label: must be a string`);
        });
        break;
      }

      case 'tests': {
        for (const k of ['title', 'subject']) if (s[k] !== undefined && typeof s[k] !== 'string') errors.push(`${p}.${k}: must be a string`);
        const casesOk = Array.isArray(s.cases);
        const gapsOk = Array.isArray(s.gaps) && s.gaps.every(isStr);
        if (!casesOk) errors.push(`${p}.cases: required array of { name, proves } (use [] when the change has no tests)`);
        else {
          s.cases.forEach((c, j) => {
            const q = `${p}.cases[${j}]`;
            if (!isStr(c?.name)) errors.push(`${q}.name: required string, the test's name as written in code`);
            if (!isStr(c?.proves)) errors.push(`${q}.proves: required string, the behavior the test proves in plain words`);
            if (c?.status !== undefined && !TEST_STATUSES.includes(c.status)) errors.push(`${q}.status: must be one of ${TEST_STATUSES.join(', ')}`);
            if (c?.hunkId !== undefined && !(isStr(c.hunkId) && hunks && Object.hasOwn(hunks, c.hunkId))) errors.push(`${q}.hunkId: "${c.hunkId}" not found in hunks.json`);
          });
          if (s.cases.length > TEST_CASES_MAX) warnings.push(`${p}.cases: ${s.cases.length} cases; more than ${TEST_CASES_MAX} get cramped`);
        }
        if (!gapsOk) errors.push(`${p}.gaps: required array of strings, the behaviors no test covers (may be empty)`);
        break;
      }

      case 'table':
        checkTable(s, p, errors, warnings);
        break;

      case 'chart':
        checkChart(s, p, errors, warnings);
        break;

      case 'timeline':
        checkTimeline(s, p, errors, warnings);
        break;

      case 'layers':
        checkLayers(s, p, errors, warnings);
        break;

      case 'files':
        checkFiles(s, p, errors, warnings, hunks ?? {}, mode);
        break;

      case 'compare':
        checkCompare(s, p, errors, warnings);
        break;

      case 'terminal':
        checkTerminal(s, p, errors, warnings);
        break;

      case 'array':
        checkArray(s, p, errors, warnings);
        break;

      case 'memory':
        checkMemory(s, p, errors, warnings);
        break;

      case 'reading':
        break;

      case 'review':
        if (s.title !== undefined && typeof s.title !== 'string') errors.push(`${p}.title: must be a string`);
        if (s.steps !== undefined) errors.push(`${p}.steps: a review scene takes no steps; its narration recaps the findings, and each was said where its code was shown`);
        break;

      case 'mermaid':
        if (!isStr(s.code)) errors.push(`${p}.code: required string of Mermaid source`);
        else diagrams.push({ p, code: s.code });
        break;
    }
    checkFocusSteps(s, p, hunks ?? {}, errors, warnings);
    // The highlight check trusts the scene's own schema, not the others'.
    if (errors.length === errorsBefore) checkHighlight(s, p, hunks ?? {}, warnings);
    checkPenMarks(s, p, hunks ?? {}, errors, warnings);
    checkSpokenMarkup(s, p, warnings);
  });

  const preread = audience === 'preread';
  const listed = checkPreread(sb, hunks ?? {}, { preread, mode }, errors, warnings);
  checkMarks(sb, hunks ?? {}, mode, errors, warnings);
  checkTopics(sb, plan, errors, warnings, { preread });
  checkReview(sb, hunks ?? {}, mode, errors, warnings, { preread });
  await checkMermaid(diagrams, errors, warnings);
  // The layouts trust the schema, so text is fitted only once everything else is valid.
  if (!errors.length) await checkFit(normalizeStoryboard(sb, hunks ?? {}), hunks ?? {}, errors, warnings);
  checkSpokenCounts(sb.scenes, warnings);
  if (mode === 'explain') {
    if (sb.skipped !== undefined) warnings.push('skipped: lists diff hunks left out of a review; an explanation has none, so remove it');
    return { errors, warnings, coverage: null };
  }
  const coverage = checkCoverage(sb, hunks ?? {}, audience, listed, errors, warnings);
  return { errors, warnings, coverage };
}

export function storyboardSeconds(sb, voiceover) {
  return (sb.scenes ?? []).reduce((sum, s) => sum + sceneDurationInFrames(s, voiceover), 0) / FPS;
}
