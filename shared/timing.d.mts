import type { Scene, VoiceClip, Voiceover } from '../src/types';

type MaybeVoiceover = Voiceover | null | undefined;

/** One spoken text of a scene: its narration or a step's `say`, timed inside the scene. */
export interface SpokenSegment {
  text: string;
  /** First frame of the segment, counted from the scene's start. A step is lit from here. */
  from: number;
  /** Frame a step's items are at rest, where its pen mark starts; the voice's frame when there is no mark. */
  markFrom: number;
  /** Frame its voice and caption start, after the segment's lead. */
  voiceFrom: number;
  durationInFrames: number;
  /** Frames the words take: the clip's length, or the estimated reading time. */
  speakingFrames: number;
  /** The segment's voice-over, when voiceover.json has one for its text. */
  clip: VoiceClip | undefined;
}

export declare const FPS: 30;
export declare const SCENE_EXIT_FRAMES: number;
export declare const STEP_SETTLE_FRAMES: number;
export declare function buildFrames(type: Scene['type']): number;
export declare function wordCount(text: string | null | undefined): number;
export declare function spokenTexts(scene: Scene): string[];
export declare function sceneSegments(scene: Scene, voiceover?: MaybeVoiceover): SpokenSegment[];
export declare function sceneDurationInFrames(scene: Scene, voiceover?: MaybeVoiceover): number;
export declare function settledFrame(durationInFrames: number): number;
export declare function spokenAt(
  segments: readonly SpokenSegment[],
  frameInScene: number,
): { index: number; text: string; word: number };
/** Index of the first word of `cue` among a spoken text's words, or -1 when the text does not say it. */
export declare function cueWord(text: string, cue: string): number;
/** Frame, from the scene's start, at which a segment's voice says `cue`, less a short lead; null when it never does. */
export declare function cueFrame(segment: SpokenSegment, cue: string): number | null;
