import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: [new URL('../src/utils/graphLayout.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { layoutGraph } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

// Dijkstra's example graph: a chain S, B, A, C, E by longest path, with three edges that each skip one node.
const terminal = (id) => ({ id, label: id, shape: 'terminal', badge: '0' });
const nodes = ['S', 'A', 'B', 'C', 'E'].map(terminal);
const edges = [
  ['S', 'A', '4'],
  ['S', 'B', '2'],
  ['B', 'A', '1'],
  ['B', 'C', '5'],
  ['A', 'C', '2'],
  ['A', 'E', '6'],
  ['C', 'E', '1'],
].map(([from, to, label]) => ({ from, to, label }));

const name = (r) => `${r.edge.from}->${r.edge.to}`;
const segmentDistance = (p, a, b) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
/** How many of the middle three fifths of `a`'s points lie on `b`'s route. */
const pointsOn = (a, b) => a.points.slice(Math.floor(a.points.length * 0.2), Math.ceil(a.points.length * 0.8)).filter((p) => b.points.some((q, i) => i > 0 && segmentDistance(p, b.points[i - 1], q) < 1)).length;
const sharing = (routed) => routed.flatMap((a, i) => routed.slice(i + 1).filter((b) => pointsOn(a, b) > 0).map((b) => `${name(a)} and ${name(b)}`));
const overlaps = (a, b) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;
const overlapping = (routed) => routed.flatMap((a, i) => routed.slice(i + 1).filter((b) => overlaps(a.label, b.label)).map((b) => `${name(a)} and ${name(b)}`));

test('skip edges over one row of nodes take lanes on alternate sides, so no two edges run along the same stretch', () => {
  const layout = layoutGraph(nodes, edges, 'LR');
  const top = Math.min(...layout.nodes.map((n) => n.box.y));
  const bottom = Math.max(...layout.nodes.map((n) => n.box.y + n.box.height));
  const side = (r) => (r.label.y < top ? 'above' : r.label.y > bottom ? 'below' : 'between');
  assert.deepEqual(layout.edges.map((r) => `${name(r)} ${side(r)}`), ['S->A above', 'S->B between', 'B->A between', 'B->C below', 'A->C between', 'A->E above', 'C->E between']);
  assert.deepEqual(sharing(layout.edges), []);
  assert.deepEqual(overlapping(layout.edges), []);
});

test('top to bottom the same lanes sit left and right of the column', () => {
  const layout = layoutGraph(nodes, edges, 'TB');
  const left = Math.min(...layout.nodes.map((n) => n.box.x));
  const right = Math.max(...layout.nodes.map((n) => n.box.x + n.box.width));
  const side = (r) => (r.label.x < left ? 'left' : r.label.x > right ? 'right' : 'between');
  assert.deepEqual(layout.edges.map((r) => `${name(r)} ${side(r)}`), ['S->A left', 'S->B between', 'B->A between', 'B->C right', 'A->C between', 'A->E left', 'C->E between']);
  assert.deepEqual(sharing(layout.edges), []);
  assert.deepEqual(overlapping(layout.edges), []);
});

test('a lane past the first on one side moves the graph over to hold it', () => {
  // Three skip edges over the same stretch: S->C, S->D and A->D all cross B, and the two on one side stack.
  const chain = ['S', 'A', 'B', 'C', 'D'].map(terminal);
  const stacked = [['S', 'A'], ['A', 'B'], ['B', 'C'], ['C', 'D'], ['S', 'C'], ['S', 'D'], ['A', 'D']].map(([from, to]) => ({ from, to, label: `${from}${to}` }));
  const layout = layoutGraph(chain, stacked, 'LR');
  const top = Math.min(...layout.nodes.map((n) => n.box.y));
  const bottom = Math.max(...layout.nodes.map((n) => n.box.y + n.box.height));
  const lanes = layout.edges.filter((r) => r.label.y < top || r.label.y > bottom).map((r) => `${name(r)} ${r.label.y < top ? 'above' : 'below'}`);
  assert.deepEqual(lanes, ['S->C above', 'S->D below', 'A->D above']);
  const byName = new Map(layout.edges.map((r) => [name(r), r]));
  assert.ok(byName.get('A->D').mid.y < byName.get('S->C').mid.y, 'the second lane above sits further out than the first');
  assert.ok(byName.get('A->D').mid.y >= 0, 'the outer lane stays inside the graph');
  assert.deepEqual(sharing(layout.edges), []);
  assert.deepEqual(overlapping(layout.edges), []);
});
