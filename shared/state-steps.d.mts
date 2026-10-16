import type { ArrayStep, MemoryStep, MemoryValue, Scene } from '../src/types';

/** What a scene shows at one step: values by item key, places of pointers and ranges, and hidden items. */
export interface SceneState {
  values: Record<string, MemoryValue>;
  places: Record<string, [number, number]>;
  hidden: Record<string, true>;
}

export interface StateProblem {
  /** The step's index, or -1 for the initial state. */
  step: number;
  field: 'set' | 'move' | 'show' | 'hide' | 'objects';
  ref: string;
  message: string;
  names: string[];
  level: 'error' | 'warning';
}

export declare const STATE_TYPES: readonly Scene['type'][];
export declare function isPointer(value: unknown): value is { ref: string };
export declare function sameValue(a: MemoryValue | undefined, b: MemoryValue | undefined): boolean;
export declare function walkStates(scene: Scene): { states: SceneState[]; problems: StateProblem[] };
export declare function sceneStates(scene: Scene): SceneState[];
export declare function changesState(step: ArrayStep | MemoryStep | undefined): boolean;
export declare function changedRefs(scene: Scene, step: ArrayStep | MemoryStep): string[];
