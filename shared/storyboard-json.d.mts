import type { MemoryMembers, MemoryValue, Tint, Tints } from '../src/types';

/** storyboard.json's text as a storyboard, with memory vars and fields as pairs in the order written. Throws as JSON.parse does. */
export declare function parseStoryboard(text: string): unknown;
/** A memory frame's vars or an object's fields as [name, value] pairs, in order, from pairs or an object. */
export declare function memoryMembers(members: MemoryMembers | undefined): [name: string, value: MemoryValue][];
/** A tint as [ref, tint] pairs, in the order written, from pairs or an object. */
export declare function tintEntries(tints: Tints | undefined): [ref: string, tint: Tint][];
