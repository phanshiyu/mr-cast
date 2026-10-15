import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refNames, resolveRef, stepTargets, targetSteps } from '../shared/targets.mjs';

const graph = {
  type: 'graph',
  nodes: [{ id: 'api', group: 'edge' }, { id: 'db-main' }, { id: 'cache' }],
  edges: [{ from: 'api', to: 'db-main' }, { from: 'cache', to: 'api', direction: 'both' }],
  steps: [{ focus: 'api' }, { focus: ['api->db-main', 'group:edge'] }, { focus: 'nothing' }],
};

test('resolves graph refs to node, group and edge keys', () => {
  assert.deepEqual(resolveRef(graph, 'api'), ['n:api']);
  assert.deepEqual(resolveRef(graph, 'group:edge'), ['g:edge']);
  assert.deepEqual(resolveRef(graph, 1), ['e:1']);
  assert.deepEqual(resolveRef(graph, '1'), ['e:1']);
  assert.equal(resolveRef(graph, 'group:none'), null);
});

test('a directed edge ref matches a reversed edge only when the edge runs both ways', () => {
  assert.deepEqual(resolveRef(graph, 'api->db-main'), ['e:0']);
  assert.equal(resolveRef(graph, 'db-main->api'), null);
  assert.deepEqual(resolveRef(graph, 'api->cache'), ['e:1']);
  assert.deepEqual(resolveRef(graph, 'db-main-api'), ['e:0']);
});

test('resolves a sequence message range to each message', () => {
  const seq = { type: 'sequence', participants: [{ id: 'u' }], messages: [{}, {}, {}] };
  assert.deepEqual(resolveRef(seq, '0-2'), ['m:0', 'm:1', 'm:2']);
  assert.equal(resolveRef(seq, '1-3'), null);
  assert.deepEqual(resolveRef(seq, 'u'), ['p:u']);
});

test('resolves table cells, columns and rows', () => {
  const table = { type: 'table', columns: ['name', 'size'], rows: [[], []] };
  assert.deepEqual(resolveRef(table, 'size@1'), ['x:1/1']);
  assert.deepEqual(resolveRef(table, 'col:name'), ['c:0']);
  assert.deepEqual(resolveRef(table, 0), ['r:0']);
  assert.equal(resolveRef(table, 'size@5'), null);
});

test('an unknown scene type resolves nothing', () => {
  assert.equal(resolveRef({ type: 'code' }, 'x'), null);
});

test('stepTargets and targetSteps map steps to lit items both ways', () => {
  assert.deepEqual(stepTargets(graph), [['n:api'], ['e:0', 'g:edge'], []]);
  assert.deepEqual([...targetSteps(graph)], [
    ['n:api', [0]],
    ['e:0', [1]],
    ['g:edge', [1]],
  ]);
});

test('refNames suggests node ids, groups and edge pairs', () => {
  assert.deepEqual(refNames(graph), ['api', 'db-main', 'cache', 'group:edge', 'api->db-main', 'cache->api']);
});
