import type { SequenceScene } from '../types';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { defaultChapter } from './theme';

export const SequenceDiagram: React.FC<SceneProps<SequenceScene>> = ({ scene, durationInFrames }) => (
  <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.sequence}>
    {null}
  </SceneShell>
);
