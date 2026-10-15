// Storyboard validation, mirroring src/types.ts. Returns human/LLM-readable error strings.

import { FPS, sceneDurationInFrames } from '../../shared/timing.mjs';

const RISKS = ['low', 'medium', 'high'];
const KINDS = ['service', 'db', 'queue', 'client'];
const VIEWS = ['split', 'morph'];
const TYPES = ['intent', 'arch', 'code', 'flow'];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

function checkLineRefs(refs, path, errors) {
  if (refs === undefined) return;
  if (!Array.isArray(refs)) return errors.push(`${path}: must be an array of line numbers or "a-b" ranges`);
  refs.forEach((r, i) => {
    if (typeof r === 'number' && Number.isInteger(r) && r > 0) return;
    if (typeof r === 'string' && /^\s*\d+\s*(-\s*\d+\s*)?$/.test(r)) return;
    errors.push(`${path}[${i}]: ${JSON.stringify(r)} is not a line number or "a-b" range`);
  });
}

export function expandLineRefs(refs = []) {
  const out = new Set();
  for (const r of refs) {
    if (typeof r === 'number') out.add(r);
    else {
      const [a, b = a] = r.split('-').map((s) => parseInt(s, 10));
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
    }
  }
  return out;
}

export function validateStoryboard(sb, hunks) {
  const errors = [];
  const warnings = [];
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
        const hunk = hunks?.[s.hunkId];
        if (!isStr(s.hunkId)) errors.push(`${p}.hunkId: required string`);
        else if (!hunk) errors.push(`${p}.hunkId: "${s.hunkId}" not found in hunks.json`);
        checkLineRefs(s.focusLinesAfter, `${p}.focusLinesAfter`, errors);
        checkLineRefs(s.focusLinesBefore, `${p}.focusLinesBefore`, errors);
        if (hunk && Array.isArray(s.focusLinesAfter)) {
          const valid = new Set(hunk.lines.map((l) => l.newLine).filter((n) => n !== null));
          const missing = [...expandLineRefs(s.focusLinesAfter.filter((r) => typeof r === 'number' || typeof r === 'string'))].filter((n) => !valid.has(n));
          if (missing.length) warnings.push(`${p}.focusLinesAfter: lines ${missing.join(', ')} are outside ${s.hunkId} (new-file lines ${hunk.startLine}-${hunk.endLine})`);
        }
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
    }
  });

  return { errors, warnings };
}

export function storyboardSeconds(sb) {
  return (sb.scenes ?? []).reduce((sum, s) => sum + sceneDurationInFrames(s?.narration), 0) / FPS;
}
