import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { expandBriefParts, sceneFiles, sceneParts } from '../shared/files.mjs';
import { normalizeStoryboard } from '../shared/normalize.mjs';
import { resolveRef, stepTargets } from '../shared/targets.mjs';

const hunks = JSON.parse(fs.readFileSync(new URL('../examples/primitives/files/hunks.json', import.meta.url)));

const bundled = await build({
  entryPoints: [new URL('../src/utils/filesLayout.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { layoutFiles, treeRows } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const PARTS = [
  { name: 'Docs', weight: 'routine' },
  { name: 'Callers', weight: 'support' },
  { name: 'Checking', weight: 'core' },
];
const FILES = [
  { path: 'README.md', part: 'Docs' },
  { path: 'src/server.ts', part: 'Callers' },
  { path: 'src/config/schema.ts', part: 'Checking' },
  { path: 'src/config/index.ts', part: 'Checking' },
];
const scene = (extra = {}) => ({
  type: 'files',
  narration: 'The files, by part.',
  parts: PARTS,
  files: FILES,
  ...extra,
});
const brief = {
  parts: [
    { name: 'Checking the settings once', weight: 'core', hunks: ['h3', 'h4'] },
    { name: 'Callers', weight: 'support', hunks: ['h8', 'h5', 'h6', 'h9'] },
    { name: 'Docs', weight: 'routine', hunks: ['h1', 'h2'] },
  ],
};
const check = (extra, ...scenes) => validateStoryboard({ title: 'T', scenes, ...extra }, hunks, { mode: 'diff' });
const has = (list, text) =>
  assert.ok(
    list.some((m) => m.includes(text)),
    `no ${JSON.stringify(text)} in:\n${list.join('\n')}`,
  );

test('parts group the files, core first and routine last, each with its count and line totals', () => {
  const groups = sceneParts(scene(), sceneFiles(scene(), hunks));
  assert.deepEqual(
    groups.map((g) => [g.name, g.weight, g.files.length, g.additions, g.deletions]),
    [
      ['Checking', 'core', 2, 14, 0],
      ['Callers', 'support', 1, 3, 4],
      ['Docs', 'routine', 1, 2, 1],
    ],
  );
  assert.equal(sceneParts({ type: 'files', narration: 'x' }, []), null);
});

test('a file with no part, or an unknown one, goes under "Other files", drawn last', () => {
  const loose = scene({ files: [...FILES, { path: 'src/env.ts' }] });
  const groups = sceneParts(loose, sceneFiles(loose, hunks));
  assert.equal(groups.at(-1).name, 'Other files');
  assert.equal(groups.at(-1).weight, 'routine');
  assert.deepEqual(
    groups.at(-1).files.map((f) => f.path),
    ['src/env.ts'],
  );
});

test('parts "brief" reads the parts and the files of their hunks from the brief', () => {
  const read = expandBriefParts({ type: 'files', narration: 'x', parts: 'brief' }, { brief }, hunks);
  assert.deepEqual(read.parts, [
    { name: 'Checking the settings once', weight: 'core' },
    { name: 'Callers', weight: 'support' },
    { name: 'Docs', weight: 'routine' },
  ]);
  const byPart = (name) => read.files.filter((f) => f.part === name).map((f) => f.path);
  assert.deepEqual(byPart('Checking the settings once'), ['src/config/index.ts', 'src/config/schema.ts']);
  assert.deepEqual(byPart('Callers'), ['src/server.ts', 'src/db/pool.ts', 'src/env.ts', 'test/config.test.ts']);
  assert.deepEqual(byPart('Docs'), ['README.md', 'config/example.env']);
  const server = read.files.find((f) => f.path === 'src/server.ts');
  assert.deepEqual([server.change, server.additions, server.deletions], ['modified', 3, 4]);
});

test('a file whose hunks sit in two parts goes to the part with most of its changed lines', () => {
  const split = {
    parts: [
      { name: 'A', weight: 'core', hunks: ['h5'] },
      { name: 'B', weight: 'core', hunks: ['h5', 'h5', 'h7'] },
    ],
  };
  const read = expandBriefParts({ type: 'files', narration: 'x', parts: 'brief' }, { brief: split }, hunks);
  assert.equal(read.files.find((f) => f.path === 'src/db/pool.ts').part, 'B');
});

test('a scene that is not "brief", or a brief with nothing to read, comes back as it is', () => {
  const plain = scene();
  assert.equal(expandBriefParts(plain, { brief }, hunks), plain);
  const ask = { type: 'files', narration: 'x', parts: 'brief' };
  assert.equal(expandBriefParts(ask, {}, hunks), ask);
  assert.equal(expandBriefParts(ask, { brief: { parts: 'unknown' } }, hunks), ask);
  assert.equal(
    expandBriefParts(ask, { brief: { parts: [{ name: 'A', weight: 'core', hunks: ['h99'] }] } }, hunks),
    ask,
  );
});

test('normalizing a storyboard reads the brief into the scene, so every scene past it sees plain parts', () => {
  const sb = normalizeStoryboard(
    { title: 'T', brief, scenes: [{ type: 'files', narration: 'x', parts: 'brief' }] },
    hunks,
  );
  assert.equal(sb.scenes[0].parts.length, 3);
  assert.equal(sb.scenes[0].files.length, 8);
});

test('a step can name a part, which lights its heading and its files', () => {
  const s = scene();
  assert.deepEqual(resolveRef(s, 'Checking', hunks), ['p:Checking', 'f:src/config/schema.ts', 'f:src/config/index.ts']);
  assert.deepEqual(resolveRef(s, 'part:Callers', hunks), ['p:Callers', 'f:src/server.ts']);
  assert.deepEqual(resolveRef(s, 'src/server.ts', hunks), ['f:src/server.ts']);
  assert.equal(resolveRef(s, 'Nothing', hunks), null);
  assert.deepEqual(stepTargets({ ...s, steps: [{ focus: 'Docs' }] }, hunks), [['p:Docs', 'f:README.md']]);
});

test('validate accepts parts, a part focus and a brief read, and checks the names', async () => {
  const ok = await check(
    {},
    scene({
      steps: [
        { focus: 'Checking', say: 'The core.' },
        { focus: 'Docs', say: 'The rest.' },
      ],
    }),
  );
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(
    ok.warnings.filter((m) => m.includes('scenes[0]')),
    [],
  );
  const fromBrief = await check(
    { brief },
    { type: 'files', narration: 'x', parts: 'brief', steps: [{ focus: 'Callers', say: 'Callers.' }] },
  );
  assert.deepEqual(fromBrief.errors, []);
  const bad = await check(
    {},
    scene({
      files: [
        { path: 'README.md', part: 'Elsewhere' },
        { path: 'src/server.ts', part: 3 },
      ],
    }),
    scene({
      parts: [
        { name: 'A', weight: 'huge' },
        { name: 'A', weight: 'core' },
      ],
      files: [{ path: 'README.md', part: 'A' }],
    }),
    { type: 'files', narration: 'x', files: [{ path: 'README.md', part: 'A' }] },
    { type: 'files', narration: 'x', parts: 'brief' },
    scene({ steps: [{ focus: 'Missing part', say: 'x' }] }),
  );
  has(bad.errors, 'scenes[0].files[0].part: "Elsewhere" is not one of the scene\'s parts (Docs, Callers, Checking)');
  has(bad.errors, 'scenes[0].files[1].part: must be a string');
  has(bad.errors, 'scenes[1].parts[0].weight: must be one of core, support, routine');
  has(bad.errors, 'scenes[1].parts[1].name: "A" is named twice');
  has(bad.errors, 'scenes[2].files[0].part: the scene has no "parts"');
  has(bad.errors, 'scenes[3].parts: "brief" reads brief.parts');
  has(bad.errors, 'scenes[4].steps[0].focus');
});

test('validate warns about files that name no part, and about a part with no file', async () => {
  const { errors, warnings } = await check(
    {},
    scene({ files: [{ path: 'README.md', part: 'Docs' }, { path: 'src/env.ts' }] }),
  );
  assert.deepEqual(errors, []);
  has(warnings, '1 file names no part and sit under "Other files"');
  has(warnings, '"Callers", "Checking" hold no file, so they are not drawn');
});

test('parts lay out as headings with their files indented beneath, a gap above each but the first', () => {
  const s = scene();
  const files = sceneFiles(s, hunks);
  const rows = treeRows(files, {}, sceneParts(s, files));
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['part', 'file', 'file', 'part', 'file', 'part', 'file'],
  );
  assert.deepEqual(rows[0], {
    kind: 'part',
    name: 'Checking',
    depth: 0,
    weight: 'core',
    count: 2,
    additions: 14,
    deletions: 0,
    counted: true,
  });
  assert.equal(rows[1].name, 'schema.ts', 'files by name, not by path');
  const layout = layoutFiles(rows, 1700, 700);
  const at = (i) => layout.rows[i];
  assert.ok(at(3).y - at(2).y > layout.rowH, 'room above the second part');
  assert.equal(at(2).y - at(1).y, layout.rowH, 'no gap inside a part');
  const [core, , routine] = layout.rows.filter((r) => r.row.kind === 'part');
  assert.ok(core.name.size > routine.name.size, 'the core heading is drawn larger than the routine one');
});

test('two files that share a name show their whole path under a part', () => {
  const s = {
    type: 'files',
    narration: 'x',
    parts: [{ name: 'P', weight: 'core' }],
    files: [
      { path: 'a/index.ts', part: 'P' },
      { path: 'b/index.ts', part: 'P' },
      { path: 'c/other.ts', part: 'P' },
    ],
  };
  const files = sceneFiles(s, {});
  const names = treeRows(files, {}, sceneParts(s, files)).flatMap((r) => (r.kind === 'file' ? [r.name] : []));
  assert.deepEqual(names, ['a/index.ts', 'b/index.ts', 'other.ts']);
});

test('without parts the scene is still a tree by directory', () => {
  const plain = { type: 'files', narration: 'x' };
  const files = sceneFiles(plain, hunks);
  assert.ok(treeRows(files, {}, sceneParts(plain, files)).some((r) => r.kind === 'dir'));
});
