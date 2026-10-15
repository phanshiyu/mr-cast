import { Easing, interpolate, spring } from 'remotion';
import type { SequenceLayout } from './sequenceLayout';
import type { SpokenSegment } from './timing';

/** Room kept between the lit messages and the edges of the view when they are brought into it. */
const MARGIN = 24;

export interface SequenceCamera {
  /** Height of the frame in layout units; a sequence taller than this scrolls. */
  viewH: number;
  scrolls: boolean;
  /** Where the camera settles for each step, in layout units from the top; the intro is at 0. */
  stops: number[];
  /** How far the messages are scrolled at a frame. */
  scrollAt: (frame: number) => number;
}

/**
 * The camera over a sequence taller than the frame. The participants stay pinned; the messages scroll
 * under them. With steps, each step brings the messages it lights into view, centred when they fit and
 * with the last of them in view when they do not, and the camera eases there as the step starts. Without
 * steps, it pans from the first message to the last while the narration speaks. A still shows where the
 * last step leaves it, or the end of the sequence.
 */
export function sequenceCamera(layout: SequenceLayout, lit: readonly ReadonlySet<number>[], segments: readonly SpokenSegment[], viewH: number, fps: number): SequenceCamera {
  const maxScroll = Math.max(0, layout.height - viewH);
  if (maxScroll < 0.5) return { viewH, scrolls: false, stops: lit.map(() => 0), scrollAt: () => 0 };
  const band = { top: layout.lifelineTop + MARGIN, height: viewH - layout.lifelineTop - 2 * MARGIN };
  const clampScroll = (v: number) => Math.min(maxScroll, Math.max(0, v));
  const stops: number[] = [];
  lit.forEach((set, k) => {
    const previous = k ? stops[k - 1]! : 0;
    if (!set.size) return stops.push(previous);
    const first = layout.messages[Math.min(...set)]!;
    const last = layout.messages[Math.max(...set)]!;
    const span = last.bottom - first.top;
    stops.push(clampScroll(span <= band.height ? (first.top + last.bottom) / 2 - (band.top + band.height / 2) : last.bottom - (band.top + band.height)));
  });
  const stepped = segments.length > 1 && stops.length > 0;
  const narration = segments[0]!;
  const scrollAt = stepped
    ? (frame: number) => stops.reduce((acc, stop, k) => acc + (stop - (k ? stops[k - 1]! : 0)) * spring({ frame: frame - segments[k + 1]!.from, fps, config: { damping: 200 } }), 0)
    : (frame: number) => interpolate(frame, [narration.voiceFrom, narration.voiceFrom + Math.max(1, narration.speakingFrames)], [0, maxScroll], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  return { viewH, scrolls: true, stops: stepped ? stops : lit.map(() => maxScroll), scrollAt };
}
