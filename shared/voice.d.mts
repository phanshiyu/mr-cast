import type { VoiceClip, Voiceover } from '../src/types';

export declare const DEFAULT_VOICE: string;
export declare function narrationKey(text: string | null | undefined, voice: string): string;
export declare function clipFor(voiceover: Voiceover | null | undefined, narration: string | null | undefined): VoiceClip | undefined;
