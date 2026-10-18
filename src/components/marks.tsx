import type { Change, Marks } from '../types';
import { CHANGE_WORD } from '../utils/marks';
import { colors } from './theme';
import { tones } from './tones';

export const changeTone: Record<Change, { color: string; bg: string; marker: string }> = {
  added: { color: colors.add, bg: colors.addBg, marker: '+' },
  removed: { color: colors.del, bg: colors.delBg, marker: '−' },
  modified: { color: colors.accent, bg: colors.accentSoft, marker: '~' },
};

/**
 * "Look here": white light on the part, a colour no change uses, so a highlight never reads as a change.
 * Every scene draws a highlight from these.
 */
export const EMPHASIS = {
  color: '#f4f1e8',
  soft: 'rgba(255, 250, 236, 0.12)',
  glow: 'rgba(255, 250, 236, 0.5)',
  /** Card background, a lift on `colors.raised`. */
  card: 'linear-gradient(180deg, #24262d, #1b1d24)',
};

/** Box shadow of a highlighted card or row: a soft white ring and glow. */
export const emphasisRing = (ring: number, blur: number) =>
  `0 0 0 ${ring}px ${EMPHASIS.soft}, 0 0 ${blur}px ${EMPHASIS.glow}`;

export interface BadgeSpec {
  text: string;
  color: string;
}

/** The badges an item shows: its change first, when the item says changes in words, then its own badge. */
export function badgesOf(item: Marks, { change = true }: { change?: boolean } = {}): BadgeSpec[] {
  const out: BadgeSpec[] = [];
  if (change && item.change) out.push({ text: CHANGE_WORD[item.change], color: changeTone[item.change].color });
  if (item.badge) out.push({ text: item.badge, color: tones[item.tone ?? 'neutral'].color });
  return out;
}

/** A filled pill with an uppercase word: a change or a badge of the author's own. */
export const Badge: React.FC<{ badge: BadgeSpec; size: number; style?: React.CSSProperties }> = ({
  badge,
  size,
  style,
}) => (
  <div
    style={{
      padding: `${Math.floor(size / 4)}px ${Math.floor(size * 0.75)}px`,
      borderRadius: 999,
      background: badge.color,
      color: '#0b0d18',
      fontSize: size,
      fontWeight: 800,
      letterSpacing: 1,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      flexShrink: 0,
      ...style,
    }}
  >
    {badge.text}
  </div>
);

/** Badges sitting on the top edge of a box, from its right corner. */
export const CornerBadges: React.FC<{
  badges: readonly BadgeSpec[];
  size: number;
  top: number;
  right: number;
  style?: React.CSSProperties;
}> = ({ badges, size, top, right, style }) =>
  badges.length ? (
    <div style={{ position: 'absolute', top, right, display: 'flex', gap: 6, ...style }}>
      {badges.map((b, i) => (
        <Badge key={i} badge={b} size={size} />
      ))}
    </div>
  ) : null;

/** Badges at the right end of a row, centred on it. */
export const RowBadges: React.FC<{ badges: readonly BadgeSpec[]; size: number; right: number }> = ({
  badges,
  size,
  right,
}) =>
  badges.length ? (
    <div style={{ position: 'absolute', top: 0, bottom: 0, right, display: 'flex', alignItems: 'center', gap: 6 }}>
      {badges.map((b, i) => (
        <Badge key={i} badge={b} size={size} />
      ))}
    </div>
  ) : null;
