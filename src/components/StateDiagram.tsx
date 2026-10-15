import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { targetSteps } from '../../shared/targets.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import type { Change, StateScene, StateTransition } from '../types';
import {
  ARROW_LEN,
  BADGE_FONT,
  layoutState,
  type PlacedState,
  type Pt,
  type RoutedTransition,
  type StateLayout,
  stateBoxes,
} from '../utils/stateLayout';
import { centredStage, staged } from '../utils/penGeometry';
import { PenMarks } from './PenMarks';
import { focusSpotlight, asBrightAs, type Emphasis } from '../utils/spotlight';
import type { SpokenSegment } from '../utils/timing';
import { ChangeLegend } from './ChangeLegend';
import { Badge, badgesOf, changeTone, CornerBadges, EMPHASIS, emphasisRing } from './marks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { FitText } from './FitText';
import { clamp, colors, contentBox } from './theme';

const EDGE = 'rgba(170, 178, 200, 0.7)';
const START = 8;
const STATES_END = 20;
const TRANSITION_FRAMES = 12;

const toneColor = ({ change, highlight }: StateTransition) => (change ? changeTone[change].color : highlight ? EMPHASIS.color : EDGE);

/** Frames at which each part of the scene arrives; all of it inside the build. */
interface Timeline {
  entryAt: number;
  stateAt: Map<string, number>;
  transitionAt: (index: number) => number;
  /** Pulse moments of each focused item, keyed `s:${id}` or `t:${index}`: one per step that lights it. */
  pulseAt: Map<string, number[]>;
}

function buildTimeline(scene: StateScene, layout: StateLayout, segments: readonly SpokenSegment[]): Timeline {
  const { states, transitions, layerOf } = layout;
  const stateOrder = [...states].sort((a, b) => a.layer - b.layer || a.row - b.row);
  const stateStart = START + (layout.entry ? 4 : 0);
  const stateStagger = Math.min(7, (STATES_END - stateStart) / Math.max(1, states.length - 1));
  const stateAt = new Map(stateOrder.map((p, i) => [p.state.id, stateStart + i * stateStagger]));

  const span = (t: RoutedTransition) => [layerOf.get(t.transition.from)!, layerOf.get(t.transition.to)!];
  const transitionOrder = transitions
    .map((_, i) => i)
    .sort((a, b) => Math.min(...span(transitions[a]!)) - Math.min(...span(transitions[b]!)) || Math.max(...span(transitions[a]!)) - Math.max(...span(transitions[b]!)));
  const transitionRank = new Map(transitionOrder.map((t, i) => [t, i]));
  const transitionsStart = STATES_END + 4;
  const transitionStagger = Math.min(5, (buildFrames('state') - transitionsStart - TRANSITION_FRAMES - 4) / Math.max(1, transitions.length - 1));

  return {
    entryAt: START,
    stateAt,
    transitionAt: (index) => transitionsStart + transitionRank.get(index)! * transitionStagger,
    pulseAt: new Map([...targetSteps(scene)].map(([key, steps]) => [key, steps.map((k) => segments[k + 1]?.from ?? 0)])),
  };
}

const pulseOf = (frame: number, ats: readonly number[] = []) => Math.max(0, ...ats.map((at) => interpolate(frame, [at, at + 7, at + 32], [0, 1, 0], clamp)));

function arrowHead(tip: Pt, dir: Pt): string {
  const base = { x: tip.x - dir.x * (ARROW_LEN + 1), y: tip.y - dir.y * (ARROW_LEN + 1) };
  const half = 7;
  return `M ${tip.x} ${tip.y} L ${base.x - dir.y * half} ${base.y + dir.x * half} L ${base.x + dir.y * half} ${base.y - dir.x * half} Z`;
}

const StateCard: React.FC<{ placed: PlacedState; start: number; pulseAt: readonly number[] | undefined; emphasis: Emphasis; frame: number }> = ({ placed, start, pulseAt, emphasis, frame }) => {
  const { state } = placed;
  const { fps } = useVideoConfig();
  const appear = spring({ frame: frame - start, fps, config: { damping: 16, stiffness: 110 } });
  const badgeScale = spring({ frame: frame - start - 10, fps, config: { damping: 12, stiffness: 160 } });
  const pulse = pulseOf(frame, pulseAt);
  const removed = state.change === 'removed';
  const tone = state.change ? changeTone[state.change] : null;
  const highlight = state.highlight && !state.change;
  const border = removed ? `${colors.del}cc` : tone?.color ?? (highlight ? EMPHASIS.color : colors.borderStrong);
  const badges = badgesOf(state);
  const glow =
    tone && !removed ? `0 0 0 6px ${tone.bg}, 0 0 ${40 + 30 * pulse}px ${tone.color}${removed ? '33' : '55'}` : highlight ? emphasisRing(6, 44) : '0 14px 36px rgba(0,0,0,0.45)';
  const ring = tone ? `, 0 0 0 ${4 + 10 * pulse}px ${tone.color}${Math.round(pulse * 140).toString(16).padStart(2, '0')}` : '';
  const inner = state.final ? `inset 0 0 0 5px ${colors.raised}, inset 0 0 0 7px ${border}` : '';
  const lit = emphasis.glow > 0 ? `0 0 0 ${4 * emphasis.glow}px ${colors.accent}, 0 0 ${40 * emphasis.glow}px ${colors.accentGlow}` : '';

  return (
    <div
      style={{
        position: 'absolute',
        left: placed.x,
        top: placed.y,
        width: placed.w,
        height: placed.h,
        boxSizing: 'border-box',
        borderRadius: placed.h / 2,
        background:
          state.change === 'modified' ? 'linear-gradient(180deg, #1c2033, #151826)' : state.change === 'added' ? 'linear-gradient(180deg, #14231f, #121a1a)' : highlight ? EMPHASIS.card : colors.raised,
        border: `2px ${removed ? 'dashed' : 'solid'} ${border}`,
        boxShadow: [glow + ring, lit, inner].filter(Boolean).join(', '),
        opacity: appear * (removed ? 0.62 : 1) * emphasis.opacity,
        transform: `translateY(${(1 - appear) * 20}px) scale(${(0.9 + 0.1 * appear) * (1 + 0.05 * pulse)})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: '0 26px',
      }}
    >
      <FitText
        fit={placed.label}
        align="center"
        style={{
          color: removed ? colors.muted : colors.text,
          textDecoration: removed ? 'line-through' : 'none',
          textDecorationColor: colors.del,
          textDecorationThickness: 3,
          flexShrink: 0,
          lineHeight: placed.label.lines.length > 1 ? undefined : 'normal',
        }}
      />
      {badges.map((b, i) => (
        <Badge key={i} badge={b} size={BADGE_FONT} style={{ transform: `scale(${badgeScale})` }} />
      ))}
    </div>
  );
};

const TransitionPath: React.FC<{ routed: RoutedTransition; index: number; draw: number; pulse: number; emphasis: Emphasis }> = ({ routed, index, draw, pulse, emphasis }) => {
  const { transition } = routed;
  const change = transition.change;
  const color = toneColor(transition);
  const removed = change === 'removed';
  const steady = change ? (removed ? 0.1 : 0.22) : transition.highlight ? 0.22 : 0;
  const id = `state-reveal-${index}`;
  return (
    <g opacity={draw > 0 ? (removed ? 0.78 : 1) * emphasis.opacity : 0}>
      <mask id={id} maskUnits="userSpaceOnUse">
        <path d={routed.d} fill="none" stroke="#fff" strokeWidth={14} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
      </mask>
      {steady > 0 || emphasis.glow > 0 ? (
        <path
          d={routed.d}
          fill="none"
          stroke={change || transition.highlight ? color : colors.accent}
          strokeOpacity={steady + 0.45 * Math.max(pulse, emphasis.glow * 0.6)}
          strokeWidth={10 + 8 * pulse}
          strokeLinecap="round"
          strokeLinejoin="round"
          mask={`url(#${id})`}
        />
      ) : null}
      <path
        d={routed.d}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={removed ? '10 9' : undefined}
        mask={`url(#${id})`}
      />
      <path d={arrowHead(routed.tip, routed.dir)} fill={color} stroke={color} strokeWidth={1.5} strokeLinejoin="round" opacity={interpolate(draw, [0.85, 1], [0, 1], clamp)} />
    </g>
  );
};

const TransitionLabel: React.FC<{ routed: RoutedTransition; appear: number; pulse: number; emphasis: Emphasis }> = ({ routed, appear, pulse, emphasis }) => {
  const { label, transition } = routed;
  if (!label) return null;
  const change = transition.change;
  const highlight = transition.highlight && !change;
  const color = change || highlight ? toneColor(transition) : colors.muted;
  return (
    <div
      style={{
        position: 'absolute',
        left: label.x,
        top: label.y,
        width: label.w,
        height: label.h,
        boxSizing: 'border-box',
        transform: `translate(-50%, -50%) scale(${(0.9 + 0.1 * appear) * (1 + 0.12 * pulse)})`,
        opacity: appear * (change === 'removed' ? 0.85 : 1) * emphasis.opacity,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 12px',
        borderRadius: 10,
        background: '#0d0f16',
        border: `1px solid ${change || highlight ? `${color}99` : colors.borderStrong}`,
        boxShadow: pulse > 0 ? `0 0 ${24 * pulse}px ${color}88` : highlight ? `0 0 18px ${EMPHASIS.glow}` : 'none',
        color,
        textDecoration: change === 'removed' ? 'line-through' : 'none',
      }}
    >
      <FitText fit={label.text} align="center" />
      <CornerBadges badges={badgesOf(transition, { change: false })} size={12} top={-19} right={-4} />
    </div>
  );
};

function usedChanges(scene: StateScene): Set<Change> {
  const used = new Set<Change>();
  for (const s of scene.states) if (s.change) used.add(s.change);
  for (const t of scene.transitions) if (t.change) used.add(t.change);
  return used;
}

export const StateDiagram: React.FC<SceneProps<StateScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useMemo(() => layoutState(scene.states, scene.transitions, scene.initial), [scene.states, scene.transitions, scene.initial]);
  const timeline = useMemo(() => buildTimeline(scene, layout, segments), [scene, layout, segments]);
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  const box = contentBox(Boolean(scene.title));
  const scale = Math.min(box.width / layout.width, box.height / layout.height, 1.25);
  const marks = useMemo(() => staged(stateBoxes(layout), centredStage(box, layout, scale), box), [layout, box.width, box.height, scale]);
  const draws = layout.transitions.map((_, i) =>
    interpolate(frame, [timeline.transitionAt(i), timeline.transitionAt(i) + TRANSITION_FRAMES], [0, 1], clamp),
  );
  const entryAppear = spring({ frame: frame - timeline.entryAt, fps, config: { damping: 14, stiffness: 140 } });
  const entryDraw = interpolate(frame, [timeline.entryAt + 4, timeline.entryAt + 14], [0, 1], clamp);

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} aside={<ChangeLegend used={usedChanges(scene)} />}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height, transform: `scale(${scale})`, flexShrink: 0 }}>
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            {layout.entry ? (
              <g>
                <circle cx={layout.entry.dot.x} cy={layout.entry.dot.y} r={12 * entryAppear} fill={colors.text} />
                <path d={layout.entry.d} fill="none" stroke={colors.text} strokeWidth={3} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - entryDraw} />
                <path d={arrowHead(layout.entry.tip, layout.entry.dir)} fill={colors.text} opacity={interpolate(entryDraw, [0.8, 1], [0, 1], clamp)} />
              </g>
            ) : null}
            {layout.transitions.map((routed, i) => (
              <TransitionPath key={i} routed={routed} index={i} draw={draws[i]!} pulse={pulseOf(frame, timeline.pulseAt.get(`t:${i}`))} emphasis={emphasisOf(`t:${i}`)} />
            ))}
          </svg>
          {layout.states.map((placed) => (
            <StateCard
              key={placed.state.id}
              placed={placed}
              frame={frame}
              start={timeline.stateAt.get(placed.state.id)!}
              pulseAt={timeline.pulseAt.get(`s:${placed.state.id}`)}
              emphasis={asBrightAs(emphasisOf(`s:${placed.state.id}`), scene.transitions.flatMap((t, i) => (t.from === placed.state.id || t.to === placed.state.id ? [emphasisOf(`t:${i}`)] : [])))}
            />
          ))}
          {layout.transitions.map((routed, i) => (
            <TransitionLabel key={i} routed={routed} appear={interpolate(draws[i]!, [0.55, 1], [0, 1], clamp)} pulse={pulseOf(frame, timeline.pulseAt.get(`t:${i}`))} emphasis={emphasisOf(`t:${i}`)} />
          ))}
        </div>
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={() => marks} />
    </SceneShell>
  );
};
