import type { Scene, VoiceClip, Voiceover } from '../src/types';

type MaybeVoiceover = Voiceover | null | undefined;

/** One spoken text of a scene: its narration or a code step's `say`, timed inside the scene. */
export interface SpokenSegment {
  text: string;
  /** First frame of the segment, counted from the scene's start; its clip plays from here. */
  from: number;
  durationInFrames: number;
  /** The segment's voice-over, when voiceover.json has one for its text. */
  clip: VoiceClip | undefined;
}

export declare const FPS: 30;
export declare const WORDS_PER_MINUTE: number;
export declare const VOICE_LEAD_FRAMES: number;
export declare const SCENE_EXIT_FRAMES: number;
export declare function wordCount(text: string | null | undefined): number;
export declare function sceneSeconds(narration: string | null | undefined): number;
export declare function spokenTexts(scene: Scene): string[];
export declare function sceneSegments(scene: Scene, voiceover?: MaybeVoiceover): SpokenSegment[];
export declare function sceneDurationInFrames(scene: Scene, voiceover?: MaybeVoiceover): number;
export declare function settledFrame(durationInFrames: number): number;
export declare function spokenAt(segments: readonly SpokenSegment[], frameInScene: number): { index: number; text: string; word: number };
