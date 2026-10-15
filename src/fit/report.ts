import type { Fit } from '../../shared/textfit.mjs';
import type { HunkMap, Scene, Storyboard } from '../types';

/** Everything a scene type fits its text into, given its scene: the layouts its component draws from. */
type SceneFits = { [T in Scene['type']]: (scene: Extract<Scene, { type: T }>, storyboard: Storyboard, hunks: HunkMap) => unknown };

const SCENE_FITS: SceneFits = {
  intent: () => null,
  arch: () => null,
  code: () => null,
  flow: () => null,
  sequence: () => null,
  er: () => null,
  state: () => null,
  mermaid: () => null,
  tests: () => null,
  table: () => null,
  chart: () => null,
  timeline: () => null,
  files: () => null,
};

/** Every fit inside a layout, found by walking it, so a text a layout fits can never go unreported. */
function collect(value: unknown, out: Fit[], seen: Set<object>): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if ((value as Fit).fit === true && typeof (value as Fit).path === 'string') {
    out.push(value as Fit);
    return;
  }
  if (value instanceof Map) for (const v of value.values()) collect(v, out, seen);
  else for (const v of Object.values(value)) collect(v, out, seen);
}

export interface FitReport {
  scene: number;
  fits: Fit[];
}

/** Every text each scene draws, fitted exactly as the player fits it. Expects a normalized, valid storyboard. */
export function fitReport(storyboard: Storyboard, hunks: HunkMap): FitReport[] {
  return storyboard.scenes.map((scene, i) => {
    const out: Fit[] = [];
    const fits = SCENE_FITS[scene.type] as (s: Scene, sb: Storyboard, h: HunkMap) => unknown;
    collect(fits(scene, storyboard, hunks), out, new Set());
    return { scene: i, fits: out };
  });
}
