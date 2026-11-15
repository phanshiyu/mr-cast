// The change map (ADR 0037): facts a diff does not show, read from git and the working tree. No network.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isTestFile } from '../../shared/test-files.mjs';
import { testNames } from '../../shared/test-names.mjs';
import { detectLanguage } from './diff.mjs';
import { UserError } from './errors.mjs';
import { tryGit } from './git.mjs';

const KINDS = ['source', 'tests', 'docs', 'config', 'routine'];

const MAX_NAMES = 40;
const MIN_NAME = 4;
const GREP_TIMEOUT_MS = 3000;
const GREP_BUDGET_MS = 20000;
const MAX_COMMITS = 200;
const MAX_PATHS = 3;
const MAX_NAMES_PER_TEST = 8;
const MINUS = '−';

const ROUTINE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock|composer\.lock|uv\.lock)$|\.min\.(js|css)$|\.map$|\.snap$|(^|\/)(__snapshots__|dist|build|vendor)\/|\.generated\.|_pb2\.py$|\.pb\.go$/;
const DOC_NAME = /\.(txt|rst|adoc)$|(^|\/)(docs?|documentation)\/|(^|\/)(README|CHANGELOG|LICENSE|NOTICE)[^/]*$/i;
const CONFIG_LANGUAGES = new Set(['json', 'yaml', 'toml', 'docker', 'makefile', 'hcl']);
const CONFIG_NAME = /\.(ini|cfg|conf|env|lock)$|(^|\/)\.[^/]+$|(^|\/)\.github\//;

/** The kind of a changed file: source, tests, docs, config or routine. */
function kindOf(f) {
  if (f.binary || ROUTINE.test(f.file)) return 'routine';
  if (f.status === 'renamed' && f.hunkIds.length === 0) return 'routine';
  if (isTestFile(f.file)) return 'tests';
  const language = detectLanguage(f.file);
  if (language === 'markdown' || DOC_NAME.test(f.file)) return 'docs';
  if (CONFIG_LANGUAGES.has(language) || CONFIG_NAME.test(f.file) || language === 'text') return 'config';
  return 'source';
}

const STATUS = { added: 'new', deleted: 'removed', renamed: 'renamed', modified: 'modified' };

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'else']);
const JS_NAME = '([A-Za-z_$][\\w$]*)';
const MODIFIERS =
  '(?:(?:public|private|protected|internal|static|final|abstract|override|open|async|get|set|readonly)\\s+)*';
const JS = [
  new RegExp(
    `^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|interface|type|enum)\\s+${JS_NAME}`,
  ),
  new RegExp(`^\\s*export\\s+(?:const|let|var)\\s+${JS_NAME}`),
  new RegExp(`^\\s*${MODIFIERS}${JS_NAME}\\s*\\([^)]*\\)\\s*(?::[^={]+)?\\{\\s*$`),
];
const BRACE_TYPE = new RegExp(`^\\s*${MODIFIERS}(?:class|interface|enum|record|object|trait)\\s+(\\w+)`);
const JAVA_METHOD =
  /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)+[\w<>[\],.? ]+\s+(\w+)\s*\(/;
const KOTLIN_FUN = new RegExp(`^\\s*${MODIFIERS}(?:suspend\\s+)?fun\\s+(?:<[^>]+>\\s*)?(?:[\\w.]+\\.)?(\\w+)`);
const PHP_FUNCTION = /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+(\w+)/;

/** Declaration patterns by language (as `detectLanguage` names them); capture group 1 is the name. */
const DECLARATIONS = {
  javascript: JS,
  jsx: JS,
  typescript: JS,
  tsx: JS,
  python: [/^\s*(?:async\s+)?def\s+(\w+)/, /^\s*class\s+(\w+)/],
  go: [/^func\s+(?:\([^)]*\)\s*)?(\w+)/, /^type\s+(\w+)/],
  ruby: [/^\s*def\s+(?:self\.)?(\w+[?!]?)/, /^\s*(?:class|module)\s+(\w+)/],
  java: [BRACE_TYPE, JAVA_METHOD],
  kotlin: [BRACE_TYPE, KOTLIN_FUN],
  rust: [
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/,
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type|const|static|mod)\s+(\w+)/,
  ],
  php: [PHP_FUNCTION, /^\s*(?:class|interface|trait|enum)\s+(\w+)/],
};
const SKIP_NAMES = new Set(['constructor', 'main', 'init', 'default', 'index', 'self', 'this', 'test', 'tests']);

const declarationOf = (patterns, text) => {
  for (const re of patterns) {
    const name = re.exec(text)?.[1];
    if (name) return name;
  }
  return null;
};

/**
 * Names declared on the added or removed lines of a hunk, and the declaration each change sits inside (the last
 * one seen above it, starting from git's hunk header), since a changed body leaves its signature as context.
 */
function declaredNames(language, hunk) {
  const patterns = DECLARATIONS[language];
  if (!patterns) return [];
  const names = [];
  let enclosing = declarationOf(patterns, hunk.header ?? '');
  let reported = null;
  for (const l of hunk.lines) {
    const own = declarationOf(patterns, l.text);
    if (own) enclosing = own;
    if (l.type === 'context') continue;
    if (own) names.push(own);
    else if (enclosing && enclosing !== reported) names.push(enclosing);
    reported = enclosing;
  }
  return names.filter((n) => n.length >= MIN_NAME && !SKIP_NAMES.has(n) && !KEYWORDS.has(n));
}

const IMPORT_LINE = /\b(import|require|from|use|include|using|load|source)\b|^\s*#include/;
const stemOf = (file) => path.basename(file).replace(/\.[^.]+$/, '');
const testStem = (file) => stemOf(file).replace(/^test_|[_.](test|spec)$|(Tests?|Spec|IT)$/g, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether a test file's text imports or names the source file, or is named after it. */
function coversSource(testFile, testText, source) {
  const stem = stemOf(source);
  if (stem.length < 3) return false;
  if (testStem(testFile) === stem || testText.includes(source)) return true;
  const re = new RegExp(`(^|[^\\w])${escapeRe(stem)}([^\\w]|$)`);
  return testText.split('\n').some((line) => IMPORT_LINE.test(line) && re.test(line));
}

function readNewText(root, file, working) {
  if (working) {
    try {
      return fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      return '';
    }
  }
  return tryGit(root, ['show', `HEAD:${file}`]) ?? '';
}

function readCommits(root, mergeBase) {
  const format = '--format=%h%x1f%s%x1f%b%x1e';
  const out = tryGit(root, ['log', '--reverse', `-n${MAX_COMMITS}`, format, `${mergeBase}..HEAD`]);
  if (!out) return [];
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha, subject, body = ''] = r.split('\x1f');
      return { sha, subject, body: body.trim() };
    });
}

/** Files outside `skip` that use `name` as a whole word, by `git grep`; null when the search failed or timed out. */
function grepElsewhere(root, name, skip, timeout) {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', 'grep', '-I', '-w', '-l', '-F', '-e', name], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error || (r.status !== 0 && r.status !== 1)) return null;
  return r.stdout.split('\n').filter((f) => f && !skip.has(f));
}

function usedElsewhere(root, files, hunks, diffFiles) {
  const wanted = [];
  const seen = new Set();
  for (const f of files) {
    if (f.kind !== 'source' || f.status === 'new') continue;
    const names = f.hunkIds.flatMap((id) => (hunks[id] ? declaredNames(detectLanguage(f.file), hunks[id]) : []));
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      wanted.push({ name, file: f.file });
    }
  }
  const searched = wanted.slice(0, MAX_NAMES);
  const started = Date.now();
  const found = [];
  let stopped = false;
  for (const { name, file } of searched) {
    if (Date.now() - started > GREP_BUDGET_MS) {
      stopped = true;
      break;
    }
    const hits = grepElsewhere(root, name, diffFiles, GREP_TIMEOUT_MS);
    if (hits === null) continue;
    found.push({ name, file, count: hits.length, paths: hits.slice(0, MAX_PATHS) });
  }
  return {
    method: 'text search (git grep -w), not a call graph',
    names: found,
    omitted: wanted.length - searched.length,
    stopped,
  };
}

function testsAndCoverage(root, files, hunks, working) {
  const sources = files.filter((f) => f.kind === 'source' && f.status !== 'removed').map((f) => f.file);
  const named = new Set();
  const tests = [];
  for (const f of files) {
    if (f.kind !== 'tests' || f.status === 'removed') continue;
    const text = readNewText(root, f.file, working);
    const covers = sources.filter((s) => coversSource(f.file, text, s));
    for (const s of covers) named.add(s);
    tests.push({ file: f.file, covers, adds: testNames(f.hunkIds.flatMap((id) => hunks[id]?.lines ?? [])) });
  }
  // `untested` keeps its name in map.json, but it only means no changed test file names or imports the file.
  return { tests, untested: sources.filter((s) => !named.has(s)) };
}

/**
 * The change map: commits, the merge request's description, files by kind, tests and what they cover, and where
 * the names declared in modified source files are used outside the diff.
 */
export function buildChangeMap({ root, mergeBase, working, files, hunks, skipped, descriptionFile }) {
  let description = null;
  if (descriptionFile) {
    try {
      description = { file: descriptionFile, text: fs.readFileSync(descriptionFile, 'utf8').trim() };
    } catch {
      throw new UserError(`${descriptionFile}: cannot read the description file`);
    }
  }
  const sized = files.map((f) => ({
    file: f.file,
    oldFile: f.oldFile,
    kind: kindOf(f),
    status: STATUS[f.status],
    additions: f.additions,
    deletions: f.deletions,
    hunkIds: f.hunkIds,
  }));
  const byKind = Object.fromEntries(KINDS.map((k) => [k, []]));
  for (const f of sized) byKind[f.kind].push(f);
  for (const k of KINDS) byKind[k].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
  const diffFiles = new Set(files.flatMap((f) => [f.file, f.oldFile].filter(Boolean)));
  return {
    commits: readCommits(root, mergeBase),
    description,
    files: byKind,
    skipped,
    changedLines: Object.values(hunks).reduce((n, h) => n + h.additions + h.deletions, 0),
    ...testsAndCoverage(root, sized, hunks, working),
    usedElsewhere: usedElsewhere(root, sized, hunks, diffFiles),
  };
}

/** The order the hunk index lists files in: source, tests, docs, config, routine; each kind keeps the diff order. */
export function orderByKind(files) {
  const rank = (f) => KINDS.indexOf(kindOf(f));
  return files
    .map((f, i) => [f, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([f]) => f);
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const BODY_LINES = 8;
const DESCRIPTION_LINES = 20;
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function fileLine(f) {
  const tag = f.status === 'renamed' ? `renamed from ${f.oldFile}` : f.status;
  const hunks = f.hunkIds.length ? `  ${f.hunkIds.join(' ')}` : '';
  return `  ${f.file}  ${tag}  +${f.additions} ${MINUS}${f.deletions}${hunks}`;
}

function formatFiles(map) {
  const out = ['files by kind (largest first)'];
  for (const kind of KINDS) {
    const list = map.files[kind];
    if (!list.length) continue;
    if (kind === 'source') {
      const changed = list.filter((f) => f.status !== 'new');
      const added = list.filter((f) => f.status === 'new');
      if (changed.length) out.push(' source, existing code changed', ...changed.map(fileLine));
      if (added.length) out.push(' source, new files', ...added.map(fileLine));
    } else out.push(` ${kind}`, ...list.map(fileLine));
  }
  if (map.skipped.length) out.push(` skipped as noise: ${count(map.skipped.length, 'file')}`);
  return out;
}

/**
 * The heading of `untested` in map.json. The list is a text match on file names and imports, so a source file on it is
 * one no changed test file names, which is not the same as one no test reaches.
 */
const NOT_NAMED =
  'no changed test file names these; a test may still reach them, so read the tests before saying a file is untested';

function formatTests(map) {
  const out = [];
  if (map.tests.length) {
    out.push('tests and what they cover');
    for (const t of map.tests) {
      out.push(`  ${t.file}  covers ${t.covers.length ? t.covers.join(', ') : 'no changed source file'}`);
      const shown = t.adds.slice(0, MAX_NAMES_PER_TEST).map((n) => `"${clip(n, 80)}"`);
      const more = t.adds.length > shown.length ? `, … ${t.adds.length - shown.length} more` : '';
      if (shown.length) out.push(`    adds ${count(t.adds.length, 'test')}: ${shown.join(', ')}${more}`);
    }
  }
  if (map.untested.length) out.push(`${NOT_NAMED}: ${map.untested.join(', ')}`);
  return out;
}

function formatUsed(map) {
  const { names, method, omitted, stopped } = map.usedElsewhere;
  if (!names.length) return [];
  const out = [`used elsewhere (${method}; false matches are possible)`];
  const unused = [];
  for (const n of names) {
    if (n.count === 0) unused.push(n.name);
    else {
      const more = n.count > n.paths.length ? ', …' : '';
      out.push(`  ${n.name} (${n.file}): ${count(n.count, 'file')} outside the diff: ${n.paths.join(', ')}${more}`);
    }
  }
  if (unused.length) out.push(`  no use found outside the diff: ${unused.join(', ')}`);
  if (omitted) out.push(`  ${omitted} more names not searched (limit ${MAX_NAMES})`);
  if (stopped) out.push('  the search stopped at its time limit');
  return out;
}

/** The map as text, compact; map.json holds all of it. */
export function formatChangeMap(map) {
  const out = ['change map'];
  if (map.description?.text) {
    const lines = map.description.text.split('\n');
    out.push(`said by the author, description (${map.description.file})`);
    out.push(...lines.slice(0, DESCRIPTION_LINES).map((l) => `  ${clip(l, 110)}`));
    if (lines.length > DESCRIPTION_LINES) out.push(`  … ${lines.length - DESCRIPTION_LINES} more lines in map.json`);
  }
  out.push(`said by the author, ${count(map.commits.length, 'commit')}, oldest first`);
  for (const c of map.commits) {
    out.push(`  ${c.sha} ${clip(c.subject, 100)}`);
    const body = c.body ? c.body.split('\n') : [];
    out.push(...body.slice(0, BODY_LINES).map((l) => `      ${clip(l, 110)}`));
    if (body.length > BODY_LINES) out.push(`      … ${body.length - BODY_LINES} more lines in map.json`);
  }
  out.push(...formatFiles(map), ...formatTests(map), ...formatUsed(map));
  return out.join('\n');
}
