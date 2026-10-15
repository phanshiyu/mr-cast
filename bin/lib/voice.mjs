// Voice-over: one Kokoro clip per distinct narration, cached in .mr-cast/audio under its narrationKey.

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_VOICE, narrationKey } from '../../shared/voice.mjs';
import { cacheDir } from './cache.mjs';
import { UserError } from './errors.mjs';
import { withLock } from './lock.mjs';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** The weights transformers.js fetches for dtype q8; its absence means this load downloads them. */
const MODEL_FILE = 'model_quantized.onnx';
const VOICEOVER_FILE = 'voiceover.json';
const AUDIO_DIR = 'audio';
/** Clip file names; anything else under /data/audio is refused. */
export const AUDIO_NAME = /^[0-9a-f]{8}\.wav$/;
const CLIP_SRC = /^audio\/[0-9a-f]{8}\.wav$/;
const OWNED_FILE = /^[0-9a-f]{8}\.wav(\.tmp-\d+)?$/;

/** voiceover.json as written by ensureVoiceover, or null when it is missing or malformed. */
export function readVoiceover(dataDir) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dataDir, VOICEOVER_FILE), 'utf8'));
  } catch {
    return null;
  }
  if (typeof raw?.voice !== 'string' || typeof raw.clips !== 'object' || raw.clips === null) return null;
  const clips = {};
  for (const [key, clip] of Object.entries(raw.clips)) {
    if (CLIP_SRC.test(clip?.src) && Number.isFinite(clip.seconds) && clip.seconds > 0) clips[key] = { src: clip.src, seconds: clip.seconds };
  }
  return { voice: raw.voice, clips };
}

let model = null;

/**
 * Loads Kokoro once per process. A failed load is forgotten so the next call retries.
 * transformers.js writes each download straight to its final path in the cache, where another process
 * would take the partial file for a cached one, so loads hold a lock while the weights may be downloading.
 */
function loadModel(onProgress) {
  model ??= (async () => {
    const modelDir = cacheDir('models');
    try {
      const { env } = await import('@huggingface/transformers');
      env.cacheDir = modelDir;
      const { KokoroTTS, TextSplitterStream } = await import('kokoro-js');
      fs.mkdirSync(modelDir, { recursive: true });
      const tts = await withLock(`${modelDir}.lock`, () => {
        if (!fs.existsSync(path.join(modelDir, MODEL_ID, 'onnx', MODEL_FILE))) onProgress?.({ type: 'download', cacheDir: modelDir });
        return KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'cpu' });
      }, (pid) => console.error(`mr-cast: waiting for another mr-cast (pid ${pid}) to finish loading the voice model`));
      return { tts, TextSplitterStream };
    } catch (err) {
      model = null;
      throw new UserError(`could not load the Kokoro voice model (${err.message}); the first run downloads about 90 MB from huggingface.co into ${modelDir}`);
    }
  })();
  return model;
}

async function speak(tts, TextSplitterStream, text, voice) {
  // generate() truncates past 510 tokens, so speak sentence by sentence. stream() never closes the splitter
  // it builds from a string and hangs before the last sentence, so pass it a closed one.
  const sentences = new TextSplitterStream();
  sentences.push(text);
  sentences.close();
  const chunks = [];
  let sampleRate = 24000;
  for await (const { audio } of tts.stream(sentences, { voice })) {
    chunks.push(audio.audio);
    sampleRate = audio.sampling_rate;
  }
  const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    samples.set(c, offset);
    offset += c.length;
  }
  return { samples, sampleRate };
}

function encodeWav(samples, sampleRate) {
  const bytes = samples.length * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return buf;
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/**
 * Makes .mr-cast/voiceover.json and audio/*.wav match the storyboard's narration: generates missing
 * clips, drops clips no scene uses, and returns the voiceover. The model loads only when a clip is
 * missing. `voice` defaults to the voice already in voiceover.json, then af_heart.
 */
export async function ensureVoiceover({ dataDir, storyboard, voice, onProgress }) {
  const previous = readVoiceover(dataDir);
  const chosen = voice ?? previous?.voice ?? DEFAULT_VOICE;
  const clips = {};
  const missing = new Map();
  for (const { narration } of storyboard.scenes) {
    const key = narrationKey(narration, chosen);
    const known = previous?.clips[key];
    if (known && fs.existsSync(path.join(dataDir, known.src))) clips[key] = known;
    else missing.set(key, narration.trim());
  }

  if (missing.size) {
    const { tts, TextSplitterStream } = await loadModel(onProgress);
    if (!Object.hasOwn(tts.voices, chosen)) {
      throw new UserError(`unknown voice "${chosen}"; choose one of ${Object.keys(tts.voices).join(', ')}`);
    }
    fs.mkdirSync(path.join(dataDir, AUDIO_DIR), { recursive: true });
    let done = 0;
    for (const [key, text] of missing) {
      const { samples, sampleRate } = await speak(tts, TextSplitterStream, text, chosen);
      const src = `${AUDIO_DIR}/${key}.wav`;
      writeAtomic(path.join(dataDir, src), encodeWav(samples, sampleRate));
      clips[key] = { src, seconds: Math.round((samples.length / sampleRate) * 1000) / 1000 };
      onProgress?.({ type: 'clip', text, seconds: clips[key].seconds, done: ++done, total: missing.size });
    }
  }

  const voiceover = { voice: chosen, clips };
  const json = `${JSON.stringify(voiceover, null, 2)}\n`;
  const file = path.join(dataDir, VOICEOVER_FILE);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== json) writeAtomic(file, json);

  const used = new Set(Object.values(clips).map((c) => path.basename(c.src)));
  let stale = [];
  try { stale = fs.readdirSync(path.join(dataDir, AUDIO_DIR)); } catch { /* no clips yet */ }
  for (const name of stale) {
    if (OWNED_FILE.test(name) && !used.has(name)) fs.rmSync(path.join(dataDir, AUDIO_DIR, name), { force: true });
  }
  return voiceover;
}
