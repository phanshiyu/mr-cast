import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { formatSchema, readSchema, sceneTypes } from '../bin/lib/schema.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const decls = readSchema(root);
const declared = (out) => [...out.matchAll(/^(?:type|interface) (\w+)/gm)].map((m) => m[1]);

test('every declaration of the storyboard section is printed by schema alone or by some scene type', () => {
  const printed = new Set([undefined, ...sceneTypes(decls).keys()].flatMap((t) => declared(formatSchema(root, t))));
  assert.deepEqual(
    [...decls.values()].filter((d) => d.storyboard && !printed.has(d.name) && d.name !== 'Scene').map((d) => d.name),
    [],
  );
});

const BUILTINS = new Set(['Array', 'Omit', 'Partial', 'Pick', 'Readonly', 'Record']);
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'[^'\n]*'/g, "''");

test('every type a printed declaration names is printed with it or by schema alone, from anywhere in src/types.ts', () => {
  const shared = new Set(declared(formatSchema(root)));
  for (const what of [undefined, 'all', 'Storyboard', ...sceneTypes(decls).keys()]) {
    const out = formatSchema(root, what);
    const printed = new Set(declared(out));
    const named = new Set(code(out.replace(/\n\/\/ Shared types used above.*$/s, '')).match(/\b[A-Z]\w*\b/g));
    // Schema alone, and Storyboard, name the scene types instead of printing Scene.
    const missing = [...named].filter(
      (n) =>
        !printed.has(n) &&
        !BUILTINS.has(n) &&
        !(what !== 'all' && what !== undefined && shared.has(n)) &&
        !([undefined, 'Storyboard'].includes(what) && n === 'Scene'),
    );
    assert.deepEqual(missing, [], `mr-cast schema ${what ?? ''}`);
  }
  assert.ok(
    declared(formatSchema(root, 'all')).includes('TopicPick'),
    'Storyboard.plan names TopicPick, from the plan.json section',
  );
});

test('a scene type prints its interface with its doc comments and the types only it uses, then names the shared ones', () => {
  const out = formatSchema(root, 'array');
  assert.deepEqual(declared(out), ['ArrayPointer', 'ArrayRange', 'ArrayStep', 'ArrayRow', 'ArrayScene']);
  assert.match(out, /\/\*\*[\s\S]*\*\/\ninterface ArrayScene extends SceneBase \{\n {2}type: 'array';/);
  assert.equal(out.includes('export '), false);
  const note = out.split('\n').at(-1);
  assert.match(note, /^\/\/ Shared types used above: .*SceneBase.*`mr-cast schema` prints them\.$/);
  const shared = new Set(declared(formatSchema(root)));
  for (const n of note.match(/: (.*)\. `/)[1].split(', ')) assert.ok(shared.has(n), `${n} is printed by schema alone`);
  assert.ok(out.length < formatSchema(root, 'all').length / 5);
});

test('several scene types print each scene once and the shared part never', () => {
  const out = formatSchema(root, ['array', 'flow', 'array']);
  const names = declared(out);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('ArrayScene') && names.includes('FlowScene'));
  const shared = declared(formatSchema(root));
  assert.deepEqual(
    names.filter((n) => shared.includes(n)),
    [],
  );
  assert.equal(out.match(/Shared types used above/g).length, 1);
});

test('schema alone prints the storyboard and names every scene type to ask for', () => {
  const out = formatSchema(root);
  assert.ok(declared(out).includes('Storyboard') && declared(out).includes('SceneBase'));
  assert.ok(out.endsWith(`prints a scene's fields: ${[...sceneTypes(decls).keys()].join(', ')}.`));
  assert.throws(() => formatSchema(root, 'nope'), /no scene type or schema type "nope"/);
});
