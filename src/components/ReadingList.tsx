import { useMemo } from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { readingOrder } from '../../shared/reading.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import type { ReadingScene } from '../types';
import { COL_GAP, HEAD_H, MORE_H, NUMBER_W, ROW_PAD_X, layoutReading, type PlacedItem, type ReadingLayout } from '../utils/readingLayout';
import { FitText } from './FitText';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { colors, contentBox, fonts, severityInk } from './theme';

const START = 12;

const Row: React.FC<{ row: PlacedItem; layout: ReadingLayout; at: number }> = ({ row, layout, at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const land = spring({ frame: frame - at, fps, config: { damping: 17, stiffness: 120 } });
  const ink = row.item.finding ? severityInk[row.item.finding.severity] : colors.accent;
  const pad = (row.h - Math.max(1, row.check.lines.length) * layout.lineHeight - (row.flag ? 6 + row.flag.height : 0)) / 2;
  const leftPad = (row.h - row.where.height - (row.explained ? row.explained.height + 4 : 0)) / 2;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: row.y,
        height: row.h,
        borderRadius: 14,
        background: 'rgba(255,255,255,0.03)',
        boxShadow: `inset 0 0 0 1px ${row.item.finding ? `${ink}66` : colors.border}`,
        opacity: land,
        transform: `translateX(${(1 - land) * -40}px)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: ROW_PAD_X,
          top: (row.h - NUMBER_W) / 2,
          width: NUMBER_W,
          height: NUMBER_W,
          borderRadius: 999,
          border: `2px solid ${ink}99`,
          background: `${ink}1f`,
          color: ink,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.mono,
          fontSize: 24,
          fontWeight: 800,
        }}
      >
        {row.item.number}
      </div>
      <div style={{ position: 'absolute', left: layout.whereX, width: layout.whereW, top: leftPad }}>
        <FitText fit={row.where} style={{ color: colors.text }} />
        {row.explained ? <FitText fit={row.explained} style={{ marginTop: 4, color: colors.muted }} /> : null}
      </div>
      <div style={{ position: 'absolute', left: layout.checkX, width: layout.checkW, top: pad }}>
        <FitText fit={row.check} style={{ lineHeight: `${layout.lineHeight}px`, color: colors.text }} />
        {row.flag ? <FitText fit={row.flag} style={{ marginTop: 6, color: ink }} /> : null}
      </div>
    </div>
  );
};

/** A pre-read's handoff: the first items of the reading order, numbered, and how many more reading.md lists. */
export const ReadingList: React.FC<SceneProps<ReadingScene>> = ({ scene, storyboard, hunks, durationInFrames }) => {
  const box = contentBox(Boolean(scene.title));
  const order = useMemo(() => readingOrder(storyboard, hunks), [storyboard, hunks]);
  const layout = useMemo(() => (order ? layoutReading(order, scene.items, box.width, box.height) : null), [order, scene.items, box.width, box.height]);
  const frame = useCurrentFrame();
  if (!order || !layout) return <SceneShell scene={scene} durationInFrames={durationInFrames}>{null}</SceneShell>;
  const stagger = Math.min(8, (buildFrames('reading') - START - 14) / Math.max(1, layout.rows.length - 1));
  const moreAt = START + layout.rows.length * stagger;
  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: box.width, height: layout.height + (layout.more ? MORE_H : 0) }}>
        <div style={{ position: 'absolute', left: ROW_PAD_X, top: 0, height: HEAD_H - 10, color: colors.muted, fontSize: 20, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase' }}>
          Read first
        </div>
        {layout.rows.map((row, i) => (
          <Row key={row.item.hunkId} row={row} layout={layout} at={START + i * stagger} />
        ))}
        {layout.more ? (
          <div
            style={{
              position: 'absolute',
              left: ROW_PAD_X + NUMBER_W + COL_GAP,
              top: layout.height + 14,
              color: colors.muted,
              fontSize: 22,
              opacity: Math.min(1, Math.max(0, (frame - moreAt) / 10)),
            }}
          >
            +{layout.more} routine {layout.more === 1 ? 'change' : 'changes'}, listed in <span style={{ fontFamily: fonts.mono }}>reading.md</span>
          </div>
        ) : null}
      </div>
    </SceneShell>
  );
};
