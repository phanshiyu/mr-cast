import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildHunkIndex, parseUnifiedDiff } from './lib/diff.mjs';
import { UserError } from './lib/errors.mjs';
import { locateJsonError } from './lib/json.mjs';
import { dataDir, ensureExcluded, readDiff, repoRoot, resolveBase } from './lib/git.mjs';
import { startServer } from './lib/server.mjs';
import { changedHunkIds, formatIndex, formatValidation, summarizeFiles } from './lib/summary.mjs';
import { storyboardSeconds, validateStoryboard } from './lib/validate.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const USAGE = `usage: mr-cast <command> [options]

  extract [base] [--working] [--context N] [--max-lines N] [--all-files]
      Diff the current branch against base (default: origin/HEAD, main, master, ...),
      write .mr-cast/hunks.json and print a hunk index.
      --working    diff merge-base against the working tree (staged + unstaged)
      --context    context lines per hunk (default 4)
      --max-lines  changed lines shown per hunk in the index (default 14)
      --all-files  include lockfiles, minified and build output
  validate        check .mr-cast/storyboard.json against hunks.json
  play [--port N] [--no-open]
                  serve the live player (default port 4747)
  render [--out file.mp4]
                  render the walkthrough to MP4 (default .mr-cast/walkthrough.mp4)
  still [sceneIndex...] [--out dir]
                  render PNG stills of scenes (0-based; default all, .mr-cast/stills)
  help            show this message`;

const rel = (p) => path.relative(process.cwd(), p) || '.';

function intOption(value, name, min) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new UserError(`--${name} must be an integer >= ${min} (got "${value}")`);
  return n;
}

function readJson(file, missingHint) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new UserError(`${rel(file)} not found; ${missingHint}`);
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    const loc = locateJsonError(text);
    if (!loc) throw err;
    const lineText = text.split('\n')[loc.line - 1].trim().slice(0, 80);
    throw new UserError(`${rel(file)} is not valid JSON at line ${loc.line} column ${loc.column}: ${loc.reason} (line: ${lineText})`);
  }
}

function loadProject() {
  const dir = dataDir(repoRoot());
  const hunks = readJson(path.join(dir, 'hunks.json'), 'run `mr-cast extract` first');
  const storyboard = readJson(path.join(dir, 'storyboard.json'), 'write it first (schema: Storyboard in src/types.ts)');
  const result = validateStoryboard(storyboard, hunks);
  const seconds = result.errors.length ? 0 : storyboardSeconds(storyboard);
  return { dir, hunks, storyboard, result, lines: formatValidation(result, { storyboard, hunks, seconds }) };
}

/** Validate, print problems to stderr, and stop on errors. */
function loadValidProject() {
  const project = loadProject();
  if (project.result.errors.length || project.result.warnings.length) {
    for (const line of project.lines) console.error(line);
  }
  if (project.result.errors.length) process.exit(1);
  return project;
}

function extract(argv) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      working: { type: 'boolean', default: false },
      context: { type: 'string', default: '4' },
      'max-lines': { type: 'string', default: '14' },
      'all-files': { type: 'boolean', default: false },
    },
  });
  if (positionals.length > 1) throw new UserError(`extract takes at most one base, got: ${positionals.join(' ')}`);
  const context = intOption(values.context, 'context', 0);
  const maxLines = intOption(values['max-lines'], 'max-lines', 1);

  const root = repoRoot();
  const dir = dataDir(root);
  ensureExcluded(root);
  const base = resolveBase(root, positionals[0]);
  const diff = readDiff(root, { base, working: values.working, context, allFiles: values['all-files'] });

  const parsed = parseUnifiedDiff(diff.diffText);
  if (parsed.length === 0) {
    if (diff.skipped.length) throw new UserError(`every changed file is noise (${diff.skipped.join(', ')}); pass --all-files to include them`);
    if (values.working) throw new UserError(`no changes between ${base} (merge-base ${diff.mergeBase.slice(0, 7)}) and the working tree${diff.untracked.length ? `; ${diff.untracked.length} untracked files are not included (git add -N <file> to include)` : ''}`);
    const where = diff.branch === base || diff.headSha === diff.baseSha ? `HEAD is on the base (${base}) with` : `${diff.branch} has`;
    throw new UserError(`${where} no changes ahead of ${base}; use \`mr-cast extract --working\` for uncommitted changes or pass another base: \`mr-cast extract <base>\``);
  }

  const hunks = buildHunkIndex(parsed);
  const files = summarizeFiles(parsed, hunks);
  const hunksPath = path.join(dir, 'hunks.json');
  const storyboardPath = path.join(dir, 'storyboard.json');

  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(hunksPath, 'utf8')); } catch { /* first run or unreadable */ }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(hunksPath, `${JSON.stringify(hunks, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify({
    base, baseSha: diff.baseSha, mergeBase: diff.mergeBase,
    head: 'HEAD', headSha: diff.headSha, branch: diff.branch,
    working: values.working, generatedAt: new Date().toISOString(),
    files, skipped: diff.skipped,
  }, null, 2)}\n`);

  if (fs.existsSync(storyboardPath)) {
    const changed = previous ? changedHunkIds(previous, hunks) : null;
    if (!changed) console.error(`note: kept existing ${rel(storyboardPath)}; hunk ids may have changed, run \`mr-cast validate\``);
    else if (changed.length) console.error(`note: kept existing ${rel(storyboardPath)}; hunks changed or gone since last extract: ${changed.join(', ')}; re-check scenes using them, then \`mr-cast validate\``);
  }

  console.log(formatIndex({
    ctx: { branch: diff.branch, base, ahead: diff.ahead, working: values.working, mergeBase: diff.mergeBase, untracked: diff.untracked },
    files, hunks, skipped: diff.skipped, maxLines,
    hunksPath: rel(hunksPath), storyboardPath: rel(storyboardPath),
  }));
}

function validate(argv) {
  parseArgs({ args: argv, options: {} });
  const { result, lines } = loadProject();
  for (const line of lines) console.log(line);
  if (result.errors.length) process.exit(1);
}

function ensureDist() {
  if (process.env.MR_CAST_DIST) {
    const dist = path.resolve(process.env.MR_CAST_DIST);
    if (!fs.existsSync(path.join(dist, 'index.html'))) throw new UserError(`MR_CAST_DIST=${dist} has no index.html`);
    return dist;
  }
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) return dist;
  console.error('mr-cast: building the player (first run only)...');
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) throw new UserError(`player not built and ${rel(vite)} is missing; run \`npm install\` in ${ROOT}`);
  const build = spawnSync(process.execPath, [vite, 'build'], { cwd: ROOT, stdio: ['ignore', 2, 2] });
  if (build.status !== 0 || !fs.existsSync(path.join(dist, 'index.html'))) throw new UserError('player build failed (see output above)');
  return dist;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch { /* no browser; the URL is printed */ }
}

async function play(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: 'string', default: '4747' }, 'no-open': { type: 'boolean', default: false } },
  });
  const port = intOption(values.port, 'port', 1);
  const { dir } = loadValidProject();
  const distDir = ensureDist();

  const onDataChange = (file) => {
    if (file === 'meta.json') return;
    try {
      const { lines } = loadProject();
      console.error(`mr-cast: ${file} changed`);
      for (const line of lines) console.error(`  ${line}`);
    } catch (err) {
      console.error(`mr-cast: ${file} changed · ${err.message}`);
    }
  };
  const server = await startServer({ distDir, dataDir: dir, port, onDataChange });
  console.log(`mr-cast player: ${server.url}`);
  if (!values['no-open']) openBrowser(server.url);

  const shutdown = () => server.close().then(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function importRender() {
  try {
    return await import('./lib/render.mjs');
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes('render.mjs')) {
      throw new UserError('rendering is not available in this install (bin/lib/render.mjs missing)');
    }
    throw err;
  }
}

function progressReporter(label) {
  const tty = process.stderr.isTTY;
  let lastDecile = -1;
  return {
    update(fraction) {
      const pct = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
      if (tty) process.stderr.write(`\r${label} ${pct}%`);
      else if (Math.floor(pct / 10) > lastDecile) {
        lastDecile = Math.floor(pct / 10);
        console.error(`${label} ${lastDecile * 10}%`);
      }
    },
    done() { if (tty) process.stderr.write('\n'); },
  };
}

async function render(argv) {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' } } });
  const { dir, hunks, storyboard } = loadValidProject();
  const { renderVideo } = await importRender();
  const outFile = path.resolve(values.out ?? path.join(dir, 'walkthrough.mp4'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const progress = progressReporter('rendering');
  const written = await renderVideo({ hunks, storyboard, outFile, onProgress: progress.update });
  progress.done();
  console.log(written ?? outFile);
}

async function still(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: 'string' } } });
  const { dir, hunks, storyboard } = loadValidProject();
  const count = storyboard.scenes.length;
  const scenes = positionals.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n >= count) throw new UserError(`scene index "${p}" out of range; storyboard has scenes 0-${count - 1}`);
    return n;
  });
  const { renderStills } = await importRender();
  const outDir = path.resolve(values.out ?? path.join(dir, 'stills'));
  fs.mkdirSync(outDir, { recursive: true });
  const files = await renderStills({ hunks, storyboard, outDir, scenes: scenes.length ? scenes : undefined });
  for (const f of files) console.log(path.resolve(f));
}

const COMMANDS = { extract, validate, play, render, still };

async function main([command, ...rest]) {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }
  const run = COMMANDS[command];
  if (!run) {
    console.error(`mr-cast: unknown command "${command}"\n\n${USAGE}`);
    process.exit(1);
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(USAGE);
    return;
  }
  await run(rest);
}

main(process.argv.slice(2)).catch((err) => {
  if (process.env.MR_CAST_DEBUG === '1') console.error(err);
  else if (err instanceof UserError) console.error(`mr-cast: ${err.message}`);
  else if (err.code?.startsWith?.('ERR_PARSE_ARGS')) console.error(`mr-cast: ${err.message.split('. ')[0]}; see \`mr-cast help\``);
  else console.error(`mr-cast: ${err.message} (set MR_CAST_DEBUG=1 for details)`);
  process.exit(1);
});
