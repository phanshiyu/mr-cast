// Voice-over: one clip per distinct spoken text (a scene's narration or a code step's `say`), cached in
// .mr-cast/audio under its narrationKey, spoken by tiny-voca in the engine (bin/lib/tiny-voca.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { spokenTexts } from '../../shared/timing.mjs';
import { PACES, clipFor, narrationKey } from '../../shared/voice.mjs';
import { UserError } from './errors.mjs';
import { removeDeadPartials, withLock } from './lock.mjs';
import { TINY_VOCA_REPO, downloadTinyVoca, hubUrl, speakClips } from './tiny-voca.mjs';
import { ENGINES, voiceParts } from './voices.mjs';

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
/** Where each of a sentence's words starts, when the clip has them. */
const hasTimes = (s) => Array.isArray(s.times) && s.times.length === s.words && s.times.every(Number.isFinite);

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
    if (Array.isArray(clip.sentences) && clip.sentences.every(isSentence))
      clips[key].sentences = clip.sentences.map(({ words, start, end, times }) =>
        hasTimes({ words, times }) ? { words, start, end, times } : { words, start, end },
      );
  }
  return {
    voice: raw.voice,
    speed: isSpeed(raw.speed) ? raw.speed : 1,
    pauses: isPauses(raw.pauses) ? raw.pauses : 1,
    clips,
  };
}

const waitingFor = (what) => (pid) =>
  console.error(`mr-cast: waiting for another mr-cast (pid ${pid}) to finish ${what} the voice model`);

const loadFailure = (err) => {
  const { mb, dir } = ENGINES['tiny-voca'];
  return new UserError(
    `could not get the voice model (${err.message}); its first use downloads about ${mb} MB from ${hubUrl().replace(/^https?:\/\//, '')}/${TINY_VOCA_REPO} into ${dir()}`,
  );
};

/**
 * Downloads the voice model, each file checked against its pinned sha256, under the engine's lock so two processes
 * share one download and prune does not delete it meanwhile. Play runs it where an edit does not stop it.
 */
export async function downloadVoice(_voice, onProgress) {
  const engine = ENGINES['tiny-voca'];
  if (engine.downloaded()) return;
  const dir = engine.dir();
  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await withLock(
      engine.lock(),
      async () => {
        removeDeadPartials(dir);
        if (engine.downloaded()) return;
        onProgress?.({ type: 'download', engine: 'tiny-voca', mb: engine.mb, cacheDir: dir });
        await downloadTinyVoca(dir);
      },
      waitingFor('downloading'),
    );
  } catch (err) {
    throw err instanceof UserError ? err : loadFailure(err);
  }
}

/** Voices `texts` ([{ text, out }]) in `voice` at `speed`; each clip's { seconds, sentences } goes to `onClip(i, ...)`. */
async function speak(texts, voice, speed, onClip, onProgress) {
  const { engine, name } = voiceParts(voice);
  if (!Object.hasOwn(ENGINES, engine) || !Object.hasOwn(ENGINES[engine].voices, name))
    throw new UserError(`unknown voice "${voice}"; \`mr-cast voices\` lists them`);
  await downloadVoice(voice, onProgress);
  const clips = texts.map(({ text, out }) => ({ text, voice: name, speed, out }));
  await speakClips(ENGINES[engine].dir(), clips, { onClip: (r) => onClip(r.clip, r) });
}

const roundMs = (seconds) => Math.round(seconds * 1000) / 1000;

function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(tmp, data, { flag: 'wx' });
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
    fs.mkdirSync(path.join(dataDir, AUDIO_DIR), { recursive: true });
    const todo = [...missing].map(([key, text]) => ({ key, text, src: `${AUDIO_DIR}/${key}.wav` }));
    let done = 0;
    await speak(
      todo.map(({ text, src }) => ({ text, out: path.join(dataDir, src) })),
      chosen,
      speed,
      (i, { seconds, sentences }) => {
        const { key, text, src } = todo[i];
        clips[key] = { src, seconds, sentences, voice: chosen, speed };
        // The clips so far, so a player already open can voice the scenes they cover while the rest are made, and a
        // voicing stopped for a newer edit keeps them.
        const partial = { voice: chosen, speed, pauses, clips: { ...clips } };
        writeAtomic(path.join(dataDir, VOICEOVER_FILE), `${JSON.stringify(partial, null, 2)}\n`);
        onProgress?.({ type: 'clip', text, seconds, done: ++done, total: missing.size, voiceover: partial });
      },
      onProgress,
    );
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
  let length = 0;
  await speak(
    [{ text: SAMPLE_TEXT, out }],
    voice,
    speed,
    (_i, { seconds }) => {
      length = seconds;
    },
    onProgress,
  );
  return roundMs(length);
}
