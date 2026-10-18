import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { sceneStates } from '../../shared/state-steps.mjs';
import type { Fit } from '../../shared/textfit.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import { headerBox } from '../fit/shell';
import type { ChartScene } from '../types';
import { chartOrder, formatValue, labelTotal } from '../utils/chartLayout';
import { layoutBarRows, layoutPie, PIE_SWATCH, rowBarY, sliceText, sum, VALUE_PAD, type PieLayout } from '../utils/chartShapes';
import { brighter, focusSpotlight, type Emphasis } from '../utils/spotlight';
import { stateFrame } from '../utils/stateTrack';
import { chartStepTargets, framed, point, sliceAngles } from '../utils/chartTargets';
import { FitText } from './FitText';
import { HeaderCallout } from './HeaderCallout';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, fonts } from './theme';
import { seriesTone, sliceColor, tones } from './tones';

const START = 20;

/** The series names with their colours, at the right end of the header; a series no step lights dims with it. */
export const Legend: React.FC<{ scene: ChartScene; legend: readonly Fit[]; seriesOpacity: (s: number) => number }> = ({ scene, legend, seriesOpacity }) => (
  <div style={{ display: 'flex', gap: 26, fontSize: 21, color: colors.muted, flexShrink: 0, paddingBottom: 6, alignItems: 'center' }}>
    {scene.series.map((_, i) => {
      const tone = tones[seriesTone(scene.series, i)];
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: seriesOpacity(i) }}>
          <span style={{ width: 22, height: scene.kind === 'bar' ? 22 : 5, borderRadius: scene.kind === 'bar' ? 6 : 3, background: tone.color }} />
          <FitText fit={legend[i]!} inline style={{ color: colors.text }} />
        </div>
      );
    })}
    {scene.unit ? <span style={{ fontFamily: fonts.mono, fontSize: 19, color: colors.faint }}>· {scene.unit}</span> : null}
  </div>
);



/** How lit one value is through its label, its series or itself. */
function emphasisOf(focus: (key: string) => Emphasis) {
  const value = (s: number, i: number): Emphasis => {
    const own = brighter(focus(`s:${s}`), focus(`p:${s}/${i}`));
    return { ...own, glow: Math.max(own.glow, focus(`l:${i}`).glow), opacity: Math.max(own.opacity, focus(`l:${i}`).opacity) };
  };
  return value;
}

/** A row's colour: each label its own when one series has no tone, so a bar is easy to follow as it moves. */
const barColor = (scene: ChartScene, s: number, label: number) => (scene.series.length === 1 && !scene.series[0]!.tone ? sliceColor(label) : tones[seriesTone(scene.series, s)].color);


/** A horizontal bar chart: rows that slide to their places when sorted, bars as long as their values against the largest. */
export const BarRows: React.FC<SceneProps<ChartScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = headerBox(scene);
  const layout = useMemo(() => layoutBarRows(scene, box.width, box.height), [scene, box.width, box.height]);
  const states = useMemo(() => sceneStates(scene), [scene]);
  const f = stateFrame(states, segments, frame);
  const { values, shown, place } = framed(scene, f);
  const focus = focusSpotlight(scene, hunks, segments, frame);
  const valueOf = emphasisOf(focus);
  const seriesOpacity = (s: number) => Math.max(...scene.labels.map((_, i) => valueOf(s, i).opacity));
  const k = scene.stacked ? 1 : scene.series.length;
  const ends = scene.labels.map((_, l) => (scene.stacked ? labelTotal(values, l) : Math.max(...values.map((row) => row[l]!))));
  const longest = Math.max(1e-9, ...ends);
  const stagger = Math.min(5, (buildFrames('chart') - START - 16) / Math.max(1, scene.labels.length - 1));
  const marks = useMemo(() => chartStepTargets(scene), [scene]);
  return (
    <SceneShell
      scene={scene}
      durationInFrames={durationInFrames}
      camera={{ hunks, segments, targets: (k) => marks[k] ?? null }}
      aside={<>{scene.series.length > 1 ? <Legend scene={scene} legend={layout.legend} seriesOpacity={seriesOpacity} /> : null}<HeaderCallout scene={scene} s={f} /></>}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, width: box.width, height: box.height }}>
        {scene.labels.map((_, l) => {
          const top = layout.top + place(l) * layout.rowH;
          const grow = spring({ frame: frame - START - l * stagger, fps, config: { damping: 18, stiffness: 110 } });
          const label = layout.labels[l]!;
          const lit = focus(`l:${l}`);
          const rowOpacity = Math.max(...scene.series.map((__, s) => valueOf(s, l).opacity));
          let run = 0;
          return (
            <div key={l} style={{ position: 'absolute', left: 0, top, width: box.width, height: layout.rowH, opacity: interpolate(grow, [0, 0.3], [0, 1], clamp) }}>
              <FitText
                fit={label}
                align="right"
                style={{ position: 'absolute', right: box.width - layout.labelW + 18, top: (layout.rowH - label.height) / 2, width: layout.labelW - 18, color: lit.glow > 0 ? colors.text : '#c9cedb', opacity: rowOpacity }}
              />
              {scene.series.map((_series, s) => {
                const v = values[s]![l]!;
                const x = layout.x0 + (scene.stacked ? (run / longest) * layout.barMax * grow : 0);
                run += v;
                const w = (v / longest) * layout.barMax * grow;
                const color = barColor(scene, s, l);
                const y = rowBarY(layout, 0, scene.stacked ? 0 : s, k);
                const e = valueOf(s, l);
                const ring = e.glow > 0 ? `, 0 0 0 ${4 * e.glow}px ${colors.text}cc, 0 0 ${36 * e.glow}px ${color}` : '';
                const last = !scene.stacked || s === scene.series.length - 1;
                const printed = scene.stacked ? labelTotal(shown, l) : shown[s]![l]!;
                return (
                  <div key={s} style={{ opacity: e.opacity }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: x,
                        top: y,
                        width: w,
                        height: layout.barH,
                        borderRadius: last ? '3px 10px 10px 3px' : 3,
                        background: `linear-gradient(90deg, ${color}aa, ${color})`,
                        boxShadow: `0 0 28px ${color}33, inset 0 1px 0 rgba(255,255,255,0.25)${ring}`,
                      }}
                    />
                    {last ? (
                      <div
                        style={{
                          position: 'absolute',
                          left: layout.x0 + ((scene.stacked ? labelTotal(values, l) : v) / longest) * layout.barMax * grow + VALUE_PAD,
                          top: y + (layout.barH - layout.valueFont * 1.25) / 2,
                          fontFamily: fonts.mono,
                          fontSize: layout.valueFont,
                          lineHeight: `${Math.round(layout.valueFont * 1.25)}px`,
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          color: s === scene.series.length - 1 ? colors.text : '#b9c0d0',
                          opacity: interpolate(grow, [0.6, 1], [0, 1], clamp),
                        }}
                      >
                        {formatValue(printed, scene.unit)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={(k) => marks[k] ?? null} />
    </SceneShell>
  );
};


function wedge(layout: PieLayout, from: number, to: number, out = 0): string {
  const span = Math.min(to - from, Math.PI * 2 - 1e-4);
  const mid = from + span / 2;
  const [dx, dy] = [out * Math.sin(mid), -out * Math.cos(mid)];
  const [cx, cy] = [layout.cx + dx, layout.cy + dy];
  const large = span > Math.PI ? 1 : 0;
  const [x0, y0] = point(cx, cy, layout.r, from);
  const [x1, y1] = point(cx, cy, layout.r, from + span);
  if (!layout.hole) return `M ${cx} ${cy} L ${x0} ${y0} A ${layout.r} ${layout.r} 0 ${large} 1 ${x1} ${y1} Z`;
  const [i1, j1] = point(cx, cy, layout.hole, from + span);
  const [i0, j0] = point(cx, cy, layout.hole, from);
  return `M ${x0} ${y0} A ${layout.r} ${layout.r} 0 ${large} 1 ${x1} ${y1} L ${i1} ${j1} A ${layout.hole} ${layout.hole} 0 ${large} 0 ${i0} ${j0} Z`;
}



/** A pie or donut of one series: slices that sweep in, change size as steps set them, and swap places when sorted. */
export const PieChart: React.FC<SceneProps<ChartScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const box = headerBox(scene);
  const layout = useMemo(() => layoutPie(scene, box.width, box.height), [scene, box.width, box.height]);
  const states = useMemo(() => sceneStates(scene), [scene]);
  const f = stateFrame(states, segments, frame);
  const { before, now, values, shown, place } = framed(scene, f);
  const shares = values[0]!;
  const total = sum(shares);
  // Each slice turns from where the last state put it to where this one does, its size following its value.
  const [was, is] = [sliceAngles(before.values[0]!, chartOrder(scene, before.values, before.sort)), sliceAngles(now.values[0]!, chartOrder(scene, now.values, now.sort))];
  const spans = sliceAngles(shares, scene.labels.map((_, i) => i));
  const angles = scene.labels.map((_, i) => ({ from: was[i]!.from + (is[i]!.from - was[i]!.from) * f.t, span: spans[i]!.span }));
  const sweep = interpolate(frame, [START, buildFrames('chart')], [0, Math.PI * 2], { ...clamp, easing: (t) => 1 - (1 - t) ** 3 });
  const focus = focusSpotlight(scene, hunks, segments, frame);
  const valueOf = emphasisOf(focus);
  const legendIn = interpolate(frame, [START + 10, START + 26], [0, 1], clamp);
  const marks = useMemo(() => chartStepTargets(scene), [scene]);
  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} camera={{ hunks, segments, targets: (k) => marks[k] ?? null }} aside={<HeaderCallout scene={scene} s={f} />}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: box.width, height: box.height }}>
        <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="100%" height="100%">
          {scene.labels.map((_, i) => {
            const { from, span } = angles[i]!;
            const end = Math.min(from + span, sweep);
            if (end <= from || span <= 0) return null;
            const e = valueOf(0, i);
            const color = sliceColor(i);
            return (
              <path
                key={i}
                d={wedge(layout, from, end, 14 * e.glow)}
                fill={color}
                stroke={colors.bg}
                strokeWidth={3}
                opacity={e.opacity}
                style={{ filter: e.glow > 0 ? `drop-shadow(0 0 ${18 * e.glow}px ${color})` : undefined }}
              />
            );
          })}
        </svg>
        {scene.labels.map((_, i) => {
          const { from, span } = angles[i]!;
          if (span < 0.32 || from + span > sweep) return null;
          const mid = from + span / 2;
          const [x, y] = point(layout.cx, layout.cy, layout.hole ? (layout.r + layout.hole) / 2 : layout.r * 0.64, mid);
          const pct = total > 0 ? (shares[i]! / total) * 100 : 0;
          return (
            <div key={i} style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%, -50%)', fontFamily: fonts.mono, fontSize: 22, fontWeight: 800, color: colors.bg, opacity: valueOf(0, i).opacity, whiteSpace: 'nowrap' }}>
              {`${pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10}%`}
            </div>
          );
        })}
        {layout.hole ? (
          <div style={{ position: 'absolute', left: layout.cx - layout.hole, top: layout.cy - layout.hole, width: layout.hole * 2, height: layout.hole * 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: legendIn }}>
            <div style={{ fontFamily: fonts.mono, fontSize: 40, fontWeight: 800, color: colors.text }}>{formatValue(sum(shown[0]!), scene.unit)}</div>
            {layout.centre ? <FitText fit={layout.centre} align="center" style={{ color: colors.muted }} /> : null}
          </div>
        ) : null}
        {scene.labels.map((_, i) => {
          const top = layout.legendTop + place(i) * layout.rowH;
          const e = valueOf(0, i);
          const label = layout.labels[i]!;
          return (
            <div key={i} style={{ position: 'absolute', left: layout.legendX, top, width: box.width - layout.legendX, height: layout.rowH, display: 'flex', alignItems: 'center', gap: PIE_SWATCH.gap, opacity: legendIn * e.opacity }}>
              <span style={{ width: PIE_SWATCH.size, height: PIE_SWATCH.size, borderRadius: 7, background: sliceColor(i), flexShrink: 0, boxShadow: e.glow > 0 ? `0 0 0 ${3 * e.glow}px ${colors.text}aa` : undefined }} />
              <FitText fit={label} style={{ width: layout.labelW, color: e.glow > 0 ? colors.text : '#c9cedb' }} />
              <span style={{ marginLeft: 'auto', fontFamily: fonts.mono, fontSize: layout.valueFont, fontWeight: 700, color: colors.text, whiteSpace: 'nowrap' }}>{sliceText(scene, shown[0]![i]!, sum(shown[0]!))}</span>
            </div>
          );
        })}
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={(k) => marks[k] ?? null} />
    </SceneShell>
  );
};
