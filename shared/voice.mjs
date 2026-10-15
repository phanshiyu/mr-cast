// Voice-over lookup shared by the CLI (plain Node) and the player bundle.

export const DEFAULT_VOICE = 'af_heart';

/**
 * Named paces: Kokoro's speaking speed, and a factor on every pause around the voice. A slower pace
 * also leaves the viewer more time to look at the screen between sentences.
 */
export const PACES = {
  slower: { speed: 0.85, pauses: 1.5 },
  normal: { speed: 1, pauses: 1 },
  faster: { speed: 1.15, pauses: 0.85 },
};

/**
 * FNV-1a (32-bit) over the voice, the speed and the spoken text, as 8 hex digits. Names a clip in
 * voiceover.json. Speed 1 is left out of the hash, so clips voiced before speeds existed keep their names.
 */
export function narrationKey(text, voice, speed = 1) {
  const pace = speed === 1 ? '' : `${speed}\n`;
  const input = `${voice}\n${pace}${String(text ?? '').trim()}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The pace a voiceover was made at; the normal pace without one. */
export const paceOf = (voiceover) => ({ speed: voiceover?.speed ?? 1, pauses: voiceover?.pauses ?? 1 });

export function clipFor(voiceover, narration) {
  return voiceover ? voiceover.clips[narrationKey(narration, voiceover.voice, paceOf(voiceover).speed)] : undefined;
}
