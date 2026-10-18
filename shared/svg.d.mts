export type SvgNode = { tag: string; attrs: Record<string, string>; children: SvgNode[] } | { text: string };
export interface SvgBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export declare const SVG_COLORS: Record<string, string>;
export declare const SVG_TONES: readonly string[];
export declare const DEFAULT_FONT: number;
/** A drawing cut down to what draws: the kept root, its viewBox, its elements by id, and what was cut or broken. */
export declare function readSvg(markup: unknown): {
  root: SvgNode | null;
  viewBox: [number, number, number, number] | null;
  ids: Map<string, SvgNode>;
  problems: string[];
};
/** readSvg, once per markup. */
export declare function svgOf(markup: unknown): ReturnType<typeof readSvg>;
export declare function svgIds(markup: unknown): string[];
export declare function textOf(node: SvgNode | null | undefined): string;
export declare function transformOf(text: string | undefined): number[];
/**
 * Every element's box in viewBox units, by id, and every text element with its box, its size in viewBox units, and
 * the ids of it and its groups. `motion` gives moved elements' transforms and morphed paths' `d`, by id.
 */
export declare function svgGeometry(
  root: SvgNode | null,
  motion?: { transforms?: Record<string, string>; shapes?: Record<string, string> },
): {
  boxes: Map<string, SvgBox>;
  texts: { id?: string; text: string; size: number; box: SvgBox; owners: string[] }[];
};
/** Where a viewBox lands in a box: scaled to fit whole and centred. */
export declare function svgStage(viewBox: readonly number[], box: { width: number; height: number }): { scale: number; left: number; top: number };
