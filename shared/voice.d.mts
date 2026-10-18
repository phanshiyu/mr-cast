import type { VoiceClip, Voiceover } from '../src/types';

export interface Pace {
  speed: number;
  pauses: number;
}

export declare const PACES: { slower: Pace; normal: Pace; faster: Pace };
export declare function narrationKey(text: string | null | undefined, voice: string, speed?: number): string;
export declare function paceOf(voiceover: Voiceover | null | undefined): Pace;
export declare function clipFor(
  voiceover: Voiceover | null | undefined,
  narration: string | null | undefined,
): VoiceClip | undefined;
