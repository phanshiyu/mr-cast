import type { HunkMap, Scene } from '../src/types';

export interface LayerVisit {
  stop: number;
  /** "l:id" for a layer, "i:id" for an item. */
  key: string;
  leg: 'down' | 'up';
}

export declare function stopKey(scene: Scene, ref: unknown): string | null;
export declare function layerOf(scene: Scene, key: string): number;
export declare function layerRoute(scene: Scene): { visits: LayerVisit[]; turn: number; skipped: string[] };
export declare function tokenSteps(scene: Scene, hunks?: HunkMap): { positions: number[]; stuck: number[] };
