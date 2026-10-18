import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const list = (...args) => {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts/render-examples.mjs'), 'unused', '--list', ...args], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim().split('\n');
};

test('render-examples takes each example audience from its meta.json', () => {
  const lines = list();
  assert.deepEqual(lines.filter((l) => l.includes('--audience')), ['preread --audience preread', 'primitives-reading --audience preread']);
  assert.ok(lines.includes('primitives-array'));
  assert.ok(lines.includes('algorithms-dijkstra'));
});

test('render-examples shards split every example once', () => {
  const shards = [1, 2, 3, 4, 5, 6].map((i) => list('--shard', `${i}/6`));
  assert.deepEqual(shards.flat().sort(), list().sort());
  // Shards balance spoken words, not counts, so each holds roughly a sixth of the examples.
  const sixth = list().length / 6;
  for (const shard of shards) assert.ok(shard.length >= sixth / 2 && shard.length <= sixth * 1.5, `shard of ${shard.length}, against a sixth of ${sixth}`);
});

test('render-examples refuses a shard past the count', () => {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts/render-examples.mjs'), 'unused', '--shard', '7/6', '--list'], { encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage:/);
});
