import { useMemo } from 'react';
import { CALLOUT_PAD, calloutFits } from '../fit/callout';
import type { Scene } from '../types';
import type { StateFrame } from '../utils/stateTrack';
import { FitText } from './FitText';
import { colors } from './theme';

/**
 * The scene's callout in a box at the right end of the header: a formula or a comparison that steps replace.
 * The old text fades out as the new one fades in, and the box glows while a step's new text settles.
 * The box keeps the width of the widest callout, so it never jumps.
 */
export const HeaderCallout: React.FC<{ scene: Scene; s: StateFrame }> = ({ scene, s }) => {
  const fits = useMemo(() => calloutFits(scene), [scene]);
  if (!fits.size) return null;
  const width = Math.max(...[...fits.values()].map((f) => f.width)) + 2 * CALLOUT_PAD.x;
  const height = Math.max(...[...fits.values()].map((f) => f.height)) + 2 * CALLOUT_PAD.y;
  const [was, now] = [s.before.callout, s.now.callout];
  const shown = (was ? 1 : 0) + ((now ? 1 : 0) - (was ? 1 : 0)) * s.t;
  const changed = was !== now;
  const glow = changed ? s.lit : 0;
  const text = (value: string, opacity: number) =>
    value && opacity > 0 ? (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity }}>
        <FitText fit={fits.get(value)!} align="center" style={{ color: colors.text }} />
      </div>
    ) : null;
  return (
    <div
      style={{
        position: 'relative',
        flexShrink: 0,
        width,
        height,
        boxSizing: 'border-box',
        borderRadius: 14,
        background: colors.raised,
        border: `1.5px solid ${glow > 0 ? colors.accent : colors.borderStrong}`,
        boxShadow: glow > 0 ? `0 0 0 ${3 * glow}px ${colors.accentSoft}, 0 0 ${30 * glow}px ${colors.accentGlow}` : '0 10px 26px rgba(0,0,0,0.35)',
        opacity: shown,
      }}
    >
      {changed ? (
        <>
          {text(was, 1 - s.t)}
          {text(now, s.t)}
        </>
      ) : (
        text(now, 1)
      )}
    </div>
  );
};
