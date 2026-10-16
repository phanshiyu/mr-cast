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

  const topics = new Map(planFile.plan.topics.map((t) => [t.id, { topic: t, pick: pickOf(t), scenes: [] }]));
  sb.scenes.forEach((s, i) => {
    if (typeof s?.topic !== 'string') return;
    const entry = topics.get(s.topic);
    if (!entry) return errors.push(`scenes[${i}].topic: no topic "${s.topic}" in plan.json; use one of ${[...topics.keys()].join(', ')}`);
    entry.scenes.push({ s, i });
    const { view, depth } = entry.pick;
    if (depth === 'skip' || ANY_VIEW.includes(s.type) || VIEWS[view].scenes.includes(s.type)) return;
    warnings.push(`scenes[${i}] is ${aType(s.type)} scene in "${s.topic}", which the viewer chose to see as "${VIEWS[view].label}"; draw it as ${drawn(view)} scene, or move this scene to another topic`);
  });

  for (const [id, { pick, scenes }] of topics) {
    if (pick.depth === 'skip') {
      if (scenes.length) warnings.push(`topic "${id}": the viewer chose to skip it, but scenes[${scenes.map((x) => x.i).join(', ')}] show it; remove them and list its hunks in skipped with the reason "the viewer chose to skip this topic"`);
      continue;
    }
    if (!scenes.length) {
      warnings.push(`topic "${id}": the viewer chose ${pick.depth}, and no scene has "topic": "${id}"; add its scenes, or tag the scenes that show it`);
      continue;
    }
    if (pick.view !== 'code' && !scenes.some(({ s }) => VIEWS[pick.view].scenes.includes(s.type))) {
      warnings.push(`topic "${id}": the viewer chose to see it as "${VIEWS[pick.view].label}", and none of its scenes is ${drawn(pick.view)} scene; add one`);
    }
  }
}
