import type { HunkMap, Scene } from '../src/types';

/** What a step's camera frames: item keys, the refs as written, and its zoom when the step gives one. */
export interface Shot {
  keys: string[];
  refs: (string | number)[];
  zoom: number | null;
}
/** The point of the content box at the centre of the screen, and how much it is enlarged. */
export interface View {
  x: number;
  y: number;
  zoom: number;
}
export interface CameraProblem {
  step: number;
  field: string;
  message: string;
  suggest?: { name: string; names: string[] };
}
interface Area {
  width: number;
  height: number;
}
interface Rect extends Area {
  x: number;
  y: number;
}
export declare const CAMERA_TYPES: readonly Scene['type'][];
export declare const ZOOM_MAX: number;
export declare const FIT_ZOOM_MAX: number;
export declare function cameraShots(scene: Scene, hunks?: HunkMap): { shots: (Shot | null)[]; problems: CameraProblem[]; moves: boolean };
export declare function wholeView(area: Area): View;
export declare function frameShot(shot: Shot | null, boxOf: (key: string) => Rect | null | undefined, area: Area): View;
export declare function viewRect(view: View, area: Area): Rect;
export declare function tweenView(a: View, b: View, t: number): View;
export declare function viewTransform(view: View, area: Area): string;
