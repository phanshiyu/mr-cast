// mr-cast upgrade: updates an `npm install -g` or `pnpm add -g` install in place and says how to update any other.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './errors.mjs';
import { skillsInstalledFrom } from './install-skill.mjs';
import { PACKAGE, compareVersions, fetchLatest, isGitClone, writeCache } from './update.mjs';

const exe = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);
/** The package managers whose global installs `mr-cast upgrade` can replace, tried in this order. */
const MANAGERS = [
  // npm installs a global package at <root -g>/<package>.
  { name: 'npm', cmd: exe('npm'), install: ['install', '-g', `${PACKAGE}@latest`], owns: (dir, real) => real === fs.realpathSync(path.join(dir, PACKAGE)) },
  // pnpm 11 and later give each global package its own <root -g>/<hash>/node_modules.
  { name: 'pnpm', cmd: exe('pnpm'), install: ['add', '-g', `${PACKAGE}@latest`], owns: (dir, real) => real.startsWith(fs.realpathSync(dir) + path.sep) },
];
const NPM = MANAGERS[0];
const RELEASES = 'https://github.com/phanshiyu/mr-cast/blob/main/CHANGELOG.md';
const EACCES_DOCS = 'https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally';

/** The manager's global node_modules, or null when it is not on PATH. */
function globalRoot(manager) {
  const res = spawnSync(manager.cmd, ['root', '-g'], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

const command = (manager) => `${manager.name} ${manager.install.join(' ')}`;

/**
 * How this copy was installed: `clone` (a git checkout), `global` (by `npm install -g` or `pnpm add -g`,
 * so that manager can replace it), or `other` (npx, another package manager, another Node's npm).
 */
function installKind(root) {
  if (isGitClone(root)) return { kind: 'clone' };
  const real = fs.realpathSync(root);
  for (const manager of MANAGERS) {
    const dir = globalRoot(manager);
    try {
      if (dir && manager.owns(dir, real)) return { kind: 'global', manager, globalRoot: dir };
    } catch { /* not installed there */ }
  }
  return { kind: 'other' };
}

async function latestVersion() {
  try {
    const latest = await fetchLatest(10_000);
    writeCache(latest);
    return latest;
  } catch (err) {
    throw new UserError(`could not look up the latest version on npm: ${err.cause?.message ?? err.message}`);
  }
}

const cloneSteps = (root) => [
  `this mr-cast is a git clone; update it with:`,
  `  cd ${root}`,
  '  git pull',
  '  pnpm install',
  '  pnpm build',
  '  pnpm install-skill',
];

/** Runs the package manager, passing its output through, and returns its exit code and stderr. */
function runManager(manager) {
  return new Promise((resolve, reject) => {
    const child = spawn(manager.cmd, manager.install, { stdio: ['inherit', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

const installedVersion = (root) => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

/**
 * Where the upgrade put the package. npm replaces it in place; pnpm installs it into a new
 * <root -g>/<hash>/node_modules and deletes the old one, which held this running copy.
 */
function upgradedRoot(install, root) {
  if (fs.existsSync(path.join(root, 'package.json'))) return root;
  for (const entry of fs.readdirSync(install.globalRoot)) {
    const candidate = path.join(install.globalRoot, entry, 'node_modules', PACKAGE);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  throw new UserError(`the upgrade succeeded but mr-cast is no longer under ${install.globalRoot}; run \`mr-cast install-skill\``);
}

export async function upgrade({ root, version, check }) {
  const latest = await latestVersion();
  const newer = compareVersions(latest, version) > 0;
  console.log(newer ? `mr-cast ${latest} is available (you have ${version}); changes: ${RELEASES}` : `mr-cast ${version} is the latest version`);
  const install = installKind(root);

  if (install.kind === 'clone') {
    if (!check) for (const line of cloneSteps(root)) console.log(line);
    else console.log('this mr-cast is a git clone; `mr-cast upgrade` prints the steps to update it');
    return;
  }
  if (!newer) return;
  if (install.kind === 'other') {
    console.log(`this mr-cast was not installed by \`npm install -g\`; to install the latest globally, run:\n  ${command(NPM)}`);
    return;
  }
  if (check) {
    console.log(`\`mr-cast upgrade\` runs: ${command(install.manager)}`);
    return;
  }

  const skills = skillsInstalledFrom(root);
  console.log(`running: ${command(install.manager)}`);
  const { code, stderr } = await runManager(install.manager);
  if (code !== 0) {
    if (/\bEACCES\b/.test(stderr)) {
      throw new UserError(`${install.manager.name} cannot write to ${install.globalRoot}. If you installed mr-cast with sudo, upgrade it the same way. Otherwise give npm a prefix you own (${EACCES_DOCS}) and rerun \`mr-cast upgrade\``);
    }
    throw new UserError(`${command(install.manager)} failed (exit ${code}; see its output above)`);
  }
  const newRoot = upgradedRoot(install, root);
  console.log(`upgraded mr-cast ${version} to ${installedVersion(newRoot)}`);
  if (!skills) return;
  // This process still runs the old code, so the new version installs its own skills.
  const launcher = path.join(newRoot, 'bin', 'mr-cast');
  const res = spawnSync(fs.existsSync(launcher) ? launcher : 'mr-cast', ['install-skill'], { stdio: 'inherit' });
  if (res.status !== 0) throw new UserError('the upgrade succeeded but reinstalling the Claude Code skills failed; run `mr-cast install-skill`');
  console.log('start a new Claude Code session to load the updated skills');
}
