import { Composition } from 'remotion';
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
        type: 'intent',
        narration: 'Render props replace these defaults with a real storyboard and hunks.',
        summary: 'Pass storyboard and hunks as input props to render a walkthrough.',
        risk: 'low',
        bullets: ['storyboard.json drives the scenes', 'hunks.json supplies the code'],
      },
    ],
  },
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Walkthrough"
    component={Walkthrough}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    durationInFrames={totalDurationInFrames(defaultProps.storyboard)}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({ durationInFrames: totalDurationInFrames(props.storyboard) })}
  />
);
