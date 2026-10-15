import type { MermaidScene } from '../types';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { defaultChapter } from './theme';

export const MermaidDiagram: React.FC<SceneProps<MermaidScene>> = ({ scene, durationInFrames }) => (
  <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.mermaid}>
    {null}
  </SceneShell>
);
