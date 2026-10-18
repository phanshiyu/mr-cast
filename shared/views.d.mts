import type { Scene, ViewKey } from '../src/types';

export interface View {
  /** What the viewer sees on the plan page: the question the view answers. */
  label: string;
  /** The scene types that draw it. */
  scenes: Scene['type'][];
}

export declare const VIEWS: Record<ViewKey, View>;
export declare function isView(key: unknown): key is ViewKey;
