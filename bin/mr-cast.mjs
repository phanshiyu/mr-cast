import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildHunkIndex, parseUnifiedDiff } from './lib/diff.mjs';
import { UserError } from './lib/errors.mjs';
import { parseSnippetArgs, snippetId, sourceHunk } from './lib/explain.mjs';
import { installSkill } from './lib/install-skill.mjs';
import { locateJsonError } from './lib/json.mjs';
import { ensureExcluded, findRepoRoot, readDiff, repoRoot, resolveBase } from './lib/git.mjs';
import { diffRun, explainRun, initExplainRun, writeCurrent } from './lib/runs.mjs';
import { startServer } from './lib/server.mjs';
import { changedHunkIds, formatDuration, formatIndex, formatSnippets, formatValidation, summarizeFiles } from './lib/summary.mjs';
import { storyboardSeconds, validateStoryboard } from './lib/validate.mjs';
import { ensureVoiceover, readVoiceover } from './lib/voice.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const USAGE = `usage: mr-cast <command> [options]

  extract [base] [--working] [--context N] [--max-lines N] [--all-files] [--name slug]
      Diff the current branch against base (default: origin/HEAD, main, master, ...),
      write .mr-cast/hunks.json and print a hunk index.
      --working    diff merge-base against the working tree (staged + unstaged)
      --context    context lines per hunk (default 4)
      --max-lines  changed lines shown per hunk in the index (default 14)
      --all-files  include lockfiles, minified and build output
  validate        check .mr-cast/storyboard.json against hunks.json
  voice [--voice name]
                  speak each scene's narration with Kokoro into .mr-cast/audio (default voice af_heart)
  play [--port N] [--no-open] [--voice name] [--no-voice]
                  serve the live player (default port 4747)
  render [--out file.mp4] [--voice name] [--no-voice]
                  render the walkthrough to MP4 (default .mr-cast/walkthrough.mp4)
                  play and render voice the narration first unless --no-voice
  still [sceneIndex...] [--out dir]
                  render PNG stills of scenes (0-based; default all, .mr-cast/stills)
  every command above takes --name <slug> to keep a separate walkthrough in .mr-cast/<slug>, so
  several can coexist and render at once; validate, voice, play, render and still also take
  --dir <path> to use any data directory

  explain init [--title text] [--name slug] [--reset]
                  start an explanation in .mr-cast/explain/<slug> (in the git repo, else the current
                  directory); the slug comes from the title unless --name; prints the directory;
                  reopening one keeps its storyboard unless --reset
  explain snippet <file> <start>-<end> | <file>:<start>-<end> ...
                  add real source lines (at most 80 per snippet) as code for scenes, ids s1, s2, ...
  explain validate | voice | play | render | still
                  the commands above, on the explanation's directory
      every explain command takes --name <slug> (default: the most recent init) or --dir <path>

  install-skill   install the mr-video and explain-in-animation Claude Code skills and the
                  /mr-cast, /mr-render and /explain-in-animation commands into ~/.claude
  help            show this message`;

/** A path for messages: relative to the current directory when inside it, else absolute. */
const rel = (p) => {
  const r = path.relative(process.cwd(), p);
  return r.startsWith('..') ? path.resolve(p) : r || '.';
};

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

const DIR_OPTION = { dir: { type: 'string' }, name: { type: 'string' } };

/** "explain" when `mr-cast explain init` made the directory; anything else holds a diff. */
function readMode(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).mode === 'explain' ? 'explain' : 'diff';
  } catch {
    return 'diff';
  }
}

async function loadProject(dir) {
  const hunks = readJson(path.join(dir, 'hunks.json'), 'run `mr-cast extract` (or `mr-cast explain init`) first, with the same --name');
  const storyboard = readJson(path.join(dir, 'storyboard.json'), 'write it first (schema: Storyboard in src/types.ts)');
  const result = await validateStoryboard(storyboard, hunks, readMode(dir));
  const seconds = result.errors.length ? 0 : storyboardSeconds(storyboard, readVoiceover(dir));
  return { dir, hunks, storyboard, result, lines: formatValidation(result, { storyboard, hunks, seconds }) };
}

/** Validate, print problems to stderr, and stop on errors. */
async function loadValidProject(dir) {
  const project = await loadProject(dir);
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
      name: DIR_OPTION.name,
    },
  });
  if (positionals.length > 1) throw new UserError(`extract takes at most one base, got: ${positionals.join(' ')}`);
  const context = intOption(values.context, 'context', 0);
  const maxLines = intOption(values['max-lines'], 'max-lines', 1);

  const root = repoRoot();
  const { dir, name } = diffRun(values);
  const nameArg = name ? ` --name ${name}` : '';
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
    if (!changed) console.error(`note: kept existing ${rel(storyboardPath)}; hunk ids may have changed, run \`mr-cast validate${nameArg}\``);
    else if (changed.length) console.error(`note: kept existing ${rel(storyboardPath)}; hunks changed or gone since last extract: ${changed.join(', ')}; re-check scenes using them, then \`mr-cast validate${nameArg}\``);
  }

  console.log(formatIndex({
    ctx: { branch: diff.branch, base, ahead: diff.ahead, working: values.working, mergeBase: diff.mergeBase, untracked: diff.untracked },
    files, hunks, skipped: diff.skipped, maxLines,
    hunksPath: rel(hunksPath), storyboardPath: rel(storyboardPath), nameArg,
  }));
}

async function validate(argv, resolveRun) {
  const { values } = parseArgs({ args: argv, options: DIR_OPTION });
  const { result, lines } = await loadProject(resolveRun(values).dir);
  for (const line of lines) console.log(line);
  if (result.errors.length) process.exit(1);
}

const VOICE_OPTIONS = { voice: { type: 'string' }, 'no-voice': { type: 'boolean', default: false } };

function reportVoiceProgress(event) {
  if (event.type === 'download') console.error(`mr-cast: downloading the Kokoro voice model (about 90 MB, first run only) into ${event.cacheDir}`);
  else if (event.type === 'clip') {
    const text = event.text.length > 60 ? `${event.text.slice(0, 57)}...` : event.text;
    console.error(`  voiced ${event.done}/${event.total} · ${event.seconds.toFixed(1)}s · ${text}`);
  }
}

/** Voice-over for play and render. Any failure falls back to silent scenes with estimated timing. */
async function voiceoverFor(dir, storyboard, values) {
  if (values['no-voice']) return null;
  try {
    return await ensureVoiceover({ dataDir: dir, storyboard, voice: values.voice, onProgress: reportVoiceProgress });
  } catch (err) {
    console.error(`mr-cast: warning: continuing without voice-over: ${err.message}`);
    return null;
  }
}

async function voice(argv, resolveRun) {
  const { values } = parseArgs({ args: argv, options: { voice: VOICE_OPTIONS.voice, ...DIR_OPTION } });
  const { dir, storyboard } = await loadValidProject(resolveRun(values).dir);
  let generated = 0;
  const voiceover = await ensureVoiceover({
    dataDir: dir, storyboard, voice: values.voice,
    onProgress: (event) => {
      if (event.type === 'clip') generated++;
      reportVoiceProgress(event);
    },
  });
  const clips = Object.keys(voiceover.clips).length;
  console.log(`✓ voiceover · ${clips} clip${clips === 1 ? '' : 's'} (${generated} new) · ${formatDuration(storyboardSeconds(storyboard, voiceover))}`);
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

async function play(argv, resolveRun) {
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: 'string', default: '4747' }, 'no-open': { type: 'boolean', default: false }, ...VOICE_OPTIONS, ...DIR_OPTION },
  });
  const port = intOption(values.port, 'port', 1);
  const { dir, storyboard } = await loadValidProject(resolveRun(values).dir);
  const distDir = ensureDist();
  let voiceover = await voiceoverFor(dir, storyboard, values);

  const onDataChange = async (file) => {
    if (file === 'meta.json') return;
    let project;
    try {
      project = await loadProject(dir);
      console.error(`mr-cast: ${file} changed`);
      if (file === 'storyboard.json' && !project.result.errors.length) {
        voiceover = await voiceoverFor(dir, project.storyboard, values);
        project = await loadProject(dir);
      }
    } catch (err) {
      console.error(`mr-cast: ${file} changed · ${err.message}`);
      return;
    }
    for (const line of project.lines) console.error(`  ${line}`);
  };
  const server = await startServer({ distDir, dataDir: dir, port, onDataChange, getVoiceover: () => voiceover });
  console.log(`mr-cast player: ${server.url}`);
  if (!values['no-open']) openBrowser(server.url);

  // Once Kokoro has loaded, process.exit() aborts in onnxruntime's thread pool ("mutex lock failed"),
  // so stop everything holding the event loop and let Node exit on its own.
  const shutdown = () => server.close();
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

async function render(argv, resolveRun) {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' }, ...VOICE_OPTIONS, ...DIR_OPTION } });
  const { dir, hunks, storyboard } = await loadValidProject(resolveRun(values).dir);
  const voiceover = await voiceoverFor(dir, storyboard, values);
  const { renderVideo } = await importRender();
  const outFile = path.resolve(values.out ?? path.join(dir, 'walkthrough.mp4'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const progress = progressReporter('rendering');
  const written = await renderVideo({ hunks, storyboard, voiceover, dataDir: dir, outFile, onProgress: progress.update });
  progress.done();
  console.log(written ?? outFile);
}

async function still(argv, resolveRun) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: 'string' }, ...DIR_OPTION } });
  const { dir, hunks, storyboard } = await loadValidProject(resolveRun(values).dir);
  const count = storyboard.scenes.length;
  const scenes = positionals.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n >= count) throw new UserError(`scene index "${p}" out of range; storyboard has scenes 0-${count - 1}`);
    return n;
  });
  const { renderStills } = await importRender();
  const outDir = path.resolve(values.out ?? path.join(dir, 'stills'));
  fs.mkdirSync(outDir, { recursive: true });
  const voiceover = readVoiceover(dir);
  const files = await renderStills({ hunks, storyboard, voiceover, outDir, scenes: scenes.length ? scenes : undefined });
  for (const f of files) console.log(path.resolve(f));
}

function installSkillCommand(argv) {
  parseArgs({ args: argv, options: {} });
  for (const file of installSkill(ROOT)) console.log(`wrote ${file}`);
}

const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function explainInit(argv) {
  const { values } = parseArgs({ args: argv, options: { ...DIR_OPTION, title: { type: 'string' }, reset: { type: 'boolean', default: false } } });
  const { dir, name } = initExplainRun(values);
  const root = findRepoRoot();
  if (root && !values.dir) ensureExcluded(root);
  const files = { hunks: path.join(dir, 'hunks.json'), storyboard: path.join(dir, 'storyboard.json'), meta: path.join(dir, 'meta.json') };
  if (fs.existsSync(files.meta) && readMode(dir) !== 'explain') throw new UserError(`${rel(dir)} holds a diff walkthrough (made by \`mr-cast extract\`); pass another --name or --dir`);
  if (values.reset) for (const file of Object.values(files)) fs.rmSync(file, { force: true });

  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(files.meta, 'utf8')); } catch { /* new directory */ }
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(files.hunks)) writeJson(files.hunks, {});
  writeJson(files.meta, {
    mode: 'explain',
    title: values.title ?? previous.title ?? null,
    createdAt: previous.createdAt ?? new Date().toISOString(),
  });

  if (name) writeCurrent(path.dirname(dir), name);

  console.log(dir);
  if (name) console.error(`mr-cast: explanation "${name}"; later explain commands use it until another init, or pass --name ${name}`);
  const snippets = Object.keys(readJson(files.hunks, '')).length;
  let kept = null;
  try { kept = JSON.parse(fs.readFileSync(files.storyboard, 'utf8')).title ?? '(untitled)'; } catch { /* none yet */ }
  if (kept !== null) console.error(`note: kept existing storyboard "${kept}" and ${snippets} snippet${snippets === 1 ? '' : 's'}; pass --reset to start it over, or a new --title for another explanation`);
  else if (snippets) console.error(`note: kept ${snippets} existing snippet${snippets === 1 ? '' : 's'}; pass --reset to start over`);
  console.error(`next: \`mr-cast explain snippet <file>:<start>-<end>\` for code to show, write ${rel(files.storyboard)}, then \`mr-cast explain validate\``);
}

function explainSnippet(argv, resolveRun) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: DIR_OPTION });
  const { dir } = resolveRun(values);
  if (readMode(dir) !== 'explain') throw new UserError(`${rel(dir)} is not an explanation directory; run \`mr-cast explain init${values.dir ? ' --dir <path>' : ''}\` first`);
  const hunksPath = path.join(dir, 'hunks.json');
  const hunks = readJson(hunksPath, 'run `mr-cast explain init` first');
  // Paths are shown relative to the repository (or the current directory outside one), as a diff shows them.
  const base = findRepoRoot() ?? process.cwd();
  const added = parseSnippetArgs(positionals).map((spec) => {
    const abs = path.resolve(spec.file);
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') throw new UserError(`${spec.file}: no such file`);
      throw err;
    }
    const fileLines = text.replace(/\r?\n$/, '').split(/\r?\n/);
    const shown = path.relative(base, abs);
    const file = shown.startsWith('..') ? abs : shown;
    const range = { ...spec, file };
    const hunk = sourceHunk(snippetId(hunks, range), range, fileLines);
    hunks[hunk.id] = hunk;
    return hunk;
  });
  writeJson(hunksPath, hunks);
  console.log(formatSnippets({ added, hunks, hunksPath: rel(hunksPath), storyboardPath: rel(path.join(dir, 'storyboard.json')) }));
}

const EXPLAIN_COMMANDS = { init: explainInit, snippet: explainSnippet, validate, voice, play, render, still };

async function explain([sub, ...rest]) {
  const run = EXPLAIN_COMMANDS[sub];
  if (!run) throw new UserError(`explain needs one of ${Object.keys(EXPLAIN_COMMANDS).join(', ')}${sub ? ` (got "${sub}")` : ''}; see \`mr-cast help\``);
  await run(rest, explainRun);
}

const COMMANDS = { extract, validate, voice, play, render, still, explain, 'install-skill': installSkillCommand };

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
  await run(rest, diffRun);
}

main(process.argv.slice(2)).catch((err) => {
  if (process.env.MR_CAST_DEBUG === '1') console.error(err);
  else if (err instanceof UserError) console.error(`mr-cast: ${err.message}`);
  else if (err.code?.startsWith?.('ERR_PARSE_ARGS')) console.error(`mr-cast: ${err.message.split('. ')[0]}; see \`mr-cast help\``);
  else console.error(`mr-cast: ${err.message} (set MR_CAST_DEBUG=1 for details)`);
  process.exitCode = 1; // not process.exit(): see shutdown in play()
});
