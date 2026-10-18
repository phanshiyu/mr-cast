import type { HunkMap, Scene, Storyboard } from '../src/types';

export declare const NODE_KINDS: readonly string[];
/** The key each scene type's steps used before `focus`. */
export declare function legacyFocusKeys(type: Scene['type']): readonly string[];
/** An explanation walks through unchanged source snippets; a diff walkthrough always has a changed hunk. */
export declare function isExplanation(hunks: HunkMap): boolean;
/** A scene's steps with each older focus key renamed to `focus`. */
export declare function focusSteps(scene: Scene): readonly unknown[] | undefined;
/** The storyboard with renamed scene types, such as `arch`, replaced by their current names, and older tests scenes read as a matrix. */
export declare function upgradeScenes<T>(storyboard: T): T;
/** Expects a storyboard that passed `validate`; returns it with every older field name replaced. */
export declare function normalizeStoryboard(storyboard: unknown, hunks: HunkMap): Storyboard;
