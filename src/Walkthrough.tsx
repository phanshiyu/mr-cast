import type { ReactNode } from 'react';
import { AbsoluteFill, Html5Audio, Sequence } from 'remotion';
import { ArchGraph } from './components/ArchGraph';
import { Captions } from './components/Captions';
import { Chart } from './components/Chart';
import { CodeDiff } from './components/CodeDiff';
import { DataFlow } from './components/DataFlow';
import { DataTable } from './components/DataTable';
import { ErDiagram } from './components/ErDiagram';
import { IntentCard } from './components/IntentCard';
import { MermaidDiagram } from './components/MermaidDiagram';
import type { SceneProps } from './components/sceneProps';
import { SequenceDiagram } from './components/SequenceDiagram';
import { StateDiagram } from './components/StateDiagram';
import { TestMatrix } from './components/TestMatrix';
import { Timeline } from './components/Timeline';
import { colors, fonts } from './components/theme';
import type { ArchScene, ChartScene, CodeScene, ErScene, FlowScene, IntentScene, MermaidScene, SequenceScene, StateScene, TableScene, TestsScene, TimelineScene, WalkthroughProps } from './types';
import { timeline } from './utils/timing';

interface SceneByType {
  intent: IntentScene;
  arch: ArchScene;
  code: CodeScene;
  flow: FlowScene;
  sequence: SequenceScene;
  er: ErScene;
  state: StateScene;
  mermaid: MermaidScene;
  tests: TestsScene;
  table: TableScene;
  chart: ChartScene;
  timeline: TimelineScene;
}

const registry: { [K in keyof SceneByType]: React.FC<SceneProps<SceneByType[K]>> } = {
  intent: IntentCard,
  arch: ArchGraph,
  code: CodeDiff,
  flow: DataFlow,
  sequence: SequenceDiagram,
  er: ErDiagram,
  state: StateDiagram,
  mermaid: MermaidDiagram,
  tests: TestMatrix,
  table: DataTable,
  chart: Chart,
  timeline: Timeline,
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

export const Walkthrough: React.FC<WalkthroughProps> = ({ storyboard, hunks, showCaptions, voiceover, audioBaseUrl }) => (
  <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily: fonts.sans }}>
    <Backdrop />
    {timeline(storyboard, voiceover).map(({ scene, index, from, durationInFrames, segments }) => (
      <Sequence key={index} from={from} durationInFrames={durationInFrames} name={`${index + 1}. ${scene.chapter ?? scene.type}`}>
        {renderScene(scene.type, { scene, hunks, storyboard, durationInFrames, segments })}
        {audioBaseUrl === undefined
          ? null
          : segments.map((segment, k) =>
              segment.clip ? (
                <Sequence key={k} from={segment.from} layout="none" name={`voice-over ${k + 1}`}>
                  <Html5Audio src={audioBaseUrl + segment.clip.src} />
                </Sequence>
              ) : null,
            )}
        {showCaptions ? <Captions segments={segments} durationInFrames={durationInFrames} /> : null}
      </Sequence>
    ))}
  </AbsoluteFill>
);
