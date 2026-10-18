import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { isPointer, sceneStates } from '../../shared/state-steps.mjs';
import { splitMemberKey } from '../../shared/targets.mjs';
import type { Fit } from '../../shared/textfit.mjs';
import type { MemoryScene } from '../types';
import { HEAD_H, ROW_H, arrowsOf, layoutMemory, valueBox, type Arrow, type MemoryCard, type MemoryLayout } from '../utils/memoryLayout';
import { centredStage, type Pt } from '../utils/penGeometry';
import { asBrightAs, brighter, focusSpotlight, type Emphasis } from '../utils/spotlight';
import { shownOf, stateFrame, valueChanged, type StateFrame } from '../utils/stateTrack';
import { FitText } from './FitText';
import { PenMarks } from './PenMarks';
import { memoryTargets } from '../utils/sceneTargets';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { headerBox } from '../fit/shell';
import { HeaderCallout } from './HeaderCallout';
import { clamp, colors } from './theme';

const START = 6;
/** Frames between cards landing, frames first, then objects. */
const CARD_STAGGER = 4;
/** When the arrows start drawing during the build, and how long they take. */
const ARROWS_AT = 28;
const ARROW_FRAMES = 12;
const ARROW_COLOR = '#aab1c2';
const LIT = 'rgba(242,244,248,';

const hex = (alpha: number) => Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
const shadows = (...parts: string[]) => parts.filter(Boolean).join(', ') || 'none';
const mix = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const mixArrow = (a: Arrow, b: Arrow, t: number): Arrow => ({ points: a.points.map((p, i) => mix(p, b.points[i]!, t)) });
const pathOf = ({ points: [start, ...rest] }: Arrow) => {
  const curves = Array.from({ length: rest.length / 3 }, (_, i) => `C ${rest.slice(3 * i, 3 * i + 3).map((p) => `${p.x} ${p.y}`).join(', ')}`);
  return `M ${start!.x} ${start!.y} ${curves.join(' ')}`;
};

/** A text value in its box, sliding by `shift` (a share of the box's height). */
const Text: React.FC<{ fit: Fit; opacity: number; shift: number }> = ({ fit, opacity, shift }) =>
  opacity > 0 ? (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity, transform: `translateY(${shift * ROW_H}px)` }}>
      <FitText fit={fit} style={{ color: colors.text }} />
    </div>
  ) : null;

/** A reference's dot, where its arrow starts. */
const Dot: React.FC<{ opacity: number; color: string }> = ({ opacity, color }) =>
  opacity > 0 ? <div style={{ position: 'absolute', left: '50%', top: '50%', width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: 7, background: color, opacity }} /> : null;

/** What a value box shows of one value: its text, or its dot for a reference. */
const Content: React.FC<{ value: unknown; layout: MemoryLayout; opacity: number; shift: number; color: string }> = ({ value, layout, opacity, shift, color }) =>
  isPointer(value) ? <Dot opacity={opacity} color={color} /> : <Text fit={layout.values.get(String(value))!} opacity={opacity} shift={shift} />;

const Row: React.FC<{ card: MemoryCard; index: number; layout: MemoryLayout; s: StateFrame; emphasis: Emphasis }> = ({ card, index, layout, s, emphasis }) => {
  const row = card.rows[index]!;
  const changed = valueChanged(s, row.key);
  const lit = changed ? s.lit : 0;
  const box = valueBox(layout, row.key);
  const [was, now] = [s.before.values[row.key], s.now.values[row.key]];
  const dot = emphasis.glow > 0 ? colors.accent : lit > 0 ? colors.text : ARROW_COLOR;
  return (
    <>
      {emphasis.glow > 0 ? (
        <div style={{ position: 'absolute', left: 6, right: 6, top: row.y, height: ROW_H, borderRadius: 10, background: `rgba(124,140,255,${0.14 * emphasis.glow})`, boxShadow: `inset 0 0 0 2px ${colors.accent}${hex(0.8 * emphasis.glow)}` }} />
      ) : null}
      <FitText fit={row.name} style={{ position: 'absolute', left: 18, top: row.y + (ROW_H - row.name.height) / 2, color: emphasis.glow > 0 ? colors.text : colors.muted }} />
      <div
        style={{
          position: 'absolute',
          left: box.x - card.x,
          top: box.y - card.y,
          width: box.width,
          height: box.height,
          boxSizing: 'border-box',
          borderRadius: 8,
          overflow: 'hidden',
          background: `rgba(255,255,255,${0.045 + 0.12 * lit})`,
          border: `1.5px solid ${lit > 0 ? `${LIT}${0.3 + 0.6 * lit})` : colors.border}`,
          boxShadow: lit > 0 ? `0 0 ${30 * lit}px ${LIT}${0.35 * lit})` : undefined,
        }}
      >
        {changed ? (
          <>
            <Content value={was} layout={layout} opacity={1 - s.t} shift={-0.5 * s.t} color={dot} />
            <Content value={now} layout={layout} opacity={s.t} shift={0.5 * (1 - s.t)} color={dot} />
          </>
        ) : (
          <Content value={now} layout={layout} opacity={1} shift={0} color={dot} />
        )}
      </div>
    </>
  );
};

const Card: React.FC<{ card: MemoryCard; layout: MemoryLayout; s: StateFrame; shown: number; emphasis: Emphasis; rowEmphasis: (key: string) => Emphasis }> = ({ card, layout, s, shown, emphasis, rowEmphasis }) => {
  if (shown <= 0) return null;
  const frame = card.column < 0;
  const accent = frame ? colors.accent : '#c9a8ff';
  return (
    <div
      style={{
        position: 'absolute',
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        boxSizing: 'border-box',
        borderRadius: 16,
        background: colors.raised,
        border: `1.5px solid ${emphasis.glow > 0 ? accent : colors.borderStrong}`,
        boxShadow: shadows('0 14px 36px rgba(0,0,0,0.45)', emphasis.glow > 0 ? `0 0 0 ${3 * emphasis.glow}px ${accent}, 0 0 ${40 * emphasis.glow}px ${accent}${hex(0.4 * emphasis.glow)}` : ''),
        opacity: shown * emphasis.opacity,
        transform: `translateY(${(1 - shown) * 20}px) scale(${1 + 0.015 * emphasis.glow})`,
      }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: HEAD_H, borderRadius: '16px 16px 0 0', background: frame ? 'rgba(124,140,255,0.1)' : 'rgba(201,168,255,0.1)', borderBottom: `1px solid ${colors.border}` }} />
      <FitText fit={card.title} style={{ position: 'absolute', left: 18, top: (HEAD_H - card.title.height) / 2, color: accent }} />
      {card.rows.map((r, i) => (
        <Row key={r.key} card={card} index={i} layout={layout} s={s} emphasis={rowEmphasis(r.key)} />
      ))}
    </div>
  );
};

/** Where an arrow is drawn at a frame: between its old and new object while the step re-routes it. */
interface Drawn {
  key: string;
  arrow: Arrow;
  /** How much of it is drawn, 0 to 1, from its dot. */
  progress: number;
  opacity: number;
  target: string;
}

function drawnArrows(layout: MemoryLayout, s: StateFrame, shownOf_: (key: string) => number, ownerOf: (key: string) => string): Drawn[] {
  const before = arrowsOf(layout, s.before);
  const now = arrowsOf(layout, s.now);
  const keys = [...new Set([...before.keys(), ...now.keys()])];
  return keys.flatMap((key) => {
    const [a, b] = [before.get(key), now.get(key)];
    const owner = shownOf_(ownerOf(key));
    const target = (state: typeof s.now) => `o:${(state.values[key] as { ref: string }).ref}`;
    if (a && b) {
      const [ta, tb] = [target(s.before), target(s.now)];
      const seen = shownOf_(ta) * (1 - s.t) + shownOf_(tb) * s.t;
      return [{ key, arrow: mixArrow(a, b, s.t), progress: 1, opacity: owner * (ta === tb ? shownOf_(tb) : Math.max(seen, 0.6)), target: tb }];
    }
    if (b) return [{ key, arrow: b, progress: s.t, opacity: owner * shownOf_(target(s.now)), target: target(s.now) }];
    return [{ key, arrow: a!, progress: 1, opacity: owner * (1 - s.t), target: target(s.before) }];
  });
}

/** An arrow as it is drawn: how much of it, how bright, in which colour. */
interface Styled extends Drawn {
  color: string;
  width: number;
  glow: number;
}

const svgStyle = { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' } as const;

/** An arrow's line, drawn from its dot as far as its progress. */
const Line: React.FC<{ d: Styled }> = ({ d }) => (
  <path
    d={pathOf(d.arrow)}
    fill="none"
    stroke={d.color}
    strokeWidth={d.width}
    strokeLinecap="round"
    pathLength={1}
    strokeDasharray="1 1"
    strokeDashoffset={1 - d.progress}
    style={{ filter: d.glow > 0 ? `drop-shadow(0 0 6px ${colors.accentGlow})` : undefined }}
  />
);

export const MemoryDiagram: React.FC<SceneProps<MemoryScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = headerBox(scene);
  const layout = useMemo(() => layoutMemory(scene, box), [scene, box.width, box.height]);
  const states = useMemo(() => sceneStates(scene), [scene]);
  const stage = centredStage(box, layout, layout.scale);
  const marks = useMemo(() => memoryTargets(scene), [scene]);
  const s = stateFrame(states, segments, frame);
  const focus = focusSpotlight(scene, hunks, segments, frame);

  const order = new Map(layout.cards.map((c, i) => [c.key, i]));
  const landed = (key: string) => spring({ frame: frame - START - order.get(key)! * CARD_STAGGER, fps, config: { damping: 17, stiffness: 130 } });
  const shown = (key: string) => shownOf(s, key) * landed(key);
  const ownerOf = (key: string) => splitMemberKey(key).ownerKey;
  const rowEmphasis = (key: string): Emphasis => brighter(focus(key), focus(ownerOf(key)));
  const arrows = drawnArrows(layout, s, shown, ownerOf);
  const cardEmphasis = (c: MemoryCard): Emphasis =>
    asBrightAs(focus(c.key), [...c.rows.map((r) => focus(r.key)), ...arrows.filter((a) => a.target === c.key).map((a) => rowEmphasis(a.key))]);
  const drawIn = interpolate(frame, [ARROWS_AT, ARROWS_AT + ARROW_FRAMES], [0, 1], clamp);
  const drawn = arrows.flatMap((d): Styled[] => {
    const e = brighter(rowEmphasis(d.key), { ...focus(d.target), opacity: 0 });
    const changed = valueChanged(s, d.key) ? s.lit : 0;
    const styled = {
      ...d,
      progress: d.progress * drawIn,
      opacity: d.opacity * e.opacity,
      color: e.glow > 0 ? colors.accent : changed > 0 ? colors.text : ARROW_COLOR,
      width: 2.5 + 1.5 * Math.max(e.glow, changed),
      glow: e.glow,
    };
    return styled.progress > 0 && styled.opacity > 0 ? [styled] : [];
  });
  const panelIn = interpolate(frame, [START, START + 10], [0, 1], clamp);

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} camera={{ hunks, segments, targets: (k) => marks[k] ?? null }} aside={<HeaderCallout scene={scene} s={s} />}>
      <div style={{ position: 'absolute', left: stage.left, top: stage.top, width: layout.width, height: layout.height, transform: `scale(${layout.scale})`, transformOrigin: 'top left' }}>
        {layout.panels.frames ? <FitText fit={layout.panels.frames} style={{ position: 'absolute', left: 4, top: 4, color: colors.faint, opacity: panelIn }} /> : null}
        {layout.panels.objects ? <FitText fit={layout.panels.objects} style={{ position: 'absolute', left: layout.panels.objectsX + 4, top: 4, color: colors.faint, opacity: panelIn }} /> : null}
        <svg style={svgStyle} width={layout.width} height={layout.height}>
          {drawn.map((d) => (
            <g key={d.key} opacity={d.opacity}>
              <path d={pathOf(d.arrow)} fill="none" stroke={colors.bg} strokeOpacity={0.7} strokeWidth={7} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - d.progress} />
              <Line d={d} />
            </g>
          ))}
        </svg>
        {layout.cards.map((c) => {
          const amount = shown(c.key);
          return amount > 0 ? <div key={`b${c.key}`} style={{ position: 'absolute', left: c.x, top: c.y, width: c.w, height: c.h, borderRadius: 16, background: colors.bg, opacity: amount, transform: `translateY(${(1 - amount) * 20}px)` }} /> : null;
        })}
        {layout.cards.map((c) => (
          <Card key={c.key} card={c} layout={layout} s={s} shown={shown(c.key)} emphasis={cardEmphasis(c)} rowEmphasis={rowEmphasis} />
        ))}
        <svg style={svgStyle} width={layout.width} height={layout.height}>
          {drawn.map((d) => {
            const source = layout.row.get(d.key)!.card;
            const [c2, to] = d.arrow.points.slice(-2) as [Pt, Pt];
            const angle = Math.atan2(to.y - c2.y, to.x - c2.x);
            const head = (side: number) => `${to.x - 14 * Math.cos(angle + side * 0.45)} ${to.y - 14 * Math.sin(angle + side * 0.45)}`;
            const clip = `memory-stub-${d.key.replace(/[^A-Za-z0-9]/g, (c) => c.charCodeAt(0).toString(16))}`;
            return (
              <g key={d.key} opacity={d.opacity}>
                <clipPath id={clip}>
                  <rect x={source.x} y={source.y} width={source.w} height={source.h} />
                </clipPath>
                <g clipPath={`url(#${clip})`}>
                  <Line d={d} />
                </g>
                {d.progress >= 0.98 ? <path d={`M ${head(1)} L ${to.x} ${to.y} L ${head(-1)} Z`} fill={d.color} stroke={d.color} strokeWidth={1.5} strokeLinejoin="round" /> : null}
              </g>
            );
          })}
        </svg>
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={(k) => marks[k] ?? null} />
    </SceneShell>
  );
};
