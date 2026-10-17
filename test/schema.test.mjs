import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { formatSchema, readSchema, sceneTypes } from '../bin/lib/schema.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const decls = readSchema(root);
const declared = (out) => [...out.matchAll(/^(?:type|interface) (\w+)/gm)].map((m) => m[1]);

test('every declaration of the storyboard section is printed by schema alone or by some scene type', () => {
  const printed = new Set([undefined, ...sceneTypes(decls).keys()].flatMap((t) => declared(formatSchema(root, t))));
  assert.deepEqual([...decls.keys()].filter((n) => !printed.has(n) && n !== 'Scene'), []);
});

test('a scene type prints its interface with its doc comments and the types it uses, once each', () => {
  const out = formatSchema(root, 'array');
  assert.deepEqual(declared(out), ['DisplayText', 'SceneBase', 'FocusRef', 'PenMark', 'PenMarks', 'FocusStep', 'Tone', 'StateValue', 'StateStep', 'ArrayPointer', 'ArrayRange', 'ArrayStep', 'ArrayScene']);
  assert.match(out, /\/\*\*[\s\S]*\*\/\ninterface ArrayScene extends SceneBase \{\n  type: 'array';/);
  assert.equal(out.includes('export '), false);
});

test('schema alone prints the storyboard and names every scene type to ask for', () => {
  const out = formatSchema(root);
  assert.ok(declared(out).includes('Storyboard') && declared(out).includes('SceneBase'));
  assert.ok(out.endsWith(`prints a scene's fields: ${[...sceneTypes(decls).keys()].join(', ')}.`));
  assert.throws(() => formatSchema(root, 'nope'), /no scene type or schema type "nope"/);
});
