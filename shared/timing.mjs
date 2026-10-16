// The one duration formula, shared by the composition (TS) and the CLI (plain Node).
//
// A scene speaks one or more texts in order: its narration, then each step's `say`. Each spoken text
// is a segment: a lead, the voice, then a tail. The narration's lead lasts until the scene has built,
// so the voice never names something that is not on screen yet. A step's lead first brings its items
// into view and lights them, within STEP_SETTLE_FRAMES; a step with a pen mark then draws it on the
// settled items before the voice names them. Its longer tail leaves time to reread them. The voice lasts
// as long as its clip, or as long as its words take to read at WORDS_PER_MINUTE without one. The pace
// scales the reading speed and every pause.

import { plainText } from './markup.mjs';
import { sceneSteps } from './steps.mjs';
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
/**
 * Seconds each scene type takes to draw in, from the scene's first frame. With steps, the scene draws
 * its base (lifelines, axes, every node) in this time, and each step shows or lights its own items.
 * Code and intent scenes pace their entrance against the voice themselves, so they have none here.
 */
export const BUILD_SECONDS = {
  intent: 0,
  code: 0,
  graph: 1.5,
  sequence: 1.5,
  flow: 1.2,
  er: 1.5,
  state: 1.5,
  mermaid: 0.8,
  tests: 1.8,
  table: 1.5,
  chart: 1.8,
  timeline: 1.5,
  files: 1.5,
  review: 1.5,
};
/**
 * Frames every scene has, from a step's start, to bring the step's items to rest: move its camera, draw
 * them in and light them. A step's lead never ends sooner, and its pen mark starts here.
 */
export const STEP_SETTLE_FRAMES = 15;
/** Frames a step's pen mark takes to draw, between the settled items and the step's words. */
export const PEN_FRAMES = 12;
/** Pause between the end of the build and the narration's voice, at every pace. */
const BUILD_SETTLE = 0.3;

/** Frames a scene type takes to draw in; its narration's voice starts after them. */
export function buildFrames(type) {
  return Math.round((BUILD_SECONDS[type] ?? 0) * FPS);
}

export function wordCount(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/** The texts a scene speaks, in order: its narration, then each step's `say`, without markup, which is only drawn. */
export function spokenTexts(scene) {
  return [scene?.narration, ...sceneSteps(scene).map((step) => step?.say)].map((text) => (typeof text === 'string' ? plainText(text) : text));
}

/**
 * The scene's spoken segments, timed from the scene's start. Segment 0 is the narration; segment k is
 * step k - 1, which is lit from `from`, has its items at rest by `markFrom`, where its pen mark starts,
 * and starts its voice at `voiceFrom`.
 */
export function sceneSegments(scene, voiceover) {
  const { speed, pauses } = paceOf(voiceover);
  const pause = (seconds) => Math.round(seconds * pauses * FPS);
  const narrationLead = Math.max(pause(NARRATION_LEAD), buildFrames(scene?.type) + Math.round(BUILD_SETTLE * FPS));
  const steps = sceneSteps(scene);
  let from = 0;
  return spokenTexts(scene).map((text, i) => {
    const clip = clipFor(voiceover, text);
    const markFrom = from + (i === 0 ? narrationLead : Math.max(pause(STEP_LEAD), STEP_SETTLE_FRAMES));
    const voiceFrom = markFrom + (i > 0 && (typeof steps[i - 1]?.mark === 'string' || typeof steps[i - 1]?.flag === 'string') ? PEN_FRAMES : 0);
    const speakingFrames = clip ? clip.seconds * FPS : (wordCount(text) / (WORDS_PER_MINUTE * speed)) * 60 * FPS;
    const after = clip
      ? Math.ceil(speakingFrames) + pause(i === 0 ? NARRATION_TAIL : STEP_TAIL)
      : Math.max(MIN_SILENT_SECONDS * FPS, Math.ceil(speakingFrames) + pause(SILENT_TAIL));
    const segment = { text, from, markFrom, voiceFrom, durationInFrames: voiceFrom - from + after, speakingFrames, clip };
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
