import { BUNDLED_DEV_DEPENDENCIES, changedPackages, parseLock, shippedVersions } from './pnpm-lock.mjs';

/** The packages users get: the runtime dependencies and the dev dependencies that dist/ bundles. */
export function shippedRoots(manifest) {
  return [...Object.keys(manifest.dependencies ?? {}), ...BUNDLED_DEV_DEPENDENCIES];
}

/** What a shipped package did between two lock files: moved, joined or left. Tooling-only changes give nothing. */
export function shippedChanges(oldLock, newLock, manifest) {
  const roots = shippedRoots(manifest);
  return changedPackages(shippedVersions(parseLock(oldLock), roots), shippedVersions(parseLock(newLock), roots));
}

export function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Not a plain x.y.z version: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

/** Rewrites only the version line, so the file's formatting stays and no lock file is touched. */
export function setVersion(packageJson, version) {
  const next = packageJson.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`);
  if (next === packageJson) throw new Error('package.json has no version line to change');
  return next;
}

function describe({ name, from, to }) {
  if (!from.length) return `\`${name}\` added at ${to.join(', ')}`;
  if (!to.length) return `\`${name}\` removed (was ${from.join(', ')})`;
  return `\`${name}\` ${from.join(', ')} to ${to.join(', ')}`;
}

export function changelogEntry(version, changes, limit = 30) {
  const lines = changes.slice(0, limit).map((change) => `- ${describe(change)}`);
  if (changes.length > limit) lines.push(`- and ${changes.length - limit} more`);
  return [
    `## ${version}`,
    '',
    'Dependency updates. CI released this version because a package that ships with mr-cast changed.',
    '',
    ...lines,
    '',
    '',
  ].join('\n');
}

export function addChangelogEntry(changelog, entry) {
  const heading = '# Changelog\n\n';
  if (!changelog.startsWith(heading)) throw new Error('CHANGELOG.md does not start with "# Changelog"');
  return heading + entry + changelog.slice(heading.length);
}
