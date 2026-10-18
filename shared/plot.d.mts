import type { PlotScene, Tone } from '../src/types';
import type { SceneState } from './state-steps.mjs';
import type { Font } from './textfit.mjs';

export type PartKind = 'functions' | 'series' | 'points' | 'vectors' | 'areas';
export interface PlotPart {
  kind: PartKind;
  index: number;
  id: string;
  item: Record<string, unknown>;
  path: string;
}
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Px = [number, number];

export declare const PART_KINDS: Record<PartKind, string>;
export declare const TRACEABLE: readonly PartKind[];
export declare const LINE_TONES: readonly Tone[];
export declare const TICK_FONT: Font;
export declare const AXIS_FONT: Font;
export declare const LABEL_FONT: Font;
export declare const POINT_R: number;
export declare const TICK_LEN: number;

export declare function plotParts(scene: PlotScene): PlotPart[];
export declare function partOf(scene: PlotScene, id: unknown): PlotPart | undefined;
export declare function paramNames(scene: PlotScene): string[];
export declare function labelText(label: string, scope: Record<string, number>): string;
export declare function formatNumber(v: number, digits?: number | null): string;
export declare function stateParams(scene: PlotScene, state: SceneState | undefined): Record<string, number>;
export declare function partTone(scene: PlotScene, part: PlotPart): Tone;

export interface PlotTick {
  value: number;
  text: string;
  at: number;
  box: Box;
}
export interface PlotAxes {
  box: { width: number; height: number };
  plot: Box;
  sx: (v: number) => number;
  sy: (v: number) => number;
  xAxisY: number;
  yAxisX: number | null;
  ticks: { x: PlotTick[]; y: PlotTick[] };
  labels: { x: { text: string; box: Box } | null; y: { text: string; box: Box } | null };
  numberLine: boolean;
}
export declare function plotAxes(scene: PlotScene, box: { width: number; height: number }): PlotAxes;

export interface PartGeometry {
  part: PlotPart;
  visible: boolean;
  box: Box | null;
  runs?: Px[][];
  undefinedAt?: number | null;
  end?: Px | null;
  dots?: Px[];
  dot?: Px;
  data?: unknown;
  arrow?: [Px, Px] | null;
  polygon?: Px[] | null;
  centre?: Px | null;
  along?: Px[];
}
/** The part of the content box a camera shows, and its zoom. */
export interface PlotView {
  rect: Box;
  zoom: number;
}
export declare function plotGeometry(
  scene: PlotScene,
  axes: PlotAxes,
  scope: Record<string, number>,
  progress?: (id: string) => number,
  view?: PlotView | null,
): Map<string, PartGeometry>;

export interface PlacedLabel {
  id: string;
  text: string;
  box: Box;
  tone: Tone;
  clash: string | null;
  off: boolean;
}
export declare function plotLabels(
  scene: PlotScene,
  axes: PlotAxes,
  geometry: Map<string, PartGeometry>,
  scope: Record<string, number>,
  shown?: (id: string) => boolean,
): PlacedLabel[];
