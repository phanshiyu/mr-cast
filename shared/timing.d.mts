import type { Scene, VoiceClip, Voiceover } from '../src/types';

type MaybeVoiceover = Voiceover | null | undefined;

/** One spoken text of a scene: its narration or a step's `say`, timed inside the scene. */
export interface SpokenSegment {
  text: string;
  /** First frame of the segment, counted from the scene's start. A step is lit from here. */
  from: number;
  /** Frame its voice and caption start, after the segment's lead. */
  voiceFrom: number;
  durationInFrames: number;
  /** Frames the words take: the clip's length, or the estimated reading time. */
  speakingFrames: number;
  /** The segment's voice-over, when voiceover.json has one for its text. */
  clip: VoiceClip | undefined;
}

export declare const FPS: 30;
export declare const WORDS_PER_MINUTE: number;
export declare const SCENE_EXIT_FRAMES: number;
export declare function wordCount(text: string | null | undefined): number;
export declare function spokenTexts(scene: Scene): string[];
export declare function sceneSegments(scene: Scene, voiceover?: MaybeVoiceover): SpokenSegment[];
export declare function sceneDurationInFrames(scene: Scene, voiceover?: MaybeVoiceover): number;
export declare function settledFrame(durationInFrames: number): number;
export declare function spokenAt(segments: readonly SpokenSegment[], frameInScene: number): { index: number; text: string; word: number };
