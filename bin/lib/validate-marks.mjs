// Checks the marks an item can carry (src/types.ts `Marks`): `change` says what the diff does to it, `badge`
// is the author's own label, `highlight` points at it. Each kind of item takes some of them; one registry
// below lists every markable item of every scene, and each rule walks it.

import { diffFiles } from '../../shared/files.mjs';
import { TONES } from './validate-scenes.mjs';

const CHANGES = ['added', 'removed', 'modified'];
const BADGE_MAX = 14;
/** Shorter names, such as "id", match nearly any line, so they prove nothing either way. */
const NAME_MIN = 3;

/**
 * What each kind of item may carry. `names` gives the words the diff should contain where the item is
 * added or removed; only kinds whose names appear in code verbatim (tables, fields, states, rows) have them.
 */
const KINDS = {
  node: { change: true, highlight: true, badge: true },
  edge: { change: true, highlight: true },
  message: { change: true, highlight: true, badge: true, tone: true },
  entity: { change: true, highlight: true, badge: true, tone: true, names: (e) => [e.name] },
  field: { change: true, highlight: true, badge: true, tone: true, names: (f) => [f.name] },
  relation: { change: true, highlight: true, badge: true, tone: true },
  state: { change: true, highlight: true, badge: true, tone: true, names: (s) => [s.id, s.label] },
  transition: { change: true, highlight: true, badge: true, tone: true },
  row: { change: true, badge: true, tone: true, names: (r) => r.cells.filter((c) => typeof c === 'string') },
  event: { highlight: true, badge: true },
  span: { highlight: true, badge: true },
  file: { change: true, badge: true, tone: true },
  layer: { change: true, highlight: true, badge: true, tone: true },
};

const list = (items, q, kind) => (Array.isArray(items) ? items.flatMap((item, j) => (item && typeof item === 'object' ? [{ q: `${q}[${j}]`, item, kind }] : [])) : []);

/** Every markable item of a scene, with its path for messages. */
const ITEMS = {
  graph: (s, p) => [...list(s.nodes, `${p}.nodes`, 'node'), ...list(s.edges, `${p}.edges`, 'edge')],
  sequence: (s, p) => [...list(s.participants, `${p}.participants`, 'node'), ...list(s.messages, `${p}.messages`, 'message')],
  er: (s, p) => [
    ...list(s.entities, `${p}.entities`, 'entity').flatMap((e) => [e, ...list(e.item.fields, `${e.q}.fields`, 'field')]),
    ...list(s.relations, `${p}.relations`, 'relation'),
  ],
  state: (s, p) => [...list(s.states, `${p}.states`, 'state'), ...list(s.transitions, `${p}.transitions`, 'transition')],
  table: (s, p) => list(s.rows, `${p}.rows`, 'row'),
  timeline: (s, p) => [...list(s.events, `${p}.events`, 'event'), ...list(s.spans, `${p}.spans`, 'span')],
  files: (s, p) => list(s.files, `${p}.files`, 'file'),
  layers: (s, p) => list(s.layers, `${p}.layers`, 'layer').flatMap((l) => [l, ...list(l.item.items, `${l.q}.items`, 'node')]),
};

/**
 * The change an item shows, as the renderer will draw it: its own `change`, an older `modified: true` on a
 * node or message in a diff walkthrough (an explanation reads it as highlight), or a table row's
 * `{ before, after }` cell.
 */
function shownChange({ item, kind }, explain) {
  if (CHANGES.includes(item.change)) return item.change;
  if ((kind === 'node' || kind === 'message') && item.modified === true && item.highlight === undefined && !explain) return 'modified';
  if (kind === 'row' && Array.isArray(item.cells) && item.cells.some((c) => c && typeof c === 'object')) return 'modified';
  return undefined;
}

function checkShape({ q, item, kind }, errors) {
  const can = KINDS[kind];
  if (can.change && item.change !== undefined && !CHANGES.includes(item.change)) errors.push(`${q}.change: must be one of ${CHANGES.join(', ')}`);
  if (can.highlight && item.highlight !== undefined && typeof item.highlight !== 'boolean') errors.push(`${q}.highlight: must be true or false`);
  if (can.tone && item.tone !== undefined && !TONES.includes(item.tone)) errors.push(`${q}.tone: must be one of ${TONES.join(', ')}`);
  if (kind === 'message' && item.modified !== undefined && typeof item.modified !== 'boolean') errors.push(`${q}.modified: must be a boolean; prefer change or highlight`);
  if (!can.badge || item.badge === undefined) return;
  if (typeof item.badge !== 'string' || !item.badge.trim()) return errors.push(`${q}.badge: must be a short non-empty string`);
  if (item.badge.trim().length > BADGE_MAX) errors.push(`${q}.badge: ${item.badge.trim().length} characters; a badge holds ${BADGE_MAX}`);
}

/** Normalised for matching names to code: "created_at", "createdAt" and "Created at" all read "createdat". */
const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');

/** The diff's changed lines and changed file paths, squashed, one string per line. */
function changedText(hunks) {
  const lines = [];
  for (const h of Object.values(hunks)) {
    if (h.status === 'source') continue;
    lines.push(squash(h.file));
    for (const line of h.lines ?? []) if (line.type !== 'context') lines.push(squash(line.text));
  }
  return lines;
}

/**
 * An item marked added or removed whose name appears on no changed line most likely marks something the
 * diff does not touch. Names only; modified items are left alone, since a table can change through a
 * field and keep its own name off every changed line.
 */
function checkAgainstDiff(entry, changed, warnings) {
  const { q, item, kind } = entry;
  const names = KINDS[kind].names?.(item).map(squash).filter((n) => n.length >= NAME_MIN);
  if (!names?.length || (item.change !== 'added' && item.change !== 'removed')) return;
  if (names.some((name) => changed.some((line) => line.includes(name)))) return;
  const shown = KINDS[kind].names(item).find((n) => squash(n).length >= NAME_MIN);
  warnings.push(`${q}.change: marked "${item.change}", but "${shown}" appears on no changed line of the diff; mark only what the diff ${item.change === 'added' ? 'adds' : 'removes'}, and use highlight, a badge or a focus step to point at the rest`);
}

/** A files entry whose `change` disagrees with what hunks.json says the diff does to that file. */
function checkFileChanges(s, p, hunks, warnings) {
  if (!Array.isArray(s.files)) return;
  const known = new Map(diffFiles(hunks).map((f) => [f.path, f.change]));
  s.files.forEach((f, j) => {
    const actual = known.get(f?.path);
    if (!actual || !CHANGES.includes(f.change) || f.change === actual) return;
    warnings.push(`${p}.files[${j}].change: "${f.change}", but hunks.json has ${f.path} as ${actual}; leave change off to take it from the diff`);
  });
}

const refs = (entries) => entries.slice(0, 4).map((e) => e.q.slice(e.q.indexOf('.') + 1)).join(', ') + (entries.length > 4 ? `, ... ${entries.length - 4} more` : '');

export function checkMarks(sb, hunks, mode, errors, warnings) {
  const explain = mode === 'explain';
  const changed = explain ? [] : changedText(hunks);
  for (const [where, value] of [['explainsChange', sb.explainsChange], ...sb.scenes.map((s, i) => [`scenes[${i}].explainsChange`, s?.explainsChange])]) {
    if (value === undefined) continue;
    if (typeof value !== 'boolean') errors.push(`${where}: must be true or false`);
    else if (!explain) warnings.push(`${where}: only an explanation uses it; a diff walkthrough's change marks always describe its diff, so remove it`);
  }
  sb.scenes.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const items = Object.hasOwn(ITEMS, s.type) ? ITEMS[s.type](s, `scenes[${i}]`) : [];
    for (const entry of items) checkShape(entry, errors);
    const marked = items.filter((e) => shownChange(e, explain));
    if (explain) {
      if (marked.length && sb.explainsChange !== true && s.explainsChange !== true) {
        warnings.push(
          `scenes[${i}]: ${marked.length} change mark${marked.length === 1 ? '' : 's'} (${refs(marked)}) in an explanation, which has no diff; point at parts with highlight or focus steps, label them with badge, or set "explainsChange": true on the scene if it explains a change`,
        );
      }
      return;
    }
    for (const entry of items) checkAgainstDiff(entry, changed, warnings);
    if (s.type === 'files') checkFileChanges(s, `scenes[${i}]`, hunks, warnings);
  });
}
