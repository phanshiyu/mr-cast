import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildHunkIndex, parseUnifiedDiff } from './lib/diff.mjs';
import { UserError } from './lib/errors.mjs';
import { parseSnippetArgs, snippetId, sourceHunk } from './lib/explain.mjs';
import { installSkill, refreshSkills, uninstallSkill } from './lib/install-skill.mjs';
import { locateJsonError } from './lib/json.mjs';
import { branchStatus, dataDir, ensureExcluded, findRepoRoot, readDiff, repoRoot, resolveBase } from './lib/git.mjs';
import { KINDS, formatBytes, formatChoices, formatListing, listArtifacts, listingJson, olderThan, pruneArtifacts, pruneChoices, removalPlan, select } from './lib/prune.mjs';
import { branchRun, currentRun, explanationRun, explanationSlug, readRunMeta, recordAudience, runsRoot, videoName, writeCurrent } from './lib/runs.mjs';
import { SETTINGS_OPTIONS, lastChoices, rememberChoices, settingsArgs, settingsFrom } from './lib/settings.mjs';
import { BUILT_FILE, readPlan, recordBuilt } from './lib/plan.mjs';
import { startServer } from './lib/server.mjs';
import { createServing } from './lib/serving.mjs';
import { updateNotice } from './lib/update.mjs';
import { upgrade } from './lib/upgrade.mjs';
import { changedHunkIds, formatDuration, formatIndex, formatOutline, formatSnippets, formatValidation, plural, summarizeFiles } from './lib/summary.mjs';
import { PACES, clipFor, paceOf } from '../shared/voice.mjs';
import { spokenTexts } from '../shared/timing.mjs';
import { storyboardSeconds, validateStoryboard } from './lib/validate.mjs';
import { formatSteps } from './lib/highlight.mjs';
import { formatSchema } from './lib/schema.mjs';
import { normalizeStoryboard } from '../shared/normalize.mjs';
import { parseStoryboard } from '../shared/storyboard-json.mjs';
import { REVIEW_HEADING, isReviewed, reviewMarkdown } from '../shared/review.mjs';
import { READING_HEADING, readingMarkdown, readingOrder } from '../shared/reading.mjs';
import { formatLength, planSeconds } from '../shared/plan.mjs';
import { ensureVoiceover, readVoiceover, voicedLines } from './lib/voice.mjs';
import { ensureVoiceoverInChild, stopVoicing } from './lib/voice-child.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const USAGE = `usage: mr-cast <command> [options]

In Claude Code, type /mr-cast or ask for "a video of this branch" or "animate that". The skill runs the
commands under "Used by the Claude Code skills" for you.

  install-skill     install the mr-cast skills into ~/.claude
                    (or $CLAUDE_CONFIG_DIR), and remove what earlier versions installed there
  uninstall-skill   remove every skill mr-cast installed
  upgrade [--check] update mr-cast from npm, then its skills; --check only reports the versions
  prune [id...] [--kind k,k] [--all] [--older-than days] [--except id] [--dry-run] [--json]
                    list what mr-cast stored (walkthroughs, videos, voice clips, downloads) with sizes;
                    with ids, --kind or --all, delete exactly what they pick (--dry-run only prints it);
                    --choices prints a menu of common picks, each with the command that deletes it
  version           print the mr-cast and Node versions (also --version, -v)
  help [--all]      this message; --all adds every command and option

Used by the Claude Code skills:
  status            the branch's changes against its base, uncommitted files, and the last pace
  extract [base] [--working]
                    start a walkthrough of the branch's diff in .mr-cast/<branch> and print a hunk index;
                    --working diffs the merge base against uncommitted changes
  init --title text [--reset] [--quick]
                    start a walkthrough of an explanation in .mr-cast/<title-slug>; the same title reopens
                    it and keeps its storyboard unless --reset; --quick starts a quick video in
                    .mr-cast/quick-<title-slug> (it needs --title), which ends on the phrases "go deeper",
                    "the whole branch" and "save it"; a full video with no storyboard yet starts from the
                    quick one's scenes
  snippet <file>:<start>-<end> ...
                    add real source lines (at most 80 per snippet) to the run as code for scenes, ids s1, s2, ...
  plan [--port N] [--no-open]
                    check the run's plan.json and open the page where the user picks each topic's depth
                    and view; the picks are written back into plan.json
  schema [type|all] print the storyboard's TypeScript schema: with a scene type, such as array, that scene's
                    fields and every type they use; with none, the storyboard and what every scene shares
  validate          check the run's storyboard.json (and its topics against plan.json)
  outline           print a short plan of the storyboard to show before rendering
  play [--port N] [--no-open]
                    serve the live player (default port 4747), voice the narration, then open the browser;
                    the URL is printed at once, and its page waits for the voice
  render [--out file.mp4]
                    voice the narration and render an MP4 with chapter markers, named after the storyboard title

  extract and init make their run the current one, and the commands after them work on the current run.
  extract, init, plan, validate, outline, voice, play, render and still take these flags. A flag applies to its own command
  only, and a command without it uses the default, so pass the same flags to each command:
      --audience preread                 a pre-read: no code on screen, ending on the order to read the code in
      --pace slower|normal|faster        the voice's speed and the pauses around it (default normal)
      --voice name                       the Kokoro voice (default af_heart)
      --no-voice                         silent, with subtitles timed for reading`;

const USAGE_ALL = `${USAGE}

More commands and options:
  voice             voice the narration into the run's audio/ without playing it
  still [sceneIndex...] [--out dir]
                    render PNG stills of scenes (0-based; default all, into the run's stills/)
  steps [sceneIndex...]
                    print each step's words beside what it lights and what it changes, with the
                    highlight warnings, for checking that the lit part matches the words; code scenes are left out
  --speed x         the voice's speed alone, from 0.5 to 2; overrides the speed --pace sets
  --name slug       extract and init: name the run yourself; later commands: use that run instead of the current one
  --dir path        any command after extract or init: use any data directory, such as .mr-cast or
                    .mr-cast/explain/<name> from mr-cast 0.11 and earlier
  extract --context N     context lines per hunk (default 4)
  extract --max-lines N   changed lines shown per hunk in the index (default 14)
  extract --all-files     include lockfiles, minified and build output
  validate --read-only    check only: write no review.md, reading.md or plan picks, and remember no choice
  validate and outline estimate the length at the --pace given until the narration is voiced at it.`;

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

function readJson(file, missingHint, parse = JSON.parse) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new UserError(`${rel(file)} not found; ${missingHint}`);
    throw err;
  }
  try {
    return parse(text);
  } catch (err) {
    const loc = locateJsonError(text);
    if (!loc) throw err;
    const lineText = text.split('\n')[loc.line - 1].trim().slice(0, 80);
    throw new UserError(`${rel(file)} is not valid JSON at line ${loc.line} column ${loc.column}: ${loc.reason} (line: ${lineText})`);
  }
}

const DIR_OPTION = { dir: { type: 'string' }, name: { type: 'string' } };

const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/**
 * The voiceover that times a command: voiceover.json's clips in the command's voice and at its pace. Clips
 * voiced in another voice or at another speed match nothing, so their texts are estimated until they are
 * voiced again. A silent command has no clips.
 */
function timingVoiceover(dir, settings) {
  const saved = readVoiceover(dir);
  const { speed, pauses } = settings.pace;
  if (!saved && speed === 1 && pauses === 1) return null;
  return { voice: settings.voice, speed, pauses, clips: settings.silent ? {} : saved?.clips ?? {} };
}

/** The run checked and its storyboard normalized. Unless `write` is false, review.md and reading.md are written or removed to match it. */
async function loadProject(dir, settings, { write = true } = {}) {
  const hunks = readJson(path.join(dir, 'hunks.json'), 'run `mr-cast extract` or `mr-cast init` first');
  const raw = readJson(path.join(dir, 'storyboard.json'), 'write it first (schema: Storyboard in src/types.ts)', parseStoryboard);
  const plan = readPlan(dir, { preread: settings.audience === 'preread' });
  // meta.json's mode is "explain" when `mr-cast init` made the run; anything else holds a diff.
  const meta = readRunMeta(dir);
  const mode = meta?.mode === 'explain' ? 'explain' : 'diff';
  const result = await validateStoryboard(raw, hunks, { mode, audience: settings.audience, plan });
  // Past validation, older field names are rewritten once, so everything downstream sees one shape.
  const storyboard = result.errors.length ? raw : normalizeStoryboard(raw, hunks);
  const seconds = result.errors.length ? 0 : storyboardSeconds(storyboard, timingVoiceover(dir, settings));
  const review = result.errors.length || !write ? null : writeReview(path.join(dir, 'review.md'), storyboard, meta);
  const reading = result.errors.length || !write ? null : writeReading(path.join(dir, 'reading.md'), storyboard, hunks, plan?.plan, meta, settings);
  return { dir, hunks, raw, storyboard, plan, result, review, reading, lines: formatValidation(result, { storyboard, hunks, seconds }) };
}

/** Whether `file` is absent or a file mr-cast wrote under `heading`, so mr-cast may replace or remove it. */
function ownFile(file, heading) {
  try {
    return fs.readFileSync(file, 'utf8').startsWith(heading);
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

/**
 * review.md, the findings of a reviewed storyboard as file:line bullets, so they can be acted on. A storyboard
 * without findings has none, so one mr-cast wrote earlier is removed. A file of the same name that mr-cast did
 * not write is left alone. Returns the file written, or null.
 */
function writeReview(file, storyboard, meta) {
  if (!ownFile(file, REVIEW_HEADING)) {
    if (isReviewed(storyboard)) console.error(`mr-cast: warning: kept ${rel(file)}, which mr-cast did not write; the review is not saved`);
    return null;
  }
  if (!isReviewed(storyboard)) {
    fs.rmSync(file, { force: true });
    return null;
  }
  fs.writeFileSync(file, reviewMarkdown(storyboard, { branch: meta?.branch, base: meta?.base }));
  return file;
}

/**
 * reading.md, a pre-read's reading order as a checklist to follow in the editor and paste into the merge request.
 * Like review.md: removed when the run is not a pre-read or the storyboard has no reading scene, and never written
 * over a file mr-cast did not write. Returns the file written, or null.
 */
function writeReading(file, storyboard, hunks, plan, meta, settings) {
  const order = settings.audience === 'preread' ? readingOrder(storyboard, hunks, plan) : null;
  if (!ownFile(file, READING_HEADING)) {
    if (order) console.error(`mr-cast: warning: kept ${rel(file)}, which mr-cast did not write; the reading order is not saved`);
    return null;
  }
  if (!order) {
    fs.rmSync(file, { force: true });
    return null;
  }
  fs.writeFileSync(file, readingMarkdown(storyboard, order, { branch: meta?.branch, base: meta?.base }));
  return file;
}

/** Validate, print problems to stderr, and stop on errors. */
async function loadValidProject(dir, settings) {
  const project = await loadProject(dir, settings);
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
      ...SETTINGS_OPTIONS,
      name: DIR_OPTION.name,
    },
  });
  if (positionals.length > 1) throw new UserError(`extract takes at most one base, got: ${positionals.join(' ')}`);
  const context = intOption(values.context, 'context', 0);
  const maxLines = intOption(values['max-lines'], 'max-lines', 1);
  settingsFrom(values); // rejects a bad flag before anything is written

  const root = repoRoot();
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

  const runs = dataDir(root);
  const { dir, name } = branchRun(runs, values, diff.branch);
  const nameArg = values.name ? ` --name ${name}` : '';
  // The commands it suggests take the same settings flags, which apply to one command only.
  const runArgs = nameArg + settingsArgs(values);
  const hunks = buildHunkIndex(parsed);
  const files = summarizeFiles(parsed, hunks);
  const hunksPath = path.join(dir, 'hunks.json');
  const storyboardPath = path.join(dir, 'storyboard.json');

  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(hunksPath, 'utf8')); } catch { /* first run or unreadable */ }
  // Snippets (`mr-cast snippet`) are context the author added beside the diff, so a new diff keeps them.
  const snippets = Object.values(previous ?? {}).filter((h) => h?.status === 'source' && typeof h.id === 'string');

  const written = { ...hunks, ...Object.fromEntries(snippets.map((h) => [h.id, h])) };
  fs.mkdirSync(dir, { recursive: true });
  // The audience of the run's latest start, for the hook; a plain video when no flag names one.
  const { audience } = settingsFrom(values);
  writeJson(hunksPath, written);
  writeJson(path.join(dir, 'meta.json'), {
    mode: 'diff', base, baseSha: diff.baseSha, mergeBase: diff.mergeBase,
    head: 'HEAD', headSha: diff.headSha, branch: diff.branch,
    working: values.working, generatedAt: new Date().toISOString(),
    files, skipped: diff.skipped,
    audience,
  });
  writeCurrent(runs, name);
  rememberChoices(values);

  console.error(`mr-cast: run "${name}" in ${rel(dir)}; later commands use it until the next extract or init`);
  if (snippets.length) console.error(`note: kept ${snippets.length} snippet${snippets.length === 1 ? '' : 's'} (${snippets.map((h) => h.id).join(', ')}) from the last extract; rerun \`mr-cast snippet${nameArg}\` on one to reread its lines`);
  if (fs.existsSync(storyboardPath)) {
    const changed = previous ? changedHunkIds(previous, written) : null;
    if (!changed) console.error(`note: kept existing ${rel(storyboardPath)}; hunk ids may have changed, run \`mr-cast validate${runArgs}\``);
    else if (changed.length) console.error(`note: kept existing ${rel(storyboardPath)}; hunks changed or gone since last extract: ${changed.join(', ')}; re-check scenes using them, then \`mr-cast validate${runArgs}\``);
  }

  console.log(formatIndex({
    ctx: { branch: diff.branch, base, ahead: diff.ahead, working: values.working, mergeBase: diff.mergeBase, untracked: diff.untracked },
    files, hunks, skipped: diff.skipped, maxLines,
    hunksPath: rel(hunksPath), storyboardPath: rel(storyboardPath), runArgs,
  }));
}

/**
 * The run a command after extract or init works on, and the settings its flags ask for. The pace they choose is
 * remembered for the user's next video, and the audience in the run's meta.json for the hook.
 */
function runFor(values) {
  const settings = settingsFrom(values);
  rememberChoices(values);
  const run = currentRun(values);
  recordAudience(run.dir, settings.audience);
  return { ...run, settings };
}

const RUN_OPTIONS = { ...SETTINGS_OPTIONS, ...DIR_OPTION };

async function validate(argv) {
  const { values } = parseArgs({ args: argv, options: { ...RUN_OPTIONS, 'read-only': { type: 'boolean', default: false } } });
  // --read-only, for the hook: check the run and write nothing, not even the remembered choices.
  const write = !values['read-only'];
  const { dir, settings } = write ? runFor(values) : { ...currentRun(values), settings: settingsFrom(values) };
  const { result, lines, review, reading, plan, storyboard } = await loadProject(dir, settings, { write });
  // The plan page marks each topic whose pick differs from the one the storyboard says it was written from.
  if (write && !result.errors.length && plan) recordBuilt(dir, plan.plan, storyboard.plan);
  // The verdict stays the last line.
  for (const line of lines.slice(0, -1)) console.log(line);
  if (review) console.log(`wrote ${rel(review)}`);
  if (reading) console.log(`wrote ${rel(reading)}`);
  console.log(lines.at(-1));
  if (result.errors.length) process.exit(1);
}

/** "slower", "normal", "faster", or "0.9x, pauses x1.2". */
function paceName(voiceover) {
  const { speed, pauses } = paceOf(voiceover);
  const named = Object.entries(PACES).find(([, p]) => p.speed === speed && p.pauses === pauses)?.[0];
  return named ?? `${speed}x${pauses === 1 ? '' : `, pauses x${pauses}`}`;
}

/** " · slower pace", " · 0.9x, pauses x1.2", or "" at the normal pace. */
function formatPace(voiceover) {
  const name = paceName(voiceover);
  if (name === 'normal') return '';
  return Object.hasOwn(PACES, name) ? ` · ${name} pace` : ` · ${name}`;
}

/** Say which pace play and render use when it is not the normal one. */
function reportPace(voiceover) {
  const name = paceName(voiceover);
  if (name !== 'normal') console.error(`mr-cast: pace: ${name}`);
}

function reportVoiceProgress(event) {
  if (event.type === 'download') console.error(`mr-cast: downloading the Kokoro voice model (about 90 MB, first run only) into ${event.cacheDir}`);
  else if (event.type === 'clip') {
    const text = event.text.length > 60 ? `${event.text.slice(0, 57)}...` : event.text;
    console.error(`  voiced ${event.done}/${event.total} · ${event.seconds.toFixed(1)}s · ${text}`);
  }
}

/**
 * Voice-over for play and render, in the command's voice and at its pace. A silent command, or one whose
 * voicing fails, has silent scenes timed from word count at that pace; `failed` marks the second for the player.
 */
async function voiceoverFor(dir, storyboard, settings, { onProgress = reportVoiceProgress, ensure = ensureVoiceover, markFailed = false } = {}) {
  const silent = () => {
    const { speed, pauses } = settings.pace;
    return speed === 1 && pauses === 1 ? null : { voice: settings.voice, speed, pauses, clips: {} };
  };
  if (settings.silent) return silent();
  try {
    return await ensure({ dataDir: dir, storyboard, voice: settings.voice, pace: settings.pace, onProgress });
  } catch (err) {
    console.error(`mr-cast: warning: continuing without voice-over: ${err.message}`);
    const { speed, pauses } = settings.pace;
    return markFailed ? { voice: settings.voice, speed, pauses, clips: {}, failed: true } : silent();
  }
}

async function voice(argv) {
  const { values } = parseArgs({ args: argv, options: RUN_OPTIONS });
  const run = runFor(values);
  const { dir, storyboard } = await loadValidProject(run.dir, run.settings);
  if (run.settings.silent) {
    console.log('✓ no voice-over · --no-voice is silent');
    return;
  }
  let generated = 0;
  const voiceover = await ensureVoiceover({
    dataDir: dir, storyboard, voice: run.settings.voice, pace: run.settings.pace,
    onProgress: (event) => {
      if (event.type === 'clip') generated++;
      reportVoiceProgress(event);
    },
  });
  const clips = new Set(storyboard.scenes.flatMap(spokenTexts).flatMap((text) => clipFor(voiceover, text)?.src ?? [])).size;
  console.log(`✓ voiceover · ${clips} clip${clips === 1 ? '' : 's'} (${generated} new)${formatPace(voiceover)} · ${formatDuration(storyboardSeconds(storyboard, voiceover))}`);
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
  if (!fs.existsSync(vite)) throw new UserError(`player not built and ${rel(vite)} is missing; run \`pnpm install\` in ${ROOT}`);
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

/**
 * The voice-over a storyboard can play with now: the clips already on disk for its texts in the command's voice and
 * at its pace. `wait` when some text still lacks a clip.
 */
async function voiceNow(dir, storyboard, settings) {
  if (settings.silent) return { voiceover: await voiceoverFor(dir, storyboard, settings), wait: false };
  const { speed, pauses } = settings.pace;
  const clips = Object.fromEntries(Object.entries(readVoiceover(dir)?.clips ?? {}).filter(([, clip]) => fs.existsSync(path.join(dir, clip.src))));
  const voiceover = { voice: settings.voice, speed, pauses, clips };
  return { voiceover, wait: storyboard.scenes.some((scene) => spokenTexts(scene).some((text) => !clipFor(voiceover, text))) };
}

/** "4 of 17 lines": the spoken lines that have a clip. */
const voicedCount = (storyboard, voiceover) => {
  const { done, total } = voicedLines(storyboard, voiceover);
  return `${done} of ${plural(total, 'line')}`;
};

/**
 * One terminal line that says how far the voicing is, rewritten in place on a terminal. `log` prints a line above it,
 * so other output does not land in the middle of it.
 */
function voicingLine(storyboard, voiced) {
  const tty = process.stderr.isTTY;
  const text = (voiceover) => `Voicing ${voicedCount(storyboard, voiceover)}... (--no-voice skips the voice)`;
  let last = '';
  let open = false;
  const show = (line) => {
    if (line === last) return;
    last = line;
    if (!tty) return console.error(line);
    process.stderr.write(`\r\x1b[K${line}`);
    open = true;
  };
  const end = () => {
    if (open) process.stderr.write('\n');
    open = false;
  };
  const log = (print) => {
    if (!tty) return print();
    end();
    print();
    const again = last;
    last = '';
    show(again);
  };
  show(text(voiced));
  return {
    onProgress(event) {
      if (event.type === 'clip') return show(text(event.voiceover));
      log(() => reportVoiceProgress(event));
    },
    log: (msg) => log(() => console.error(msg)),
    end,
  };
}

/**
 * Serves the player once the voice is ready. The server starts first, so the URL is printed at once, and the browser
 * opens once every scene is voiced: a page opened before that waits for the voice instead of playing silent. An edit
 * keeps the open page on its version, with its voice, until the edit is voiced, then reloads it once.
 */
async function play(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: 'string', default: '4747' }, 'no-open': { type: 'boolean', default: false }, ...RUN_OPTIONS },
  });
  const port = intOption(values.port, 'port', 1);
  const { settings, ...run } = runFor(values);
  const { dir, raw, storyboard } = await loadValidProject(run.dir, settings);
  const distDir = ensureDist();

  let server = null;
  let stopped = false;
  // The voicing line on screen, which the other output of play prints above.
  let line = null;
  const log = (msg) => (line ? line.log(msg) : console.error(msg));
  const serving = await createServing({
    raw,
    storyboard,
    now: (sb) => voiceNow(dir, sb, settings),
    voice: async (sb, voiced, signal) => {
      const own = voicingLine(sb, voiced);
      line = own;
      const ensure = (args) => ensureVoiceoverInChild({ ...args, signal }).finally(() => {
        own.end();
        if (line === own) line = null;
      });
      const voiceover = await voiceoverFor(dir, sb, settings, { onProgress: own.onProgress, ensure, markFailed: true });
      if (voiceover?.failed) console.error('mr-cast: voicing failed; the player plays silent with subtitles');
      else if (voiceover) console.error(`voice ready: ${voicedCount(sb, voiceover)}`);
      return voiceover;
    },
    reload: () => server?.reload(),
  });

  // An edit still being voiced reloads the page once it is voiced, with every change made meanwhile: the server asks
  // serving.holding() after each batch.
  const onDataChange = async (file) => {
    if (file === 'meta.json' || file === BUILT_FILE) return;
    let project;
    try {
      project = await loadProject(dir, settings);
    } catch (err) {
      log(`mr-cast: ${file} changed · ${err.message}`);
      return;
    }
    log(`mr-cast: ${file} changed`);
    for (const l of project.lines) log(`  ${l}`);
    if (file !== 'storyboard.json' || project.result.errors.length) return;
    await serving.edit(project.raw, project.storyboard);
  };

  reportPace(serving.voiceover());
  server = await startServer({
    distDir, dataDir: dir, port, onDataChange, holding: serving.holding, getVoiceover: serving.voiceover, getStoryboard: serving.storyboard, audience: settings.audience,
  });
  const url = `${server.url}/#token=${server.token}`;
  console.log(`mr-cast player: ${url}`);

  // Once Kokoro has loaded, process.exit() aborts in onnxruntime's thread pool ("mutex lock failed"),
  // so stop everything holding the event loop and let Node exit on its own.
  const shutdown = () => {
    stopped = true;
    stopVoicing();
    return server.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  serving.start();
  await serving.ready;
  if (!stopped && !values['no-open']) openBrowser(url);
}

/** plan.json's problems as lines, and a summary line when it has no errors. */
function planLines(planFile) {
  const lines = [...planFile.errors.map((e) => `✗ plan.json: ${e}`), ...planFile.warnings.map((w) => `! plan.json: ${w}`)];
  if (!planFile.errors.length) lines.push(`✓ plan ok · ${plural(planFile.plan.topics.length, 'topic')} · ${formatLength(planSeconds(planFile.plan)).toLowerCase()}`);
  return lines;
}

/** Serves the plan page, where the user picks each topic's depth and view before the storyboard is written. */
async function plan(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: 'string', default: '4747' }, 'no-open': { type: 'boolean', default: false }, ...RUN_OPTIONS },
  });
  const port = intOption(values.port, 'port', 1);
  const { dir, settings } = runFor(values);
  const preread = settings.audience === 'preread';
  const planFile = readPlan(dir, { preread });
  if (!planFile) throw new UserError(`${rel(path.join(dir, 'plan.json'))} not found; write it first (schema: Plan in src/types.ts)`);
  const lines = planLines(planFile);
  if (planFile.errors.length) {
    for (const line of lines) console.error(line);
    process.exit(1);
  }
  for (const line of lines) console.error(line);
  const distDir = ensureDist();

  const onDataChange = (file) => {
    if (file !== 'plan.json') return;
    const changed = readPlan(dir, { preread });
    if (!changed) return console.error('mr-cast: plan.json was removed; the page waits for it');
    console.error('mr-cast: plan.json changed');
    for (const line of planLines(changed)) console.error(`  ${line}`);
  };
  const server = await startServer({ distDir, dataDir: dir, port, onDataChange, getVoiceover: () => timingVoiceover(dir, settings), audience: settings.audience });
  const url = `${server.url}/plan#token=${server.token}`;
  console.log(`mr-cast plan: ${url}`);
  if (!values['no-open']) openBrowser(url);
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

async function render(argv) {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' }, ...RUN_OPTIONS } });
  const run = runFor(values);
  const { dir, hunks, storyboard, plan: planFile } = await loadValidProject(run.dir, run.settings);
  const voiceover = await voiceoverFor(dir, storyboard, run.settings);
  reportPace(voiceover);
  const { renderVideo } = await importRender();
  const outFile = path.resolve(values.out ?? path.join(dir, videoName(storyboard, run)));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const progress = progressReporter('rendering');
  const written = await renderVideo({ hunks, storyboard, voiceover, dataDir: dir, outFile, onProgress: progress.update });
  progress.done();
  const video = written ?? outFile;
  // review.md and reading.md are in the run's directory; a video saved elsewhere gets its own copies beside it.
  const elsewhere = path.dirname(path.resolve(video)) !== path.resolve(dir);
  const review = elsewhere ? writeReview(video.replace(/\.[^./]+$/, '.review.md'), storyboard, readRunMeta(dir)) : null;
  const reading = elsewhere ? writeReading(video.replace(/\.[^./]+$/, '.reading.md'), storyboard, hunks, planFile?.plan, readRunMeta(dir), run.settings) : null;
  console.log(video);
  if (review) console.log(review);
  if (reading) console.log(reading);
}

async function still(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: 'string' }, ...RUN_OPTIONS } });
  const run = runFor(values);
  const { dir, hunks, storyboard } = await loadValidProject(run.dir, run.settings);
  const count = storyboard.scenes.length;
  const scenes = positionals.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n >= count) throw new UserError(`scene index "${p}" out of range; storyboard has scenes 0-${count - 1}`);
    return n;
  });
  const { renderStills } = await importRender();
  const outDir = path.resolve(values.out ?? path.join(dir, 'stills'));
  fs.mkdirSync(outDir, { recursive: true });
  const voiceover = timingVoiceover(dir, run.settings);
  const files = await renderStills({ hunks, storyboard, voiceover, outDir, scenes: scenes.length ? scenes : undefined });
  for (const f of files) console.log(path.resolve(f));
}

async function steps(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: RUN_OPTIONS });
  const run = runFor(values);
  // Only errors stop it: the highlight warnings print beside their steps, and the rest are validate's to show.
  const { hunks, storyboard, result, lines } = await loadProject(run.dir, run.settings);
  if (result.errors.length) {
    for (const line of lines) console.error(line);
    process.exit(1);
  }
  const scenes = positionals.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n >= storyboard.scenes.length) throw new UserError(`scene index "${p}" out of range; storyboard has scenes 0-${storyboard.scenes.length - 1}`);
    return n;
  });
  console.log(formatSteps(storyboard, hunks, scenes) || 'no scene other than code has steps');
}

async function outline(argv) {
  const { values } = parseArgs({ args: argv, options: RUN_OPTIONS });
  const run = runFor(values);
  const { dir, hunks, storyboard, result, plan: planFile } = await loadValidProject(run.dir, run.settings);
  const voiceover = timingVoiceover(dir, run.settings);
  const voiced = Boolean(voiceover) && storyboard.scenes.every((s) => spokenTexts(s).every((text) => clipFor(voiceover, text)));
  const seconds = storyboardSeconds(storyboard, voiceover);
  console.log(formatOutline({ storyboard, hunks, coverage: result.coverage, seconds, voiced, pace: formatPace(voiceover), plan: planFile?.plan }));
}

/**
 * A Claude Code PostToolUse hook (the mr-cast skill's frontmatter): after a write to a run's storyboard.json, it
 * checks the file and exits 2 with the errors, which Claude sees. Other files pass at once. It
 * validates with the audience the run's commands were last given (meta.json), and writes nothing.
 */
function hook() {
  let file;
  try {
    file = JSON.parse(fs.readFileSync(0, 'utf8'))?.tool_input?.file_path;
  } catch {
    return;
  }
  if (path.basename(file ?? '') !== 'storyboard.json') return;
  const dir = path.dirname(file);
  if (path.basename(path.dirname(dir)) !== '.mr-cast' || !readRunMeta(dir)) return;
  const { audience } = readRunMeta(dir);
  const flags = ['--read-only', ...(audience ? ['--audience', audience] : [])];
  const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'validate', '--dir', dir, ...flags], { encoding: 'utf8', env: { ...process.env, MR_CAST_NO_UPDATE_CHECK: '1' } });
  if (run.status === 0) return;
  const lines = `${run.stdout}\n${run.stderr}`.split('\n').filter((l) => /^(error|✗|mr-cast:|hint:)/.test(l.trim()));
  console.error(`mr-cast validate ${flags.join(' ')} on ${rel(file)}:\n${lines.length ? lines.join('\n') : run.stderr.trim()}`);
  process.exit(2);
}

function schema(argv) {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} });
  if (positionals.length > 1) throw new UserError(`schema takes at most one type, got: ${positionals.join(' ')}`);
  console.log(formatSchema(ROOT, positionals[0]));
}

function installSkillCommand(argv) {
  parseArgs({ args: argv, options: {} });
  const { written, removed, kept } = installSkill(ROOT);
  for (const file of written) console.log(`wrote ${file}`);
  for (const file of removed) console.log(`removed ${file} (installed by an earlier mr-cast, no longer used)`);
  for (const file of kept) console.error(`note: kept ${file}; an earlier mr-cast installed this path but its content is not mr-cast's`);
}

function uninstallSkillCommand(argv) {
  parseArgs({ args: argv, options: {} });
  const { removed, kept } = uninstallSkill();
  for (const file of removed) console.log(`removed ${file}`);
  for (const file of kept) console.error(`note: kept ${file}; mr-cast installed this path but its content is not mr-cast's`);
  if (removed.length === 0) console.log('nothing to remove; no mr-cast skills are installed');
}

async function upgradeCommand(argv) {
  const { values } = parseArgs({ args: argv, options: { check: { type: 'boolean', default: false } } });
  await upgrade({ root: ROOT, version: VERSION, check: values.check });
}

/**
 * The quick video of `title` that a new full video of it starts from: its storyboard, snippets and voice, so only
 * the scenes it adds need voicing. Null when there is none.
 */
function quickRunOf(runs, title) {
  if (title === undefined) return null;
  const dir = path.join(runs, explanationSlug(title, true));
  const meta = readRunMeta(dir);
  return meta?.quick === true && meta.title === title && fs.existsSync(path.join(dir, 'storyboard.json')) ? dir : null;
}

/** Starts or reopens the run of an explanation, which has no diff: its code comes from `snippet`. */
function init(argv) {
  const { values } = parseArgs({ args: argv, options: { name: DIR_OPTION.name, ...SETTINGS_OPTIONS, title: { type: 'string' }, reset: { type: 'boolean', default: false }, quick: { type: 'boolean', default: false } } });
  settingsFrom(values); // rejects a bad flag before anything is written
  // Without a title, init reopens the current run, which may be a full video that --quick must not turn quick.
  if (values.quick && values.title === undefined) throw new UserError('init --quick needs --title, such as --title "limiter.ts lines 40 to 72"');
  const repo = findRepoRoot();
  if (repo) ensureExcluded(repo);
  const runs = runsRoot();
  const { dir, name } = explanationRun(runs, values);
  const existing = readRunMeta(dir);
  if (values.quick && existing && !existing.quick) throw new UserError(`.mr-cast/${name} holds a full video, which --quick would not make quick; pass another --name, or leave --name out`);
  const files = { hunks: path.join(dir, 'hunks.json'), storyboard: path.join(dir, 'storyboard.json'), meta: path.join(dir, 'meta.json') };
  if (values.reset) for (const file of Object.values(files)) fs.rmSync(file, { force: true });

  const previous = readRunMeta(dir) ?? {};
  // A full run starts from its quick video only while it is empty, and not when the user asked to start it over.
  const empty = !fs.existsSync(files.storyboard) && !Object.keys(fs.existsSync(files.hunks) ? readJson(files.hunks, '') : {}).length;
  const quickSource = values.quick || values.reset || !empty ? null : quickRunOf(runs, values.title);
  fs.mkdirSync(dir, { recursive: true });
  if (quickSource) {
    for (const file of ['hunks.json', 'storyboard.json', 'voiceover.json', 'audio']) {
      const from = path.join(quickSource, file);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, file), { recursive: true });
    }
  }
  if (!fs.existsSync(files.hunks)) writeJson(files.hunks, {});
  const { audience } = settingsFrom(values);
  writeJson(files.meta, {
    mode: 'explain',
    title: values.title ?? previous.title ?? null,
    createdAt: previous.createdAt ?? new Date().toISOString(),
    ...(values.quick || previous.quick ? { quick: true } : {}),
    audience,
  });
  writeCurrent(runs, name);
  rememberChoices(values);

  console.log(dir);
  console.error(`mr-cast: run "${name}" in ${rel(dir)}; later commands use it until the next extract or init`);
  const snippets = Object.keys(readJson(files.hunks, '')).length;
  let kept = null;
  try { kept = JSON.parse(fs.readFileSync(files.storyboard, 'utf8')).title ?? '(untitled)'; } catch { /* none yet */ }
  if (quickSource) console.error(`note: started from the quick video in ${rel(quickSource)}: its storyboard, ${plural(snippets, 'snippet')} and voice clips; add the scenes the full video needs`);
  else if (kept !== null) console.error(`note: kept existing storyboard "${kept}" and ${snippets} snippet${snippets === 1 ? '' : 's'}; pass --reset to start it over, or a new --title for another explanation`);
  else if (snippets) console.error(`note: kept ${snippets} existing snippet${snippets === 1 ? '' : 's'}; pass --reset to start over`);
  console.error(`next: \`mr-cast snippet <file>:<start>-<end>\` for code to show, write ${rel(files.storyboard)}, then \`mr-cast validate${settingsArgs(values)}\``);
}

/** Adds snippets of unchanged source to a run's hunks.json: the code of an explanation, or context beside a diff. */
function snippet(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: DIR_OPTION });
  const { dir } = currentRun(values);
  const runArg = values.name ? ` --name ${values.name}` : values.dir ? ` --dir ${values.dir}` : '';
  const hunksPath = path.join(dir, 'hunks.json');
  const hunks = readJson(hunksPath, 'run `mr-cast extract` or `mr-cast init` first');
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
  console.log(formatSnippets({
    added, hunks, hunksPath: rel(hunksPath), storyboardPath: rel(path.join(dir, 'storyboard.json')),
    validateCommand: `mr-cast validate${runArg}`,
  }));
}

/** 0.11's `explain <command>`, kept for skills an open session loaded before an upgrade: init, or any command on the current run. */
const EXPLAIN_COMMANDS = { init, snippet, validate, outline, voice, play, render, still, steps };

async function explain([sub, ...rest]) {
  const run = EXPLAIN_COMMANDS[sub];
  if (!run) throw new UserError(`unknown command "explain${sub ? ` ${sub}` : ''}"; \`mr-cast init\` starts an explanation and the other commands work on it, see \`mr-cast help\``);
  await run(rest);
}

const STATUS_FILES = 25;

/** "  src/limiter.ts +20 −3" per file, at most STATUS_FILES of them. */
const fileLines = (files) => [
  ...files.slice(0, STATUS_FILES).map((f) => `  ${f.file} +${f.additions} −${f.deletions}`),
  ...(files.length > STATUS_FILES ? [`  … ${files.length - STATUS_FILES} more`] : []),
];

/** What the skill decides the video's source from: the branch's changes, and the user's last choices. */
function status(argv) {
  parseArgs({ args: argv, options: {} });
  const root = findRepoRoot();
  const out = [];
  if (!root) out.push('branch: none (not in a git repository), so only an explanation can be animated');
  else {
    const s = branchStatus(root);
    const ahead = !s.base ? 'no base branch found; pass one to `mr-cast extract <base>`'
      : s.ahead ? `${plural(s.ahead, 'commit')} and ${plural(s.files.length, 'file')} ahead of ${s.base}`
      : `nothing ahead of ${s.base}`;
    out.push(`branch: ${s.branch} · ${ahead}`, ...fileLines(s.files));
    const parts = [s.working.length && `${plural(s.working.length, 'changed file')} (\`extract --working\` includes them)`, s.untracked && plural(s.untracked, 'untracked file')].filter(Boolean);
    out.push(`working tree: ${parts.length ? parts.join(', ') : 'clean'}`, ...fileLines(s.working));
  }
  const last = lastChoices();
  out.push(`last pace: ${last.pace ?? 'none yet'}`);
  console.log(out.join('\n'));
}

function parseKinds(values) {
  if (!values) return null;
  const kinds = values.flatMap((v) => v.split(',')).map((k) => k.trim()).filter(Boolean);
  const unknown = kinds.filter((k) => !KINDS.includes(k));
  if (unknown.length) throw new UserError(`unknown --kind ${unknown.join(', ')}; kinds are ${KINDS.join(', ')}`);
  return [...new Set(kinds)];
}

async function prune(argv) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      'older-than': { type: 'string' }, kind: { type: 'string', multiple: true }, all: { type: 'boolean', default: false },
      except: { type: 'string', multiple: true }, 'dry-run': { type: 'boolean', default: false },
      choices: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
    },
  });
  const dataRoot = dataDir(findRepoRoot() ?? process.cwd());
  const olderThanDays = values['older-than'] === undefined ? null : intOption(values['older-than'], 'older-than', 0);
  const selector = { ids: positionals, kinds: parseKinds(values.kind), all: values.all, except: values.except ?? [], olderThanDays };
  const selecting = selector.ids.length > 0 || selector.kinds !== null || selector.all;
  const print = (json, lines) => (values.json ? console.log(JSON.stringify(json, null, 2)) : lines.forEach((l) => console.log(l)));
  const listing = listArtifacts(dataRoot);
  if (values.choices) {
    if (selecting || olderThanDays !== null || selector.except.length || values['dry-run']) throw new UserError('--choices takes only --json');
    const choices = pruneChoices(listing);
    print(choices, formatChoices(choices));
    return;
  }
  if (!selecting) {
    if (selector.except.length || values['dry-run']) throw new UserError('--except and --dry-run need ids, --kind or --all');
    const shown = olderThan(listing, olderThanDays);
    print(listingJson(shown, dataRoot), formatListing(shown));
    return;
  }
  const { chosen, inUse } = select(listing, selector, { listCommand: `mr-cast prune${olderThanDays === null ? '' : ` --older-than ${olderThanDays}`}` });
  const dryRun = values['dry-run'];
  const { removed, skipped } = dryRun ? { removed: removalPlan(chosen), skipped: [] } : await pruneArtifacts(chosen, dataRoot);
  const verb = dryRun ? 'would remove' : 'removed';
  const freed = removed.reduce((n, r) => n + r.bytes, 0);
  print({
    dryRun,
    artifacts: removed.map(({ artifact: a, bytes, with: outer }) => ({ id: a.id, kind: a.kind, path: a.path, bytes, with: outer })),
    inUse: inUse.map((a) => ({ id: a.id, busy: a.busy })),
    skipped: skipped.map(({ artifact, reason }) => ({ id: artifact.id, reason })),
    bytes: freed,
  }, [
    ...(removed.length ? [] : ['nothing matched']),
    ...removed.map(({ artifact, bytes, with: outer }) => (outer ? `${verb} ${artifact.id} (with ${outer})` : `${verb} ${artifact.id} · ${formatBytes(bytes)} · ${rel(artifact.path)}`)),
    ...inUse.map((a) => `in use, not removed: ${a.id} · ${a.busy}`),
    `${dryRun ? 'would free' : 'freed'} ${formatBytes(freed)}`,
  ]);
  for (const { artifact, reason } of skipped) console.error(`mr-cast: kept ${artifact.id}: ${reason}`);
  if (skipped.length) process.exitCode = 1;
}

const COMMANDS = { hook, schema, status, extract, init, snippet, plan, validate, outline, voice, play, render, still, steps, explain, 'install-skill': installSkillCommand, 'uninstall-skill': uninstallSkillCommand, prune, upgrade: upgradeCommand };

function version() {
  console.log(`mr-cast ${VERSION} (node ${process.versions.node})`);
}

/** Never fails the command: a skill refresh that cannot write is retried on the next run. */
function refreshSkillsQuietly() {
  try {
    if (refreshSkills(ROOT, VERSION)) console.error(`mr-cast: updated Claude Code skills to ${VERSION}`);
  } catch { /* retried next run */ }
}

async function main([command, ...rest]) {
  if (command !== 'install-skill' && command !== 'uninstall-skill') refreshSkillsQuietly();
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(rest.includes('--all') ? USAGE_ALL : USAGE);
    return;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    version();
    return;
  }
  const run = COMMANDS[command];
  if (!run) {
    console.error(`mr-cast: unknown command "${command}"\n\n${USAGE}`);
    process.exit(1);
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(USAGE_ALL);
    return;
  }
  await run(rest);
}

const argv = process.argv.slice(2);
// Computed before the command runs and printed after it, on stderr, so stdout stays parseable.
const notice = argv[0] === 'upgrade' ? null : updateNotice(ROOT, VERSION);

main(argv).catch((err) => {
  if (process.env.MR_CAST_DEBUG === '1') console.error(err);
  else if (err instanceof UserError) console.error(`mr-cast: ${err.message}`);
  else if (err.code?.startsWith?.('ERR_PARSE_ARGS')) console.error(`mr-cast: ${err.message.split('. ')[0]}; see \`mr-cast help\``);
  else console.error(`mr-cast: ${err.message} (set MR_CAST_DEBUG=1 for details)`);
  process.exitCode = 1; // not process.exit(): see shutdown in play()
}).finally(() => {
  if (notice) console.error(notice);
});
