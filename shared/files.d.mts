import type { Change, FilesScene, HunkMap } from '../src/types';

export interface ShownFile {
  path: string;
  change: Change | undefined;
  additions: number | undefined;
  deletions: number | undefined;
  test: boolean;
}

export declare function diffFiles(hunks: HunkMap): Required<Omit<ShownFile, 'test'>>[];
export declare function sceneFiles(scene: FilesScene, hunks: HunkMap): ShownFile[];
