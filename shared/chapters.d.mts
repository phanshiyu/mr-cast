import type { Scene } from '../src/types';

export declare const DEFAULT_CHAPTERS: Record<Scene['type'], string>;
/** The scene's own chapter, else a label for its type ("Flowchart" for a graph with a decision). */
export declare function sceneChapter(scene: Scene): string;
