// Decides whether a release is due because a shipped dependency changed, and with --apply makes the release's file
// changes (docs/adr/0041-release-dependency-updates-from-ci.md).
//   node scripts/dependency-release.mjs <lock file at the last tag> <lock file now> [--apply]
// Prints JSON: { release, version, changes }. Run it in the repository root.
import { readFileSync, writeFileSync } from 'node:fs';
import { addChangelogEntry, bumpPatch, changelogEntry, setVersion, shippedChanges } from './lib/dependency-release.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [oldLock, newLock] = args.filter((arg) => !arg.startsWith('--'));
if (!oldLock || !newLock) {
  console.error('usage: node scripts/dependency-release.mjs <old pnpm-lock.yaml> <new pnpm-lock.yaml> [--apply]');
  process.exit(2);
}

const packageJson = readFileSync('package.json', 'utf8');
const manifest = JSON.parse(packageJson);
const changes = shippedChanges(readFileSync(oldLock, 'utf8'), readFileSync(newLock, 'utf8'), manifest);
const version = changes.length ? bumpPatch(manifest.version) : null;

if (apply && version) {
  writeFileSync('package.json', setVersion(packageJson, version));
  writeFileSync(
    'CHANGELOG.md',
    addChangelogEntry(readFileSync('CHANGELOG.md', 'utf8'), changelogEntry(version, changes)),
  );
}
console.log(JSON.stringify({ release: Boolean(version), version, changes }, null, 2));
