import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { stepTargets } from '../../shared/targets.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import type { TimelineScene } from '../types';
import { formatValue } from '../utils/chartLayout';
import { SPAN_H, STAMP_FONT, layoutTimeline, type PlacedEvent, type PlacedSpan, type TimelineLayout, timelineBoxes } from '../utils/timelineLayout';
import { staged } from '../utils/penGeometry';
import { PenMarks } from './PenMarks';
import { focusSpotlight, revealStarts, stepSpring, type Emphasis } from '../utils/spotlight';
import type { SpokenSegment } from '../utils/timing';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { measure } from '../../shared/textfit.mjs';
import { FitText } from './FitText';
import { clamp, colors, contentBox, fonts } from './theme';
import { Badge, badgesOf, CornerBadges, EMPHASIS, emphasisRing } from './marks';
import { tones } from './tones';

const START = 10;
/** Frames an event takes to rise in after the playhead reaches it. */
const RISE_FRAMES = 14;
/** Frames the playhead takes to move to a step's events. */
const TRAVEL_FRAMES = 8;

/** Per step, the last event drawn by its end and the furthest value it focuses, both never moving back. */
function stepReach(scene: TimelineScene): { lasts: number[]; values: number[] } {
  const focused = stepTargets(scene);
  let last = -1;
  let value = -Infinity;
  const lasts: number[] = [];
  const values: number[] = [];
  for (const keys of focused) {
    const events = keys.flatMap((k) => (k.startsWith('ev:') ? [Number(k.slice(3))] : []));
    const spans = keys.flatMap((k) => (k.startsWith('sp:') ? [scene.spans![Number(k.slice(3))]!] : []));
    last = Math.max(last, ...events);
    value = Math.max(value, ...events.map((i) => scene.events[i]!.at), ...spans.map((sp) => Math.max(sp.from, sp.to)));
    lasts.push(last);
    values.push(value);
  }
  return { lasts, values };
}

/**
 * The playhead's keyframes, as frames and x positions. Without steps it sweeps every event and span
 * edge during the build, so the whole timeline is drawn before the voice. With steps it waits at the
 * start, then moves to the furthest event or span end each step focuses as that step begins, and the
 * last step runs to the end.
 */
function playheadKeys(scene: TimelineScene, layout: TimelineLayout, segments: readonly SpokenSegment[]) {
  const values = [...new Set([...scene.events.map((e) => e.at), ...(scene.spans ?? []).flatMap((s) => [s.from, s.to])])].sort((a, b) => a - b);
  const startX = layout.ticks[0]!.x;
  const endX = layout.x(values[values.length - 1]!);
  const times = [START + 4];
  const xs = [startX];
  const reach = stepReach(scene).values;
  if (reach.length && segments.length > 1) {
    reach.forEach((value, k) => {
      const at = segments[k + 1]!.from;
      const target = k === reach.length - 1 ? endX : Number.isFinite(value) ? layout.x(value) : startX;
      times.push(at, at + TRAVEL_FRAMES);
      xs.push(xs[xs.length - 1]!, target);
    });
  } else {
    const first = START + 12;
    const last = buildFrames('timeline') - RISE_FRAMES;
    values.forEach((value, i) => {
      times.push(values.length === 1 ? first : first + (i / (values.length - 1)) * (last - first));
      xs.push(layout.x(value));
    });
  }
  return { times, xs };
}

function buildPlayhead(scene: TimelineScene, layout: TimelineLayout, segments: readonly SpokenSegment[]) {
  const { times, xs } = playheadKeys(scene, layout, segments);
  /** The first frame the playhead reaches `value`. */
  const reachedAt = (value: number) => {
    const x = layout.x(value);
    if (x <= xs[0]!) return times[0]!;
    for (let i = 1; i < xs.length; i++) {
      if (xs[i]! > xs[i - 1]! && x <= xs[i]!) return times[i - 1]! + ((x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!)) * (times[i]! - times[i - 1]!);
    }
    return times[times.length - 1]!;
  };
  // A step's events rise while the playhead travels to them, so they are up before the voice names
  // them; an event at the playhead's start still waits for its step.
  const { lasts } = stepReach(scene);
  const stepped = lasts.length > 0 && segments.length > 1;
  const stepFrom = revealStarts(segments, scene.events.length, lasts, 0, 0, 0);
  return {
    playX: (frame: number) => interpolate(frame, times, xs, clamp),
    reachedAt,
    eventAt: (index: number): EventTiming => {
      const reached = reachedAt(scene.events[index]!.at);
      return stepped ? { at: Math.max(stepFrom[index]!, reached - TRAVEL_FRAMES / 2), stepFrom: stepFrom[index]! } : { at: reached };
    },
    last: times[times.length - 1]!,
  };
}

/** When an event appears, and the start of the step that brings it, if one does: it is at rest when that step settles. */
interface EventTiming {
  at: number;
  stepFrom?: number;
}

function eventMotion(frame: number, fps: number, { at, stepFrom }: EventTiming) {
  const motion = (delay: number, config: { damping: number; stiffness: number }) =>
    stepFrom === undefined ? spring({ frame: frame - at - delay, fps, config }) : stepSpring(frame, fps, at + delay, stepFrom, config);
  return {
    pop: motion(0, { damping: 12, stiffness: 170 }),
    rise: motion(3, { damping: 17, stiffness: 120 }),
    flash: interpolate(frame, [at, at + 6, at + 30], [0, 1, 0], clamp),
  };
}

/** Leader and axis dot. The leader grows from the dot up to the card as the card rises. */
const EventMark: React.FC<{ placed: PlacedEvent; axisY: number; timing: EventTiming; frame: number }> = ({ placed, axisY, timing, frame }) => {
  const { fps } = useVideoConfig();
  const tone = tones[placed.event.tone ?? 'accent'];
  const { pop, rise, flash } = eventMotion(frame, fps, timing);
  return (
    <g>
      <polyline
        points={placed.stem.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - Math.min(1, Math.max(0, rise))}
        stroke={tone.color}
        strokeOpacity={0.6}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <circle cx={placed.x} cy={axisY} r={(18 + 14 * flash) * Math.min(1, pop)} fill="none" stroke={tone.color} strokeOpacity={0.5 * flash} strokeWidth={3} />
      <circle cx={placed.x} cy={axisY} r={10 * pop} fill={tone.color} stroke={colors.bg} strokeWidth={3} />
    </g>
  );
};

const EventCard: React.FC<{ placed: PlacedEvent; timing: EventTiming; frame: number; emphasis: Emphasis }> = ({ placed, timing, frame, emphasis }) => {
  const { fps } = useVideoConfig();
  const tone = tones[placed.event.tone ?? 'accent'];
  const { rise, flash } = eventMotion(frame, fps, timing);
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
        background: placed.event.highlight ? EMPHASIS.card : colors.raised,
        border: `1.5px solid ${placed.event.highlight ? EMPHASIS.color : `${tone.color}${flash > 0 ? 'cc' : '66'}`}`,
        boxShadow: `${placed.event.highlight ? emphasisRing(5, 40) : '0 14px 36px rgba(0,0,0,0.45)'}, 0 0 ${30 * flash}px ${tone.color}55${emphasis.glow > 0 ? `, 0 0 0 ${3 * emphasis.glow}px ${tone.color}, 0 0 ${40 * emphasis.glow}px ${tone.color}66` : ''}`,
        opacity: rise * emphasis.opacity,
        transform: `translateY(${(1 - rise) * 18}px) scale(${1 + 0.03 * emphasis.glow})`,
      }}
    >
      <div style={{ fontFamily: fonts.mono, fontSize: STAMP_FONT, lineHeight: '24px', fontWeight: 700, color: tone.color }}>{placed.stamp}</div>
      <FitText fit={placed.label} style={{ color: colors.text }} />
      {placed.detail ? <FitText fit={placed.detail} style={{ color: colors.muted }} /> : null}
      <CornerBadges badges={badgesOf(placed.event)} size={12} top={-12} right={12} />
    </div>
  );
};

const SpanBar: React.FC<{ placed: PlacedSpan; playX: number; unit: string; doneAt: number; frame: number; emphasis: Emphasis }> = ({ placed, playX, unit, doneAt, frame, emphasis }) => {
  const tone = tones[placed.span.tone ?? 'warn'];
  const full = placed.x1 - placed.x0;
  const w = Math.max(0, Math.min(full, playX - placed.x0));
  const label = interpolate(frame, [doneAt - 4, doneAt + 8], [0, 1], clamp);
  const duration = formatValue(Math.abs(placed.span.to - placed.span.from), unit);
  const room = full - 24 - placed.label.width - measure(duration, { family: 'mono', weight: 600, size: 17 }) - 20;
  return (
    <div style={{ opacity: emphasis.opacity }}>
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
          border: w > 0 ? `1.5px solid ${placed.span.highlight ? EMPHASIS.color : `${tone.color}${emphasis.glow > 0 ? '' : '99'}`}` : 'none',
          boxShadow: emphasis.glow > 0 ? `0 0 ${36 * emphasis.glow}px ${tone.color}77` : placed.span.highlight ? `0 0 26px ${EMPHASIS.glow}` : undefined,
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
          color: tone.color,
          whiteSpace: 'nowrap',
          opacity: label,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FitText fit={placed.label} inline />
          {badgesOf(placed.span).map((b, i) => (
            <Badge key={i} badge={b} size={12} />
          ))}
        </span>
        {placed.inside && room > 0 ? <span style={{ fontFamily: fonts.mono, fontSize: 17, fontWeight: 600, opacity: 0.8 }}>{duration}</span> : null}
      </div>
    </div>
  );
};

export const Timeline: React.FC<SceneProps<TimelineScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutTimeline(scene, box.width), [scene, box.width]);
  const playhead = useMemo(() => buildPlayhead(scene, layout, segments), [scene, layout, segments]);
  const scale = Math.min(1, box.height / layout.height);
  const stage = { left: (box.width - layout.width * scale) / 2, top: Math.max(0, box.height - layout.height * scale) * 0.4, scale };
  const marks = useMemo(() => staged(timelineBoxes(layout), stage, box), [layout, stage.left, stage.top, scale, box.width, box.height]);
  const playX = playhead.playX(frame);
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  const axisIn = interpolate(frame, [START, START + 10], [0, 1], clamp);
  const headOpacity = interpolate(frame, [START + 2, START + 8, playhead.last + 6, playhead.last + 18], [0, 1, 1, 0], clamp);
  const { axisY, ticks } = layout;
  const left = ticks[0]!.x;
  const right = ticks[ticks.length - 1]!.x;

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames}>
      <div
        style={{
          position: 'absolute',
          left: stage.left,
          top: stage.top,
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
          <SpanBar key={i} placed={placed} playX={playX} unit={scene.unit} doneAt={playhead.reachedAt(Math.max(placed.span.from, placed.span.to))} frame={frame} emphasis={emphasisOf(`sp:${i}`)} />
        ))}
        <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="100%" height="100%">
          {layout.events.map((placed) => (
            <EventMark key={placed.index} placed={placed} axisY={axisY} timing={playhead.eventAt(placed.index)} frame={frame} />
          ))}
        </svg>
        {layout.events.map((placed) => (
          <EventCard key={placed.index} placed={placed} timing={playhead.eventAt(placed.index)} frame={frame} emphasis={emphasisOf(`ev:${placed.index}`)} />
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
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={() => marks} />
    </SceneShell>
  );
};
