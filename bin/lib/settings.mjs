// Settings: whether the video is a pre-read, and how it sounds. They come from the flags of the one command that
// runs, and a command without a flag takes its default; nothing keeps them between commands.
// The last pace and voice a user chose are kept per user; `mr-cast status` prints them, and the skill passes them when
// the user names none.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PACES } from '../../shared/voice.mjs';
import { UserError } from './errors.mjs';
import { parsePace } from './voice.mjs';
import { resolveVoice } from './voices.mjs';

/**
 * preread: a reviewer who reads the code next, so no code on screen, ending on the order in which to read it.
 * familiar, new and overview are accepted from skills before 0.25, which passed them, and mean the plain video.
 */
export const AUDIENCES = ['familiar', 'new', 'overview', 'preread'];
/** The audience a command runs with: a pre-read, or the plain video. */
const audienceOf = (audience) => (audience === 'preread' ? 'preread' : 'familiar');

/**
 * @typedef {{
 *   audience: 'familiar' | 'preread',
 *   pace: { speed: number, pauses: number },
 *   voice: string,
 *   silent: boolean,
 * }} Settings  What one command runs with.
 * @typedef {{ pace?: 'slower' | 'normal' | 'faster' | 'silent', voice?: string }} Choices  `voice` is a full name, such as kitten:luna.
 */

// --simple was --audience new before 0.25; it is still accepted, and ignored.
export const AUDIENCE_OPTIONS = { audience: { type: 'string' }, simple: { type: 'boolean', default: false } };
export const SETTINGS_OPTIONS = {
  ...AUDIENCE_OPTIONS,
  pace: { type: 'string' }, speed: { type: 'string' },
  engine: { type: 'string' }, voice: { type: 'string' }, 'no-voice': { type: 'boolean', default: false },
};

/** The settings the flags in `values` ask for, with the default for each flag not given. */
export function settingsFrom(values) {
  if (values.audience !== undefined && !AUDIENCES.includes(values.audience)) throw new UserError(`--audience must be one of ${AUDIENCES.join(', ')} (got "${values.audience}")`);
  for (const flag of ['voice', 'engine']) {
    if (values['no-voice'] && values[flag] !== undefined) throw new UserError(`--no-voice is silent; drop one of --no-voice and --${flag}`);
  }
  return {
    audience: audienceOf(values.audience),
    pace: { ...PACES.normal, ...parsePace(values) },
    voice: resolveVoice(values),
    silent: Boolean(values['no-voice']),
  };
}

/** The audience the flags in `values` name, or undefined when they name none. */
export const givenAudience = (values) => (AUDIENCES.includes(values.audience) ? audienceOf(values.audience) : undefined);

/** The settings flags `values` gave, as they would be typed again, such as " --audience preread --pace slower"; "" for none. */
export function settingsArgs(values) {
  const audience = givenAudience(values);
  return [
    audience === 'preread' && '--audience preread',
    values.pace && `--pace ${values.pace}`,
    values.speed && `--speed ${values.speed}`,
    (values.voice || values.engine) && `--voice ${resolveVoice(values)}`,
    values['no-voice'] && '--no-voice',
  ].filter(Boolean).map((arg) => ` ${arg}`).join('');
}

const configDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mr-cast');
export const choicesFile = () => path.join(configDir(), 'last-choices.json');

/** The full voice name a stored `voice` names, a bare Kokoro name included, or undefined. */
const storedVoice = (voice) => {
  try { return typeof voice === 'string' ? resolveVoice({ voice }) : undefined; } catch { return undefined; }
};

/** The pace and voice the user chose last, from any run; {} before the first choice. */
export function lastChoices() {
  try {
    const raw = JSON.parse(fs.readFileSync(choicesFile(), 'utf8'));
    /** @type {Choices} */
    const out = {};
    if (raw?.pace === 'silent' || Object.hasOwn(PACES, raw?.pace)) out.pace = raw.pace;
    const voice = storedVoice(raw?.voice);
    if (voice) out.voice = voice;
    return out;
  } catch {
    return {};
  }
}

/** Records the named pace and the voice `values` chose, if any. Never fails the command. */
export function rememberChoices(values) {
  /** @type {Choices} */
  const chosen = {};
  if (values['no-voice']) chosen.pace = 'silent';
  else if (Object.hasOwn(PACES, values.pace ?? '')) chosen.pace = values.pace;
  if (values.voice !== undefined || values.engine !== undefined) chosen.voice = resolveVoice(values);
  if (Object.keys(chosen).length === 0) return;
  try {
    const file = choicesFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify({ ...lastChoices(), ...chosen, at: new Date().toISOString() }, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch { /* an unwritable config dir only costs the next question's default */ }
}
