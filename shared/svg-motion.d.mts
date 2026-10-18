export interface TransformFn {
  fn: 'translate' | 'rotate' | 'scale';
  args: number[];
}
export interface CubicOutline {
  start: [number, number];
  curves: number[][];
  closed: boolean;
}
export interface PairedShape {
  from: CubicOutline[];
  to: CubicOutline[];
}
export declare function parseTransform(text: string | undefined): TransformFn[] | null;
export declare function tweenTransform(from: string | undefined, to: string | undefined, t: number): string;
export declare function pairShapes(fromD: string | undefined, toD: string | undefined): PairedShape;
export declare function tweenShape(paired: PairedShape, t: number): string;
export declare function pathLength(d: string | undefined): number;
export declare function stateMotion(
  ids: Map<string, import('./svg.mjs').SvgNode>,
  state: { transforms?: Record<string, string>; shapes?: Record<string, string> },
): { transforms: Record<string, string>; shapes: Record<string, string> };
export declare function traceLength(node: import('./svg.mjs').SvgNode | undefined, d?: string): number;
