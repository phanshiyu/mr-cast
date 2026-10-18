import { ArrowRight, Check } from 'lucide-react';
import type { Token } from 'prism-react-renderer';
import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildFrames } from '../../shared/timing.mjs';
import type { FlowScene, FlowStep } from '../types';
import { COLUMN_GAP, LIST_W, STRIP_H, layoutFlow, type FlowLayout, type StepCard } from '../utils/flowLayout';
import { plainCodeColor, tokenColor, tokenizeLines } from '../utils/highlight';
import { spotlightStarts } from '../utils/spotlight';
import { lucideIcon } from './icons';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { FitText } from './FitText';
import { clamp, colors, fonts } from './theme';
import { tones } from './tones';

const TRANSITION = 14;
const ROWS_START = 4;
/** Every row has started landing by this frame, so the list is in by the end of the build. */
const ROWS_END = 16;

const StepRow: React.FC<{
  step: FlowStep;
  text: FlowLayout['rows'][number];
  index: number;
  state: 'past' | 'active' | 'future';
  appear: number;
  height: number;
}> = ({ step, text, index, state, appear, height }) => {
  const active = state === 'active';
  const Icon = lucideIcon(step.icon);
  const tone = step.tone ? tones[step.tone] : null;
  const chipColor = tone?.color ?? (active ? colors.accent : colors.muted);
  return (
    <div style={{ display: 'flex', gap: 22, height, opacity: appear }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 999,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          fontWeight: 700,
          background: active ? colors.accent : state === 'past' ? '#1d2140' : colors.raised,
          color: active ? '#0b0d18' : state === 'past' ? colors.accent : colors.faint,
          border: `2px solid ${active || state === 'past' ? colors.accent : colors.borderStrong}`,
          boxShadow: active ? `0 0 28px ${colors.accentGlow}` : undefined,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {state === 'past' ? <Check size={24} strokeWidth={3} /> : index + 1}
      </div>
      <div
        style={{ minWidth: 0, flex: 1, paddingTop: 2, opacity: state === 'past' ? 0.55 : state === 'future' ? 0.4 : 1 }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '3px 12px',
            borderRadius: 8,
            background: tone?.bg ?? (active ? colors.accentSoft : 'rgba(255,255,255,0.05)'),
            color: chipColor,
            fontFamily: fonts.mono,
            fontSize: text.actor.size,
            fontWeight: 600,
            boxSizing: 'border-box',
            // As wide as its text, so this clips nothing; it sets the chip's baseline at its bottom edge.
            overflow: 'hidden',
            verticalAlign: 'baseline',
          }}
        >
          {Icon ? (
            <Icon size={19} strokeWidth={2.2} style={{ display: 'inline-block', verticalAlign: -3, marginRight: 8 }} />
          ) : null}
          <FitText fit={text.actor} inline />
        </div>
        <FitText fit={active ? text.action : text.idle} style={{ marginTop: 6 }} />
      </div>
    </div>
  );
};

const CodeLines: React.FC<{ lines: Token[][]; fontSize: number }> = ({ lines, fontSize }) => (
  <div style={{ fontFamily: fonts.mono, fontSize, lineHeight: 1.5, color: plainCodeColor }}>
    {lines.map((tokens, i) => (
      <div key={i} style={{ whiteSpace: 'pre' }}>
        {tokens.map((t, j) => (
          <span key={j} style={{ color: tokenColor(t.types) }}>
            {t.content}
          </span>
        ))}
        {tokens.length === 0 ? ' ' : null}
      </div>
    ))}
  </div>
);

const PayloadCard: React.FC<{ card: StepCard; height: number }> = ({ card, height }) => {
  if (card.kind === 'headline') {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 64px',
          textAlign: 'center',
        }}
      >
        <FitText fit={card.text} align="center" />
      </div>
    );
  }
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', padding: '0 52px' }}>
      <CodeLines lines={tokenizeLines(card.text, card.language)} fontSize={card.lines.size} />
    </div>
  );
};

export const DataFlow: React.FC<SceneProps<FlowScene>> = ({ scene, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useMemo(() => layoutFlow(scene), [scene]);
  const steps = scene.steps;
  // With a `say` per step, step k is current from its segment; without, the steps share the narration.
  const said = segments.length > 1;
  const starts = spotlightStarts(segments, steps.length, buildFrames('flow'));
  const reached = starts.filter((start) => frame >= start).length - 1;
  const active = said ? reached : Math.max(0, reached);
  const local = active < 0 ? 0 : frame - starts[active]!;
  const rowStagger = Math.min(4, (ROWS_END - ROWS_START) / Math.max(1, steps.length - 1));
  const { stepH, panelW, cardH } = layout;
  const stripH = STRIP_H;

  const enter = active <= 0 && !said ? 1 : interpolate(local, [0, TRANSITION], [0, 1], clamp);
  const progress = active < 0 ? 0 : (active + enter) / steps.length;
  const previous = active > 0 && local < TRANSITION ? steps[active - 1]! : null;
  const current = active < 0 ? null : steps[active]!;
  const next = steps[active + 1];

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: COLUMN_GAP }}>
        <div style={{ width: LIST_W, position: 'relative', flexShrink: 0 }}>
          <div
            style={{
              position: 'absolute',
              left: 23,
              top: 24,
              width: 3,
              height: stepH * (steps.length - 1),
              background: colors.border,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 23,
              top: 24,
              width: 3,
              height: stepH * (steps.length - 1) * Math.max(0, Math.min(1, active / Math.max(1, steps.length - 1))),
              background: colors.accent,
            }}
          />
          {steps.map((step, i) => (
            <StepRow
              key={i}
              step={step}
              text={layout.rows[i]!}
              index={i}
              height={stepH}
              state={i < active ? 'past' : i === active ? 'active' : 'future'}
              appear={spring({ frame: frame - ROWS_START - i * rowStagger, fps, config: { damping: 18 } })}
            />
          ))}
        </div>
        <div style={{ width: panelW, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              height: stripH,
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '0 28px',
              borderRadius: 16,
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${colors.border}`,
              fontFamily: fonts.mono,
              fontSize: 24,
              boxSizing: 'border-box',
            }}
          >
            {current ? (
              <FitText fit={layout.strip[active]!} style={{ color: colors.accent, lineHeight: 'normal' }} />
            ) : (
              <span style={{ color: colors.faint, fontWeight: 700 }}>start</span>
            )}
            <ArrowRight size={26} color={next ? colors.muted : colors.faint} style={{ flexShrink: 0 }} />
            {next ? (
              <FitText
                fit={layout.strip[active + 1]!}
                weight={400}
                style={{ color: colors.text, lineHeight: 'normal' }}
              />
            ) : (
              <span style={{ color: colors.faint }}>done</span>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ color: colors.faint, fontSize: 20, flexShrink: 0 }}>
              step {Math.max(0, active + 1)}/{steps.length}
            </span>
          </div>
          <div
            style={{
              position: 'relative',
              height: cardH,
              borderRadius: 22,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                height: 4,
                width: `${progress * 100}%`,
                background: colors.accent,
                opacity: 0.7,
              }}
            />
            {current ? null : <PayloadCard card={layout.intro} height={cardH} />}
            {previous ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 1 - enter,
                  transform: `translateX(${-enter * 80}px)`,
                }}
              >
                <PayloadCard card={layout.cards[active - 1]!} height={cardH} />
              </div>
            ) : null}
            {current ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: enter,
                  transform: `translateX(${(1 - enter) * 80}px)`,
                }}
              >
                <PayloadCard card={layout.cards[active]!} height={cardH} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </SceneShell>
  );
};
