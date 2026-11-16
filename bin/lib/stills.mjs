// Which frame a still shows and what contact sheets are called, for both renderers.

import { sceneDurationInFrames, sceneSegments, settledFrame } from '../../shared/timing.mjs';

/** Scenes to a contact sheet; more go on further sheets. */
export const SHEET_SCENES = 12;

/** The frame of a scene a still shows: its settled end, or the end of step `step`, two frames before the next starts. */
export function stillFrame(scene, voiceover, step) {
  if (step === undefined) return settledFrame(sceneDurationInFrames(scene, voiceover));
  const segment = sceneSegments(scene, voiceover)[step + 1];
  if (!segment) throw new Error(`the ${scene.type} scene has no step ${step}`);
  // The last step ends as the scene fades out, so its still is the settled frame before the fade.
  return Math.min(segment.from + segment.durationInFrames - 2, settledFrame(sceneDurationInFrames(scene, voiceover)));
}

/** The sheets' file names for `count` scenes: `sheet.png`, or `sheet-1.png`, `sheet-2.png` and on past SHEET_SCENES. */
export function sheetNames(count) {
  const n = Math.max(1, Math.ceil(count / SHEET_SCENES));
  return n === 1 ? ['sheet.png'] : Array.from({ length: n }, (_, i) => `sheet-${i + 1}.png`);
}
