import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const unreadable = async (scene) =>
  (
    await validateStoryboard(
      { title: 'Scaled', scenes: [{ chapter: 'Scaled', narration: 'Each part hands the request on.', ...scene }] },
      {},
      { mode: 'explain' },
    )
  ).warnings.filter((w) => w.includes('unreadable'));
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

const chain = (n) => ({
  type: 'graph',
  layout: 'LR',
  nodes: range(n, (i) => ({ id: `n${i}`, label: `Service ${i}` })),
  edges: range(n - 1, (i) => ({ from: `n${i}`, to: `n${i + 1}`, label: 'calls' })),
});

const states = (n) => ({
  type: 'state',
  initial: 's0',
  states: range(n, (i) => ({ id: `s${i}`, label: `State ${i}` })),
  transitions: range(n - 1, (i) => ({ from: `s${i}`, to: `s${i + 1}`, label: 'next' })),
});

const tables = (n) => ({
  type: 'er',
  entities: range(n, (i) => ({
    id: `e${i}`,
    name: `table_${i}`,
    fields: range(4, (k) => ({ name: `field_${k}`, type: 'text' })),
  })),
  relations: range(n - 1, (i) => ({ from: `e${i}`, to: `e${i + 1}`, label: 'has', cardinality: 'one-to-many' })),
});

test('a graph scaled so far its labels draw under the readable size is reported, and a short one passes', async () => {
  assert.deepEqual(await unreadable(chain(3)), []);
  assert.deepEqual(await unreadable(chain(6)), [
    'scenes[0] ("Scaled"): unreadable: the graph is scaled to 0.50, so it draws its card title at 14.0 px (28 px unscaled), edge label at 9.5 px (19 px unscaled), under the 15 px readable minimum',
  ]);
});

test('a scaled state diagram is reported', async () => {
  assert.deepEqual(await unreadable(states(5)), []);
  assert.deepEqual(await unreadable(states(8)), [
    'scenes[0] ("Scaled"): unreadable: the state diagram is scaled to 0.66, so it draws its transition label at 11.8 px (18 px unscaled), under the 15 px readable minimum',
  ]);
});

test('a scaled er diagram is reported', async () => {
  assert.deepEqual(await unreadable(tables(6)), []);
  assert.deepEqual(await unreadable(tables(10)), [
    'scenes[0] ("Scaled"): unreadable: the er diagram is scaled to 0.65, so it draws its field at 13.5 px (21 px unscaled), field type at 11.6 px (18 px unscaled), relation label at 10.9 px (17 px unscaled), under the 15 px readable minimum',
  ]);
});
