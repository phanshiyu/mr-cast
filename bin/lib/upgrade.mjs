// mr-cast upgrade: updates an `npm install -g` install in place and says how to update any other.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './errors.mjs';
import { skillsInstalledFrom } from './install-skill.mjs';
import { PACKAGE, compareVersions, fetchLatest, isGitClone, writeCache } from './update.mjs';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const INSTALL_ARGS = ['install', '-g', `${PACKAGE}@latest`];
const RELEASES = 'https://github.com/phanshiyu/mr-cast/releases';
const EACCES_DOCS = 'https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally';

/** npm's global node_modules, or null when npm is not on PATH. */
function npmGlobalRoot() {
  const res = spawnSync(NPM, ['root', '-g'], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

/**
 * How this copy was installed: `clone` (a git checkout), `global` (by `npm install -g`, so this npm
 * can replace it), or `other` (npx, another package manager, another Node's npm).
 */
function installKind(root) {
  if (isGitClone(root)) return { kind: 'clone' };
  const globalRoot = npmGlobalRoot();
  try {
    if (globalRoot && fs.realpathSync(path.join(globalRoot, PACKAGE)) === fs.realpathSync(root)) return { kind: 'global', globalRoot };
  } catch { /* not installed there */ }
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
  '  npm install',
  '  npm run build',
  '  npm run install-skill',
];

/** Runs npm, passing its output through, and returns its exit code and stderr. */
function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(NPM, args, { stdio: ['inherit', 'inherit', 'pipe'] });
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
    console.log(`this mr-cast was not installed by \`npm install -g\`; to install the latest globally, run:\n  npm ${INSTALL_ARGS.join(' ')}`);
    return;
  }
  if (check) {
    console.log(`\`mr-cast upgrade\` runs: npm ${INSTALL_ARGS.join(' ')}`);
    return;
  }

  const skills = skillsInstalledFrom(root);
  console.log(`running: npm ${INSTALL_ARGS.join(' ')}`);
  const { code, stderr } = await runNpm(INSTALL_ARGS);
  if (code !== 0) {
    if (/\bEACCES\b/.test(stderr)) {
      throw new UserError(`npm cannot write to ${install.globalRoot}. If you installed mr-cast with sudo, upgrade it the same way. Otherwise give npm a prefix you own (${EACCES_DOCS}) and rerun \`mr-cast upgrade\``);
    }
    throw new UserError(`npm ${INSTALL_ARGS.join(' ')} failed (exit ${code}; see its output above)`);
  }
  console.log(`upgraded mr-cast ${version} to ${installedVersion(root)}`);
  if (!skills) return;
  // This process still runs the old code, so the new version installs its own skills.
  const launcher = path.join(root, 'bin', 'mr-cast');
  const res = spawnSync(fs.existsSync(launcher) ? launcher : 'mr-cast', ['install-skill'], { stdio: 'inherit' });
  if (res.status !== 0) throw new UserError('the upgrade succeeded but reinstalling the Claude Code skills failed; run `mr-cast install-skill`');
  console.log('start a new Claude Code session to load the updated skills');
}
