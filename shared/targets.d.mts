import type { FocusRef, HunkMap, Scene } from '../src/types';

/** Scene types whose steps take `focus`. */
export declare const FOCUS_TYPES: readonly Scene['type'][];
export declare function focusRefs(focus: FocusRef | readonly FocusRef[]): readonly FocusRef[];
/** The item keys a ref lights in a scene, or null when the scene has nothing it names. */
export declare function resolveRef(scene: Scene, ref: unknown, hunks?: HunkMap): string[] | null;
/** Refs worth suggesting for a scene, for "did you mean" hints. */
export declare function refNames(scene: Scene, hunks?: HunkMap): string[];
/** Each step's focus, as the item keys it lights; refs that name nothing light nothing. */
export declare function stepTargets(scene: Scene, hunks?: HunkMap): string[][];
/** For each item key, the steps that light it, in order. */
export declare function targetSteps(scene: Scene, hunks?: HunkMap): Map<string, number[]>;
