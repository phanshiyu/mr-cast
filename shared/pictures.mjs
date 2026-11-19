// Pictures: drawings a storyboard names once in `pictures` and svg scenes draw with `"picture": name` (ADR 47).
// A scene that draws the same picture as the scene before it continues it: it starts with what the earlier scene
// ended on shown and tinted, and the engine holds the picture still between the two.

import { walkStates } from './state-steps.mjs';

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** The picture an svg scene draws, when the storyboard has it. */
const pictureOf = (scene, storyboard) =>
  scene?.type === 'svg' &&
  typeof scene.picture === 'string' &&
  isObj(storyboard?.pictures) &&
  typeof storyboard.pictures[scene.picture] === 'string'
    ? scene.picture
    : null;

/** Whether scene i continues the picture of scene i - 1. */
const continuesPicture = (scenes, i, storyboard) => {
  const name = pictureOf(scenes[i], storyboard);
  return i > 0 && name !== null && pictureOf(scenes[i - 1], storyboard) === name;
};

/** What a scene ends on, as the `hidden` ids and `tint` record a continuing scene starts from. */
function endOf(scene) {
  const { states } = walkStates(scene);
  const last = states[states.length - 1];
  if (!last) return { hidden: [], tint: {} };
  const id = (key) => key.slice(2);
  return {
    hidden: Object.keys(last.hidden).map(id),
    tint: Object.fromEntries(Object.entries(last.tints).map(([key, tone]) => [id(key), tone])),
  };
}

/**
 * The storyboard with each picture scene's `svg` filled in from `pictures`, and each scene that continues a picture
 * starting from what the scene before it ended on, unless it sets its own `hidden` or `tint`. Returns the storyboard
 * itself when it has no picture scenes.
 */
export function expandPictures(storyboard) {
  const scenes = storyboard?.scenes;
  if (!Array.isArray(scenes) || !scenes.some((s) => pictureOf(s, storyboard) !== null && s.svg === undefined))
    return storyboard;
  const out = [];
  scenes.forEach((scene, i) => {
    const name = pictureOf(scene, storyboard);
    if (name === null || scene.svg !== undefined) {
      out.push(scene);
      return;
    }
    let next = { ...scene, svg: storyboard.pictures[name] };
    if (continuesPicture(scenes, i, storyboard)) {
      const end = endOf(out[i - 1]);
      next = {
        ...next,
        ...(scene.hidden === undefined ? { hidden: end.hidden } : {}),
        ...(scene.tint === undefined ? { tint: end.tint } : {}),
      };
    }
    out.push(next);
  });
  return { ...storyboard, scenes: out };
}

/**
 * Problems with `pictures` and `picture`, as { at, message, level }: a picture that is not markup, a scene that names
 * a picture the storyboard lacks or draws one on a scene type other than svg, a scene with both `svg` and `picture`,
 * and, as a warning, a continuing scene whose picture jumps because the scene before it moved, morphed or set text.
 */
export function pictureProblems(storyboard) {
  const problems = [];
  const pictures = storyboard?.pictures;
  if (pictures !== undefined && !isObj(pictures))
    problems.push({ at: 'pictures', message: 'must be an object of name to <svg> markup', level: 'error' });
  else
    for (const [name, markup] of Object.entries(pictures ?? {}))
      if (typeof markup !== 'string' || !markup.trim().startsWith('<svg'))
        problems.push({ at: `pictures.${name}`, message: 'must be one <svg viewBox="..."> element', level: 'error' });
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  scenes.forEach((scene, i) => {
    if (scene?.picture === undefined) return;
    const at = `scenes[${i}].picture`;
    const names = Object.keys(isObj(pictures) ? pictures : {});
    if (scene.type !== 'svg')
      problems.push({ at, message: `only an svg scene draws a picture, not ${scene.type}`, level: 'error' });
    else if (typeof scene.picture !== 'string' || !names.includes(scene.picture))
      problems.push({
        at,
        message: `${JSON.stringify(scene.picture)} is not in the storyboard's pictures${names.length ? `; they are ${names.map((n) => JSON.stringify(n)).join(', ')}` : ', which has none'}`,
        level: 'error',
      });
    else if (scene.svg !== undefined)
      problems.push({ at, message: 'the scene has its own svg too; give it one or the other', level: 'error' });
    else if (continuesPicture(scenes, i, storyboard)) {
      const before = scenes[i - 1];
      const changed = (Array.isArray(before.steps) ? before.steps : []).some(
        (st) => isObj(st?.move) || isObj(st?.morph) || isObj(st?.set),
      );
      if (changed)
        problems.push({
          at,
          message: `continues scene ${i - 1}'s picture, which moves, morphs or sets text; this scene starts from the drawing as written, so those parts jump back`,
          level: 'warning',
        });
    }
  });
  return problems;
}
