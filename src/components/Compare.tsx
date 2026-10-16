import { Check, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { stepTargets } from '../../shared/targets.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import type { CompareScene, Verdict } from '../types';
import {
  CODE_PAD,
  HEADER_H,
  VERDICT_W,
  compareBoxes,
  layoutCompare,
  type CompareLayout,
  type PlacedCompareCell,
  type PlacedCompareRow,
} from '../utils/compareLayout';
import { plainCodeColor, tokenColor, tokenizeLines } from '../utils/highlight';
import { staged } from '../utils/penGeometry';
import { focusSpotlight, revealStarts, stepSpring, type Emphasis } from '../utils/spotlight';
import { FitText } from './FitText';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, fonts } from './theme';
import { tones } from './tones';

const PANEL_START = 4;
const ROWS_START = 18;
/** Frames from a row's start until both its cells and the cue between them are in. */
const ROW_FRAMES = 12;
/** Frames between the rows one step shows. */
const STEP_STAGGER = 3;
/** A row that is the same on both sides recedes, so the rows that differ carry the eye. */
const SAME_OPACITY = 0.5;
const CUE_COLOR = colors.accent;
/** A row's label draws with the frames, softer until its row is shown, so the labels read as the agenda. */
const UNSHOWN_LABEL = 0.55;

const VERDICT_ICON: Record<Verdict, LucideIcon> = { good: Check, bad: X, warn: TriangleAlert };

const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');

/** Per step, the last row shown by its end: every row up to the last one it or an earlier step names. */
function rowReach(scene: CompareScene): number[] {
  let last = -1;
  return stepTargets(scene).map((keys) => {
    for (const key of keys) if (key.startsWith('r:') || key.startsWith('x:')) last = Math.max(last, parseInt(key.slice(2), 10));
    return last;
  });
}

const CodeBlock: React.FC<{ cell: Extract<PlacedCompareCell, { kind: 'code' }> }> = ({ cell }) => (
  <div
    style={{
      display: 'inline-block',
      boxSizing: 'border-box',
      padding: CODE_PAD,
      borderRadius: 10,
      background: 'rgba(0, 0, 0, 0.32)',
      boxShadow: `inset 0 0 0 1px ${colors.border}`,
      fontFamily: fonts.mono,
      fontSize: cell.lines.size,
      lineHeight: cell.lines.lineHeight,
      color: plainCodeColor,
    }}
  >
    {tokenizeLines(cell.code, cell.lang).map((tokens, i) => (
      <div key={i} style={{ whiteSpace: 'pre' }}>
        {tokens.map((t, j) => (
          <span key={j} style={{ color: tokenColor(t.types) }}>
            {t.content}
          </span>
        ))}
        {tokens.length === 0 ? ' ' : null}
      </div>
    ))}
  </div>
);

const Cell: React.FC<{ layout: CompareLayout; row: PlacedCompareRow; side: 0 | 1; appear: number; emphasis: Emphasis; glow: number }> = ({ layout, row, side, appear, emphasis, glow }) => {
  const cell = row.cells[side];
  const panel = layout.sides[side];
  const verdict = cell.verdict ? tones[cell.verdict] : null;
  const Icon = cell.verdict ? VERDICT_ICON[cell.verdict] : null;
  return (
    <div style={{ position: 'absolute', left: panel.x, top: row.y, width: panel.w, height: row.h, opacity: appear * emphasis.opacity }}>
      {verdict ? (
        <div style={{ position: 'absolute', left: 10, right: 10, top: 6, bottom: 6, borderRadius: 12, background: verdict.bg, boxShadow: `inset 0 0 0 1.5px ${verdict.color}55` }} />
      ) : null}
      {glow > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: 8,
            right: 8,
            top: 4,
            bottom: 4,
            borderRadius: 12,
            background: `rgba(124, 140, 255, ${0.14 * glow})`,
            boxShadow: `inset 0 0 0 2px ${colors.accent}${hex(glow * 0.8)}, 0 0 ${28 * glow}px ${colors.accentGlow}`,
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: layout.cellX,
          width: layout.cellW,
          top: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          opacity: row.same ? SAME_OPACITY : 1,
          transform: `translateY(${(1 - appear) * 10}px)`,
        }}
      >
        {cell.kind === 'text' ? <FitText fit={cell.text} style={{ color: colors.text }} /> : <CodeBlock cell={cell} />}
      </div>
      {Icon && verdict ? (
        <div style={{ position: 'absolute', right: layout.cellX - 6, width: VERDICT_W - 8, top: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 34, height: 34, borderRadius: 17, background: verdict.color, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${appear})` }}>
            <Icon size={22} strokeWidth={3} color="#0b0d18" />
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** Between the sides: "=" for a row that is the same, and an arrow drawn left to right for one that differs. */
const Cue: React.FC<{ layout: CompareLayout; row: PlacedCompareRow; draw: number; opacity: number }> = ({ layout, row, draw, opacity }) => {
  const x0 = layout.sides[0].x + layout.sides[0].w + 12;
  const x1 = layout.sides[1].x - 12;
  const y = row.y + row.h / 2;
  if (row.same) {
    return (
      <div style={{ position: 'absolute', left: x0, width: x1 - x0, top: y - 20, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.mono, fontSize: 30, fontWeight: 700, color: colors.faint, opacity: draw * opacity }}>
        =
      </div>
    );
  }
  if (draw <= 0) return null;
  const tip = x0 + (x1 - x0) * draw;
  return (
    <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity }} width={1} height={1}>
      <circle cx={x0} cy={y} r={5 * Math.min(1, draw * 3)} fill={CUE_COLOR} />
      <line x1={x0} x2={tip} y1={y} y2={y} stroke={CUE_COLOR} strokeWidth={4} strokeLinecap="round" />
      {draw > 0.6 ? <path d={`M ${tip - 14} ${y - 10} L ${tip} ${y} L ${tip - 14} ${y + 10}`} fill="none" stroke={CUE_COLOR} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={interpolate(draw, [0.6, 1], [0, 1], clamp)} /> : null}
    </svg>
  );
};

const Panel: React.FC<{ layout: CompareLayout; side: 0 | 1; appear: number; titleIn: number; emphasis: Emphasis }> = ({ layout, side, appear, titleIn, emphasis }) => {
  const panel = layout.sides[side];
  const tone = tones[panel.tone];
  return (
    <div
      style={{
        position: 'absolute',
        left: panel.x,
        top: 0,
        width: panel.w,
        height: layout.height,
        borderRadius: 20,
        background: colors.surface,
        boxShadow: `inset 0 0 0 1.5px ${emphasis.glow > 0 ? colors.accent : `${tone.color}55`}, 0 18px 50px rgba(0,0,0,0.4)${emphasis.glow > 0 ? `, 0 0 ${40 * emphasis.glow}px ${colors.accentGlow}` : ''}`,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 16}px)`,
      }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: HEADER_H, borderRadius: '20px 20px 0 0', background: tone.bg, opacity: titleIn }} />
      <FitText fit={panel.title} style={{ position: 'absolute', left: layout.cellX, top: (HEADER_H - panel.title.height) / 2, color: tone.color, opacity: titleIn * Math.max(emphasis.opacity, 0.7) }} />
    </div>
  );
};

export const Compare: React.FC<SceneProps<CompareScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutCompare(scene, box.width, box.height), [scene, box.width, box.height]);
  const count = layout.rows.length;
  const lasts = useMemo(() => rowReach(scene), [scene]);
  const stepped = lasts.length > 0 && segments.length > 1;
  const starts = revealStarts(segments, count, lasts, ROWS_START, buildFrames('compare') - ROW_FRAMES, STEP_STAGGER, ROW_FRAMES);
  // A step's rows settle when the step does; without steps each row springs in at its own pace.
  const stepFrom = stepped ? revealStarts(segments, count, lasts, 0, 0, 0) : null;
  const motion = (i: number, delay: number) =>
    stepFrom ? stepSpring(frame, fps, starts[i]! + delay, stepFrom[i]!, { damping: 18, stiffness: 140 }) : spring({ frame: frame - starts[i]! - delay, fps, config: { damping: 18, stiffness: 140 } });
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  const sideE = [emphasisOf('s:0'), emphasisOf('s:1')] as const;
  const panelIn = (side: number) => spring({ frame: frame - PANEL_START - side * 4, fps, config: { damping: 16, stiffness: 110 } });
  const titleIn = interpolate(frame, [PANEL_START + 6, PANEL_START + 16], [0, 1], clamp);
  const top = Math.max(0, box.height - layout.height * layout.scale) * 0.35;
  // A step's note keeps off the rows shown by then, and may sit where later rows have yet to appear.
  const markTargets = (k: number) => staged(compareBoxes(layout, k === lasts.length - 1 ? Infinity : lasts[k]), { left: 0, top, scale: layout.scale }, box);
  const right = layout.sides[1].x + layout.sides[1].w;

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames}>
      <div style={{ position: 'absolute', left: 0, top, width: layout.width, height: layout.height, transform: `scale(${layout.scale})`, transformOrigin: 'top left' }}>
        <Panel layout={layout} side={0} appear={panelIn(0)} titleIn={titleIn} emphasis={sideE[0]} />
        <Panel layout={layout} side={1} appear={panelIn(1)} titleIn={titleIn} emphasis={sideE[1]} />
        {layout.rows.map((row) => {
          const i = row.index;
          const own = emphasisOf(`r:${i}`);
          const cellE = ([0, 1] as const).map((j) => emphasisOf(`x:${i}/${j}`));
          const cellOpacity = (j: 0 | 1) => Math.max(own.opacity, sideE[j].opacity, cellE[j]!.opacity);
          const rowOpacity = Math.max(own.opacity, cellE[0]!.opacity, cellE[1]!.opacity);
          const leftIn = motion(i, 0);
          const cue = interpolate(frame, [starts[i]! + 3, starts[i]! + 9], [0, 1], clamp);
          const rightIn = motion(i, 5);
          return (
            <div key={i}>
              {i > 0
                ? layout.sides.map((side, j) => (
                    <div key={j} style={{ position: 'absolute', left: side.x + 18, width: side.w - 36, top: row.y, height: 1, background: colors.border, opacity: leftIn }} />
                  ))
                : null}
              {own.glow > 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    left: row.label ? -14 : layout.sides[0].x - 8,
                    width: right + 8 - (row.label ? -14 : layout.sides[0].x - 8),
                    top: row.y + 2,
                    height: row.h - 4,
                    borderRadius: 14,
                    background: `rgba(124, 140, 255, ${0.08 * own.glow})`,
                    boxShadow: `inset 0 0 0 2px ${colors.accent}${hex(own.glow * 0.6)}, 0 0 ${30 * own.glow}px ${colors.accentGlow}`,
                  }}
                />
              ) : null}
              {row.label ? (
                <div style={{ position: 'absolute', left: 0, width: layout.labelW, top: row.y, height: row.h, display: 'flex', alignItems: 'center', opacity: titleIn * rowOpacity * (leftIn > 0 ? 1 : UNSHOWN_LABEL) }}>
                  <FitText fit={row.label} style={{ color: row.same ? colors.muted : '#d5d9e3' }} />
                </div>
              ) : null}
              <Cell layout={layout} row={row} side={0} appear={leftIn} emphasis={{ ...cellE[0]!, opacity: cellOpacity(0) }} glow={cellE[0]!.glow} />
              <Cue layout={layout} row={row} draw={cue} opacity={rowOpacity * (row.same ? SAME_OPACITY + 0.2 : 1)} />
              <Cell layout={layout} row={row} side={1} appear={rightIn} emphasis={{ ...cellE[1]!, opacity: cellOpacity(1) }} glow={cellE[1]!.glow} />
            </div>
          );
        })}
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={markTargets} />
    </SceneShell>
  );
};
