import type { StateScene } from '../types';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { defaultChapter } from './theme';

export const StateDiagram: React.FC<SceneProps<StateScene>> = ({ scene, durationInFrames }) => (
  <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.state}>
    {null}
  </SceneShell>
);
