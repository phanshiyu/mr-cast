import { interpolate } from 'remotion';
import type { SpokenSegment } from './timing';

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
  if (segments.length > 1) return Array.from({ length: count }, (_, k) => segments[k + 1]?.from ?? segments[segments.length - 1]!.from);
  const narration = segments[0]!;
  const start = Math.max(introEnd, narration.voiceFrom);
  const end = Math.max(start, narration.voiceFrom + narration.speakingFrames);
  return Array.from({ length: count }, (_, k) => start + (k * (end - start)) / count);
}

/** Spotlights items one at a time from `starts`: the current item at full strength, visited ones softer, the rest dimmed. Items outside the steps dim once the first step starts. */
export function spotlight(frame: number, starts: readonly number[]) {
  const count = starts.length;
  const reached = (k: number) => (k < count ? interpolate(frame, [starts[k]!, starts[k]! + STEP_FADE], [0, 1], clamp) : 0);
  const dim = reached(0);
  return {
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

/** The step being shown at `frame`: k from segment k + 1's start, or -1 before the first step. */
export function currentStep(segments: readonly SpokenSegment[], frame: number): number {
  let current = -1;
  for (let k = 1; k < segments.length; k++) if (frame >= segments[k]!.from) current = k - 1;
  return current;
}

/**
 * When each of `count` ordered items starts to appear. With steps, step k reveals every item up to
 * index `lasts[k]` from its segment's start, `stagger` frames apart, and the last step also brings
 * any items after it. Without steps the items arrive one after another from `from` to `to`, inside
 * the scene's build.
 */
export function revealStarts(segments: readonly SpokenSegment[], count: number, lasts: readonly number[], from: number, to: number, stagger: number): number[] {
  if (segments.length > 1 && lasts.length) {
    const starts: number[] = [];
    lasts.forEach((last, k) => {
      const at = segments[k + 1]!.from;
      const end = k === lasts.length - 1 ? count - 1 : last;
      for (let j = 0; starts.length <= end; j++) starts.push(at + j * stagger);
    });
    return starts;
  }
  const gap = count > 1 ? (to - from) / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => from + i * gap);
}
