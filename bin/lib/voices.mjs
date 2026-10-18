// The voice engines and their voices. A voice is named `engine:name`, such as kitten:luna or kokoro:af_heart,
// and that full name keys its clips, so clips of one engine never stand in for another's.

import fs from 'node:fs';
import path from 'node:path';
import { cacheDir } from './cache.mjs';
import { UserError } from './errors.mjs';
import { KITTEN_MB, kittenDir, kittenDownloaded } from './kitten.mjs';
import { VOICES as KOKORO_VOICES } from './kokoro/voice-list.js';

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** The weights transformers.js fetches for dtype q8; its absence means a load downloads them. */
export const KOKORO_MODEL_FILE = 'model_quantized.onnx';

const ACCENTS = { 'en-us': 'American English', 'en-gb': 'British English' };

/**
 * @typedef {{
 *   label: string, mb: number, defaultVoice: string, voices: Record<string, string>,
 *   dir: () => string, downloaded: () => boolean,
 * }} Engine  `voices` maps each voice's name to its line in `mr-cast voices`, as the model card describes it.
 */
/** @type {Record<'kitten' | 'kokoro', Engine>} */
export const ENGINES = {
  kitten: {
    label: 'Kitten TTS mini 0.8 (KittenML, 80M parameters)',
    mb: KITTEN_MB,
    defaultVoice: 'luna',
    voices: Object.fromEntries(['bella', 'jasper', 'luna', 'bruno', 'rosie', 'hugo', 'kiki', 'leo'].map((name, i) => [
      name, `${i % 2 ? 'male' : 'female'}, American English`,
    ])),
    dir: () => kittenDir(cacheDir('kitten')),
    downloaded: () => kittenDownloaded(kittenDir(cacheDir('kitten'))),
  },
  kokoro: {
    label: 'Kokoro 82M v1.0 (hexgrad, 82M parameters)',
    mb: 90,
    defaultVoice: 'af_heart',
    voices: Object.fromEntries(Object.entries(KOKORO_VOICES).map(([name, v]) => [
      name, `${v.gender.toLowerCase()}, ${ACCENTS[v.language] ?? v.language}, model card grade ${v.overallGrade}`,
    ])),
    dir: () => cacheDir('models'),
    downloaded: () => fs.existsSync(path.join(cacheDir('models'), KOKORO_MODEL_ID, 'onnx', KOKORO_MODEL_FILE)),
  },
};
export const DEFAULT_ENGINE = 'kitten';
export const DEFAULT_VOICE = `${DEFAULT_ENGINE}:${ENGINES[DEFAULT_ENGINE].defaultVoice}`;

const engineNames = () => Object.keys(ENGINES).join(', ');

/** The engine and name of a full voice name such as kitten:luna. */
export function voiceParts(voice) {
  const [engine, name] = voice.split(':');
  return { engine, name };
}

/**
 * The full voice name that --engine and --voice ask for. --voice takes `engine:name` or a bare name, which
 * belongs to --engine when it is given and otherwise to the one engine that has it, so the Kokoro names of
 * mr-cast 0.26 and earlier, such as af_heart, still pick Kokoro. --engine alone picks its default voice.
 */
export function resolveVoice({ engine, voice }) {
  if (engine !== undefined && !Object.hasOwn(ENGINES, engine)) throw new UserError(`--engine must be one of ${engineNames()} (got "${engine}")`);
  if (voice === undefined) return `${engine ?? DEFAULT_ENGINE}:${ENGINES[engine ?? DEFAULT_ENGINE].defaultVoice}`;
  const given = voice.trim().toLowerCase();
  let [named, name] = given.includes(':') ? given.split(':', 2) : [undefined, given];
  if (named !== undefined && !Object.hasOwn(ENGINES, named)) throw new UserError(`--voice ${voice}: no engine "${named}"; engines are ${engineNames()}`);
  if (named !== undefined && engine !== undefined && named !== engine) throw new UserError(`--voice ${voice} is a ${named} voice, but --engine is ${engine}; drop one`);
  named ??= engine ?? Object.keys(ENGINES).find((e) => Object.hasOwn(ENGINES[e].voices, name));
  if (named === undefined || !Object.hasOwn(ENGINES[named].voices, name)) {
    const where = named ?? DEFAULT_ENGINE;
    throw new UserError(`unknown voice "${voice}"${named ? ` for ${named}` : ''}; ${where} has ${Object.keys(ENGINES[where].voices).join(', ')} (\`mr-cast voices\` lists every engine)`);
  }
  return `${named}:${name}`;
}

/** `mr-cast voices`: each engine with its download and whether it is here, then its voices; `current` is marked. */
export function formatVoices(current = DEFAULT_VOICE) {
  const out = [];
  for (const [engine, e] of Object.entries(ENGINES)) {
    const here = e.downloaded() ? 'downloaded' : `downloads about ${e.mb} MB on first use`;
    out.push(`${engine}${engine === DEFAULT_ENGINE ? ' (default engine)' : ''} · ${e.label} · ${here}`);
    for (const [name, line] of Object.entries(e.voices)) {
      const id = `${engine}:${name}`;
      const marks = [id === DEFAULT_VOICE && 'default', id === current && id !== DEFAULT_VOICE && 'last chosen'].filter(Boolean);
      out.push(`  ${id.padEnd(18)} ${line}${marks.length ? ` (${marks.join(', ')})` : ''}`);
    }
  }
  out.push('', 'Pick one with --voice engine:name (or --engine and --voice); `mr-cast voices --sample engine:name` voices a sentence to hear it.');
  return out;
}
