// Checks a step's `camera`: what it names through shared/camera.mjs, the walk the scenes frame from, and, once the
// scenes' layouts are known, what each shot leaves out of view.

import { cameraShots, frameShot, viewRect } from '../../shared/camera.mjs';
import { refNames, resolveRef, stepTargets } from '../../shared/targets.mjs';
import { focusSteps } from '../../shared/normalize.mjs';
import { didYouMean } from './suggest.mjs';

/** Every problem the walk over a scene's camera finds, such as a ref that names nothing or a zoom out of range. */
export function checkCamera(s, p, hunks, errors) {
  for (const { step, field, message, suggest } of cameraShots(s, hunks).problems) errors.push(`${p}.steps[${step}].${field}: ${message}${suggest ? didYouMean(suggest.name, suggest.names) : ''}`);
}

const inside = (r, b) => b.x >= r.x - 1 && b.y >= r.y - 1 && b.x + b.width <= r.x + r.width + 1 && b.y + b.height <= r.y + r.height + 1;

/**
 * A lit ref the camera leaves wholly or partly out of view, for the scene types whose step boxes are known without
 * rendering (`stages`, from src/fit/report.ts). A ref is named as the step wrote it.
 */
export function checkCameraCrops(storyboard, hunks, stages, warnings) {
  storyboard.scenes.forEach((scene, i) => {
    const steps = stages[i];
    const { shots, moves, problems } = cameraShots(scene, hunks);
    if (!steps || !moves || problems.length) return;
    const lit = stepTargets({ ...scene, steps: focusSteps(scene) }, hunks);
    const names = refNames(scene, hunks);
    const nameOf = (key) => names.find((n) => (resolveRef(scene, n, hunks) ?? []).length === 1 && resolveRef(scene, n, hunks)[0] === key) ?? key.slice(key.indexOf(':') + 1);
    steps.forEach((stage, k) => {
      const shot = shots[k + 1];
      if (!shot || !stage) return;
      const boxes = new Map(stage.boxes);
      const view = viewRect(frameShot(shot, (key) => boxes.get(key), stage.area), stage.area);
      const cut = (lit[k] ?? []).filter((key) => boxes.has(key) && !inside(view, boxes.get(key)));
      if (!cut.length) return;
      const how = shot.zoom !== null && shot.keys.some((key) => cut.includes(key)) ? `zoom ${shot.zoom} is too close to show all of it` : 'it is out of the shot';
      warnings.push(`scenes[${i}].steps[${k}].camera: the step lights ${cut.map((key) => JSON.stringify(nameOf(key))).join(', ')}, but ${how}; frame it too, or lower the zoom`);
    });
  });
}
