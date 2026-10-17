import { fitText, type Fit } from '../../shared/textfit.mjs';
import { sceneChapter } from '../../shared/chapters.mjs';
import { SAFE } from '../components/theme';
import type { Scene } from '../types';
import { CALLOUT_W, hasCallout } from './callout';
import { SLOTS, sized } from './slots';

/** Room the header keeps for a scene's legend, stats or subject at its right end. */
const ASIDE_RESERVE = 560;
const ASIDE_GAP = 32;
const WITH_ASIDE = new Set<Scene['type']>(['intent', 'graph', 'state', 'table', 'er', 'chart', 'files', 'tests', 'review']);

export interface ShellFits {
  eyebrow: Fit;
  title: Fit | null;
}

/** The chapter label and title every scene's header draws. */
export function shellFits(scene: Scene): ShellFits {
  // A callout sits beside the aside the type may draw, such as a change legend.
  const aside = (WITH_ASIDE.has(scene.type) ? ASIDE_RESERVE + ASIDE_GAP : 0) + (hasCallout(scene) ? CALLOUT_W + ASIDE_GAP : 0);
  const width = 1920 - SAFE.left - SAFE.right - aside;
  const title = 'title' in scene && scene.title ? scene.title : null;
  return {
    eyebrow: fitText(sceneChapter(scene), sized(SLOTS.eyebrow, width), scene.chapter ? 'chapter' : ''),
    title: title ? fitText(title, sized(SLOTS.title, width), 'title') : null,
  };
}
