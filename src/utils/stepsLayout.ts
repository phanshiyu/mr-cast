import { fitTextAt, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { CodeScene } from '../types';

export type FlowSteps = NonNullable<CodeScene['flow']>;

export const NODE_PAD_X = 20;
export const NODE_PAD_Y = 16;
export const BADGE = 40;
export const BADGE_GAP = 16;
/** Gap between nodes, where the arrow runs; it tightens before the font shrinks. */
const ARROW_GAPS = [42, 26];
export const OUTCOME_GAP = 8;
const FONT_MAX = 26;
const FONT_MIN = 17;

export interface StepNodeLayout {
  top: number;
  height: number;
  label: Fit;
  outcome: Fit | null;
}

export interface StepLayout {
  fontSize: number;
  nodes: StepNodeLayout[];
  height: number;
}

export const outcomeFont = (fontSize: number) => Math.round(fontSize * 0.8);

function layoutAt(
  steps: FlowSteps,
  width: number,
  fontSize: number,
  gap: number,
  lines: number,
  path: (k: number) => string,
): StepLayout & { fits: boolean } {
  const textW = width - NODE_PAD_X * 2 - BADGE - BADGE_GAP;
  const small = outcomeFont(fontSize);
  const nodes: StepNodeLayout[] = [];
  let top = 0;
  let fits = true;
  steps.forEach((step, k) => {
    const label = fitTextAt(step.label, { ...sized(SLOTS.stepLabel, textW), lines }, `${path(k)}.label`, fontSize);
    const outcome = step.outcome?.trim()
      ? fitTextAt(step.outcome, { ...sized(SLOTS.stepOutcome, textW - small - 8), lines }, `${path(k)}.outcome`, small)
      : null;
    fits &&= label.fits && (outcome?.fits ?? true);
    const text = label.height + (outcome ? OUTCOME_GAP + outcome.height : 0);
    const height = Math.round(Math.max(BADGE, text) + NODE_PAD_Y * 2);
    nodes.push({ top, height, label, outcome });
    top += height + gap;
  });
  return { fontSize, nodes, height: top - gap, fits };
}

/**
 * The largest font at which every label and outcome fits in two lines and the stack fits `maxHeight`;
 * failing that, the smallest font with three lines each. `path(k)` names step k in the storyboard.
 */
export function layoutSteps(
  steps: FlowSteps,
  width: number,
  maxHeight: number,
  path: (k: number) => string,
): StepLayout {
  for (let size = FONT_MAX; size >= FONT_MIN; size--) {
    for (const gap of ARROW_GAPS) {
      const layout = layoutAt(steps, width, size, gap, 2, path);
      if (layout.fits && layout.height <= maxHeight) return layout;
    }
  }
  return layoutAt(steps, width, FONT_MIN, ARROW_GAPS[ARROW_GAPS.length - 1]!, 3, path);
}
