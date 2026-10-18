import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildFrames } from '../../shared/timing.mjs';
import type { Change, TableScene } from '../types';
import { brighter, focusSpotlight, spotlight, spotlightStarts, type Emphasis } from '../utils/spotlight';
import { sameValue, sceneStates } from '../../shared/state-steps.mjs';
import { headerBox } from '../fit/shell';
import { COL_GAP, HEADER_H, MARKER_W, PAD_X, ROW_BADGE, layoutTableStates, stateRows, type PlacedCell, type PlacedRow, type TableLayout } from '../utils/tableLayout';
import { shownOf, stateFrame, type StateFrame } from '../utils/stateTrack';
import { dimOpacity, mainTone, tintFill, tintMix } from '../utils/tint';
import { HeaderCallout } from './HeaderCallout';
import { tones } from './tones';
import { PenMarks } from './PenMarks';
import { tableTargets } from '../utils/sceneTargets';
import { ChangeLegend } from './ChangeLegend';
import { badgesOf, changeTone, RowBadges } from './marks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { FitText } from './FitText';
import { clamp, colors, fonts } from './theme';

const START = 10;
/** Every row has started landing by this frame, so all have landed by the end of the build. */
const ROWS_END = 26;
const STRUCK = '#c98a93';

/** Without steps, the rows the narration walks: `highlight`, or else every changed row top to bottom. */
function highlightRows(scene: TableScene, layout: TableLayout): number[] {
  if (scene.highlight?.length) return scene.highlight;
  return layout.rows.flatMap((r, i) => (r.change ? [i] : []));
}

const Struck: React.CSSProperties = { color: STRUCK, textDecoration: 'line-through', textDecorationColor: colors.del, textDecorationThickness: 2.5 };

/** `ink` colours a changed cell's new value, as the tint of its row or cell does; green otherwise, as in a diff. */
const Cell: React.FC<{ cell: PlacedCell; first: boolean; removed: boolean; layout: TableLayout; ink?: string }> = ({ cell, first, removed, layout, ink }) => {
  const base: React.CSSProperties = {
    lineHeight: `${layout.lineHeight}px`,
    color: removed ? colors.muted : first ? colors.text : '#d5d9e3',
    ...(removed ? { textDecoration: 'line-through', textDecorationColor: colors.del, textDecorationThickness: 2.5 } : null),
  };
  if (cell.kind === 'text') return <FitText fit={cell.text} style={base} />;
  const after: React.CSSProperties = { ...base, color: ink ?? colors.add };
  if (cell.inline) {
    return (
      <div style={{ display: 'flex', gap: '0.4em', fontSize: cell.after.size, lineHeight: `${layout.lineHeight}px` }}>
        <FitText fit={cell.before} style={{ ...base, ...Struck }} />
        <span style={{ color: colors.faint, fontFamily: cell.mono ? fonts.mono : fonts.sans }}>→</span>
        <FitText fit={cell.after} style={after} />
      </div>
    );
  }
  return (
    <div>
      <FitText fit={cell.before} style={{ ...base, ...Struck }} />
      <FitText fit={cell.after} style={after} />
    </div>
  );
};

/** One row as a step finds and leaves it: where it sits before and after, and how far the step has gone. */
interface RowMotion {
  was: PlacedRow;
  now: PlacedRow;
  index: number;
  s: StateFrame;
}

const Row: React.FC<{ motion: RowMotion; layout: TableLayout; at: number; emphasis: Emphasis; cellGlow: (col: number) => number; frame: number }> = ({
  motion,
  layout,
  at,
  emphasis,
  cellGlow,
  frame,
}) => {
  const { fps } = useVideoConfig();
  const { was, now: placed, index, s } = motion;
  const shown = shownOf(s, `r:${index}`);
  const land = spring({ frame: frame - at, fps, config: { damping: 17, stiffness: 120 } });
  const flash = interpolate(frame, [at + 4, at + 10, at + 30], [0, 1, 0], clamp);
  const tone = placed.change ? changeTone[placed.change] : null;
  const removed = placed.change === 'removed';
  const pad = Math.round(layout.font * 0.5);
  const mix = tintMix(s, `r:${index}`);
  const tinted = mainTone(mix);
  const tint = tone && placed.change !== 'modified' ? tone.bg : `rgba(255,255,255,${0.025 + 0.05 * flash})`;
  const ring = tinted ? `inset 0 0 0 1.5px ${tones[tinted].color}aa` : tone ? `inset 0 0 0 1px ${tone.color}${placed.change === 'modified' ? '44' : '55'}` : `inset 0 0 0 1px ${colors.border}`;
  const y = was.y + (placed.y - was.y) * s.t;
  const h = was.h + (placed.h - was.h) * s.t;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: y,
        width: layout.width,
        height: h,
        borderRadius: 14,
        background: tint,
        boxShadow: `${ring}, 0 0 ${26 * flash + 34 * emphasis.glow}px ${(tone?.color ?? colors.accent) + '44'}`,
        opacity: land * shown * emphasis.opacity * dimOpacity(mix) * (removed ? 0.85 : 1),
        transform: `translateX(${(1 - land * shown) * -40}px) scale(${1 + 0.008 * emphasis.glow})`,
      }}
    >
      {mix.tones.map((t, i) => (t.amount > 0 ? <div key={`t${i}`} style={{ position: 'absolute', inset: 0, borderRadius: 14, background: tintFill(tones[t.tone].color), opacity: t.amount }} /> : null))}
      {placed.cells.map((_, i) => {
        const cell = tintMix(s, `x:${index}/${i}`);
        return cell.tones.map((t, j) =>
          t.amount > 0 ? (
            <div key={`c${i}-${j}`} style={{ position: 'absolute', left: layout.cols[i]!.x - COL_GAP / 3, width: layout.cols[i]!.w + (2 * COL_GAP) / 3, top: 4, bottom: 4, borderRadius: 10, background: tintFill(tones[t.tone].color), boxShadow: `inset 0 0 0 1.5px ${tones[t.tone].color}aa`, opacity: t.amount }} />
          ) : null,
        );
      })}
      {emphasis.glow > 0 ? (
        <div style={{ position: 'absolute', inset: 0, borderRadius: 14, background: `rgba(124, 140, 255, ${0.1 * emphasis.glow})`, boxShadow: `inset 0 0 0 2px ${colors.accent}${Math.round(emphasis.glow * 160).toString(16).padStart(2, '0')}` }} />
      ) : null}
      {emphasis.bar > 0 ? (
        <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 5, borderRadius: 3, background: colors.accent, opacity: emphasis.bar }} />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: PAD_X,
          width: MARKER_W,
          top: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          fontFamily: fonts.mono,
          fontWeight: 800,
          fontSize: Math.max(20, layout.font),
          color: tone?.color ?? 'transparent',
        }}
      >
        {tone?.marker ?? ''}
      </div>
      {placed.cells.map((_, i) =>
        cellGlow(i) > 0 ? (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: layout.cols[i]!.x - COL_GAP / 3,
              width: layout.cols[i]!.w + (2 * COL_GAP) / 3,
              top: 4,
              bottom: 4,
              borderRadius: 10,
              background: `rgba(124, 140, 255, ${0.16 * cellGlow(i)})`,
              boxShadow: `inset 0 0 0 2px ${colors.accent}${Math.round(cellGlow(i) * 200).toString(16).padStart(2, '0')}, 0 0 ${28 * cellGlow(i)}px ${colors.accentGlow}`,
            }}
          />
        ) : null,
      )}
      {placed.cells.map((cell, i) => {
        const key = `x:${index}/${i}`;
        const changed = !sameValue(s.before.values[key], s.now.values[key]);
        const own = tintMix(s, key);
        const dim = own.dim;
        const toned = mainTone(own) ?? tinted;
        const at = (c: PlacedCell, opacity: number, shift: number) => (
          <div style={{ position: 'absolute', left: layout.cols[i]!.x, width: layout.cols[i]!.w, top: pad, bottom: pad, display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: opacity * (1 - 0.5 * dim), transform: `translateY(${shift}px)` }}>
            <Cell cell={c} first={i === 0} removed={removed} layout={layout} ink={toned ? tones[toned].color : undefined} />
          </div>
        );
        return (
          <div key={i}>
            {changed ? (
              <>
                {s.t < 1 ? at(was.cells[i]!, 1 - s.t, -14 * s.t) : null}
                {at(cell, s.t, 14 * (1 - s.t))}
              </>
            ) : (
              at(cell, 1, 0)
            )}
          </div>
        );
      })}
      <RowBadges badges={badgesOf(placed.row, { change: false })} size={ROW_BADGE} right={18} />
    </div>
  );
};

/** A table's headers and rows at one moment of a step, placed at `left` and `top`: the table scene's body, and the table beside a graph. */
export const TableView: React.FC<{
  layout: TableLayout;
  before: TableLayout;
  s: StateFrame;
  left: number;
  top: number;
  frame: number;
  headerIn: number;
  rowAt: (row: number) => number;
  rowEmphasis: (row: number) => Emphasis;
  cellEmphasis: (row: number, col: number) => Emphasis;
  headerGlow: (col: number) => number;
}> = ({ layout, before, s, left, top, frame, headerIn, rowAt, rowEmphasis, cellEmphasis, headerGlow }) => (
  <div style={{ position: 'absolute', left, top, width: layout.width, height: layout.height, transform: `scale(${layout.scale})`, transformOrigin: 'top left' }}>
    <div style={{ position: 'absolute', left: 0, top: 0, width: layout.width, height: HEADER_H, opacity: headerIn }}>
      {layout.headers.map((header, i) => (
        <FitText key={i} fit={header} style={{ position: 'absolute', left: layout.cols[i]!.x, top: 8, lineHeight: 'normal', color: headerGlow(i) > 0 ? colors.accent : colors.faint }} />
      ))}
    </div>
    {layout.rows.map((placed, i) => (
      <Row key={i} motion={{ was: before.rows[i]!, now: placed, index: i, s }} layout={layout} at={rowAt(i)} emphasis={rowEmphasis(i)} cellGlow={(col) => cellEmphasis(i, col).glow} frame={frame} />
    ))}
  </div>
);

export const DataTable: React.FC<SceneProps<TableScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const box = headerBox(scene);
  const states = useMemo(() => sceneStates(scene), [scene]);
  const layouts = useMemo(() => layoutTableStates(scene.columns, stateRows(scene.columns, scene.rows, states), box.width, box.height), [scene, states, box.width, box.height]);
  const s = stateFrame(states, segments, frame);
  const layout = layouts[states.indexOf(s.now)]!;
  const before = layouts[states.indexOf(s.before)]!;
  const rowStagger = Math.min(5, (ROWS_END - START - 6) / Math.max(1, layout.rows.length - 1));
  const rowAt = (i: number) => START + 6 + i * rowStagger;
  // With steps, each lights its rows, columns or cells; a row stays bright while any of its cells is lit.
  // Without, the narration walks `highlight` or the changed rows.
  const focus = focusSpotlight(scene, hunks, segments, frame);
  const walked = highlightRows(scene, layout);
  const { emphasis } = spotlight(frame, spotlightStarts(segments, walked.length, buildFrames('table')));
  const cellEmphasis = (row: number, col: number) => brighter(focus(`c:${col}`), focus(`x:${row}/${col}`));
  const rowEmphasis = (row: number): Emphasis => {
    if (!scene.steps?.length) return emphasis(walked.includes(row) ? [walked.indexOf(row)] : []);
    const own = focus(`r:${row}`);
    return { ...own, opacity: Math.max(own.opacity, ...scene.columns.map((_, col) => cellEmphasis(row, col).opacity)) };
  };
  const headerIn = interpolate(frame, [START, START + 10], [0, 1], clamp);
  const top = Math.max(0, box.height - layout.height * layout.scale) * 0.3;
  const marks = useMemo(() => tableTargets(scene), [scene]);
  const used = new Set<Change>(layout.rows.flatMap((r) => (r.change ? [r.change] : [])));

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} camera={{ hunks, segments, targets: (k) => marks[k] ?? null }} aside={<><ChangeLegend used={used} /><HeaderCallout scene={scene} s={s} /></>}>
      <TableView layout={layout} before={before} s={s} left={0} top={top} frame={frame} headerIn={headerIn} rowAt={rowAt} rowEmphasis={rowEmphasis} cellEmphasis={cellEmphasis} headerGlow={(i) => focus(`c:${i}`).glow} />
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={(k) => marks[k] ?? null} />
    </SceneShell>
  );
};
