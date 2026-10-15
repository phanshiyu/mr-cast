import { ArrowRight, Check } from 'lucide-react';
import type { Token } from 'prism-react-renderer';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { FlowScene, FlowStep } from '../types';
import { plainCodeColor, tokenColor, tokenizeLines } from '../utils/highlight';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, clampLines, colors, contentBox, defaultChapter, ellipsis, fitFontSize, fonts } from './theme';

const LIST_W = 600;
const COLUMN_GAP = 56;
const TRANSITION = 14;

/** Pretty-printed JSON when the payload parses, otherwise the raw text. */
function formatPayload(payload: string): { text: string; language: string } {
  try {
    return { text: JSON.stringify(JSON.parse(payload), null, 2), language: 'json' };
  } catch {
    return { text: payload, language: 'plain' };
  }
}

const StepRow: React.FC<{ step: FlowStep; index: number; state: 'past' | 'active' | 'future'; appear: number; height: number }> = ({
  step,
  index,
  state,
  appear,
  height,
}) => {
  const active = state === 'active';
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
      <div style={{ minWidth: 0, flex: 1, paddingTop: 2, opacity: state === 'past' ? 0.55 : state === 'future' ? 0.4 : 1 }}>
        <div
          style={{
            display: 'inline-block',
            maxWidth: '100%',
            padding: '3px 12px',
            borderRadius: 8,
            background: active ? colors.accentSoft : 'rgba(255,255,255,0.05)',
            color: active ? colors.accent : colors.muted,
            fontFamily: fonts.mono,
            fontSize: 19,
            fontWeight: 600,
            boxSizing: 'border-box',
            ...ellipsis,
          }}
        >
          {step.actor}
        </div>
        <div style={{ fontSize: active ? 30 : 27, fontWeight: active ? 650 : 500, marginTop: 6, lineHeight: 1.25, ...clampLines(height >= 150 ? 2 : 1) }}>{step.action}</div>
      </div>
    </div>
  );
};

const CodeLines: React.FC<{ lines: Token[][]; fontSize: number }> = ({ lines, fontSize }) => (
  <div style={{ fontFamily: fonts.mono, fontSize, lineHeight: 1.5, color: plainCodeColor }}>
    {lines.map((tokens, i) => (
      <div key={i} style={{ ...ellipsis, whiteSpace: 'pre' }}>
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

const PayloadCard: React.FC<{ step: FlowStep; height: number }> = ({ step, height }) => {
  if (!step.payload) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 64px', textAlign: 'center' }}>
        <div style={{ fontSize: fitFontSize(step.action, 64, 40, 36), fontWeight: 700, letterSpacing: -1, lineHeight: 1.15, ...clampLines(3) }}>
          {step.action}
        </div>
      </div>
    );
  }
  const { text, language } = formatPayload(step.payload);
  const lines = tokenizeLines(text, language);
  const longest = Math.max(...text.split('\n').map((l) => l.length));
  const fontSize = Math.max(12, Math.min(40, Math.floor(1000 / Math.max(1, longest * 0.6)), Math.floor((height - 48) / (lines.length * 1.5))));
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', padding: '0 52px', overflow: 'hidden' }}>
      <CodeLines lines={lines} fontSize={fontSize} />
    </div>
  );
};

export const DataFlow: React.FC<SceneProps<FlowScene>> = ({ scene, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hasTitle = Boolean(scene.title);
  const box = contentBox(hasTitle);
  const steps = scene.steps;
  const perStep = durationInFrames / steps.length;
  const active = Math.min(steps.length - 1, Math.floor(frame / perStep));
  const local = frame - active * perStep;
  const stepH = Math.min(170, box.height / steps.length);
  const panelW = box.width - LIST_W - COLUMN_GAP;
  const stripH = 76;
  const cardH = box.height - stripH - 20;
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], clamp);

  const enter = active === 0 ? 1 : interpolate(local, [0, TRANSITION], [0, 1], clamp);
  const previous = active > 0 && local < TRANSITION ? steps[active - 1]! : null;
  const next = steps[active + 1];

  return (
    <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.flow} title={scene.title}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: COLUMN_GAP }}>
        <div style={{ width: LIST_W, position: 'relative', flexShrink: 0 }}>
          <div style={{ position: 'absolute', left: 23, top: 24, width: 3, height: stepH * (steps.length - 1), background: colors.border }} />
          <div
            style={{
              position: 'absolute',
              left: 23,
              top: 24,
              width: 3,
              height: stepH * (steps.length - 1) * Math.min(1, active / Math.max(1, steps.length - 1)),
              background: colors.accent,
            }}
          />
          {steps.map((step, i) => (
            <StepRow
              key={i}
              step={step}
              index={i}
              height={stepH}
              state={i < active ? 'past' : i === active ? 'active' : 'future'}
              appear={spring({ frame: frame - 4 - i * 4, fps, config: { damping: 18 } })}
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
            <span style={{ color: colors.accent, fontWeight: 700, maxWidth: panelW * 0.4, ...ellipsis }}>{steps[active]!.actor}</span>
            <ArrowRight size={26} color={next ? colors.muted : colors.faint} style={{ flexShrink: 0 }} />
            <span style={{ color: next ? colors.text : colors.faint, maxWidth: panelW * 0.4, ...ellipsis }}>{next ? next.actor : 'done'}</span>
            <div style={{ flex: 1 }} />
            <span style={{ color: colors.faint, fontSize: 20, flexShrink: 0 }}>
              step {active + 1}/{steps.length}
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
            <div style={{ position: 'absolute', left: 0, top: 0, height: 4, width: `${progress * 100}%`, background: colors.accent, opacity: 0.7 }} />
            {previous ? (
              <div style={{ position: 'absolute', inset: 0, opacity: 1 - enter, transform: `translateX(${-enter * 80}px)` }}>
                <PayloadCard step={previous} height={cardH} />
              </div>
            ) : null}
            <div style={{ position: 'absolute', inset: 0, opacity: enter, transform: `translateX(${(1 - enter) * 80}px)` }}>
              <PayloadCard step={steps[active]!} height={cardH} />
            </div>
          </div>
        </div>
      </div>
    </SceneShell>
  );
};
