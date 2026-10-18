import { fitText, type Fit } from '../../shared/textfit.mjs';
import { sceneChapter } from '../../shared/chapters.mjs';
import { SAFE, contentBox } from '../components/theme';
import type { Scene } from '../types';
import { calloutBoxWidth, hasCallout } from './callout';
import { SLOTS, sized } from './slots';

/** Room the header keeps for a scene's legend, stats or subject at its right end. */
const ASIDE_RESERVE = 560;
const ASIDE_GAP = 32;
/** Smallest size a title beside a callout keeps on one line before it wraps. */
const TITLE_ONE_LINE_MIN = 42;
const WITH_ASIDE = new Set<Scene['type']>(['text', 'graph', 'state', 'table', 'er', 'chart', 'files', 'review']);

export interface ShellFits {
  eyebrow: Fit;
  title: Fit | null;
}

/**
 * The chapter label and title every scene's header draws. Beside a callout the title first shrinks a little,
 * then wraps onto a second line, rather than shrinking to its smallest size on one.
 */
export function shellFits(scene: Scene): ShellFits {
  // A callout sits beside the aside the type may draw, such as a change legend.
  const callout = calloutBoxWidth(scene);
  const aside = (WITH_ASIDE.has(scene.type) ? ASIDE_RESERVE + ASIDE_GAP : 0) + (callout ? callout + ASIDE_GAP : 0);
  const width = 1920 - SAFE.left - SAFE.right - aside;
  const title = 'title' in scene && scene.title ? scene.title : null;
  const titleSlot = callout ? { ...sized(SLOTS.title, width), lines: 2, oneLineMin: TITLE_ONE_LINE_MIN } : sized(SLOTS.title, width);
  return {
    eyebrow: fitText(sceneChapter(scene), sized(SLOTS.eyebrow, width), scene.chapter ? 'chapter' : ''),
    title: title ? fitText(title, titleSlot, 'title') : null,
  };
}

/** The content box of a scene that may have a callout: its header is as tall as a title's, and a wrapped title's second line more. */
export function headerBox(scene: Scene): { width: number; height: number } {
  const { title } = shellFits(scene);
  const box = contentBox(Boolean(title) || hasCallout(scene));
  return title ? { ...box, height: box.height - (title.lines.length - 1) * Math.round(title.size * title.lineHeight) } : box;
}
