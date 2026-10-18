// Checks for the `svg` scene, mirroring src/types.ts: the markup (through shared/svg.mjs, the same reader the
// scene draws from), the ids its fields name, and the size its text lands at on screen. Each pushes
// human/LLM-readable strings onto `errors` and `warnings`.

import { cameraShots, frameShot, viewRect } from '../../shared/camera.mjs';
import { inkBoard } from '../../shared/ink.mjs';
import { walkStates } from '../../shared/state-steps.mjs';
import { svgGeometry, svgOf, svgStage } from '../../shared/svg.mjs';
import { stateMotion } from '../../shared/svg-motion.mjs';
import { READABLE_PX } from '../../shared/textfit.mjs';
import { tenths } from './validate-fit.mjs';
import { checkStateSteps } from './validate-state.mjs';
import { didYouMean } from './suggest.mjs';

/** The stage a drawing fills: the content box under its header, taller without a title or callout (src/components/theme.ts contentBox). */
export const stageOf = (s) => ({ width: 1920 - 104 - 104, height: 1080 - 64 - 150 - 62 - (s.title || s.callout || (Array.isArray(s.steps) && s.steps.some((st) => st?.callout)) ? 70 : 0) });

const isStr = (v) => typeof v === 'string';

export function checkSvg(s, p, errors, warnings) {
  const before = errors.length;
  for (const k of ['title', 'callout']) if (s[k] !== undefined && !isStr(s[k])) errors.push(`${p}.${k}: must be a string`);
  if (!isStr(s.svg)) return errors.push(`${p}.svg: required string of SVG markup, "<svg viewBox=\\"0 0 400 300\\">...</svg>"`);
  const { root, viewBox, ids, problems } = svgOf(s.svg);
  for (const problem of problems) errors.push(`${p}.svg: ${problem}`);
  if (!root || !viewBox) return;
  const known = [...ids.keys()];
  const named = (ref, at) => {
    if (ids.has(ref)) return true;
    errors.push(`${at}: "${ref}" is no element id in the drawing${known.length ? didYouMean(String(ref), known) : '; give the elements it names an id'}`);
    return false;
  };
  if (s.labels !== undefined) {
    if (!s.labels || typeof s.labels !== 'object' || Array.isArray(s.labels)) errors.push(`${p}.labels: must be an object of element id to words, e.g. { "car": "the car" }`);
    else for (const [id, words] of Object.entries(s.labels)) if (named(id, `${p}.labels`) && !isStr(words)) errors.push(`${p}.labels["${id}"]: must be a string`);
  }
  if (s.hidden !== undefined) {
    if (!Array.isArray(s.hidden)) errors.push(`${p}.hidden: must be an array of element ids`);
    else s.hidden.forEach((id, j) => named(id, `${p}.hidden[${j}]`));
  }
  if (errors.length > before) return;
  checkStateSteps(s, p, errors, warnings);
  if (errors.length > before) return;
  checkInkPlaces(s, p, root, ids, errors);

  const [vx, vy, vw, vh] = viewBox;
  const texts = svgGeometry(root).texts;
  for (const [n, { at, px, scale }] of [...smallestTexts(s, root, ids, viewBox)].sort((a, b) => a[0] - b[0])) {
    const t = texts[n];
    const what = `${p}.svg: text "${t.text.slice(0, 40)}"${t.id ? ` (id "${t.id}")` : ''}`;
    if (px < READABLE_PX) warnings.push(`${what} draws about ${tenths(px)} px tall on screen${at === null ? '' : at < 0 ? ' during the narration' : ` at step ${at}`}, too small to read; make its font-size at least ${Math.ceil(READABLE_PX / scale)} in viewBox units, or shrink the viewBox${at === null ? '' : ", or hide it until a step's camera zooms in on it"}`);
    const { x, y, width, height } = t.box;
    if (x < vx - 1 || y < vy - 1 || x + width > vx + vw + 1 || y + height > vy + vh + 1) warnings.push(`${what} runs past the viewBox (${vx} ${vy} ${vw} ${vh}), so part of it is cut off; move it in, or widen the viewBox`);
  }
}

/** Ink on an element with no place on the stage, such as a gradient, a `<stop>` or an empty group, which draws nothing. */
function checkInkPlaces(s, p, root, ids, errors) {
  const { items } = inkBoard(s);
  if (!items.length) return;
  const states = walkStates(s).states;
  for (const { step, index, item, verb, targets } of items) {
    const { boxes } = svgGeometry(root, stateMotion(ids, states[step + 1]));
    targets.forEach((target, j) => {
      const lost = (target.keys ?? []).find((key) => key.startsWith('s:') && !boxes.has(key.slice(2)));
      if (!lost) return;
      const field = verb === 'arrow' ? `arrow[${j}]` : verb === 'write' ? 'near' : Array.isArray(item[verb]) ? `${verb}[${j}]` : verb;
      const id = lost.slice(2);
      errors.push(`${p}.steps[${step}].draw[${index}].${field}: "${id}" is a <${ids.get(id)?.tag}> with nothing drawn on the stage, so ink has no place to draw; name a shape, a text or a tspan, or a group with one in it`);
    });
  }
}

const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Each text's smallest size on screen, in document order: at every state it is drawn in, shown and in the camera's
 * view, its size with the moves of that state, times the drawing's scale and the camera's zoom. `at` is the step
 * (-1 for the narration) where it is smallest, or null when no step has a camera, so the size is the drawing's own.
 * `scale` is the stage scale times the zoom there. A text that is never drawn is not measured.
 */
function smallestTexts(s, root, ids, viewBox) {
  const area = stageOf(s);
  const stage = svgStage(viewBox, area);
  const { shots, moves } = cameraShots(s);
  const onStage = (b) => ({ x: stage.left + b.x * stage.scale, y: stage.top + b.y * stage.scale, width: b.width * stage.scale, height: b.height * stage.scale });
  const out = new Map();
  walkStates(s).states.forEach((state, n) => {
    const { boxes, texts } = svgGeometry(root, stateMotion(ids, state));
    const view = frameShot(n > 0 && moves ? shots[n] : null, (key) => (boxes.has(key.slice(2)) ? onStage(boxes.get(key.slice(2))) : null), area);
    const shown = viewRect(view, area);
    texts.forEach((t, i) => {
      if (t.owners.some((id) => state.hidden[`s:${id}`]) || !meets(onStage(t.box), shown)) return;
      const px = t.size * stage.scale * view.zoom;
      if (!out.has(i) || px < out.get(i).px) out.set(i, { at: moves ? n - 1 : null, px, scale: stage.scale * view.zoom });
    });
  });
  return out;
}
