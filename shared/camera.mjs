// The camera: where each step points the view of its scene. A step's `camera` frames refs, the ones its `focus` takes,
// and the view eases there as the step starts; it stays until a step points it elsewhere or back at "all". One walk
// here resolves every step's shot and its problems, and one function frames a shot on the boxes a scene gives its pen,
// so the scene (src/components/SceneShell.tsx) and `validate` see the same view.

import { INK_TYPES, stepRefKeys } from './ink.mjs';
import { sceneSteps } from './steps.mjs';
import { refNames } from './targets.mjs';
import { aType } from './words.mjs';

/** Scene types whose steps take `camera`: the ones whose steps take ink, every scene with refs and code. */
export const CAMERA_TYPES = INK_TYPES;
/** The most a camera zooms, by `zoom`. */
export const ZOOM_MAX = 40;
/** The most a camera zooms when it fits its refs by itself, so one small item does not fill the screen. */
export const FIT_ZOOM_MAX = 6;
/** Room left round framed refs: this share of their box's larger side, and at least MARGIN_PX. */
const MARGIN_SHARE = 0.15;
const MARGIN_PX = 48;

const isRef = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

/**
 * Each state's shot: `shots[0]` during the narration, which is always the whole scene, and `shots[k + 1]` from step k
 * on. A shot is null for the whole scene, or the item keys it frames, the refs as written, and its zoom when the step
 * gives one. `moves` is false when no step has a camera, so the scene draws exactly as it did before cameras.
 * @returns {{ shots: ({ keys: string[], refs: (string | number)[], zoom: number | null } | null)[], problems: { step: number, field: string, message: string, suggest?: { name: string, names: string[] } }[], moves: boolean }}
 */
export function cameraShots(scene, hunks = {}) {
  const steps = sceneSteps(scene);
  const problems = [];
  const shots = [null];
  if (!steps.some((step) => step?.camera !== undefined)) return { shots: [...shots, ...steps.map(() => null)], problems, moves: false };
  const problem = (step, field, message, suggest) => {
    problems.push({ step, field, message, ...(suggest ? { suggest } : {}) });
  };
  const names = scene.type === 'code' ? [] : refNames(scene, hunks);
  let shot = null;
  steps.forEach((step, k) => {
    const value = step?.camera;
    if (value !== undefined) {
      const next = CAMERA_TYPES.includes(scene.type) ? readShot(scene, hunks, step, k, value, names, problem) : problem(k, 'camera', `${aType(scene.type)} scene has no refs to frame; camera goes on the steps of ${CAMERA_TYPES.join(', ')}`);
      if (next !== undefined) shot = next;
    }
    shots.push(shot);
  });
  return { shots, problems, moves: true };
}

/** A step's `camera` as a shot, null for "all", or undefined after reporting why it is not one. */
function readShot(scene, hunks, step, k, value, names, problem) {
  if (value === 'all') return null;
  const help = 'must be "all", a ref, a list of refs, or { "on": refs, "zoom": 3 }';
  let refs = value;
  let zoom = null;
  let field = 'camera';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const extra = Object.keys(value).filter((key) => key !== 'on' && key !== 'zoom');
    if (extra.length) return problem(k, `camera.${extra[0]}`, `is not a camera field; a camera is { "on": refs, "zoom": 3 }`, { name: extra[0], names: ['on', 'zoom'] });
    if (value.on === undefined) return problem(k, 'camera.on', 'required: the ref or refs to frame');
    if (value.zoom !== undefined) {
      if (typeof value.zoom !== 'number' || !Number.isFinite(value.zoom) || value.zoom < 1 || value.zoom > ZOOM_MAX) return problem(k, 'camera.zoom', `must be a number from 1, the whole scene's scale, to ${ZOOM_MAX}`);
      zoom = value.zoom;
    }
    refs = value.on;
    field = 'camera.on';
  }
  const list = Array.isArray(refs) ? refs : [refs];
  if (!list.length) return problem(k, field, 'an empty list frames nothing; name a ref, or write "all"');
  if (list.includes('all')) return problem(k, field, '"all" frames the whole scene on its own; write "camera": "all"');
  const keys = [];
  for (const [j, ref] of list.entries()) {
    const at = Array.isArray(refs) ? `${field}[${j}]` : field;
    if (!isRef(ref)) return problem(k, at, help);
    const hit = stepRefKeys(scene, hunks, step, ref);
    if (typeof hit === 'number') return problem(k, at, `${JSON.stringify(ref)} occurs ${hit} times on the step's lines; lengthen it until it names one place`);
    if (!hit) return problem(k, at, scene.type === 'code' ? `${JSON.stringify(ref)} is not on the step's lines; name a line number, an "a-b" range, or text copied exactly from the code` : `${JSON.stringify(ref)} names nothing in this ${scene.type}`, scene.type === 'code' ? undefined : { name: String(ref), names });
    keys.push(...hit);
  }
  return { keys: [...new Set(keys)], refs: list, zoom };
}

/**
 * Where a view looks: the point of the content box at the centre of the screen, and how much it is enlarged (1 is the
 * whole scene as it draws without a camera).
 * @typedef {{ x: number, y: number, zoom: number }} View
 */

/** The whole scene, as it draws without a camera. */
export const wholeView = (area) => ({ x: area.width / 2, y: area.height / 2, zoom: 1 });

/**
 * The view at rest on a shot: the union of its keys' boxes with a margin, fitted to the screen and kept inside the
 * content box, at the shot's zoom when it has one. `boxOf` gives a key's box in the content box, or null; a shot
 * none of whose keys has a box, such as one on items hidden at that step, frames the whole scene.
 */
export function frameShot(shot, boxOf, area) {
  if (!shot) return wholeView(area);
  const boxes = shot.keys.map(boxOf).filter((b) => b && Number.isFinite(b.x) && b.width >= 0 && b.height >= 0);
  if (!boxes.length) return wholeView(area);
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  const margin = Math.max(MARGIN_PX, MARGIN_SHARE * Math.max(x1 - x0, y1 - y0));
  const fit = Math.min(area.width / (x1 - x0 + 2 * margin), area.height / (y1 - y0 + 2 * margin));
  const zoom = Math.min(ZOOM_MAX, Math.max(1, shot.zoom ?? Math.min(fit, FIT_ZOOM_MAX)));
  const keep = (c, size) => Math.min(size - size / (2 * zoom), Math.max(size / (2 * zoom), c));
  return { x: keep((x0 + x1) / 2, area.width), y: keep((y0 + y1) / 2, area.height), zoom };
}

/** The part of the content box a view shows. */
export const viewRect = (view, area) => ({ x: view.x - area.width / (2 * view.zoom), y: view.y - area.height / (2 * view.zoom), width: area.width / view.zoom, height: area.height / view.zoom });

/**
 * A view partway, `t` from 0 to 1, from one to another. The zoom changes evenly in scale, and the centre moves so that
 * the shown part grows or shrinks about one fixed point, as a camera zooming straight in on something does.
 */
export function tweenView(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const zoom = a.zoom * (b.zoom / a.zoom) ** t;
  const share = Math.abs(b.zoom - a.zoom) < 1e-6 ? t : (1 / a.zoom - 1 / zoom) / (1 / a.zoom - 1 / b.zoom);
  return { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share, zoom };
}

/** A CSS transform, with its origin at the top left, that shows `view` of a content box of `area`. */
export const viewTransform = (view, area) => `translate(${area.width / 2 - view.x * view.zoom}px, ${area.height / 2 - view.y * view.zoom}px) scale(${view.zoom})`;
