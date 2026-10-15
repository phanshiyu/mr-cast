import { Box, Database, Layers, Monitor, Server, StickyNote, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { MessageKind, NodeKind, SequenceScene } from '../types';
import {
  BAR_W,
  CARD_H,
  layoutSequence,
  type PlacedMessage,
  type PlacedParticipant,
  type Pt,
  type SequenceLayout,
} from '../utils/sequenceLayout';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, clampLines, colors, contentBox, defaultChapter, ellipsis, fitFontSize, fonts } from './theme';

const kindIcon: Record<NodeKind, LucideIcon> = { service: Server, db: Database, queue: Layers, client: Monitor };
const kindLabel: Record<NodeKind, string> = { service: 'service', db: 'datastore', queue: 'queue', client: 'client' };

const HEADER_START = 6;
const LIFELINE_START = 12;
const LIFELINE_FRAMES = 16;
const MESSAGES_START = 26;
/** Messages finish arriving by this share of the scene so the narration can walk through them. */
const MESSAGES_END = 0.86;
const HEAD = 14;

const neutralStroke = '#c4cad8';
const returnStroke = 'rgba(170, 178, 200, 0.62)';
const noteAmber = 'rgba(251, 191, 36, 0.45)';

const ParticipantCard: React.FC<{ placed: PlacedParticipant; width: number; top: number; appear: number }> = ({ placed, width, top, appear }) => {
  const { participant } = placed;
  const Icon = participant.kind ? kindIcon[participant.kind] : Box;
  const modified = participant.modified;
  return (
    <div
      style={{
        position: 'absolute',
        left: placed.x - width / 2,
        top,
        width,
        height: CARD_H,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 16px',
        borderRadius: 18,
        background: modified ? 'linear-gradient(180deg, #1c2033, #151826)' : colors.raised,
        border: `2px solid ${modified ? colors.accent : colors.borderStrong}`,
        boxShadow: modified ? `0 0 0 5px ${colors.accentSoft}, 0 0 40px ${colors.accentGlow}` : '0 12px 32px rgba(0,0,0,0.4)',
        opacity: appear,
        transform: `translateY(${(1 - appear) * 18}px) scale(${0.92 + 0.08 * appear})`,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: modified ? colors.accentSoft : 'rgba(255,255,255,0.05)',
          color: modified ? colors.accent : colors.muted,
          flexShrink: 0,
        }}
      >
        <Icon size={26} strokeWidth={2} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: fitFontSize(participant.label, 25, 11, 18), fontWeight: 650, color: colors.text, ...ellipsis }}>
          {participant.label}
        </div>
        <div style={{ fontSize: 17, color: colors.faint, marginTop: 3, ...ellipsis }}>
          {participant.kind ? kindLabel[participant.kind] : 'participant'}
        </div>
      </div>
      {modified ? (
        <div
          style={{
            position: 'absolute',
            top: -14,
            right: 14,
            padding: '3px 10px',
            borderRadius: 999,
            background: colors.accent,
            color: '#0b0d18',
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          changed
        </div>
      ) : null}
    </div>
  );
};

/** The first `t` (0..1) of a polyline by length, plus the heading of its last segment. */
function partialPolyline(points: readonly Pt[], t: number): { points: Pt[]; angle: number } {
  const segs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let remaining = segs.reduce((a, b) => a + b, 0) * t;
  const out: Pt[] = [points[0]!];
  for (let i = 0; i < segs.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const f = segs[i]! === 0 ? 1 : Math.min(1, remaining / segs[i]!);
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    remaining -= segs[i]!;
    if (remaining <= 0 || f < 1) return { points: out, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
  }
  const a = points[points.length - 2]!;
  const b = points[points.length - 1]!;
  return { points: out, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
}

const headPath: Record<MessageKind, string> = {
  call: `M 0 0 L ${-HEAD} ${-HEAD * 0.5} L ${-HEAD} ${HEAD * 0.5} Z`,
  return: `M ${-HEAD} ${-HEAD * 0.55} L 0 0 L ${-HEAD} ${HEAD * 0.55}`,
  async: `M ${-HEAD} ${-HEAD * 0.6} L 0 0`,
};

const MessageArrow: React.FC<{ placed: PlacedMessage; draw: number; current: boolean }> = ({ placed, draw, current }) => {
  if (draw <= 0) return null;
  const { kind } = placed;
  const modified = placed.message.modified;
  const stroke = modified ? colors.accent : kind === 'return' ? returnStroke : neutralStroke;
  const { points, angle } = partialPolyline(placed.points, draw);
  const d = points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  const tip = points[points.length - 1]!;
  const width = (kind === 'return' ? 2.5 : 3) + (current ? 0.75 : 0);
  return (
    <g opacity={modified && kind === 'return' ? 0.85 : 1}>
      {modified ? (
        <path d={d} fill="none" stroke={colors.accentGlow} strokeWidth={current ? 14 : 10} strokeOpacity={current ? 0.55 : 0.35} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
      <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={kind === 'return' ? '10 8' : undefined} strokeLinejoin="round" />
      <path
        d={headPath[kind]}
        transform={`translate(${tip.x} ${tip.y}) rotate(${angle})`}
        fill={kind === 'call' ? stroke : 'none'}
        stroke={stroke}
        strokeWidth={kind === 'call' ? 1 : width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
};

const MessageLabel: React.FC<{ placed: PlacedMessage; appear: number; current: boolean }> = ({ placed, appear, current }) => {
  const { label, kind } = placed;
  const modified = placed.message.modified;
  const shift = label.align === 'center' ? 'translate(-50%, -100%)' : label.align === 'right' ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
  return (
    <div
      style={{
        position: 'absolute',
        left: label.x,
        top: label.y,
        transform: `${shift} scale(${0.94 + 0.06 * appear})`,
        transformOrigin: label.align === 'center' ? '50% 100%' : label.align === 'right' ? '100% 50%' : '0 50%',
        opacity: appear,
        maxWidth: label.maxWidth,
        boxSizing: 'border-box',
        padding: '2px 11px',
        borderRadius: 8,
        background: modified ? '#141834' : '#0d0f16',
        border: `1px solid ${modified ? colors.accent : current ? 'rgba(255,255,255,0.32)' : colors.border}`,
        boxShadow: current ? `0 0 22px ${modified ? colors.accentGlow : 'rgba(255,255,255,0.12)'}` : undefined,
        color: modified ? '#cdd3ff' : kind === 'return' ? colors.muted : colors.text,
        fontFamily: fonts.mono,
        fontSize: label.fontSize,
        fontWeight: current ? 650 : 500,
        lineHeight: 1.35,
        ...ellipsis,
      }}
    >
      {placed.message.label}
    </div>
  );
};

const NoteCard: React.FC<{ placed: PlacedMessage; appear: number }> = ({ placed, appear }) => {
  const note = placed.note!;
  return (
    <div
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        transform: `translate(${note.side === 'left' ? '-100%' : '0'}, -50%) translateX(${(1 - appear) * (note.side === 'left' ? 12 : -12)}px)`,
        opacity: appear,
        width: 'max-content',
        maxWidth: note.maxWidth,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '5px 12px',
        borderRadius: '8px 2px 8px 8px',
        background: '#1e1a10',
        border: `1px solid ${noteAmber}`,
        color: '#f1dca0',
        fontSize: 17,
        lineHeight: 1.3,
      }}
    >
      <StickyNote size={16} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 3, color: '#fbbf24' }} />
      <span style={{ minWidth: 0, ...(note.lines === 1 ? ellipsis : clampLines(2)) }}>{placed.message.note}</span>
    </div>
  );
};

/** Frame at which each message starts drawing, spread evenly up to MESSAGES_END of the scene. */
function messageTimeline(count: number, durationInFrames: number) {
  const start = Math.min(MESSAGES_START, durationInFrames * 0.12);
  const end = Math.max(start + count, durationInFrames * MESSAGES_END);
  const step = count > 1 ? (end - start) / count : end - start;
  return { starts: Array.from({ length: count }, (_, i) => start + i * step), drawFrames: Math.max(4, Math.min(14, step * 0.7)) };
}

/** The y down to which activation bars are revealed: the arrow of the latest message that has landed. */
function revealFront(layout: SequenceLayout, starts: number[], drawFrames: number, frame: number): number {
  const ys = layout.messages.map((m) => m.points[m.points.length - 1]!.y);
  if (!ys.length) return 0;
  const input = starts.map((s) => s + drawFrames);
  const lastEnd = input[input.length - 1]!;
  return interpolate(frame, [...input, lastEnd + 8], [...ys, layout.height], clamp);
}

export const SequenceDiagram: React.FC<SceneProps<SequenceScene>> = ({ scene, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutSequence(scene.participants, scene.messages, box), [scene.participants, scene.messages, box.width, box.height]);
  const { starts, drawFrames } = messageTimeline(layout.messages.length, durationInFrames);
  const current = starts.reduce((cur, s, i) => (frame >= s ? i : cur), -1);
  const front = revealFront(layout, starts, drawFrames, frame);
  const lifeline = interpolate(frame, [LIFELINE_START, LIFELINE_START + LIFELINE_FRAMES], [0, 1], clamp);
  const headerStagger = Math.min(5, (durationInFrames * 0.06) / Math.max(1, layout.participants.length));
  const scale = Math.min(1, box.width / layout.width, box.height / layout.height);

  return (
    <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.sequence} title={scene.title}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height, transform: `scale(${scale})`, flexShrink: 0 }}>
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            {current >= 0 ? (
              <rect
                x={-12}
                y={layout.messages[current]!.top}
                width={layout.width + 24}
                height={layout.messages[current]!.bottom - layout.messages[current]!.top}
                rx={12}
                fill={layout.messages[current]!.message.modified ? colors.accentSoft : 'rgba(255,255,255,0.035)'}
                opacity={interpolate(frame, [starts[current]!, starts[current]! + drawFrames], [0, 1], clamp)}
              />
            ) : null}
            {layout.participants.map((p) => (
              <line
                key={p.participant.id}
                x1={p.x}
                x2={p.x}
                y1={layout.lifelineTop}
                y2={layout.lifelineTop + (layout.height - layout.lifelineTop) * lifeline}
                stroke={p.participant.modified ? colors.accent : 'rgba(255,255,255,0.22)'}
                strokeOpacity={p.participant.modified ? 0.45 : 1}
                strokeWidth={2}
                strokeDasharray="6 10"
              />
            ))}
            {layout.activations.map((a, i) =>
              frame >= starts[a.opener]! ? (
                <rect
                  key={i}
                  x={a.x - BAR_W / 2}
                  y={a.y0}
                  width={BAR_W}
                  height={Math.max(0, Math.min(a.y1, Math.max(front, a.y0 + 6)) - a.y0)}
                  rx={3}
                  fill="#262b3c"
                  stroke="rgba(255,255,255,0.3)"
                  strokeWidth={1.5}
                />
              ) : null,
            )}
            {layout.messages.map((m, i) => (
              <MessageArrow
                key={i}
                placed={m}
                current={i === current}
                draw={interpolate(frame, [starts[i]!, starts[i]! + drawFrames], [0, 1], clamp)}
              />
            ))}
          </svg>
          {layout.participants.map((p, i) => (
            <ParticipantCard
              key={p.participant.id}
              placed={p}
              width={layout.cardW}
              top={layout.cardTop}
              appear={spring({ frame: frame - HEADER_START - i * headerStagger, fps, config: { damping: 16, stiffness: 110 } })}
            />
          ))}
          {layout.messages.map((m, i) => {
            const appear = interpolate(frame, [starts[i]! + drawFrames * 0.5, starts[i]! + drawFrames * 1.2], [0, 1], clamp);
            return (
              <div key={i}>
                <MessageLabel placed={m} appear={appear} current={i === current} />
                {m.note ? <NoteCard placed={m} appear={appear} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </SceneShell>
  );
};
