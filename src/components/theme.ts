import type { Severity } from '../types';

/** The composition reserves this band at the bottom for burned-in captions. */
const CAPTION_BAND = 150;
export const SAFE = { left: 104, right: 104, top: 64, bottom: CAPTION_BAND };

/** Ink of a review finding's severity: its pen mark, note and recap row. */
export const severityInk: Record<Severity, string> = {
  bug: '#ff6b7a',
  risk: '#ff9f43',
  nit: '#8fa0ff',
};

/** The label a scene's header and the player's chapter list show: its own chapter, or one for its type. A graph that branches at a decision is a flowchart. */

export const CODE_TAB_SIZE = 2;
/** The smallest size, in px, the project treats as readable for code in one column. */
export const CODE_READABLE_MIN = 15;

const HEADER_EYEBROW = 26 + 36;
const HEADER_TITLE = 70;

/** Size of SceneShell's content box, so scenes can lay out without measuring the DOM. */
export function contentBox(hasTitle: boolean) {
  return {
    width: 1920 - SAFE.left - SAFE.right,
    height: 1080 - SAFE.top - SAFE.bottom - HEADER_EYEBROW - (hasTitle ? HEADER_TITLE : 0),
  };
}
