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
const { treeRows } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const mapped = await build({
  entryPoints: [new URL('../src/utils/partsLayout.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { layoutParts, partsBoxes } = await import(
  `data:text/javascript;base64,${Buffer.from(mapped.outputFiles[0].text).toString('base64')}`
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

test("a file whose hunks sit in two parts is listed under each, with that part's share of its lines", () => {
  const two = {
    ...hunks,
    h20: { ...hunks.h8, id: 'h20', additions: 5, deletions: 1 },
    h21: { ...hunks.h8, id: 'h21', additions: 2, deletions: 0 },
  };
  const split = {
    parts: [
      { name: 'A', weight: 'core', hunks: ['h8', 'h20'] },
      { name: 'B', weight: 'support', hunks: ['h21', 'h21', 'h5'] },
    ],
  };
  const read = expandBriefParts({ type: 'files', narration: 'x', parts: 'brief' }, { brief: split }, two);
  const rows = read.files.map((f) => [f.path, f.part, f.additions, f.deletions]);
  assert.deepEqual(rows, [
    ['src/server.ts', 'A', 8, 5],
    ['src/server.ts', 'B', 2, 0],
    ['src/db/pool.ts', 'B', 2, 2],
  ]);
  const groups = sceneParts(read, sceneFiles(read, two));
  assert.deepEqual(
    groups.map((g) => [g.name, g.additions, g.deletions]),
    [
      ['A', 8, 5],
      ['B', 4, 2],
    ],
  );
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

const mapOf = (s, w = 1712, h = 734) => {
  const files = sceneFiles(s, hunks);
  return layoutParts(sceneParts(s, files), w, h);
};
const card = (layout, name) => layout.cards.find((c) => c.part.name === name);

test('a part card holds the part, its counts and its largest files, with the rest counted', () => {
  const s = scene();
  const layout = mapOf(s);
  assert.deepEqual(
    layout.cards.map((c) => [c.part.name, c.tags]),
    [
      ['Checking', ['core']],
      ['Callers', ['support']],
      ['Docs', ['routine']],
    ],
  );
  const core = card(layout, 'Checking');
  assert.deepEqual(
    core.files.map((f) => f.file.path),
    ['src/config/schema.ts', 'src/config/index.ts'].sort(
      (a, b) =>
        (sceneFiles(s, hunks).find((f) => f.path === b).additions ?? 0) -
        (sceneFiles(s, hunks).find((f) => f.path === a).additions ?? 0),
    ),
    'the largest first',
  );
  assert.equal(core.more, 0);
  assert.ok(core.name.size > card(layout, 'Docs').name.size, 'the core name is drawn larger than the routine one');
});

test('parts with after links sit in columns after the parts they follow, with a link from each', () => {
  const s = scene({
    parts: [
      { name: 'Checking', weight: 'core', does: 'Checks the settings once' },
      { name: 'Callers', weight: 'support', does: 'Hands them out', after: ['Checking'] },
      { name: 'Docs', weight: 'routine', after: ['Callers', 'Checking'] },
    ],
  });
  const layout = mapOf(s);
  const [a, b, c] = ['Checking', 'Callers', 'Docs'].map((n) => card(layout, n));
  assert.ok(a.x < b.x && b.x < c.x, 'each sits right of the one it follows');
  assert.deepEqual(
    layout.links.map((l) => [l.from, l.to]),
    [
      [0, 1],
      [1, 2],
    ],
    'Checking to Docs is implied by the path through Callers, so it is not drawn',
  );
  assert.ok(layout.links.every((l) => l.path.startsWith('M') && l.head.split(' ').length === 3));
  assert.ok(a.does.fits && b.does.fits);
});

test('parts with no links fill a grid in order, core first, with no link drawn', () => {
  const layout = mapOf(scene());
  assert.deepEqual(layout.links, []);
  const [a, b, c] = layout.cards;
  assert.ok(a.x < b.x && b.x < c.x, 'three in a row');
  assert.equal(a.y, b.y);
});

test('a link to a name that is no part, to itself, or in a loop never breaks the layout', () => {
  const s = scene({
    parts: [
      { name: 'Checking', weight: 'core', after: ['Callers', 'Nowhere', 'Checking'] },
      { name: 'Callers', weight: 'support', after: ['Checking'] },
      { name: 'Docs', weight: 'routine' },
    ],
  });
  const layout = mapOf(s);
  assert.equal(layout.cards.length, 3);
  assert.ok(layout.links.length >= 1);
  assert.ok(layout.cards.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)));
});

test('a part that holds a file named in brief.check is marked "check"', () => {
  const sb = {
    brief: { ...brief, check: [{ file: 'src/server.ts', line: 1, what: 'x', why: 'y' }] },
  };
  const read = expandBriefParts({ type: 'files', narration: 'x', parts: 'brief' }, sb, hunks);
  assert.deepEqual(
    read.parts.map((p) => [p.name, p.check === true]),
    [
      ['Checking the settings once', false],
      ['Callers', true],
      ['Docs', false],
    ],
  );
  const layout = mapOf(read);
  assert.deepEqual(card(layout, 'Callers').tags, ['support', 'check']);
  assert.deepEqual(card(layout, 'Docs').tags, ['routine']);
});

test('parts "brief" carries each part\'s does and after into the scene', () => {
  const withDoes = {
    parts: [
      { name: 'A', weight: 'core', does: ' Checks things ', hunks: ['h3'] },
      { name: 'B', weight: 'support', after: ['A'], hunks: ['h8'] },
    ],
  };
  const read = expandBriefParts({ type: 'files', narration: 'x', parts: 'brief' }, { brief: withDoes }, hunks);
  assert.deepEqual(read.parts, [
    { name: 'A', weight: 'core', does: 'Checks things' },
    { name: 'B', weight: 'support', after: ['A'] },
  ]);
  const groups = sceneParts(read, sceneFiles(read, hunks));
  assert.deepEqual([groups[0].does, groups[1].after], ['Checks things', ['A']]);
});

test('a step can light a file a card does not list, and its box is the card', () => {
  const s = scene();
  const layout = mapOf(s);
  const { boxes } = partsBoxes(layout);
  assert.ok(boxes.has('p:Checking'));
  for (const f of sceneFiles(s, hunks)) assert.ok(boxes.has(`f:${f.path}`), f.path);
});

test('two files that share a name show their whole path on a card', () => {
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
  const names = mapOf(s, 1712, 734).cards[0].files.map((f) => f.name.text);
  assert.deepEqual(names.sort(), ['a/index.ts', 'b/index.ts', 'other.ts']);
});

test('without parts the scene is still a tree by directory', () => {
  const plain = { type: 'files', narration: 'x' };
  assert.ok(treeRows(sceneFiles(plain, hunks), {}).some((r) => r.kind === 'dir'));
});

// 27 files in 6 parts: two core parts, two support parts and two routine ones, linked in a line.
const SIX = [
  ['Core', 'core', 5, []],
  ['Reply', 'core', 4, ['Core']],
  ['CLI', 'support', 5, ['Reply']],
  ['Config', 'support', 3, ['Core', 'CLI']],
  ['Tests', 'routine', 4, []],
  ['Docs', 'routine', 6, []],
];
const six = () => {
  const files = SIX.flatMap(([part, , n]) =>
    Array.from({ length: n }, (_, i) => ({ path: `src/${part}/f${i}.ts`, part, additions: 100 - i, deletions: i })),
  );
  const parts = SIX.map(([name, weight, , after]) => ({
    name,
    weight,
    does: `Does what ${name} does, in one sentence of about ninety characters, more or less`,
    ...(after.length ? { after } : {}),
  }));
  return { type: 'files', narration: 'x', parts, files };
};

test('27 files in 6 parts fit without scaling, every text at a readable size', async () => {
  const s = six();
  assert.equal(s.files.length, 27);
  const layout = mapOf(s);
  assert.equal(layout.cards.length, 6);
  const texts = layout.cards.flatMap((c) => [c.name, c.does, c.room, ...c.files.map((f) => f.name)]);
  assert.ok(
    texts.every((t) => t.fits),
    'every text fits',
  );
  assert.ok(texts.filter((t) => t.text).every((t) => t.size >= 15));
  assert.ok(layout.width <= 1712 && layout.height <= 734);
  for (const c of layout.cards) assert.equal(c.files.length + c.more, c.part.files.length);
  const { warnings, errors } = await check({}, s);
  assert.deepEqual(errors, []);
  assert.ok(!warnings.some((w) => w.includes('get cramped')), warnings.join('\n'));
});

test('a note is not drawn on the parts map, and an after naming no part is warned about', async () => {
  const { errors, warnings } = await check(
    {},
    scene({
      notes: { 'src/server.ts': 'wires it in' },
      parts: [
        { name: 'Docs', weight: 'routine', after: ['Nowhere'] },
        { name: 'Callers', weight: 'support' },
        { name: 'Checking', weight: 'core' },
      ],
    }),
  );
  assert.deepEqual(errors, []);
  has(warnings, 'scenes[0].notes["src/server.ts"]: a note is not drawn on the parts map');
  has(warnings, 'scenes[0].parts[0].after[0]: "Nowhere" is not one of the scene\'s parts');
});

test('a does that is not a string is an error', async () => {
  const { errors } = await check({}, scene({ parts: [{ name: 'Docs', weight: 'routine', does: 3 }] }));
  has(errors, 'scenes[0].parts[0].does: must be a non-empty string');
});

test('without parts a note is still drawn, and warns of nothing', async () => {
  const { warnings } = await check({}, { type: 'files', narration: 'x', notes: { 'src/server.ts': 'wires it in' } });
  assert.ok(!warnings.some((w) => w.includes('not drawn')));
});

test('a card too short for its text is reported, naming the part', async () => {
  const crowd = {
    type: 'files',
    narration: 'x',
    parts: Array.from({ length: 16 }, (_, i) => ({ name: `Part ${i}`, weight: 'support', does: 'Does a thing' })),
    files: Array.from({ length: 16 }, (_, i) => ({ path: `src/p${i}.ts`, part: `Part ${i}` })),
  };
  const { errors } = await check({}, crowd);
  has(errors, 'part card');
});
