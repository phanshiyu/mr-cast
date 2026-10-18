import { Easing, interpolate, spring, type SpringConfig } from 'remotion';
import { targetSteps } from '../../shared/targets.mjs';
import { STEP_SETTLE_FRAMES } from '../../shared/timing.mjs';
import type { HunkMap, Scene } from '../types';
import type { SpokenSegment } from './timing';

/** Frames a step's light takes to fade in; inside STEP_SETTLE_FRAMES, so the pen starts on lit items. */
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
 * When each spotlighted item lights up. With steps (segments after the narration), item k lights with
 * segment k + 1, just before its voice names it. Without them, the items share the narration's speech,
 * from when the scene has built in until its last word, so the light never runs far ahead of the voice.
 */
export function spotlightStarts(segments: readonly SpokenSegment[], count: number, introEnd: number): number[] {
  if (segments.length > 1)
    return Array.from({ length: count }, (_, k) => segments[k + 1]?.from ?? segments[segments.length - 1]!.from);
  const narration = segments[0]!;
  const start = Math.max(introEnd, narration.voiceFrom);
  const end = Math.max(start, narration.voiceFrom + narration.speakingFrames);
  return Array.from({ length: count }, (_, k) => start + (k * (end - start)) / count);
}

/**
 * Spotlights items as steps light them: an item the current step lights at full strength, one an earlier
 * step lit softer, the rest dimmed once the first step starts. An item may be lit by several steps.
 */
export function spotlight(frame: number, starts: readonly number[]) {
  const count = starts.length;
  const reached = (k: number) =>
    k < count ? interpolate(frame, [starts[k]!, starts[k]! + STEP_FADE], [0, 1], clamp) : 0;
  const dim = reached(0);
  return {
    emphasis(steps: readonly number[]): Emphasis {
      const now = steps.reduce((sum, k) => sum + reached(k) - reached(k + 1), 0);
      const seen = steps.length ? reached(Math.min(...steps)) : 0;
      return {
        opacity: 1 - (1 - DIM_OPACITY) * (dim - seen) - (1 - VISITED_OPACITY) * (seen - now),
        bar: now + 0.3 * (seen - now),
        glow: now,
      };
    },
  };
}

/** The stronger of two emphases, part by part: an item lit through its own focus or a container's. */
export const brighter = (a: Emphasis, b: Emphasis): Emphasis => ({
  opacity: Math.max(a.opacity, b.opacity),
  bar: Math.max(a.bar, b.bar),
  glow: Math.max(a.glow, b.glow),
});

/** An item at least as bright as the brightest of `others`, such as a node beside a lit edge, so a lit edge never joins two dim nodes. */
export const asBrightAs = (own: Emphasis, others: readonly Emphasis[]): Emphasis => ({
  ...own,
  opacity: Math.max(own.opacity, ...others.map((e) => e.opacity)),
});

/** Emphasis by item key (see shared/targets.mjs) for a scene whose steps take `focus`. */
export function focusSpotlight(scene: Scene, hunks: HunkMap, segments: readonly SpokenSegment[], frame: number) {
  const steps = targetSteps(scene, hunks);
  const { emphasis } = spotlight(
    frame,
    segments.slice(1).map((segment) => segment.from),
  );
  return (key: string): Emphasis => emphasis(steps.get(key) ?? []);
}

/** The step being shown at `frame`: k from segment k + 1's start, or -1 before the first step. */
export function currentStep(segments: readonly SpokenSegment[], frame: number): number {
  let current = -1;
  for (let k = 1; k < segments.length; k++) if (frame >= segments[k]!.from) current = k - 1;
  return current;
}

/** How far, 0 to 1, a move that a step starts at `from` has gone, such as a camera's: at rest when the step settles. */
export const stepMove = (frame: number, from: number): number =>
  interpolate(frame, [from, from + STEP_SETTLE_FRAMES], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.25, 0.1, 0.25, 1),
  });

/** A spring for an item that a step starting at `stepFrom` brings in at `at`, squeezed to rest when the step settles. */
export const stepSpring = (
  frame: number,
  fps: number,
  at: number,
  stepFrom: number,
  config: Partial<SpringConfig>,
): number =>
  spring({ frame: frame - at, fps, config, durationInFrames: Math.max(1, stepFrom + STEP_SETTLE_FRAMES - at) });

/**
 * When each of `count` ordered items starts to appear. With steps, step k reveals every item up to
 * index `lasts[k]` from its segment's start, at most `stagger` frames apart and all drawn, `itemFrames`
 * after their start, when the step settles; the last step also brings any items after it. Without steps
 * the items arrive one after another from `from` to `to`, inside the scene's build.
 */
export function revealStarts(
  segments: readonly SpokenSegment[],
  count: number,
  lasts: readonly number[],
  from: number,
  to: number,
  stagger: number,
  itemFrames = 0,
): number[] {
  if (segments.length > 1 && lasts.length) {
    const starts: number[] = [];
    lasts.forEach((last, k) => {
      const at = segments[k + 1]!.from;
      const end = k === lasts.length - 1 ? count - 1 : last;
      const shown = end + 1 - starts.length;
      const gap = Math.min(stagger, Math.max(0, STEP_SETTLE_FRAMES - itemFrames) / Math.max(1, shown - 1));
      for (let j = 0; starts.length <= end; j++) starts.push(at + j * gap);
    });
    return starts;
  }
  const gap = count > 1 ? (to - from) / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => from + i * gap);
}
