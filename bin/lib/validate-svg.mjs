// Checks for the `svg` scene, mirroring src/types.ts: the markup (through shared/svg.mjs, the same reader the
// scene draws from), the ids its fields name, and the size its text lands at on screen. Each pushes
// human/LLM-readable strings onto `errors` and `warnings`.

import { svgGeometry, svgOf, svgStage } from '../../shared/svg.mjs';
import { READABLE_PX } from '../../shared/textfit.mjs';
import { tenths } from './validate-fit.mjs';
import { checkStateSteps } from './validate-state.mjs';
import { didYouMean } from './suggest.mjs';

/** The stage a drawing fills: the content box under its header, taller without a title or callout (src/components/theme.ts contentBox). */
const stageOf = (s) => ({ width: 1920 - 104 - 104, height: 1080 - 64 - 150 - 62 - (s.title || s.callout || (Array.isArray(s.steps) && s.steps.some((st) => st?.callout)) ? 70 : 0) });

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

  const { scale } = svgStage(viewBox, stageOf(s));
  const [vx, vy, vw, vh] = viewBox;
  for (const t of svgGeometry(root).texts) {
    const what = `${p}.svg: text "${t.text.slice(0, 40)}"${t.id ? ` (id "${t.id}")` : ''}`;
    const px = t.size * scale;
    if (px < READABLE_PX) warnings.push(`${what} draws about ${tenths(px)} px tall on screen, too small to read; make its font-size at least ${Math.ceil(READABLE_PX / scale)} in viewBox units, or shrink the viewBox`);
    const { x, y, width, height } = t.box;
    if (x < vx - 1 || y < vy - 1 || x + width > vx + vw + 1 || y + height > vy + vh + 1) warnings.push(`${what} runs past the viewBox (${vx} ${vy} ${vw} ${vh}), so part of it is cut off; move it in, or widen the viewBox`);
  }
}
