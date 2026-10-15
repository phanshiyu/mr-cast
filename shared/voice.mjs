// Voice-over lookup shared by the CLI (plain Node) and the player bundle.

export const DEFAULT_VOICE = 'af_heart';

/** FNV-1a (32-bit) over the voice and the spoken text, as 8 hex digits. Names a clip in voiceover.json. */
export function narrationKey(text, voice) {
  const input = `${voice}\n${String(text ?? '').trim()}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function clipFor(voiceover, narration) {
  return voiceover ? voiceover.clips[narrationKey(narration, voiceover.voice)] : undefined;
}
