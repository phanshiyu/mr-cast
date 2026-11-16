// The voice engine and its voices. A voice is named `engine:name`, such as tiny-voca:m2, and that full name keys its
// clips, so clips of one voice never stand in for another's. tiny-voca is the one engine (docs/adr/0046); a voice of
// the engines before it, Kitten and Kokoro, reads as the closest tiny-voca voice.

import { cacheDir, cacheLock } from './cache.mjs';
import { UserError } from './errors.mjs';
import { TINY_VOCA_MB, tinyVocaDir, tinyVocaDownloaded } from './tiny-voca.mjs';

/**
 * @typedef {{
 *   label: string, mb: number, defaultVoice: string, voices: Record<string, string>,
 *   dir: () => string, lock: () => string, downloaded: () => boolean,
 * }} Engine  `voices` maps each voice's name to its line in `mr-cast voices`, as the model card describes it. `lock`
 *   is held while the model downloads into `dir`; prune holds it to delete the engine's cache.
 */
/** @type {Record<'tiny-voca', Engine>} */
export const ENGINES = {
  'tiny-voca': {
    label: 'tiny-voca (n4ze3m, 4.5M parameters)',
    mb: TINY_VOCA_MB,
    defaultVoice: 'm2',
    voices: {
      f2: 'female, American English (the model card says it sounds younger than intended)',
      m2: 'male, American English',
    },
    dir: () => tinyVocaDir(cacheDir('tiny-voca')),
    lock: () => cacheLock('tiny-voca'),
    downloaded: () => tinyVocaDownloaded(tinyVocaDir(cacheDir('tiny-voca'))),
  },
};
const DEFAULT_ENGINE = 'tiny-voca';
export const DEFAULT_VOICE = `${DEFAULT_ENGINE}:${ENGINES[DEFAULT_ENGINE].defaultVoice}`;

/** Kitten's voices, female and male in turn, and Kokoro's prefixes (af_, bm_, ...), as tiny-voca's f2 or m2. */
const KITTEN = { bella: 'f2', jasper: 'm2', luna: 'f2', bruno: 'm2', rosie: 'f2', hugo: 'm2', kiki: 'f2', leo: 'm2' };
const KOKORO = /^[a-z][fm]_[a-z]+$/;

/** The tiny-voca voice closest to a Kitten or Kokoro voice (`engine:name` or bare), or undefined. */
function closest(engine, name) {
  if ((engine === undefined || engine === 'kitten') && Object.hasOwn(KITTEN, name)) return KITTEN[name];
  if ((engine === undefined || engine === 'kokoro') && KOKORO.test(name)) return name[1] === 'f' ? 'f2' : 'm2';
  return undefined;
}

const engineNames = () => Object.keys(ENGINES).join(', ');

/** The engine and name of a full voice name such as tiny-voca:m2. */
export function voiceParts(voice) {
  const at = voice.lastIndexOf(':');
  return { engine: voice.slice(0, at), name: voice.slice(at + 1) };
}

/** Each old voice name told about once per process. */
const told = new Set();

/**
 * The full voice name that --engine and --voice ask for. --voice takes `engine:name` or a bare name, which belongs
 * to --engine when it is given. --engine alone picks its default voice. A Kitten or Kokoro voice, from a flag or a
 * saved choice, is the closest tiny-voca voice, with a one-line notice through `notify`.
 */
export function resolveVoice({ engine, voice }, notify = (line) => console.error(line)) {
  const old = engine === 'kitten' || engine === 'kokoro';
  if (engine !== undefined && !old && !Object.hasOwn(ENGINES, engine))
    throw new UserError(`--engine must be one of ${engineNames()} (got "${engine}")`);
  if (voice === undefined && !old) return DEFAULT_VOICE;
  const given = (voice ?? '').trim().toLowerCase();
  const at = given.lastIndexOf(':');
  const [named, name] = at < 0 ? [undefined, given] : [given.slice(0, at), given.slice(at + 1)];
  const asked = named ?? engine;
  if (named !== undefined && engine !== undefined && named !== engine)
    throw new UserError(`--voice ${voice} is a ${named} voice, but --engine is ${engine}; drop one`);
  if (asked === 'kitten' || asked === 'kokoro' || (asked === undefined && closest(undefined, name))) {
    const mapped = `${DEFAULT_ENGINE}:${closest(asked, name) ?? ENGINES[DEFAULT_ENGINE].defaultVoice}`;
    const was = voice === undefined ? `the ${asked} engine` : `${asked ? `${asked}:` : ''}${name}`;
    if (!told.has(was)) {
      told.add(was);
      notify(`mr-cast: ${was} is no longer available; using ${mapped}, the closest voice`);
    }
    return mapped;
  }
  if (asked !== undefined && !Object.hasOwn(ENGINES, asked))
    throw new UserError(`--voice ${voice}: no engine "${asked}"; engines are ${engineNames()}`);
  const owner = asked ?? Object.keys(ENGINES).find((e) => Object.hasOwn(ENGINES[e].voices, name));
  if (owner === undefined || !Object.hasOwn(ENGINES[owner].voices, name)) {
    const where = owner ?? DEFAULT_ENGINE;
    throw new UserError(
      `unknown voice "${voice}"${owner ? ` for ${owner}` : ''}; ${where} has ${Object.keys(ENGINES[where].voices).join(', ')} (\`mr-cast voices\` lists them)`,
    );
  }
  return `${owner}:${name}`;
}

/** `mr-cast voices`: the engine with its download and whether it is here, then its voices; `current` is marked. */
export function formatVoices(current = DEFAULT_VOICE) {
  const out = [];
  for (const [engine, e] of Object.entries(ENGINES)) {
    const here = e.downloaded() ? 'downloaded' : `downloads about ${e.mb} MB on first use`;
    out.push(`${engine} · ${e.label} · ${here}`);
    for (const [name, line] of Object.entries(e.voices)) {
      const id = `${engine}:${name}`;
      const marks = [id === DEFAULT_VOICE && 'default', id === current && id !== DEFAULT_VOICE && 'last chosen'].filter(
        Boolean,
      );
      out.push(`  ${id.padEnd(14)} ${line}${marks.length ? ` (${marks.join(', ')})` : ''}`);
    }
  }
  out.push(
    '',
    'Pick one with --voice engine:name, or a bare name such as --voice f2; `mr-cast voices --sample engine:name` voices a sentence to hear it.',
  );
  return out;
}
