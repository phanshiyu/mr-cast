// Storyboard validation, mirroring src/types.ts. Returns human/LLM-readable error strings.

import { expandLineRefs, focusRanges } from '../../shared/focus.mjs';
import { FPS, sceneDurationInFrames } from '../../shared/timing.mjs';

const RISKS = ['low', 'medium', 'high'];
const KINDS = ['service', 'db', 'queue', 'client'];
const VIEWS = ['split', 'morph'];
const TYPES = ['intent', 'arch', 'code', 'flow', 'sequence', 'er', 'state', 'mermaid'];
const MESSAGE_KINDS = ['call', 'return', 'async'];
const CHANGES = ['added', 'removed', 'modified'];
const CARDINALITIES = ['one-to-one', 'one-to-many', 'many-to-many'];

const MAX_LINE_RANGE = 10000;
// A code scene walks its focus ranges top to bottom; long or many ranges turn it back into a wall of code.
const FOCUS_RANGE_COMFORTABLE = 8;
const FOCUS_RANGE_MAX = 15;
const FOCUS_RANGES_PER_SCENE = 3;
const UNFOCUSED_CHANGE_MAX = 12;

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
    { key: 'focusLinesAfter', ranges: focusRanges(expandLineRefs(scene.focusLinesAfter ?? [])) },
    { key: 'focusLinesBefore', ranges: focusRanges(expandLineRefs(scene.focusLinesBefore ?? [])) },
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
  if (count > FOCUS_RANGES_PER_SCENE) {
    const list = used.map((s) => `${s.key} ${s.ranges.map(formatRange).join(', ')}`).join('; ');
    warnings.push(`${p}: ${count} focus ranges (${list}); keep at most ${FOCUS_RANGES_PER_SCENE} per scene and split the rest into another code scene`);
  }
  const changed = hunk ? hunk.additions + hunk.deletions : 0;
  if (count === 0 && changed > UNFOCUSED_CHANGE_MAX) {
    errors.push(`${p}: hunk ${hunk.id} changes ${changed} lines and the scene sets no focus; set focusLinesAfter (or focusLinesBefore for deletions) to the at most ${FOCUS_RANGE_COMFORTABLE} lines the narration discusses`);
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

export async function validateStoryboard(sb, hunks) {
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
        if (!RISKS.includes(s.risk)) errors.push(`${p}.risk: must be one of ${RISKS.join(', ')}`);
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

      case 'mermaid':
        if (!isStr(s.code)) errors.push(`${p}.code: required string of Mermaid source`);
        else diagrams.push({ p, code: s.code });
        break;
    }
  });

  await checkMermaid(diagrams, errors, warnings);

  return { errors, warnings };
}

export function storyboardSeconds(sb, voiceover) {
  return (sb.scenes ?? []).reduce((sum, s) => sum + sceneDurationInFrames(s?.narration, voiceover), 0) / FPS;
}
