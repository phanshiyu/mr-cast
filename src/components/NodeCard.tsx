import type { DiagramNode } from '../types';
import type { Emphasis } from '../utils/spotlight';
import { badgesOf, changeTone, CornerBadges, EMPHASIS, emphasisRing } from './marks';
import { lucideIcon } from './icons';
import { clampLines, colors, ellipsis } from './theme';
import { tones } from './tones';

/** Card proportions: an arch node is a large card, a sequence participant a smaller one, compact when its column is narrow. */
export type CardSize = 'large' | 'small' | 'compact';

const METRICS: Record<CardSize, { icon: number; iconRadius: number; pad: number; gap: number; radius: number; title: [number, number]; caption: number; badge: number; badgeAt: [number, number]; ring: [number, number] }> = {
  large: { icon: 56, iconRadius: 14, pad: 22, gap: 18, radius: 20, title: [28, 21], caption: 19, badge: 16, badgeAt: [-16, 18], ring: [6, 48] },
  small: { icon: 48, iconRadius: 12, pad: 16, gap: 14, radius: 18, title: [25, 20], caption: 17, badge: 14, badgeAt: [-14, 14], ring: [5, 40] },
  compact: { icon: 40, iconRadius: 12, pad: 14, gap: 12, radius: 18, title: [25, 20], caption: 17, badge: 14, badgeAt: [-14, 14], ring: [5, 40] },
};

/** How a node is coloured: by what the diff does to it, else as highlighted, else not at all. */
export function nodeMark(node: DiagramNode): { color: string; bg: string } | null {
  if (node.change) return changeTone[node.change];
  return node.highlight ? { color: EMPHASIS.color, bg: EMPHASIS.soft } : null;
}

/** Sans advance per em, rounded up from SF Pro semibold so estimates err towards smaller text. */
const SANS_ADVANCE = 0.58;

/** Break opportunities at spaces and camelCase or punctuation boundaries: "PaymentProvider|Client". */
function labelTokens(label: string): string[] {
  return label.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[\s:._/-])/).filter(Boolean);
}

/** Lines a greedy browser-style wrap of `tokens` takes at `fontSize` in `width`; Infinity when one token alone overflows. */
function wrappedLines(tokens: readonly string[], fontSize: number, width: number): number {
  let lines = 1;
  let used = 0;
  for (const token of tokens) {
    const w = token.length * SANS_ADVANCE * fontSize;
    if (token.trimEnd().length * SANS_ADVANCE * fontSize > width) return Infinity;
    const fit = used + token.trimEnd().length * SANS_ADVANCE * fontSize <= width;
    if (used > 0 && !fit) {
      lines += 1;
      used = w;
    } else used += w;
  }
  return lines;
}

/** Title font: one line from `max` down to `minOneLine`, then two lines, never splitting a token. */
function titleFit(label: string, width: number, [max, minOneLine]: [number, number]): { fontSize: number; twoLines: boolean } {
  const tokens = labelTokens(label);
  for (let fontSize = max; fontSize >= minOneLine; fontSize--) {
    if (wrappedLines(tokens, fontSize, width) === 1) return { fontSize, twoLines: false };
  }
  for (let fontSize = max; fontSize > 15; fontSize--) {
    const lines = wrappedLines(tokens, fontSize, width);
    if (lines <= 2) return { fontSize, twoLines: lines === 2 };
  }
  return { fontSize: 15, twoLines: true };
}

const titleWidth = (node: DiagramNode, width: number, m: (typeof METRICS)[CardSize]) => width - 2 * m.pad - (lucideIcon(node.icon) ? m.icon + m.gap : 0) - 4;

/** One title font for every card of a diagram: the largest at which each title fits its card. */
export function sharedTitleFont(nodes: readonly DiagramNode[], width: number, size: CardSize): number {
  const m = METRICS[size];
  return Math.min(m.title[0], ...nodes.map((n) => titleFit(n.label, titleWidth(n, width, m), m.title).fontSize));
}

const NO_EMPHASIS: Emphasis = { opacity: 1, bar: 0, glow: 0 };

/** A node of an arch or sequence scene: icon, label and caption, marked by its change or as a key part. */
export const NodeCard: React.FC<{
  node: DiagramNode;
  x: number;
  y: number;
  width: number;
  height: number;
  size: CardSize;
  appear: number;
  emphasis?: Emphasis;
  /** A font shared with the other cards of the diagram, from sharedTitleFont; else the card fits its own. */
  titleFont?: number;
}> = ({ node, x, y, width, height, size, appear, emphasis = NO_EMPHASIS, titleFont }) => {
  const m = METRICS[size];
  const Icon = lucideIcon(node.icon);
  const mark = nodeMark(node);
  const removed = node.change === 'removed';
  const tone = node.tone ? tones[node.tone] : null;
  const changed = node.change ? changeTone[node.change] : null;
  const iconColor = changed?.color ?? tone?.color ?? (node.highlight ? EMPHASIS.color : colors.muted);
  const iconBg = changed?.bg ?? tone?.bg ?? (node.highlight ? EMPHASIS.soft : 'rgba(255,255,255,0.05)');
  const textWidth = titleWidth(node, width, m);
  const title = titleFont ? { fontSize: titleFont, twoLines: wrappedLines(labelTokens(node.label), titleFont, textWidth) > 1 } : titleFit(node.label, textWidth, m.title);
  const background =
    node.change === 'added' ? 'linear-gradient(180deg, #14231f, #121a1a)' : node.change === 'modified' ? 'linear-gradient(180deg, #1c2033, #151826)' : !node.change && node.highlight ? EMPHASIS.card : colors.raised;
  const glow =
    node.change === 'added'
      ? `0 0 0 ${m.ring[0]}px ${colors.addBg}, 0 0 ${m.ring[1]}px rgba(61,220,151,0.3)`
      : node.change === 'modified'
        ? `0 0 0 ${m.ring[0]}px ${colors.accentSoft}, 0 0 ${m.ring[1]}px ${colors.accentGlow}`
        : !node.change && node.highlight
          ? emphasisRing(m.ring[0], m.ring[1])
          : '0 12px 32px rgba(0,0,0,0.4)';
  const lit = emphasis.glow > 0 ? `, 0 0 0 ${4 * emphasis.glow}px ${colors.accent}, 0 0 ${44 * emphasis.glow}px ${colors.accentGlow}` : '';
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
        border: `2px ${removed ? 'dashed' : 'solid'} ${removed ? `${colors.del}cc` : mark?.color ?? colors.borderStrong}`,
        boxShadow: glow + lit,
        opacity: appear * (removed ? 0.62 : 1) * emphasis.opacity,
        transform: `translateY(${(1 - appear) * (size === 'large' ? 20 : 18)}px) scale(${(0.92 + 0.08 * appear) * (1 + 0.03 * emphasis.glow)})`,
      }}
    >
      {Icon ? (
        <div
          style={{
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
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: title.fontSize,
            fontWeight: 650,
            lineHeight: 1.15,
            color: removed ? colors.muted : colors.text,
            textDecoration: removed ? 'line-through' : 'none',
            textDecorationColor: colors.del,
            textDecorationThickness: 3,
            overflowWrap: 'anywhere',
            ...clampLines(2),
          }}
        >
          {labelTokens(node.label).map((token, i) => (
            <span key={i}>
              {i > 0 ? <wbr /> : null}
              {token}
            </span>
          ))}
        </div>
        {node.caption && !title.twoLines ? <div style={{ fontSize: m.caption, color: colors.faint, marginTop: size === 'large' ? 4 : 3, ...ellipsis }}>{node.caption}</div> : null}
      </div>
      <CornerBadges badges={badgesOf(node)} size={m.badge} top={m.badgeAt[0]} right={m.badgeAt[1]} />
    </div>
  );
};
