// The one duration formula, shared by the composition (TS) and the CLI (plain Node).
//
// A scene speaks one or more texts in order: its narration, then each code step's `say`. Each
// spoken text is a segment that lasts as long as its voice clip plus a tail, or as long as its
// word count takes to read without a voice. The scene lasts as long as its segments together.

import { clipFor } from './voice.mjs';

export const FPS = 30;
export const WORDS_PER_MINUTE = 160;
const BUFFER_SECONDS = 1.5;
const MIN_SECONDS = 3;
/** A voiced scene starts its first clip after the scene fades in. */
export const VOICE_LEAD_FRAMES = Math.round(0.4 * FPS);
/** Each clip holds this long after it ends before the next segment, or the scene, moves on. */
const VOICE_TAIL_SECONDS = 0.8;
/** Every scene fades out over its last SCENE_EXIT_FRAMES. */
export const SCENE_EXIT_FRAMES = 8;

export function wordCount(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

export function sceneSeconds(narration) {
  return Math.max(MIN_SECONDS, (wordCount(narration) / WORDS_PER_MINUTE) * 60 + BUFFER_SECONDS);
}

/** The texts a scene speaks, in order: its narration, then each code step's `say`. */
export function spokenTexts(scene) {
  const steps = scene?.type === 'code' && Array.isArray(scene.steps) ? scene.steps : [];
  return [scene?.narration, ...steps.map((step) => step?.say)];
}

/**
 * The scene's spoken segments with their start frame inside the scene. A segment holds its clip
 * plus a tail, or its estimated reading time without one. The first clip starts after a lead.
 */
export function sceneSegments(scene, voiceover) {
  const texts = spokenTexts(scene);
  const clips = texts.map((text) => clipFor(voiceover, text));
  let from = clips.some(Boolean) ? VOICE_LEAD_FRAMES : 0;
  return texts.map((text, i) => {
    const clip = clips[i];
    const durationInFrames = clip ? Math.ceil((clip.seconds + VOICE_TAIL_SECONDS) * FPS) : Math.ceil(sceneSeconds(text) * FPS);
    const segment = { text, from, durationInFrames, clip };
    from += durationInFrames;
    return segment;
  });
}

export function sceneDurationInFrames(scene, voiceover) {
  const segments = sceneSegments(scene, voiceover);
  const last = segments[segments.length - 1];
  return last.from + last.durationInFrames;
}

/** A frame just before the fade-out, where every scene's animation has settled. `mr-cast still` renders it. */
export function settledFrame(durationInFrames) {
  return Math.max(0, durationInFrames - SCENE_EXIT_FRAMES - 2);
}

/**
 * Which segment is being spoken at a frame of its scene, and which of its words. Words are spread
 * evenly over the voice clip when there is one, otherwise over the estimated speaking time. Before
 * the first segment starts it is segment 0 at word 0; after a segment's words it stays on that
 * segment, past its last word, until the next starts.
 */
export function spokenAt(segments, frameInScene) {
  let index = 0;
  for (let i = 1; i < segments.length; i++) if (frameInScene >= segments[i].from) index = i;
  const segment = segments[index];
  const words = wordCount(segment.text);
  const speakingFrames = segment.clip ? segment.clip.seconds * FPS : (words / WORDS_PER_MINUTE) * 60 * FPS;
  const frame = frameInScene - segment.from;
  const word = speakingFrames <= 0 ? words : Math.max(0, Math.min(words, Math.floor((frame / speakingFrames) * words)));
  return { index, text: segment.text, word };
}
