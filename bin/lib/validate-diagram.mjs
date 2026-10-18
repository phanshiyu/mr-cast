// Checks for diagram nodes (graph nodes, sequence participants) and the graph scene, mirroring src/types.ts.
// Each pushes human/LLM-readable strings onto `errors` and `warnings`, like the checks in validate.mjs.

import lucideNames from 'lucide-react/dynamicIconImports.mjs';
import { NODE_KINDS } from '../../shared/normalize.mjs';
import { didYouMean } from './suggest.mjs';
import { TONES } from './validate-scenes.mjs';

const DIRECTIONS = ['forward', 'both', 'none'];
const EDGE_STYLES = ['flow', 'solid', 'dashed'];
const LAYOUTS = ['LR', 'TB'];
/**
 * Lucide's icon names, each with the name of the file it loads. An older alias such as "home" loads
 * another icon's file ("house"); the player knows icons by their own names only.
 */
const ICON_FILES = new Map(
  Object.entries(lucideNames).map(([name, load]) => [name, /icons\/([a-z0-9-]+)\.mjs/.exec(String(load))?.[1] ?? name]),
);
const ICONS = [...ICON_FILES].flatMap(([name, file]) => (name === file ? [name] : []));
const ICON_SET = new Set(ICONS);
// Past this many nodes each card shrinks below a comfortable reading size on the 1080p frame.
const GRAPH_NODES_MAX = 12;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

/** A Lucide icon name, as on https://lucide.dev/icons. */
export function checkIcon(icon, q, errors) {
  if (icon === undefined) return;
  if (!isStr(icon)) return errors.push(`${q}: must be a Lucide icon name such as "user" or "server"`);
  if (ICON_SET.has(icon)) return;
  if (ICON_FILES.has(icon))
    return errors.push(`${q}: "${icon}" is an older Lucide name; use "${ICON_FILES.get(icon)}"`);
  const kebab = icon
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
  const hint = ICON_SET.has(kebab) ? `; write it in kebab-case: "${kebab}"` : didYouMean(kebab, ICONS);
  errors.push(`${q}: "${icon}" is not a Lucide icon${hint || '; pick one from https://lucide.dev/icons'}`);
}

/** The fields a node shares across graph and sequence scenes, plus the older `kind` and `modified`. Marks are checked in validate-marks.mjs. */
export function checkNodeFields(n, q, errors) {
  if (!isStr(n?.label)) errors.push(`${q}.label: required string`);
  checkIcon(n?.icon, `${q}.icon`, errors);
  if (n?.caption !== undefined && typeof n.caption !== 'string') errors.push(`${q}.caption: must be a string`);
  if (n?.tone !== undefined && !TONES.includes(n.tone)) errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
  if (n?.kind !== undefined && !NODE_KINDS.includes(n.kind))
    errors.push(`${q}.kind: must be one of ${NODE_KINDS.join(', ')}, or use icon and caption instead`);
  if (n?.modified !== undefined && typeof n.modified !== 'boolean')
    errors.push(`${q}.modified: must be a boolean; prefer change or highlight`);
}

/** Groups whose names differ only in case or spacing are almost always one group typed two ways. */
function checkGroups(nodes, p, errors, warnings) {
  const byKey = new Map();
  nodes.forEach((n, j) => {
    if (n?.group === undefined) return;
    if (!isStr(n.group)) return errors.push(`${p}.nodes[${j}].group: must be a non-empty string, the group's name`);
    const key = n.group.toLowerCase().replace(/\s+/g, ' ').trim();
    byKey.set(key, new Set([...(byKey.get(key) ?? []), n.group]));
  });
  for (const names of byKey.values()) {
    if (names.size > 1)
      warnings.push(
        `${p}.nodes: groups ${[...names].map((g) => JSON.stringify(g)).join(' and ')} differ only in case or spacing, so they draw as separate boxes; spell them the same`,
      );
  }
}

const SHAPES = ['card', 'decision', 'terminal', 'step'];

/** A node's shape, and the fields its shape does not draw. */
function checkShape(n, q, errors, warnings) {
  if (n?.shape === undefined) return;
  if (!SHAPES.includes(n.shape)) return errors.push(`${q}.shape: must be one of ${SHAPES.join(', ')}`);
  if (n.shape !== 'card' && n.icon !== undefined)
    warnings.push(`${q}.icon: a ${n.shape} draws no icon; remove it, or make the node a card`);
  if ((n.shape === 'decision' || n.shape === 'terminal') && n.caption !== undefined)
    warnings.push(`${q}.caption: a ${n.shape} draws no caption`);
}

export function checkGraph(s, p, errors, warnings) {
  if (s.layout !== undefined && !LAYOUTS.includes(s.layout))
    errors.push(`${p}.layout: must be "LR" (left to right) or "TB" (top to bottom)`);
  if (!Array.isArray(s.nodes) || s.nodes.length === 0) return errors.push(`${p}.nodes: required non-empty array`);
  const ids = new Set();
  s.nodes.forEach((n, j) => {
    const q = `${p}.nodes[${j}]`;
    if (!isStr(n?.id)) errors.push(`${q}.id: required string`);
    else if (ids.has(n.id)) errors.push(`${q}.id: duplicate id "${n.id}"`);
    else ids.add(n.id);
    checkNodeFields(n, q, errors);
    checkShape(n, q, errors, warnings);
    for (const k of ['x', 'y']) if (n && k in n) warnings.push(`${q}.${k}: ignored, layout is automatic`);
  });
  checkGroups(s.nodes, p, errors, warnings);
  if (s.nodes.length > GRAPH_NODES_MAX)
    warnings.push(`${p}.nodes: ${s.nodes.length} nodes; past ${GRAPH_NODES_MAX} the cards get too small to read`);
  if (!Array.isArray(s.edges)) return errors.push(`${p}.edges: required array (may be empty)`);
  s.edges.forEach((e, j) => {
    const q = `${p}.edges[${j}]`;
    for (const k of ['from', 'to']) {
      if (!ids.has(e?.[k]))
        errors.push(
          `${q}.${k}: unknown node id ${JSON.stringify(e?.[k])}${typeof e?.[k] === 'string' ? didYouMean(e[k], [...ids]) : ''}`,
        );
    }
    if (ids.has(e?.from) && e?.from === e?.to)
      warnings.push(`${q}: from and to are both "${e.from}"; a graph edge joins two nodes, so it is not drawn`);
    if (e?.label !== undefined && typeof e.label !== 'string') errors.push(`${q}.label: must be a string`);
    if (e?.direction !== undefined && !DIRECTIONS.includes(e.direction))
      errors.push(`${q}.direction: must be one of ${DIRECTIONS.join(', ')}`);
    if (e?.style !== undefined && !EDGE_STYLES.includes(e.style))
      errors.push(`${q}.style: must be one of ${EDGE_STYLES.join(', ')}`);
  });
}
