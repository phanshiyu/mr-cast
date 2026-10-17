import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStoryboard } from '../bin/lib/validate.mjs';
import { walkStates } from '../shared/state-steps.mjs';
import { parseStoryboard } from '../shared/storyboard-json.mjs';

const bundled = await build({ entryPoints: [new URL('../src/utils/memoryLayout.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { layoutMemory } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const BOX = { width: 1712, height: 700 };

// As storyboard.json holds it: a JSON object would put "1" and "2" before "name".
const written = `{
  "title": "t",
  "scenes": [{
    "type": "memory",
    "narration": "A record.",
    "frames": [{ "name": "main", "vars": { "row": { "ref": "r" }, "10": 1, "2": 0 } }],
    "objects": [{ "id": "r", "type": "dict", "fields": { "name": "Ada", "2": "b", "1": "a" } }],
    "steps": [{ "set": { "r.2": "c" }, "say": "The second slot changes." }]
  }]
}`;

const rowNames = (layout, key) => layout.card.get(key).rows.map((r) => r.name.text);

test('a memory scene draws its fields and variables in the order written, names such as "2" included', async () => {
  // The render's props and the player's fetch carry the storyboard as JSON, so the order must survive a round trip.
  const storyboard = JSON.parse(JSON.stringify(parseStoryboard(written)));
  const [scene] = storyboard.scenes;
  const layout = layoutMemory(scene, BOX);
  assert.deepEqual(rowNames(layout, 'o:r'), ['name', '2', '1']);
  assert.deepEqual(rowNames(layout, 'fr:main'), ['row', '10', '2']);
  assert.deepEqual(walkStates(scene).states[1].values, { 'v:main/row': { ref: 'r' }, 'v:main/10': 1, 'v:main/2': 0, 'f:r/name': 'Ada', 'f:r/2': 'c', 'f:r/1': 'a' });
  assert.deepEqual((await validateStoryboard(storyboard, {}, { mode: 'explain' })).errors, []);
});

test('memory fields written as [name, value] pairs are checked like an object', async () => {
  const scene = { type: 'memory', narration: 'A record.', frames: [], objects: [{ id: 'r', fields: [['2', 'b'], ['2', 'c'], ['x']] }] };
  const { errors } = await validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' });
  assert.deepEqual(errors, ['scenes[0].objects[0].fields: required object of field name to value, e.g. { "total": 0, "cart": { "ref": "c1" } }']);
  scene.objects[0].fields.pop();
  const again = await validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' });
  assert.deepEqual(again.errors, ['scenes[0].objects[0].fields: "2" is named twice; every field name is different']);
});
