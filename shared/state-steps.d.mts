import type { ArrayStep, GraphStep, MemoryStep, MemoryValue, Scene, TableCell, Tint } from '../src/types';

/**
 * What a scene shows at one step: values by item key, places of pointers and ranges, hidden items, the
 * colour each tinted item keeps, and the callout ("" for none).
 */
export interface SceneState {
  values: Record<string, MemoryValue | TableCell>;
  places: Record<string, [number, number]>;
  hidden: Record<string, true>;
  tints: Record<string, Exclude<Tint, 'clear'>>;
  callout: string;
}

export interface StateProblem {
  /** The step's index, or -1 for the initial state. */
  step: number;
  field: 'set' | 'move' | 'show' | 'hide' | 'trace' | 'objects' | 'tint' | 'callout';
  ref: string | number;
  message: string;
  names: string[];
  level: 'error' | 'warning';
}

export declare const STATE_TYPES: readonly Scene['type'][];
export declare function isPointer(value: unknown): value is { ref: string };
export declare function sameValue(a: MemoryValue | TableCell | undefined, b: MemoryValue | TableCell | undefined): boolean;
export declare const TINTS: readonly Tint[];
export declare function walkStates(scene: Scene): { states: SceneState[]; problems: StateProblem[] };
export declare function sceneStates(scene: Scene): SceneState[];
export declare function changesState(step: ArrayStep | MemoryStep | GraphStep | undefined): boolean;
export declare function changedRefs(scene: Scene, step: ArrayStep | MemoryStep | GraphStep): string[];
