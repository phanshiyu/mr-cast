import type { DiagramNode } from '../types';
import type { Emphasis } from '../utils/spotlight';
import { badgesOf, changeTone, CornerBadges, EMPHASIS, emphasisRing } from './marks';
import { lucideIcon } from './icons';
import { CARD_METRICS, type CardSize, type CardText } from '../utils/nodeText';
import { FitText } from './FitText';
import { colors } from './theme';
import { tones } from './tones';
import { dimOpacity, mainTone, tintFill, type TintMix } from '../utils/tint';

export type { CardSize } from '../utils/nodeText';

/** How a node is coloured: by what the diff does to it, else as highlighted, else not at all. */
export function nodeMark(node: DiagramNode): { color: string; bg: string } | null {
  if (node.change) return changeTone[node.change];
  return node.highlight ? { color: EMPHASIS.color, bg: EMPHASIS.soft } : null;
}

const NO_EMPHASIS: Emphasis = { opacity: 1, bar: 0, glow: 0 };

/** A node of a graph or sequence scene: icon, label and caption, marked by its change or as a key part. */
export const NodeCard: React.FC<{
  node: DiagramNode;
  x: number;
  y: number;
  width: number;
  height: number;
  size: CardSize;
  appear: number;
  emphasis?: Emphasis;
  /** Its title and caption as the layout fitted them. */
  text: CardText;
  /** The colour a step keeps on it: a fill and border in a tone, or faded as ruled out. */
  tint?: TintMix;
}> = ({ node, x, y, width, height, size, appear, emphasis = NO_EMPHASIS, text, tint }) => {
  const tinted = tint ? mainTone(tint) : null;
  const m = CARD_METRICS[size];
  const Icon = lucideIcon(node.icon);
  const mark = nodeMark(node);
  const removed = node.change === 'removed';
  const tone = node.tone ? tones[node.tone] : null;
  const changed = node.change ? changeTone[node.change] : null;
  const iconColor = changed?.color ?? tone?.color ?? (node.highlight ? EMPHASIS.color : colors.muted);
  const iconBg = changed?.bg ?? tone?.bg ?? (node.highlight ? EMPHASIS.soft : 'rgba(255,255,255,0.05)');
  const background =
    node.change === 'added'
      ? 'linear-gradient(180deg, #14231f, #121a1a)'
      : node.change === 'modified'
        ? 'linear-gradient(180deg, #1c2033, #151826)'
        : !node.change && node.highlight
          ? EMPHASIS.card
          : colors.raised;
  const glow =
    node.change === 'added'
      ? `0 0 0 ${m.ring[0]}px ${colors.addBg}, 0 0 ${m.ring[1]}px rgba(61,220,151,0.3)`
      : node.change === 'modified'
        ? `0 0 0 ${m.ring[0]}px ${colors.accentSoft}, 0 0 ${m.ring[1]}px ${colors.accentGlow}`
        : !node.change && node.highlight
          ? emphasisRing(m.ring[0], m.ring[1])
          : '0 12px 32px rgba(0,0,0,0.4)';
  const lit =
    emphasis.glow > 0
      ? `, 0 0 0 ${4 * emphasis.glow}px ${colors.accent}, 0 0 ${44 * emphasis.glow}px ${colors.accentGlow}`
      : '';
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: m.gap,
        padding: `0 ${m.pad}px`,
        borderRadius: m.radius,
        background,
        border: `2px ${removed ? 'dashed' : 'solid'} ${removed ? `${colors.del}cc` : tinted ? tones[tinted].color : (mark?.color ?? colors.borderStrong)}`,
        boxShadow: glow + lit,
        opacity: appear * (removed ? 0.62 : 1) * emphasis.opacity * (tint ? dimOpacity(tint) : 1),
        transform: `translateY(${(1 - appear) * (size === 'large' ? 20 : 18)}px) scale(${(0.92 + 0.08 * appear) * (1 + 0.03 * emphasis.glow)})`,
      }}
    >
      {tint?.tones.map((t, i) =>
        t.amount > 0 ? (
          <div
            key={`t${i}`}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: m.radius - 2,
              background: tintFill(tones[t.tone].color),
              opacity: t.amount,
            }}
          />
        ) : null,
      )}
      {Icon ? (
        <div
          style={{
            position: 'relative',
            width: m.icon,
            height: m.icon,
            borderRadius: m.iconRadius,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: iconBg,
            color: iconColor,
            flexShrink: 0,
          }}
        >
          <Icon size={Math.round(m.icon * (size === 'large' ? 0.536 : 0.55))} strokeWidth={2} />
        </div>
      ) : null}
      <div style={{ position: 'relative', minWidth: 0, flex: 1 }}>
        <FitText
          fit={text.title}
          style={{
            color: removed ? colors.muted : colors.text,
            textDecoration: removed ? 'line-through' : 'none',
            textDecorationColor: colors.del,
            textDecorationThickness: 3,
          }}
        />
        {text.caption ? (
          <FitText fit={text.caption} style={{ color: colors.faint, marginTop: size === 'large' ? 4 : 3 }} />
        ) : null}
      </div>
      <CornerBadges badges={badgesOf(node)} size={m.badge} top={m.badgeAt[0]} right={m.badgeAt[1]} />
    </div>
  );
};
