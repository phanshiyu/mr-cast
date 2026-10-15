// The one duration formula, shared by the composition (TS) and the CLI (plain Node).

export const FPS = 30;
export const WORDS_PER_MINUTE = 160;
const BUFFER_SECONDS = 1.5;
const MIN_SECONDS = 3;

export function wordCount(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

export function sceneSeconds(narration) {
  return Math.max(MIN_SECONDS, (wordCount(narration) / WORDS_PER_MINUTE) * 60 + BUFFER_SECONDS);
}

export function sceneDurationInFrames(narration) {
  return Math.ceil(sceneSeconds(narration) * FPS);
}
