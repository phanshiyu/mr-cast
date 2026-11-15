import { Composition } from 'remotion';
import { ContactSheet, sheetSize, type ContactSheetProps } from '../components/ContactSheet';
import type { WalkthroughProps } from '../types';
import { FPS, HEIGHT, WIDTH, totalDurationInFrames } from '../utils/timing';
import { Walkthrough } from '../Walkthrough';

const defaultProps: WalkthroughProps = {
  showCaptions: true,
  hunks: {},
  storyboard: {
    title: 'mr-cast preview',
    scenes: [
      {
        type: 'text',
        narration: 'Render props replace these defaults with a real storyboard and hunks.',
        headline: 'Pass storyboard and hunks as input props to render a walkthrough.',
        items: ['storyboard.json drives the scenes', 'hunks.json supplies the code'],
      },
    ],
  },
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Walkthrough"
      component={Walkthrough}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={totalDurationInFrames(defaultProps.storyboard)}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: totalDurationInFrames(props.storyboard, props.voiceover),
      })}
    />
    <Composition
      id="ContactSheet"
      component={ContactSheet}
      fps={FPS}
      width={sheetSize(1).width}
      height={sheetSize(1).height}
      durationInFrames={1}
      defaultProps={{ tiles: [] } satisfies ContactSheetProps}
      calculateMetadata={({ props }) => sheetSize(props.tiles.length)}
    />
  </>
);
