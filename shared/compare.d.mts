import type { CompareRow, CompareScene } from '../src/types';

/** A compare scene's two side titles, "Before" and "After" unless it names its own. */
export declare function compareTitles(scene: Pick<CompareScene, 'sides'>): [string, string];
/** Whether a row reads the same on both sides: its own `same`, or else whether its two cells are equal. */
export declare function compareRowSame(row: CompareRow): boolean;
