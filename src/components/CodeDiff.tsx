import { FileWarning, Trash2 } from 'lucide-react';
import type { Token } from 'prism-react-renderer';
import { useMemo, type ReactNode } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CodeScene, DiffLine, Hunk } from '../types';
import { splitRows, type SplitRow } from '../utils/diffRows';
import { plainCodeColor, tokenColor, tokenizeHunkLines } from '../utils/highlight';
import { lineFocusRanges } from '../utils/lines';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, clampLines, CODE_TAB_SIZE, codeColumns, colors, contentBox, defaultChapter, ellipsis, fitCodeFontSize, fitFontSize, fonts } from './theme';

const SIGN_W = 26;
const SPLIT_NUMBER_W = 66;
const MORPH_NUMBER_W = 58;
const SPLIT_GUTTER_W = SPLIT_NUMBER_W + SIGN_W;
const MORPH_GUTTER_W = MORPH_NUMBER_W * 2 + SIGN_W;
const FONT_RANGE: Record<View, { min: number; max: number }> = { split: { min: 14, max: 20 }, morph: { min: 15, max: 23 } };
const PANEL_PAD = 18;
const HEADER_H = 92;
const HEADER_GAP = 22;
const CALLOUT_W = 420;
const CALLOUT_GAP = 56;
const CALLOUT_BELOW_H = 112;
/** Unfocused rows kept above the first step and below the last; the rest of the hunk is cropped away. */
const CONTEXT_ROWS = 3;
const STEP_FADE = 14;
const VISITED_OPACITY = 0.6;
const DIM_OPACITY = 0.3;

type View = 'split' | 'morph';

/** Code font and row height, sized so the longest shown line fits the code column. */
interface CodeMetrics {
  fontSize: number;
  rowH: number;
}

function codeMetrics(lines: readonly DiffLine[], view: View, panelW: number): CodeMetrics {
  const inner = panelW - 2;
  const column = view === 'split' ? (inner - 1) / 2 - SPLIT_GUTTER_W : inner - MORPH_GUTTER_W;
  const longest = Math.max(0, ...lines.map((l) => codeColumns(l.text)));
  const { min, max } = FONT_RANGE[view];
  const fontSize = fitCodeFontSize(longest, column, min, max);
  return { fontSize, rowH: Math.round(fontSize * 1.65) };
}

function defaultView(hunk: Hunk): View {
  return hunk.additions === 0 || hunk.deletions === 0 ? 'morph' : 'split';
}

/**
 * One displayed row: a side-by-side pair of hunk.lines indices, or the same index twice in morph view.
 * `step` is the focus step the row belongs to, numbered top to bottom.
 */
interface Slot extends SplitRow {
  step: number | null;
}

/** The rows to show: the hunk cropped to CONTEXT_ROWS around its focus, plus how many steps they hold. */
function cropSlots(hunk: Hunk, view: View, scene: CodeScene): { slots: Slot[]; stepCount: number } {
  const rangeOf = lineFocusRanges(scene, hunk);
  const rows = view === 'split' ? splitRows(hunk.lines) : hunk.lines.map((_, i) => ({ left: i, right: i }));
  const order: number[] = [];
  const slots = rows.map((row) => {
    const ids = [row.left, row.right].flatMap((i) => (i === null ? [] : [rangeOf[i] ?? null])).filter((id) => id !== null);
    if (!ids.length) return { ...row, step: null };
    const id = Math.min(...ids);
    if (!order.includes(id)) order.push(id);
    return { ...row, step: order.indexOf(id) };
  });
  const focused = slots.flatMap((slot, i) => (slot.step === null ? [] : [i]));
  if (!focused.length) return { slots, stepCount: 0 };
  const from = Math.max(0, Math.min(...focused) - CONTEXT_ROWS);
  const to = Math.min(slots.length, Math.max(...focused) + 1 + CONTEXT_ROWS);
  return { slots: slots.slice(from, to), stepCount: order.length };
}

/** A row the scrolling viewport stacks; views decide height and content per frame. */
interface RowModel {
  key: string;
  height: number;
  /** Height once the morph has played; the camera plans against it so it never chases the animation. */
  finalHeight: number;
  step: number | null;
  content: ReactNode;
}

const statusStyle: Record<Hunk['status'], { label: string; color: string }> = {
  added: { label: 'Added', color: colors.add },
  modified: { label: 'Modified', color: colors.accent },
  deleted: { label: 'Deleted', color: colors.del },
  renamed: { label: 'Renamed', color: '#fbbf24' },
};

const Code: React.FC<{ tokens: Token[]; fontSize: number; dim?: boolean }> = ({ tokens, fontSize, dim }) => (
  <div style={{ ...ellipsis, whiteSpace: 'pre', tabSize: CODE_TAB_SIZE, fontFamily: fonts.mono, fontSize, flex: 1, opacity: dim ? 0.55 : 1, color: plainCodeColor }}>
    {tokens.map((t, i) => (
      <span key={i} style={{ color: tokenColor(t.types) }}>
        {t.content}
      </span>
    ))}
  </div>
);

const LineNumber: React.FC<{ value: number | null; fontSize: number; width: number }> = ({ value, fontSize, width }) => (
  <div style={{ width, flexShrink: 0, textAlign: 'right', paddingRight: 14, boxSizing: 'border-box', fontFamily: fonts.mono, fontSize: Math.round(fontSize * 0.85), color: colors.faint }}>
    {value ?? ''}
  </div>
);

/** Line number column(s) plus the +/− sign; morph shows both old and new numbers like a unified diff. */
const Gutter: React.FC<{ line: DiffLine | null; numbers: (number | null)[]; fontSize: number }> = ({ line, numbers, fontSize }) => {
  const sign = line?.type === 'add' ? '+' : line?.type === 'del' ? '−' : ' ';
  const signColor = line?.type === 'add' ? colors.add : line?.type === 'del' ? colors.del : colors.faint;
  return (
    <>
      {numbers.map((n, i) => (
        <LineNumber key={i} value={n} fontSize={fontSize} width={numbers.length > 1 ? MORPH_NUMBER_W : SPLIT_NUMBER_W} />
      ))}
      <div style={{ width: SIGN_W, flexShrink: 0, fontFamily: fonts.mono, fontSize, color: signColor, fontWeight: 700 }}>{sign}</div>
    </>
  );
};

const lineBg = (line: DiffLine | null) => (line?.type === 'add' ? colors.addBg : line?.type === 'del' ? colors.delBg : 'transparent');

function splitModels(hunk: Hunk, tokens: Token[][], slots: Slot[], { fontSize, rowH }: CodeMetrics): RowModel[] {
  const cell = (index: number | null, side: 'left' | 'right') => {
    const line = index === null ? null : hunk.lines[index]!;
    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          height: '100%',
          background: line ? lineBg(line) : 'rgba(255,255,255,0.025)',
          borderLeft: side === 'right' ? `1px solid ${colors.border}` : undefined,
        }}
      >
        {line ? (
          <>
            <Gutter line={line} numbers={[side === 'left' ? line.oldLine : line.newLine]} fontSize={fontSize} />
            <Code tokens={tokens[index!]!} fontSize={fontSize} />
          </>
        ) : null}
      </div>
    );
  };
  return slots.map((row) => ({
    key: `s${row.left}-${row.right}`,
    height: rowH,
    finalHeight: rowH,
    step: row.step,
    content: (
      <div style={{ display: 'flex', height: '100%' }}>
        {cell(row.left, 'left')}
        {cell(row.right, 'right')}
      </div>
    ),
  }));
}

/** Frame windows for the morph: show the old code, flash and collapse deletions, then grow additions. */
function morphTimeline(hunk: Hunk, duration: number) {
  const pureAdd = hunk.deletions === 0;
  // With nothing growing in afterwards, linger on the doomed lines before they go.
  const pureDel = hunk.additions === 0;
  const flashStart = Math.round(duration * (pureDel ? 0.35 : 0.2));
  const collapseStart = Math.round(duration * (pureDel ? 0.5 : 0.28));
  const collapseEnd = Math.round(duration * (pureDel ? 0.62 : 0.38));
  const growStart = pureAdd ? 10 : hunk.additions === 0 ? collapseEnd : Math.round(duration * 0.36);
  const stagger = Math.min(3, (duration * 0.2) / Math.max(1, hunk.additions));
  const growEnd = growStart + stagger * hunk.additions + 10;
  return { flashStart, collapseStart, collapseEnd, growStart, stagger, growEnd };
}

function morphModels(hunk: Hunk, tokens: Token[][], slots: Slot[], frame: number, duration: number, { fontSize, rowH }: CodeMetrics): RowModel[] {
  const t = morphTimeline(hunk, duration);
  let addIndex = 0;
  return slots.map(({ left, step }) => {
    const i = left!;
    const line = hunk.lines[i]!;
    let height = rowH;
    let bg = 'transparent';
    let opacity = 1;
    let strike = 0;
    if (line.type === 'del') {
      const collapse = interpolate(frame, [t.collapseStart, t.collapseEnd], [0, 1], clamp);
      const flash = interpolate(frame, [t.flashStart, t.flashStart + 6, t.collapseStart], [0.1, 0.32, 0.2], clamp);
      height = rowH * (1 - collapse);
      opacity = 1 - collapse;
      bg = `rgba(255, 107, 122, ${flash})`;
      strike = interpolate(frame, [t.flashStart, t.collapseStart], [0, 1], clamp);
    } else if (line.type === 'add') {
      const start = t.growStart + addIndex++ * t.stagger;
      const grow = interpolate(frame, [start, start + 10], [0, 1], clamp);
      const glow = interpolate(frame, [start, start + 10, start + 30], [0.35, 0.3, 0.12], clamp);
      height = rowH * grow;
      opacity = grow;
      bg = `rgba(61, 220, 151, ${glow})`;
    }
    return {
      key: `m${i}`,
      height,
      finalHeight: line.type === 'del' ? 0 : rowH,
      step,
      content: (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: rowH, background: bg, opacity }}>
          <Gutter line={line} numbers={[line.oldLine, line.newLine]} fontSize={fontSize} />
          <Code tokens={tokens[i]!} fontSize={fontSize} />
          {strike > 0 ? (
            <div
              style={{
                position: 'absolute',
                left: MORPH_GUTTER_W,
                top: rowH / 2 - 1,
                height: 2,
                fontFamily: fonts.mono,
                fontSize,
                width: `${(codeColumns(line.text) + 2) * strike}ch`,
                maxWidth: `calc(100% - ${MORPH_GUTTER_W + 18}px)`,
                background: colors.del,
              }}
            />
          ) : null}
        </div>
      ),
    };
  });
}

const MissingHunk: React.FC<{ hunkId: string }> = ({ hunkId }) => (
  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 28,
        padding: '40px 56px',
        borderRadius: 24,
        border: `1px solid ${colors.del}66`,
        background: colors.delBg,
      }}
    >
      <FileWarning size={64} color={colors.del} />
      <div>
        <div style={{ fontSize: 44, fontWeight: 700 }}>Hunk {hunkId} not found</div>
        <div style={{ fontSize: 26, color: colors.muted, marginTop: 8 }}>The storyboard references a hunk id that is not in hunks.json.</div>
      </div>
    </div>
  </div>
);

const FileHeader: React.FC<{ hunk: Hunk }> = ({ hunk }) => {
  const status = statusStyle[hunk.status];
  const path = hunk.status === 'renamed' && hunk.oldFile ? `${hunk.oldFile} → ${hunk.file}` : hunk.file;
  const range = hunk.status === 'deleted' ? `L${hunk.oldStartLine}` : `L${hunk.startLine}–${hunk.endLine}`;
  return (
    <div style={{ height: HEADER_H, display: 'flex', alignItems: 'center', gap: 22 }}>
      <div
        style={{
          padding: '8px 16px',
          borderRadius: 10,
          background: `${status.color}1f`,
          border: `1px solid ${status.color}55`,
          color: status.color,
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          flexShrink: 0,
        }}
      >
        {status.label}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: fonts.mono, fontSize: fitFontSize(path, 36, 60, 26), fontWeight: 600, ...ellipsis }}>{path}</div>
        {hunk.header ? (
          <div style={{ fontFamily: fonts.mono, fontSize: 20, color: colors.faint, marginTop: 6, ...ellipsis }}>{hunk.header}</div>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 14, fontFamily: fonts.mono, fontSize: 24, fontWeight: 600, flexShrink: 0 }}>
        <span style={{ color: colors.add }}>+{hunk.additions}</span>
        <span style={{ color: colors.del }}>−{hunk.deletions}</span>
        <span style={{ color: colors.faint, marginLeft: 8 }}>{range}</span>
      </div>
    </div>
  );
};

const Callout: React.FC<{ text: string; appear: number; width: number; lines: number }> = ({ text, appear, width, lines }) => (
  <div
    style={{
      width,
      boxSizing: 'border-box',
      padding: '22px 26px',
      borderRadius: 18,
      background: 'linear-gradient(180deg, #1d2136, #161a2a)',
      border: `1px solid ${colors.accent}88`,
      boxShadow: `0 18px 48px rgba(0,0,0,0.5), 0 0 32px ${colors.accentSoft}`,
      fontSize: fitFontSize(text, 28, 110, 22),
      lineHeight: 1.35,
      fontWeight: 500,
      opacity: appear,
      transform: `translateX(${(1 - appear) * 30}px) scale(${0.94 + 0.06 * appear})`,
      ...clampLines(lines),
    }}
  >
    {text}
  </div>
);

function estimateCalloutHeight(text: string, width: number): number {
  const fontSize = fitFontSize(text, 28, 110, 22);
  const charsPerLine = Math.max(1, Math.floor((width - 52) / (fontSize * 0.52)));
  const lines = Math.min(5, Math.ceil(text.length / charsPerLine));
  return lines * fontSize * 1.35 + 44;
}

const CodeBody: React.FC<{ scene: CodeScene; hunk: Hunk; durationInFrames: number }> = ({ scene, hunk, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const view = scene.view ?? defaultView(hunk);
  const { slots, stepCount } = useMemo(() => cropSlots(hunk, view, scene), [hunk, view, scene]);
  const tokens = useMemo(() => tokenizeHunkLines(hunk.lines, hunk.language), [hunk]);
  const box = contentBox(false);
  const callout = scene.calloutText?.trim() || null;
  const calloutBeside = callout !== null && view === 'morph';
  const calloutBelow = callout !== null && view === 'split';

  const panelW = calloutBeside ? box.width - CALLOUT_W - CALLOUT_GAP : box.width;
  const panelH = box.height - HEADER_H - HEADER_GAP - (calloutBelow ? CALLOUT_BELOW_H + 28 : 0);
  const viewportH = panelH - PANEL_PAD * 2;

  const shownLines = slots.flatMap((slot) => [slot.left, slot.right]).flatMap((i) => (i === null ? [] : [hunk.lines[i]!]));
  const metrics = codeMetrics(shownLines, view, panelW);
  const rows = view === 'split' ? splitModels(hunk, tokens, slots, metrics) : morphModels(hunk, tokens, slots, frame, durationInFrames, metrics);

  // The morph (or a short settle) is the intro; then each focus step takes an equal share of the time left.
  const morphEnd = view === 'morph' ? morphTimeline(hunk, durationInFrames).growEnd : 0;
  const introEnd = Math.max(Math.round(durationInFrames * 0.15), Math.min(morphEnd, durationInFrames * 0.5));
  const stepsEnd = Math.max(introEnd, Math.round(durationInFrames * 0.9));
  const stepStarts = Array.from({ length: stepCount }, (_, k) => introEnd + (k * (stepsEnd - introEnd)) / stepCount);
  const reached = (k: number) => (k < stepCount ? interpolate(frame, [stepStarts[k]!, stepStarts[k]! + STEP_FADE], [0, 1], clamp) : 0);
  const dim = reached(0);

  let y = 0;
  let finalY = 0;
  const spans = Array.from({ length: stepCount }, () => ({ top: Infinity, bottom: -Infinity, finalTop: Infinity, finalBottom: -Infinity }));
  const placed = rows.map((row) => {
    const top = y;
    const span = row.step === null ? undefined : spans[row.step];
    if (span) {
      span.top = Math.min(span.top, top);
      span.bottom = Math.max(span.bottom, top + row.height);
      span.finalTop = Math.min(span.finalTop, finalY);
      span.finalBottom = Math.max(span.finalBottom, finalY + row.finalHeight);
    }
    y += row.height;
    finalY += row.finalHeight;
    return { row, top };
  });
  const contentH = y;

  // The camera centres each step in turn, planned on the settled layout, and only ever moves down.
  const maxScroll = Math.max(0, finalY - viewportH);
  const stops: number[] = [];
  for (const span of spans) {
    const target = Math.min(maxScroll, Math.max(0, (span.finalTop + span.finalBottom) / 2 - viewportH / 2));
    stops.push(Math.max(stops[stops.length - 1] ?? 0, target));
  }
  const scroll = stops.reduce(
    (acc, stop, k) => (k === 0 ? stop : acc + (stop - stops[k - 1]!) * spring({ frame: frame - stepStarts[k]!, fps, config: { damping: 200 } })),
    0,
  );

  // The callout belongs to the last step: the conclusion the narration builds to.
  const last = spans[stepCount - 1] ?? { top: 0, bottom: contentH };
  const lastCenter = (last.top + last.bottom) / 2;
  const calloutAppear = spring({ frame: frame - (stepStarts[stepCount - 1] ?? introEnd) - 6, fps, config: { damping: 16, stiffness: 120 } });
  const focusY = PANEL_PAD + Math.min(viewportH, Math.max(0, lastCenter - scroll));
  const calloutH = callout ? estimateCalloutHeight(callout, CALLOUT_W) : 0;
  const calloutTop = Math.min(panelH - calloutH, Math.max(0, focusY - calloutH / 2));

  /** Current step at full strength, visited steps softer, unreached steps and context dimmed. */
  const emphasis = (step: number | null) => {
    const now = step === null ? 0 : reached(step);
    const passed = step === null ? 0 : reached(step + 1);
    return {
      opacity: 1 - (1 - DIM_OPACITY) * (dim - now) - (1 - VISITED_OPACITY) * passed,
      bar: now - 0.7 * passed,
      glow: now - passed,
    };
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <FileHeader hunk={hunk} />
      <div style={{ position: 'absolute', top: HEADER_H + HEADER_GAP, left: 0, width: box.width, height: panelH }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: panelW,
            borderRadius: 20,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
            overflow: 'hidden',
          }}
        >
          {hunk.additions === 0 && contentH < metrics.rowH ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 18,
                color: colors.muted,
                fontSize: 30,
                fontWeight: 600,
                opacity: interpolate(contentH, [0, metrics.rowH], [1, 0], clamp),
              }}
            >
              <Trash2 size={34} color={colors.del} />
              {hunk.deletions} {hunk.deletions === 1 ? 'line' : 'lines'} removed
            </div>
          ) : null}
          <div style={{ position: 'absolute', left: 0, right: 0, top: PANEL_PAD, height: viewportH, overflow: 'hidden' }}>
            <div style={{ position: 'relative', transform: `translateY(${-scroll}px)` }}>
              {placed.map(({ row, top }) => {
                const { opacity, bar, glow } = emphasis(row.step);
                return (
                  <div
                    key={row.key}
                    style={{
                      position: 'absolute',
                      top,
                      left: 0,
                      right: 0,
                      height: row.height,
                      overflow: 'hidden',
                      opacity,
                      background: glow > 0 ? `rgba(124, 140, 255, ${0.08 * glow})` : undefined,
                    }}
                  >
                    {bar > 0 ? <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: colors.accent, opacity: bar }} /> : null}
                    {row.content}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {calloutBeside ? (
          <>
            <svg width={box.width} height={panelH} style={{ position: 'absolute', inset: 0, overflow: 'visible', opacity: calloutAppear }}>
              <path
                d={`M ${panelW - 4} ${focusY} C ${panelW + CALLOUT_GAP / 2} ${focusY}, ${panelW + CALLOUT_GAP / 2} ${calloutTop + calloutH / 2}, ${panelW + CALLOUT_GAP} ${calloutTop + calloutH / 2}`}
                fill="none"
                stroke={colors.accent}
                strokeWidth={3}
              />
              <circle cx={panelW - 4} cy={focusY} r={7} fill={colors.accent} />
            </svg>
            <div style={{ position: 'absolute', left: panelW + CALLOUT_GAP, top: calloutTop }}>
              <Callout text={callout!} appear={calloutAppear} width={CALLOUT_W} lines={5} />
            </div>
          </>
        ) : null}
        {calloutBelow && stepCount > 0 ? (
          <div
            style={{
              position: 'absolute',
              left: 10,
              top: focusY + (last.bottom - lastCenter),
              width: 3,
              height: Math.max(0, panelH + 28 - focusY - (last.bottom - lastCenter)),
              background: colors.accent,
              opacity: calloutAppear,
            }}
          />
        ) : null}
        {calloutBelow ? (
          <div style={{ position: 'absolute', left: 0, right: 0, top: panelH + 28, height: CALLOUT_BELOW_H, display: 'flex', alignItems: 'flex-start' }}>
            <Callout text={callout!} appear={calloutAppear} width={box.width} lines={2} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const CodeDiff: React.FC<SceneProps<CodeScene>> = ({ scene, hunks, durationInFrames }) => {
  const hunk = hunks[scene.hunkId];
  return (
    <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.code}>
      {hunk ? <CodeBody scene={scene} hunk={hunk} durationInFrames={durationInFrames} /> : <MissingHunk hunkId={scene.hunkId} />}
    </SceneShell>
  );
};
