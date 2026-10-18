// A storyboard against the run's plan.json: each scene's `topic` names a topic of the plan, the storyboard's
// `plan` records the pick of each topic it was written from, and the scenes of each topic draw that pick.

import { choiceError, pickOf, samePick } from '../../shared/plan.mjs';
import { VIEWS } from '../../shared/views.mjs';
import { aType } from '../../shared/words.mjs';

// Scenes that frame the whole video rather than draw one topic, so any view allows them. A code scene
// shows a topic's lines whatever its view.
const ANY_VIEW = ['text', 'files', 'tests', 'review', 'reading', 'code'];

// The scenes a pre-read's deep topic traces its concrete case in, whatever its view.
const TRACE = ['flow', 'array', 'table'];

const drawn = (view) => VIEWS[view].scenes.map(aType).join(' or ');
const pickJson = (pick) => JSON.stringify({ depth: pick.depth, view: pick.view });

/**
 * @param {{ plan: object | null, errors: string[], warnings: string[] } | null} planFile  readPlan's result,
 *   or null when the run has no plan.json. `preread`: a pre-read's deep topic adds a diagram, not code.
 */
export function checkTopics(sb, planFile, errors, warnings, { preread = false } = {}) {
  sb.scenes.forEach((s, i) => {
    if (s?.topic !== undefined && (typeof s.topic !== 'string' || !s.topic.trim())) errors.push(`scenes[${i}].topic: must be a topic id from plan.json`);
  });
  if (!planFile) {
    if (sb.plan !== undefined) warnings.push('plan: this run has no plan.json, so there are no picks to record; remove "plan"');
    return;
  }
  for (const e of planFile.errors) errors.push(`plan.json: ${e}`);
  for (const w of planFile.warnings) warnings.push(`plan.json: ${w}`);
  if (planFile.errors.length) return;

  const topicIds = planFile.plan.topics.map((t) => t.id);
  sb.scenes.forEach((s, i) => {
    if (typeof s?.topic === 'string' && !topicIds.includes(s.topic)) errors.push(`scenes[${i}].topic: no topic "${s.topic}" in plan.json; use one of ${topicIds.join(', ')}`);
  });
  const written = writtenFrom(sb, planFile.plan, errors, warnings);
  warnings.push(...sceneChecks(sb, planFile.plan, written, preread));
}

/**
 * The picks the storyboard's `plan` says its scenes were written from, by topic id, with a warning for each
 * topic it leaves out and each pick the viewer has changed since.
 */
function writtenFrom(sb, plan, errors, warnings) {
  const written = new Map();
  const example = pickJson(pickOf(plan.topics[0]));
  if (sb.plan === undefined) {
    warnings.push(`plan: missing; copy the pick of each topic in plan.json into the storyboard's "plan", such as { "${plan.topics[0].id}": ${example} }`);
    return written;
  }
  if (!sb.plan || typeof sb.plan !== 'object' || Array.isArray(sb.plan)) {
    errors.push(`plan: must be an object of the picks the storyboard was written from, such as { "${plan.topics[0].id}": ${example} }`);
    return written;
  }
  const topics = new Map(plan.topics.map((t) => [t.id, t]));
  for (const [id, entry] of Object.entries(sb.plan)) {
    const topic = topics.get(id);
    if (!topic) {
      errors.push(`plan.${id}: no topic "${id}" in plan.json; use one of ${[...topics.keys()].join(', ')}`);
      continue;
    }
    const problem = choiceError(topic, entry);
    if (problem) {
      errors.push(`plan.${id}: ${problem}`);
      continue;
    }
    written.set(id, entry);
    const now = pickOf(topic);
    if (!samePick(entry, now)) warnings.push(`plan.${id}: the plan changed since the storyboard was written: "${topic.title}" is now ${now.depth}, ${VIEWS[now.view].label}; update its scenes and this entry`);
  }
  for (const t of plan.topics) {
    if (!Object.hasOwn(sb.plan, t.id)) warnings.push(`plan: no entry for "${t.id}"; add the pick its scenes were written from, ${pickJson(pickOf(t))}`);
  }
  return written;
}

/**
 * The ways the scenes do not draw the pick each topic was written from (or its current pick, when the storyboard
 * does not record one): the scene problems first, then the topics.
 */
function sceneChecks(sb, plan, written, preread) {
  const topics = new Map(plan.topics.map((t) => [t.id, { pick: written.get(t.id) ?? pickOf(t), scenes: [] }]));
  const problems = [];
  sb.scenes.forEach((s, i) => {
    const entry = typeof s?.topic === 'string' ? topics.get(s.topic) : undefined;
    if (!entry) return;
    entry.scenes.push(i);
    const { view, depth } = entry.pick;
    if (depth === 'skip' || ANY_VIEW.includes(s.type) || VIEWS[view].scenes.includes(s.type)) return;
    if (preread && depth === 'deep' && TRACE.includes(s.type)) return;
    problems.push(`scenes[${i}] is ${aType(s.type)} scene in "${s.topic}", which the viewer chose to see as "${VIEWS[view].label}"; draw it as ${drawn(view)} scene, or move this scene to another topic`);
  });
  for (const [id, { pick, scenes }] of topics) {
    const problem = topicProblem(id, pick, scenes.map((i) => [i, sb.scenes[i]]));
    if (problem) problems.push(problem);
  }
  return problems;
}

/** How the scenes of topic `id` do not show `pick`, or null when they do. */
function topicProblem(id, pick, scenes) {
  if (pick.depth === 'skip') return scenes.length ? `topic "${id}": the viewer chose to skip it, but scenes[${scenes.map(([i]) => i).join(', ')}] show it` : null;
  if (!scenes.length) return `topic "${id}": the viewer chose ${pick.depth}, and no scene has "topic": "${id}"; add its scenes, or tag the scenes that show it`;
  if (pick.view !== 'code' && !scenes.some(([, s]) => VIEWS[pick.view].scenes.includes(s.type))) {
    return `topic "${id}": the viewer chose to see it as "${VIEWS[pick.view].label}", and none of its scenes is ${drawn(pick.view)} scene; add one`;
  }
  return null;
}
