import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildFrames } from '../../shared/timing.mjs';
import type { Change, TableScene } from '../types';
import { brighter, focusSpotlight, spotlight, spotlightStarts, type Emphasis } from '../utils/spotlight';
import { COL_GAP, HEADER_FONT, HEADER_H, MARKER_W, PAD_X, cellFont, layoutTable, type PlacedCell, type PlacedRow, type TableLayout } from '../utils/tableLayout';
import { ChangeLegend, changeTone } from './ChangeLegend';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, defaultChapter, ellipsis, fonts } from './theme';

const START = 10;
/** Every row has started landing by this frame, so all have landed by the end of the build. */
const ROWS_END = 26;
const STRUCK = '#c98a93';

/** Without steps, the rows the narration walks: `highlight`, or else every changed row top to bottom. */
function highlightRows(scene: TableScene, layout: TableLayout): number[] {
  if (scene.highlight?.length) return scene.highlight;
  return layout.rows.flatMap((r, i) => (r.change ? [i] : []));
}

const Lines: React.FC<{ lines: string[]; style?: React.CSSProperties }> = ({ lines, style }) => (
  <>
    {lines.map((line, i) => (
      <div key={i} style={{ whiteSpace: 'nowrap', ...style }}>
        {line}
      </div>
    ))}
  </>
);

const Struck: React.CSSProperties = { color: STRUCK, textDecoration: 'line-through', textDecorationColor: colors.del, textDecorationThickness: 2.5 };

const Cell: React.FC<{ cell: PlacedCell; first: boolean; removed: boolean; layout: TableLayout }> = ({ cell, first, removed, layout }) => {
  const base: React.CSSProperties = {
    fontFamily: cell.mono ? fonts.mono : fonts.sans,
    fontSize: cellFont(layout.font, cell.mono),
    lineHeight: `${layout.lineHeight}px`,
    fontWeight: first ? 650 : 450,
    color: removed ? colors.muted : first ? colors.text : '#d5d9e3',
    ...(removed ? { textDecoration: 'line-through', textDecorationColor: colors.del, textDecorationThickness: 2.5 } : null),
  };
  if (cell.kind === 'text') return <Lines lines={cell.lines} style={base} />;
  const after: React.CSSProperties = { color: colors.add, fontWeight: 650 };
  if (cell.inline) {
    return (
      <div style={{ ...base, display: 'flex', gap: '0.4em', whiteSpace: 'nowrap' }}>
        <span style={Struck}>{cell.before[0]}</span>
        <span style={{ color: colors.faint }}>→</span>
        <span style={after}>{cell.after[0]}</span>
      </div>
    );
  }
  return (
    <div style={base}>
      <Lines lines={cell.before} style={Struck} />
      <Lines lines={cell.after} style={after} />
    </div>
  );
};

const Row: React.FC<{ placed: PlacedRow; layout: TableLayout; at: number; emphasis: Emphasis; cellGlow: (col: number) => number; frame: number }> = ({
  placed,
  layout,
  at,
  emphasis,
  cellGlow,
  frame,
}) => {
  const { fps } = useVideoConfig();
  const land = spring({ frame: frame - at, fps, config: { damping: 17, stiffness: 120 } });
  const flash = interpolate(frame, [at + 4, at + 10, at + 30], [0, 1, 0], clamp);
  const tone = placed.change ? changeTone[placed.change] : null;
  const removed = placed.change === 'removed';
  const pad = Math.round(layout.font * 0.5);
  const tint = tone && placed.change !== 'modified' ? tone.bg : `rgba(255,255,255,${0.025 + 0.05 * flash})`;
  const ring = tone ? `inset 0 0 0 1px ${tone.color}${placed.change === 'modified' ? '44' : '55'}` : `inset 0 0 0 1px ${colors.border}`;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: placed.y,
        width: layout.width,
        height: placed.h,
        borderRadius: 14,
        background: tint,
        boxShadow: `${ring}, 0 0 ${26 * flash + 34 * emphasis.glow}px ${(tone?.color ?? colors.accent) + '44'}`,
        opacity: land * emphasis.opacity * (removed ? 0.85 : 1),
        transform: `translateX(${(1 - land) * -40}px) scale(${1 + 0.008 * emphasis.glow})`,
      }}
    >
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
      {placed.cells.map((cell, i) => (
        <div key={i} style={{ position: 'absolute', left: layout.cols[i]!.x, width: layout.cols[i]!.w, top: pad, bottom: pad, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Cell cell={cell} first={i === 0} removed={removed} layout={layout} />
        </div>
      ))}
    </div>
  );
};

export const DataTable: React.FC<SceneProps<TableScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutTable(scene.columns, scene.rows, box.width, box.height), [scene.columns, scene.rows, box.width, box.height]);
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
  const used = new Set<Change>(layout.rows.flatMap((r) => (r.change ? [r.change] : [])));

  return (
    <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.table} title={scene.title} aside={<ChangeLegend used={used} />}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: Math.max(0, box.height - layout.height * layout.scale) * 0.3,
          width: layout.width,
          height: layout.height,
          transform: `scale(${layout.scale})`,
          transformOrigin: 'top left',
        }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, width: layout.width, height: HEADER_H, opacity: headerIn }}>
          {scene.columns.map((column, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: layout.cols[i]!.x,
                width: layout.cols[i]!.w + COL_GAP / 2,
                top: 8,
                fontSize: HEADER_FONT,
                fontWeight: 700,
                letterSpacing: 2.5,
                textTransform: 'uppercase',
                color: focus(`c:${i}`).glow > 0 ? colors.accent : colors.faint,
                ...ellipsis,
              }}
            >
              {column}
            </div>
          ))}
        </div>
        {layout.rows.map((placed, i) => (
          <Row key={i} placed={placed} layout={layout} at={rowAt(i)} emphasis={rowEmphasis(i)} cellGlow={(col) => cellEmphasis(i, col).glow} frame={frame} />
        ))}
      </div>
    </SceneShell>
  );
};
