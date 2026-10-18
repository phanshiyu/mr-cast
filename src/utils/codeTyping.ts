import type { Slot } from './codeLayout';
import type { SpokenSegment } from './timing';

/** Characters a frame a step types at most and at least, so a long step does not crawl and a short one is not a blur. */
const FASTEST = 3;
const SLOWEST = 0.6;
/** Share of a step's words over which its lines are typed: the typing ends a little before the voice does. */
const TYPED_BY = 0.8;

export interface TypingSchedule {
  /** By slot: the frame its first character appears, and how many characters it types, or null for a line already there. */
  lines: ({ from: number; chars: number; perFrame: number } | null)[];
  /** By step: the frame its typing ends. */
  ends: number[];
}

/**
 * When each step types its lines: from just after it starts, spread over most of its words, at a rate between
 * SLOWEST and FASTEST, and done before the next step starts.
 */
export function typingSchedule(
  texts: readonly string[],
  slots: readonly Slot[],
  stepCount: number,
  segments: readonly SpokenSegment[],
  durationInFrames: number,
): TypingSchedule {
  const lines: TypingSchedule['lines'] = slots.map(() => null);
  const ends: number[] = [];
  for (let k = 0; k < stepCount; k++) {
    const segment = segments[k + 1];
    const own = slots.flatMap((slot, r) => (slot.step === k ? [r] : []));
    if (!segment || !own.length) {
      ends.push(segment?.from ?? 0);
      continue;
    }
    const start = segment.from + 4;
    const next = segments[k + 2]?.from ?? durationInFrames;
    const chars = own.reduce((n, r) => n + texts[r]!.trimStart().length, 0);
    const window = Math.max(10, segment.voiceFrom + segment.speakingFrames * TYPED_BY - start);
    const frames = Math.min(Math.max(window, chars / FASTEST), chars / SLOWEST, Math.max(1, next - 6 - start));
    const perFrame = Math.max(chars / Math.max(1, frames), 1e-6);
    let at = start;
    for (const r of own) {
      const n = texts[r]!.trimStart().length;
      lines[r] = { from: at, chars: n, perFrame };
      at += n / perFrame;
    }
    ends.push(at);
  }
  return { lines, ends };
}
