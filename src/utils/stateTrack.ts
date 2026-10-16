import { interpolate } from 'remotion';
import { sameValue, type SceneState } from '../../shared/state-steps.mjs';
import { STEP_SETTLE_FRAMES } from '../../shared/timing.mjs';
import { currentStep, stepMove } from './spotlight';
import type { SpokenSegment } from './timing';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
/** Frames a changed item stays lit once it has settled, fading out as the step's words go on. */
const LIT_FRAMES = 40;

/**
 * Where a state scene is at a frame: the state of the current step and the one before its changes, how far
 * the changes have gone (`t`, 1 once settled, which is STEP_SETTLE_FRAMES after the step starts, before the
 * pen and the words), and the glow on what the step changed, brightest as it settles.
 */
export interface StateFrame {
  before: SceneState;
  now: SceneState;
  t: number;
  lit: number;
}

export function stateFrame(states: readonly SceneState[], segments: readonly SpokenSegment[], frame: number): StateFrame {
  const k = currentStep(segments, frame);
  if (k < 0 || !states[k + 1]) return { before: states[0]!, now: states[0]!, t: 1, lit: 0 };
  const from = segments[k + 1]!.from;
  const settled = from + STEP_SETTLE_FRAMES;
  return { before: states[k]!, now: states[k + 1]!, t: stepMove(frame, from), lit: interpolate(frame, [from, settled, settled + LIT_FRAMES], [0, 1, 0], clamp) };
}

/** Whether the current step changed the value under `key`. */
export const valueChanged = (s: StateFrame, key: string) => !sameValue(s.before.values[key], s.now.values[key]);

/** How shown an item is, 0 to 1, fading in or out with the step that shows or hides it. */
export function shownOf(s: StateFrame, key: string): number {
  const [was, is] = [s.before.hidden[key] ? 0 : 1, s.now.hidden[key] ? 0 : 1];
  return was + (is - was) * s.t;
}

/** A place partway from where the step found it to where it puts it. */
export function placeOf(s: StateFrame, key: string): [number, number] {
  const now = s.now.places[key] ?? [0, 0];
  const was = s.before.places[key] ?? now;
  return [was[0] + (now[0] - was[0]) * s.t, was[1] + (now[1] - was[1]) * s.t];
}
