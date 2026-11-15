// Remotion's player, for MR_CAST_RENDERER=remotion until every scene type is drawn by the engine. Loaded only then.

import { Player, type PlayerRef } from '@remotion/player';
import type { Ref } from 'react';
import { FPS, HEIGHT, WIDTH } from '../utils/timing';
import { Walkthrough } from '../Walkthrough';
import type { PlayerHandle, VideoPlayerProps } from './types';

const RemotionPlayer: React.FC<VideoPlayerProps & { ref?: Ref<PlayerHandle> }> = ({
  walkthrough,
  durationInFrames,
  autoPlay,
  initiallyMuted,
  poster,
  playbackRate,
  ref,
}) => (
  <Player
    ref={ref as Ref<PlayerRef>}
    component={Walkthrough}
    inputProps={walkthrough}
    durationInFrames={durationInFrames}
    compositionWidth={WIDTH}
    compositionHeight={HEIGHT}
    fps={FPS}
    controls
    showVolumeControls
    autoPlay={autoPlay}
    initiallyMuted={initiallyMuted}
    renderPoster={poster}
    showPosterWhenUnplayed
    posterFillMode="player-size"
    spaceKeyToPlayOrPause={false}
    playbackRate={playbackRate}
    acknowledgeRemotionLicense
    style={{ width: '100%', aspectRatio: '16 / 9' }}
  />
);

export default RemotionPlayer;
