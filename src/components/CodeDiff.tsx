import { FileWarning, Trash2 } from 'lucide-react';
import type { Token } from 'prism-react-renderer';
import { useMemo, type ReactNode } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CodeScene, DiffLine, Hunk } from '../types';
import { splitRows } from '../utils/diffRows';
import { plainCodeColor, tokenColor, tokenizeHunkLines } from '../utils/highlight';
import { isFocused, sceneFocus, type Focus } from '../utils/lines';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, clampLines, colors, contentBox, defaultChapter, ellipsis, fitFontSize, fonts } from './theme';

const ROW_H = 38;
const PANEL_PAD = 18;
const HEADER_H = 92;
const HEADER_GAP = 22;
const CALLOUT_W = 420;
const CALLOUT_GAP = 56;
const CALLOUT_BELOW_H = 112;

type View = 'split' | 'morph';

function defaultView(hunk: Hunk): View {
  return hunk.additions === 0 || hunk.deletions === 0 ? 'morph' : 'split';
}

/** A row the scrolling viewport stacks; views decide height and content per frame. */
interface RowModel {
  key: string;
  height: number;
  focused: boolean;
  content: ReactNode;
}

const statusStyle: Record<Hunk['status'], { label: string; color: string }> = {
  added: { label: 'Added', color: colors.add },
  modified: { label: 'Modified', color: colors.accent },
  deleted: { label: 'Deleted', color: colors.del },
  renamed: { label: 'Renamed', color: '#fbbf24' },
};

const Code: React.FC<{ tokens: Token[]; fontSize: number; dim?: boolean }> = ({ tokens, fontSize, dim }) => (
  <div style={{ ...ellipsis, whiteSpace: 'pre', fontFamily: fonts.mono, fontSize, flex: 1, opacity: dim ? 0.55 : 1, color: plainCodeColor }}>
    {tokens.map((t, i) => (
      <span key={i} style={{ color: tokenColor(t.types) }}>
        {t.content}
      </span>
    ))}
  </div>
);

const LineNumber: React.FC<{ value: number | null; fontSize: number; width: number }> = ({ value, fontSize, width }) => (
  <div style={{ width, flexShrink: 0, textAlign: 'right', paddingRight: 14, boxSizing: 'border-box', fontFamily: fonts.mono, fontSize: fontSize - 3, color: colors.faint }}>
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
        <LineNumber key={i} value={n} fontSize={fontSize} width={numbers.length > 1 ? 58 : 66} />
      ))}
      <div style={{ width: 26, flexShrink: 0, fontFamily: fonts.mono, fontSize, color: signColor, fontWeight: 700 }}>{sign}</div>
    </>
  );
};

const lineBg = (line: DiffLine | null) => (line?.type === 'add' ? colors.addBg : line?.type === 'del' ? colors.delBg : 'transparent');

function splitModels(hunk: Hunk, tokens: Token[][], focus: Focus): RowModel[] {
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
            <Gutter line={line} numbers={[side === 'left' ? line.oldLine : line.newLine]} fontSize={20} />
            <Code tokens={tokens[index!]!} fontSize={20} />
          </>
        ) : null}
      </div>
    );
  };
  return splitRows(hunk.lines).map((row, i) => {
    const left = row.left === null ? null : hunk.lines[row.left]!;
    const right = row.right === null ? null : hunk.lines[row.right]!;
    const focused = (left !== null && isFocused(left, focus)) || (right !== null && isFocused(right, focus));
    return {
      key: `s${i}`,
      height: ROW_H,
      focused,
      content: (
        <div style={{ display: 'flex', height: '100%' }}>
          {cell(row.left, 'left')}
          {cell(row.right, 'right')}
        </div>
      ),
    };
  });
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

function morphModels(hunk: Hunk, tokens: Token[][], focus: Focus, frame: number, duration: number): RowModel[] {
  const t = morphTimeline(hunk, duration);
  let addIndex = 0;
  return hunk.lines.map((line, i) => {
    let height = ROW_H;
    let bg = 'transparent';
    let opacity = 1;
    let strike = 0;
    if (line.type === 'del') {
      const collapse = interpolate(frame, [t.collapseStart, t.collapseEnd], [0, 1], clamp);
      const flash = interpolate(frame, [t.flashStart, t.flashStart + 6, t.collapseStart], [0.1, 0.32, 0.2], clamp);
      height = ROW_H * (1 - collapse);
      opacity = 1 - collapse;
      bg = `rgba(255, 107, 122, ${flash})`;
      strike = interpolate(frame, [t.flashStart, t.collapseStart], [0, 1], clamp);
    } else if (line.type === 'add') {
      const start = t.growStart + addIndex++ * t.stagger;
      const grow = interpolate(frame, [start, start + 10], [0, 1], clamp);
      const glow = interpolate(frame, [start, start + 10, start + 30], [0.35, 0.3, 0.12], clamp);
      height = ROW_H * grow;
      opacity = grow;
      bg = `rgba(61, 220, 151, ${glow})`;
    }
    return {
      key: `m${i}`,
      height,
      focused: isFocused(line, focus),
      content: (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: ROW_H, background: bg, opacity }}>
          <Gutter line={line} numbers={[line.oldLine, line.newLine]} fontSize={23} />
          <Code tokens={tokens[i]!} fontSize={23} />
          {strike > 0 ? (
            <div
              style={{
                position: 'absolute',
                left: 142,
                top: ROW_H / 2 - 1,
                height: 2,
                fontFamily: fonts.mono,
                fontSize: 23,
                width: `${(line.text.length + 2) * strike}ch`,
                maxWidth: 'calc(100% - 160px)',
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
  const focus = useMemo(() => sceneFocus(scene, hunk), [scene, hunk]);
  const tokens = useMemo(() => tokenizeHunkLines(hunk.lines, hunk.language), [hunk]);
  const box = contentBox(false);
  const callout = scene.calloutText?.trim() || null;
  const calloutBeside = callout !== null && view === 'morph';
  const calloutBelow = callout !== null && view === 'split';

  const panelW = calloutBeside ? box.width - CALLOUT_W - CALLOUT_GAP : box.width;
  const panelH = box.height - HEADER_H - HEADER_GAP - (calloutBelow ? CALLOUT_BELOW_H + 28 : 0);
  const viewportH = panelH - PANEL_PAD * 2;

  const rows = view === 'split' ? splitModels(hunk, tokens, focus) : morphModels(hunk, tokens, focus, frame, durationInFrames);
  const morphEnd = view === 'morph' ? morphTimeline(hunk, durationInFrames).growEnd : 0;
  const dimStart = Math.max(Math.round(durationInFrames * 0.15), Math.min(morphEnd, durationInFrames * 0.5));
  const dim = interpolate(frame, [dimStart, dimStart + 14], [0, 1], clamp);

  let y = 0;
  let focusTop = Infinity;
  let focusBottom = -Infinity;
  const placed = rows.map((row) => {
    const top = y;
    y += row.height;
    if (row.focused && row.height > 0.5) {
      focusTop = Math.min(focusTop, top);
      focusBottom = Math.max(focusBottom, top + row.height);
    }
    return { row, top };
  });
  const contentH = y;
  const hasFocus = focusTop !== Infinity;
  const focusCenter = hasFocus ? (focusTop + focusBottom) / 2 : contentH / 2;
  const maxScroll = Math.max(0, contentH - viewportH);
  const scroll = Math.min(maxScroll, Math.max(0, focusCenter - viewportH / 2)) * interpolate(frame, [dimStart - 6, dimStart + 24], [0, 1], clamp);

  const calloutAppear = spring({ frame: frame - dimStart - 10, fps, config: { damping: 16, stiffness: 120 } });
  const focusY = PANEL_PAD + Math.min(viewportH, Math.max(0, focusCenter - scroll));
  const calloutH = callout ? estimateCalloutHeight(callout, CALLOUT_W) : 0;
  const calloutTop = Math.min(panelH - calloutH, Math.max(0, focusY - calloutH / 2));

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
          {contentH < ROW_H ? (
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
                opacity: interpolate(contentH, [0, ROW_H], [1, 0], clamp),
              }}
            >
              <Trash2 size={34} color={colors.del} />
              {hunk.deletions} {hunk.deletions === 1 ? 'line' : 'lines'} removed
            </div>
          ) : null}
          <div style={{ position: 'absolute', left: 0, right: 0, top: PANEL_PAD, height: viewportH, overflow: 'hidden' }}>
            <div style={{ position: 'relative', transform: `translateY(${-scroll}px)` }}>
              {placed.map(({ row, top }) => (
                <div
                  key={row.key}
                  style={{
                    position: 'absolute',
                    top,
                    left: 0,
                    right: 0,
                    height: row.height,
                    overflow: 'hidden',
                    opacity: row.focused || !hasFocus ? 1 : 1 - 0.7 * dim,
                    background: row.focused ? `rgba(124, 140, 255, ${0.08 * dim})` : undefined,
                  }}
                >
                  {row.focused ? (
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: colors.accent, opacity: dim }} />
                  ) : null}
                  {row.content}
                </div>
              ))}
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
        {calloutBelow && hasFocus ? (
          <div
            style={{
              position: 'absolute',
              left: 10,
              top: focusY + (focusBottom - focusCenter),
              width: 3,
              height: Math.max(0, panelH + 28 - focusY - (focusBottom - focusCenter)),
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
