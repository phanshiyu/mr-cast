import { fitText, type Fit } from '../../shared/textfit.mjs';
import type { Scene } from '../types';
import { SLOTS, sized } from './slots';

/** The most header room a callout takes, at the right end of the header row; a shorter one takes less. */
const CALLOUT_W = 560;
export const CALLOUT_PAD = { x: 22, y: 12 };

type WithCallout = Scene & { callout?: string; steps?: readonly { callout?: string }[] };

/** Whether any state of the scene shows a callout: its own, or one a step brings. */
export const hasCallout = (scene: Scene): boolean => {
  const s = scene as WithCallout;
  return Boolean(s.callout) || (s.steps ?? []).some((step) => Boolean(step?.callout));
};

/** Every callout the scene shows, fitted, by its text; the first path that shows a text names it. */
export function calloutFits(scene: Scene): Map<string, Fit> {
  const s = scene as WithCallout;
  const texts: [string, string][] = [];
  if (s.callout) texts.push([s.callout, 'callout']);
  (s.steps ?? []).forEach((step, k) => step?.callout && texts.push([step.callout, `steps[${k}].callout`]));
  const out = new Map<string, Fit>();
  for (const [text, path] of texts)
    if (!out.has(text)) out.set(text, fitText(text, sized(SLOTS.headerCallout, CALLOUT_W - 2 * CALLOUT_PAD.x), path));
  return out;
}

/** Width of the callout's box: its widest text and padding, so the title keeps the rest of the header; 0 for none. */
export function calloutBoxWidth(scene: Scene): number {
  const fits = [...calloutFits(scene).values()];
  return fits.length ? Math.max(...fits.map((f) => f.width)) + 2 * CALLOUT_PAD.x : 0;
}
