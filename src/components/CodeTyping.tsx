import type { Token } from 'prism-react-renderer';
import { interpolate } from 'remotion';
import { cueFrame } from '../../shared/timing.mjs';
import type { CodeScene } from '../types';
import { OUTPUT_CHROME_H, OUTPUT_PAD, type OutputPaneLayout } from '../utils/codeLayout';
import { plainCodeColor, tokenColor } from '../utils/highlight';
import type { SpokenSegment } from '../utils/timing';
import type { TypingSchedule } from '../utils/codeTyping';
import { FitText } from './FitText';
import { clamp, CODE_TAB_SIZE, colors, fonts } from './theme';

const BLINK = 16;
const LINE_GAP = 4;

/** A line's typed characters: its text after the indent, which appears with the line as an editor indents. */
const indentOf = (text: string) => text.length - text.trimStart().length;

/** The first `count` characters of a line's tokens. */
function sliceTokens(tokens: readonly Token[], count: number): Token[] {
  const out: Token[] = [];
  let left = count;
  for (const t of tokens) {
    if (left <= 0) break;
    out.push(t.content.length <= left ? t : { ...t, content: t.content.slice(0, left) });
    left -= t.content.length;
  }
  return out;
}

/**
 * A typed line as the frame shows it: nothing before its first character, then its indent and the characters typed
 * so far, with the cursor after them while it is typing, and blinking there once its step's typing is done.
 */
export const TypedCode: React.FC<{
  text: string;
  tokens: Token[];
  fontSize: number;
  frame: number;
  line: { from: number; chars: number; perFrame: number };
  cursor: 'typing' | 'resting' | null;
}> = ({ text, tokens, fontSize, frame, line, cursor }) => {
  const typed = Math.min(line.chars, Math.max(0, Math.floor((frame - line.from) * line.perFrame) + 1));
  const shown = sliceTokens(tokens, indentOf(text) + typed);
  const on = cursor === 'typing' || (cursor === 'resting' && Math.floor(frame / BLINK) % 2 === 0);
  return (
    <div
      style={{
        whiteSpace: 'pre',
        tabSize: CODE_TAB_SIZE,
        fontFamily: fonts.mono,
        fontSize,
        flex: 1,
        minWidth: 0,
        color: plainCodeColor,
      }}
    >
      {shown.map((t, i) => (
        <span key={i} style={{ color: tokenColor(t.types) }}>
          {t.content}
        </span>
      ))}
      {cursor ? (
        <span
          style={{
            display: 'inline-block',
            width: Math.max(3, fontSize * 0.12),
            height: fontSize * 1.25,
            marginLeft: 1,
            verticalAlign: 'text-bottom',
            background: colors.accent,
            opacity: on ? 1 : 0,
          }}
        />
      ) : null}
    </div>
  );
};

/** The row whose line the cursor sits on at `frame`, and whether it is typing or resting there; null before any step types. */
export function cursorAt(schedule: TypingSchedule, frame: number): { row: number; state: 'typing' | 'resting' } | null {
  let best: { row: number; state: 'typing' | 'resting' } | null = null;
  schedule.lines.forEach((line, r) => {
    if (!line || frame < line.from) return;
    best = { row: r, state: frame < line.from + line.chars / line.perFrame ? 'typing' : 'resting' };
  });
  return best;
}

/** When step k's output starts printing: at its `outputWhen` words, else once its lines are typed, else as its words start. */
export function outputStarts(
  scene: CodeScene,
  segments: readonly SpokenSegment[],
  typedEnds: readonly number[] | null,
): number[] {
  return (scene.steps ?? []).map((step, k) => {
    const segment = segments[k + 1];
    if (!segment) return Infinity;
    const cued = step.outputWhen ? cueFrame(segment, step.outputWhen) : null;
    if (cued !== null) return cued;
    return typedEnds ? Math.max(segment.from, typedEnds[k]! + 6) : segment.voiceFrom;
  });
}

const BODY_BG = '#0b0d13';
const OUTPUT_TEXT = '#c3c8d4';

/**
 * A terminal-like pane beside the code that each step's output prints into, a line every few frames, scrolling to
 * keep the newest line in view. The current step's lines are bright and earlier ones softer.
 */
export const OutputPane: React.FC<{
  layout: OutputPaneLayout;
  height: number;
  starts: readonly number[];
  frame: number;
  current: number;
}> = ({ layout, height, starts, frame, current }) => {
  const viewH = height - OUTPUT_CHROME_H;
  const firstOf = new Map<number, number>();
  layout.lines.forEach((line, i) => (firstOf.has(line.step) ? null : firstOf.set(line.step, i)));
  const appearOf = layout.lines.map((line, i) => {
    const at = starts[line.step]! + (i - firstOf.get(line.step)!) * LINE_GAP;
    return interpolate(frame, [at, at + 3], [0, 1], clamp);
  });
  const scroll = Math.max(
    0,
    ...layout.lines.map(
      (line, i) => Math.max(0, line.y + line.h + OUTPUT_PAD.y - viewH) * Math.min(1, appearOf[i]! * 2),
    ),
  );
  const appear = interpolate(frame, [2, 14], [0, 1], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: layout.x,
        top: 0,
        width: layout.width,
        height,
        borderRadius: 16,
        background: BODY_BG,
        boxShadow: `0 0 0 1.5px ${colors.borderStrong}, 0 24px 70px rgba(0,0,0,0.55)`,
        overflow: 'hidden',
        opacity: appear,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          right: 0,
          height: OUTPUT_CHROME_H,
          background: '#171a23',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ position: 'absolute', left: 20, display: 'flex', gap: 9 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.85 }} />
          ))}
        </div>
        <FitText fit={layout.title} style={{ color: colors.muted }} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: OUTPUT_CHROME_H, height: viewH, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: -scroll }}>
          {layout.lines.map((line, i) => (
            <FitText
              key={i}
              fit={line.fit}
              style={{
                position: 'absolute',
                left: OUTPUT_PAD.x,
                top: line.y,
                color: OUTPUT_TEXT,
                opacity: appearOf[i]! * (line.step === current ? 1 : 0.62),
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
