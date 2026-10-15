import type { Scene, Storyboard, Voiceover } from '../types';
import { FPS, sceneDurationInFrames, sceneSegments, type SpokenSegment } from '../../shared/timing.mjs';

export { FPS, VOICE_LEAD_FRAMES, sceneDurationInFrames, spokenAt, wordCount } from '../../shared/timing.mjs';
export type { SpokenSegment } from '../../shared/timing.mjs';
export const WIDTH = 1920;
export const HEIGHT = 1080;

export interface TimedScene {
  scene: Scene;
  index: number;
  from: number;
  durationInFrames: number;
  /** What the scene speaks, in order, each timed from the scene's start. */
  segments: SpokenSegment[];
}

export function timeline(storyboard: Storyboard, voiceover?: Voiceover | null): TimedScene[] {
  let from = 0;
  return storyboard.scenes.map((scene, index) => {
    const segments = sceneSegments(scene, voiceover);
    const durationInFrames = sceneDurationInFrames(scene, voiceover);
    const timed = { scene, index, from, durationInFrames, segments };
    from += durationInFrames;
    return timed;
  });
}

export function totalDurationInFrames(storyboard: Storyboard, voiceover?: Voiceover | null): number {
  return Math.max(1, timeline(storyboard, voiceover).reduce((sum, t) => sum + t.durationInFrames, 0));
}

export function formatTime(frames: number): string {
  const s = Math.floor(frames / FPS);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
