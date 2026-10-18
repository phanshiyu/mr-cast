// Voice-over: one clip per distinct spoken text (a scene's narration or a code step's `say`), cached in
// .mr-cast/audio under its narrationKey, made by the voice's engine: Kitten TTS by default, or Kokoro.

import fs from 'node:fs';
import path from 'node:path';
import { spokenTexts, wordCount } from '../../shared/timing.mjs';
import { PACES, clipFor, narrationKey } from '../../shared/voice.mjs';
import { UserError } from './errors.mjs';
import { KITTEN_REPO, downloadKitten, hubUrl, loadKitten } from './kitten.mjs';
import { removeDeadPartials, withLock } from './lock.mjs';
import { ENGINES, KOKORO_MODEL_ID, voiceParts } from './voices.mjs';

const VOICEOVER_FILE = 'voiceover.json';
const AUDIO_DIR = 'audio';
/** Clip file names; anything else under /data/audio is refused. */
export const AUDIO_NAME = /^[0-9a-f]{8}\.wav$/;
const CLIP_SRC = /^audio\/[0-9a-f]{8}\.wav$/;
const OWNED_FILE = /^[0-9a-f]{8}\.wav(\.tmp-\d+)?$/;

const MIN_SPEED = 0.5;
const MAX_SPEED = 2;
const isSpeed = (n) => Number.isFinite(n) && n >= MIN_SPEED && n <= MAX_SPEED;
const isPauses = (n) => Number.isFinite(n) && n > 0 && n <= 4;

/**
 * The pace --pace and --speed ask for, as { speed?, pauses? }: --pace names both, and --speed, a number
 * from 0.5 to 2 kept to two decimals so clip names stay stable, overrides its speed. What neither sets
 * is absent, for the normal pace.
 */
export function parsePace({ pace, speed }) {
  if (pace !== undefined && !Object.hasOwn(PACES, pace))
    throw new UserError(`--pace must be one of ${Object.keys(PACES).join(', ')} (got "${pace}")`);
  const chosen = pace === undefined ? {} : { ...PACES[pace] };
  if (speed !== undefined) {
    const n = Math.round(Number(speed) * 100) / 100;
    if (speed.trim() === '' || !isSpeed(n))
      throw new UserError(
        `--speed must be a number from ${MIN_SPEED} to ${MAX_SPEED}, such as 0.85 or 1.15 (got "${speed}")`,
      );
    chosen.speed = n;
  }
  return chosen;
}

const isSentence = (s) =>
  Number.isInteger(s?.words) && s.words >= 0 && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start;

/** How far voicing has come, in spoken lines: each distinct narration or `say` is one clip. */
export function voicedLines(storyboard, voiceover) {
  const texts = [
    ...new Set(storyboard.scenes.flatMap(spokenTexts).filter((text) => typeof text === 'string' && text.trim())),
  ];
  return { done: texts.filter((text) => clipFor(voiceover, text)).length, total: texts.length };
}

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
    if (!CLIP_SRC.test(clip?.src) || !Number.isFinite(clip.seconds) || clip.seconds <= 0) continue;
    clips[key] = { src: clip.src, seconds: clip.seconds };
    if (typeof clip.voice === 'string' && isSpeed(clip.speed))
      Object.assign(clips[key], { voice: clip.voice, speed: clip.speed });
    if (Array.isArray(clip.sentences) && clip.sentences.every(isSentence)) clips[key].sentences = clip.sentences;
  }
  return {
    voice: raw.voice,
    speed: isSpeed(raw.speed) ? raw.speed : 1,
    pauses: isPauses(raw.pauses) ? raw.pauses : 1,
    clips,
  };
}

/** Each engine's loaded model, once per process. A failed load is forgotten so the next call retries. */
const models = new Map();

const waitingFor = (what) => (pid) =>
  console.error(`mr-cast: waiting for another mr-cast (pid ${pid}) to finish ${what} the voice model`);

/** Kitten's files, each checked against its pinned sha256, downloaded under the engine's lock so two processes share one download. */
async function downloadKittenFiles(onProgress) {
  const dir = ENGINES.kitten.dir();
  if (ENGINES.kitten.downloaded()) return;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await withLock(
    ENGINES.kitten.lock(),
    async () => {
      removeDeadPartials(dir);
      if (ENGINES.kitten.downloaded()) return;
      onProgress?.({ type: 'download', engine: 'kitten', mb: ENGINES.kitten.mb, cacheDir: dir });
      await downloadKitten(dir);
    },
    waitingFor('downloading'),
  );
}

/**
 * Each engine's loader. A loaded model's `speak(text, name, speed)` yields `text` in chunks, each { sentence, audio }
 * at its `sampleRate`.
 */
const LOADERS = {
  async kitten(onProgress) {
    await downloadKittenFiles(onProgress);
    return loadKitten(ENGINES.kitten.dir());
  },
  /**
   * transformers.js downloads as it loads, so a load holds the engine's lock while the weights may be downloading:
   * prune must not delete them meanwhile, and two processes share one download.
   */
  async kokoro(onProgress) {
    const modelDir = ENGINES.kokoro.dir();
    const { env } = await import('@huggingface/transformers');
    env.cacheDir = modelDir;
    if (process.env.HF_ENDPOINT) env.remoteHost = `${hubUrl()}/`;
    const { KokoroTTS, TextSplitterStream } = await import('./kokoro/kokoro.js');
    fs.mkdirSync(modelDir, { recursive: true });
    const tts = await withLock(
      ENGINES.kokoro.lock(),
      () => {
        removeDeadPartials(modelDir);
        if (!ENGINES.kokoro.downloaded())
          onProgress?.({ type: 'download', engine: 'kokoro', mb: ENGINES.kokoro.mb, cacheDir: modelDir });
        return KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype: 'q8', device: 'cpu' });
      },
      waitingFor('loading'),
    );
    const { getVoiceData } = await import('./kokoro/voices.js');
    return {
      sampleRate: 24000,
      async prepare(name) {
        try {
          await getVoiceData(name);
        } catch (err) {
          throw new UserError(
            `could not get voice "${name}" (${err.cause?.message ?? err.message}); the first use of a Kokoro voice downloads about 0.5 MB from huggingface.co into ${modelDir}`,
          );
        }
      },
      async *speak(text, name, speed) {
        // generate() truncates past 510 tokens, so speak sentence by sentence. stream() never closes the splitter
        // it builds from a string and hangs before the last sentence, so pass it a closed one.
        const splitter = new TextSplitterStream();
        splitter.push(text);
        splitter.close();
        for await (const { text: sentence, audio } of tts.stream(splitter, { voice: name, speed }))
          yield { sentence, audio: audio.audio };
      },
    };
  },
};

const SOURCES = { kitten: KITTEN_REPO, kokoro: KOKORO_MODEL_ID };

const loadFailure = (engine, err) => {
  const { mb, dir } = ENGINES[engine];
  return new UserError(
    `could not load the ${engine} voice model (${err.message}); its first use downloads about ${mb} MB from ${hubUrl().replace(/^https?:\/\//, '')}/${SOURCES[engine]} into ${dir()}`,
  );
};

function loadEngine(engine, onProgress) {
  if (!models.has(engine)) {
    models.set(
      engine,
      LOADERS[engine](onProgress).catch((err) => {
        models.delete(engine);
        throw loadFailure(engine, err);
      }),
    );
  }
  return models.get(engine);
}

/**
 * Downloads what voicing in `voice` needs, so play can run the download where an edit does not stop it. Kitten's
 * files download without loading the model; Kokoro downloads as it loads.
 */
export async function downloadVoice(voice, onProgress) {
  const { engine, name } = voiceParts(voice);
  if (engine !== 'kitten') return (await loadEngine(engine, onProgress)).prepare?.(name);
  try {
    await downloadKittenFiles(onProgress);
  } catch (err) {
    throw loadFailure(engine, err);
  }
}

/** Samples quieter than this are silence when finding where a sentence's speech starts and ends. */
const SILENCE = 0.02;

/** First and last sample index above the silence level, or the whole chunk when it is all quiet. */
function soundBounds(chunk) {
  let first = 0;
  while (first < chunk.length && Math.abs(chunk[first]) < SILENCE) first++;
  let last = chunk.length - 1;
  while (last > first && Math.abs(chunk[last]) < SILENCE) last--;
  return first < chunk.length ? [first, last + 1] : [0, chunk.length];
}

const roundMs = (seconds) => Math.round(seconds * 1000) / 1000;

async function speak(model, text, name, speed) {
  const chunks = [];
  for await (const chunk of model.speak(text, name, speed)) chunks.push(chunk);
  const { sampleRate } = model;
  const samples = new Float32Array(chunks.reduce((n, c) => n + c.audio.length, 0));
  const sentences = [];
  let offset = 0;
  for (const { sentence, audio } of chunks) {
    samples.set(audio, offset);
    const [first, end] = soundBounds(audio);
    sentences.push({
      words: wordCount(sentence),
      start: roundMs((offset + first) / sampleRate),
      end: roundMs((offset + end) / sampleRate),
    });
    offset += audio.length;
  }
  return { samples, sampleRate, sentences };
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
 * Makes .mr-cast/voiceover.json and audio/*.wav match what the storyboard speaks: generates missing
 * clips in `voice` at `pace`, drops clips of text no scene speaks any more, and returns the voiceover. The
 * model loads only when a clip is missing. voiceover.json records what its clips were made with; it never
 * chooses the voice or pace. Clips of the same text in another voice or at another speed stay, so a command
 * with other flags, or a player still playing them, finds them there.
 */
export async function ensureVoiceover({ dataDir, storyboard, voice: chosen, pace: { speed, pauses }, onProgress }) {
  const previous = readVoiceover(dataDir);
  const texts = storyboard.scenes.flatMap(spokenTexts);
  const onDisk = (clip) => fs.existsSync(path.join(dataDir, clip.src));
  /** Earlier clips of text still spoken, in any voice and at any speed; a clip from before 0.15 was made in the file's. */
  const clips = {};
  for (const [key, clip] of Object.entries(previous?.clips ?? {})) {
    const made = { voice: clip.voice ?? previous.voice, speed: clip.speed ?? previous.speed };
    if (onDisk(clip) && texts.some((text) => narrationKey(text, made.voice, made.speed) === key))
      clips[key] = { ...clip, ...made };
  }
  const missing = new Map();
  for (const text of texts) {
    const key = narrationKey(text, chosen, speed);
    if (!clips[key]) missing.set(key, text.trim());
  }

  if (missing.size) {
    const { engine, name } = voiceParts(chosen);
    if (!Object.hasOwn(ENGINES, engine) || !Object.hasOwn(ENGINES[engine].voices, name))
      throw new UserError(`unknown voice "${chosen}"; \`mr-cast voices\` lists them`);
    const model = await loadEngine(engine, onProgress);
    await model.prepare?.(name);
    fs.mkdirSync(path.join(dataDir, AUDIO_DIR), { recursive: true });
    let done = 0;
    for (const [key, text] of missing) {
      const { samples, sampleRate, sentences } = await speak(model, text, name, speed);
      const src = `${AUDIO_DIR}/${key}.wav`;
      writeAtomic(path.join(dataDir, src), encodeWav(samples, sampleRate));
      clips[key] = { src, seconds: roundMs(samples.length / sampleRate), sentences, voice: chosen, speed };
      // The clips so far, so a player already open can voice the scenes they cover while the rest are made, and a
      // voicing stopped for a newer edit keeps them.
      const partial = { voice: chosen, speed, pauses, clips: { ...clips } };
      writeAtomic(path.join(dataDir, VOICEOVER_FILE), `${JSON.stringify(partial, null, 2)}\n`);
      onProgress?.({
        type: 'clip',
        text,
        seconds: clips[key].seconds,
        done: ++done,
        total: missing.size,
        voiceover: partial,
      });
    }
  }

  const voiceover = { voice: chosen, speed, pauses, clips };
  const json = `${JSON.stringify(voiceover, null, 2)}\n`;
  const file = path.join(dataDir, VOICEOVER_FILE);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== json) writeAtomic(file, json);

  const used = new Set(Object.values(clips).map((c) => path.basename(c.src)));
  let stale = [];
  try {
    stale = fs.readdirSync(path.join(dataDir, AUDIO_DIR));
  } catch {
    /* no clips yet */
  }
  for (const name of stale) {
    if (OWNED_FILE.test(name) && !used.has(name)) fs.rmSync(path.join(dataDir, AUDIO_DIR, name), { force: true });
  }
  return voiceover;
}

/** The sentence `mr-cast voices --sample` reads. */
const SAMPLE_TEXT = 'Here is how this change works: the request takes a token, and an empty bucket makes it wait.';

/** Voices SAMPLE_TEXT in `voice` at `speed` into the WAV file `out`; returns its length in seconds. */
export async function sampleVoice({ voice, speed, out, onProgress }) {
  const { engine, name } = voiceParts(voice);
  const model = await loadEngine(engine, onProgress);
  await model.prepare?.(name);
  const { samples, sampleRate } = await speak(model, SAMPLE_TEXT, name, speed);
  writeAtomic(out, encodeWav(samples, sampleRate));
  return roundMs(samples.length / sampleRate);
}
