import { fitBlock, fitText, fitTextAt, measure, type Fit } from '../../shared/textfit.mjs';
import { contentBox } from '../components/theme';
import { SLOTS, sized } from '../fit/slots';
import type { IntentScene, Storyboard } from '../types';

export const SUMMARY_W = 1580;
/** Bullets sit after their dot, its gap and the shift a lit bullet takes. */
const BULLET_INDENT = 12 + 22 + 12;
export const SUBTITLE_SEPARATOR = ' · ';
/** Vertical rhythm of the card, in px: what the page around the summary and bullets takes. */
const SPACE = { summaryTop: 22, risk: 32 + 50, listTop: 44, bulletGap: 20, bottom: 24 };

export interface IntentLayout {
  title: Fit;
  subtitle: Fit | null;
  summary: Fit;
  bullets: Fit[];
  bulletSize: number;
  /** Everything fits the content box at the sizes chosen. */
  room: Fit;
}

/**
 * The intent card's text: the storyboard's title line, the summary in up to three lines, and each bullet in
 * up to two. Bullets share one size, from 36px (32px past four) down to 24px, the largest at which each
 * fits its two lines and the card fits the frame.
 */
export function layoutIntent(scene: IntentScene, storyboard: Storyboard): IntentLayout {
  const box = contentBox(false);
  const line = storyboard.subtitle ? `${storyboard.title}${SUBTITLE_SEPARATOR}${storyboard.subtitle}` : storyboard.title;
  const lineFit = fitText(line, sized(SLOTS.storyTitle, box.width), 'title');
  const title = fitTextAt(storyboard.title, sized(SLOTS.storyTitle, box.width), 'title', lineFit.size);
  const subtitleWidth = box.width - title.width - measure(SUBTITLE_SEPARATOR, lineFit.font);
  const subtitle = storyboard.subtitle ? fitTextAt(storyboard.subtitle, sized(SLOTS.storyTitle, Math.max(1, subtitleWidth)), 'subtitle', lineFit.size) : null;
  const summary = fitText(scene.summary, sized(SLOTS.summary, SUMMARY_W), 'summary');
  const fixed = lineFit.size * 1.2 + SPACE.summaryTop + summary.height + (scene.risk ? SPACE.risk : 0) + SPACE.listTop + SPACE.bottom;
  const bulletSlot = sized(SLOTS.bullet, box.width - BULLET_INDENT);
  const start = scene.bullets.length > 4 ? 32 : 36;
  let bullets: Fit[] = [];
  let bulletSize = start;
  for (let size = start; size >= SLOTS.bullet.min; size--) {
    bullets = scene.bullets.map((b, i) => fitTextAt(b, bulletSlot, `bullets[${i}]`, size));
    bulletSize = size;
    const height = bullets.reduce((sum, b) => sum + b.height, 0) + Math.max(0, bullets.length - 1) * SPACE.bulletGap;
    if (fixed + height <= box.height && bullets.every((b) => b.fits)) break;
  }
  const height = fixed + bullets.reduce((sum, b) => sum + b.height, 0) + Math.max(0, bullets.length - 1) * SPACE.bulletGap;
  const room = fitBlock('', 'overview card', height <= box.height, 'shorten the summary or the bullets, or keep fewer bullets');
  return { title: lineFit.fits ? title : lineFit, subtitle: lineFit.fits ? subtitle : null, summary, bullets, bulletSize, room };
}
