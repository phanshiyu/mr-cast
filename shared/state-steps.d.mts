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
  /** svg: each moved element's key and the transform its step's `move` gives it, outside its own. */
  transforms: Record<string, string>;
  /** svg: each morphed path's key and the id of the path whose shape it has. */
  shapes: Record<string, string>;
  /** svg: what this step traces, by key, with its `when` cue (null to start as the step settles). Empty on every other state. */
  traces: Record<string, string | null>;
}

export interface StateProblem {
  /** The step's index, or -1 for the initial state. */
  step: number;
  field: string;
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
export declare const TRACEABLE: readonly string[];
export declare function traceEntry(entry: unknown): { id: unknown; when: unknown };
