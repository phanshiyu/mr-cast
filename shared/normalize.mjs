// Turns a storyboard as written, older field names included, into the shape the scenes draw. It runs once
// where a storyboard enters: after `validate` in the CLI and after the player fetches storyboard.json.

import { plainText } from './markup.mjs';
import { FLAG_MARK, flaggedFinding } from './review.mjs';
import { STATE_TYPES, changedRefs } from './state-steps.mjs';

/** What `kind` meant before nodes had their own icon and caption. */
const KINDS = {
  service: { icon: 'server', caption: 'service' },
  db: { icon: 'database', caption: 'datastore' },
  queue: { icon: 'layers', caption: 'queue' },
  client: { icon: 'monitor', caption: 'client' },
};

/** The key each scene type's steps used before `focus`. */
const LEGACY_FOCUS = {
  sequence: ['messages'],
  timeline: ['events'],
  er: ['entity'],
  state: ['state', 'transition'],
  chart: ['label'],
  table: ['row'],
  files: ['path'],
};

/** Scene types renamed since: an `arch` scene is a `graph` now. */
const LEGACY_TYPES = { arch: 'graph' };

export const NODE_KINDS = Object.keys(KINDS);

/**
 * The storyboard with every scene type renamed since it was written replaced by its current name. It runs
 * where a storyboard enters, before `validate` and inside normalizeStoryboard, so nothing past it sees `arch`.
 */
export function upgradeTypes(storyboard) {
  if (!Array.isArray(storyboard?.scenes)) return storyboard;
  const renamed = (scene) => (scene && typeof scene === 'object' && Object.hasOwn(LEGACY_TYPES, scene.type) ? { ...scene, type: LEGACY_TYPES[scene.type] } : scene);
  return storyboard.scenes.some((s) => renamed(s) !== s) ? { ...storyboard, scenes: storyboard.scenes.map(renamed) } : storyboard;
}
export const legacyFocusKeys = (type) => LEGACY_FOCUS[type] ?? [];

/** An explanation walks through unchanged source snippets; a diff walkthrough always has a changed hunk. */
export const isExplanation = (hunks) => Object.values(hunks ?? {}).every((h) => h.status === 'source');

const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/**
 * `modified: true` once marked both a part the diff changed and a part worth looking at. With a diff it
 * stays a change; an explanation has no diff, so there it can only have meant emphasis.
 */
function normalizeMarks(raw, explain) {
  const { modified, ...item } = raw;
  const marked = modified === true && item.change === undefined && item.highlight === undefined;
  return defined({ ...item, change: marked && !explain ? 'modified' : item.change, highlight: marked && explain ? true : item.highlight });
}

function normalizeNode(raw, explain) {
  const { kind, ...node } = normalizeMarks(raw, explain);
  const legacy = KINDS[kind];
  return defined({ ...node, icon: node.icon ?? legacy?.icon, caption: node.caption ?? legacy?.caption });
}

/** A scene's steps with each older focus key renamed to `focus`, and a step that changes state and names no focus focusing what it changes. */
export function focusSteps(scene) {
  if (STATE_TYPES.includes(scene.type) && Array.isArray(scene.steps)) {
    return scene.steps.map((step) => (step && typeof step === 'object' && step.focus === undefined ? { ...step, focus: changedRefs(scene, step) } : step));
  }
  const keys = legacyFocusKeys(scene.type);
  if (!Array.isArray(scene.steps) || !keys.length) return scene.steps;
  return scene.steps.map((step) => {
    if (step?.focus !== undefined) return step;
    const key = keys.find((k) => step?.[k] !== undefined);
    if (!key) return step;
    const { [key]: focus, ...rest } = step;
    return { ...rest, focus };
  });
}

/** A flagged code step draws its finding's mark: a circle and the claim, unless the step names its own. */
function flagSteps(steps, storyboard) {
  return steps.map((step) => {
    const finding = flaggedFinding(storyboard, step);
    return finding ? { ...step, mark: step.mark ?? FLAG_MARK, note: step.note ?? plainText(finding.claim) } : step;
  });
}

/** Markup characters written as themselves, so a storyboard title draws as written. */
const literal = (text) => String(text ?? '').replace(/[\\*`=[\]{}]/g, (c) => `\\${c}`);

/**
 * An intent scene is a text scene: its summary the headline, its bullets the items, the storyboard's title line
 * above, and the diff's size at the top right.
 */
export function intentAsText(scene, storyboard) {
  const { type, summary, bullets, ...rest } = scene;
  const kicker = storyboard.subtitle ? `${literal(storyboard.title)} · [${literal(storyboard.subtitle)}]{neutral}` : literal(storyboard.title);
  return { ...rest, type: 'text', kicker, headline: summary, items: bullets, diffstat: true };
}

function normalizeScene(raw, explain, storyboard) {
  const scene = raw.type === 'intent' ? intentAsText(raw, storyboard) : raw;
  const steps = focusSteps(scene);
  const out = steps === scene.steps ? { ...scene } : { ...scene, steps };
  if (scene.type === 'code' && Array.isArray(out.steps)) out.steps = flagSteps(out.steps, storyboard);
  if (scene.type === 'graph') out.nodes = scene.nodes.map((n) => normalizeNode(n, explain));
  if (scene.type === 'layers') out.layers = scene.layers.map((l) => (l.items ? { ...l, items: l.items.map((n) => normalizeNode(n, explain)) } : l));
  if (scene.type === 'sequence') {
    out.participants = scene.participants.map((n) => normalizeNode(n, explain));
    out.messages = scene.messages.map((m) => normalizeMarks(m, explain));
  }
  return out;
}

/** Expects a storyboard that passed `validate`; returns it with every older field name replaced. */
export function normalizeStoryboard(storyboard, hunks) {
  const explain = isExplanation(hunks);
  const current = upgradeTypes(storyboard);
  return { ...current, scenes: current.scenes.map((scene) => normalizeScene(scene, explain, current)) };
}
