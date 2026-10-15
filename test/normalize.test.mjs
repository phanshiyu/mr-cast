import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusSteps, isExplanation, normalizeStoryboard, upgradeTypes } from '../shared/normalize.mjs';

const diff = { h1: { status: 'modified' } };
const source = { s1: { status: 'source' } };

test('renames an arch scene to graph and leaves a current storyboard untouched', () => {
  assert.deepEqual(upgradeTypes({ scenes: [{ type: 'arch' }, { type: 'code' }] }), { scenes: [{ type: 'graph' }, { type: 'code' }] });
  const current = { scenes: [{ type: 'graph' }] };
  assert.equal(upgradeTypes(current), current);
});

test('an explanation is a storyboard whose hunks are all source snippets', () => {
  assert.equal(isExplanation(source), true);
  assert.equal(isExplanation({ ...source, ...diff }), false);
});

test('renames each scene type older focus key to focus', () => {
  assert.deepEqual(focusSteps({ type: 'state', steps: [{ transition: 1, say: 'x' }, { state: 'idle' }, { focus: 'a', state: 'b' }] }), [
    { say: 'x', focus: 1 },
    { focus: 'idle' },
    { focus: 'a', state: 'b' },
  ]);
});

test('turns a legacy node kind into an icon and caption without overriding explicit ones', () => {
  const out = normalizeStoryboard({ scenes: [{ type: 'arch', nodes: [{ id: 'a', kind: 'db' }, { id: 'b', kind: 'queue', icon: 'box' }] }] }, diff);
  assert.deepEqual(out.scenes[0], {
    type: 'graph',
    nodes: [
      { id: 'a', icon: 'database', caption: 'datastore' },
      { id: 'b', icon: 'box', caption: 'queue' },
    ],
  });
});

test('modified: true means a change in a diff and a highlight in an explanation', () => {
  const board = { scenes: [{ type: 'graph', nodes: [{ id: 'a', modified: true }] }] };
  assert.deepEqual(normalizeStoryboard(board, diff).scenes[0].nodes, [{ id: 'a', change: 'modified' }]);
  assert.deepEqual(normalizeStoryboard(board, source).scenes[0].nodes, [{ id: 'a', highlight: true }]);
});
