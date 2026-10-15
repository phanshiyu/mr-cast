import type { CSSProperties } from 'react';
import type { Run } from '../../shared/markup.mjs';
import { CODE_PAD, CODE_SCALE, boldWeight, type Fit } from '../../shared/textfit.mjs';
import { fonts } from './theme';
import { tones } from './tones';

/** The highlighter behind `==marked==` words. */
const MARK_BG = 'rgba(255, 214, 92, 0.3)';

function runStyle(run: Run, weight: number): CSSProperties | undefined {
  if (!run.bold && !run.code && !run.mark && !run.tone) return undefined;
  const style: CSSProperties = {};
  if (run.tone) style.color = tones[run.tone].color;
  if (run.mark) Object.assign(style, { background: MARK_BG, borderRadius: '0.18em', color: 'inherit' });
  if (run.bold) style.fontWeight = boldWeight(weight);
  if (run.code) {
    Object.assign(style, {
      fontFamily: fonts.mono,
      fontSize: `${CODE_SCALE}em`,
      fontWeight: run.bold ? 700 : Math.min(weight, 600),
      letterSpacing: 0,
      textTransform: 'none',
      padding: `0 ${CODE_PAD / CODE_SCALE}em`,
      borderRadius: '0.3em',
      background: 'rgba(255, 255, 255, 0.1)',
    });
  }
  return style;
}

const Line: React.FC<{ runs: Run[]; width: number; weight: number }> = ({ runs, width, weight }) => (
  <span data-fit-w={width.toFixed(1)}>
    {runs.length
      ? runs.map((run, j) => (
          <span key={j} style={runStyle(run, weight)}>
            {run.text}
          </span>
        ))
      : ' '}
  </span>
);

/**
 * Draws a fitted text line by line, exactly as shared/textfit.mjs wrapped it, in the font it was measured
 * in. `weight` draws it lighter than measured, such as a bullet before its step lights it; never heavier.
 * Lines never wrap again or clip: a text too long for its slot runs past it, and `validate` reports it.
 * `inline` draws it as a span, for text that sits in a line with other content, such as an icon.
 */
export const FitText: React.FC<{ fit: Fit; weight?: number; align?: 'left' | 'center' | 'right'; inline?: boolean; style?: CSSProperties }> = ({ fit, weight, align, inline, style }) => {
  const w = Math.min(weight ?? fit.font.weight, fit.font.weight);
  const font: CSSProperties = {
    fontFamily: fonts[fit.font.family],
    fontSize: fit.size,
    fontWeight: w,
    letterSpacing: fit.font.letterSpacing,
    textTransform: fit.font.upper ? 'uppercase' : undefined,
  };
  if (inline) {
    return (
      <span style={{ ...font, whiteSpace: 'pre', ...style }}>
        {fit.lines.map((line, i) => (
          <span key={i}>
            {i > 0 ? <br /> : null}
            <Line runs={line} width={fit.widths[i]!} weight={w} />
          </span>
        ))}
      </span>
    );
  }
  return (
    <div
      style={{
        ...font,
        lineHeight: fit.lineHeight,
        textAlign: align,
        ...style,
      }}
    >
      {fit.lines.map((line, i) => (
        <div key={i} style={{ whiteSpace: 'pre' }}>
          <Line runs={line} width={fit.widths[i]!} weight={w} />
        </div>
      ))}
    </div>
  );
};
