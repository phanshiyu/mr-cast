// Refs in a graph with a table beside it: a bare number that could be an edge or a row, "col:Header" columns,
// and the warning on a part that starts hidden and no step shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const check = async (scene) => validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain' });

const tracker = {
  type: 'graph',
  narration: 'Costs from S.',
  nodes: [{ id: 'S', label: 'S' }, { id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
  edges: [{ from: 'S', to: 'A' }, { from: 'S', to: 'B' }, { from: 'A', to: 'B' }],
  table: { columns: ['Node', 'Distance'], rows: [{ cells: ['S', '0'] }, { cells: ['A', '4'] }] },
  steps: [{ focus: 'S', say: 'Start at S.' }],
};

const neverShown = (warnings) => warnings.filter((w) => w.includes('never drawn'));

test('a graph node, edge or table row that starts hidden and no step shows is reported', async () => {
  const { warnings } = await check({
    ...tracker,
    nodes: [...tracker.nodes, { id: 'C', label: 'C', hidden: true }],
    edges: [...tracker.edges, { from: 'B', to: 'C', hidden: true }],
    table: { ...tracker.table, rows: [...tracker.table.rows, { cells: ['B', '6'], hidden: true }, { cells: ['C', '9'], hidden: true }] },
    steps: [{ focus: 'S', say: 'Start.' }, { show: ['row:B'], say: 'B arrives.' }],
  });
  assert.deepEqual(neverShown(warnings), [
    'scenes[0].nodes[3].hidden: starts hidden and no step shows it, so it is never drawn',
    'scenes[0].edges[3].hidden: starts hidden and no step shows it, so it is never drawn',
    'scenes[0].table.rows[3].hidden: starts hidden and no step shows it, so it is never drawn',
  ]);
});

test('a table row, an array, a pointer, a frame and an svg element that are never shown are reported', async () => {
  const table = await check({ type: 'table', narration: 'n', columns: ['A'], rows: [{ cells: ['1'] }, { cells: ['2'], hidden: true }], steps: [{ focus: 0, say: 'x' }] });
  const array = await check({ type: 'array', narration: 'n', arrays: [{ name: 'a', values: [1] }, { name: 'b', values: [2], hidden: true }], pointers: [{ name: 'i', array: 'a', at: 0, hidden: true }], steps: [{ focus: 'a[0]', say: 'x' }] });
  const memory = await check({ type: 'memory', narration: 'n', frames: [{ name: 'main', vars: { n: 1 } }, { name: 'f', vars: {}, hidden: true }], objects: [], steps: [{ focus: 'main.n', say: 'x' }] });
  const svg = await check({ type: 'svg', narration: 'n', svg: '<svg viewBox="0 0 100 100"><rect id="a" width="10" height="10"/><rect id="b" width="10" height="10"/></svg>', hidden: ['a', 'b'], steps: [{ show: ['a'], say: 'x' }] });
  assert.deepEqual([table, array, memory, svg].map((r) => neverShown(r.warnings)), [
    ['scenes[0].rows[1].hidden: starts hidden and no step shows it, so it is never drawn'],
    ['scenes[0].pointers[0].hidden: starts hidden and no step shows it, so it is never drawn', 'scenes[0].arrays[1].hidden: starts hidden and no step shows it, so it is never drawn'],
    ['scenes[0].frames[1].hidden: starts hidden and no step shows it, so it is never drawn'],
    ['scenes[0].hidden[1]: starts hidden and no step shows it, so it is never drawn'],
  ]);
});
