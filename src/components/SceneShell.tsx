import type { ReactNode } from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { SAFE, clamp, colors, ellipsis, fonts } from './theme';

export const ENTER_FRAMES = 12;
const EXIT_FRAMES = 8;

interface SceneShellProps {
  durationInFrames: number;
  eyebrow: string;
  title?: string;
  /** Rendered at the right end of the header row. */
  aside?: ReactNode;
  children: ReactNode;
}

export const SceneShell: React.FC<SceneShellProps> = ({ durationInFrames, eyebrow, title, aside, children }) => {
  const frame = useCurrentFrame();
  const exitStart = Math.max(ENTER_FRAMES, durationInFrames - EXIT_FRAMES);
  const opacity = interpolate(frame, [0, ENTER_FRAMES, exitStart, durationInFrames], [0, 1, 1, 0], clamp);
  const y = interpolate(frame, [0, ENTER_FRAMES], [28, 0], clamp) + interpolate(frame, [exitStart, durationInFrames], [0, -16], clamp);

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
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', color: colors.accent, ...ellipsis }}>
            {eyebrow}
          </div>
          {title ? (
            <div style={{ fontSize: 50, fontWeight: 700, letterSpacing: -1, marginTop: 10, ...ellipsis }}>{title}</div>
          ) : null}
        </div>
        {aside}
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>{children}</div>
    </AbsoluteFill>
  );
};
