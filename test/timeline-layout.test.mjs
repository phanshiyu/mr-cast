import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: [new URL('../src/utils/timelineLayout.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { layoutTimeline, packRow } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

// The width of a timeline scene with a title: 1920 less the safe margins.
const WIDTH = 1712;
// Webhook backoff from a blind eval: four tries in the first 35 s of a 635 s axis drew their cards on top of each other.
const backoff = {
  type: 'timeline',
  unit: 's',
  title: 'Waits with default settings: 5 s, doubling',
  narration: 'Each wait doubles.',
  events: [0, 5, 15, 35, 75, 155, 315, 635].map((at, i) => ({ at, label: `Try ${i + 1}`, detail: i ? `after ${at - [0, 0, 5, 15, 35, 75, 155, 315][i]} s` : 'fails' })),
};

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const cross = (p1, p2, q1, q2) => {
  const side = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return side(p1, p2, q1) * side(p1, p2, q2) < 0 && side(q1, q2, p1) * side(q1, q2, p2) < 0;
};

test('events close together in time get cards side by side that never overlap, in time order', () => {
  const { events } = layoutTimeline(backoff, WIDTH);
  assert.deepEqual(events.map((e) => e.event.label), ['Try 1', 'Try 2', 'Try 3', 'Try 4', 'Try 5', 'Try 6', 'Try 7', 'Try 8']);
  const pairs = events.flatMap((a, i) => events.slice(i + 1).filter((b) => overlaps(a.box, b.box)).map((b) => `${a.event.label} and ${b.event.label}`));
  assert.deepEqual(pairs, []);
  assert.deepEqual(events.slice(1).filter((e, i) => e.box.x <= events[i].box.x + events[i].box.w).map((e) => e.event.label), []);
  for (const e of events) assert.ok(e.box.x >= 0 && e.box.x + e.box.w <= WIDTH, `${e.event.label} stays on the stage`);
});

test('every leader runs from its dot on the axis to the bottom of its own card, and no two leaders cross', () => {
  const { events, axisY } = layoutTimeline(backoff, WIDTH);
  for (const e of events) {
    const first = e.stem[0];
    const last = e.stem.at(-1);
    assert.deepEqual([first.x, first.y], [e.x, axisY], `${e.event.label} starts at its dot`);
    assert.equal(last.y, e.box.y + e.box.h, `${e.event.label} ends at its card`);
    assert.ok(last.x > e.box.x && last.x < e.box.x + e.box.w, `${e.event.label} ends under its card`);
  }
  const segments = (e) => e.stem.slice(1).map((p, i) => [e.stem[i], p]);
  const crossings = events.flatMap((a, i) =>
    events.slice(i + 1).flatMap((b) => (segments(a).some(([p1, p2]) => segments(b).some(([q1, q2]) => cross(p1, p2, q1, q2))) ? [`${a.event.label} and ${b.event.label}`] : [])),
  );
  assert.deepEqual(crossings, []);
  // The tries of the first minute had to move off their dots; the last one keeps a straight stem.
  assert.equal(events.at(-1).stem.length, 2);
  assert.equal(events[3].stem.length, 4);
});

test('events far apart keep their cards centred over their dots with straight stems', () => {
  const scene = { ...backoff, events: [{ at: 0, label: 'Start' }, { at: 300, label: 'Middle' }, { at: 600, label: 'End' }] };
  const { events } = layoutTimeline(scene, WIDTH);
  assert.deepEqual(events.map((e) => e.stem.length), [2, 2, 2]);
  assert.deepEqual(events.map((e) => Math.round(e.box.x + e.box.w / 2 - e.x)), [0, 0, 0]);
});

test('a row of boxes packs to its wishes, moving only the boxes that collide, and stays inside the width', () => {
  assert.deepEqual(packRow([{ want: 100, w: 50 }, { want: 400, w: 50 }], 10, 1000), [100, 400]);
  // Two boxes that want the same place split the difference: 60 wide plus a gap of 10 around 100.
  assert.deepEqual(packRow([{ want: 100, w: 50 }, { want: 100, w: 50 }], 10, 1000), [70, 130]);
  // A cluster against the left edge is pushed right, and one at the right edge is pulled back in.
  assert.deepEqual(packRow([{ want: -20, w: 50 }, { want: -20, w: 50 }], 10, 1000), [0, 60]);
  assert.deepEqual(packRow([{ want: 980, w: 50 }], 10, 1000), [950]);
});

test('fourteen events, too many cards for one row, put every other card below the axis with no overlap or crossing', () => {
  const scene = { ...backoff, events: Array.from({ length: 14 }, (_, i) => ({ at: i * 10, label: `Retry number ${i + 1}`, detail: 'waits again' })) };
  const { events, axisY, height } = layoutTimeline(scene, WIDTH);
  assert.equal(events.length, 14);
  const pairs = events.flatMap((a, i) => events.slice(i + 1).filter((b) => overlaps(a.box, b.box)).map((b) => `${a.event.label} and ${b.event.label}`));
  assert.deepEqual(pairs, []);
  for (const e of events) assert.ok(e.box.x >= 0 && e.box.x + e.box.w <= WIDTH && e.box.y >= 0 && e.box.y + e.box.h <= height, `${e.event.label} stays on the stage`);
  assert.deepEqual(events.map((e) => (e.box.y < axisY ? 'above' : 'below')), Array.from({ length: 14 }, (_, i) => (i % 2 ? 'below' : 'above')));
  for (const e of events) {
    const last = e.stem.at(-1);
    assert.deepEqual([e.stem[0].x, e.stem[0].y], [e.x, axisY], `${e.event.label} starts at its dot`);
    assert.equal(last.y, e.box.y < axisY ? e.box.y + e.box.h : e.box.y, `${e.event.label} ends at its card`);
  }
  const segments = (e) => e.stem.slice(1).map((p, i) => [e.stem[i], p]);
  const crossings = events.flatMap((a, i) =>
    events.slice(i + 1).flatMap((b) => (segments(a).some(([p1, p2]) => segments(b).some(([q1, q2]) => cross(p1, p2, q1, q2))) ? [`${a.event.label} and ${b.event.label}`] : [])),
  );
  assert.deepEqual(crossings, []);
  // A leader never runs through another card.
  const through = events.flatMap((a) => events.filter((b) => b !== a && segments(a).some(([p, q]) => overlaps({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x) || 0.1, h: Math.abs(q.y - p.y) || 0.1 }, b.box))).map((b) => `${a.event.label} through ${b.event.label}`));
  assert.deepEqual(through, []);
});

test('a timeline counts in weeks, months or years, its ticks and stamps in that unit', async () => {
  const { validateStoryboard } = await import('../bin/lib/validate.mjs');
  const career = {
    type: 'timeline',
    unit: 'yr',
    title: 'A mortgage',
    narration: 'Thirty years of payments.',
    events: [
      { at: 0, label: 'Buy' },
      { at: 12, label: 'Refinance' },
      { at: 30, label: 'Paid off' },
    ],
    spans: [{ from: 0, to: 12, label: 'first loan' }],
  };
  const { errors } = await validateStoryboard({ title: 't', scenes: [career] }, {}, { mode: 'explain' });
  assert.deepEqual(errors, []);
  const layout = layoutTimeline(career, WIDTH);
  assert.deepEqual(layout.ticks.map((t) => t.text), ['0 yr', '10 yr', '20 yr', '30 yr']);
  assert.deepEqual(layout.events.map((e) => e.stamp), ['0 yr', '12 yr', '30 yr']);
  for (const unit of ['wk', 'mo']) {
    const { errors: unitErrors } = await validateStoryboard({ title: 't', scenes: [{ ...career, unit }] }, {}, { mode: 'explain' });
    assert.deepEqual(unitErrors, [], unit);
  }
  const { errors: bad } = await validateStoryboard({ title: 't', scenes: [{ ...career, unit: 'years' }] }, {}, { mode: 'explain' });
  assert.deepEqual(bad, ['scenes[0].unit: must be one of ms, s, min, h, d, wk, mo, yr']);
});
