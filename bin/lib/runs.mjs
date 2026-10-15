// Where a command's data lives. A run is { dir, name }: the data directory and its slug, or a null
// name for the default diff run in .mr-cast/ and for an explicit --dir.
//
//   .mr-cast/                  default diff run (hunks.json, storyboard.json, audio/, stills/)
//   .mr-cast/<name>/           named diff run (extract --name <name>)
//   .mr-cast/explain/<name>/   one explanation each
//   .mr-cast/explain/.current  name of the most recently initialised explanation

import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './errors.mjs';
import { dataDir, findRepoRoot, repoRoot } from './git.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_MAX = 40;
// Subdirectories of the default diff run that a named run must not shadow.
const RESERVED = new Set(['explain', 'audio', 'stills']);
const CURRENT_FILE = '.current';

/** Whether `name` (an entry of .mr-cast/) is a named diff run's directory rather than part of the default run. */
export const isRunName = (name) => NAME.test(name) && !RESERVED.has(name);

/** Whether `name` (an entry of .mr-cast/explain/) can be an explanation's directory. */
export const isExplanationName = (name) => NAME.test(name);

export function parseRunName(value) {
  if (!NAME.test(value) || value.length > NAME_MAX) {
    throw new UserError(`--name "${value}" must be lowercase letters, digits and single dashes, at most ${NAME_MAX} characters, e.g. rate-limit`);
  }
  return value;
}

/** A short kebab-case slug of `text`: its first few words, or '' when nothing usable is left. */
export function slugify(text, maxWords = 6) {
  const words = String(text ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  let slug = '';
  for (const word of words.slice(0, maxWords)) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > NAME_MAX) break;
    slug = next;
  }
  return slug || words[0]?.slice(0, NAME_MAX) || '';
}

/** The default MP4 name: the storyboard title's slug, else the run's name, else "walkthrough". */
export const videoName = (storyboard, run) => `${slugify(storyboard.title) || run.name || 'walkthrough'}.mp4`;

/** `--dir` wins; else `.mr-cast/<name>` for --name; else `.mr-cast`. */
export function diffRun(values) {
  if (values.dir) return { dir: path.resolve(values.dir), name: null };
  const root = dataDir(repoRoot());
  if (!values.name) return { dir: root, name: null };
  const name = parseRunName(values.name);
  if (RESERVED.has(name)) throw new UserError(`--name ${name} is reserved for .mr-cast/${name}; pick another name`);
  return { dir: path.join(root, name), name };
}

/** The directory holding every explanation: .mr-cast/explain in the git repo, else in the current directory. */
export const explainRoot = () => path.join(dataDir(findRepoRoot() ?? process.cwd()), 'explain');

const isExplanation = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).mode === 'explain';
  } catch {
    return false;
  }
};

function listExplanations(root) {
  let names = [];
  try { names = fs.readdirSync(root); } catch { /* none yet */ }
  return names.filter((n) => NAME.test(n) && isExplanation(path.join(root, n)));
}

export function readCurrent(root) {
  try {
    const name = fs.readFileSync(path.join(root, CURRENT_FILE), 'utf8').trim();
    return NAME.test(name) ? name : null;
  } catch {
    return null;
  }
}

export function writeCurrent(root, name) {
  fs.mkdirSync(root, { recursive: true });
  const tmp = path.join(root, `${CURRENT_FILE}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, `${name}\n`);
  fs.renameSync(tmp, path.join(root, CURRENT_FILE));
}

export const clearCurrent = (root) => fs.rmSync(path.join(root, CURRENT_FILE), { force: true });

function missingExplanation(root, what) {
  const known = listExplanations(root);
  const hint = known.length ? `explanations here: ${known.join(', ')}` : 'run `mr-cast explain init --title "..."` first';
  return new UserError(`${what}; ${hint}`);
}

/**
 * The explanation an `explain <verb>` works on: --dir, else --name, else the most recently initialised one
 * (announced on stderr, since the caller did not name it).
 */
export function explainRun(values) {
  if (values.dir) return { dir: path.resolve(values.dir), name: null };
  const root = explainRoot();
  if (values.name) {
    const name = parseRunName(values.name);
    const dir = path.join(root, name);
    if (!isExplanation(dir)) throw missingExplanation(root, `no explanation named "${name}"`);
    return { dir, name };
  }
  const name = readCurrent(root);
  if (!name || !isExplanation(path.join(root, name))) throw missingExplanation(root, 'no current explanation');
  console.error(`mr-cast: using explanation "${name}" (the most recent; pass --name to pick another)`);
  return { dir: path.join(root, name), name };
}

/**
 * The explanation `explain init` creates or reopens. --name is taken as given. Otherwise the slug comes from
 * --title; a directory with that slug holding a different explanation gets a numbered suffix. With neither,
 * init reopens the current explanation.
 */
export function initExplainRun(values) {
  if (values.dir) return { dir: path.resolve(values.dir), name: null };
  const root = explainRoot();
  if (values.name) {
    const name = parseRunName(values.name);
    return { dir: path.join(root, name), name };
  }
  const title = values.title ?? null;
  if (title === null) {
    const current = readCurrent(root);
    if (current) return { dir: path.join(root, current), name: current };
  }
  const base = slugify(title) || 'explanation';
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base.slice(0, NAME_MAX - String(n).length - 1)}-${n}`;
    const dir = path.join(root, name);
    if (!fs.existsSync(dir)) return { dir, name };
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { /* not ours */ }
    if (meta?.mode === 'explain' && (meta.title ?? null) === title) return { dir, name };
  }
}
