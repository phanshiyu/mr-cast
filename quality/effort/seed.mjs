// Seeds one fixture's bug from bugs.json into the feature branch, folded into the commit that last touched the file,
// so the branch reads as if it had always been written that way.
// Usage: node seed.mjs <repo> <fixture>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [repo, fixture] = process.argv.slice(2);
const bugs = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'bugs.json'), 'utf8'));
const bug = bugs[fixture];
if (!repo || !bug) {
  console.error('usage: node seed.mjs <repo> <fixture with an entry in bugs.json>');
  process.exit(1);
}
const git = (...args) =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GIT_SEQUENCE_EDITOR: ':', GIT_EDITOR: ':' },
  }).trim();

const file = path.join(repo, bug.file);
const text = fs.readFileSync(file, 'utf8');
if (text.split(bug.find).length !== 2)
  throw new Error(`${fixture}: "${bug.find}" must occur exactly once in ${bug.file}`);
const target = git('log', '-1', '--format=%H', '--', bug.file);
fs.writeFileSync(file, text.replace(bug.find, bug.replace));
git('commit', '-q', `--fixup=${target}`, '--', bug.file);
git('rebase', '-q', '--autosquash', 'main');
git('reflog', 'expire', '--expire=now', '--all');
git('gc', '-q', '--prune=now');
if (!fs.readFileSync(file, 'utf8').includes(bug.replace) || git('status', '--porcelain') !== '')
  throw new Error(`${fixture}: seeding left the branch in an unexpected state`);
console.log(`seeded ${fixture}: ${bug.file}`);
