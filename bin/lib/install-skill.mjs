// Installs every skill under skill/ (mr-cast, mr-cast-prune and mr-cast-upgrade) into the Claude config dir,
// pointing at this install, and records them in a manifest so the next install or uninstall-skill removes whatever
// this version wrote that the next one no longer does. The plan's views are copied from shared/views.mjs, so the
// skill cannot drift from the player; the storyboard schema comes from `mr-cast schema`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VIEWS } from '../../shared/views.mjs';
import { formatSchema } from './schema.mjs';

const MANIFEST = '.mr-cast-install.json';
/** What versions before the manifest installed, relative to the Claude config dir. */
const LEGACY = [
  'skills/mr-video/SKILL.md',
  'skills/explain-in-animation/SKILL.md',
  'commands/mr-cast.md',
  'commands/mr-render.md',
  'commands/explain-in-animation.md',
  'skills/mr-cast-review/SKILL.md',
  'skills/mr-cast-explain/SKILL.md',
  'commands/mr-cast-render.md',
  'commands/mr-cast-explain-render.md',
];
/**
 * The line install-skill puts first in a file that names none of MARKERS. It names no path, because a reference
 * such as reader-test.md is pasted whole into a subagent's prompt.
 */
const MARK = '<!-- written by mr-cast install-skill -->';
/** Text every file mr-cast writes contains: the CLI path (skills), the path of its skill (older commands), or MARK. */
const MARKERS = ['/bin/mr-cast', '/skills/mr-video/SKILL.md', '/skills/explain-in-animation/SKILL.md', '/skills/mr-cast-', MARK];

const defaultClaudeDir = () => process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');

/** The plan's views as a Markdown table: the key plan.json names, what the user reads, and the scenes that draw it. */
const viewsTable = () => [
  '| View | The user reads | Scene |',
  '| --- | --- | --- |',
  ...Object.entries(VIEWS).map(([key, view]) => `| \`${key}\` | ${view.label} | ${view.scenes.map((t) => `\`${t}\``).join(', ')} |`),
].join('\n');

/** Sorts by skill, each skill's SKILL.md first and then its other files by path. */
const installOrder = (f) => {
  const [skill, ...rest] = f.split('/');
  return [skill, rest.join('/') === 'SKILL.md' ? '' : rest.join('/')];
};
const byInstallOrder = (a, b) => {
  const [x, y] = [installOrder(a), installOrder(b)];
  return x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1;
};

/**
 * Every Markdown file of every skill under skill/, as "<skill>/<path>": the skills are only Markdown, so an editor's
 * backup (SKILL.md~), a merge leftover (.orig) or a dotfile such as .DS_Store is never installed.
 */
const skillFiles = (root) => fs
  .readdirSync(path.join(root, 'skill'), { recursive: true })
  .map((f) => f.split(path.sep).join('/'))
  .filter((f) => f.includes('/') && f.endsWith('.md') && !/(^|\/)\./.test(f) && fs.statSync(path.join(root, 'skill', f)).isFile())
  .sort(byInstallOrder);

const fromMrCast = (file) => {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return MARKERS.some((m) => text.includes(m));
  } catch {
    return false;
  }
};

/** What earlier installs wrote: the manifest's files plus the pre-manifest names. */
function previousFiles(claudeDir) {
  const manifest = path.join(claudeDir, MANIFEST);
  let files = [];
  try {
    files = JSON.parse(fs.readFileSync(manifest, 'utf8')).files ?? [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`${manifest}: ${err.message}`);
  }
  return [...new Set([...files, ...LEGACY])];
}

/**
 * Deletes each file an earlier install wrote that is not in `keep` and whose content shows mr-cast wrote
 * it, then the directories it leaves empty inside its skill. Returns { removed, kept } absolute paths.
 */
function removeStale(claudeDir, keep) {
  const removed = [];
  const kept = [];
  const skills = path.resolve(claudeDir, 'skills');
  for (const rel of previousFiles(claudeDir)) {
    const file = path.resolve(claudeDir, rel);
    if (keep.has(rel) || !file.startsWith(path.resolve(claudeDir) + path.sep) || !fs.existsSync(file)) continue;
    if (!fromMrCast(file)) {
      kept.push(file);
      continue;
    }
    fs.rmSync(file);
    removed.push(file);
    for (let dir = path.dirname(file); dir.startsWith(skills + path.sep) && fs.readdirSync(dir).length === 0; dir = path.dirname(dir)) fs.rmdirSync(dir);
  }
  return { removed, kept };
}

function writeManifest(claudeDir, root, files) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const target = path.join(claudeDir, MANIFEST);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version, root: fs.realpathSync(root), files }, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

export function installSkill(root, claudeDir = defaultClaudeDir()) {
  const fill = (template) => fs
    .readFileSync(template, 'utf8')
    .replaceAll('{{MR_CAST}}', () => root)
    .replace('{{PLAN_VIEWS}}', viewsTable)
    // Templates before 0.24 carried the whole schema; quality/variant.sh still installs them for comparison.
    .replace('{{STORYBOARD_TYPES}}', () => formatSchema(root, 'all'));

  // MR_CAST_SKILL_TEMPLATE swaps in a variant of the mr-cast skill's SKILL.md (quality/variant.sh).
  const source = (rel) => (rel === 'mr-cast/SKILL.md' && process.env.MR_CAST_SKILL_TEMPLATE) || path.join(root, 'skill', rel);
  // A file is removed later only if it shows mr-cast wrote it, so one that never names the CLI gets a line that does.
  const marked = (text) => (MARKERS.some((m) => text.includes(m)) ? text : `${MARK}\n${text}`);
  const targets = skillFiles(root).map((rel) => [path.join(claudeDir, 'skills', rel), marked(fill(source(rel)))]);
  const files = targets.map(([file]) => path.relative(claudeDir, file).split(path.sep).join('/'));
  const stale = removeStale(claudeDir, new Set(files));
  for (const [file, content] of targets) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  writeManifest(claudeDir, root, files);
  return { written: targets.map(([file]) => file), ...stale };
}

/**
 * The install manifest when its skills point at the package in `root`, else null. A manifest from before
 * the root was recorded matches when the main skill it installed (mr-cast, or mr-cast-review before 0.12)
 * calls this package's CLI.
 */
function manifestFrom(root, claudeDir) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(claudeDir, MANIFEST), 'utf8'));
  } catch {
    return null;
  }
  const own = fs.realpathSync(root);
  if (manifest.root !== undefined) return manifest.root === own ? manifest : null;
  const main = ['skills/mr-cast/SKILL.md', 'skills/mr-cast-review/SKILL.md'];
  return main.some((file) => fromThisPackage(path.join(claudeDir, file), own)) ? manifest : null;
}

const fromThisPackage = (file, root) => {
  try {
    return fs.readFileSync(file, 'utf8').includes(`${root}/bin/mr-cast`);
  } catch {
    return false;
  }
};

/** Whether the installed skills point at the package in `root`. */
export const skillsInstalledFrom = (root, claudeDir = defaultClaudeDir()) => manifestFrom(root, claudeDir) !== null;

/**
 * Reinstalls the skills when this package installed them under another version, as after
 * `npm install -g` replaces it. Skills another copy of mr-cast installed, such as a clone, stay as they
 * are, so two copies never take turns rewriting them. Returns whether it reinstalled.
 */
export function refreshSkills(root, version, claudeDir = defaultClaudeDir()) {
  const manifest = manifestFrom(root, claudeDir);
  if (!manifest || manifest.version === version) return false;
  installSkill(root, claudeDir);
  return true;
}

/** Removes every file mr-cast installed, then the manifest. Returns { removed, kept } absolute paths. */
export function uninstallSkill(claudeDir = defaultClaudeDir()) {
  const result = removeStale(claudeDir, new Set());
  const manifest = path.join(claudeDir, MANIFEST);
  if (fs.existsSync(manifest)) {
    fs.rmSync(manifest);
    result.removed.push(manifest);
  }
  return result;
}
