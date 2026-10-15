import type { Risk, Scene } from '../types';

export const colors = {
  bg: '#07080c',
  surface: 'rgba(22, 25, 34, 0.86)',
  raised: '#1a1d28',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
  text: '#f2f4f8',
  muted: '#9097a8',
  faint: '#5b6172',
  accent: '#7c8cff',
  accentSoft: 'rgba(124, 140, 255, 0.14)',
  accentGlow: 'rgba(124, 140, 255, 0.45)',
  add: '#3ddc97',
  addBg: 'rgba(61, 220, 151, 0.12)',
  del: '#ff6b7a',
  delBg: 'rgba(255, 107, 122, 0.13)',
};

export const fonts = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  mono: '"SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Mono", Consolas, "Liberation Mono", monospace',
};

export const riskColors: Record<Risk, string> = {
  low: '#3ddc97',
  medium: '#fbbf24',
  high: '#ff6b7a',
};

/** The composition reserves this band at the bottom for burned-in captions. */
export const CAPTION_BAND = 150;
export const SAFE = { left: 104, right: 104, top: 64, bottom: CAPTION_BAND };

export const defaultChapter: Record<Scene['type'], string> = {
  intent: 'Overview',
  graph: 'Architecture',
  code: 'Code change',
  flow: 'Data flow',
  sequence: 'Sequence',
  er: 'Data model',
  state: 'States',
  mermaid: 'Diagram',
  tests: 'Tests',
  table: 'Table',
  chart: 'Chart',
  timeline: 'Timeline',
  files: 'Files',
};

export const CODE_TAB_SIZE = 2;
/** Display width of a code line in character cells, with tabs expanded to CODE_TAB_SIZE stops. */
export function codeColumns(text: string): number {
  let col = 0;
  for (const ch of text) col = ch === '\t' ? col + CODE_TAB_SIZE - (col % CODE_TAB_SIZE) : col + 1;
  return col;
}

export const clamp ={ extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const HEADER_EYEBROW = 26 + 36;
const HEADER_TITLE = 70;

/** Size of SceneShell's content box, so scenes can lay out without measuring the DOM. */
export function contentBox(hasTitle: boolean) {
  return {
    width: 1920 - SAFE.left - SAFE.right,
    height: 1080 - SAFE.top - SAFE.bottom - HEADER_EYEBROW - (hasTitle ? HEADER_TITLE : 0),
  };
}
