// Checks a diagram's `steps`: each { focus, say } names what to light while its words play. What a ref
// can name per scene type lives in shared/targets.mjs, which the scenes use to light it.

import { focusSteps, legacyFocusKeys } from '../../shared/normalize.mjs';
import { ambiguousIndex, FOCUS_TYPES, focusRefs, refNames, resolveRef, stepTargets } from '../../shared/targets.mjs';
import { changedRefs, changesState, STATE_TYPES } from '../../shared/state-steps.mjs';
import { tokenSteps } from '../../shared/layers.mjs';
import { didYouMean } from './suggest.mjs';


/** What a scene type's refs look like, for the error when a ref names nothing. */
const REF_HELP = {
  graph: (s) => `a node id, an edge "from->to" or "a-b", a group "group:Name", or an edge index${s.table ? ', or a table row "row:A", column "col:Header" or cell "Header@row"' : ''}`,
  sequence: 'a message index, an "a-b" range of them, or a participant id',
  er: 'an entity id, a field "entity.field", a relation "from->to", or a relation index',
  state: 'a state id, a transition "from->to", a transition label, or a transition index',
  table: 'a row index, a column "col:Header", or a cell "Header@row"',
  chart: 'a label, a series "series:name", or a value "series@label"',
  timeline: 'an event index, an "a-b" range of them, or a span "span:label"',
  files: 'a path the scene lists',
  tests: 'a situation id, a cell "situation.Outcome", an outcome, or a test\'s name',
  layers: 'a layer id, an item id or "layer.item", or a path stop index',
  text: 'an item index or "a-b" range, "note", "kicker", the lead\'s field name such as "headline", or a side "left" or "right"',
  compare: 'a row index, an "a-b" range of them, a side "side:After", or a cell "row@side" such as "2@After"',
  terminal: 'an entry index, an "a-b" range of them, or an output line "entry:line" such as "2:3"',
  array: (s) => (Array.isArray(s.arrays) ? 'a cell "left[0]", cells "left[0-1]", an array "array:left", a pointer "ptr:name", or a range "range:name"' : 'a cell index, an "a-b" range of cells, a pointer "ptr:name", or a range "range:name"'),
  memory: 'a frame "frame:name", a variable "frame.var", an object id, or a field "object.field"',
  svg: 'an element id in the drawing',
  plot: 'a part\'s id, or a parameter\'s name for the parts it moves',
  image: 'a region id',
};

/** The ref help for a scene, which for some types depends on its fields. */
const refHelp = (s) => {
  const help = Object.hasOwn(REF_HELP, s.type) ? REF_HELP[s.type] : undefined;
  return typeof help === 'function' ? help(s) : help;
};

/** Items the steps reveal in order, so one no step names appears unnamed beside a neighbour. */
const REVEALED = {
  sequence: [['m'], 'messages', 'message'],
  timeline: [['ev'], 'events', 'event'],
  compare: [['r', 'x'], 'rows', 'row'],
  terminal: [['en', 'ln'], 'entries', 'entry'],
};

/** The key a step's focus is written under: `focus`, or the older key its scene type used. */
function focusKey(step, type) {
  if (step.focus !== undefined) return 'focus';
  return legacyFocusKeys(type).find((k) => step[k] !== undefined) ?? 'focus';
}

export function checkFocusSteps(s, p, hunks, errors, warnings) {
  if (!FOCUS_TYPES.includes(s.type) || s.steps === undefined) return;
  if (!Array.isArray(s.steps) || s.steps.length === 0) return errors.push(`${p}.steps: must be a non-empty array of { focus, say }`);
  const names = refNames(s, hunks);
  s.steps.forEach((step, i) => {
    const q = `${p}.steps[${i}]`;
    if (!step || typeof step !== 'object') return errors.push(`${q}: must be an object { focus, say }`);
    if (!(typeof step.say === 'string' && step.say.trim())) errors.push(`${q}.say: required string, the words spoken while its focus is lit`);
    const legacy = legacyFocusKeys(s.type).filter((k) => step[k] !== undefined);
    if (step.focus !== undefined && legacy.length) return errors.push(`${q}: has both focus and ${legacy.join(' and ')}; keep focus`);
    if (legacy.length > 1) return errors.push(`${q}: set one of ${legacy.join(' or ')}, or use focus`);
    const key = focusKey(step, s.type);
    const value = step[key];
    // A step that only moves the camera lights what it changes, or nothing.
    if (value === undefined && STATE_TYPES.includes(s.type) && step.camera !== undefined) return;
    if (value === undefined && STATE_TYPES.includes(s.type) && changesState(step)) {
      if (changedRefs(s, step).length) return;
      const what = Array.isArray(step.hide) && step.hide.length ? 'only hides, and what it hides cannot be lit' : step.sort !== undefined ? 'only sorts, which lights nothing' : 'changes nothing';
      return errors.push(`${q}.focus: required, ${refHelp(s)}, or an array of them, since this step ${what}, so it lights nothing`);
    }
    if (value === undefined) return errors.push(`${q}.focus: required, ${refHelp(s)}, or an array of them${STATE_TYPES.includes(s.type) ? ', unless the step changes something, which it then focuses' : ''}`);
    const refs = focusRefs(value);
    if (refs.length === 0) return errors.push(`${q}.${key}: an empty array lights nothing; name at least one ${refHelp(s)}`);
    refs.forEach((ref, k) => {
      const at = Array.isArray(value) ? `${q}.${key}[${k}]` : `${q}.${key}`;
      if (typeof ref !== 'string' && typeof ref !== 'number') return errors.push(`${at}: must be a string or a number: ${refHelp(s)}`);
      const unclear = ambiguousIndex(s, ref);
      if (unclear) errors.push(`${at}: ${JSON.stringify(ref)} ${unclear}`);
      else if (!resolveRef(s, ref, hunks)) errors.push(`${at}: ${JSON.stringify(ref)} names nothing in this scene, where a ref is ${refHelp(s)}${typeof ref === 'string' ? didYouMean(ref, names) : ''}`);
    });
  });
  const scene = { ...s, steps: focusSteps(s) };
  // A step that draws or erases ink, or moves the camera, moves something even when it lights what the step before lit.
  const drawsInk = (step) => Boolean(step?.draw?.length) || step?.erase !== undefined || step?.camera !== undefined;
  const lit = stepTargets(scene, hunks).map((keys) => [...keys].sort().join(' '));
  const token = s.type === 'layers' ? tokenSteps(scene, hunks).positions : [];
  lit.forEach((keys, i) => {
    if (i > 0 && keys && keys === lit[i - 1] && !changesState(s.steps[i]) && !drawsInk(s.steps[i]) && token[i] === token[i - 1]) warnings.push(`${p}.steps[${i}]: focuses the same as the step before it, so nothing moves; merge the two or point this one elsewhere`);
  });
  if ((s.type === 'table' || s.type === 'files') && s.highlight !== undefined) warnings.push(`${p}.highlight: steps replace highlight, so remove it`);
  const revealed = Object.hasOwn(REVEALED, s.type) ? REVEALED[s.type] : undefined;
  if (revealed) checkRevealed(scene, p, hunks, revealed, warnings);
}

function checkRevealed(s, p, hunks, [prefixes, field, what], warnings) {
  const count = Array.isArray(s[field]) ? s[field].length : 0;
  // A key names its item by the index after its prefix, as "r:2", or as "x:2/1" for a part of it.
  const named = new Set(stepTargets(s, hunks).flat().flatMap((key) => (prefixes.some((prefix) => key.startsWith(`${prefix}:`)) ? [parseInt(key.slice(key.indexOf(':') + 1), 10)] : [])));
  const missed = Array.from({ length: count }, (_, n) => n).filter((n) => !named.has(n));
  if (missed.length && named.size) {
    warnings.push(`${p}.steps: no step names ${what}${missed.length === 1 ? '' : 's'} ${missed.join(', ')}, so ${missed.length === 1 ? 'it appears' : 'they appear'} with a neighbouring step unnamed; give every ${what} a step`);
  }
}
