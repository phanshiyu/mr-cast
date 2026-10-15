import type { Change, FilesScene, HunkMap, Tone } from '../src/types';

export interface ShownFile {
  path: string;
  change: Change | undefined;
  additions: number | undefined;
  deletions: number | undefined;
  test: boolean;
  badge?: string;
  tone?: Tone;
}

export declare function diffFiles(hunks: HunkMap): Required<Omit<ShownFile, 'test' | 'badge' | 'tone'>>[];
export declare function sceneFiles(scene: FilesScene, hunks: HunkMap): ShownFile[];
