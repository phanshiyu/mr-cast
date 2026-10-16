// mr-cast upgrade: updates an `npm install -g` or `pnpm add -g` install in place and says how to update any other.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserError } from './errors.mjs';
import { skillsInstalledFrom } from './install-skill.mjs';
import { PACKAGE, compareVersions, fetchLatest, isGitClone, writeCache } from './update.mjs';

const exe = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);
/** The package managers whose global installs `mr-cast upgrade` can replace, tried in this order. */
const MANAGERS = [
  { name: 'npm', cmd: exe('npm'), install: ['install', '-g', `${PACKAGE}@latest`] },
  { name: 'pnpm', cmd: exe('pnpm'), install: ['add', '-g', `${PACKAGE}@latest`] },
];
const NPM = MANAGERS[0];
const RELEASES = 'https://github.com/phanshiyu/mr-cast/blob/main/CHANGELOG.md';
const EACCES_DOCS = 'https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally';

// Run package managers from the home directory: in a project that pins another package manager or
// version, corepack or pnpm would switch to it, and a project .npmrc could move the global prefix.
const HOME = { cwd: os.homedir() };

/** The manager's global node_modules, or null when it is not on PATH. */
function globalRoot(manager) {
  const res = spawnSync(manager.cmd, ['root', '-g'], { encoding: 'utf8', ...HOME });
  return res.status === 0 ? res.stdout.trim() : null;
}

/**
 * Where copies of mr-cast can sit under a global root: <root>/<package> for npm and pnpm 10, and
 * <root>/<hash>/node_modules/<package> for pnpm 11 and later, which give each global install its own directory.
 */
function globalCopies(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { /* no global root yet */ }
  const copies = [path.join(dir, PACKAGE), ...entries.map((e) => path.join(dir, e, 'node_modules', PACKAGE))];
  return copies.flatMap((copy) => {
    try {
      return [{ path: copy, real: fs.realpathSync(copy) }];
    } catch {
      return [];
    }
  });
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
    if (dir && globalCopies(dir).some((copy) => copy.real === real)) return { kind: 'global', manager, globalRoot: dir };
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
    const child = spawn(manager.cmd, manager.install, { stdio: ['inherit', 'inherit', 'pipe'], ...HOME });
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
 * The newest copy under the global root after the upgrade. npm replaces the package in place; pnpm 11
 * and later install it into a new directory, and may keep or delete the one this process runs from.
 */
function upgradedRoot(install) {
  const copies = globalCopies(install.globalRoot).filter((copy) => fs.existsSync(path.join(copy.path, 'package.json')));
  if (!copies.length) throw new UserError(`the upgrade succeeded but mr-cast is no longer under ${install.globalRoot}; run \`mr-cast install-skill\``);
  return copies.reduce((a, b) => (compareVersions(installedVersion(b.path), installedVersion(a.path)) > 0 ? b : a)).path;
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
      const fix = install.manager === NPM ? `give npm a prefix you own (${EACCES_DOCS})` : 'run `pnpm setup` to give pnpm a global directory you own';
      throw new UserError(`${install.manager.name} cannot write to ${install.globalRoot}. If you installed mr-cast with sudo, upgrade it the same way. Otherwise ${fix} and rerun \`mr-cast upgrade\``);
    }
    throw new UserError(`${command(install.manager)} failed (exit ${code}; see its output above)`);
  }
  const newRoot = upgradedRoot(install);
  console.log(`upgraded mr-cast ${version} to ${installedVersion(newRoot)}`);
  if (!skills) return;
  // This process still runs the old code, so the new version installs its own skills.
  const launcher = path.join(newRoot, 'bin', 'mr-cast');
  const res = spawnSync(fs.existsSync(launcher) ? launcher : 'mr-cast', ['install-skill'], { stdio: 'inherit' });
  if (res.status !== 0) throw new UserError('the upgrade succeeded but reinstalling the Claude Code skills failed; run `mr-cast install-skill`');
  console.log('start a new Claude Code session to load the updated skills');
}
