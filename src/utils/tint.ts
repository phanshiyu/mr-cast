import type { Tint, Tone } from '../types';
import type { StateFrame } from './stateTrack';

/** How a tinted item looks partway through a step: each tone's share of its fill, and how far it has faded as ruled out. */
export interface TintMix {
  tones: { tone: Tone; amount: number }[];
  dim: number;
}

const toneOf = (t: Exclude<Tint, 'clear'> | undefined): Tone | null => (t && t !== 'dim' ? t : null);

/** The tint under `key`, blending from the one before the step to the one it sets. */
export function tintMix(s: StateFrame, key: string): TintMix {
  const [was, now] = [s.before.tints[key], s.now.tints[key]];
  const dim = (was === 'dim' ? 1 : 0) + ((now === 'dim' ? 1 : 0) - (was === 'dim' ? 1 : 0)) * s.t;
  const [a, b] = [toneOf(was), toneOf(now)];
  if (a === b) return { tones: a ? [{ tone: a, amount: 1 }] : [], dim };
  return { tones: [...(a ? [{ tone: a, amount: 1 - s.t }] : []), ...(b ? [{ tone: b, amount: s.t }] : [])], dim };
}

/** The strongest tone in a mix, for a border or a label, or null. */
export const mainTone = (mix: TintMix): Tone | null => mix.tones.reduce<{ tone: Tone; amount: number } | null>((best, t) => (!best || t.amount > best.amount ? t : best), null)?.tone ?? null;

/** Opacity a dimmed item keeps: ruled out, it recedes but stays readable. */
export const DIM_KEEP = 0.5;
export const dimOpacity = (mix: TintMix) => 1 - (1 - DIM_KEEP) * mix.dim;

/** A tone's fill on a tinted item, stronger than its soft background so the colour reads across the room. */
export const tintFill = (color: string) => `${color}40`;
