// A storyboard against the run's plan.json: each scene's `topic` names a topic of the plan, and the scenes
// of each topic follow the depth and view the viewer picked on the plan page.

import { pickOf } from '../../shared/plan.mjs';
import { VIEWS } from '../../shared/views.mjs';
import { aType } from '../../shared/words.mjs';

// Scenes that frame the whole video rather than draw one topic, so any view allows them. A code scene
// shows a topic's lines whatever its view.
const ANY_VIEW = ['intent', 'files', 'tests', 'review', 'code'];

const drawn = (view) => VIEWS[view].scenes.map(aType).join(' or ');

/**
 * @param {{ plan: object | null, errors: string[], warnings: string[] } | null} planFile  readPlan's result,
 *   or null when the run has no plan.json.
 */
export function checkTopics(sb, planFile, errors, warnings) {
  sb.scenes.forEach((s, i) => {
    if (s?.topic !== undefined && (typeof s.topic !== 'string' || !s.topic.trim())) errors.push(`scenes[${i}].topic: must be a topic id from plan.json`);
  });
  if (!planFile) return;
  for (const e of planFile.errors) errors.push(`plan.json: ${e}`);
  for (const w of planFile.warnings) warnings.push(`plan.json: ${w}`);
  if (planFile.errors.length) return;

  const topicIds = planFile.plan.topics.map((t) => t.id);
  sb.scenes.forEach((s, i) => {
    if (typeof s?.topic === 'string' && !topicIds.includes(s.topic)) errors.push(`scenes[${i}].topic: no topic "${s.topic}" in plan.json; use one of ${topicIds.join(', ')}`);
  });
  warnings.push(...topicChecks(sb, planFile.plan).problems);
}

/** About how many steps a code scene walks its lines in, counting the older focus fields a step each. */
function codeSteps(s) {
  if (s.type !== 'code') return 0;
  const steps = [s.steps, s.focusLinesAfter, s.focusLinesBefore].find(Array.isArray);
  return steps?.length ?? 0;
}

/**
 * The ways the storyboard's scenes do not follow the picks in `plan`, the scene problems first, and the topics
 * with none, whose scenes show their pick.
 */
function topicChecks(sb, plan) {
  const topics = new Map(plan.topics.map((t) => [t.id, { pick: pickOf(t), scenes: [] }]));
  const sceneProblems = [];
  const topicProblems = [];
  const off = new Set();
  sb.scenes.forEach((s, i) => {
    const entry = typeof s?.topic === 'string' ? topics.get(s.topic) : undefined;
    if (!entry) return;
    entry.scenes.push({ s, i });
    const { view, depth } = entry.pick;
    if (depth === 'skip' || ANY_VIEW.includes(s.type) || VIEWS[view].scenes.includes(s.type)) return;
    off.add(s.topic);
    sceneProblems.push(`scenes[${i}] is ${aType(s.type)} scene in "${s.topic}", which the viewer chose to see as "${VIEWS[view].label}"; draw it as ${drawn(view)} scene, or move this scene to another topic`);
  });

  for (const [id, { pick, scenes }] of topics) {
    const problem = topicProblem(id, pick, scenes);
    if (!problem) continue;
    off.add(id);
    topicProblems.push(problem);
  }
  return { problems: [...sceneProblems, ...topicProblems], built: new Set([...topics.keys()].filter((id) => !off.has(id))) };
}

/** How the scenes of topic `id` do not show its pick, or null when they do. */
function topicProblem(id, pick, scenes) {
  if (pick.depth === 'skip') {
    return scenes.length ? `topic "${id}": the viewer chose to skip it, but scenes[${scenes.map((x) => x.i).join(', ')}] show it; remove them and list its hunks in skipped with the reason "the viewer chose to skip this topic"` : null;
  }
  if (!scenes.length) return `topic "${id}": the viewer chose ${pick.depth}, and no scene has "topic": "${id}"; add its scenes, or tag the scenes that show it`;
  if (pick.view !== 'code' && !scenes.some(({ s }) => VIEWS[pick.view].scenes.includes(s.type))) {
    return `topic "${id}": the viewer chose to see it as "${VIEWS[pick.view].label}", and none of its scenes is ${drawn(pick.view)} scene; add one`;
  }
  // Deep walks the code line by line, in steps; brief shows the key lines at once.
  const steps = scenes.reduce((sum, { s }) => sum + codeSteps(s), 0);
  if (pick.depth === 'deep' && steps < 2) return `topic "${id}": the viewer chose deep, and none of its code scenes walks the lines in steps; add a code scene with "steps"`;
  if (pick.depth === 'brief' && steps > 1) {
    const walked = scenes.filter(({ s }) => codeSteps(s) > 1).map((x) => x.i);
    return `topic "${id}": the viewer chose brief, but scenes[${walked.join(', ')}] walk the code in steps, which is deep; show the key lines in one step`;
  }
  return null;
}

/** The topics whose scenes in `sb` show the pick the viewer made, so the video is built from that pick. */
export const topicsBuilt = (sb, plan) => topicChecks(sb, plan).built;
