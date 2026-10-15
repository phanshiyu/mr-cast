import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { targetSteps } from '../../shared/targets.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import type { ChartScene } from '../types';
import { ANNOTATION_BAND, barX, delta, formatValue, layoutChart, type ChartLayout, type Direction } from '../utils/chartLayout';
import { areaOf, union, type Box, type MarkTargets } from '../utils/penGeometry';
import { brighter, focusSpotlight, type Emphasis } from '../utils/spotlight';
import { PenMarks } from './PenMarks';
import { wrapLabel } from '../utils/wrapLabel';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, fonts } from './theme';
import { seriesTone, tones } from './tones';

const START = 10;
const VALUE_FONT = 21;
const BADGE_H = 34;
const directionTone: Record<Direction, { color: string; bg: string }> = { good: tones.good, bad: tones.bad, neutral: tones.accent };

interface Point {
  label: number;
  series: number;
  x: number;
  y: number;
  value: number;
}

/** Frames a bar takes to grow and its value label to land. */
const GROW_FRAMES = 22;
/** Frames after the last line point for its value label to land. */
const LABEL_FRAMES = 12;

/** When each part arrives; all of it inside the build. */
function buildTimeline(scene: ChartScene) {
  const n = scene.labels.length;
  const k = scene.series.length;
  const start = START + 10;
  const end = buildFrames('chart');
  if (scene.kind === 'bar') {
    const stagger = Math.min(6, (end - GROW_FRAMES - start) / Math.max(1, n * k - 1));
    const barAt = (i: number, s: number) => start + (i * k + s) * stagger;
    const doneAt = barAt(n - 1, k - 1) + GROW_FRAMES;
    return { barAt, slotDoneAt: (i: number) => barAt(i, k - 1) + 10, drawAt: () => 0, drawFrames: 0, doneAt };
  }
  // Lines draw one after another, so "before" is on screen before "after" sweeps across it.
  const drawFrames = Math.min(48, (end - LABEL_FRAMES - start) / (0.75 * (k - 1) + 1));
  const drawAt = (s: number) => start + s * drawFrames * 0.75;
  const doneAt = drawAt(k - 1) + drawFrames;
  return { barAt: () => 0, slotDoneAt: (i: number) => drawAt(k - 1) + drawFrames * ((i + 0.5) / n), drawAt, drawFrames, doneAt };
}

/** A soft column behind the label a step lights. */
const SlotGlow: React.FC<{ layout: ChartLayout; i: number; emphasis: Emphasis }> = ({ layout, i, emphasis }) =>
  emphasis.glow > 0 ? (
    <div
      style={{
        position: 'absolute',
        left: layout.xs[i]! - layout.slotW / 2 + 6,
        width: layout.slotW - 12,
        top: layout.plot.y0,
        height: layout.xLabelTop - layout.plot.y0 + 40,
        borderRadius: 16,
        background: `rgba(124, 140, 255, ${0.08 * emphasis.glow})`,
        boxShadow: `inset 0 0 0 2px ${colors.accent}${Math.round(emphasis.glow * 110).toString(16).padStart(2, '0')}`,
      }}
    />
  ) : null;

const Legend: React.FC<{ scene: ChartScene; seriesOpacity: (s: number) => number }> = ({ scene, seriesOpacity }) => (
  <div style={{ display: 'flex', gap: 26, fontSize: 21, color: colors.muted, flexShrink: 0, paddingBottom: 6, alignItems: 'center' }}>
    {scene.series.map((s, i) => {
      const tone = tones[seriesTone(scene.series, i)];
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: seriesOpacity(i) }}>
          <span style={{ width: 22, height: scene.kind === 'bar' ? 22 : 5, borderRadius: scene.kind === 'bar' ? 6 : 3, background: tone.color }} />
          <span style={{ color: colors.text }}>{s.name}</span>
        </div>
      );
    })}
    {scene.unit ? <span style={{ fontFamily: fonts.mono, fontSize: 19, color: colors.faint }}>· {scene.unit}</span> : null}
  </div>
);

const Grid: React.FC<{ layout: ChartLayout; unit: string | undefined; appear: number }> = ({ layout, unit, appear }) => {
  const { x0, x1 } = layout.plot;
  return (
    <>
      <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="100%" height="100%">
        {layout.ticks.map((t) => (
          <line
            key={t}
            x1={x0}
            x2={x0 + (x1 - x0) * appear}
            y1={layout.y(t)}
            y2={layout.y(t)}
            stroke={t === 0 ? colors.borderStrong : colors.border}
            strokeWidth={t === 0 ? 2 : 1.5}
            strokeDasharray={t === 0 ? undefined : '4 8'}
          />
        ))}
      </svg>
      {layout.ticks.map((t) => (
        <div
          key={t}
          style={{
            position: 'absolute',
            left: 0,
            width: layout.axisW - 18,
            whiteSpace: 'nowrap',
            top: layout.y(t) - 12,
            textAlign: 'right',
            fontFamily: fonts.mono,
            fontSize: 17,
            lineHeight: '24px',
            color: colors.faint,
            opacity: appear,
          }}
        >
          {formatValue(t, unit)}
        </div>
      ))}
    </>
  );
};

const XLabels: React.FC<{ layout: ChartLayout; appear: number; emphasisOf: (i: number) => Emphasis }> = ({ layout, appear, emphasisOf }) => (
  <>
    {layout.xLabels.map((lines, i) => (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: layout.xs[i]! - layout.slotW / 2,
          width: layout.slotW,
          top: layout.xLabelTop,
          textAlign: 'center',
          fontSize: layout.xLabelFont,
          lineHeight: `${Math.round(layout.xLabelFont * 1.3)}px`,
          fontWeight: 600,
          color: emphasisOf(i).glow > 0 ? colors.text : '#c9cedb',
          opacity: appear * emphasisOf(i).opacity,
        }}
      >
        {lines.map((l, j) => (
          <div key={j} style={{ whiteSpace: 'nowrap' }}>
            {l}
          </div>
        ))}
      </div>
    ))}
  </>
);

const ValueLabel: React.FC<{ x: number; y: number; text: string; color: string; appear: number; below?: boolean; size: number }> = ({ x, y, text, color, appear, below, size }) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: below ? y + 14 : y - 14 - size * 1.25,
      transform: `translateX(-50%) translateY(${(1 - appear) * (below ? -8 : 8)}px)`,
      fontFamily: fonts.mono,
      fontSize: size,
      lineHeight: `${Math.round(size * 1.25)}px`,
      fontWeight: 700,
      color,
      whiteSpace: 'nowrap',
      textShadow: `0 0 6px ${colors.bg}, 0 0 3px ${colors.bg}, 0 0 1px ${colors.bg}`,
      opacity: appear,
    }}
  >
    {text}
  </div>
);

const Badge: React.FC<{ x: number; y: number; text: string; direction: Direction; appear: number }> = ({ x, y, text, direction, appear }) => {
  const tone = directionTone[direction];
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y - BADGE_H,
        height: BADGE_H,
        transform: `translateX(-50%) scale(${0.6 + 0.4 * appear})`,
        transformOrigin: 'bottom center',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        borderRadius: 999,
        background: `linear-gradient(${tone.bg}, ${tone.bg}), #0d0f16`,
        border: `1.5px solid ${tone.color}aa`,
        color: tone.color,
        fontFamily: fonts.mono,
        fontSize: 19,
        fontWeight: 800,
        whiteSpace: 'nowrap',
        opacity: appear,
      }}
    >
      {text}
    </div>
  );
};

const Bars: React.FC<{ scene: ChartScene; layout: ChartLayout; frame: number; barAt: (i: number, s: number) => number; noted: Point | null; pulse: number; valueOf: ValueEmphasis }> = ({
  scene,
  layout,
  frame,
  barAt,
  noted,
  pulse,
  valueOf,
}) => {
  const { fps } = useVideoConfig();
  const k = scene.series.length;
  const base = layout.y(0);
  const size = layout.barW < 64 ? 17 : VALUE_FONT;
  return (
    <>
      {scene.labels.map((_, i) =>
        scene.series.map((series, s) => {
          const at = barAt(i, s);
          const grow = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 110 } });
          const tone = tones[seriesTone(scene.series, s)];
          const value = series.values[i]!;
          const top = layout.y(value);
          const h = (base - top) * grow;
          const x = barX(layout, layout.xs[i]!, s, k);
          const label = interpolate(frame, [at + 12, at + 20], [0, 1], clamp);
          const ring = noted && noted.label === i && noted.series === s ? `, 0 0 0 ${3 + 6 * pulse}px ${tone.color}${Math.round(40 + 120 * pulse).toString(16).padStart(2, '0')}` : '';
          const lit = valueOf(s, i);
          const focusRing = lit.glow > 0 ? `, 0 0 0 ${4 * lit.glow}px ${colors.text}cc, 0 0 ${36 * lit.glow}px ${tone.color}` : '';
          return (
            <div key={`${i}-${s}`} style={{ opacity: lit.opacity }}>
              <div
                style={{
                  position: 'absolute',
                  left: x,
                  top: base - h,
                  width: layout.barW,
                  height: h,
                  borderRadius: '10px 10px 3px 3px',
                  background: `linear-gradient(180deg, ${tone.color}, ${tone.color}aa)`,
                  boxShadow: `0 0 28px ${tone.color}33, inset 0 1px 0 rgba(255,255,255,0.25)${ring}${focusRing}`,
                }}
              />
              <ValueLabel x={x + layout.barW / 2} y={top} text={formatValue(value, scene.unit)} color={s === k - 1 ? colors.text : '#b9c0d0'} appear={label} size={size} />
            </div>
          );
        }),
      )}
    </>
  );
};

const Lines: React.FC<{ scene: ChartScene; layout: ChartLayout; frame: number; drawAt: (s: number) => number; drawFrames: number; valueOf: ValueEmphasis; labelGlow: (i: number) => number }> = ({
  scene,
  layout,
  frame,
  drawAt,
  drawFrames,
  valueOf,
  labelGlow,
}) => {
  const { x0, x1, y1 } = layout.plot;
  const k = scene.series.length;
  const labelEvery = k <= 2 && scene.labels.length <= 8;
  return (
    <>
      <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="100%" height="100%">
        <defs>
          {scene.series.map((_, s) => {
            const reveal = interpolate(frame, [drawAt(s), drawAt(s) + drawFrames], [0, 1], { ...clamp, easing: (t) => 1 - (1 - t) ** 2 });
            const first = layout.xs[0]!;
            const last = layout.xs[layout.xs.length - 1]!;
            return (
              <clipPath key={s} id={`chart-reveal-${s}`}>
                <rect x={x0 - 20} y={-200} width={first - x0 + 20 + (last - first) * reveal + 14} height={y1 + 400} />
              </clipPath>
            );
          })}
          {scene.series.map((_, s) => {
            const tone = tones[seriesTone(scene.series, s)];
            return (
              <linearGradient key={s} id={`chart-fill-${s}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={tone.color} stopOpacity={0.22} />
                <stop offset="1" stopColor={tone.color} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>
        {scene.series.map((series, s) => {
          const tone = tones[seriesTone(scene.series, s)];
          const pts = series.values.map((v, i) => `${layout.xs[i]},${layout.y(v)}`);
          const base = layout.y(Math.max(0, layout.ticks[0]!));
          const area = `M ${layout.xs[0]},${base} L ${pts.join(' L ')} L ${layout.xs[layout.xs.length - 1]},${base} Z`;
          return (
            <g key={s} clipPath={`url(#chart-reveal-${s})`} opacity={Math.max(...series.values.map((_, i) => valueOf(s, i).opacity))}>
              {k === 1 || (k === 2 && s === 1) ? <path d={area} fill={`url(#chart-fill-${s})`} /> : null}
              <path d={`M ${pts.join(' L ')}`} fill="none" stroke={tone.color} strokeWidth={s === k - 1 ? 5 : 4} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s === 0 && k > 1 && !series.tone ? '2 10' : undefined} />
            </g>
          );
        })}
        {scene.series.map((series, s) =>
          series.values.map((v, i) => {
            const tone = tones[seriesTone(scene.series, s)];
            const at = drawAt(s) + drawFrames * ((layout.xs[i]! - layout.xs[0]!) / Math.max(1, x1 - x0));
            const pop = interpolate(frame, [at, at + 8], [0, 1], clamp);
            const lit = valueOf(s, i);
            return <circle key={`${s}-${i}`} cx={layout.xs[i]} cy={layout.y(v)} r={(8 + 3 * Math.max(lit.glow, labelGlow(i))) * pop} fill={colors.bg} stroke={tone.color} strokeWidth={4} opacity={lit.opacity} />;
          }),
        )}
      </svg>
      {scene.series.map((series, s) =>
        series.values.map((v, i) => {
          if (!labelEvery && i !== series.values.length - 1) return null;
          const at = drawAt(s) + drawFrames * ((layout.xs[i]! - layout.xs[0]!) / Math.max(1, x1 - x0)) + 4;
          const others = scene.series.filter((_, o) => o !== s).map((o) => o.values[i]!);
          const below = k === 2 && others.some((o) => o > v);
          return (
            <ValueLabel
              key={`${s}-${i}`}
              x={layout.xs[i]!}
              y={layout.y(v)}
              text={formatValue(v, scene.unit)}
              color={s === k - 1 ? colors.text : '#b9c0d0'}
              appear={interpolate(frame, [at, at + 8], [0, 1], clamp) * valueOf(s, i).opacity}
              below={below}
              size={VALUE_FONT}
            />
          );
        }),
      )}
    </>
  );
};

/** The top of the labels above a slot's highest value, where its change badge sits. */
function slotTop(scene: ChartScene, layout: ChartLayout, i: number): number {
  const valueH = VALUE_FONT * 1.25 + 14;
  if (scene.kind === 'line') {
    const [a, b] = [scene.series[0]!.values[i]!, scene.series[1]!.values[i]!];
    return layout.y(Math.max(a, b)) - valueH - 10;
  }
  return layout.y(Math.max(...scene.series.map((s) => s.values[i]!))) - valueH - 6;
}

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs: a value's number and the top
 * of its bar or its point, a label's text, a series' values together. A note keeps off the bars, the
 * numbers, the labels, the change badges and the annotation.
 */
function chartTargets(scene: ChartScene, layout: ChartLayout, size: { width: number; height: number }): MarkTargets {
  const font = scene.kind === 'bar' && layout.barW < 64 ? 17 : VALUE_FONT;
  const valueH = font * 1.25 + 14;
  const boxes = new Map<string, Box>();
  const obstacles: Box[] = [];
  const lines = scene.kind === 'line' ? scene.series.flatMap((s) => s.values.slice(1).flatMap((v, i) => Array.from({ length: 8 }, (_, t) => ({ x: layout.xs[i]! + ((layout.xs[i + 1]! - layout.xs[i]!) * t) / 8, y: layout.y(s.values[i]!) + ((layout.y(v) - layout.y(s.values[i]!)) * t) / 8 })))) : [];
  scene.series.forEach((series, s) =>
    series.values.forEach((v, l) => {
      const top = layout.y(v);
      const value =
        scene.kind === 'bar'
          ? { x: barX(layout, layout.xs[l]!, s, scene.series.length) - 6, y: top - valueH, width: layout.barW + 12, height: valueH + Math.min(40, layout.plot.y1 - top) }
          : { x: layout.xs[l]! - 34, y: top - valueH, width: 68, height: valueH + 16 };
      boxes.set(`p:${s}/${l}`, value);
      obstacles.push(scene.kind === 'bar' ? { x: value.x, y: value.y, width: value.width, height: layout.plot.y1 - value.y } : value);
    }),
  );
  scene.labels.forEach((_, i) => {
    const text = layout.xLabels[i]!;
    const width = Math.min(layout.slotW, Math.max(...text.map((t) => t.length)) * layout.xLabelFont * 0.55 + 8);
    const label = { x: layout.xs[i]! - width / 2, y: layout.xLabelTop - 4, width, height: text.length * layout.xLabelFont * 1.3 + 8 };
    boxes.set(`l:${i}`, label);
    obstacles.push(label);
    if (scene.series.length === 2) obstacles.push({ x: layout.xs[i]! - 60, y: slotTop(scene, layout, i) - BADGE_H, width: 120, height: BADGE_H });
  });
  scene.series.forEach((_, s) => boxes.set(`s:${s}`, union(scene.labels.map((__, l) => boxes.get(`p:${s}/${l}`)))!));
  if (scene.annotation) obstacles.push({ x: layout.plot.x0, y: 0, width: layout.plot.x1 - layout.plot.x0, height: ANNOTATION_BAND });
  return { boxes, obstacles, lines, area: areaOf(size) };
}

function annotationPoint(scene: ChartScene, layout: ChartLayout): Point | null {
  const note = scene.annotation;
  if (!note) return null;
  const label = scene.labels.indexOf(note.at);
  const named = note.series === undefined ? -1 : scene.series.findIndex((s) => s.name === note.series);
  const series = named >= 0 ? named : scene.series.length - 1;
  if (label < 0) return null;
  const value = scene.series[series]!.values[label]!;
  const x = scene.kind === 'bar' ? barX(layout, layout.xs[label]!, series, scene.series.length) + layout.barW / 2 : layout.xs[label]!;
  return { label, series, x, y: layout.y(value), value };
}

interface NoteBox {
  lines: string[];
  left: number;
  top: number;
  w: number;
  h: number;
}

function placeNote(text: string, point: Point, layout: ChartLayout, width: number): NoteBox {
  const lines = wrapLabel(text, 44);
  const w = Math.min(620, Math.max(...lines.map((l) => l.length)) * 12.4 + 52);
  const h = lines.length * 31 + 28;
  return { lines, w, h, left: Math.min(width - w, Math.max(layout.axisW, point.x - w / 2)), top: (ANNOTATION_BAND - h) / 2 - 6 };
}

/** The dashed leader from the note down to its point, drawn under the data labels so they stay legible. */
const Leader: React.FC<{ note: NoteBox; point: Point; end: number; appear: number; pulse: number; color: string; ring: boolean }> = ({ note, point, end, appear, pulse, color, ring }) => {
  const from = note.top + note.h;
  return (
    <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="100%" height="100%">
      <line x1={point.x} x2={point.x} y1={from} y2={from + (end - from) * appear} stroke={colors.accent} strokeOpacity={0.85} strokeWidth={2} strokeDasharray="5 6" />
      {ring ? <circle cx={point.x} cy={point.y} r={15 + 14 * pulse} fill="none" stroke={color} strokeOpacity={0.35 + 0.55 * pulse} strokeWidth={3} /> : null}
    </svg>
  );
};

const Note: React.FC<{ note: NoteBox; appear: number }> = ({ note, appear }) => (
  <div
    style={{
      position: 'absolute',
      left: note.left,
      top: note.top,
      width: note.w,
      height: note.h,
      boxSizing: 'border-box',
      padding: '14px 26px',
      borderRadius: 16,
      background: 'linear-gradient(180deg, #1d2136, #161a2a)',
      border: `1px solid ${colors.accent}88`,
      boxShadow: `0 18px 48px rgba(0,0,0,0.5), 0 0 32px ${colors.accentSoft}`,
      fontSize: 23,
      lineHeight: '31px',
      fontWeight: 500,
      textAlign: 'center',
      opacity: appear,
      transform: `translateY(${(1 - appear) * 14}px) scale(${0.95 + 0.05 * appear})`,
    }}
  >
    {note.lines.map((l, i) => (
      <div key={i} style={{ whiteSpace: 'nowrap' }}>
        {l}
      </div>
    ))}
  </div>
);

/** How lit one value is: bright through its label, its series or itself, and glowing through its series or itself. */
type ValueEmphasis = (series: number, label: number) => Emphasis;

export const Chart: React.FC<SceneProps<ChartScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutChart(scene, box.width, box.height), [scene, box.width, box.height]);
  const marks = useMemo(() => chartTargets(scene, layout, box), [scene, layout, box.width, box.height]);
  const timeline = buildTimeline(scene);
  // Each step lights its labels, series or values while the rest dim. A label stays bright while any of its values is lit.
  const stepFroms = segments.slice(1).map((segment) => segment.from);
  const focus = focusSpotlight(scene, hunks, segments, frame);
  const valueOf: ValueEmphasis = (s, i) => {
    const own = brighter(focus(`s:${s}`), focus(`p:${s}/${i}`));
    return { ...own, opacity: Math.max(own.opacity, focus(`l:${i}`).opacity) };
  };
  const emphasisOf = (i: number): Emphasis => ({ ...focus(`l:${i}`), opacity: Math.max(...scene.series.map((_, s) => valueOf(s, i).opacity)) });
  const seriesOpacity = (s: number) => Math.max(...scene.labels.map((_, i) => valueOf(s, i).opacity));
  const gridIn = interpolate(frame, [START, START + 14], [0, 1], clamp);
  const pair = scene.series.length === 2;
  const point = annotationPoint(scene, layout);
  // The note lands with the build, or with the first step that focuses its label or its value.
  const noteSteps = point ? [...(targetSteps(scene).get(`l:${point.label}`) ?? []), ...(targetSteps(scene).get(`p:${point.series}/${point.label}`) ?? [])] : [];
  const noteStep = noteSteps.length ? Math.min(...noteSteps) : -1;
  const noteAt = noteStep >= 0 ? stepFroms[noteStep]! : timeline.doneAt - 8;
  const noteIn = spring({ frame: frame - noteAt, fps, config: { damping: 16, stiffness: 120 } });
  const notePulse = interpolate(frame, [noteAt + 4, noteAt + 12, noteAt + 40], [0, 1, 0.35], clamp);
  const note = point && scene.annotation ? placeNote(scene.annotation.text, point, layout, box.width) : null;
  // A bar's note stops above the bar's own value; a line's runs to the ring around its point.
  const leaderEnd = point ? (scene.kind === 'bar' ? point.y - VALUE_FONT * 1.25 - 18 : point.y - 15) : 0;

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} aside={<Legend scene={scene} seriesOpacity={seriesOpacity} />}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: box.width, height: box.height }}>
        {scene.labels.map((_, i) => (
          <SlotGlow key={i} layout={layout} i={i} emphasis={emphasisOf(i)} />
        ))}
        <Grid layout={layout} unit={scene.unit} appear={gridIn} />
        <XLabels layout={layout} appear={gridIn} emphasisOf={emphasisOf} />
        {note && point ? (
          <Leader note={note} point={point} end={leaderEnd} appear={noteIn} pulse={notePulse} color={tones[seriesTone(scene.series, point.series)].color} ring={scene.kind === 'line'} />
        ) : null}
        {scene.kind === 'bar' ? (
          <Bars scene={scene} layout={layout} frame={frame} barAt={timeline.barAt} noted={point} pulse={notePulse} valueOf={valueOf} />
        ) : (
          <Lines scene={scene} layout={layout} frame={frame} drawAt={timeline.drawAt} drawFrames={timeline.drawFrames} valueOf={valueOf} labelGlow={(i) => emphasisOf(i).glow} />
        )}
        {pair
          ? scene.labels.map((_, i) => {
              const d = delta(scene.series[0]!.values[i]!, scene.series[1]!.values[i]!, scene.better);
              if (!d) return null;
              const at = timeline.slotDoneAt(i);
              const appear = spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 150 } });
              return (
                <div key={i} style={{ opacity: emphasisOf(i).opacity }}>
                  <Badge x={layout.xs[i]!} y={slotTop(scene, layout, i)} text={d.text} direction={d.direction} appear={appear} />
                </div>
              );
            })
          : null}
        {note ? <Note note={note} appear={noteIn} /> : null}
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={() => marks} />
    </SceneShell>
  );
};
