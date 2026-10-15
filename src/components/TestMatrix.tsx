import { FlaskConical, FlaskConicalOff, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { TestStatus, TestsScene } from '../types';
import {
  CHECK_W,
  COL_GAP,
  GAP_MARKER_W,
  GAPS_HEADER_H,
  GAPS_PAD,
  MATRIX_HEADER_H,
  ROW_PAD_X,
  STATUS_W,
  layoutTests,
  type PlacedCase,
  type PlacedGap,
  type TestsLayout,
} from '../utils/testsLayout';
import { wrapLabel } from '../utils/wrapLabel';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, defaultChapter, fonts } from './theme';

const AMBER = '#fbbf24';
const AMBER_BG = 'rgba(251, 191, 36, 0.08)';
const START = 10;

const statusTone: Record<TestStatus, { label: string; color: string; bg: string }> = {
  added: { label: 'added', color: colors.add, bg: colors.addBg },
  modified: { label: 'changed', color: colors.accent, bg: colors.accentSoft },
  removed: { label: 'removed', color: colors.del, bg: colors.delBg },
  existing: { label: 'existing', color: colors.muted, bg: 'rgba(144, 151, 168, 0.12)' },
};
const STATUS_ORDER: TestStatus[] = ['added', 'modified', 'removed', 'existing'];

/** Frames at which each part arrives, scaled so short scenes still finish their beats. */
function buildTimeline(layout: TestsLayout, durationInFrames: number) {
  const rowsStart = START + (layout.matrix ? 8 : 18);
  const rowStagger = Math.min(16, (durationInFrames * 0.45) / Math.max(1, layout.rows.length));
  const panelAt = rowsStart + layout.rows.length * rowStagger + 10;
  const gapStagger = Math.min(18, (durationInFrames * 0.25) / Math.max(1, layout.gaps.length));
  return {
    rowAt: (i: number) => rowsStart + i * rowStagger,
    panelAt,
    gapAt: (i: number) => panelAt + 12 + i * gapStagger,
  };
}

/** A tick for a passing row, a cross for a removed test; the stroke draws in as the row lands. */
const CheckMark: React.FC<{ status: TestStatus; draw: number }> = ({ status, draw }) => {
  const tone = statusTone[status];
  const d = status === 'removed' ? 'M 11 11 L 23 23 M 23 11 L 11 23' : 'M 9 17.5 L 14.5 23 L 25 11.5';
  return (
    <svg width={34} height={34} viewBox="0 0 34 34" style={{ flexShrink: 0 }}>
      <circle cx={17} cy={17} r={15} fill={tone.bg} stroke={tone.color} strokeOpacity={0.55} strokeWidth={1.5} opacity={Math.min(1, draw * 3)} />
      <path d={d} fill="none" stroke={tone.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
    </svg>
  );
};

const StatusChip: React.FC<{ status: TestStatus }> = ({ status }) => {
  const tone = statusTone[status];
  return (
    <div
      style={{
        padding: '5px 0',
        width: STATUS_W,
        textAlign: 'center',
        boxSizing: 'border-box',
        borderRadius: 999,
        background: tone.bg,
        border: `1px solid ${tone.color}77`,
        color: tone.color,
        fontSize: 15,
        fontWeight: 800,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
      }}
    >
      {tone.label}
    </div>
  );
};

const Lines: React.FC<{ lines: string[]; style: React.CSSProperties }> = ({ lines, style }) => (
  <div style={style}>
    {lines.map((l, i) => (
      <div key={i} style={{ whiteSpace: 'nowrap' }}>
        {l}
      </div>
    ))}
  </div>
);

const CaseRow: React.FC<{ row: PlacedCase; layout: TestsLayout; at: number; frame: number }> = ({ row, layout, at, frame }) => {
  const { fps } = useVideoConfig();
  const matrix = layout.matrix!;
  const status = row.test.status ?? 'added';
  const removed = status === 'removed';
  const land = spring({ frame: frame - at, fps, config: { damping: 17, stiffness: 120 } });
  const draw = interpolate(frame, [at + 6, at + 18], [0, 1], clamp);
  const flash = interpolate(frame, [at + 4, at + 10, at + 30], [0, 1, 0], clamp);
  const tone = statusTone[status];
  const centred = (lines: string[]) => (row.h - lines.length * layout.lineHeight) / 2;

  return (
    <div
      style={{
        position: 'absolute',
        left: row.x,
        top: row.y,
        width: row.w,
        height: row.h,
        borderRadius: 14,
        background: `rgba(255,255,255,${0.025 + 0.05 * flash})`,
        boxShadow: `inset 0 0 0 1px ${colors.border}, 0 0 ${26 * flash}px ${tone.color}33`,
        opacity: land * (removed ? 0.82 : 1),
        transform: `translateX(${(1 - land) * -40}px)`,
      }}
    >
      <div style={{ position: 'absolute', left: ROW_PAD_X, top: 0, bottom: 0, width: CHECK_W, display: 'flex', alignItems: 'center' }}>
        <CheckMark status={status} draw={draw} />
      </div>
      <div style={{ position: 'absolute', left: ROW_PAD_X + CHECK_W + COL_GAP, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
        <StatusChip status={status} />
      </div>
      <Lines
        lines={row.name}
        style={{
          position: 'absolute',
          left: matrix.nameX,
          width: matrix.nameW,
          top: centred(row.name),
          fontFamily: fonts.mono,
          fontSize: layout.nameFont,
          lineHeight: `${layout.lineHeight}px`,
          fontWeight: 600,
          color: removed ? colors.muted : colors.text,
          textDecoration: removed ? 'line-through' : 'none',
          textDecorationColor: colors.del,
          textDecorationThickness: 2.5,
        }}
      />
      <Lines
        lines={row.proves}
        style={{
          position: 'absolute',
          left: matrix.provesX,
          width: matrix.provesW,
          top: centred(row.proves),
          fontSize: layout.font,
          lineHeight: `${layout.lineHeight}px`,
          color: removed ? colors.faint : '#c9cedb',
        }}
      />
    </div>
  );
};

const MatrixHeader: React.FC<{ scene: TestsScene; layout: TestsLayout; appear: number }> = ({ scene, layout, appear }) => {
  const matrix = layout.matrix!;
  const counts = STATUS_ORDER.map((s) => [s, scene.cases.filter((c) => (c.status ?? 'added') === s).length] as const).filter(([, n]) => n > 0);
  const label: React.CSSProperties = { position: 'absolute', top: 8, fontSize: 17, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', color: colors.faint };
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: matrix.w, height: MATRIX_HEADER_H, opacity: appear }}>
      <div style={{ ...label, left: ROW_PAD_X, display: 'flex', alignItems: 'center', gap: 10, color: colors.muted }}>
        <FlaskConical size={20} strokeWidth={2.2} color={colors.accent} />
        {scene.cases.length} {scene.cases.length === 1 ? 'test' : 'tests'}
      </div>
      <div style={{ ...label, left: matrix.nameX }}>Test</div>
      <div style={{ ...label, left: matrix.provesX }}>Proves</div>
      <div style={{ ...label, right: ROW_PAD_X, display: 'flex', gap: 18, letterSpacing: 1.5 }}>
        {counts.map(([s, n]) => (
          <span key={s} style={{ color: statusTone[s].color }}>
            {n} {statusTone[s].label}
          </span>
        ))}
      </div>
    </div>
  );
};

const EmptyCard: React.FC<{ layout: TestsLayout; frame: number }> = ({ layout, frame }) => {
  const { fps } = useVideoConfig();
  const card = layout.emptyCard!;
  const appear = spring({ frame: frame - START, fps, config: { damping: 14, stiffness: 120 } });
  const glow = interpolate(frame, [START + 8, START + 16, START + 44], [0, 1, 0.35], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        boxSizing: 'border-box',
        borderRadius: 22,
        background: `linear-gradient(120deg, ${colors.delBg}, rgba(255,107,122,0.04))`,
        border: `2px solid ${colors.del}99`,
        boxShadow: `0 0 ${56 * glow}px rgba(255,107,122,${0.3 * glow})`,
        display: 'flex',
        alignItems: 'center',
        gap: 40,
        padding: '0 52px',
        opacity: appear,
        transform: `scale(${0.94 + 0.06 * appear})`,
      }}
    >
      <div
        style={{
          width: 112,
          height: 112,
          borderRadius: 28,
          background: 'rgba(255,107,122,0.14)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <FlaskConicalOff size={64} strokeWidth={1.8} color={colors.del} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 54, fontWeight: 800, letterSpacing: -1, color: colors.text }}>No tests in this change</div>
        <div style={{ fontSize: 26, color: '#d7a0a7', marginTop: 10 }}>Nothing in this diff exercises the new code. The behaviors below ship unverified.</div>
      </div>
    </div>
  );
};

const GapItem: React.FC<{ gap: PlacedGap; layout: TestsLayout; at: number; frame: number }> = ({ gap, layout, at, frame }) => {
  const { fps } = useVideoConfig();
  const appear = spring({ frame: frame - at, fps, config: { damping: 15, stiffness: 130 } });
  const pulse = interpolate(frame, [at + 4, at + 12, at + 40], [0, 1, 0], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: gap.x,
        top: gap.y,
        width: gap.w,
        height: gap.h,
        boxSizing: 'border-box',
        borderRadius: 12,
        background: `rgba(251,191,36,${0.06 + 0.1 * pulse})`,
        border: `1px solid rgba(251,191,36,${0.25 + 0.6 * pulse})`,
        boxShadow: `0 0 ${30 * pulse}px rgba(251,191,36,${0.35 * pulse})`,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 16}px) scale(${1 + 0.025 * pulse})`,
      }}
    >
      <div style={{ position: 'absolute', left: 14, top: 0, bottom: 0, width: GAP_MARKER_W - 8, display: 'flex', alignItems: 'center' }}>
        <TriangleAlert size={24} strokeWidth={2.2} color={AMBER} />
      </div>
      <Lines
        lines={gap.lines}
        style={{
          position: 'absolute',
          left: GAP_MARKER_W + 14,
          right: 14,
          top: (gap.h - gap.lines.length * layout.lineHeight) / 2,
          fontSize: layout.font,
          lineHeight: `${layout.lineHeight}px`,
          color: '#f3e3bd',
        }}
      />
    </div>
  );
};

const GapsPanel: React.FC<{ layout: TestsLayout; at: number; gapAt: (i: number) => number; frame: number }> = ({ layout, at, gapAt, frame }) => {
  const { fps } = useVideoConfig();
  const panel = layout.gapsPanel;
  const appear = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 120 } });
  const none = layout.gaps.length === 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: panel.x,
        top: panel.y,
        width: panel.w,
        height: panel.h,
        boxSizing: 'border-box',
        borderRadius: 18,
        background: none ? 'rgba(255,255,255,0.025)' : AMBER_BG,
        border: `1.5px solid ${none ? colors.border : 'rgba(251,191,36,0.45)'}`,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 20}px)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: GAPS_PAD,
          top: 0,
          height: GAPS_HEADER_H,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 20,
          fontWeight: 800,
          letterSpacing: 2.5,
          textTransform: 'uppercase',
          color: none ? colors.muted : AMBER,
        }}
      >
        <TriangleAlert size={24} strokeWidth={2.4} />
        Not tested
        {none ? null : <span style={{ color: '#b9965a', fontWeight: 600, letterSpacing: 1.5 }}>· {layout.gaps.length}</span>}
      </div>
      {none ? (
        <div style={{ position: 'absolute', left: GAPS_PAD, top: GAPS_HEADER_H - 6, fontSize: layout.font, color: colors.muted }}>
          No gaps found. Every important behavior in this change has a test.
        </div>
      ) : (
        layout.gaps.map((gap, i) => <GapItem key={i} gap={{ ...gap, y: gap.y - panel.y }} layout={layout} at={gapAt(i)} frame={frame} />)
      )}
    </div>
  );
};

const Subject: React.FC<{ subject: string }> = ({ subject }) => (
  <div style={{ maxWidth: 760, flexShrink: 0, textAlign: 'right', paddingBottom: 4 }}>
    <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', color: colors.faint }}>Under test</div>
    {wrapLabel(subject, 52).map((line, i) => (
      <div key={i} style={{ fontFamily: fonts.mono, fontSize: 22, color: colors.text, marginTop: i ? 2 : 6, whiteSpace: 'nowrap' }}>
        {line}
      </div>
    ))}
  </div>
);

export const TestMatrix: React.FC<SceneProps<TestsScene>> = ({ scene, durationInFrames }) => {
  const frame = useCurrentFrame();
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutTests(scene.cases, scene.gaps, box.width, box.height), [scene.cases, scene.gaps, box.width, box.height]);
  const timeline = useMemo(() => buildTimeline(layout, durationInFrames), [layout, durationInFrames]);
  const headerIn = interpolate(frame, [START, START + 10], [0, 1], clamp);

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      eyebrow={scene.chapter ?? defaultChapter.tests}
      title={scene.title}
      aside={scene.subject ? <Subject subject={scene.subject} /> : undefined}
    >
      {/* A short matrix sits a little above centre rather than leaving the lower screen empty. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: Math.max(0, box.height - layout.height * layout.scale) * 0.3,
          width: box.width / layout.scale,
          height: layout.height,
          transform: `scale(${layout.scale})`,
          transformOrigin: 'top left',
        }}
      >
        {layout.matrix ? <MatrixHeader scene={scene} layout={layout} appear={headerIn} /> : <EmptyCard layout={layout} frame={frame} />}
        {layout.rows.map((row, i) => (
          <CaseRow key={i} row={row} layout={layout} at={timeline.rowAt(i)} frame={frame} />
        ))}
        <GapsPanel layout={layout} at={timeline.panelAt} gapAt={timeline.gapAt} frame={frame} />
      </div>
    </SceneShell>
  );
};
