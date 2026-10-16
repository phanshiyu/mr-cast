// Installs the mr-cast, mr-cast-prune and mr-cast-upgrade skills into the Claude config dir, pointing at
// this install, and records them in a manifest so the next install or uninstall-skill removes whatever this
// version wrote that the next one no longer does. The storyboard schema is copied from src/types.ts so the
// skill cannot drift from the player.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
/** Text every file mr-cast writes contains: the CLI path (skills) or the path of its skill (older commands). */
const MARKERS = ['/bin/mr-cast', '/skills/mr-video/SKILL.md', '/skills/explain-in-animation/SKILL.md', '/skills/mr-cast-'];

const defaultClaudeDir = () => process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');

function storyboardTypes(root) {
  const types = fs.readFileSync(path.join(root, 'src/types.ts'), 'utf8');
  const start = types.search(/^export type Risk =/m);
  const end = types.indexOf('// ─── ', start);
  if (start < 0 || end < 0) throw new Error('src/types.ts: storyboard section markers not found');
  return types.slice(start, end).replace(/^export /gm, '').trim();
}

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
  const schema = storyboardTypes(root);
  const fill = (template) => fs
    .readFileSync(template, 'utf8')
    .replaceAll('{{MR_CAST}}', () => root)
    .replace('{{STORYBOARD_TYPES}}', () => schema);

  const skill = (name, file = 'SKILL.md') => [path.join(claudeDir, 'skills', name, file), fill(path.join(root, 'skill', name, file))];
  const targets = [
    // MR_CAST_SKILL_TEMPLATE swaps in a variant of the mr-cast skill's SKILL.md (quality/variant.sh).
    [path.join(claudeDir, 'skills/mr-cast/SKILL.md'), fill(process.env.MR_CAST_SKILL_TEMPLATE ?? path.join(root, 'skill/mr-cast/SKILL.md'))],
    skill('mr-cast', 'references/branch.md'),
    skill('mr-cast', 'references/explanation.md'),
    skill('mr-cast', 'references/review.md'),
    skill('mr-cast-prune'),
    skill('mr-cast-upgrade'),
  ];
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
