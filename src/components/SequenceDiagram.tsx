import { StickyNote } from 'lucide-react';
import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildFrames } from '../../shared/timing.mjs';
import { stepTargets } from '../../shared/targets.mjs';
import type { MessageKind, SequenceMessage, SequenceScene } from '../types';
import {
  BAR_W,
  CARD_H,
  LABEL_LINE_HEIGHT,
  layoutSequence,
  type PlacedMessage,
  type Pt,
  type SequenceLayout, sequenceBoxes } from '../utils/sequenceLayout';
import { centredStage, staged } from '../utils/penGeometry';
import { PenMarks } from './PenMarks';
import { currentStep, focusSpotlight, revealStarts } from '../utils/spotlight';
import { SceneShell } from './SceneShell';
import { badgesOf, CornerBadges, EMPHASIS } from './marks';
import { NodeCard, nodeMark } from './NodeCard';
import type { SceneProps } from './sceneProps';
import { clamp, clampLines, colors, contentBox, defaultChapter, ellipsis, fonts } from './theme';

const HEADER_START = 6;
const HEADERS_END = 14;
const LIFELINE_START = 12;
const LIFELINE_FRAMES = 16;
const MESSAGES_START = 20;
const DRAW_FRAMES = 10;
/** Frames from a message's start until its label has faded in. */
const MESSAGE_FRAMES = DRAW_FRAMES * 1.2;
/** Frames between the messages one step reveals. */
const STEP_STAGGER = 2;
const HEAD = 14;

const neutralStroke = '#c4cad8';
const returnStroke = 'rgba(170, 178, 200, 0.62)';
const noteAmber = 'rgba(251, 191, 36, 0.45)';

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

/** How a message is marked: by what the diff does to it, else as highlighted, else not at all. */
function messageMark(message: SequenceMessage): { stroke: string; glow: string; labelBg: string; labelText: string } | null {
  if (message.change === 'modified') return { stroke: colors.accent, glow: colors.accentGlow, labelBg: '#141834', labelText: '#cdd3ff' };
  if (message.change === 'added') return { stroke: colors.add, glow: 'rgba(61,220,151,0.4)', labelBg: '#10201b', labelText: '#c4f3dd' };
  if (message.change === 'removed') return { stroke: colors.del, glow: 'transparent', labelBg: '#1e1216', labelText: colors.muted };
  return message.highlight ? { stroke: EMPHASIS.color, glow: EMPHASIS.glow, labelBg: '#1f2026', labelText: colors.text } : null;
}

const headPath: Record<MessageKind, string> = {
  call: `M 0 0 L ${-HEAD} ${-HEAD * 0.5} L ${-HEAD} ${HEAD * 0.5} Z`,
  return: `M ${-HEAD} ${-HEAD * 0.55} L 0 0 L ${-HEAD} ${HEAD * 0.55}`,
  async: `M ${-HEAD} ${-HEAD * 0.6} L 0 0`,
};

const MessageArrow: React.FC<{ placed: PlacedMessage; draw: number; current: boolean }> = ({ placed, draw, current }) => {
  if (draw <= 0) return null;
  const { kind } = placed;
  const mark = messageMark(placed.message);
  const removed = placed.message.change === 'removed';
  const stroke = mark?.stroke ?? (kind === 'return' ? returnStroke : neutralStroke);
  const { points, angle } = partialPolyline(placed.points, draw);
  const d = points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  const tip = points[points.length - 1]!;
  const width = (kind === 'return' ? 2.5 : 3) + (current ? 0.75 : 0);
  return (
    <g opacity={removed ? 0.7 : mark && kind === 'return' ? 0.85 : 1}>
      {mark && !removed ? (
        <path d={d} fill="none" stroke={mark.glow} strokeWidth={current ? 14 : 10} strokeOpacity={placed.message.highlight && !placed.message.change ? 0.7 : current ? 0.55 : 0.35} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
      <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={kind === 'return' || removed ? '10 8' : undefined} strokeLinejoin="round" />
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
  const mark = messageMark(placed.message);
  const removed = placed.message.change === 'removed';
  const shift = label.align === 'center' ? 'translate(-50%, -100%)' : label.align === 'right' ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
  const placement: React.CSSProperties = {
    position: 'absolute',
    left: label.x,
    top: label.y,
    transform: `${shift} scale(${0.94 + 0.06 * appear})`,
    transformOrigin: label.align === 'center' ? '50% 100%' : label.align === 'right' ? '100% 50%' : '0 50%',
    opacity: appear,
    maxWidth: label.maxWidth,
  };
  const box: React.CSSProperties = {
    boxSizing: 'border-box',
    padding: '2px 11px',
    borderRadius: 8,
    background: mark?.labelBg ?? '#0d0f16',
    border: `1px solid ${mark?.stroke ?? (current ? 'rgba(255,255,255,0.32)' : colors.border)}`,
    boxShadow: current || (placed.message.highlight && !placed.message.change) ? `0 0 22px ${mark && !removed ? mark.glow : 'rgba(255,255,255,0.12)'}` : undefined,
    color: mark?.labelText ?? (kind === 'return' ? colors.muted : colors.text),
    textDecoration: removed ? 'line-through' : undefined,
    textDecorationColor: colors.del,
    fontFamily: fonts.mono,
    fontSize: label.fontSize,
    fontWeight: current ? 650 : 500,
    lineHeight: LABEL_LINE_HEIGHT,
    textAlign: label.align === 'right' ? 'right' : label.align === 'left' ? 'left' : 'center',
    whiteSpace: 'pre',
    overflow: 'hidden',
  };
  const lines = label.lines.map((line, i) => <div key={i}>{line}</div>);
  const badges = badgesOf(placed.message);
  if (!badges.length) return <div style={{ ...placement, ...box }}>{lines}</div>;
  // The label clips its text, so the badges sit on a wrapper of the same size.
  return (
    <div style={placement}>
      <div style={box}>{lines}</div>
      <CornerBadges badges={badges} size={13} top={-15} right={10} />
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
        fontSize: 18,
        lineHeight: 1.3,
      }}
    >
      <StickyNote size={17} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 3, color: '#fbbf24' }} />
      <span style={{ minWidth: 0, ...(note.lines === 1 ? ellipsis : clampLines(2)) }}>{placed.message.note}</span>
    </div>
  );
};

/** The y down to which activation bars are revealed: the arrow of the latest message that has landed. */
function revealFront(layout: SequenceLayout, starts: number[], drawFrames: number, frame: number): number {
  const ys = layout.messages.map((m) => m.points[m.points.length - 1]!.y);
  if (!ys.length) return 0;
  const input = starts.map((s) => s + drawFrames);
  const lastEnd = input[input.length - 1]!;
  return interpolate(frame, [...input, lastEnd + 8], [...ys, layout.height], clamp);
}

/**
 * Messages each step lights, and the last message drawn by the end of each step: a step draws every message
 * up to the last one it or an earlier step focuses, and the last step also draws and lights any after.
 */
function messageSteps(scene: SequenceScene, count: number): { lasts: number[]; lit: Set<number>[] } {
  const focused = stepTargets(scene).map((keys) => keys.flatMap((key) => (key.startsWith('m:') ? [Number(key.slice(2))] : [])));
  let reach = -1;
  const lasts = focused.map((ms) => (reach = Math.max(reach, ...ms)));
  const lit = focused.map((ms, k) => {
    const set = new Set(ms);
    if (k === focused.length - 1) for (let i = Math.max(-1, ...ms, k > 0 ? lasts[k - 1]! : -1) + 1; i < count; i++) set.add(i);
    return set;
  });
  return { lasts, lit };
}

export const SequenceDiagram: React.FC<SceneProps<SequenceScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutSequence(scene.participants, scene.messages, box), [scene.participants, scene.messages, box.width, box.height]);
  // Without steps every message draws in before the voice; with them, each step's messages draw with its words.
  const count = layout.messages.length;
  const steps = useMemo(() => messageSteps(scene, count), [scene, count]);
  const starts = revealStarts(segments, count, steps.lasts, MESSAGES_START, buildFrames('sequence') - MESSAGE_FRAMES, STEP_STAGGER);
  const step = currentStep(segments, frame);
  const litSet = step < 0 ? null : steps.lit[step]!;
  const isLit = (i: number) => litSet !== null && litSet.has(i);
  const lit: [number, number] | null = litSet?.size ? [Math.min(...litSet), Math.max(...litSet)] : null;
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  const front = revealFront(layout, starts, DRAW_FRAMES, frame);
  const lifeline = interpolate(frame, [LIFELINE_START, LIFELINE_START + LIFELINE_FRAMES], [0, 1], clamp);
  const headerStagger = Math.min(5, (HEADERS_END - HEADER_START) / Math.max(1, layout.participants.length - 1));
  const scale = Math.min(1, box.width / layout.width, box.height / layout.height);
  const marks = useMemo(() => staged(sequenceBoxes(layout), centredStage(box, layout, scale), box), [layout, box.width, box.height, scale]);

  return (
    <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.sequence} title={scene.title}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height, transform: `scale(${scale})`, flexShrink: 0 }}>
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            {lit ? (
              <rect
                x={-12}
                y={layout.messages[lit[0]]!.top}
                width={layout.width + 24}
                height={layout.messages[lit[1]]!.bottom - layout.messages[lit[0]]!.top}
                rx={12}
                fill={layout.messages.slice(lit[0], lit[1] + 1).some((m) => m.message.change === 'modified') ? 'rgba(124,140,255,0.07)' : 'rgba(255,255,255,0.035)'}
                opacity={interpolate(frame, [starts[lit[0]]!, starts[lit[0]]! + DRAW_FRAMES], [0, 1], clamp)}
              />
            ) : null}
            {layout.participants.map((p) => (
              <line
                key={p.participant.id}
                x1={p.x}
                x2={p.x}
                y1={layout.lifelineTop}
                y2={layout.lifelineTop + (layout.height - layout.lifelineTop) * lifeline}
                stroke={nodeMark(p.participant)?.color ?? 'rgba(255,255,255,0.22)'}
                strokeOpacity={nodeMark(p.participant) ? 0.45 : 1}
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
                current={isLit(i)}
                draw={interpolate(frame, [starts[i]!, starts[i]! + DRAW_FRAMES], [0, 1], clamp)}
              />
            ))}
          </svg>
          {layout.participants.map((p, i) => (
            <NodeCard
              key={p.participant.id}
              node={p.participant}
              x={p.x - layout.cardW / 2}
              y={layout.cardTop}
              width={layout.cardW}
              height={CARD_H}
              size={layout.cardW < 290 ? 'compact' : 'small'}
              emphasis={{ ...emphasisOf(`p:${p.participant.id}`), opacity: 1 }}
              appear={spring({ frame: frame - HEADER_START - i * headerStagger, fps, config: { damping: 16, stiffness: 110 } })}
            />
          ))}
          {layout.messages.map((m, i) => {
            const appear = interpolate(frame, [starts[i]! + DRAW_FRAMES * 0.5, starts[i]! + MESSAGE_FRAMES], [0, 1], clamp);
            return (
              <div key={i}>
                <MessageLabel placed={m} appear={appear} current={isLit(i)} />
                {m.note ? <NoteCard placed={m} appear={appear} /> : null}
              </div>
            );
          })}
        </div>
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={() => marks} />
    </SceneShell>
  );
};
