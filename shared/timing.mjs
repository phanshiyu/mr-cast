// The one duration formula, shared by the composition (TS) and the CLI (plain Node).

import { clipFor } from './voice.mjs';

export const FPS = 30;
export const WORDS_PER_MINUTE = 160;
const BUFFER_SECONDS = 1.5;
const MIN_SECONDS = 3;
/** A voiced scene starts its clip after the scene fades in, and holds briefly after it ends. */
export const VOICE_LEAD_FRAMES = Math.round(0.4 * FPS);
const VOICE_TAIL_SECONDS = 0.8;

export function wordCount(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

export function sceneSeconds(narration) {
  return Math.max(MIN_SECONDS, (wordCount(narration) / WORDS_PER_MINUTE) * 60 + BUFFER_SECONDS);
}

export function sceneDurationInFrames(narration, voiceover) {
  const clip = clipFor(voiceover, narration);
  if (clip) return VOICE_LEAD_FRAMES + Math.ceil((clip.seconds + VOICE_TAIL_SECONDS) * FPS);
  return Math.ceil(sceneSeconds(narration) * FPS);
}

/**
 * Which word of the narration is being spoken at a frame of its scene. Words are spread evenly
 * over the voice clip when there is one, otherwise over the estimated speaking time.
 */
export function spokenWordIndex(narration, frameInScene, voiceover) {
  const words = wordCount(narration);
  const clip = clipFor(voiceover, narration);
  const speakingFrames = clip ? clip.seconds * FPS : (words / WORDS_PER_MINUTE) * 60 * FPS;
  const frame = clip ? frameInScene - VOICE_LEAD_FRAMES : frameInScene;
  if (speakingFrames <= 0) return words;
  return Math.max(0, Math.min(words, Math.floor((frame / speakingFrames) * words)));
}

