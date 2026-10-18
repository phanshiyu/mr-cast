import { useEffect, useState, type ReactNode } from 'react';
import { AbsoluteFill, Html5Audio, Sequence, useDelayRender } from 'remotion';
import { loadWorld, needsWorld, worldLoaded } from '../shared/map.mjs';
import { ArrayDiagram } from './components/ArrayDiagram';
import { Captions } from './components/Captions';
import { Chart } from './components/Chart';
import { CodeDiff } from './components/CodeDiff';
import { Compare } from './components/Compare';
import { DataFlow } from './components/DataFlow';
import { DataTable } from './components/DataTable';
import { ErDiagram } from './components/ErDiagram';
import { FileTree } from './components/FileTree';
import { GraphDiagram } from './components/GraphDiagram';
import { ImageFrame } from './components/ImageFrame';
import { ImagesContext } from './components/Picture';
import { TextCard } from './components/TextCard';
import { LayerStack } from './components/LayerStack';
import { MemoryDiagram } from './components/MemoryDiagram';
import { SvgDiagram } from './components/SvgDiagram';
import { PlotDiagram } from './components/PlotDiagram';
import { MapDiagram } from './components/MapDiagram';
import { MermaidDiagram } from './components/MermaidDiagram';
import { ReadingList } from './components/ReadingList';
import { ReviewRecap } from './components/ReviewRecap';
import type { SceneProps } from './components/sceneProps';
import { SequenceDiagram } from './components/SequenceDiagram';
import { StateDiagram } from './components/StateDiagram';
import { Terminal } from './components/Terminal';
import { TestMatrix } from './components/TestMatrix';
import { Timeline } from './components/Timeline';
import { SAFE, colors, fonts } from './components/theme';
import { FitText } from './components/FitText';
import { sourceFit } from './fit/source';
import './fonts';
import type { ImageScene, ArrayScene, ChartScene, CodeScene, CompareScene, ErScene, FilesScene, FlowScene, GraphScene, TextScene, LayersScene, MemoryScene, MermaidScene, ReadingScene, ReviewScene, PlotScene, MapScene, SequenceScene, StateScene, SvgScene, TableScene, TerminalScene, TestsScene, TimelineScene, WalkthroughProps, Scene, HunkMap } from './types';
import { timeline } from './utils/timing';

interface SceneByType {
  text: TextScene;
  graph: GraphScene;
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
  files: FilesScene;
  review: ReviewScene;
  reading: ReadingScene;
  compare: CompareScene;
  terminal: TerminalScene;
  layers: LayersScene;
  array: ArrayScene;
  memory: MemoryScene;
  svg: SvgScene;
  plot: PlotScene;
  map: MapScene;
  image: ImageScene;
}

const registry: { [K in keyof SceneByType]: React.FC<SceneProps<SceneByType[K]>> } = {
  text: TextCard,
  graph: GraphDiagram,
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
  files: FileTree,
  review: ReviewRecap,
  reading: ReadingList,
  compare: Compare,
  terminal: Terminal,
  layers: LayerStack,
  array: ArrayDiagram,
  memory: MemoryDiagram,
  svg: SvgDiagram,
  plot: PlotDiagram,
  map: MapDiagram,
  image: ImageFrame,
};

function renderScene<K extends keyof SceneByType>(type: K, props: SceneProps<SceneByType[K]>): ReactNode {
  const Component: React.FC<SceneProps<SceneByType[K]>> = registry[type];
  return <Component {...props} />;
}

/** A pre-read diagram's quiet "In the code:" line in the top margin, naming the files it explains. */
const SourceLine: React.FC<{ scene: Scene; hunks: HunkMap }> = ({ scene, hunks }) => {
  const fit = sourceFit(scene, hunks);
  if (!fit) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <FitText fit={fit} style={{ position: 'absolute', top: 22, right: SAFE.right, lineHeight: 'normal', color: colors.muted, opacity: 0.85 }} />
    </AbsoluteFill>
  );
};

const Backdrop: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1200px 700px at 12% -10%, rgba(124,140,255,0.16), transparent 60%),
        radial-gradient(900px 600px at 100% 110%, rgba(61,220,151,0.06), transparent 60%),
        linear-gradient(160deg, #0d1018 0%, ${colors.bg} 55%, #05060a 100%)`,
    }}
  />
);

/**
 * Whether the world outline a map scene draws is loaded. The player page loads it before it shows a storyboard with a
 * map; a render loads it here, holding the frame until it is in.
 */
function useWorld(storyboard: WalkthroughProps['storyboard']): boolean {
  const [, rerender] = useState(0);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const ready = !needsWorld(storyboard) || worldLoaded();
  useEffect(() => {
    if (ready) return;
    let live = true;
    const handle = delayRender('Loading the world outline for a map scene');
    loadWorld().then(
      () => {
        if (live) rerender((n) => n + 1);
      },
      (err: unknown) => cancelRender(err),
    );
    // Runs once the scenes have rendered with the outline, or when the walkthrough unmounts first.
    return () => {
      live = false;
      continueRender(handle);
    };
  }, [ready, delayRender, continueRender, cancelRender]);
  return ready;
}

export const Walkthrough: React.FC<WalkthroughProps> = (props) => (useWorld(props.storyboard) ? <Scenes {...props} /> : null);

const Scenes: React.FC<WalkthroughProps> = ({ storyboard, hunks, showCaptions, voiceover, audioBaseUrl, images, imageBaseUrl }) => (
  <ImagesContext.Provider value={{ images: images ?? {}, baseUrl: imageBaseUrl }}>
  <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily: fonts.sans }}>
    <Backdrop />
    {timeline(storyboard, voiceover).map(({ scene, index, from, durationInFrames, segments }) => (
      <Sequence key={index} from={from} durationInFrames={durationInFrames} name={`${index + 1}. ${scene.chapter ?? scene.type}`}>
        {renderScene(scene.type, { scene, hunks, storyboard, durationInFrames, segments })}
        <SourceLine scene={scene} hunks={hunks} />
        {audioBaseUrl === undefined
          ? null
          : segments.map((segment, k) =>
              segment.clip ? (
                // Ends with its segment, so a scene mounts one clip at a time; the Player shares only 5 audio tags.
                <Sequence
                  key={k}
                  from={segment.voiceFrom}
                  durationInFrames={segment.from + segment.durationInFrames - segment.voiceFrom}
                  layout="none"
                  name={`voice-over ${k + 1}`}
                >
                  <Html5Audio src={audioBaseUrl + segment.clip.src} />
                </Sequence>
              ) : null,
            )}
        {showCaptions ? <Captions segments={segments} durationInFrames={durationInFrames} /> : null}
      </Sequence>
    ))}
  </AbsoluteFill>
  </ImagesContext.Provider>
);
