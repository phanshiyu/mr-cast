import type { ArrayPointer, ArrayRange, ArrayScene, StateValue } from '../src/types';

export interface ArrayRowOf {
  name: string;
  label: string | undefined;
  values: StateValue[];
  splits: number[];
  hidden: boolean;
}

/** The scene's arrays in order; the one array of `values` is named "". */
export declare function arrayRows(scene: ArrayScene): ArrayRowOf[];
/** The item key of cell `i` of the array named `name`. */
export declare function cellKey(name: string, i: number): string;
/** The item key of a whole named array. */
export declare function rowKey(name: string): string;
/** A cell key's array name and index. */
export declare function splitCellKey(key: string): { name: string; index: number };
/** The array a pointer or range sits on. */
export declare function markerRow(scene: ArrayScene, marker: ArrayPointer | ArrayRange): string;
/** How a cell reads in words: "cell 3", or "left[3]". */
export declare function cellName(name: string, i: number): string;
