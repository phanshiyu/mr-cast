import type { ReactNode } from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { SCENE_EXIT_FRAMES as EXIT_FRAMES } from '../../shared/timing.mjs';
import { shellFits } from '../fit/shell';
import type { Scene } from '../types';
import { FitText } from './FitText';
import { SAFE, clamp, colors, fonts } from './theme';

const ENTER_FRAMES = 12;

interface SceneShellProps {
  scene: Scene;
  durationInFrames: number;
  /** Rendered at the right end of the header row. */
  aside?: ReactNode;
  children: ReactNode;
}

/** A scene's frame: its chapter label and title, an optional aside, and its content below. */
export const SceneShell: React.FC<SceneShellProps> = ({ scene, durationInFrames, aside, children }) => {
  const frame = useCurrentFrame();
  const exitStart = Math.max(ENTER_FRAMES, durationInFrames - EXIT_FRAMES);
  const opacity = interpolate(frame, [0, ENTER_FRAMES, exitStart, durationInFrames], [0, 1, 1, 0], clamp);
  const y = interpolate(frame, [0, ENTER_FRAMES], [28, 0], clamp) + interpolate(frame, [exitStart, durationInFrames], [0, -16], clamp);
  const { eyebrow, title } = shellFits(scene);

  return (
    <AbsoluteFill
      style={{
        padding: `${SAFE.top}px ${SAFE.right}px ${SAFE.bottom}px ${SAFE.left}px`,
        opacity,
        transform: `translateY(${y}px)`,
        fontFamily: fonts.sans,
        color: colors.text,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, marginBottom: 36, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FitText fit={eyebrow} style={{ color: colors.accent, lineHeight: 'normal' }} />
          {title ? <FitText fit={title} style={{ marginTop: 10, lineHeight: 'normal' }} /> : null}
        </div>
        {aside}
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>{children}</div>
    </AbsoluteFill>
  );
};
