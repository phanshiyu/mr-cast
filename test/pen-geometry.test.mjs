import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: [new URL('../src/utils/penGeometry.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { sketchMark } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const area = { x: 0, y: 0, width: 1600, height: 700 };
// A row of array cells 190 by 122, 10 apart, whose text starts 12 in from each edge.
const cell = (i) => ({ x: 100 + 200 * i, y: 300, width: 190, height: 122 });
const row = [0, 1, 2, 3, 4].map(cell);
const inside = (p, b) => p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height;

test('a circle on a cell in a dense row stays out of its neighbours\' text and off the cell', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { strokes } = sketchMark('circle', row[2], area, row, seed, 5);
    const points = strokes.flatMap((s) => s.points);
    const xs = points.map((p) => p.x);
    assert.ok(Math.min(...xs) >= row[1].x + row[1].width - 12, `seed ${seed}: reaches ${Math.round(row[2].x - Math.min(...xs))} px left of the cell`);
    assert.ok(Math.max(...xs) <= row[3].x + 12, `seed ${seed}: reaches ${Math.round(Math.max(...xs) - row[2].x - row[2].width)} px right of the cell`);
    assert.deepEqual(points.filter((p) => inside(p, row[2])), []);
  }
});

test('a circle with nothing beside it stays an ellipse with room around the target', () => {
  const alone = cell(2);
  const { strokes } = sketchMark('circle', alone, area, [alone], 1, 5);
  const xs = strokes.flatMap((s) => s.points).map((p) => p.x);
  assert.ok(alone.x - Math.min(...xs) > 25);
});
