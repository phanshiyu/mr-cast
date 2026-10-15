import type { Scene } from '../src/types';

export declare const STEPPED_TYPES: readonly Scene['type'][];
/** The steps a scene speaks, in order; empty for a scene without them. */
export declare function sceneSteps(scene: Scene): readonly { say: string }[];
/** An item index or an inclusive "a-b" range of indexes, as [first, last]; null when it is neither. */
export declare function indexRange(ref: unknown): [number, number] | null;
