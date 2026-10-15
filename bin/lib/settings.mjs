// Run settings: who the video is for and how it sounds. extract or init sets them, meta.json keeps them, and
// a flag on any later command changes them from then on, so the run sounds the same whatever command runs.
// The last audience and pace a user chose are also kept per user, for the skill to offer first next time.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PACES } from '../../shared/voice.mjs';
import { UserError } from './errors.mjs';
import { parsePace } from './voice.mjs';

/**
 * familiar: knows the code (a reviewer of a change, a teammate for an explanation); new: new to the code, the
 * simple style; overview: a quick overview with little code.
 */
export const AUDIENCES = ['familiar', 'new', 'overview'];

/**
 * @typedef {{
 *   audience?: 'familiar' | 'new' | 'overview',
 *   pace?: { speed?: number, pauses?: number },
 *   voice?: string,
 *   silent?: boolean,
 * }} RunSettings  What meta.json's `settings` holds; a missing field takes the default.
 * @typedef {{ audience?: string, pace?: 'slower' | 'normal' | 'faster' | 'silent' }} Choices
 */

export const AUDIENCE_OPTIONS = { audience: { type: 'string' }, simple: { type: 'boolean', default: false } };
export const PACE_OPTIONS = { pace: { type: 'string' }, speed: { type: 'string' } };
export const VOICE_OPTIONS = { voice: { type: 'string' }, 'no-voice': { type: 'boolean', default: false }, ...PACE_OPTIONS };

/** The settings the flags in `values` ask for; flags the command does not take are absent from `values`. */
export function requestedSettings(values) {
  /** @type {RunSettings} */
  const out = {};
  if (values.simple && values.audience !== undefined && values.audience !== 'new') throw new UserError(`--simple is --audience new; drop one of --simple and --audience ${values.audience}`);
  if (values.audience !== undefined && !AUDIENCES.includes(values.audience)) throw new UserError(`--audience must be one of ${AUDIENCES.join(', ')} (got "${values.audience}")`);
  const audience = values.simple ? 'new' : values.audience;
  if (audience) out.audience = audience;
  const pace = parsePace(values);
  if (Object.keys(pace).length) out.pace = pace;
  if (values.voice !== undefined) {
    out.voice = values.voice;
    out.silent = false;
  }
  if (values['no-voice']) out.silent = true;
  return out;
}

/** `saved` with `requested` laid over it; a pace's speed and pauses merge separately, as --speed sets one. */
export const mergeSettings = (saved = {}, requested = {}) => ({
  ...saved, ...requested,
  ...(saved.pace || requested.pace ? { pace: { ...saved.pace, ...requested.pace } } : {}),
});

/** Parses a meta.json `settings` value, dropping anything malformed. Older runs have none. */
export function parseSettings(raw) {
  /** @type {RunSettings} */
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (AUDIENCES.includes(raw.audience)) out.audience = raw.audience;
  if (raw.pace && typeof raw.pace === 'object') {
    const pace = {};
    if (Number.isFinite(raw.pace.speed)) pace.speed = raw.pace.speed;
    if (Number.isFinite(raw.pace.pauses)) pace.pauses = raw.pace.pauses;
    if (Object.keys(pace).length) out.pace = pace;
  }
  if (typeof raw.voice === 'string') out.voice = raw.voice;
  if (typeof raw.silent === 'boolean') out.silent = raw.silent;
  return out;
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
