import type { CompareCell, Storyboard } from '../src/types';

export declare function isImageCell(cell: CompareCell | unknown): cell is { image: string; fit?: 'contain' | 'cover' };
export declare function imageSources(storyboard: Storyboard | unknown): { path: string; src: string }[];
