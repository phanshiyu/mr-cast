import { Check, CornerDownRight } from 'lucide-react';
import { spring } from 'remotion';
import type { CodeScene } from '../types';
import { splitInTwo, wrapLabel } from '../utils/wrapLabel';
import { colors, fonts } from './theme';

export type FlowSteps = NonNullable<CodeScene['flow']>;

const NODE_PAD_X = 20;
const NODE_PAD_Y = 16;
const BADGE = 40;
const BADGE_GAP = 16;
/** Gap between nodes, where the arrow runs; it tightens before the font shrinks. */
const ARROW_GAPS = [42, 26];
const OUTCOME_GAP = 8;
const LABEL_LINE = 1.25;
const OUTCOME_LINE = 1.3;
/** Average glyph width of the sans font, as a share of the font size. */
const GLYPH_W = 0.48;
const FONT_MAX = 26;
const FONT_MIN = 17;

interface NodeLayout {
  top: number;
  height: number;
  label: string[];
  outcome: string[];
}

export interface StepLayout {
  fontSize: number;
  nodes: NodeLayout[];
  height: number;
}

const outcomeFont = (fontSize: number) => Math.round(fontSize * 0.8);

/** One or two lines of at most `maxChars`, or null when the text needs more. */
function twoLines(text: string, maxChars: number): string[] | null {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxChars) return [clean];
  return splitInTwo(clean, maxChars);
}

function layoutAt(steps: FlowSteps, width: number, fontSize: number, gap: number, wrap: typeof twoLines): StepLayout | null {
  const textW = width - NODE_PAD_X * 2 - BADGE - BADGE_GAP;
  const small = outcomeFont(fontSize);
  const nodes: NodeLayout[] = [];
  let top = 0;
  for (const step of steps) {
    const label = wrap(step.label, Math.floor(textW / (fontSize * GLYPH_W)));
    const outcome = step.outcome?.trim() ? wrap(step.outcome, Math.floor((textW - small - 8) / (small * GLYPH_W))) : [];
    if (!label || !outcome) return null;
    const text = label.length * fontSize * LABEL_LINE + (outcome.length ? OUTCOME_GAP + outcome.length * small * OUTCOME_LINE : 0);
    const height = Math.round(Math.max(BADGE, text) + NODE_PAD_Y * 2);
    nodes.push({ top, height, label, outcome });
    top += height + gap;
  }
  return { fontSize, nodes, height: top - gap };
}

/** The largest font at which every label and outcome fits in two lines and the stack fits `maxHeight`. */
export function layoutSteps(steps: FlowSteps, width: number, maxHeight: number): StepLayout {
  for (let size = FONT_MAX; size >= FONT_MIN; size--) {
    for (const gap of ARROW_GAPS) {
      const layout = layoutAt(steps, width, size, gap, twoLines);
      if (layout && layout.height <= maxHeight) return layout;
    }
  }
  return layoutAt(steps, width, FONT_MIN, ARROW_GAPS[ARROW_GAPS.length - 1]!, wrapLabel)!;
}

interface StepDiagramProps {
  layout: StepLayout;
  /** Where the code panel ends and the diagram column starts, in the shared panel coordinates. */
  codeRight: number;
  left: number;
  top: number;
  width: number;
  /** Panel y of each step's code range, where its connector starts. */
  codeY: number[];
  /** 0 to 1: how far the focus schedule has reached step k. The code highlight reads the same value. */
  reached: (k: number) => number;
  frame: number;
  fps: number;
}

/** A vertical stepper beside the code: the step whose range is highlighted lights up and a connector joins them. */
export const StepDiagram: React.FC<StepDiagramProps> = ({ layout, codeRight, left, top, width, codeY, reached, frame, fps }) => {
  const { fontSize, nodes } = layout;
  const small = outcomeFont(fontSize);
  const arrowX = left + NODE_PAD_X + BADGE / 2;
  const appear = (k: number) => spring({ frame: frame - 6 - k * 4, fps, config: { damping: 18 } });

  return (
    <>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        {nodes.slice(1).map((node, i) => {
          const from = top + nodes[i]!.top + nodes[i]!.height;
          const to = top + node.top;
          const drawn = reached(i + 1);
          const tip = from + (to - from - 2) * drawn;
          return (
            <g key={i} opacity={appear(i + 1)}>
              <line x1={arrowX} y1={from} x2={arrowX} y2={to - 2} stroke={colors.borderStrong} strokeWidth={2} strokeDasharray="5 6" />
              {drawn > 0 ? (
                <>
                  <line x1={arrowX} y1={from} x2={arrowX} y2={tip - 6} stroke={colors.accent} strokeWidth={3} opacity={0.5 + 0.5 * drawn} />
                  <path d={`M ${arrowX - 7} ${tip - 9} L ${arrowX} ${tip} L ${arrowX + 7} ${tip - 9}`} fill="none" stroke={colors.accent} strokeWidth={3} strokeLinejoin="round" />
                </>
              ) : null}
            </g>
          );
        })}
        {nodes.map((node, k) => {
          const strength = reached(k) - reached(k + 1);
          if (strength <= 0) return null;
          const y1 = codeY[k]!;
          const y2 = top + node.top + node.height / 2;
          const mid = (codeRight + left) / 2;
          return (
            <g key={k} opacity={strength}>
              <path d={`M ${codeRight} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${left - 4} ${y2}`} fill="none" stroke={colors.accent} strokeWidth={3} />
              <circle cx={codeRight} cy={y1} r={7} fill={colors.accent} />
            </g>
          );
        })}
      </svg>
      {nodes.map((node, k) => {
        const now = reached(k);
        const passed = reached(k + 1);
        const active = now - passed;
        const state = active >= 0.5 ? 'active' : passed >= 0.5 ? 'visited' : 'future';
        return (
          <div
            key={k}
            style={{
              position: 'absolute',
              left,
              top: top + node.top,
              width,
              height: node.height,
              boxSizing: 'border-box',
              display: 'flex',
              gap: BADGE_GAP,
              padding: `${NODE_PAD_Y}px ${NODE_PAD_X}px`,
              borderRadius: 16,
              background: state === 'active' ? 'linear-gradient(180deg, #1d2136, #161a2a)' : colors.raised,
              border: `2px ${now >= 0.5 ? 'solid' : 'dashed'} ${state === 'active' ? colors.accent : state === 'visited' ? 'rgba(124, 140, 255, 0.4)' : colors.borderStrong}`,
              boxShadow: active > 0 ? `0 0 ${36 * active}px rgba(124, 140, 255, ${0.45 * active})` : undefined,
              opacity: appear(k) * (0.38 + 0.62 * now - 0.28 * passed),
              transform: `scale(${0.96 + 0.04 * now})`,
              transformOrigin: 'left center',
            }}
          >
            <div
              style={{
                width: BADGE,
                height: BADGE,
                borderRadius: 999,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                fontWeight: 700,
                background: state === 'active' ? colors.accent : state === 'visited' ? '#1d2140' : 'transparent',
                color: state === 'active' ? '#0b0d18' : state === 'visited' ? colors.accent : colors.faint,
                border: `2px solid ${state === 'future' ? colors.borderStrong : colors.accent}`,
                boxSizing: 'border-box',
              }}
            >
              {state === 'visited' ? <Check size={22} strokeWidth={3} /> : k + 1}
            </div>
            <div style={{ minWidth: 0, flex: 1, alignSelf: 'center' }}>
              <div style={{ fontFamily: fonts.sans, fontSize, lineHeight: LABEL_LINE, fontWeight: state === 'active' ? 650 : 550, color: colors.text }}>
                {node.label.map((line, i) => (
                  <div key={i} style={{ whiteSpace: 'nowrap' }}>
                    {line}
                  </div>
                ))}
              </div>
              {node.outcome.length ? (
                <div style={{ display: 'flex', gap: 8, marginTop: OUTCOME_GAP, fontSize: small, lineHeight: OUTCOME_LINE, color: state === 'active' ? '#c3c9ff' : colors.muted }}>
                  <CornerDownRight size={small} style={{ flexShrink: 0, marginTop: small * 0.15 }} />
                  <div>
                    {node.outcome.map((line, i) => (
                      <div key={i} style={{ whiteSpace: 'nowrap' }}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
};
