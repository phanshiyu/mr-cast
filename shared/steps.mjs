// Steps, shared by the composition (TS) and the CLI (plain Node). A step names what a scene shows
// and the words to `say` while it is shown, so the scene speaks its narration, then each step's words.

/** The scene types that take steps, and the steps of a scene. A flow's steps speak only when they carry `say`. */
const own = (scene) => scene.steps;
const STEPS_OF = {
  code: own,
  graph: own,
  sequence: own,
  er: own,
  state: own,
  table: own,
  chart: own,
  timeline: own,
  files: own,
  tests: own,
  intent: own,
  flow: (scene) => (Array.isArray(scene.steps) && scene.steps.some((step) => step?.say !== undefined) ? scene.steps : undefined),
};

/** The steps a scene speaks, in order; empty for a scene without them. */
export function sceneSteps(scene) {
  const steps = STEPS_OF[scene?.type]?.(scene);
  return Array.isArray(steps) ? steps : [];
}

/** An item index or an inclusive "a-b" range of indexes, as [first, last]; null when it is neither. */
export function indexRange(ref) {
  if (Number.isInteger(ref) && ref >= 0) return [ref, ref];
  const m = typeof ref === 'string' ? /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(ref) : null;
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a <= b ? [a, b] : null;
}
