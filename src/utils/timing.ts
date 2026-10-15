import type { Scene, Storyboard, VoiceClip, Voiceover } from '../types';
import { FPS, sceneDurationInFrames as framesForNarration } from '../../shared/timing.mjs';
import { clipFor } from '../../shared/voice.mjs';

export { FPS, VOICE_LEAD_FRAMES, spokenWordIndex, wordCount } from '../../shared/timing.mjs';
export const WIDTH = 1920;
export const HEIGHT = 1080;

export function sceneDurationInFrames(scene: Scene, voiceover?: Voiceover | null): number {
  return framesForNarration(scene.narration, voiceover);
}

export interface TimedScene {
  scene: Scene;
  index: number;
  from: number;
  durationInFrames: number;
  /** The scene's voice-over, when voiceover.json has one for its narration. */
  clip: VoiceClip | undefined;
}

export function timeline(storyboard: Storyboard, voiceover?: Voiceover | null): TimedScene[] {
  let from = 0;
  return storyboard.scenes.map((scene, index) => {
    const durationInFrames = sceneDurationInFrames(scene, voiceover);
    const timed = { scene, index, from, durationInFrames, clip: clipFor(voiceover, scene.narration) };
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
