// Settings: who the video is for and how it sounds. They come from the flags of the one command that runs, and
// a command without a flag takes its default; nothing keeps them between commands.
// The last audience and pace a user chose are kept per user, for the skill to offer first next time.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_VOICE, PACES } from '../../shared/voice.mjs';
import { UserError } from './errors.mjs';
import { parsePace } from './voice.mjs';

/**
 * familiar: knows the code (a reviewer of a change, a teammate for an explanation); new: new to the code, the
 * simple style; overview: a quick overview with little code.
 */
export const AUDIENCES = ['familiar', 'new', 'overview'];

/**
 * @typedef {{
 *   audience: 'familiar' | 'new' | 'overview',
 *   pace: { speed: number, pauses: number },
 *   voice: string,
 *   silent: boolean,
 * }} Settings  What one command runs with.
 * @typedef {{ audience?: string, pace?: 'slower' | 'normal' | 'faster' | 'silent' }} Choices
 */

export const AUDIENCE_OPTIONS = { audience: { type: 'string' }, simple: { type: 'boolean', default: false } };
export const SETTINGS_OPTIONS = {
  ...AUDIENCE_OPTIONS,
  pace: { type: 'string' }, speed: { type: 'string' },
  voice: { type: 'string' }, 'no-voice': { type: 'boolean', default: false },
};

/** The settings the flags in `values` ask for, with the default for each flag not given. */
export function settingsFrom(values) {
  if (values.simple && values.audience !== undefined && values.audience !== 'new') throw new UserError(`--simple is --audience new; drop one of --simple and --audience ${values.audience}`);
  if (values.audience !== undefined && !AUDIENCES.includes(values.audience)) throw new UserError(`--audience must be one of ${AUDIENCES.join(', ')} (got "${values.audience}")`);
  if (values['no-voice'] && values.voice !== undefined) throw new UserError('--no-voice is silent; drop one of --no-voice and --voice');
  return {
    audience: values.simple ? 'new' : values.audience ?? 'familiar',
    pace: { ...PACES.normal, ...parsePace(values) },
    voice: values.voice ?? DEFAULT_VOICE,
    silent: Boolean(values['no-voice']),
  };
}

const configDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mr-cast');
export const choicesFile = () => path.join(configDir(), 'last-choices.json');

/** The audience and pace the user chose last, from any run; {} before the first choice. */
export function lastChoices() {
  try {
    const raw = JSON.parse(fs.readFileSync(choicesFile(), 'utf8'));
    /** @type {Choices} */
    const out = {};
    if (AUDIENCES.includes(raw?.audience)) out.audience = raw.audience;
    if (raw?.pace === 'silent' || Object.hasOwn(PACES, raw?.pace)) out.pace = raw.pace;
    return out;
  } catch {
    return {};
  }
}

/** Records the audience and named pace `values` chose, if any. Never fails the command. */
export function rememberChoices(values) {
  /** @type {Choices} */
  const chosen = {};
  if (values.simple) chosen.audience = 'new';
  else if (AUDIENCES.includes(values.audience)) chosen.audience = values.audience;
  if (values['no-voice']) chosen.pace = 'silent';
  else if (Object.hasOwn(PACES, values.pace ?? '')) chosen.pace = values.pace;
  if (Object.keys(chosen).length === 0) return;
  try {
    const file = choicesFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify({ ...lastChoices(), ...chosen, at: new Date().toISOString() }, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch { /* an unwritable config dir only costs the next question's default */ }
}
