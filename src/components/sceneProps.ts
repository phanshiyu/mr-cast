import type { HunkMap, Scene, Storyboard } from '../types';

export interface SceneProps<S extends Scene> {
  scene: S;
  hunks: HunkMap;
  storyboard: Storyboard;
  durationInFrames: number;
}
