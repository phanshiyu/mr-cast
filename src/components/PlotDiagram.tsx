import { useId, useMemo } from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  plotAxes,
  plotGeometry,
  plotLabels,
  plotParts,
  partTone,
  stateParams,
  AXIS_FONT,
  LABEL_FONT,
  POINT_R,
  TICK_FONT,
  TICK_LEN,
  type PartGeometry,
  type Px,
} from '../../shared/plot.mjs';
import { sceneStates, type SceneState } from '../../shared/state-steps.mjs';
import { cueFrame, STEP_SETTLE_FRAMES } from '../../shared/timing.mjs';
import { viewRect, wholeView } from '../../shared/camera.mjs';
import { headerBox } from '../fit/shell';
import type { PlotScene, PlotStep } from '../types';
import { currentStep, focusSpotlight } from '../utils/spotlight';
import { shownOf, stateFrame, type StateFrame } from '../utils/stateTrack';
import { dimOpacity, mainTone, tintMix } from '../utils/tint';
import type { SpokenSegment } from '../utils/timing';
import { plotTargets } from '../utils/sceneTargets';
import { HeaderCallout } from './HeaderCallout';
import { PenMarks } from './PenMarks';
import { SceneShell, useCameraView, type CameraSource } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { colors, fonts } from './theme';
import { tones } from './tones';

const START = 6;
const STAGGER = 4;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/**
 * When a step's changes play: from its start, or from its `when` words, for the half second every step settles in;
 * a step that traces plays them across its words instead, at an even pace, so the line and the points it moves keep up.
 */
function stepWindow(step: PlotStep | undefined, state: SceneState, segment: SpokenSegment) {
  const start = (step?.when ? cueFrame(segment, step.when) : null) ?? segment.from;
  const traces = Object.keys(state.traces).length > 0;
  const end = traces
    ? Math.max(start + STEP_SETTLE_FRAMES, segment.voiceFrom + segment.speakingFrames)
    : start + STEP_SETTLE_FRAMES;
  return { start, end, traces };
}

function stepProgress(
  scene: PlotScene,
  states: readonly SceneState[],
  segments: readonly SpokenSegment[],
  frame: number,
): { k: number; t: number } {
  const k = currentStep(segments, frame);
  if (k < 0) return { k, t: 1 };
  const { start, end, traces } = stepWindow(scene.steps?.[k], states[k + 1]!, segments[k + 1]!);
  const t = interpolate(frame, [start, end], [0, 1], {
    ...clamp,
    easing: traces ? Easing.linear : Easing.bezier(0.25, 0.1, 0.25, 1),
  });
  return { k, t };
}

const pathOf = (pts: readonly Px[]) =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');

/** The arrowhead at the end of a vector, as a polygon. */
function arrowHead([from, to]: [Px, Px]): string {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  const [ux, uy] = [(to[0] - from[0]) / len, (to[1] - from[1]) / len];
  const [l, w] = [Math.min(24, len), 10];
  const base: Px = [to[0] - ux * l, to[1] - uy * l];
  const corners: Px[] = [to, [base[0] - uy * w, base[1] + ux * w], [base[0] + uy * w, base[1] - ux * w]];
  return corners.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
}

export const PlotDiagram: React.FC<SceneProps<PlotScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = headerBox(scene);
  const states = useMemo(() => sceneStates(scene), [scene]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new box object comes each render; the layout depends only on its size
  const axes = useMemo(() => plotAxes(scene, box), [scene, box.width, box.height]);
  const marks = useMemo(() => plotTargets(scene), [scene]);
  const camera: CameraSource = { hunks, segments, targets: (step) => marks[step] ?? null };
  const view = useCameraView(scene, camera) ?? wholeView(box);
  const { k, t } = stepProgress(scene, states, segments, frame);
  const s: StateFrame = { ...stateFrame(states, segments, frame), t };
  const focus = focusSpotlight(scene, hunks, segments, frame);
  const [was, now] = [stateParams(scene, s.before), stateParams(scene, s.now)];
  const scope = Object.fromEntries(Object.keys(now).map((name) => [name, was[name]! + (now[name]! - was[name]!) * t]));
  const traced = new Set(k >= 0 ? Object.keys(states[k + 1]!.traces).map((key) => key.slice(2)) : []);
  const geometry = plotGeometry(scene, axes, scope, (id) => (traced.has(id) ? t : 1), {
    rect: viewRect(view, box),
    zoom: view.zoom,
  });
  const order = plotParts(scene);
  const appear = (i: number) =>
    Math.min(1, spring({ frame: frame - START - i * STAGGER, fps, config: { damping: 18, stiffness: 140 } }));
  const build = appear(0);
  const shown = (id: string) => (traced.has(id) ? 1 : shownOf(s, `p:${id}`));
  const labels = plotLabels(scene, axes, geometry, scope, (id) => shown(id) > 0.5);
  const { plot } = axes;
  const clip = `plot-${useId().replace(/[^\w-]/g, '')}`;

  /** How a part looks this frame: its colour, opacity and glow. */
  const look = (id: string, index: number) => {
    const key = `p:${id}`;
    const part = geometry.get(id)!.part;
    const mix = tintMix(s, key);
    const tone = mainTone(mix) ?? partTone(scene, part);
    const e = focus(key);
    return {
      color: tones[tone].color,
      opacity: appear(index + 1) * shown(id) * e.opacity * dimOpacity(mix),
      glow: e.glow,
    };
  };
  const glowStyle = (glow: number, color: string) =>
    glow > 0
      ? { filter: `drop-shadow(0 0 ${4 * glow}px ${color}) drop-shadow(0 0 ${14 * glow}px ${colors.accentGlow})` }
      : undefined;

  const draw = (geo: PartGeometry) => {
    const { id, kind, item } = geo.part;
    const index = order.indexOf(geo.part);
    const { color, opacity, glow } = look(id, index);
    if (opacity <= 0.001) return null;
    const width = 5 + 2 * glow;
    const dash = item.dashed ? '16 11' : undefined;
    switch (kind) {
      case 'areas':
        return geo.polygon ? (
          <polygon
            key={id}
            points={geo.polygon.map((p) => p.join(',')).join(' ')}
            fill={color}
            opacity={0.22 * opacity + 0.12 * glow}
          />
        ) : null;
      case 'functions':
      case 'series':
        return (
          <g key={id} opacity={opacity} style={glowStyle(glow, color)}>
            {(geo.runs ?? [])
              .filter((r) => r.length > 1)
              .map((r, i) => (
                <path
                  key={i}
                  d={pathOf(r)}
                  fill="none"
                  stroke={color}
                  strokeWidth={width}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={dash}
                />
              ))}
            {(geo.dots ?? []).map((p, i) => (
              <circle key={`d${i}`} cx={p[0]} cy={p[1]} r={7} fill={color} stroke={colors.bg} strokeWidth={2} />
            ))}
          </g>
        );
      case 'vectors':
        return geo.arrow ? (
          <g key={id} opacity={opacity} style={glowStyle(glow, color)}>
            <line
              x1={geo.arrow[0][0]}
              y1={geo.arrow[0][1]}
              x2={geo.arrow[1][0]}
              y2={geo.arrow[1][1]}
              stroke={color}
              strokeWidth={width}
              strokeLinecap="round"
            />
            <polygon points={arrowHead(geo.arrow)} fill={color} />
          </g>
        ) : null;
      case 'points':
        return geo.visible && geo.dot ? (
          <g key={id} opacity={opacity} style={glowStyle(glow, color)}>
            {item.guides ? (
              <g stroke={color} strokeWidth={2.5} strokeDasharray="8 8" opacity={0.7}>
                <line x1={geo.dot[0]} y1={geo.dot[1]} x2={geo.dot[0]} y2={axes.xAxisY} />
                {axes.yAxisX !== null ? (
                  <line x1={geo.dot[0]} y1={geo.dot[1]} x2={axes.yAxisX} y2={geo.dot[1]} />
                ) : null}
              </g>
            ) : null}
            <circle
              cx={geo.dot[0]}
              cy={geo.dot[1]}
              r={POINT_R + 2 * glow}
              fill={color}
              stroke={colors.bg}
              strokeWidth={3}
            />
          </g>
        ) : null;
    }
  };

  const parts = [...geometry.values()];
  const byKind = (kinds: string[]) => parts.filter((g) => kinds.includes(g.part.kind));
  const tickText = (font: typeof TICK_FONT) => ({
    fontFamily: fonts.sans,
    fontWeight: font.weight,
    fontSize: font.size,
  });

  return (
    <SceneShell
      scene={scene}
      durationInFrames={durationInFrames}
      camera={camera}
      aside={<HeaderCallout scene={scene} s={s} />}
    >
      <svg
        width={box.width}
        height={box.height}
        viewBox={`0 0 ${box.width} ${box.height}`}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={plot.x - 4} y={plot.y - 4} width={plot.width + 8} height={plot.height + 8} />
          </clipPath>
        </defs>
        <g opacity={build}>
          {[
            ...(scene.x.grid
              ? axes.ticks.x.map((tk) => (
                  <line key={`gx${tk.value}`} x1={tk.at} y1={plot.y} x2={tk.at} y2={plot.y + plot.height} />
                ))
              : []),
            ...(scene.y?.grid
              ? axes.ticks.y.map((tk) => (
                  <line key={`gy${tk.value}`} x1={plot.x} y1={tk.at} x2={plot.x + plot.width} y2={tk.at} />
                ))
              : []),
          ].map((l) => (
            <g key={l.key} stroke={colors.borderStrong} strokeWidth={1.5}>
              {l}
            </g>
          ))}
        </g>
        <g clipPath={`url(#${clip})`}>{byKind(['areas']).map(draw)}</g>
        <g opacity={build} stroke={colors.muted} strokeWidth={2.5}>
          <line x1={plot.x} y1={axes.xAxisY} x2={plot.x + plot.width * build} y2={axes.xAxisY} />
          {axes.yAxisX !== null ? (
            <line
              x1={axes.yAxisX}
              y1={plot.y + plot.height}
              x2={axes.yAxisX}
              y2={plot.y + plot.height - plot.height * build}
            />
          ) : null}
          {axes.ticks.x.map((tk) => (
            <line
              key={`tx${tk.value}`}
              x1={tk.at}
              y1={axes.xAxisY - (axes.numberLine ? TICK_LEN : 0)}
              x2={tk.at}
              y2={axes.xAxisY + TICK_LEN}
            />
          ))}
          {axes.yAxisX !== null
            ? axes.ticks.y.map((tk) => (
                <line key={`ty${tk.value}`} x1={axes.yAxisX! - TICK_LEN} y1={tk.at} x2={axes.yAxisX!} y2={tk.at} />
              ))
            : null}
        </g>
        <g clipPath={`url(#${clip})`}>{byKind(['functions', 'series']).map(draw)}</g>
        {/* The axis text sits over the lines, on a halo of the background, so a line crossing it never hides it. */}
        <g
          opacity={build}
          fill={colors.muted}
          stroke={colors.bg}
          strokeWidth={6}
          paintOrder="stroke"
          style={tickText(TICK_FONT)}
        >
          {[...axes.ticks.x, ...axes.ticks.y].map((tk, i) => (
            <text key={i} x={tk.box.x} y={tk.box.y + tk.box.height / 2} dominantBaseline="central">
              {tk.text}
            </text>
          ))}
        </g>
        <g
          opacity={build}
          fill={colors.text}
          stroke={colors.bg}
          strokeWidth={6}
          paintOrder="stroke"
          style={tickText(AXIS_FONT)}
        >
          {[axes.labels.x, axes.labels.y].map((l, i) =>
            l ? (
              <text key={i} x={l.box.x} y={l.box.y + l.box.height / 2} dominantBaseline="central">
                {l.text}
              </text>
            ) : null,
          )}
        </g>
        {byKind(['vectors', 'points']).map(draw)}
        <g style={tickText(LABEL_FONT)}>
          {labels.map((l) => {
            const { color, opacity } = look(
              l.id,
              order.findIndex((p) => p.id === l.id),
            );
            // A label waits for its line to finish drawing, rather than riding the pen across the plot.
            const written = traced.has(l.id) ? interpolate(t, [0.85, 1], [0, 1], clamp) : 1;
            return (
              <text
                key={l.id}
                x={l.box.x}
                y={l.box.y + l.box.height / 2}
                dominantBaseline="central"
                fill={color}
                opacity={opacity * written}
                stroke={colors.bg}
                strokeWidth={6}
                paintOrder="stroke"
              >
                {l.text}
              </text>
            );
          })}
        </g>
      </svg>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={(step) => marks[step] ?? null} />
    </SceneShell>
  );
};
