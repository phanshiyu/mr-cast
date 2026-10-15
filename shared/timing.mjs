// The one duration formula, shared by the composition (TS) and the CLI (plain Node).
//
// A scene speaks one or more texts in order: its narration, then each step's `say`. Each spoken text
// is a segment: a lead, the voice, then a tail. The narration's lead lets the scene build before the
// voice starts. A step's lead lights its lines or row before the voice names them, and its longer tail
// leaves time to reread them. The voice lasts as long as its clip, or as long as its words take to
// read at WORDS_PER_MINUTE without one. The pace scales the reading speed and every pause.

import { clipFor, paceOf } from './voice.mjs';

export const FPS = 30;
/** Reading pace of a scene without a voice clip, at the normal pace. */
export const WORDS_PER_MINUTE = 130;
/** Pauses at the normal pace, in seconds. The pace multiplies each one. */
const NARRATION_LEAD = 1.0;
const STEP_LEAD = 0.5;
const NARRATION_TAIL = 0.8;
const STEP_TAIL = 1.2;
/** Without a clip, the pause after the words; the clip's own trailing silence is part of it. */
const SILENT_TAIL = 1.5;
/** Without a clip, the shortest a segment's words and tail last. */
const MIN_SILENT_SECONDS = 3;
/** Every scene fades out over its last SCENE_EXIT_FRAMES. */
export const SCENE_EXIT_FRAMES = 8;

export function wordCount(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/** The texts a scene speaks, in order: its narration, then each step's `say` (code, table and files scenes). */
export function spokenTexts(scene) {
  const steps = Array.isArray(scene?.steps) && ['code', 'table', 'files'].includes(scene.type) ? scene.steps : [];
  return [scene?.narration, ...steps.map((step) => step?.say)];
}

/**
 * The scene's spoken segments, timed from the scene's start. Segment 0 is the narration; segment k is
 * step k - 1, which is lit from `from` while its voice starts at `voiceFrom`.
 */
export function sceneSegments(scene, voiceover) {
  const { speed, pauses } = paceOf(voiceover);
  const pause = (seconds) => Math.round(seconds * pauses * FPS);
  let from = 0;
  return spokenTexts(scene).map((text, i) => {
    const clip = clipFor(voiceover, text);
    const voiceFrom = from + pause(i === 0 ? NARRATION_LEAD : STEP_LEAD);
    const speakingFrames = clip ? clip.seconds * FPS : (wordCount(text) / (WORDS_PER_MINUTE * speed)) * 60 * FPS;
    const after = clip
      ? Math.ceil(speakingFrames) + pause(i === 0 ? NARRATION_TAIL : STEP_TAIL)
      : Math.max(MIN_SILENT_SECONDS * FPS, Math.ceil(speakingFrames) + pause(SILENT_TAIL));
    const segment = { text, from, voiceFrom, durationInFrames: voiceFrom - from + after, speakingFrames, clip };
    from += segment.durationInFrames;
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
 * How many of a segment's words have been spoken `seconds` after its voice starts. A clip with
 * sentence timings spreads each sentence's words over that sentence's speech, so the count holds
 * still through the pauses between sentences. Otherwise words are spread evenly.
 */
function wordsSpoken(segment, seconds) {
  const words = wordCount(segment.text);
  const sentences = segment.clip?.sentences;
  if (sentences?.length && sentences.reduce((n, s) => n + s.words, 0) === words) {
    let before = 0;
    for (const s of sentences) {
      if (seconds < s.start) return before;
      if (seconds < s.end) return before + Math.floor(((seconds - s.start) / (s.end - s.start)) * s.words);
      before += s.words;
    }
    return words;
  }
  const speaking = segment.speakingFrames / FPS;
  return speaking <= 0 ? words : Math.max(0, Math.min(words, Math.floor((seconds / speaking) * words)));
}

/**
 * Which segment is being spoken at a frame of its scene, and which of its words. A segment's caption
 * starts with its voice; until the next voice starts the caption stays on it, past its last word.
 */
export function spokenAt(segments, frameInScene) {
  let index = 0;
  for (let i = 1; i < segments.length; i++) if (frameInScene >= segments[i].voiceFrom) index = i;
  const segment = segments[index];
  const word = wordsSpoken(segment, Math.max(0, frameInScene - segment.voiceFrom) / FPS);
  return { index, text: segment.text, word };
}
