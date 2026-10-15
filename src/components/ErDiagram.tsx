import type { ErScene } from '../types';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { defaultChapter } from './theme';

export const ErDiagram: React.FC<SceneProps<ErScene>> = ({ scene, durationInFrames }) => (
  <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.er}>
    {null}
  </SceneShell>
);
