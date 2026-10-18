import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { sceneStates } from '../../shared/state-steps.mjs';
import { targetSteps } from '../../shared/targets.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import { headerBox } from '../fit/shell';
import type { ChartScene } from '../types';
import { ANNOTATION_BAND, barX, delta, formatValue, labelTotal, layoutChart, VALUE_FONT, valueLabels, type Affix, type ChartLayout, type Direction, type ValueLabel as Value } from '../utils/chartLayout';
import { brighter, focusSpotlight, stepSpring, type Emphasis } from '../utils/spotlight';
import { stateFrame } from '../utils/stateTrack';
import { BADGE_H, chartAt, chartStepTargets, showsBadges, slotTop } from '../utils/chartTargets';
import { BarRows, Legend, PieChart } from './ChartShapes';
import { HeaderCallout } from './HeaderCallout';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import type { Fit } from '../../shared/textfit.mjs';
import { FitText } from './FitText';
import { clamp, colors, fonts } from './theme';
import { seriesTone, tones } from './tones';

const START = 10;
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

export const Grid: React.FC<{ layout: ChartLayout; affix: Affix; appear: number }> = ({ layout, affix, appear }) => {
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
          {formatValue(t, affix)}
        </div>
      ))}
    </>
  );
};

const XLabels: React.FC<{ layout: ChartLayout; appear: number; emphasisOf: (i: number) => Emphasis }> = ({ layout, appear, emphasisOf }) => (
  <>
    {layout.xLabels.map((text, i) => (
      <FitText
        key={i}
        fit={text}
        align="center"
        style={{
          position: 'absolute',
          left: layout.xs[i]! - layout.slotW / 2,
          width: layout.slotW,
          top: layout.xLabelTop,
          lineHeight: `${Math.round(layout.xLabelFont * 1.3)}px`,
          color: emphasisOf(i).glow > 0 ? colors.text : '#c9cedb',
          opacity: appear * emphasisOf(i).opacity,
        }}
      />
    ))}
  </>
);

const ValueLabel: React.FC<{ value: Value; color: string; appear: number }> = ({ value: { x, top, text, below, size }, color, appear }) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top,
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

const Bars: React.FC<{ scene: ChartScene; layout: ChartLayout; shown: number[][]; frame: number; barAt: (i: number, s: number) => number; noted: Point | null; pulse: number; valueOf: ValueEmphasis }> = ({
  scene,
  layout,
  shown,
  frame,
  barAt,
  noted,
  pulse,
  valueOf,
}) => {
  const { fps } = useVideoConfig();
  const k = scene.series.length;
  const values = new Map(valueLabels(scene, layout, shown).map((v) => [`${v.series}-${v.label}`, v]));
  return (
    <>
      {scene.labels.map((_, i) =>
        scene.series.map((series, s) => {
          const at = barAt(i, s);
          const grow = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 110 } });
          const tone = tones[seriesTone(scene.series, s)];
          // A stacked series sits on the ones before it.
          const below = scene.stacked ? labelTotal(scene.series.slice(0, s).map((o) => o.values), i) : 0;
          const base = layout.y(below);
          const value = series.values[i]!;
          const top = layout.y(below + value);
          const h = (base - top) * grow;
          const x = barX(layout, layout.xs[i]!, s, k, scene.stacked);
          const topOfStack = !scene.stacked || s === k - 1;
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
                  borderRadius: topOfStack ? '10px 10px 3px 3px' : 3,
                  background: `linear-gradient(180deg, ${tone.color}, ${tone.color}aa)`,
                  boxShadow: `0 0 28px ${tone.color}33, inset 0 1px 0 rgba(255,255,255,0.25)${ring}${focusRing}`,
                }}
              />
              {scene.stacked ? <SegmentValue x={x} width={layout.barW} top={base - h} height={h} text={formatValue(shown[s]![i]!, scene)} appear={label} /> : null}
              {values.has(`${s}-${i}`) ? <ValueLabel value={values.get(`${s}-${i}`)!} color={s === k - 1 ? colors.text : '#b9c0d0'} appear={label} /> : null}
            </div>
          );
        }),
      )}
    </>
  );
};

/** A stacked segment's own value, inside it, when the segment is tall and wide enough to hold it. */
const SegmentValue: React.FC<{ x: number; width: number; top: number; height: number; text: string; appear: number }> = ({ x, width, top, height, text, appear }) => {
  const size = 17;
  if (height < size * 1.9 || text.length * size * 0.62 + 12 > width) return null;
  return (
    <div style={{ position: 'absolute', left: x, top, width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.mono, fontSize: size, fontWeight: 700, color: colors.bg, opacity: appear * 0.9 }}>
      {text}
    </div>
  );
};

const Lines: React.FC<{ scene: ChartScene; layout: ChartLayout; shown: number[][]; frame: number; drawAt: (s: number) => number; drawFrames: number; valueOf: ValueEmphasis; labelGlow: (i: number) => number }> = ({
  scene,
  layout,
  shown,
  frame,
  drawAt,
  drawFrames,
  valueOf,
  labelGlow,
}) => {
  const { x0, x1, y1 } = layout.plot;
  const k = scene.series.length;
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
      {valueLabels(scene, layout, shown).map((value) => {
        const { series: s, label: i } = value;
        const at = drawAt(s) + drawFrames * ((layout.xs[i]! - layout.xs[0]!) / Math.max(1, x1 - x0)) + 4;
        return <ValueLabel key={`${s}-${i}`} value={value} color={s === k - 1 ? colors.text : '#b9c0d0'} appear={interpolate(frame, [at, at + 8], [0, 1], clamp) * valueOf(s, i).opacity} />;
      })}
    </>
  );
};



function annotationPoint(scene: ChartScene, layout: ChartLayout): Point | null {
  const note = scene.annotation;
  if (!note) return null;
  const label = scene.labels.indexOf(note.at);
  const named = note.series === undefined ? -1 : scene.series.findIndex((s) => s.name === note.series);
  const series = named >= 0 ? named : scene.series.length - 1;
  if (label < 0) return null;
  const value = scene.stacked ? labelTotal(scene.series.slice(0, series + 1).map((s) => s.values), label) : scene.series[series]!.values[label]!;
  const x = scene.kind === 'bar' ? barX(layout, layout.xs[label]!, series, scene.series.length, scene.stacked) + layout.barW / 2 : layout.xs[label]!;
  return { label, series, x, y: layout.y(value), value };
}

interface NoteBox {
  text: Fit;
  left: number;
  top: number;
  w: number;
  h: number;
}

function placeNote(text: Fit, point: Point, layout: ChartLayout, width: number): NoteBox {
  const w = Math.min(620, text.width + 52);
  const h = text.height + 28;
  return { text, w, h, left: Math.min(width - w, Math.max(layout.axisW, point.x - w / 2)), top: (ANNOTATION_BAND - h) / 2 - 6 };
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
      opacity: appear,
      transform: `translateY(${(1 - appear) * 14}px) scale(${0.95 + 0.05 * appear})`,
    }}
  >
    <FitText fit={note.text} align="center" />
  </div>
);

/** How lit one value is: bright through its label, its series or itself, and glowing through its series or itself. */
type ValueEmphasis = (series: number, label: number) => Emphasis;


export const Chart: React.FC<SceneProps<ChartScene>> = (props) => {
  if (props.scene.kind === 'pie' || props.scene.kind === 'donut') return <PieChart {...props} />;
  if (props.scene.horizontal) return <BarRows {...props} />;
  return <ColumnChart {...props} />;
};

/** A vertical bar or line chart. */
const ColumnChart: React.FC<SceneProps<ChartScene>> = ({ scene: source, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = headerBox(source);
  const base = useMemo(() => layoutChart(source, box.width, box.height), [source, box.width, box.height]);
  const states = useMemo(() => sceneStates(source), [source]);
  const f = stateFrame(states, segments, frame);
  const { scene, layout, shown } = chartAt(source, base, f);
  // Marks land where each step's values settle.
  const marks = useMemo(() => chartStepTargets(source), [source]);
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
  const point = annotationPoint(scene, layout);
  // The note lands with the build, or with the first step that focuses its label or its value.
  const noteSteps = point ? [...(targetSteps(scene).get(`l:${point.label}`) ?? []), ...(targetSteps(scene).get(`p:${point.series}/${point.label}`) ?? [])] : [];
  const noteStep = noteSteps.length ? Math.min(...noteSteps) : -1;
  const noteAt = noteStep >= 0 ? stepFroms[noteStep]! : timeline.doneAt - 8;
  const noteConfig = { damping: 16, stiffness: 120 };
  const noteIn = noteStep >= 0 ? stepSpring(frame, fps, noteAt, noteAt, noteConfig) : spring({ frame: frame - noteAt, fps, config: noteConfig });
  const notePulse = interpolate(frame, [noteAt + 4, noteAt + 12, noteAt + 40], [0, 1, 0.35], clamp);
  const note = point && layout.note ? placeNote(layout.note, point, layout, box.width) : null;
  // A bar's note stops above the bar's own value; a line's runs to the ring around its point.
  const leaderEnd = point ? (scene.kind === 'bar' ? point.y - VALUE_FONT * 1.25 - 18 : point.y - 15) : 0;

  return (
    <SceneShell scene={source} durationInFrames={durationInFrames} camera={{ hunks, segments, targets: (k) => marks[k] ?? null }} aside={<><Legend scene={scene} legend={layout.legend} seriesOpacity={seriesOpacity} /><HeaderCallout scene={source} s={f} /></>}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: box.width, height: box.height }}>
        {scene.labels.map((_, i) => (
          <SlotGlow key={i} layout={layout} i={i} emphasis={emphasisOf(i)} />
        ))}
        <Grid layout={layout} affix={scene} appear={gridIn} />
        <XLabels layout={layout} appear={gridIn} emphasisOf={emphasisOf} />
        {note && point ? (
          <Leader note={note} point={point} end={leaderEnd} appear={noteIn} pulse={notePulse} color={tones[seriesTone(scene.series, point.series)].color} ring={scene.kind === 'line'} />
        ) : null}
        {scene.kind === 'bar' ? (
          <Bars scene={scene} layout={layout} shown={shown} frame={frame} barAt={timeline.barAt} noted={point} pulse={notePulse} valueOf={valueOf} />
        ) : (
          <Lines scene={scene} layout={layout} shown={shown} frame={frame} drawAt={timeline.drawAt} drawFrames={timeline.drawFrames} valueOf={valueOf} labelGlow={(i) => emphasisOf(i).glow} />
        )}
        {showsBadges(scene)
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
      <PenMarks scene={source} hunks={hunks} segments={segments} targets={(k) => marks[k] ?? null} />
    </SceneShell>
  );
};
