// plan.json: the topics of a change, each with a suggested depth and 1 to 3 ways to show it. Claude writes it,
// the viewer picks a depth and a view per topic on the plan page, and Claude writes the storyboard from the picks.

import { VIEWS, isView } from './views.mjs';

export const DEPTHS = ['skip', 'brief', 'deep'];
const TOPIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VIEWS_MAX = 3;
// The opening text scene and the closing tests scene, which every video has whatever the picks.
export const FIXED_SECONDS = 40;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isSeconds = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Claude's suggestion for a topic. */
export const suggestionOf = (topic) => ({ depth: topic.depth, view: topic.views[0] });

/** What the video does with a topic: the viewer's choice, else the suggestion. */
export const pickOf = (topic) => topic.choice ?? suggestionOf(topic);

export const samePick = (a, b) => a?.depth === b?.depth && a?.view === b?.view;

/** Why `choice` is not a pick `topic` offers, or null when it is. */
export function choiceError(topic, choice) {
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return 'must be an object { depth, view }';
  if (!DEPTHS.includes(choice.depth))
    return `depth must be one of ${DEPTHS.join(', ')} (got ${JSON.stringify(choice.depth)})`;
  if (!Array.isArray(topic.views) || !topic.views.includes(choice.view))
    return `view must be one of the topic's views, ${(topic.views ?? []).join(', ')} (got ${JSON.stringify(choice.view)})`;
  const extra = Object.keys(choice).filter((k) => k !== 'depth' && k !== 'view');
  return extra.length ? `takes only depth and view (got ${extra.join(', ')})` : null;
}

/**
 * Problems with plan.json as Claude wrote it, as `topics[1].views: ...` lines. A pre-read (`preread`) puts no
 * code on screen, so no topic may offer the code view.
 */
export function checkPlan(plan, { preread = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan))
    return { errors: ['must be a JSON object { "topics": [...] }'], warnings };
  if (!Array.isArray(plan.topics) || plan.topics.length === 0)
    return { errors: ['topics: required non-empty array'], warnings };
  const ids = new Set();
  plan.topics.forEach((t, i) => {
    const p = `topics[${i}]`;
    if (!t || typeof t !== 'object') return errors.push(`${p}: must be an object`);
    if (typeof t.id !== 'string' || !TOPIC_ID.test(t.id))
      errors.push(
        `${p}.id: required slug of lowercase letters, digits and single dashes, such as "rate-limiter" (got ${JSON.stringify(t.id)})`,
      );
    else if (ids.has(t.id)) errors.push(`${p}.id: duplicate id "${t.id}"`);
    else ids.add(t.id);
    if (!isStr(t.title)) errors.push(`${p}.title: required string`);
    if (!isStr(t.summary)) errors.push(`${p}.summary: required string, what the topic covers in one line`);
    if (!Array.isArray(t.files) || !t.files.every(isStr))
      errors.push(`${p}.files: required array of file paths ([] when none)`);
    if (!DEPTHS.includes(t.depth)) errors.push(`${p}.depth: must be one of ${DEPTHS.join(', ')}, your suggestion`);
    if (t.why !== undefined && typeof t.why !== 'string') errors.push(`${p}.why: must be a string`);
    if (!isSeconds(t.seconds?.brief) || !isSeconds(t.seconds?.deep))
      errors.push(
        `${p}.seconds: required { "brief": n, "deep": n }, about how many seconds the topic takes at each depth`,
      );
    let viewsOk = Array.isArray(t.views) && t.views.length >= 1 && t.views.length <= VIEWS_MAX;
    if (!viewsOk) errors.push(`${p}.views: required array of 1 to ${VIEWS_MAX} views, your suggestion first`);
    else {
      t.views.forEach((v, j) => {
        if (!isView(v)) {
          viewsOk = false;
          errors.push(
            `${p}.views[${j}]: unknown view ${JSON.stringify(v)}; use one of ${Object.keys(VIEWS).join(', ')}`,
          );
        } else if (t.views.indexOf(v) !== j) {
          viewsOk = false;
          errors.push(`${p}.views[${j}]: "${v}" is listed twice`);
        }
      });
    }
    if (preread && viewsOk && t.views.includes('code'))
      errors.push(
        `${p}.views: a pre-read puts no code on screen, so drop "code" and offer the views that draw the topic, such as "data" or "decisions"`,
      );
    if (t.choice !== undefined && viewsOk) {
      const problem = choiceError(t, t.choice);
      if (problem) errors.push(`${p}.choice: ${problem}`);
    }
  });
  return { errors, warnings };
}

/** About how long the video is with every topic at its pick. */
export const planSeconds = (plan) =>
  FIXED_SECONDS +
  plan.topics.reduce((sum, t) => {
    const { depth } = pickOf(t);
    return depth === 'skip' ? sum : sum + t.seconds[depth];
  }, 0);

/** "About 4:30", rounded to ten seconds. */
export function formatLength(seconds) {
  const rounded = Math.max(10, Math.round(seconds / 10) * 10);
  return `About ${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
