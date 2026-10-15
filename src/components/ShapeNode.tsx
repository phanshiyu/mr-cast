import type { GraphNode } from '../types';
import type { CardText } from '../utils/nodeText';
import type { Emphasis } from '../utils/spotlight';
import { FitText } from './FitText';
import { badgesOf, CornerBadges, EMPHASIS } from './marks';
import { nodeMark } from './NodeCard';
import { colors } from './theme';

const NO_EMPHASIS: Emphasis = { opacity: 1, bar: 0, glow: 0 };

/** Fill of a shape: tinted by what the diff does to it, lifted when highlighted, else the plain card colour. */
function fillOf(node: GraphNode): string {
  if (node.change === 'added') return '#14231f';
  if (node.change === 'modified') return '#1c2033';
  return !node.change && node.highlight ? '#22242b' : colors.raised;
}

/** The glow around a shape, as CSS drop shadows, which follow a diamond's outline as well as a box's. */
function glowOf(node: GraphNode, emphasis: Emphasis): string {
  const shadows = [
    node.change === 'added' ? 'drop-shadow(0 0 18px rgba(61,220,151,0.35))' : '',
    node.change === 'modified' ? `drop-shadow(0 0 18px ${colors.accentGlow})` : '',
    !node.change && node.highlight ? `drop-shadow(0 0 16px ${EMPHASIS.glow})` : '',
    !node.change && !node.highlight ? 'drop-shadow(0 12px 24px rgba(0,0,0,0.4))' : '',
    emphasis.glow > 0 ? `drop-shadow(0 0 ${18 * emphasis.glow}px ${colors.accentGlow}) drop-shadow(0 0 ${4 * emphasis.glow}px ${colors.accent})` : '',
  ];
  return shadows.filter(Boolean).join(' ');
}

/**
 * A graph node drawn as a flowchart shape: a decision's diamond, a terminal's pill or a step's plain box,
 * its text centred inside. Marked like a card: its change colours its border and fill, a highlight
 * lifts it, a lit step glows it, and its badges sit on its top edge.
 */
export const ShapeNode: React.FC<{
  node: GraphNode;
  shape: 'decision' | 'terminal' | 'step';
  x: number;
  y: number;
  width: number;
  height: number;
  appear: number;
  emphasis?: Emphasis;
  text: CardText;
}> = ({ node, shape, x, y, width, height, appear, emphasis = NO_EMPHASIS, text }) => {
  const mark = nodeMark(node);
  const removed = node.change === 'removed';
  const stroke = removed ? `${colors.del}cc` : emphasis.glow > 0 ? colors.accent : mark?.color ?? colors.borderStrong;
  const strokeWidth = 2 + 2 * emphasis.glow;
  const words = (
    <div style={{ position: 'relative', textAlign: 'center' }}>
      <FitText
        fit={text.title}
        align="center"
        style={{ color: removed ? colors.muted : colors.text, textDecoration: removed ? 'line-through' : 'none', textDecorationColor: colors.del, textDecorationThickness: 3 }}
      />
      {text.caption ? <FitText fit={text.caption} align="center" style={{ color: colors.faint, marginTop: 4 }} /> : null}
    </div>
  );
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        opacity: appear * (removed ? 0.62 : 1) * emphasis.opacity,
        transform: `translateY(${(1 - appear) * 20}px) scale(${(0.92 + 0.08 * appear) * (1 + 0.03 * emphasis.glow)})`,
      }}
    >
      {shape === 'decision' ? (
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0, overflow: 'visible', filter: glowOf(node, emphasis) }}>
          <polygon
            points={`${width / 2},1 ${width - 1},${height / 2} ${width / 2},${height - 1} 1,${height / 2}`}
            fill={fillOf(node)}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={removed ? '9 7' : undefined}
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            boxSizing: 'border-box',
            borderRadius: shape === 'terminal' ? height / 2 : 14,
            background: fillOf(node),
            border: `${strokeWidth}px ${removed ? 'dashed' : 'solid'} ${stroke}`,
            filter: glowOf(node, emphasis),
          }}
        />
      )}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{words}</div>
      <CornerBadges badges={badgesOf(node)} size={16} top={shape === 'decision' ? height * 0.12 - 16 : -16} right={shape === 'decision' ? width * 0.22 : 18} />
    </div>
  );
};
