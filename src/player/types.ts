import type { ReactNode } from 'react';
import type { WalkthroughProps } from '../types';

/** The player events the page listens to; frame events carry the frame. */
export type PlayerEvent = 'frameupdate' | 'seeked' | 'ended' | 'play';
export type PlayerListener = (e: { detail: { frame: number } }) => void;

/** What the page drives the engine's canvas player with. */
export interface PlayerHandle {
  seekTo(frame: number): void;
  toggle(): void;
  pause(): void;
  getCurrentFrame(): number;
  addEventListener(type: PlayerEvent, listener: PlayerListener): void;
  removeEventListener(type: PlayerEvent, listener: PlayerListener): void;
}

export interface VideoPlayerProps {
  walkthrough: WalkthroughProps;
  durationInFrames: number;
  autoPlay: boolean;
  initiallyMuted: boolean;
  /** Shown over the video until it first plays; a click on it plays. */
  poster?: () => ReactNode;
  playbackRate: number;
}
