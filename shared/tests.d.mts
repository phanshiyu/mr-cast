import type { TestEntry, TestSituation, TestStatus, TestsScene } from '../src/types';

export type CellState = 'checked' | 'unchecked' | 'removed' | 'none';

export interface MatrixCell {
  key: string;
  row: number;
  col: number;
  outcome: string;
  /** The promised value, if the situation promises this outcome. */
  value: string | undefined;
  /** Indexes of the tests that check it, removed ones included. */
  tests: number[];
  state: CellState;
  /** NEW or CHANGED on a checked cell; null for none. */
  status: Extract<TestStatus, 'added' | 'modified'> | null;
  /** A removed test checked it. */
  removed: boolean;
  /** What it held before the diff, from its tests' `was`. */
  was: string[];
}

export interface MatrixRow {
  key: string;
  row: number;
  situation: TestSituation;
  /** Drawn as one bar holding `situation.gap`. */
  gap: boolean;
  cells: MatrixCell[];
  /** Indexes of the tests that check a cell of it. */
  tests: number[];
}

export interface TestsMatrix {
  outcomes: string[];
  rows: MatrixRow[];
  counts: { tests: number; added: number; modified: number; removed: number; existing: number; gaps: number; unchecked: number };
}

export declare const situationKey: (id: string) => string;
export declare const cellKey: (row: number, col: number) => string;
export declare const outcomeKey: (col: number) => string;
export declare const testKey: (n: number) => string;
export declare function cellOf(scene: TestsScene, ref: unknown): { row: number; col: number } | null;
export declare function isGapRow(situation: TestSituation | undefined): boolean;
export declare function isLive(test: TestEntry | undefined): boolean;
export declare function testsMatrix(scene: TestsScene): TestsMatrix;
export declare function testKeys(scene: TestsScene, n: number): string[];
export declare function resolveTestsRef(scene: TestsScene, ref: unknown): string[] | null;
export declare function testsRefNames(scene: TestsScene): string[];
export declare function testsCallouts(scene: TestsScene): string[];
export declare function upgradeTests<T>(scene: T): T;
