import type { Tone } from '../types';
import { colors } from './theme';

export const tones: Record<Tone, { color: string; bg: string }> = {
  neutral: { color: '#8f98ad', bg: 'rgba(144, 151, 168, 0.14)' },
  accent: { color: colors.accent, bg: colors.accentSoft },
  good: { color: colors.add, bg: colors.addBg },
  bad: { color: colors.del, bg: colors.delBg },
  warn: { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.13)' },
};

const CYCLE: Tone[] = ['accent', 'good', 'warn', 'bad', 'neutral'];

/** A series' own tone, or the default: accent alone, neutral then accent as before and after, else a cycle. */
export function seriesTone(series: readonly { tone?: Tone }[], index: number): Tone {
  const own = series[index]!.tone;
  if (own) return own;
  if (series.length === 2) return index === 0 ? 'neutral' : 'accent';
  return CYCLE[index % CYCLE.length]!;
}
