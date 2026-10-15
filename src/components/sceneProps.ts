import type { HunkMap, Scene, Storyboard } from '../types';

/** An explanation walks through unchanged source snippets; a diff walkthrough always has a changed hunk. */
export const isExplanation = (hunks: HunkMap) => Object.values(hunks).every((h) => h.status === 'source');

export interface SceneProps<S extends Scene> {
  scene: S;
  hunks: HunkMap;
  storyboard: Storyboard;
  durationInFrames: number;
}
