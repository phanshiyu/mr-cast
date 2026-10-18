import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { cellKey } from '../../shared/arrays.mjs';
import { sceneStates } from '../../shared/state-steps.mjs';
import type { Fit } from '../../shared/textfit.mjs';
import { headerBox } from '../fit/shell';
import type { ArrayScene } from '../types';
import { ARROW_LEN, BAND_H, BAND_PAD, CHIP_H, bandBox, cellBox, chipY, ghostBox, ghostShown, layoutArray, pointerLanes, pointerX, type ArrayLayout, type PlacedRow } from '../utils/arrayLayout';
import { asBrightAs, focusSpotlight, type Emphasis } from '../utils/spotlight';
import { placeOf, shownOf, stateFrame, valueChanged, type StateFrame } from '../utils/stateTrack';
import { dimOpacity, mainTone, tintFill, tintMix } from '../utils/tint';
import { FitText } from './FitText';
import { HeaderCallout } from './HeaderCallout';
import { PenMarks } from './PenMarks';
import { arrayTargets } from '../utils/sceneTargets';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, fonts } from './theme';
import { tones } from './tones';

const START = 6;
/** Frames by which every cell has started to land; pointers and ranges follow, all in by the build's end. */
const CELLS_END = 18;
const MARKERS_IN = 22;
/** A pointy-top hexagon in its cell's box. */
const HEX_POINTS = '50,0 100,25 100,75 50,100 0,75 0,25';

const hexAlpha = (alpha: number) => Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
/** A focus ring and glow, as the other diagrams draw a lit item. */
const litRing = (color: string, glow: number) => (glow > 0 ? `0 0 0 ${3 * glow}px ${color}, 0 0 ${36 * glow}px ${color}${hexAlpha(0.45 * glow)}` : '');
const shadows = (...parts: string[]) => parts.filter(Boolean).join(', ') || 'none';

/** A value centred in its cell, sliding by `shift` (a share of the cell's height). */
const Value: React.FC<{ fit: Fit; opacity: number; shift: number; height: number; color: string }> = ({ fit, opacity, shift, height, color }) =>
  opacity > 0 ? (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity, transform: `translateY(${shift * height}px)` }}>
      <FitText fit={fit} align="center" style={{ color }} />
    </div>
  ) : null;

/** Fills over a cell: a range's band colour where it covers the cell, and the cell's own tint. */
type Fill = { color: string; amount: number };

const Cell: React.FC<{ layout: ArrayLayout; cell: string; s: StateFrame; emphasis: Emphasis; pop: number; fills: Fill[] }> = ({ layout, cell, s, emphasis, pop, fills }) => {
  const [was, now] = [String(s.before.values[cell]), String(s.now.values[cell])];
  const changed = valueChanged(s, cell);
  const lit = changed ? s.lit : 0;
  const box = cellBox(layout, cell);
  const empty = now === '' && (!changed || s.t >= 1);
  const mix = tintMix(s, cell);
  const tone = mainTone(mix);
  const ink = mix.dim > 0.5 ? colors.muted : colors.text;
  const edge = emphasis.glow > 0 ? colors.accent : lit > 0 ? `rgba(242,244,248,${0.25 + 0.6 * lit})` : tone ? `${tones[tone].color}cc` : colors.borderStrong;
  const all = [...fills, ...mix.tones.map((t) => ({ color: tintFill(tones[t.tone].color), amount: t.amount }))];
  const values = changed ? (
    <>
      <Value fit={layout.values.get(was)!} opacity={1 - s.t} shift={-0.5 * s.t} height={box.height} color={ink} />
      <Value fit={layout.values.get(now)!} opacity={s.t} shift={0.5 * (1 - s.t)} height={box.height} color={ink} />
    </>
  ) : (
    <Value fit={layout.values.get(now)!} opacity={1} shift={0} height={box.height} color={ink} />
  );
  const place = {
    position: 'absolute' as const,
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    opacity: pop * emphasis.opacity * dimOpacity(mix),
    transform: `translateY(${(1 - pop) * 22}px) scale(${1 + 0.015 * emphasis.glow})`,
  };
  if (layout.hex) {
    const glow = emphasis.glow > 0 ? `drop-shadow(0 0 ${14 * emphasis.glow}px ${colors.accent})` : lit > 0 ? `drop-shadow(0 0 ${14 * lit}px rgba(242,244,248,0.5))` : 'none';
    return (
      <div style={{ ...place, filter: glow }}>
        <svg width={box.width} height={box.height} viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <polygon points={HEX_POINTS} fill={empty ? 'rgba(255,255,255,0.025)' : colors.raised} />
          {all.map((f, i) => (f.amount > 0 ? <polygon key={i} points={HEX_POINTS} fill={f.color} opacity={Math.min(1, f.amount)} /> : null))}
          {lit > 0 ? <polygon points={HEX_POINTS} fill={`rgba(242,244,248,${0.14 * lit})`} /> : null}
          <polygon points={HEX_POINTS} fill="none" stroke={edge} strokeWidth={emphasis.glow > 0 ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        {values}
      </div>
    );
  }
  return (
    <div
      style={{
        ...place,
        boxSizing: 'border-box',
        borderRadius: 12,
        overflow: 'hidden',
        background: empty ? 'rgba(255,255,255,0.025)' : colors.raised,
        border: `1.5px solid ${edge}`,
        boxShadow: shadows(litRing(colors.accent, emphasis.glow), lit > 0 ? `0 0 ${34 * lit}px rgba(242,244,248,${0.35 * lit})` : '', '0 10px 26px rgba(0,0,0,0.35)'),
      }}
    >
      {all.map((f, i) => (f.amount > 0 ? <div key={i} style={{ position: 'absolute', inset: 0, background: f.color, opacity: Math.min(1, f.amount) }} /> : null))}
      {lit > 0 ? <div style={{ position: 'absolute', inset: 0, background: `rgba(242,244,248,${0.14 * lit})` }} /> : null}
      {values}
    </div>
  );
};

/** A slot past either end of an array, drawn while a pointer stands there. */
const Ghost: React.FC<{ layout: ArrayLayout; row: PlacedRow; index: number; pop: number }> = ({ layout, row, index, pop }) => {
  const box = ghostBox(layout, row, index);
  return <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.width, height: box.height, boxSizing: 'border-box', borderRadius: 12, border: `2px dashed ${colors.borderStrong}`, opacity: 0.8 * pop }} />;
};

export const ArrayDiagram: React.FC<SceneProps<ArrayScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = headerBox(scene);
  const layout = useMemo(() => layoutArray(scene, box), [scene, box.width, box.height]);
  const states = useMemo(() => sceneStates(scene), [scene]);
  const stage = { left: Math.round((box.width - layout.width) / 2), top: Math.round(Math.max(0, box.height - layout.height) * 0.4), scale: 1 };
  const marks = useMemo(() => arrayTargets(scene), [scene]);
  const s = stateFrame(states, segments, frame);
  const focus = focusSpotlight(scene, hunks, segments, frame);
  const longest = Math.max(...layout.rows.map((r) => r.count));
  const stagger = Math.min(3, (CELLS_END - START) / Math.max(1, longest + layout.rows.length - 2));
  const popAt = (row: PlacedRow, i: number) => spring({ frame: frame - START - (Math.max(0, i) + layout.rows.indexOf(row)) * stagger, fps, config: { damping: 16, stiffness: 150 } });
  const markersIn = interpolate(frame, [MARKERS_IN, MARKERS_IN + 10], [0, 1], clamp);
  const lanes = { before: pointerLanes(scene, s.before), now: pointerLanes(scene, s.now) };
  /** How shown each array is, fading with the step that shows or hides it. */
  const rowShown = new Map(layout.rows.map((row) => [row.name, shownOf(s, row.key)]));
  /** Where a range spans now, and how shown it is. */
  const spans = layout.ranges.map((r) => ({ ...r, place: placeOf(s, `rg:${r.name}`), shown: shownOf(s, `rg:${r.name}`) * markersIn * rowShown.get(r.row)! }));
  const pointers = layout.pointers.map((p) => {
    const key = `ptr:${p.name}`;
    const now = lanes.now.get(p.name);
    const was = lanes.before.get(p.name) ?? now;
    const lane = now === undefined ? (was ?? 0) : (was ?? now) + (now - (was ?? now)) * s.t;
    const at = s.now.hidden[key] ? s.before.places[key]![0] : s.before.hidden[key] ? s.now.places[key]![0] : placeOf(s, key)[0];
    return { ...p, key, lane, at, shown: shownOf(s, key) * markersIn * rowShown.get(p.row)! };
  });

  const cellEmphasis = (row: PlacedRow, i: number): Emphasis =>
    asBrightAs(focus(cellKey(row.name, i)), [
      focus(row.key),
      ...pointers.filter((p) => p.row === row.name && p.shown > 0.5 && Math.round(p.at) === i).map((p) => focus(p.key)),
      ...spans.filter((r) => r.row === row.name && r.shown > 0.5 && i >= Math.round(r.place[0]) && i <= Math.round(r.place[1])).map((r) => focus(`rg:${r.name}`)),
    ]);
  /** How much of cell i a range covers while it moves, 0 to 1. */
  const cover = (i: number, [a, b]: readonly [number, number]) => Math.max(0, Math.min(b + 1, i + 1) - Math.max(a, i));
  const rightEdge = (box.width + layout.width) / 2;

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} aside={<HeaderCallout scene={scene} s={s} />}>
      <div style={{ position: 'absolute', left: stage.left, top: stage.top, width: layout.width, height: layout.height }}>
        {layout.rows.map((row) => {
          const shown = rowShown.get(row.name)!;
          if (shown <= 0) return null;
          const slots = [...(row.ghosts.left ? [-1] : []), ...Array.from({ length: row.count }, (_, i) => i), ...(row.ghosts.right ? [row.count] : [])];
          return (
            <div key={row.key} style={{ position: 'absolute', inset: 0, opacity: shown }}>
              {row.label ? <FitText fit={row.label} style={{ position: 'absolute', left: row.labelX, top: row.labelY, color: colors.muted, opacity: interpolate(frame, [START, START + 10], [0, 1], clamp) }} /> : null}
              {slots.map((i) => {
                const pop = popAt(row, i);
                if (i < 0 || i >= row.count) return <Ghost key={i} layout={layout} row={row} index={i} pop={pop * ghostShown(pointers, row.name, i)} />;
                const fills = spans.filter((r) => r.row === row.name).map((r) => ({ color: tones[r.tone].bg, amount: 1.4 * r.shown * cover(i, r.place) }));
                return <Cell key={i} layout={layout} cell={cellKey(row.name, i)} s={s} emphasis={cellEmphasis(row, i)} pop={pop} fills={fills} />;
              })}
              {layout.indexes
                ? slots.map((i) => {
                    const lit = i >= 0 && i < row.count && cellEmphasis(row, i).glow > 0;
                    return (
                      <div
                        key={`i${i}`}
                        style={{
                          position: 'absolute',
                          left: ghostBox(layout, row, i).x,
                          width: layout.cellW,
                          top: row.indexY,
                          textAlign: 'center',
                          fontFamily: fonts.mono,
                          fontSize: 19,
                          fontWeight: lit ? 700 : 500,
                          color: lit ? colors.accent : colors.faint,
                          opacity: popAt(row, i) * (i < 0 || i >= row.count ? ghostShown(pointers, row.name, i) : 1),
                        }}
                      >
                        {i}
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
        {spans.map((r) => {
          if (r.shown <= 0) return null;
          const band = bandBox(layout, r.row, r.y, r.place);
          const tone = tones[r.tone];
          const e = focus(`rg:${r.name}`);
          const inside = r.fit.width + 2 * BAND_PAD <= band.width;
          const labelLeft = inside ? band.x + BAND_PAD : band.x + band.width + 12 + r.fit.width <= rightEdge ? band.x + band.width + 12 : band.x - 12 - r.fit.width;
          return (
            <div key={r.name} style={{ opacity: r.shown * e.opacity }}>
              <div
                style={{
                  position: 'absolute',
                  left: band.x,
                  top: band.y,
                  width: band.width,
                  height: BAND_H,
                  boxSizing: 'border-box',
                  borderRadius: 10,
                  background: `repeating-linear-gradient(135deg, ${tone.bg}, ${tone.bg} 10px, transparent 10px, transparent 18px), ${tone.bg}`,
                  border: `1.5px solid ${tone.color}${e.glow > 0 ? '' : '99'}`,
                  boxShadow: shadows(litRing(tone.color, e.glow)),
                }}
              />
              <FitText fit={r.fit} style={{ position: 'absolute', left: labelLeft, top: band.y + (BAND_H - r.fit.height) / 2, color: tone.color, whiteSpace: 'nowrap' }} />
            </div>
          );
        })}
        {pointers.map((p) => {
          if (p.shown <= 0) return null;
          const row = layout.rows.find((r) => r.name === p.row)!;
          const tone = tones[p.tone];
          const e = focus(p.key);
          const x = pointerX(layout, p.row, p.at);
          const top = chipY(row, p.lane);
          const arrow = Math.max(0, 1 - p.lane);
          return (
            <div key={p.name} style={{ opacity: p.shown * e.opacity, transform: `translateY(${(1 - p.shown) * -14}px)` }}>
              <div
                style={{
                  position: 'absolute',
                  left: x + 4,
                  top,
                  width: layout.cellW - 8,
                  height: CHIP_H,
                  boxSizing: 'border-box',
                  borderRadius: 9,
                  background: colors.bg,
                  border: `2px solid ${tone.color}`,
                  boxShadow: shadows(`inset 0 0 0 40px ${tone.bg}`, litRing(tone.color, e.glow)),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: `scale(${1 + 0.06 * e.glow})`,
                }}
              >
                <FitText fit={p.fit} style={{ color: tone.color }} />
              </div>
              {arrow > 0 ? (
                <svg style={{ position: 'absolute', left: x, top: row.cellsY - ARROW_LEN, overflow: 'visible', opacity: arrow }} width={layout.cellW} height={ARROW_LEN}>
                  <line x1={layout.cellW / 2} x2={layout.cellW / 2} y1={2} y2={ARROW_LEN - 9} stroke={tone.color} strokeWidth={3} strokeLinecap="round" />
                  <path d={`M ${layout.cellW / 2 - 7} ${ARROW_LEN - 12} L ${layout.cellW / 2} ${ARROW_LEN - 3} L ${layout.cellW / 2 + 7} ${ARROW_LEN - 12}`} fill="none" stroke={tone.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </div>
          );
        })}
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={(k) => marks[k] ?? null} />
    </SceneShell>
  );
};
