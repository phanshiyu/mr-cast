import { fitText, fitTextAt, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { DiagramNode } from '../types';

/** Card proportions: a graph node is a large card, a sequence participant a smaller one, compact when its column is narrow. */
export type CardSize = 'large' | 'small' | 'compact';

export const CARD_METRICS: Record<
  CardSize,
  {
    icon: number;
    iconRadius: number;
    pad: number;
    gap: number;
    radius: number;
    caption: number;
    badge: number;
    badgeAt: [number, number];
    ring: [number, number];
  }
> = {
  large: {
    icon: 56,
    iconRadius: 14,
    pad: 22,
    gap: 18,
    radius: 20,
    caption: 19,
    badge: 16,
    badgeAt: [-16, 18],
    ring: [6, 48],
  },
  small: {
    icon: 48,
    iconRadius: 12,
    pad: 16,
    gap: 14,
    radius: 18,
    caption: 17,
    badge: 14,
    badgeAt: [-14, 14],
    ring: [5, 40],
  },
  compact: {
    icon: 40,
    iconRadius: 12,
    pad: 14,
    gap: 12,
    radius: 18,
    caption: 17,
    badge: 14,
    badgeAt: [-14, 14],
    ring: [5, 40],
  },
};

/** A card's title and caption, fitted to its card. */
export interface CardText {
  title: Fit;
  caption: Fit | null;
}

/** Width the title and caption have: the card less its padding and its icon tile. */
export const cardTextWidth = (node: DiagramNode, width: number, size: CardSize) => {
  const m = CARD_METRICS[size];
  return width - 2 * m.pad - (node.icon ? m.icon + m.gap : 0) - 4;
};

const titleSlot = (size: CardSize) => (size === 'large' ? SLOTS.cardTitle : SLOTS.smallCardTitle);
const captionSlot = (size: CardSize) => (size === 'large' ? SLOTS.cardCaption : SLOTS.smallCardCaption);
/** Room kept above and below a card's text, and between its title and caption. */
const CARD_V_PAD = 8;
const captionGap = (size: CardSize) => (size === 'large' ? 4 : 3);

function captionOf(n: DiagramNode, width: number, size: CardSize, path: string): Fit | null {
  return n.caption
    ? fitText(n.caption, sized(captionSlot(size), cardTextWidth(n, width, size)), `${path}.caption`)
    : null;
}

/** A card's title at the largest size at which it fits its width and, with its caption, the card's `height`. */
function ownTitle(
  n: DiagramNode,
  width: number,
  height: number,
  size: CardSize,
  path: string,
  caption: Fit | null,
): Fit {
  const slot = sized(titleSlot(size), cardTextWidth(n, width, size));
  const room = height - 2 * CARD_V_PAD - (caption ? caption.height + captionGap(size) : 0);
  for (let s = slot.size; ; s--) {
    const fit = fitText(n.label, { ...slot, size: s, oneLineMin: Math.min(slot.oneLineMin ?? s, s) }, `${path}.label`);
    if (fit.height <= room || s <= slot.min || !fit.fits) return fit;
  }
}

/** One title size for every card of a diagram: the largest at which each title fits its card. */
export function sharedTitleSize(nodes: readonly DiagramNode[], width: number, height: number, size: CardSize): number {
  return Math.min(
    titleSlot(size).size,
    ...nodes.map((n) => ownTitle(n, width, height, size, '', captionOf(n, width, size, '')).size),
  );
}

/**
 * Each card's title, at one size shared by every card or at its own, and its caption, keyed by node id.
 * `path(i)` names the node in the storyboard, e.g. "nodes[2]".
 */
export function cardTexts(
  nodes: readonly DiagramNode[],
  width: number,
  height: number,
  size: CardSize,
  path: (i: number) => string,
  { shared = true } = {},
): Map<string, CardText> {
  const one = shared ? sharedTitleSize(nodes, width, height, size) : Infinity;
  return new Map(
    nodes.map((n, i) => {
      const caption = captionOf(n, width, size, path(i));
      const own = ownTitle(n, width, height, size, path(i), caption);
      const title =
        one < own.size
          ? fitTextAt(n.label, sized(titleSlot(size), cardTextWidth(n, width, size)), `${path(i)}.label`, one)
          : own;
      return [n.id, { title: title.fits ? title : own, caption }];
    }),
  );
}
