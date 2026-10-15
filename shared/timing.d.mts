import type { Voiceover } from '../src/types';

type MaybeVoiceover = Voiceover | null | undefined;

export declare const FPS: 30;
export declare const WORDS_PER_MINUTE: number;
export declare const VOICE_LEAD_FRAMES: number;
export declare function wordCount(text: string | null | undefined): number;
export declare function sceneSeconds(narration: string | null | undefined): number;
export declare function sceneDurationInFrames(narration: string | null | undefined, voiceover?: MaybeVoiceover): number;
export declare function spokenWordIndex(narration: string, frameInScene: number, voiceover?: MaybeVoiceover): number;
