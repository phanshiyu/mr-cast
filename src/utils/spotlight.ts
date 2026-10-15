import { interpolate } from 'remotion';

const STEP_FADE = 14;
const DIM_OPACITY = 0.42;
const VISITED_OPACITY = 0.72;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export interface Emphasis {
  opacity: number;
  /** Strength of the current-step marker: 1 on the current item, a trace on visited ones. */
  bar: number;
  /** 1 only while the item is the current step. */
  glow: number;
}

/**
 * Spotlights items one at a time, the way a code scene walks its focus ranges: after `introEnd` each
 * step takes an equal share of the time until 90% of the scene, the current item at full strength,
 * visited ones softer, the rest dimmed. Items outside the steps dim once the first step starts.
 */
export function spotlight(frame: number, introEnd: number, durationInFrames: number, count: number) {
  const stepsEnd = Math.max(introEnd, Math.round(durationInFrames * 0.9));
  const starts = Array.from({ length: count }, (_, k) => introEnd + (k * (stepsEnd - introEnd)) / count);
  const reached = (k: number) => (k < count ? interpolate(frame, [starts[k]!, starts[k]! + STEP_FADE], [0, 1], clamp) : 0);
  const dim = reached(0);
  return {
    starts,
    emphasis(step: number | null): Emphasis {
      const now = step === null ? 0 : reached(step);
      const passed = step === null ? 0 : reached(step + 1);
      return {
        opacity: 1 - (1 - DIM_OPACITY) * (dim - now) - (1 - VISITED_OPACITY) * passed,
        bar: now - 0.7 * passed,
        glow: now - passed,
      };
    },
  };
}
