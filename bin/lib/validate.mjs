// Storyboard validation, mirroring src/types.ts. Returns human/LLM-readable error strings.

import { expandLineRefs, focusRanges, focusStepOrder, sceneFocusRanges } from '../../shared/focus.mjs';
import { isTestFile } from '../../shared/test-files.mjs';
import { FPS, sceneDurationInFrames, wordCount } from '../../shared/timing.mjs';
import { checkGraph, checkIcon, checkNodeFields } from './validate-diagram.mjs';
import { checkFocusSteps } from './validate-focus.mjs';
import { checkMarks } from './validate-marks.mjs';
import { checkPenMarks } from './validate-pen-marks.mjs';
import { checkReview } from './validate-review.mjs';
import { checkVoice, sentences } from './validate-voice.mjs';
import { checkFit, checkSpokenMarkup } from './validate-fit.mjs';
import { normalizeStoryboard, upgradeTypes } from '../../shared/normalize.mjs';
import { TONES, checkChart, checkFiles, checkFlowSays, checkTable, checkTimeline } from './validate-scenes.mjs';
import { checkCompare } from './validate-compare.mjs';
import { checkTerminal } from './validate-terminal.mjs';

const RISKS = ['low', 'medium', 'high'];
const VIEWS = ['split', 'morph'];
const TYPES = ['intent', 'graph', 'code', 'flow', 'sequence', 'er', 'state', 'mermaid', 'tests', 'table', 'chart', 'timeline', 'files', 'review', 'compare', 'terminal'];
const MESSAGE_KINDS = ['call', 'return', 'async'];
const CARDINALITIES = ['one-to-one', 'one-to-many', 'many-to-many'];
const TEST_STATUSES = ['added', 'modified', 'removed', 'existing'];
const TEST_CASES_MAX = 10;
const TEST_GAPS_MAX = 4;
const INTENT_BULLETS_MAX = 6;
// A longer sequence scrolls under its participants; past this many messages it is better told as two.
const SEQUENCE_MESSAGES_MAX = 24;

const MAX_LINE_RANGE = 10000;
// A code scene walks its focus ranges top to bottom; long or many ranges turn it back into a wall of code.
// The simple style explains a line or two at a time, so its ranges are shorter.
const RANGE_LIMITS = { standard: { comfortable: 8, max: 15 }, simple: { comfortable: 3, max: 6 } };
// Simple style is written for a viewer reading subtitles in a second language: short sentences.
const SIMPLE_SENTENCE_MAX = 18;
const SIMPLE_SENTENCE_AVG = 12;
const FOCUS_RANGES_PER_SCENE = 3;
// With a flow diagram each range gets a labelled step beside the code, so one more stays readable.
const FOCUS_RANGES_WITH_FLOW = 4;
// Each step has its own words and time, so a stepped scene can walk more ranges before it drags.
const STEPS_PER_SCENE = 8;
// The step diagram beside the code fits this many labelled nodes above the callout at its smallest font.
const LABELLED_STEPS_MAX = 6;
const UNFOCUSED_CHANGE_MAX = 12;
// A step label beside the code wraps to two lines; longer than this and it stops reading as a step.
const FLOW_LABEL_MAX = 60;
// A hunk this large changes enough that leaving it out of the video must be a stated choice.
const SUBSTANTIAL_HUNK_LINES = 15;

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

function checkFocusSize(scene, hunk, limits, p, errors, warnings) {
  const sides = [
    { key: 'focusLinesAfter', ranges: focusRanges(scene.focusLinesAfter) },
    { key: 'focusLinesBefore', ranges: focusRanges(scene.focusLinesBefore) },
  ];
  for (const { key, ranges } of sides) {
    for (const [a, b] of ranges) {
      const size = b - a + 1;
      if (size <= limits.comfortable) continue;
      const msg = `${p}.${key}: range ${a}-${b} is ${size} lines; highlight at most ${limits.comfortable} (${limits.max} max) and move the rest to another code scene`;
      (size > limits.max ? errors : warnings).push(msg);
    }
  }
  const used = sides.filter((s) => s.ranges.length);
  const count = used.reduce((n, s) => n + s.ranges.length, 0);
  const maxRanges = scene.flow === undefined ? FOCUS_RANGES_PER_SCENE : FOCUS_RANGES_WITH_FLOW;
  if (count > maxRanges) {
    const list = used.map((s) => `${s.key} ${s.ranges.map(formatRange).join(', ')}`).join('; ');
    warnings.push(`${p}: ${count} focus ranges (${list}); keep at most ${maxRanges} per scene and split the rest into another code scene`);
  }
  if (count > 0 || !hunk) return;
  // Without focus a diff hunk highlights its changed lines and a source snippet highlights all of them.
  if (hunk.status === 'source') {
    if (hunk.lines.length > UNFOCUSED_CHANGE_MAX) errors.push(`${p}: snippet ${hunk.id} is ${hunk.lines.length} lines and the scene sets no focus; set focusLinesAfter to the at most ${limits.comfortable} lines the narration discusses`);
  } else if (hunk.additions + hunk.deletions > UNFOCUSED_CHANGE_MAX) {
    errors.push(`${p}: hunk ${hunk.id} changes ${hunk.additions + hunk.deletions} lines and the scene sets no focus; set focusLinesAfter (or focusLinesBefore for deletions) to the at most ${limits.comfortable} lines the narration discusses`);
  }
}

/** A code scene's `flow` names one step per focus range, in the order the ranges play. */
function checkCodeFlow(scene, hunk, refsOk, p, errors, warnings) {
  const { flow } = scene;
  if (!Array.isArray(flow) || flow.length === 0) return errors.push(`${p}.flow: must be a non-empty array of { label, outcome? }`);
  flow.forEach((step, j) => {
    const q = `${p}.flow[${j}]`;
    if (!isStr(step?.label)) return errors.push(`${q}.label: required string`);
    if (step.label.trim().length > FLOW_LABEL_MAX) warnings.push(`${q}.label: ${step.label.trim().length} characters; keep a step under ${FLOW_LABEL_MAX} so it reads at a glance`);
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
function checkCodeSteps(scene, hunk, limits, p, errors, warnings) {
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
      else {
        labelled++;
        if (step.label.trim().length > FLOW_LABEL_MAX) warnings.push(`${q}.label: ${step.label.trim().length} characters; keep a step under ${FLOW_LABEL_MAX} so it reads at a glance`);
      }
    }
    if (step.outcome !== undefined && typeof step.outcome !== 'string') errors.push(`${q}.outcome: must be a string`);
  });
  if (labelled && labelled < steps.length) errors.push(`${p}.steps: ${labelled} of ${steps.length} steps have a label; label every step to draw the flow diagram beside the code, or none`);
  else if (labelled > LABELLED_STEPS_MAX) warnings.push(`${p}.steps: ${labelled} labelled steps; the step diagram beside the code fits ${LABELLED_STEPS_MAX}, so split the scene or drop the labels`);
  if (steps.length > STEPS_PER_SCENE) warnings.push(`${p}.steps: ${steps.length} steps; keep at most ${STEPS_PER_SCENE} per scene and walk the rest of ${scene.hunkId} in another code scene`);
  if (!refsOk) return;

  const ranges = sceneFocusRanges(scene);
  ranges.forEach(({ side, range: [a, b] }, j) => {
    const q = `${p}.steps[${j}].${side === 'oldLine' ? 'oldLines' : 'lines'}`;
    const size = b - a + 1;
    if (size > limits.comfortable) {
      (size > limits.max ? errors : warnings).push(`${q}: ${a}-${b} is ${size} lines; a step highlights at most ${limits.comfortable} (${limits.max} max), so split it into more steps`);
    }
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

const hunkSize = (h) => (h.deletions ? `+${h.additions} -${h.deletions}` : `+${h.additions}`);

/**
 * Every hunk a reviewer needs must be shown in a code scene or listed in `skipped` with a reason.
 * Returns the counts behind validate's summary line.
 */
function checkCoverage(sb, hunks, errors, warnings) {
  // A tests scene that links a case to its hunk walks through that hunk as much as a code scene does.
  const shownIds = sb.scenes.flatMap((s) => {
    if (s?.type === 'code') return [s.hunkId];
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
    if (!isStr(entry?.reason)) errors.push(`${p}.reason: required; say in a few words why a reviewer can skip this hunk ("formatting only", "generated lockfile")`);
  });

  // A snippet (`mr-cast snippet`) is context the author chose to add, not a change a reviewer must see.
  const changes = Object.values(hunks).filter((h) => h.status !== 'source');
  const tests = { shown: 0, total: 0 };
  for (const h of changes) {
    const isTest = isTestFile(h.file);
    if (isTest) {
      tests.total++;
      if (shown.has(h.id)) tests.shown++;
    }
    if (shown.has(h.id) || skipped.has(h.id)) continue;
    if (isTest) warnings.push(`${h.id} ${h.file} (${hunkSize(h)}): changed tests are not walked through; link it from a tests scene case (hunkId), show it in a code scene, or list ${h.id} in skipped with a reason`);
    else if (h.additions + h.deletions >= SUBSTANTIAL_HUNK_LINES) warnings.push(`${h.id} ${h.file} (${hunkSize(h)}) is not shown; add a code scene or list it in skipped with a reason`);
  }
  const testsScenes = sb.scenes.filter((s) => s?.type === 'tests' && Array.isArray(s.cases) && Array.isArray(s.gaps));
  const testsScene = testsScenes.length
    ? { cases: testsScenes.reduce((n, s) => n + s.cases.length, 0), gaps: testsScenes.reduce((n, s) => n + s.gaps.length, 0) }
    : null;
  return { shown: [...shown].filter((id) => hunks[id].status !== 'source').length, skipped: skipped.size, total: changes.length, tests, testsScene };
}

const DIAGRAM_TYPES = ['graph', 'sequence', 'flow', 'er', 'state', 'mermaid'];
// Overview scenes that draw facts or the list of files rather than structure: they belong before the code,
// but do not show how the pieces fit.
const OVERVIEW_TYPES = ['table', 'chart', 'timeline', 'files'];
// Prose and config: changing them alone gives a reviewer no component interaction to draw.
const NON_LOGIC_LANGUAGES = ['markdown', 'json', 'yaml', 'toml', 'text'];

/**
 * Top-down order (overview, diagrams, code, tests) and a tests scene that says what is and is not
 * tested. An explanation has no diff, so only the overview-then-diagrams-then-code order applies.
 * Runs on scenes whose type is valid; per-scene errors are reported elsewhere.
 */
function checkStoryShape(scenes, hunks, mode, warnings) {
  const explain = mode === 'explain';
  // Snippets are unchanged source, so they neither change logic nor count as changed tests.
  const all = Object.values(hunks).filter((h) => h.status !== 'source');
  const isTestHunk = (id) => Object.hasOwn(hunks, id) && isTestFile(hunks[id].file);
  const logicFiles = [...new Set(all.filter((h) => !isTestFile(h.file) && !NON_LOGIC_LANGUAGES.includes(h.language)).map((h) => h.file))];
  const testHunks = all.filter((h) => isTestFile(h.file)).map((h) => h.id);
  const indexed = scenes.map((s, i) => ({ s, i })).filter(({ s }) => TYPES.includes(s?.type));
  const firstOf = (pred) => indexed.find(({ s }) => pred(s))?.i ?? -1;

  const first = indexed[0];
  if (first && first.s.type !== 'intent') {
    const opening = explain ? 'the idea and its key points' : 'the problem and the review concerns';
    warnings.push(`scenes[${first.i}] is a ${first.s.type} scene; open with an intent scene that states ${opening}`);
  }

  const firstDiagram = firstOf((s) => DIAGRAM_TYPES.includes(s.type));
  const firstCode = firstOf((s) => s.type === 'code');
  if (firstDiagram > firstCode && firstCode >= 0) {
    warnings.push(`scenes[${firstCode}] shows code before the first diagram (scenes[${firstDiagram}]); move a diagram ahead of the code so the viewer sees the shape of the ${explain ? 'idea' : 'change'} first`);
  } else if (explain && firstDiagram < 0 && firstCode >= 0) {
    warnings.push('no scene draws the idea before the code; add a graph, sequence, flow, er or state scene ahead of the first code scene');
  } else if (!explain && firstDiagram < 0 && logicFiles.length >= 2) {
    const names = logicFiles.slice(0, 4).join(', ') + (logicFiles.length > 4 ? ', ...' : '');
    warnings.push(`the diff changes logic in ${logicFiles.length} files (${names}) and no scene draws how they fit together; add a graph, sequence, flow, er or state scene before the code`);
  }
  if (firstCode >= 0) {
    for (const { s, i } of indexed) {
      if (i > firstCode && (DIAGRAM_TYPES.includes(s.type) || OVERVIEW_TYPES.includes(s.type))) {
        const title = s.chapter ? `, "${s.chapter}"` : '';
        warnings.push(`scenes[${i}] (${s.type}${title}) comes after code scenes[${firstCode}]..; move the high-level diagrams ahead of the code so the walkthrough goes overview, diagrams, code, tests`);
      }
    }
  }
  const codeCount = indexed.filter(({ s }) => s.type === 'code').length;
  const diagramCount = indexed.filter(({ s }) => DIAGRAM_TYPES.includes(s.type)).length;
  if (codeCount >= 4 && diagramCount < 2) {
    warnings.push(`${codeCount} code scenes but only ${diagramCount} diagram scene${diagramCount === 1 ? '' : 's'}; draw more of the ${explain ? 'idea' : 'change'} before the code, such as a sequence for a call chain across functions or services, a state for a status or lifecycle, a flow for data moving through steps, or an er for a data model`);
  }
  if (explain) return;

  const firstLogicCode = firstOf((s) => s.type === 'code' && Object.hasOwn(hunks, s.hunkId) && !isTestHunk(s.hunkId));
  if (firstLogicCode >= 0) {
    for (const { s, i } of indexed) {
      if (i >= firstLogicCode) break;
      if (s.type === 'tests' || (s.type === 'code' && isTestHunk(s.hunkId))) {
        warnings.push(`scenes[${i}] shows tests before the code they test (first code scene is scenes[${firstLogicCode}]); move it after the code`);
      }
    }
  }

  const hasTestsScene = indexed.some(({ s }) => s.type === 'tests');
  if (hasTestsScene) return;
  if (testHunks.length) {
    warnings.push(`the diff changes tests (${testHunks.join(', ')}) and no tests scene lists them; add a tests scene after the code with each case, what it proves, and the important behaviors left untested`);
  } else if (logicFiles.length) {
    warnings.push('the diff changes no tests; add a tests scene with "cases": [] and "gaps" listing the important behaviors this change leaves untested');
  }
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

/** Diagrams where the viewer learns the names every later scene uses, so their narration stays short. */
const DIAGRAM_WORDS_LIMITED = ['graph', 'sequence'];
const DIAGRAM_WORDS_MAX = 35;

const excerpt = (text) => (text.length > 50 ? `${text.slice(0, 47)}...` : text);

/** Simple style: every spoken text of the scene in short sentences, for a viewer reading in a second language. */
function checkReadability(scene, p, warnings) {
  const spoken = [[`${p}.narration`, scene.narration]];
  if (Array.isArray(scene.steps)) scene.steps.forEach((step, j) => spoken.push([`${p}.steps[${j}].say`, step?.say]));
  let total = 0;
  let count = 0;
  for (const [path, text] of spoken) {
    for (const sentence of sentences(text)) {
      const words = wordCount(sentence);
      total += words;
      count++;
      if (words > SIMPLE_SENTENCE_MAX) warnings.push(`${path}: a sentence of ${words} words ("${excerpt(sentence)}"); in simple style keep each sentence under ${SIMPLE_SENTENCE_MAX} words`);
    }
  }
  if (count && total / count > SIMPLE_SENTENCE_AVG) warnings.push(`${p}: sentences average ${Math.round(total / count)} words; in simple style keep them around ${SIMPLE_SENTENCE_AVG} or fewer`);
}

/**
 * Simple style: every changed line of a hunk the video shows is inside a step of some scene showing it.
 * A scene without an explicit focus is already told to add steps, so its hunk is not listed again.
 */
function checkSimpleLineCoverage(sb, hunks, warnings) {
  const scenesOf = new Map();
  sb.scenes.forEach((s, i) => {
    if (s?.type !== 'code' || !Object.hasOwn(hunks, s.hunkId) || hunks[s.hunkId].status === 'source') return;
    if (!scenesOf.has(s.hunkId)) scenesOf.set(s.hunkId, []);
    scenesOf.get(s.hunkId).push({ scene: s, i });
  });
  for (const [hunkId, shown] of scenesOf) {
    const hunk = hunks[hunkId];
    const ranges = shown.map(({ scene }) => sceneFocusRanges(scene));
    if (ranges.some((r) => r.length === 0)) continue;
    const covered = (line) => ranges.flat().some(({ side, range: [a, b] }) => line[side] !== null && line[side] >= a && line[side] <= b);
    const missed = hunk.lines.filter((line) => line.type !== 'context' && line.text.trim() !== '' && !covered(line));
    if (!missed.length) continue;
    const parts = [];
    const adds = missed.filter((l) => l.type === 'add').map((l) => l.newLine);
    const dels = missed.filter((l) => l.type === 'del').map((l) => l.oldLine);
    if (adds.length) parts.push(`new-file ${plural(adds.length, 'line')} ${focusRanges(adds).map(formatRange).join(', ')}`);
    if (dels.length) parts.push(`old-file ${plural(dels.length, 'line')} ${focusRanges(dels).map(formatRange).join(', ')}`);
    const where = shown.map(({ i }) => `scenes[${i}]`).join(', ');
    warnings.push(`${hunkId} ${hunk.file}: no step of ${where} covers changed ${parts.join(' or ')}; in simple style every changed line gets a step`);
  }
}

/**
 * @param {{ mode?: 'diff' | 'explain', style?: 'simple' }} meta  The mode from meta.json: "explain" (`mr-cast init`)
 *   narrates source snippets instead of a diff, so diff coverage, test and risk rules do not apply. The style
 *   from the command's flags: "simple" (`--audience new`) is explained line by line in plain words, so steps are short, every changed
 *   line of a shown hunk has a step, and sentences stay short.
 */
export async function validateStoryboard(raw, hunks, { mode = 'diff', style } = {}) {
  // An older `arch` scene is a `graph`: renamed here so every check below sees one name.
  const sb = upgradeTypes(raw);
  const errors = [];
  const warnings = [];
  const diagrams = [];
  const simple = style === 'simple';
  const limits = simple ? RANGE_LIMITS.simple : RANGE_LIMITS.standard;
  if (!sb || typeof sb !== 'object') return { errors: ['storyboard must be a JSON object'], warnings };
  if (!isStr(sb.title)) errors.push('title: required string');
  if (!Array.isArray(sb.scenes) || sb.scenes.length === 0) {
    errors.push('scenes: required non-empty array');
    return { errors, warnings };
  }

  sb.scenes.forEach((s, i) => {
    const p = `scenes[${i}]`;
    if (!s || typeof s !== 'object') return errors.push(`${p}: must be an object`);
    if (!TYPES.includes(s.type)) return errors.push(`${p}.type: must be one of ${TYPES.join(', ')} (got ${JSON.stringify(s.type)})`);
    if (!isStr(s.narration)) errors.push(`${p}.narration: required string`);
    if (s.chapter !== undefined && typeof s.chapter !== 'string') errors.push(`${p}.chapter: must be a string`);
    if (simple) checkReadability(s, p, warnings);
    const words = wordCount(s.narration);
    if (DIAGRAM_WORDS_LIMITED.includes(s.type) && words > DIAGRAM_WORDS_MAX) warnings.push(`${p}.narration: ${words} words over the ${s.type} diagram; keep it to ${DIAGRAM_WORDS_MAX} so the viewer can take the diagram in, and move the rest into steps or a later scene`);

    switch (s.type) {
      case 'intent':
        if (!isStr(s.summary)) errors.push(`${p}.summary: required string`);
        if ((mode === 'diff' || s.risk !== undefined) && !RISKS.includes(s.risk)) errors.push(`${p}.risk: must be one of ${RISKS.join(', ')}`);
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
          checkCodeSteps(s, hunk, limits, p, errors, warnings);
          break;
        }
        if (simple) warnings.push(`${p}: simple style walks the code line by line; replace focusLinesAfter and flow with steps, each with the words to say over its lines`);
        const afterOk = checkLineRefs(s.focusLinesAfter, `${p}.focusLinesAfter`, errors);
        const beforeOk = checkLineRefs(s.focusLinesBefore, `${p}.focusLinesBefore`, errors);
        if (hunk && afterOk) checkFocusInHunk(s.focusLinesAfter, hunk, 'new', `${p}.focusLinesAfter`, warnings);
        if (hunk && beforeOk) checkFocusInHunk(s.focusLinesBefore, hunk, 'old', `${p}.focusLinesBefore`, warnings);
        if ((afterOk || s.focusLinesAfter === undefined) && (beforeOk || s.focusLinesBefore === undefined)) checkFocusSize(s, hunk, limits, p, errors, warnings);
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
        if (s.steps.length > 8) warnings.push(`${p}.steps: ${s.steps.length} steps; consider splitting into two flow scenes`);
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
        if (s.messages.length > SEQUENCE_MESSAGES_MAX) warnings.push(`${p}.messages: ${s.messages.length} messages; past ${SEQUENCE_MESSAGES_MAX} the scene scrolls for a long time, so consider splitting it into two sequence scenes`);
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
          if (e.fields.length > 10) warnings.push(`${q}.fields: ${e.fields.length} fields; show only the ones the change touches plus keys`);
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
          if (s.cases.length > TEST_CASES_MAX) warnings.push(`${p}.cases: ${s.cases.length} cases; more than ${TEST_CASES_MAX} get cramped, so split them into two tests scenes by subject`);
        }
        if (!gapsOk) errors.push(`${p}.gaps: required array of strings, the important behaviors no test covers ([] if you checked and found none)`);
        else if (s.gaps.length > TEST_GAPS_MAX) warnings.push(`${p}.gaps: ${s.gaps.length} gaps; keep the ${TEST_GAPS_MAX} that matter most to a reviewer`);
        if (casesOk && gapsOk && s.cases.length === 0 && s.gaps.length === 0) {
          errors.push(`${p}: no cases and no gaps; list the tests that cover this change, or if it has none, list in gaps the behaviors it introduces that nothing tests`);
        }
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

      case 'files':
        checkFiles(s, p, errors, warnings, hunks ?? {}, mode);
        break;

      case 'compare':
        checkCompare(s, p, errors, warnings);
        break;

      case 'terminal':
        checkTerminal(s, p, errors, warnings);
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
    checkPenMarks(s, p, hunks ?? {}, errors, warnings);
    checkSpokenMarkup(s, p, warnings);
  });

  checkMarks(sb, hunks ?? {}, mode, errors, warnings);
  checkReview(sb, hunks ?? {}, mode, errors, warnings);
  await checkMermaid(diagrams, errors, warnings);
  // The layouts trust the schema, so text is fitted only once everything else is valid.
  if (!errors.length) await checkFit(normalizeStoryboard(sb, hunks ?? {}), hunks ?? {}, errors, warnings);
  checkStoryShape(sb.scenes, hunks ?? {}, mode, warnings);
  checkVoice(sb, { simple }, warnings);
  if (simple) checkSimpleLineCoverage(sb, hunks ?? {}, warnings);
  if (mode === 'explain') {
    if (sb.skipped !== undefined) warnings.push('skipped: lists diff hunks left out of a review; an explanation has none, so remove it');
    return { errors, warnings, coverage: null };
  }
  const coverage = checkCoverage(sb, hunks ?? {}, errors, warnings);
  return { errors, warnings, coverage };
}

export function storyboardSeconds(sb, voiceover) {
  return (sb.scenes ?? []).reduce((sum, s) => sum + sceneDurationInFrames(s, voiceover), 0) / FPS;
}
