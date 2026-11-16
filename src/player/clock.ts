// The player's timing: where each voice clip plays on the video's frame clock, and how sharp to draw.

import { FPS, WIDTH, type TimedScene } from '../utils/timing';

/** A voice clip on the video's timeline: it starts at frame `from` and is cut at frame `to`, as Walkthrough.tsx plays it. */
export interface VoiceClip {
  src: string;
  from: number;
  to: number;
  seconds: number;
}

export function voiceClips(scenes: readonly TimedScene[]): VoiceClip[] {
  return scenes.flatMap((t) =>
    t.segments.flatMap((s) =>
      s.clip?.src
        ? [
            {
              src: s.clip.src,
              from: t.from + s.voiceFrom,
              to: t.from + s.from + s.durationInFrames,
              seconds: s.clip.seconds,
            },
          ]
        : [],
    ),
  );
}

/** How far into `clip` frame `frame` is, in seconds, or null when the clip is silent then. */
export function clipTime(clip: VoiceClip, frame: number): number | null {
  if (frame < clip.from || frame >= clip.to) return null;
  const t = (frame - clip.from) / FPS;
  return t < clip.seconds ? t : null;
}

/** The scale that fills `cssWidth` CSS pixels at `dpr` device pixels each, up to the video's own 1920. */
export function fullScale(cssWidth: number, dpr: number): number {
  return Math.max(0.1, Math.min(1, (cssWidth * dpr) / WIDTH));
}

/** Fractions of the full scale to step down to while playing when frames draw too slowly. */
const PLAYING_SCALES = [1, 0.75, 0.5];

/** Below half its size, small text loses strokes. */
const MIN_SCALE = 0.5;

/** A frame's draw budget at 30 fps, leaving the browser time for the rest of the page. */
const BUDGET_MS = 24;

/** How many steps below the full scale to draw while playing, from the level now and the recent frames' draw time. */
export function nextLevel(level: number, averageMs: number): number {
  if (averageMs > BUDGET_MS) return Math.min(PLAYING_SCALES.length - 1, level + 1);
  if (averageMs < BUDGET_MS / 2.5) return Math.max(0, level - 1);
  return level;
}

/** The scale to draw at while playing, `level` steps below `full`. */
export const playingScale = (full: number, level: number) =>
  Math.max(Math.min(full, MIN_SCALE), full * (PLAYING_SCALES[level] ?? 1));
