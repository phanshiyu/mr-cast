import { useMemo } from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  countriesAt,
  DOT_RADIUS,
  geoPathOf,
  LABEL_FONT,
  mapLabels,
  mapLayout,
  mapItems,
  onScreen,
  partialPath,
  zoomBetween,
  type Camera,
  type MapItem,
} from '../../shared/map.mjs';
import { sceneStates, type SceneState } from '../../shared/state-steps.mjs';
import { STEP_SETTLE_FRAMES, cueFrame } from '../../shared/timing.mjs';
import { headerBox } from '../fit/shell';
import type { MapScene, Tone } from '../types';
import { brighter, currentStep, focusSpotlight, type Emphasis } from '../utils/spotlight';
import { mapTargets } from '../utils/sceneTargets';
import { shownOf, stateFrame, type StateFrame } from '../utils/stateTrack';
import type { SpokenSegment } from '../utils/timing';
import { dimOpacity, mainTone, tintFill, tintMix } from '../utils/tint';
import { HeaderCallout } from './HeaderCallout';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { colors, fonts } from './theme';
import { tones } from './tones';

const START = 6;
const OCEAN = '#0b0e15';
const LAND = '#1d2230';
const BORDER = '#3a4254';
/** Frames a trace takes at least, so a short step still draws its route on. */
const TRACE_MIN = 20;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const DEFAULT_TONE: Record<MapItem['kind'], Tone> = {
  place: 'accent',
  route: 'accent',
  line: 'neutral',
  region: 'accent',
};

/** How far, 0 to 1, a route or line is drawn at `frame`: from its latest trace's start until its words end, or its `when`. */
function traceProgress(
  states: readonly SceneState[],
  segments: readonly SpokenSegment[],
  frame: number,
  key: string,
): number {
  const k = currentStep(segments, frame);
  for (let j = k; j >= 0; j--) {
    const when = states[j + 1]?.traces[key];
    const segment = segments[j + 1];
    if (when === undefined || !segment) continue;
    const start = segment.from + STEP_SETTLE_FRAMES;
    const cue = when ? cueFrame(segment, when) : null;
    const end = Math.max(start + TRACE_MIN, cue ?? segment.voiceFrom + segment.speakingFrames);
    return interpolate(frame, [start, end], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  }
  return 1;
}

/** An item's colour now: its tint's tone, or its own. */
function colourOf(s: StateFrame, key: string, own: Tone) {
  const mix = tintMix(s, key);
  return { tone: mainTone(mix) ?? own, opacity: dimOpacity(mix) };
}

const glowOf = (e: Emphasis) =>
  e.glow > 0
    ? {
        filter: `drop-shadow(0 0 ${3 * e.glow}px ${colors.accent}) drop-shadow(0 0 ${14 * e.glow}px ${colors.accentGlow})`,
      }
    : undefined;

export const MapDiagram: React.FC<SceneProps<MapScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = headerBox(scene);
  const states = useMemo(() => sceneStates(scene), [scene]);
  const layout = useMemo(() => mapLayout(scene, stage), [scene, stage.width, stage.height]);
  const items = useMemo(() => mapItems(scene), [scene]);
  const land = useMemo(() => {
    const out: { code: string; d: string }[] = [];
    for (const c of countriesAt(layout.detail).values()) {
      const d = geoPathOf(layout.proj, c.geometry);
      if (d) out.push({ code: c.code, d });
    }
    return { countries: out, sphere: geoPathOf(layout.proj, layout.proj.world) };
  }, [layout]);
  const regionPaths = useMemo(
    () =>
      new Map(
        [...items].flatMap(([key, item]) => {
          if (item.kind !== 'region') return [];
          const geometry = item.countries
            ? {
                type: 'MultiPolygon',
                coordinates: item.countries.flatMap(
                  (c) => countriesAt(layout.detail).get(c)?.geometry.coordinates ?? [],
                ),
              }
            : item.geometry;
          return [[key, geoPathOf(layout.proj, geometry)]];
        }),
      ),
    [items, layout],
  );
  const marks = useMemo(() => mapTargets(scene), [scene]);
  const stopsOf = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const r of scene.routes ?? [])
      for (const stop of r.stops)
        if (typeof stop === 'string') out.set(`mp:${stop}`, [...(out.get(`mp:${stop}`) ?? []), `mr:${r.id}`]);
    return out;
  }, [scene]);
  const s = stateFrame(states, segments, frame);
  const focus = focusSpotlight(scene, hunks, segments, frame);
  const k = currentStep(segments, frame);
  const camera: Camera =
    k < 0 ? layout.cameras[0]! : zoomBetween(layout.cameras[k]!, layout.cameras[k + 1]!, s.t, stage);
  const base = focus('m:map');
  const appear = spring({ frame: frame - START, fps, config: { damping: 18, stiffness: 140 } });
  const view = `translate(${camera.x} ${camera.y}) scale(${camera.k})`;
  // A lit route lights the places it stops at.
  const lightOf = (key: string) =>
    [base, ...(stopsOf.get(key) ?? []).map(focus)].reduce((a, b) => brighter(a, b), focus(key));
  const scaled = { vectorEffect: 'non-scaling-stroke' as const };

  const paths = [...items].flatMap(([key, item]) => {
    if (item.kind !== 'route' && item.kind !== 'line') return [];
    const shown = shownOf(s, key);
    const traced = traceProgress(states, segments, frame, key);
    const drawing = traced < 1 && !s.now.hidden[key];
    if ((shown <= 0 && !drawing) || traced <= 0) return [];
    const path = partialPath(item.path, traced);
    const e = lightOf(key);
    const { tone, opacity } = colourOf(s, key, item.tone ?? DEFAULT_TONE[item.kind]);
    const head = drawing ? onScreen(layout.proj, camera, path[path.length - 1]!) : null;
    return [
      {
        key,
        d: geoPathOf(layout.proj, { type: 'LineString', coordinates: path }),
        e,
        color: tones[tone].color,
        opacity: (drawing ? 1 : shown) * e.opacity * opacity,
        width: item.kind === 'route' ? 4 : 3,
        head,
        traced,
      },
    ];
  });
  const labels = mapLabels(scene, layout.proj, camera, stage, s.now);
  const traceOf = new Map(paths.map((p) => [p.key, p.traced]));

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} aside={<HeaderCallout scene={scene} s={s} />}>
      <svg
        width={stage.width}
        height={stage.height}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          overflow: 'hidden',
          opacity: Math.min(1, appear),
          borderRadius: 18,
        }}
      >
        <rect width={stage.width} height={stage.height} fill={colors.bg} />
        <g transform={view}>
          <path d={land.sphere} fill={OCEAN} stroke={BORDER} strokeWidth={1.5} style={scaled} />
          {land.countries.map(({ code, d }) => {
            const key = `mc:${code}`;
            const e = lightOf(key);
            const mix = tintMix(s, key);
            const tone = mainTone(mix);
            return (
              <path
                key={code}
                d={d}
                fill={tone ? tintFill(tones[tone].color) : LAND}
                stroke={tone ? tones[tone].color : e.glow > 0 ? colors.accent : BORDER}
                strokeWidth={tone || e.glow > 0 ? 2 : 1}
                strokeLinejoin="round"
                opacity={e.opacity * dimOpacity(mix)}
                style={{ ...scaled, ...glowOf(e) }}
              />
            );
          })}
          {[...regionPaths].map(([key, d]) => {
            const item = items.get(key)!;
            const shown = shownOf(s, key);
            if (shown <= 0 || !d) return null;
            const e = lightOf(key);
            const { tone, opacity } = colourOf(s, key, item.tone ?? DEFAULT_TONE.region);
            return (
              <path
                key={key}
                d={d}
                fill={tintFill(tones[tone].color)}
                stroke={tones[tone].color}
                strokeWidth={2.5}
                strokeLinejoin="round"
                opacity={shown * e.opacity * opacity}
                style={{ ...scaled, ...glowOf(e) }}
              />
            );
          })}
          {paths.map((p) => (
            <path
              key={p.key}
              d={p.d}
              fill="none"
              stroke={p.color}
              strokeWidth={p.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={p.opacity}
              style={{ ...scaled, ...glowOf(p.e) }}
            />
          ))}
        </g>
        {paths.map((p) =>
          p.head ? (
            <circle
              key={`${p.key}.head`}
              cx={p.head[0]}
              cy={p.head[1]}
              r={7}
              fill={p.color}
              stroke={colors.bg}
              strokeWidth={3}
            />
          ) : null,
        )}
        {labels.map((l) => {
          const item = items.get(l.key)!;
          const shown = shownOf(s, l.key);
          const e = lightOf(l.key);
          const { tone, opacity } = colourOf(s, l.key, item.tone ?? DEFAULT_TONE[item.kind]);
          const traced = traceOf.get(l.key) ?? 1;
          const fade = shown * e.opacity * opacity * interpolate(traced, [0.85, 1], [0, 1], clamp);
          if (fade <= 0) return null;
          const changed = s.before.values[l.key] !== s.now.values[l.key];
          return (
            <g key={l.key} opacity={fade} style={glowOf(e)}>
              {l.dot ? (
                <circle
                  cx={l.anchor[0]}
                  cy={l.anchor[1]}
                  r={DOT_RADIUS}
                  fill={tones[tone].color}
                  stroke={colors.bg}
                  strokeWidth={3}
                />
              ) : null}
              {l.box ? (
                <text
                  x={l.box.x}
                  y={l.box.y + l.box.height / 2}
                  dominantBaseline="central"
                  fontFamily={fonts.sans}
                  fontWeight={LABEL_FONT.weight}
                  fontSize={LABEL_FONT.size}
                  fill={item.kind === 'place' ? colors.text : tones[tone].color}
                  stroke={colors.bg}
                  strokeWidth={6}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  opacity={changed ? 0.35 + 0.65 * s.t : 1}
                >
                  {l.text}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={(i) => marks[i] ?? null} />
    </SceneShell>
  );
};
