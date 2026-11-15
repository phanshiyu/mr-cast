import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  addChangelogEntry,
  bumpPatch,
  changelogEntry,
  setVersion,
  shippedChanges,
  shippedRoots,
} from '../scripts/lib/dependency-release.mjs';
import { BUNDLED_DEV_DEPENDENCIES, parseLock, shippedVersions } from '../scripts/lib/pnpm-lock.mjs';

const root = (file) => fileURLToPath(new URL(`../${file}`, import.meta.url));
const manifest = JSON.parse(fs.readFileSync(root('package.json'), 'utf8'));
const realLock = fs.readFileSync(root('pnpm-lock.yaml'), 'utf8');

const lock = ({
  react = '19.3.1',
  scheduler = '0.30.0',
  eslint = '9.0.0',
  tailwind = '4.3.3',
  extraDep = '',
} = {}) => `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      react-dom:
        specifier: ^19
        version: ${react}(react@${react})
    devDependencies:
      eslint:
        specifier: ^9
        version: ${eslint}
      tailwindcss:
        specifier: ^4
        version: ${tailwind}

packages:

  react-dom@${react}:
    resolution: {integrity: sha512-x}

snapshots:

  react-dom@${react}(react@${react}):
    dependencies:
      react: ${react}
      scheduler: ${scheduler}
${extraDep}
  react@${react}: {}

  scheduler@${scheduler}: {}

  eslint@${eslint}:
    dependencies:
      chalk: 5.0.0

  chalk@5.0.0: {}

  tailwindcss@${tailwind}: {}
`;

const fixtureManifest = { dependencies: { 'react-dom': '^19' }, devDependencies: { eslint: '^9', tailwindcss: '^4' } };
const names = (changes) => changes.map((c) => c.name);

test('a runtime dependency that moves releases, and so does one it depends on', () => {
  assert.deepEqual(names(shippedChanges(lock(), lock({ react: '19.3.2' }), fixtureManifest)), ['react', 'react-dom']);
  assert.deepEqual(names(shippedChanges(lock(), lock({ scheduler: '0.31.0' }), fixtureManifest)), ['scheduler']);
});

test('a tooling-only dev dependency never releases, nor does its own tree', () => {
  assert.deepEqual(shippedChanges(lock(), lock({ eslint: '9.1.0' }), fixtureManifest), []);
});

test('a bundled dev dependency releases', () => {
  const changes = shippedChanges(lock(), lock({ tailwind: '4.3.4' }), fixtureManifest);
  assert.deepEqual(changes, [{ name: 'tailwindcss', from: ['4.3.3'], to: ['4.3.4'] }]);
});

test('the same lock file changes nothing', () => {
  assert.deepEqual(shippedChanges(lock(), lock(), fixtureManifest), []);
});

test('a package that joins or leaves the shipped tree shows with an empty side', () => {
  const extra = '      lodash: 4.0.0\n';
  const joined = lock({ extraDep: extra }).replace('snapshots:\n', 'snapshots:\n\n  lodash@4.0.0: {}\n');
  assert.deepEqual(shippedChanges(lock(), joined, fixtureManifest), [{ name: 'lodash', from: [], to: ['4.0.0'] }]);
  assert.deepEqual(shippedChanges(joined, lock(), fixtureManifest), [{ name: 'lodash', from: ['4.0.0'], to: [] }]);
});

test('the lock file of this repository parses, and its shipped tree has the runtime packages but no tooling', () => {
  const shipped = shippedVersions(parseLock(realLock), shippedRoots(manifest));
  const present = [...shipped].map((entry) => entry.slice(0, entry.lastIndexOf('@')));
  for (const name of [...Object.keys(manifest.dependencies), ...BUNDLED_DEV_DEPENDENCIES]) {
    assert.ok(present.includes(name), `${name} should ship`);
  }
  for (const name of ['@biomejs/biome', 'fallow', 'typescript', 'vite', '@types/node']) {
    assert.ok(!present.includes(name), `${name} should not ship`);
  }
});

test('a real update of a tool changes nothing that ships, and one of a runtime package does', () => {
  const importer = /(\n {6}fallow:\n {8}specifier: [^\n]+\n {8}version: )3\.33\.1/;
  assert.match(realLock, importer);
  assert.deepEqual(
    shippedChanges(
      realLock,
      realLock.replace(importer, (_, head) => `${head}3.99.0`),
      manifest,
    ),
    [],
  );
  // The importer's version, the snapshot key and every dependency line that names d3-geo move together.
  const bumped = realLock
    .replace(/(\n {6}d3-geo:\n {8}specifier: [^\n]+\n {8}version: )3\.1\.1/, (_, head) => `${head}3.1.2`)
    .replace(/\bd3-geo(@|: )3\.1\.1/g, (_, glue) => `d3-geo${glue}3.1.2`);
  assert.deepEqual(shippedChanges(realLock, bumped, manifest), [{ name: 'd3-geo', from: ['3.1.1'], to: ['3.1.2'] }]);
});

test('every dev dependency that the player imports is listed as bundled', () => {
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(root(dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(tsx?|mjs|css)$/.test(entry.name)) sources.push(fs.readFileSync(root(rel), 'utf8'));
    }
  };
  for (const dir of ['src', 'shared', 'bin']) walk(dir);
  const text = sources.join('\n');
  for (const name of Object.keys(manifest.devDependencies)) {
    // Escape every character a regular expression reads specially, the backslash among them, so a name is matched as written.
    const escaped = name.replace(/[\\^$.*+?()[\]{}|/@-]/g, '\\$&');
    const imported = new RegExp(`(from|import|require\\()\\s*['"]${escaped}(/[^'"]*)?['"]`).test(text);
    assert.ok(!imported || BUNDLED_DEV_DEPENDENCIES.includes(name), `${name} is imported by shipped code`);
  }
  assert.match(text, /@import "tailwindcss"/);
});

test('the patch version goes up and only the version line of package.json changes', () => {
  assert.equal(bumpPatch('0.28.0'), '0.28.1');
  assert.equal(bumpPatch('1.9.9'), '1.9.10');
  assert.throws(() => bumpPatch('1.0.0-beta.1'));
  const before = fs.readFileSync(root('package.json'), 'utf8');
  const after = setVersion(before, '0.28.1');
  assert.equal(JSON.parse(after).version, '0.28.1');
  assert.equal(after.replace('0.28.1', manifest.version), before);
});

test('the changelog gets a short entry on top, with the packages that changed', () => {
  const entry = changelogEntry('0.28.1', [
    { name: 'zod', from: ['4.5.3'], to: ['4.5.4'] },
    { name: 'lodash', from: [], to: ['4.0.0'] },
    { name: 'left-pad', from: ['1.0.0'], to: [] },
  ]);
  assert.match(entry, /^## 0\.28\.1\n\nDependency updates/);
  assert.match(entry, /- `zod` 4\.5\.3 to 4\.5\.4/);
  assert.match(entry, /- `lodash` added at 4\.0\.0/);
  assert.match(entry, /- `left-pad` removed \(was 1\.0\.0\)/);
  const next = addChangelogEntry('# Changelog\n\n## 0.28.0\n\nOld.\n', entry);
  assert.match(next, /^# Changelog\n\n## 0\.28\.1\n[\s\S]*\n## 0\.28\.0\n\nOld\.\n$/);
  assert.throws(() => addChangelogEntry('no heading', entry));
});

test('a long list of changes is cut with a count', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ name: `p${i}`, from: ['1.0.0'], to: ['1.0.1'] }));
  assert.match(changelogEntry('0.28.1', many), /- and 10 more/);
});
