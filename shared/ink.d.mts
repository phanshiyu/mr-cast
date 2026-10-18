import type { HunkMap, InkItem, Scene } from '../src/types';

/** What an ink item draws: the one verb key it has. */
export type InkVerb = 'circle' | 'box' | 'underline' | 'strike' | 'cross' | 'tick' | 'brace' | 'arrow' | 'write';

/** What an ink item points at: scene item keys, an item already on the board, or a point as fractions of the stage. */
export type InkTarget = { keys: string[] } | { ink: string } | { point: [x: number, y: number] };

export interface BoardItem {
  /** The step that draws it. */
  step: number;
  /** Its index in that step's `draw`. */
  index: number;
  item: InkItem;
  verb: InkVerb;
  /** The verb's refs in order; an arrow's are [from, to], a write's its `near`, if any. */
  targets: InkTarget[];
  /** The step whose `erase` takes it off the board, or Infinity. */
  until: number;
  id?: string;
}

export interface InkProblem {
  step: number;
  /** Index into the step's `draw`, or null for the step's `draw` or `erase` as a whole. */
  index: number | null;
  /** The field, such as "circle" or "arrow[0]"; "" for the item itself. */
  field: string;
  message: string;
  /** For a ref, id or field that names nothing: what it named, and the names close to it are suggested from. */
  suggest?: { name: string; names: string[] };
}

export declare const INK_SHAPES: readonly InkVerb[];
export declare const INK_VERBS: readonly InkVerb[];
export declare const INK_SIDES: readonly NonNullable<InkItem['side']>[];
export declare const INK_TYPES: readonly Scene['type'][];
export declare function inkVerbs(item: unknown): InkVerb[];
export declare function inkBoard(scene: Scene, hunks?: HunkMap): { items: BoardItem[]; problems: InkProblem[] };
/** The item keys a ref names on a step, as ink and the camera resolve it; on code, a count when text occurs more than once. */
export declare function stepRefKeys(scene: Scene, hunks: HunkMap | undefined, step: unknown, ref: unknown): string[] | number | null;
