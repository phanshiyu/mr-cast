import { Box, Database, Layers, Monitor, Server, StickyNote, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { indexRange } from '../../shared/steps.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import type { MessageKind, NodeKind, SequenceScene } from '../types';
import {
  BAR_W,
  CARD_H,
  LABEL_LINE_HEIGHT,
  layoutSequence,
  type PlacedMessage,
  type PlacedParticipant,
  type Pt,
  type SequenceLayout,
} from '../utils/sequenceLayout';
import { currentStep, revealStarts } from '../utils/spotlight';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, clampLines, colors, contentBox, defaultChapter, ellipsis, fonts } from './theme';

const kindIcon: Record<NodeKind, LucideIcon> = { service: Server, db: Database, queue: Layers, client: Monitor };
const kindLabel: Record<NodeKind, string> = { service: 'service', db: 'datastore', queue: 'queue', client: 'client' };

const HEADER_START = 6;
const HEADERS_END = 14;
const LIFELINE_START = 12;
const LIFELINE_FRAMES = 16;
const MESSAGES_START = 20;
const DRAW_FRAMES = 10;
/** Frames from a message's start until its label has faded in. */
const MESSAGE_FRAMES = DRAW_FRAMES * 1.2;
/** Frames between the messages one step reveals. */
const STEP_STAGGER = 4;
const HEAD = 14;

const neutralStroke = '#c4cad8';
const returnStroke = 'rgba(170, 178, 200, 0.62)';
const noteAmber = 'rgba(251, 191, 36, 0.45)';

/** Sans advance per em, rounded up from SF Pro semibold so estimates err towards smaller text. */
const SANS_ADVANCE = 0.58;

/** Break opportunities at spaces and camelCase or punctuation boundaries: "PaymentProvider|Client". */
function labelTokens(label: string): string[] {
  return label.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[\s:._/-])/).filter(Boolean);
}

/** Lines a greedy browser-style wrap of `tokens` takes at `fontSize` in `width`. */
function wrappedLines(tokens: readonly string[], fontSize: number, width: number): number {
  let lines = 1;
  let used = 0;
  for (const token of tokens) {
    const w = token.length * SANS_ADVANCE * fontSize;
    const fit = used + token.trimEnd().length * SANS_ADVANCE * fontSize <= width;
    if (used > 0 && !fit) {
      lines += 1;
      used = w;
    } else used += w;
  }
  return lines;
}

/** Title font for a participant card: one line down to 20px, then two lines, never splitting a token. */
function titleFit(label: string, width: number): { fontSize: number; twoLines: boolean } {
  const tokens = labelTokens(label);
  for (let fontSize = 25; fontSize >= 20; fontSize--) {
    if (wrappedLines(tokens, fontSize, width) === 1) return { fontSize, twoLines: false };
  }
  for (let fontSize = 25; fontSize > 15; fontSize--) {
    const lines = wrappedLines(tokens, fontSize, width);
    if (lines <= 2) return { fontSize, twoLines: lines === 2 };
  }
  return { fontSize: 15, twoLines: true };
}

const ParticipantCard: React.FC<{ placed: PlacedParticipant; width: number; top: number; appear: number }> = ({ placed, width, top, appear }) => {
  const { participant } = placed;
  const Icon = participant.kind ? kindIcon[participant.kind] : Box;
  const modified = participant.modified;
  const compact = width < 290;
  const icon = compact ? 40 : 48;
  const pad = compact ? 14 : 16;
  const gap = compact ? 12 : 14;
  const title = titleFit(participant.label, width - 2 * pad - icon - gap - 4);
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
        gap,
        padding: `0 ${pad}px`,
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
          width: icon,
          height: icon,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: modified ? colors.accentSoft : 'rgba(255,255,255,0.05)',
          color: modified ? colors.accent : colors.muted,
          flexShrink: 0,
        }}
      >
        <Icon size={icon * 0.55} strokeWidth={2} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: title.fontSize, fontWeight: 650, lineHeight: 1.15, color: colors.text, overflowWrap: 'anywhere', ...clampLines(2) }}>
          {labelTokens(participant.label).map((token, i) => (
            <span key={i}>
              {i > 0 ? <wbr /> : null}
              {token}
            </span>
          ))}
        </div>
        {title.twoLines ? null : (
          <div style={{ fontSize: 17, color: colors.faint, marginTop: 3, ...ellipsis }}>
            {participant.kind ? kindLabel[participant.kind] : 'participant'}
          </div>
        )}
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
        lineHeight: LABEL_LINE_HEIGHT,
        textAlign: label.align === 'right' ? 'right' : label.align === 'left' ? 'left' : 'center',
        whiteSpace: 'pre',
        overflow: 'hidden',
      }}
    >
      {label.lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
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

export const SequenceDiagram: React.FC<SceneProps<SequenceScene>> = ({ scene, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutSequence(scene.participants, scene.messages, box), [scene.participants, scene.messages, box.width, box.height]);
  // Without steps every message draws in before the voice; with them, each step's messages draw with its words.
  const ranges = (scene.steps ?? []).map((step): [number, number] => indexRange(step.messages) ?? [0, 0]);
  const count = layout.messages.length;
  const starts = revealStarts(segments, count, ranges.map(([, last]) => last), MESSAGES_START, buildFrames('sequence') - MESSAGE_FRAMES, STEP_STAGGER);
  const step = currentStep(segments, frame);
  const lit: [number, number] | null = step < 0 ? null : [ranges[step]![0], step === ranges.length - 1 ? count - 1 : ranges[step]![1]];
  const isLit = (i: number) => lit !== null && i >= lit[0] && i <= lit[1];
  const front = revealFront(layout, starts, DRAW_FRAMES, frame);
  const lifeline = interpolate(frame, [LIFELINE_START, LIFELINE_START + LIFELINE_FRAMES], [0, 1], clamp);
  const headerStagger = Math.min(5, (HEADERS_END - HEADER_START) / Math.max(1, layout.participants.length - 1));
  const scale = Math.min(1, box.width / layout.width, box.height / layout.height);

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
                fill={layout.messages.slice(lit[0], lit[1] + 1).some((m) => m.message.modified) ? 'rgba(124,140,255,0.07)' : 'rgba(255,255,255,0.035)'}
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
                current={isLit(i)}
                draw={interpolate(frame, [starts[i]!, starts[i]! + DRAW_FRAMES], [0, 1], clamp)}
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
    </SceneShell>
  );
};
