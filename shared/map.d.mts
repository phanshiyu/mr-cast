import type { MapScene, MapView, Tone } from '../src/types';

export type LngLat = [lng: number, lat: number];
export interface Camera {
  k: number;
  x: number;
  y: number;
}
export interface Stage {
  width: number;
  height: number;
}
/** A d3-geo projection, used only through this module. */
export interface GeoProjection {
  (point: LngLat): [number, number] | null;
}
export interface MapProjection {
  projection: GeoProjection;
  meridian: number;
  world: object;
  worldBox: { x0: number; y0: number; x1: number; y1: number };
}
export interface Country {
  code: string;
  names: string[];
  label: LngLat;
  geometry: { type: 'MultiPolygon'; coordinates: LngLat[][][] };
}
interface ItemBase {
  id: string;
  label: string;
  tone?: Tone;
}
export type MapItem =
  | (ItemBase & { kind: 'place'; point: LngLat; geometry: object; dot: boolean; side: 'right' | 'left' | 'above' | 'below' | null })
  | (ItemBase & { kind: 'route' | 'line'; path: LngLat[]; geometry: object })
  | (ItemBase & { kind: 'region'; geometry: object; countries: string[] | null; center: LngLat });

export declare const PROJECTIONS: Record<string, unknown>;
export declare const DEFAULT_PROJECTION: string;
export declare const MAP_SIDES: readonly string[];
export declare const MIN_SPAN: number;
export declare const LABEL_FONT: { family: 'sans'; weight: number; size: number };
export declare const DOT_RADIUS: number;
export declare const LABEL_GAP: number;
export declare const WORLD_SOURCE: string;
export declare function isLatLng(v: unknown): v is [number, number];
export declare function countriesAt(detail: '110m' | '50m'): Map<string, Country>;
export declare function countryCode(ref: unknown): string | null;
export declare function countryNames(): string[];
export declare function countryName(code: string): string;
export declare function itemKey(field: 'places' | 'routes' | 'lines' | 'regions', id: string): string;
export declare function mapRef(scene: MapScene, ref: unknown): string[] | null;
export declare function mapRefNames(scene: MapScene): string[];
export declare function mapItems(scene: MapScene): Map<string, MapItem>;
export declare function keyGeometry(scene: MapScene, key: string): object | null;
export declare function viewBounds(scene: MapScene, view: MapView | undefined): [LngLat, LngLat] | null;
export declare function viewSpan(scene: MapScene, view: MapView | undefined): [number, number] | null;
export declare function mapViews(scene: MapScene): MapView[];
export declare function mapProjection(scene: MapScene, stage: Stage): MapProjection;
export declare function cameraOf(scene: MapScene, view: MapView | undefined, stage: Stage, proj: MapProjection): Camera;
export declare function zoomBetween(a: Camera, b: Camera, t: number, stage: Stage): Camera;
export declare function onScreen(proj: MapProjection, camera: Camera, point: LngLat): [number, number] | null;
export declare function partialPath(path: LngLat[], t: number): LngLat[];
export declare function mapDetail(scene: MapScene, cameras: Camera[]): '110m' | '50m';
export declare function mapLayout(scene: MapScene, stage: Stage): { proj: MapProjection; cameras: Camera[]; detail: '110m' | '50m' };
export declare function labelBox(at: [number, number], width: number, side: string | null, gap: number): { x: number; y: number; width: number; height: number };
export declare function pathAnchor(proj: MapProjection, camera: Camera, path: LngLat[], stage: Stage): [number, number] | null;
/** An SVG path of a geometry through the projection at zoom 1, or "" when none of it shows. */
export declare function geoPathOf(proj: MapProjection, geometry: object): string;
/** The box of a geometry through the projection at zoom 1. */
export declare function geoBoxOf(proj: MapProjection, geometry: object): { x0: number; y0: number; x1: number; y1: number } | null;
export declare function tracedKeys(scene: MapScene): string[];
export interface MapLabel {
  key: string;
  kind: MapItem['kind'];
  text: string;
  anchor: [number, number];
  dot: { x: number; y: number; width: number; height: number } | null;
  box: { x: number; y: number; width: number; height: number } | null;
}
export declare function mapLabels(scene: MapScene, proj: MapProjection, camera: Camera, stage: Stage, state: { hidden: Record<string, true>; values: Record<string, unknown> }): MapLabel[];
export declare function mapBoxes(scene: MapScene, proj: MapProjection, camera: Camera, stage: Stage, state: { hidden: Record<string, true>; values: Record<string, unknown> }, keys?: readonly string[]): Map<string, { x: number; y: number; width: number; height: number }>;
/** The codes of the countries a scene names anywhere: in a tint, a focus, a view, a place's `at` or a region. */
export declare function namedCountries(scene: MapScene): string[];
