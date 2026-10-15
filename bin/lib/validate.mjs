// Storyboard validation, mirroring src/types.ts. Returns human/LLM-readable error strings.

import { expandLineRefs, focusRanges, focusStepOrder, sceneFocusRanges } from '../../shared/focus.mjs';
import { isTestFile } from '../../shared/test-files.mjs';
import { FPS, sceneDurationInFrames } from '../../shared/timing.mjs';

const RISKS = ['low', 'medium', 'high'];
const KINDS = ['service', 'db', 'queue', 'client'];
const VIEWS = ['split', 'morph'];
const TYPES = ['intent', 'arch', 'code', 'flow', 'sequence', 'er', 'state', 'mermaid', 'tests'];
const MESSAGE_KINDS = ['call', 'return', 'async'];
const CHANGES = ['added', 'removed', 'modified'];
const CARDINALITIES = ['one-to-one', 'one-to-many', 'many-to-many'];
const TEST_STATUSES = ['added', 'modified', 'removed', 'existing'];
const TEST_CASES_MAX = 10;
const TEST_GAPS_MAX = 4;

const MAX_LINE_RANGE = 10000;
// A code scene walks its focus ranges top to bottom; long or many ranges turn it back into a wall of code.
const FOCUS_RANGE_COMFORTABLE = 8;
const FOCUS_RANGE_MAX = 15;
const FOCUS_RANGES_PER_SCENE = 3;
// With a flow diagram each range gets a labelled step beside the code, so one more stays readable.
const FOCUS_RANGES_WITH_FLOW = 4;
const UNFOCUSED_CHANGE_MAX = 12;
// A step label beside the code wraps to two lines; longer than this and it stops reading as a step.
const FLOW_LABEL_MAX = 60;
// A hunk this large changes enough that leaving it out of the video must be a stated choice.
const SUBSTANTIAL_HUNK_LINES = 15;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

/** @returns {boolean} whether `refs` is present and every entry is a valid line ref */
function checkLineRefs(refs, path, errors) {
  if (refs === undefined) return false;
  if (!Array.isArray(refs)) {
    errors.push(`${path}: must be an array of line numbers or "a-b" ranges`);
    return false;
  }
  const before = errors.length;
  refs.forEach((r, i) => {
    if (typeof r === 'number' && Number.isInteger(r) && r > 0) return;
    const m = typeof r === 'string' && r.match(/^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/);
    if (!m) return errors.push(`${path}[${i}]: ${JSON.stringify(r)} is not a line number or "a-b" range`);
    if (m[2] !== undefined && Math.abs(m[2] - m[1]) > MAX_LINE_RANGE) {
      errors.push(`${path}[${i}]: range ${JSON.stringify(r)} spans more than ${MAX_LINE_RANGE} lines`);
    }
  });
  return errors.length === before;
}

function checkFocusInHunk(refs, hunk, side, path, warnings) {
  const valid = hunk.lines.map((l) => (side === 'new' ? l.newLine : l.oldLine)).filter((n) => n !== null);
  const missing = [...expandLineRefs(refs)].filter((n) => !valid.includes(n));
  if (!missing.length) return;
  const span = valid.length ? `${side}-file lines ${Math.min(...valid)}-${Math.max(...valid)}` : `no ${side}-file lines`;
  warnings.push(`${path}: lines ${missing.join(', ')} are outside ${hunk.id} (${span})`);
}

const formatRange = ([a, b]) => (a === b ? `${a}` : `${a}-${b}`);

function checkFocusSize(scene, hunk, p, errors, warnings) {
  const sides = [
    { key: 'focusLinesAfter', ranges: focusRanges(scene.focusLinesAfter) },
    { key: 'focusLinesBefore', ranges: focusRanges(scene.focusLinesBefore) },
  ];
  for (const { key, ranges } of sides) {
    for (const [a, b] of ranges) {
      const size = b - a + 1;
      if (size <= FOCUS_RANGE_COMFORTABLE) continue;
      const msg = `${p}.${key}: range ${a}-${b} is ${size} lines; highlight at most ${FOCUS_RANGE_COMFORTABLE} (${FOCUS_RANGE_MAX} max) and move the rest to another code scene`;
      (size > FOCUS_RANGE_MAX ? errors : warnings).push(msg);
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
    if (hunk.lines.length > UNFOCUSED_CHANGE_MAX) errors.push(`${p}: snippet ${hunk.id} is ${hunk.lines.length} lines and the scene sets no focus; set focusLinesAfter to the at most ${FOCUS_RANGE_COMFORTABLE} lines the narration discusses`);
  } else if (hunk.additions + hunk.deletions > UNFOCUSED_CHANGE_MAX) {
    errors.push(`${p}: hunk ${hunk.id} changes ${hunk.additions + hunk.deletions} lines and the scene sets no focus; set focusLinesAfter (or focusLinesBefore for deletions) to the at most ${FOCUS_RANGE_COMFORTABLE} lines the narration discusses`);
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

  const tests = { shown: 0, total: 0 };
  for (const h of Object.values(hunks)) {
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
  return { shown: shown.size, skipped: skipped.size, total: Object.keys(hunks).length, tests, testsScene };
}

const DIAGRAM_TYPES = ['arch', 'sequence', 'flow', 'er', 'state', 'mermaid'];
// Prose and config: changing them alone gives a reviewer no component interaction to draw.
const NON_LOGIC_LANGUAGES = ['markdown', 'json', 'yaml', 'toml', 'text'];

/**
 * Top-down order (overview, diagrams, code, tests) and a tests scene that says what is and is not
 * tested. An explanation has no diff, so only the overview-then-diagrams-then-code order applies.
 * Runs on scenes whose type is valid; per-scene errors are reported elsewhere.
 */
function checkStoryShape(scenes, hunks, mode, warnings) {
  const explain = mode === 'explain';
  const all = Object.values(hunks);
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
    warnings.push('no scene draws the idea before the code; add an arch, sequence, flow, er or state scene ahead of the first code scene');
  } else if (!explain && firstDiagram < 0 && logicFiles.length >= 2) {
    const names = logicFiles.slice(0, 4).join(', ') + (logicFiles.length > 4 ? ', ...' : '');
    warnings.push(`the diff changes logic in ${logicFiles.length} files (${names}) and no scene draws how they fit together; add an arch, sequence, flow, er or state scene before the code`);
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

/**
 * @param {'diff' | 'explain'} mode  "explain" (meta.json of `mr-cast explain init`) narrates source
 *   snippets instead of a diff, so diff coverage, test and risk rules do not apply.
 */
export async function validateStoryboard(sb, hunks, mode = 'diff') {
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
    if (!s || typeof s !== 'object') return errors.push(`${p}: must be an object`);
    if (!TYPES.includes(s.type)) return errors.push(`${p}.type: must be one of ${TYPES.join(', ')} (got ${JSON.stringify(s.type)})`);
    if (!isStr(s.narration)) errors.push(`${p}.narration: required string`);
    if (s.chapter !== undefined && typeof s.chapter !== 'string') errors.push(`${p}.chapter: must be a string`);

    switch (s.type) {
      case 'intent':
        if (!isStr(s.summary)) errors.push(`${p}.summary: required string`);
        if ((mode === 'diff' || s.risk !== undefined) && !RISKS.includes(s.risk)) errors.push(`${p}.risk: must be one of ${RISKS.join(', ')}`);
        if (!Array.isArray(s.bullets) || !s.bullets.every(isStr)) errors.push(`${p}.bullets: required array of strings`);
        else if (s.bullets.length > 6) warnings.push(`${p}.bullets: ${s.bullets.length} bullets; more than 6 will be cramped`);
        break;

      case 'arch': {
        if (!Array.isArray(s.nodes) || s.nodes.length === 0) { errors.push(`${p}.nodes: required non-empty array`); break; }
        const ids = new Set();
        s.nodes.forEach((n, j) => {
          if (!isStr(n?.id)) errors.push(`${p}.nodes[${j}].id: required string`);
          else if (ids.has(n.id)) errors.push(`${p}.nodes[${j}].id: duplicate id "${n.id}"`);
          else ids.add(n.id);
          if (!isStr(n?.label)) errors.push(`${p}.nodes[${j}].label: required string`);
          if (!KINDS.includes(n?.kind)) errors.push(`${p}.nodes[${j}].kind: must be one of ${KINDS.join(', ')}`);
          for (const k of ['x', 'y']) if (n && k in n) warnings.push(`${p}.nodes[${j}].${k}: ignored, layout is automatic`);
        });
        if (s.nodes.length > 12) warnings.push(`${p}.nodes: ${s.nodes.length} nodes; keep it under ~10 for legibility`);
        if (!Array.isArray(s.edges)) { errors.push(`${p}.edges: required array (may be empty)`); break; }
        s.edges.forEach((e, j) => {
          for (const k of ['from', 'to']) {
            if (!ids.has(e?.[k])) errors.push(`${p}.edges[${j}].${k}: unknown node id ${JSON.stringify(e?.[k])}`);
          }
        });
        break;
      }

      case 'code': {
        const hunk = isStr(s.hunkId) && hunks && Object.hasOwn(hunks, s.hunkId) ? hunks[s.hunkId] : undefined;
        if (!isStr(s.hunkId)) errors.push(`${p}.hunkId: required string`);
        else if (!hunk) errors.push(`${p}.hunkId: "${s.hunkId}" not found in hunks.json`);
        const afterOk = checkLineRefs(s.focusLinesAfter, `${p}.focusLinesAfter`, errors);
        const beforeOk = checkLineRefs(s.focusLinesBefore, `${p}.focusLinesBefore`, errors);
        if (hunk && afterOk) checkFocusInHunk(s.focusLinesAfter, hunk, 'new', `${p}.focusLinesAfter`, warnings);
        if (hunk && beforeOk) checkFocusInHunk(s.focusLinesBefore, hunk, 'old', `${p}.focusLinesBefore`, warnings);
        if ((afterOk || s.focusLinesAfter === undefined) && (beforeOk || s.focusLinesBefore === undefined)) checkFocusSize(s, hunk, p, errors, warnings);
        if (s.view !== undefined && !VIEWS.includes(s.view)) errors.push(`${p}.view: must be one of ${VIEWS.join(', ')}`);
        if (s.calloutText !== undefined && typeof s.calloutText !== 'string') errors.push(`${p}.calloutText: must be a string`);
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
        });
        if (s.steps.length > 8) warnings.push(`${p}.steps: ${s.steps.length} steps; consider splitting into two flow scenes`);
        break;

      case 'sequence': {
        const ids = checkIds(s.participants, `${p}.participants`, errors, (n, q) => {
          if (!isStr(n?.label)) errors.push(`${q}.label: required string`);
          if (n?.kind !== undefined && !KINDS.includes(n.kind)) errors.push(`${q}.kind: must be one of ${KINDS.join(', ')}`);
        });
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
        if (s.messages.length > 12) warnings.push(`${p}.messages: ${s.messages.length} messages; consider splitting into two sequence scenes`);
        break;
      }

      case 'er': {
        const ids = checkIds(s.entities, `${p}.entities`, errors, (e, q) => {
          if (!isStr(e?.name)) errors.push(`${q}.name: required string`);
          if (e?.change !== undefined && !CHANGES.includes(e.change)) errors.push(`${q}.change: must be one of ${CHANGES.join(', ')}`);
          if (!Array.isArray(e?.fields) || e.fields.length === 0) return errors.push(`${q}.fields: required non-empty array`);
          e.fields.forEach((f, k) => {
            if (!isStr(f?.name)) errors.push(`${q}.fields[${k}].name: required string`);
            if (f?.type !== undefined && typeof f.type !== 'string') errors.push(`${q}.fields[${k}].type: must be a string`);
            if (f?.change !== undefined && !CHANGES.includes(f.change)) errors.push(`${q}.fields[${k}].change: must be one of ${CHANGES.join(', ')}`);
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
          if (r?.change !== undefined && !CHANGES.includes(r.change)) errors.push(`${q}.change: must be one of ${CHANGES.join(', ')}`);
        });
        break;
      }

      case 'state': {
        const ids = checkIds(s.states, `${p}.states`, errors, (n, q) => {
          if (!isStr(n?.label)) errors.push(`${q}.label: required string`);
          if (n?.final !== undefined && typeof n.final !== 'boolean') errors.push(`${q}.final: must be a boolean`);
          if (n?.change !== undefined && !CHANGES.includes(n.change)) errors.push(`${q}.change: must be one of ${CHANGES.join(', ')}`);
        });
        if (!ids) break;
        if (ids.size > 10) warnings.push(`${p}.states: ${ids.size} states; more than 10 get cramped`);
        if (s.initial !== undefined && !ids.has(s.initial)) errors.push(`${p}.initial: unknown state id ${JSON.stringify(s.initial)}`);
        if (!Array.isArray(s.transitions)) { errors.push(`${p}.transitions: required array (may be empty)`); break; }
        s.transitions.forEach((t, j) => {
          const q = `${p}.transitions[${j}]`;
          for (const k of ['from', 'to']) if (!ids.has(t?.[k])) errors.push(`${q}.${k}: unknown state id ${JSON.stringify(t?.[k])}`);
          if (t?.label !== undefined && typeof t.label !== 'string') errors.push(`${q}.label: must be a string`);
          if (t?.change !== undefined && !CHANGES.includes(t.change)) errors.push(`${q}.change: must be one of ${CHANGES.join(', ')}`);
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

      case 'mermaid':
        if (!isStr(s.code)) errors.push(`${p}.code: required string of Mermaid source`);
        else diagrams.push({ p, code: s.code });
        break;
    }
  });

  await checkMermaid(diagrams, errors, warnings);
  checkStoryShape(sb.scenes, hunks ?? {}, mode, warnings);
  if (mode === 'explain') {
    if (sb.skipped !== undefined) warnings.push('skipped: lists diff hunks left out of a review; an explanation has none, so remove it');
    return { errors, warnings, coverage: null };
  }
  const coverage = checkCoverage(sb, hunks ?? {}, errors, warnings);
  return { errors, warnings, coverage };
}

export function storyboardSeconds(sb, voiceover) {
  return (sb.scenes ?? []).reduce((sum, s) => sum + sceneDurationInFrames(s?.narration, voiceover), 0) / FPS;
}
