import { StickyNote } from 'lucide-react';
import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildFrames } from '../../shared/timing.mjs';
import { stepTargets } from '../../shared/targets.mjs';
import type { MessageKind, SequenceMessage, SequenceScene } from '../types';
import {
  BAR_W,
  CARD_H,
  layoutSequence,
  type PlacedMessage,
  type Pt,
  type SequenceLayout,
  sequenceBoxes,
  sequenceScale,
} from '../utils/sequenceLayout';
import { centredStage, staged, type MarkTargets, type Stage } from '../utils/penGeometry';
import { sequenceCamera } from '../utils/sequenceCamera';
import { markedKeys } from '../../shared/pen-marks.mjs';
import type { FocusStep } from '../types';
import { PenMarks } from './PenMarks';
import { currentStep, focusSpotlight, revealStarts } from '../utils/spotlight';
import { SceneShell } from './SceneShell';
import { badgesOf, CornerBadges, EMPHASIS } from './marks';
import { NodeCard, nodeMark } from './NodeCard';
import type { SceneProps } from './sceneProps';
import { FitText } from './FitText';
import { clamp, colors, contentBox } from './theme';

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
function messageMark(
  message: SequenceMessage,
): { stroke: string; glow: string; labelBg: string; labelText: string } | null {
  if (message.change === 'modified')
    return { stroke: colors.accent, glow: colors.accentGlow, labelBg: '#141834', labelText: '#cdd3ff' };
  if (message.change === 'added')
    return { stroke: colors.add, glow: 'rgba(61,220,151,0.4)', labelBg: '#10201b', labelText: '#c4f3dd' };
  if (message.change === 'removed')
    return { stroke: colors.del, glow: 'transparent', labelBg: '#1e1216', labelText: colors.muted };
  return message.highlight
    ? { stroke: EMPHASIS.color, glow: EMPHASIS.glow, labelBg: '#1f2026', labelText: colors.text }
    : null;
}

const headPath: Record<MessageKind, string> = {
  call: `M 0 0 L ${-HEAD} ${-HEAD * 0.5} L ${-HEAD} ${HEAD * 0.5} Z`,
  return: `M ${-HEAD} ${-HEAD * 0.55} L 0 0 L ${-HEAD} ${HEAD * 0.55}`,
  async: `M ${-HEAD} ${-HEAD * 0.6} L 0 0`,
};

const MessageArrow: React.FC<{ placed: PlacedMessage; draw: number; current: boolean }> = ({
  placed,
  draw,
  current,
}) => {
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
        <path
          d={d}
          fill="none"
          stroke={mark.glow}
          strokeWidth={current ? 14 : 10}
          strokeOpacity={placed.message.highlight && !placed.message.change ? 0.7 : current ? 0.55 : 0.35}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={kind === 'return' || removed ? '10 8' : undefined}
        strokeLinejoin="round"
      />
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

const MessageLabel: React.FC<{ placed: PlacedMessage; appear: number; current: boolean }> = ({
  placed,
  appear,
  current,
}) => {
  const { label, kind } = placed;
  const mark = messageMark(placed.message);
  const removed = placed.message.change === 'removed';
  const shift =
    label.align === 'center'
      ? 'translate(-50%, -100%)'
      : label.align === 'right'
        ? 'translate(-100%, -50%)'
        : 'translate(0, -50%)';
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
    boxShadow:
      current || (placed.message.highlight && !placed.message.change)
        ? `0 0 22px ${mark && !removed ? mark.glow : 'rgba(255,255,255,0.12)'}`
        : undefined,
    color: mark?.labelText ?? (kind === 'return' ? colors.muted : colors.text),
    textDecoration: removed ? 'line-through' : undefined,
    textDecorationColor: colors.del,
  };
  const lines = (
    <FitText
      fit={label.text}
      weight={current ? 650 : 500}
      align={label.align === 'right' ? 'right' : label.align === 'left' ? 'left' : 'center'}
    />
  );
  const badges = badgesOf(placed.message);
  if (!badges.length) return <div style={{ ...placement, ...box }}>{lines}</div>;
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
      }}
    >
      <StickyNote size={17} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 3, color: '#fbbf24' }} />
      <FitText fit={note.text} />
    </div>
  );
};

/** A layer that adds nothing: the scene draws as it did before it could scroll. */
const CONTENTS: React.CSSProperties = { display: 'contents' };

/** Room under the participants where scrolled messages fade out rather than meet the cards. */
const FADE = 28;

/**
 * The scrolling messages' window: everything below the participants, fading at the top edge, and at the
 * bottom edge while more of the sequence lies below.
 */
function scrollClip(top: number, viewH: number, scroll: number, height: number): React.CSSProperties {
  const more = scroll < height - viewH - 1;
  const mask = `linear-gradient(to bottom, transparent ${top}px, #000 ${top + FADE}px, #000 ${more ? viewH - FADE : viewH}px, ${more ? 'transparent' : '#000'} ${viewH}px)`;
  return { position: 'absolute', inset: 0, overflow: 'hidden', maskImage: mask, WebkitMaskImage: mask };
}

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
  const focused = stepTargets(scene).map((keys) =>
    keys.flatMap((key) => (key.startsWith('m:') ? [Number(key.slice(2))] : [])),
  );
  let reach = -1;
  const lasts = focused.map((ms) => (reach = Math.max(reach, ...ms)));
  const lit = focused.map((ms, k) => {
    const set = new Set(ms);
    if (k === focused.length - 1)
      for (let i = Math.max(-1, ...ms, k > 0 ? lasts[k - 1]! : -1) + 1; i < count; i++) set.add(i);
    return set;
  });
  return { lasts, lit };
}

export const SequenceDiagram: React.FC<SceneProps<SequenceScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = contentBox(Boolean(scene.title));
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new box object comes each render; the layout depends only on its size
  const layout = useMemo(
    () => layoutSequence(scene.participants, scene.messages, box),
    [scene.participants, scene.messages, box.width, box.height],
  );
  // Without steps every message draws in before the voice; with them, each step's messages draw with its words.
  const count = layout.messages.length;
  const steps = useMemo(() => messageSteps(scene, count), [scene, count]);
  const starts = revealStarts(
    segments,
    count,
    steps.lasts,
    MESSAGES_START,
    buildFrames('sequence') - MESSAGE_FRAMES,
    STEP_STAGGER,
    MESSAGE_FRAMES,
  );
  const step = currentStep(segments, frame);
  const litSet = step < 0 ? null : steps.lit[step]!;
  const isLit = (i: number) => litSet !== null && litSet.has(i);
  const lit: [number, number] | null = litSet?.size ? [Math.min(...litSet), Math.max(...litSet)] : null;
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  const front = revealFront(layout, starts, DRAW_FRAMES, frame);
  const lifeline = interpolate(frame, [LIFELINE_START, LIFELINE_START + LIFELINE_FRAMES], [0, 1], clamp);
  const headerStagger = Math.min(5, (HEADERS_END - HEADER_START) / Math.max(1, layout.participants.length - 1));
  const scale = sequenceScale(layout, box);
  const camera = useMemo(
    () => sequenceCamera(layout, steps.lit, segments, box.height / scale),
    [layout, steps.lit, segments, box.height, scale],
  );
  const scroll = camera.scrollAt(frame);
  const stage: Stage = camera.scrolls
    ? { left: (box.width - layout.width * scale) / 2, top: 0, scale }
    : centredStage(box, layout, scale);
  const boxes = useMemo(() => sequenceBoxes(layout), [layout]);
  // Marks on messages scroll with them: placed where step k's camera settles, then carried along while it moves.
  const markTargets = (k: number): MarkTargets => {
    const stop = camera.stops[k] ?? 0;
    const onMessages = scene.steps?.[k]
      ? markedKeys(scene, scene.steps[k] as FocusStep, hunks).some((key) => key.startsWith('m:'))
      : false;
    const moved = {
      ...boxes,
      boxes: new Map([...boxes.boxes].map(([key, b]) => [key, key.startsWith('m:') ? { ...b, y: b.y - stop } : b])),
      obstacles: boxes.obstacles?.map((b) => (b.y >= layout.lifelineTop ? { ...b, y: b.y - stop } : b)),
    };
    const targets = staged(moved, stage, box);
    return onMessages ? { ...targets, shift: { x: 0, y: (stop - scroll) * scale } } : targets;
  };

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} camera={{ hunks, segments, targets: markTargets }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: camera.scrolls ? 'flex-start' : 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: layout.width,
            height: camera.scrolls ? camera.viewH : layout.height,
            transform: `scale(${scale})`,
            transformOrigin: camera.scrolls ? 'top center' : undefined,
            flexShrink: 0,
          }}
        >
          <div style={camera.scrolls ? scrollClip(layout.lifelineTop, camera.viewH, scroll, layout.height) : CONTENTS}>
            <div
              style={
                camera.scrolls
                  ? {
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: layout.width,
                      height: layout.height,
                      transform: `translateY(${-scroll}px)`,
                    }
                  : CONTENTS
              }
            >
              <svg
                width={layout.width}
                height={layout.height}
                style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
              >
                {lit ? (
                  <rect
                    x={-12}
                    y={layout.messages[lit[0]]!.top}
                    width={layout.width + 24}
                    height={layout.messages[lit[1]]!.bottom - layout.messages[lit[0]]!.top}
                    rx={12}
                    fill={
                      layout.messages.slice(lit[0], lit[1] + 1).some((m) => m.message.change === 'modified')
                        ? 'rgba(124,140,255,0.07)'
                        : 'rgba(255,255,255,0.035)'
                    }
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
              {layout.messages.map((m, i) => {
                const appear = interpolate(
                  frame,
                  [starts[i]! + DRAW_FRAMES * 0.5, starts[i]! + MESSAGE_FRAMES],
                  [0, 1],
                  clamp,
                );
                return (
                  <div key={i}>
                    <MessageLabel placed={m} appear={appear} current={isLit(i)} />
                    {m.note ? <NoteCard placed={m} appear={appear} /> : null}
                  </div>
                );
              })}
            </div>
          </div>
          {layout.participants.map((p, i) => (
            <NodeCard
              key={p.participant.id}
              node={p.participant}
              x={p.x - layout.cardW / 2}
              y={layout.cardTop}
              width={layout.cardW}
              height={CARD_H}
              size={layout.cardW < 290 ? 'compact' : 'small'}
              text={layout.texts.get(p.participant.id)!}
              emphasis={{ ...emphasisOf(`p:${p.participant.id}`), opacity: 1 }}
              appear={spring({
                frame: frame - HEADER_START - i * headerStagger,
                fps,
                config: { damping: 16, stiffness: 110 },
              })}
            />
          ))}
        </div>
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={markTargets} />
    </SceneShell>
  );
};
