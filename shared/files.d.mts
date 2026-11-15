import type { Change, FilePart, FilesScene, HunkMap, PartWeight, Storyboard, Tone } from '../src/types';

export interface ShownFile {
  path: string;
  change: Change | undefined;
  additions: number | undefined;
  deletions: number | undefined;
  test: boolean;
  badge?: string;
  tone?: Tone;
  part?: string;
}

export declare function diffFiles(hunks: HunkMap): Required<Omit<ShownFile, 'test' | 'badge' | 'tone'>>[];
export declare function sceneFiles(scene: FilesScene, hunks: HunkMap): ShownFile[];

export declare const PART_WEIGHTS: readonly PartWeight[];
export interface ScenePart extends FilePart {
  files: ShownFile[];
  additions: number;
  deletions: number;
}
/** The scene's parts in drawing order, with their files and line totals, or null when it has none. */
export declare function sceneParts(scene: FilesScene, files: readonly ShownFile[]): ScenePart[] | null;
/** A files scene with `"parts": "brief"` read into plain `parts` and `files` from the storyboard's brief. */
export declare function expandBriefParts<S>(scene: S, storyboard: Storyboard | undefined, hunks: HunkMap): S;
