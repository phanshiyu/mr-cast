// Where a command's data lives. A run is { dir, name }: the data directory and its slug, or a null
// name for an explicit --dir.
//
//   .mr-cast/<name>/           one run each: a branch's diff (extract) or an explanation (init)
//   .mr-cast/.current          name of the run later commands use: the one extract or init made last
//
// Data from mr-cast 0.11 and earlier stays where it was and is reached with --dir:
//
//   .mr-cast/                  the default diff run's own files (hunks.json, storyboard.json, audio/, stills/)
//   .mr-cast/explain/<name>/   one explanation each

import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './errors.mjs';
import { dataDir, findRepoRoot } from './git.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_MAX = 40;
// Folders of 0.11 data that a run must not shadow.
const RESERVED = new Set(['explain', 'audio', 'stills']);
export const CURRENT_FILE = '.current';

/** Whether `name` (an entry of .mr-cast/) can be a run's directory rather than 0.11 data. */
export const isRunName = (name) => NAME.test(name) && !RESERVED.has(name);

/** Whether `name` (an entry of .mr-cast/explain/) can be a 0.11 explanation's directory. */
export const isExplanationName = (name) => NAME.test(name);

function parseRunName(value) {
  if (!NAME.test(value) || value.length > NAME_MAX) {
    throw new UserError(
      `--name "${value}" must be lowercase letters, digits and single dashes, at most ${NAME_MAX} characters, e.g. rate-limit`,
    );
  }
  if (RESERVED.has(value))
    throw new UserError(
      `--name ${value} is reserved for .mr-cast/${value}, which earlier versions used; pick another name`,
    );
  return value;
}

/** A short kebab-case slug of `text`: its first few words, or '' when nothing usable is left. */
function slugify(text, maxWords = 6) {
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

/** The .mr-cast directory: in the git repository, else in the current directory. */
export const runsRoot = () => dataDir(findRepoRoot() ?? process.cwd());

/** meta.json of a run directory, or null when it has none or it is unreadable. */
export function readRunMeta(dir) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

/**
 * Records in meta.json the audience the latest command on the run ran with, so the skill's hook validates the run
 * as its commands do. A run without meta.json, such as a --dir from mr-cast 0.11, is left as it is.
 */
export function recordAudience(dir, audience) {
  const meta = readRunMeta(dir);
  if (!meta || meta.audience === audience) return;
  fs.writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify({ ...meta, audience }, null, 2)}\n`);
}

const isExplanationMeta = (meta) => meta?.mode === 'explain';

function listRuns(root) {
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    /* none yet */
  }
  return names.filter((n) => isRunName(n) && readRunMeta(path.join(root, n)));
}

export function readCurrent(root) {
  try {
    const name = fs.readFileSync(path.join(root, CURRENT_FILE), 'utf8').trim();
    return isRunName(name) ? name : null;
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

/** Where 0.11 left a walkthrough in `root`, as --dir arguments, so a missing run can point at them. */
function olderData(root) {
  const found = [];
  if (fs.existsSync(path.join(root, 'storyboard.json')) || fs.existsSync(path.join(root, 'hunks.json')))
    found.push(path.relative(process.cwd(), root) || '.');
  let explained = [];
  try {
    explained = fs.readdirSync(path.join(root, 'explain')).filter(isExplanationName);
  } catch {
    /* none */
  }
  for (const name of explained) found.push(path.relative(process.cwd(), path.join(root, 'explain', name)));
  return found;
}

function missingRun(root, what) {
  const known = listRuns(root);
  const hints = [
    known.length
      ? `runs here: ${known.join(', ')}`
      : 'start one with `mr-cast extract` or `mr-cast init --title "..."`',
  ];
  const older = olderData(root);
  if (older.length)
    hints.push(`walkthroughs from mr-cast 0.11 or earlier: ${older.map((d) => `--dir ${d}`).join(', ')}`);
  return new UserError(`${what}; ${hints.join('; ')}`);
}

/**
 * The run a command after extract or init works on: --dir, else --name, else the current run (announced on
 * stderr, since the caller did not name it).
 */
export function currentRun(values) {
  if (values.dir) return { dir: path.resolve(values.dir), name: null };
  const root = runsRoot();
  if (values.name) {
    const name = parseRunName(values.name);
    const dir = path.join(root, name);
    if (!readRunMeta(dir)) throw missingRun(root, `no run named "${name}"`);
    return { dir, name };
  }
  const name = readCurrent(root);
  if (!name || !readRunMeta(path.join(root, name))) throw missingRun(root, 'no current run');
  console.error(`mr-cast: using run "${name}" (the most recent; pass --name to pick another)`);
  return { dir: path.join(root, name), name };
}

/** The first of `base`, `base-2`, `base-3`, ... whose directory is free or holds a run `matches` accepts. */
function claimName(root, base, matches) {
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base.slice(0, NAME_MAX - String(n).length - 1)}-${n}`;
    const dir = path.join(root, name);
    if (RESERVED.has(name)) continue;
    if (!fs.existsSync(dir) || matches(readRunMeta(dir))) return { dir, name };
  }
}

/**
 * The run `extract` writes the diff of `branch` into. --name is taken as given, unless it holds an explanation.
 * Otherwise the slug comes from the branch name, and a directory with that slug holding anything but this
 * branch's diff gets a numbered suffix.
 */
export function branchRun(root, values, branch) {
  if (values.name) {
    const name = parseRunName(values.name);
    const dir = path.join(root, name);
    if (isExplanationMeta(readRunMeta(dir)))
      throw new UserError(`.mr-cast/${name} holds an explanation (made by \`mr-cast init\`); pass another --name`);
    return { dir, name };
  }
  return claimName(
    root,
    slugify(branch, 12) || 'branch',
    (meta) => meta !== null && !isExplanationMeta(meta) && meta.branch === branch,
  );
}

/**
 * The run `init` creates or reopens. --name is taken as given, unless it holds a diff. Otherwise the slug comes
 * from --title, and a directory with that slug holding anything but this explanation gets a numbered suffix.
 * With neither, init reopens the current run when it is an explanation.
 */
export function explanationRun(root, values) {
  if (values.name) {
    const name = parseRunName(values.name);
    const dir = path.join(root, name);
    const meta = readRunMeta(dir);
    if (meta && !isExplanationMeta(meta))
      throw new UserError(
        `.mr-cast/${name} holds a branch walkthrough (made by \`mr-cast extract\`); pass another --name`,
      );
    return { dir, name };
  }
  const title = values.title ?? null;
  if (title === null) {
    const current = readCurrent(root);
    if (current && isExplanationMeta(readRunMeta(path.join(root, current))))
      return { dir: path.join(root, current), name: current };
  }
  const quick = Boolean(values.quick);
  return claimName(
    root,
    explanationSlug(title, quick),
    (meta) => isExplanationMeta(meta) && (meta.title ?? null) === title && Boolean(meta.quick) === quick,
  );
}

/** A quick video's run is `quick-<slug>`, so it never takes the name of the full video of the same title. */
export function explanationSlug(title, quick) {
  const slug = slugify(title) || 'explanation';
  return quick ? `quick-${slug}`.slice(0, NAME_MAX).replace(/-+$/, '') : slug;
}
