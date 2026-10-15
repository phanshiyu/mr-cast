import type { Scene, Storyboard } from '../types';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

const WORDS_PER_MINUTE = 160;
const BUFFER_SECONDS = 1.5;
const MIN_SECONDS = 3;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function sceneDurationInFrames(scene: Scene): number {
  const seconds = Math.max(MIN_SECONDS, (wordCount(scene.narration ?? '') / WORDS_PER_MINUTE) * 60 + BUFFER_SECONDS);
  return Math.ceil(seconds * FPS);
}

export interface TimedScene {
  scene: Scene;
  index: number;
  from: number;
  durationInFrames: number;
}

export function timeline(storyboard: Storyboard): TimedScene[] {
  let from = 0;
  return storyboard.scenes.map((scene, index) => {
    const durationInFrames = sceneDurationInFrames(scene);
    const timed = { scene, index, from, durationInFrames };
    from += durationInFrames;
    return timed;
  });
}

export function totalDurationInFrames(storyboard: Storyboard): number {
  return Math.max(1, timeline(storyboard).reduce((sum, t) => sum + t.durationInFrames, 0));
}

/**
 * Which word of the narration should be "spoken" at a given frame of the scene.
 * Words are spread evenly over the speaking part (the scene minus the trailing buffer).
 */
export function spokenWordIndex(narration: string, frameInScene: number): number {
  const words = wordCount(narration);
  const speakingFrames = (words / WORDS_PER_MINUTE) * 60 * FPS;
  if (speakingFrames <= 0) return words;
  return Math.min(words, Math.floor((frameInScene / speakingFrames) * words));
}

export function formatTime(frames: number): string {
  const s = Math.floor(frames / FPS);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
