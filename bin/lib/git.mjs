import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './errors.mjs';

const MAX_BUFFER = 1024 * 1024 * 1024;

const NOISE_GLOBS = [
  ...[
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lockb',
    'Cargo.lock',
    'go.sum',
    'poetry.lock',
    'Gemfile.lock',
    'composer.lock',
    'uv.lock',
  ].map((f) => `**/${f}`),
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.snap',
  '**/dist/**',
  '**/build/**',
  '**/vendor/**',
];
const NOISE_PATHSPEC = ['.', ...NOISE_GLOBS.map((g) => `:(exclude,glob)${g}`)];

const BASE_CANDIDATES = ['main', 'master', 'origin/main', 'origin/master', 'develop', 'trunk'];

function git(cwd, args) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (err.code === 'ENOENT') throw new UserError('git not found on PATH');
    const detail = String(err.stderr || err.message)
      .trim()
      .split('\n')[0];
    throw new UserError(`git ${args[0]} failed: ${detail}`);
  }
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args).trim();
  } catch {
    return null;
  }
}

/** The git work tree containing `cwd`, or null outside one. */
export function findRepoRoot(cwd = process.cwd()) {
  return tryGit(cwd, ['rev-parse', '--show-toplevel']);
}

export function repoRoot(cwd = process.cwd()) {
  const root = findRepoRoot(cwd);
  if (!root) throw new UserError('not inside a git work tree; run mr-cast from your repository');
  return root;
}

export const dataDir = (root) => path.join(root, '.mr-cast');

function commitOf(root, ref) {
  return tryGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
}

/** Explicit arg, then origin/HEAD, then the first existing conventional branch. */
export function resolveBase(root, explicit) {
  if (explicit) {
    if (!commitOf(root, explicit)) throw new UserError(`unknown base "${explicit}"; pass a branch, tag or commit`);
    return explicit;
  }
  const originHead = tryGit(root, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
  if (originHead) {
    const ref = originHead.replace(/^refs\/remotes\//, '');
    if (commitOf(root, ref)) return ref;
  }
  const found = BASE_CANDIDATES.find((ref) => commitOf(root, ref));
  if (!found)
    throw new UserError(
      `could not find a base branch (tried origin/HEAD, ${BASE_CANDIDATES.join(', ')}); pass one: mr-cast extract <base>`,
    );
  return found;
}

/**
 * Collect everything `extract` needs from git. `working` diffs the merge-base against the
 * working tree (staged + unstaged); otherwise base...HEAD.
 */
export function readDiff(root, { base, working, context, allFiles }) {
  const headSha = commitOf(root, 'HEAD');
  if (!headSha) throw new UserError('HEAD has no commits yet');
  const branch = tryGit(root, ['symbolic-ref', '-q', '--short', 'HEAD']) ?? 'HEAD';
  const baseSha = commitOf(root, base);
  const mergeBase = tryGit(root, ['merge-base', base, 'HEAD']);
  if (!mergeBase) throw new UserError(`"${base}" and HEAD share no history`);
  const ahead = Number(git(root, ['rev-list', '--count', `${mergeBase}..HEAD`]).trim());

  const range = working ? [mergeBase] : [`${base}...HEAD`];
  const flags = ['diff', '-M', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
  const diffText = git(root, [...flags, `-U${context}`, ...range, '--', ...(allFiles ? ['.'] : NOISE_PATHSPEC)]);

  let skipped = [];
  if (!allFiles) {
    const all = git(root, ['diff', '-M', '--no-ext-diff', '--name-only', ...range])
      .split('\n')
      .filter(Boolean);
    const kept = new Set(
      git(root, ['diff', '-M', '--no-ext-diff', '--name-only', ...range, '--', ...NOISE_PATHSPEC])
        .split('\n')
        .filter(Boolean),
    );
    skipped = all.filter((f) => !kept.has(f));
  }
  const untracked = working
    ? git(root, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
    : [];

  return { diffText, branch, headSha, baseSha, mergeBase, ahead, skipped, untracked };
}

/** Keep .mr-cast/ out of `git status` without touching the user's .gitignore. */
export function ensureExcluded(root) {
  const file = path.resolve(root, git(root, ['rev-parse', '--git-path', 'info/exclude']).trim());
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split('\n').some((l) => ['.mr-cast/', '/.mr-cast/', '.mr-cast'].includes(l.trim()))) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sep = current === '' || current.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${sep}.mr-cast/\n`);
}

/** `git diff --numstat` lines as { file, additions, deletions }; binary files count 0. */
const numstat = (text) =>
  text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [add, del, ...rest] = line.split('\t');
      return { file: rest.join('\t'), additions: Number(add) || 0, deletions: Number(del) || 0 };
    });

/**
 * What the current branch offers a walkthrough, without reading the diff itself: the base `extract` would
 * use (null when none is found), the commits ahead of it and the files they change, and the uncommitted
 * changes to tracked files (what `extract --working` adds) and untracked files.
 */
export function branchStatus(root) {
  const branch = tryGit(root, ['symbolic-ref', '-q', '--short', 'HEAD']) ?? 'HEAD';
  const hasCommits = Boolean(commitOf(root, 'HEAD'));
  let base = null;
  try {
    base = resolveBase(root);
  } catch {
    /* no base branch */
  }
  const mergeBase = base && hasCommits ? tryGit(root, ['merge-base', base, 'HEAD']) : null;
  const ahead = mergeBase ? Number(git(root, ['rev-list', '--count', `${mergeBase}..HEAD`]).trim()) : 0;
  const stat = (range) =>
    numstat(git(root, ['diff', '-M', '--no-ext-diff', '--numstat', ...range, '--', ...NOISE_PATHSPEC]));
  const files = ahead ? stat([`${base}...HEAD`]) : [];
  const working = hasCommits ? stat(['HEAD']) : [];
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter((f) => f && !f.startsWith('.mr-cast/')).length;
  return { branch, base, ahead, files, working, untracked };
}
