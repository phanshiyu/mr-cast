import type { ReactNode } from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { ArchGraph } from './components/ArchGraph';
import { Captions } from './components/Captions';
import { CodeDiff } from './components/CodeDiff';
import { DataFlow } from './components/DataFlow';
import { IntentCard } from './components/IntentCard';
import type { SceneProps } from './components/sceneProps';
import { colors, fonts } from './components/theme';
import type { ArchScene, CodeScene, FlowScene, IntentScene, WalkthroughProps } from './types';
import { timeline } from './utils/timing';

interface SceneByType {
  intent: IntentScene;
  arch: ArchScene;
  code: CodeScene;
  flow: FlowScene;
}

const registry: { [K in keyof SceneByType]: React.FC<SceneProps<SceneByType[K]>> } = {
  intent: IntentCard,
  arch: ArchGraph,
  code: CodeDiff,
  flow: DataFlow,
};

function renderScene<K extends keyof SceneByType>(type: K, props: SceneProps<SceneByType[K]>): ReactNode {
  const Component: React.FC<SceneProps<SceneByType[K]>> = registry[type];
  return <Component {...props} />;
}

const Backdrop: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1200px 700px at 12% -10%, rgba(124,140,255,0.16), transparent 60%),
        radial-gradient(900px 600px at 100% 110%, rgba(61,220,151,0.06), transparent 60%),
        linear-gradient(160deg, #0d1018 0%, ${colors.bg} 55%, #05060a 100%)`,
    }}
  />
);

export const Walkthrough: React.FC<WalkthroughProps> = ({ storyboard, hunks, showCaptions }) => (
  <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily: fonts.sans }}>
    <Backdrop />
    {timeline(storyboard).map(({ scene, index, from, durationInFrames }) => (
      <Sequence key={index} from={from} durationInFrames={durationInFrames} name={`${index + 1}. ${scene.chapter ?? scene.type}`}>
        {renderScene(scene.type, { scene, hunks, storyboard, durationInFrames })}
        {showCaptions ? <Captions narration={scene.narration} durationInFrames={durationInFrames} /> : null}
      </Sequence>
    ))}
  </AbsoluteFill>
);
