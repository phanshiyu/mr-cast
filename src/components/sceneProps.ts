import type { HunkMap, Scene, Storyboard } from '../types';
import type { SpokenSegment } from '../utils/timing';

/** An explanation walks through unchanged source snippets; a diff walkthrough always has a changed hunk. */
export const isExplanation = (hunks: HunkMap) => Object.values(hunks).every((h) => h.status === 'source');

export interface SceneProps<S extends Scene> {
  scene: S;
  hunks: HunkMap;
  storyboard: Storyboard;
  durationInFrames: number;
  /** What the scene speaks, in order: its narration, then each code step. A code scene highlights step k while segment k + 1 plays. */
  segments: readonly SpokenSegment[];
}
