import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { TimelineScene } from '../types';
import { formatValue } from '../utils/chartLayout';
import { DETAIL_FONT, LABEL_FONT, SPAN_H, STAMP_FONT, layoutTimeline, type PlacedEvent, type PlacedSpan, type TimelineLayout } from '../utils/timelineLayout';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, defaultChapter, fonts } from './theme';
import { tones } from './tones';

const START = 10;

/**
 * The playhead visits every event and span edge left to right, one stop per equal share of the
 * scene, so each event holds the screen about as long as the narration spends on it.
 */
function buildPlayhead(scene: TimelineScene, layout: TimelineLayout, durationInFrames: number) {
  const values = [...new Set([...scene.events.map((e) => e.at), ...(scene.spans ?? []).flatMap((s) => [s.from, s.to])])].sort((a, b) => a - b);
  const xs = values.map(layout.x);
  const first = START + 16;
  const last = Math.max(first + 20, Math.round(durationInFrames * 0.78));
  const times = xs.map((_, i) => (xs.length === 1 ? first : first + (i / (xs.length - 1)) * (last - first)));
  const startX = layout.ticks[0]!.x;
  const inputs = [START + 4, ...times];
  const outputs = [startX, ...xs];
  return {
    playX: (frame: number) => interpolate(frame, inputs, outputs, clamp),
    reachedAt: (value: number) => times[values.indexOf(value)]!,
    last,
  };
}

function eventMotion(frame: number, fps: number, at: number) {
  return {
    pop: spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 170 } }),
    rise: spring({ frame: frame - at - 3, fps, config: { damping: 17, stiffness: 120 } }),
    flash: interpolate(frame, [at, at + 6, at + 30], [0, 1, 0], clamp),
  };
}

/** Stem and axis dot; every stem is drawn before any card, so cards in lower lanes cover the stems that pass behind them. */
const EventMark: React.FC<{ placed: PlacedEvent; axisY: number; at: number; frame: number }> = ({ placed, axisY, at, frame }) => {
  const { fps } = useVideoConfig();
  const tone = tones[placed.event.tone ?? 'accent'];
  const { pop, rise, flash } = eventMotion(frame, fps, at);
  const stemTop = placed.box.y + placed.box.h;
  return (
    <g>
      <line x1={placed.x} x2={placed.x} y1={axisY} y2={axisY - (axisY - stemTop) * rise} stroke={tone.color} strokeOpacity={0.6} strokeWidth={2} />
      <circle cx={placed.x} cy={axisY} r={(18 + 14 * flash) * Math.min(1, pop)} fill="none" stroke={tone.color} strokeOpacity={0.5 * flash} strokeWidth={3} />
      <circle cx={placed.x} cy={axisY} r={10 * pop} fill={tone.color} stroke={colors.bg} strokeWidth={3} />
    </g>
  );
};

const EventCard: React.FC<{ placed: PlacedEvent; at: number; frame: number }> = ({ placed, at, frame }) => {
  const { fps } = useVideoConfig();
  const tone = tones[placed.event.tone ?? 'accent'];
  const { rise, flash } = eventMotion(frame, fps, at);
  const { box } = placed;
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        boxSizing: 'border-box',
        padding: '12px 18px',
        borderRadius: 14,
        background: colors.raised,
        border: `1.5px solid ${tone.color}${flash > 0 ? 'cc' : '66'}`,
        boxShadow: `0 14px 36px rgba(0,0,0,0.45), 0 0 ${30 * flash}px ${tone.color}55`,
        opacity: rise,
        transform: `translateY(${(1 - rise) * 18}px)`,
      }}
    >
      <div style={{ fontFamily: fonts.mono, fontSize: STAMP_FONT, lineHeight: '24px', fontWeight: 700, color: tone.color }}>{placed.stamp}</div>
      {placed.label.map((l, i) => (
        <div key={i} style={{ fontSize: LABEL_FONT, lineHeight: '30px', fontWeight: 650, color: colors.text, whiteSpace: 'nowrap' }}>
          {l}
        </div>
      ))}
      {placed.detail.map((l, i) => (
        <div key={i} style={{ fontSize: DETAIL_FONT, lineHeight: '25px', color: colors.muted, whiteSpace: 'nowrap' }}>
          {l}
        </div>
      ))}
    </div>
  );
};

const SpanBar: React.FC<{ placed: PlacedSpan; playX: number; unit: string; doneAt: number; frame: number }> = ({ placed, playX, unit, doneAt, frame }) => {
  const tone = tones[placed.span.tone ?? 'warn'];
  const full = placed.x1 - placed.x0;
  const w = Math.max(0, Math.min(full, playX - placed.x0));
  const label = interpolate(frame, [doneAt - 4, doneAt + 8], [0, 1], clamp);
  const duration = formatValue(Math.abs(placed.span.to - placed.span.from), unit);
  const room = full - 24 - placed.label.length * DETAIL_FONT * 0.52 - duration.length * 17 * 0.62 - 20;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: placed.x0,
          top: placed.y,
          width: w,
          height: SPAN_H,
          boxSizing: 'border-box',
          borderRadius: 10,
          background: `repeating-linear-gradient(135deg, ${tone.bg}, ${tone.bg} 10px, transparent 10px, transparent 18px), ${tone.bg}`,
          border: w > 0 ? `1.5px solid ${tone.color}99` : 'none',
          overflow: 'hidden',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: placed.inside ? placed.x0 + 12 : placed.x1 + 12,
          width: placed.inside ? full - 24 : undefined,
          top: placed.y,
          height: SPAN_H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          fontSize: DETAIL_FONT,
          fontWeight: 700,
          color: tone.color,
          whiteSpace: 'nowrap',
          opacity: label,
        }}
      >
        <span>{placed.label}</span>
        {placed.inside && room > 0 ? <span style={{ fontFamily: fonts.mono, fontSize: 17, fontWeight: 600, opacity: 0.8 }}>{duration}</span> : null}
      </div>
    </>
  );
};

export const Timeline: React.FC<SceneProps<TimelineScene>> = ({ scene, durationInFrames }) => {
  const frame = useCurrentFrame();
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutTimeline(scene, box.width), [scene, box.width]);
  const playhead = useMemo(() => buildPlayhead(scene, layout, durationInFrames), [scene, layout, durationInFrames]);
  const scale = Math.min(1, box.height / layout.height);
  const playX = playhead.playX(frame);
  const axisIn = interpolate(frame, [START, START + 10], [0, 1], clamp);
  const headOpacity = interpolate(frame, [START + 2, START + 8, playhead.last + 6, playhead.last + 18], [0, 1, 1, 0], clamp);
  const { axisY, ticks } = layout;
  const left = ticks[0]!.x;
  const right = ticks[ticks.length - 1]!.x;

  return (
    <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.timeline} title={scene.title}>
      <div
        style={{
          position: 'absolute',
          left: (box.width - layout.width * scale) / 2,
          top: Math.max(0, box.height - layout.height * scale) * 0.4,
          width: layout.width,
          height: layout.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="100%" height="100%">
          <line x1={left} x2={right} y1={axisY} y2={axisY} stroke={colors.borderStrong} strokeWidth={3} strokeDasharray="2 9" strokeLinecap="round" opacity={axisIn} />
          <line x1={left} x2={Math.max(left, playX)} y1={axisY} y2={axisY} stroke={colors.text} strokeOpacity={0.75} strokeWidth={4} strokeLinecap="round" />
          {ticks.map((t, i) => (
            <line key={i} x1={t.x} x2={t.x} y1={axisY - 8} y2={axisY + 8} stroke={colors.faint} strokeWidth={2} opacity={axisIn} />
          ))}
        </svg>
        {ticks.map((t, i) => (
          <div
            key={i}
            style={{ position: 'absolute', left: t.x, top: axisY + 14, transform: 'translateX(-50%)', fontFamily: fonts.mono, fontSize: 17, color: colors.faint, whiteSpace: 'nowrap', opacity: axisIn }}
          >
            {t.text}
          </div>
        ))}
        {layout.spans.map((placed, i) => (
          <SpanBar key={i} placed={placed} playX={playX} unit={scene.unit} doneAt={playhead.reachedAt(Math.max(placed.span.from, placed.span.to))} frame={frame} />
        ))}
        <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="100%" height="100%">
          {layout.events.map((placed) => (
            <EventMark key={placed.index} placed={placed} axisY={axisY} at={playhead.reachedAt(placed.event.at)} frame={frame} />
          ))}
        </svg>
        {layout.events.map((placed) => (
          <EventCard key={placed.index} placed={placed} at={playhead.reachedAt(placed.event.at)} frame={frame} />
        ))}
        <div
          style={{
            position: 'absolute',
            left: playX - 1.5,
            top: axisY - 26,
            width: 3,
            height: 52,
            borderRadius: 2,
            background: colors.accent,
            boxShadow: `0 0 18px ${colors.accentGlow}`,
            opacity: headOpacity,
          }}
        />
      </div>
    </SceneShell>
  );
};
