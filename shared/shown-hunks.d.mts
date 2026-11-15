import type { Scene } from '../src/types';

/** The hunk ids `scene` shows, in the order it shows them; each may repeat, and may name a hunk that does not exist. */
export declare function shownHunkIds(scene: Scene | undefined): readonly unknown[];
