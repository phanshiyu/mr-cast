import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import type { Voiceover } from '../types';
import { spokenWordIndex } from '../utils/timing';
import { captionPage } from '../utils/captions';
import { CAPTION_BAND, clamp, colors, fonts } from './theme';

const MAX_CHARS = 72;

interface CaptionsProps {
  narration: string;
  durationInFrames: number;
  voiceover: Voiceover | null | undefined;
}

export const Captions: React.FC<CaptionsProps> = ({ narration, durationInFrames, voiceover }) => {
  const frame = useCurrentFrame();
  const current = spokenWordIndex(narration, frame, voiceover);
  const { words, lines } = captionPage(narration, current, MAX_CHARS);
  const opacity = interpolate(frame, [0, 8, durationInFrames - 6, durationInFrames], [0, 1, 1, 0], clamp);

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'none' }}>
      <div
        style={{
          height: CAPTION_BAND,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(to top, rgba(5,6,10,0.92) 30%, rgba(5,6,10,0))',
          opacity,
        }}
      >
        <div style={{ fontFamily: fonts.sans, fontSize: 36, lineHeight: 1.4, fontWeight: 500, textAlign: 'center', maxWidth: 1560 }}>
          {lines.map((line, li) => (
            <div key={li}>
              {line.map((wi) => (
                <span
                  key={wi}
                  style={{
                    color: wi === current ? colors.text : wi < current ? 'rgba(242,244,248,0.92)' : 'rgba(242,244,248,0.38)',
                    textShadow: wi === current ? `0 0 18px ${colors.accentGlow}` : undefined,
                  }}
                >
                  {words[wi]}{' '}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
