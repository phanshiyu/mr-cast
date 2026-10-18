// Writes storyboard.json, hunks.json and meta.json beside this file: why a square wave is a sum of sine waves. Every
// number on screen and in the words is computed here, through shared/expr.mjs, the parser the plot scene draws with,
// and checked against the known results.
//
// Sources for the facts asserted below:
// - The square wave sign(sin x) has the Fourier series (4/π) Σ sin(kx)/k over odd k, and no even terms. Any text on
//   Fourier series derives it; e.g. E. Kreyszig, Advanced Engineering Mathematics, 10th ed., section 11.1, example 1.
//   It is recomputed here: each wave's height is (1/π) ∫ f(x) sin(kx) dx over one period, by numerical integration.
// - The overshoot at a jump tends to (2/π)·Si(π) ≈ 1.17898 for a jump from −1 to 1, about 8.95% of the jump, however
//   many terms are added: the Gibbs phenomenon. H. Wilbraham, "On a certain periodic function", Cambridge and Dublin
//   Mathematical Journal 3 (1848), 198-201; J. W. Gibbs, "Fourier's series", Nature 59 (1899), 606; and E. Hewitt and
//   R. E. Hewitt, "The Gibbs-Wilbraham phenomenon: an episode in Fourier analysis", Archive for History of Exact
//   Sciences 21 (1979), 129-160. Si(π) is computed here by Simpson's rule.
// Run: node examples/math/fourier/generate.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exprOf } from '../../../shared/expr.mjs';

const at = (expr, scope) => exprOf(expr).fn(scope);
const f2 = (v) => v.toFixed(2);
const f3 = (v) => v.toFixed(3);

// Simpson's rule over [a, b] with n (even) slices.
const integrate = (f, a, b, n = 20000) => {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
};

// ---------- each wave's height, from the square wave itself ----------
const square = (x) => Math.sign(Math.sin(x));
const height = (k) => integrate((x) => square(x) * Math.sin(k * x), 0, 2 * Math.PI) / Math.PI;
const ODD = [1, 3, 5, 7, 9, 11];
const heights = ODD.map(height);
for (const [i, k] of ODD.entries()) assert.ok(Math.abs(heights[i] - 4 / (Math.PI * k)) < 1e-6, `height of sin ${k}x`);
for (const k of [2, 4, 6]) assert.ok(Math.abs(height(k)) < 1e-9, `no sin ${k}x`);
assert.equal(f3(heights[0]), '1.273');

// ---------- the partial sums, as the scene draws them ----------
// n is how many odd waves are added: sin x, sin 3x, ..., sin (2n − 1)x.
const SUM = 'sum(j, 1, n, 4 / (pi * (2*j - 1)) * sin((2*j - 1) * x))';
const sumAt = (xExpr) => SUM.replaceAll('* x', `* (${xExpr})`);
const middle = (n) => at(SUM, { n, x: Math.PI / 2 });
// The research's figures: 1.2732 with one wave, 0.8488 with two, 1.1035 with three, 1.0244 with thirteen (k ≤ 25).
assert.equal(middle(1).toFixed(4), '1.2732');
assert.equal(middle(2).toFixed(4), '0.8488');
assert.equal(middle(3).toFixed(4), '1.1035');
assert.equal(middle(13).toFixed(4), '1.0244');

// The highest the sum climbs before the jump at x = π, found on a fine grid; it sits at x = π − π/(2n).
const peakOf = (n) => {
  let best = { x: 0, y: -Infinity };
  for (let i = 1; i <= 40000; i++) {
    const x = Math.PI / 2 + (i / 40000) * (Math.PI / 2);
    const y = at(SUM, { n, x });
    if (y > best.y) best = { x, y };
  }
  return best;
};
const PEAK_N = [5, 13, 50, 200];
const peaks = PEAK_N.map(peakOf);
for (const [i, n] of PEAK_N.entries()) assert.ok(Math.abs(peaks[i].x - (Math.PI - Math.PI / (2 * n))) < 2e-4, `peak of ${n} at ${peaks[i].x}`);
const si = (z) => integrate((t) => (t === 0 ? 1 : Math.sin(t) / t), 0, z);
const limit = (2 / Math.PI) * si(Math.PI);
assert.equal(limit.toFixed(5), '1.17898');
const overshoot = (limit - 1) / 2;
assert.equal((overshoot * 100).toFixed(2), '8.95');
// Every peak from 13 waves on rounds to the limit's 1.18; the bump's width shrinks as 1/n.
for (const p of peaks.slice(1)) assert.equal(f2(p.y), f2(limit));
assert.ok(peaks[3].y - limit < 1e-4);

// ---------- scenes ----------
const AXES = {
  x: { from: 0, to: 2 * Math.PI, ticks: 'pi' },
  y: { from: -1.5, to: 1.5, ticks: 0.5, grid: true },
};
const SQUARE = { id: 'square', y: 'sign(sin(x))', tone: 'neutral', dashed: true };

const hook = {
  type: 'text',
  chapter: 'The puzzle',
  narration: 'Here is a strange claim. Take waves that are perfectly smooth, add enough of them, and you get a shape with a sharp jump in it.',
  kicker: 'A puzzle',
  question: 'Can smooth waves add up to a sharp jump?',
  sides: [
    { label: 'a sine wave', term: 'smooth', note: 'no corners anywhere', tone: 'accent' },
    { label: 'a square wave', term: 'jumps', note: 'straight down, in no time', tone: 'warn' },
  ],
  hidden: ['left', 'right'],
  steps: [
    { show: ['left'], say: 'A sine wave bends gently, everywhere. It never has a corner.' },
    { show: ['right'], say: 'A square wave sits flat, then jumps straight down, then jumps back up.' },
    { focus: ['question'], say: 'Adding smooth things should give something smooth. So how could this ever work? Let us try it and see.' },
  ],
};

const oneWave = {
  type: 'plot',
  chapter: 'One wave',
  title: 'The best single wave',
  narration: 'The dashed grey line is our target, the square wave. It is one for half the time, then minus one.',
  ...AXES,
  params: { a: 1 },
  functions: [{ ...SQUARE, label: 'square wave' }, { id: 'wave', y: 'a * sin(x)', label: '{a:2} × sin x' }],
  points: [
    { id: 'middle', at: ['pi/2', 'a'], label: '{a:2}', side: 'above', hidden: true },
    { id: 'edge', at: [0.4, 'a * sin(0.4)'], label: '{a * sin(0.4):2}', side: 'right', tone: 'warn', hidden: true },
  ],
  steps: [
    { trace: ['wave'], focus: ['wave', 'square'], say: 'Start with the plainest wave there is, sin x. It goes up when the square wave is up, and down when it is down.' },
    { set: { a: 4 / Math.PI }, focus: ['wave'], callout: `best height: 4 ÷ π = ${f2(4 / Math.PI)}`, say: `Now stretch it until it matches the target as well as one wave can. That happens at a height of four over pi, about ${f2(4 / Math.PI)}.` },
    { show: ['middle'], focus: ['middle'], say: `It is not a good match yet. In the middle it climbs to ${f2(middle(1))}, too high.`, draw: [{ circle: 'middle', when: 'too high' }] },
    { show: ['edge'], focus: ['edge'], say: `And near the jump it is far too low, only ${f2((4 / Math.PI) * Math.sin(0.4))}.`, draw: [{ write: 'too low', near: 'edge', side: 'below', when: 'far too low' }] },
  ],
};

const addWaves = {
  type: 'plot',
  chapter: 'Adding waves',
  title: 'Add faster, smaller waves',
  narration: 'To fix it, we add a second wave, three times as fast and one third as tall.',
  ...AXES,
  params: { n: 1 },
  functions: [
    SQUARE,
    { id: 'next', y: '4 / (pi * (2*n + 1)) * sin((2*n + 1) * x)', label: 'next wave', tone: 'accent', dashed: true },
    { id: 'wave', y: SUM, label: 'waves added: {n:0}' },
  ],
  points: [{ id: 'middle', at: ['pi/2', sumAt('pi/2')], label: '{' + sumAt('pi/2') + ':2}', side: 'above' }],
  callout: 'sin x + sin 3x ÷ 3 + sin 5x ÷ 5 + …',
  steps: [
    { trace: ['next'], focus: ['next'], say: 'Here is that small, fast wave on its own. Notice it dips in the middle and rises near the edges, just where our first wave was wrong.' },
    { set: { n: 2 }, hide: ['next'], focus: ['wave', 'middle'], say: `Add it in. The middle drops from ${f2(middle(1))} to ${f2(middle(2))}, now a little too low, and the shoulders lift.` },
    { set: { n: 3 }, focus: ['wave', 'middle'], say: `Then add one five times as fast and one fifth as tall. With it, the middle comes back up to ${f2(middle(3))}.` },
    { set: { n: 5 }, focus: ['wave', 'middle'], say: `Each wave fixes some of the last one's mistake. With five, the middle is ${f2(middle(5))} and the sides are getting steep.` },
  ],
};

const recipe = {
  type: 'chart',
  chapter: 'The recipe',
  title: 'How tall each wave is',
  kind: 'bar',
  narration: 'So what is the recipe? Measure how much each wave lines up with the square wave, and that tells you how tall to make it.',
  labels: ODD.map((k) => (k === 1 ? 'sin x' : `sin ${k}x`)),
  series: [{ name: 'height', values: [Number(f3(heights[0])), 0, 0, 0, 0, 0], tone: 'accent' }],
  callout: 'height = 4 ÷ (π × k)',
  steps: [
    { focus: 'sin x', say: `The first wave lines up best, so it is the tallest, ${f2(heights[0])}.` },
    { set: { 'height@sin 3x': Number(f3(heights[1])), 'height@sin 5x': Number(f3(heights[2])) }, say: 'The wave three times as fast gets a third of that. Five times as fast, a fifth.' },
    { set: { height: heights.map((h) => Number(f3(h))) }, say: 'And so on, smaller and smaller, forever.' },
    { focus: ['sin x', 'sin 3x'], draw: [{ write: 'no sin 2x, no sin 4x', near: 'height@sin 7x', side: 'above', when: 'two or four' }], say: 'Notice the list skips from one to three to five. What about waves two or four times as fast? They line up with the top half exactly as much as they fight it, so they cancel out. Their height is zero. Only the odd ones are in the recipe.' },
  ],
};

const jump = {
  type: 'plot',
  chapter: 'The jump',
  title: 'Zoom in on the jump',
  narration: `Here is the middle of the picture, around the jump. Let us keep adding waves. With thirteen of them, the fastest is twenty five times as fast as the first, and the middle is ${f2(middle(13))}, almost exactly one.`,
  // Half a period around the jump at π: the plot samples each line at a fixed count across its range, so a narrower
  // range keeps fifty waves smooth under the camera's zoom.
  x: { from: Math.PI / 2, to: (3 * Math.PI) / 2, ticks: 'pi' },
  y: AXES.y,
  params: { n: 13 },
  functions: [SQUARE, { id: 'wave', y: SUM, label: 'waves added: {n:0}' }],
  points: [
    { id: 'peak', at: ['pi - pi/(2*n)', sumAt('pi - pi/(2*n)')], label: '{' + sumAt('pi - pi/(2*n)') + ':3}', side: 'left', tone: 'warn', hidden: true },
  ],
  steps: [
    { show: ['peak'], camera: { on: 'peak', zoom: 3 }, focus: ['peak'], say: `But look closely at the jump. Just before it, the sum shoots past one, up to ${f2(peaks[1].y)}.` },
    { set: { n: 50 }, focus: ['peak'], say: `Surely more waves fix that. Here are fifty. The bump gets thinner and moves closer to the jump, but it is still ${f2(peaks[2].y)} tall.`, draw: [{ write: 'still there', near: 'peak', side: 'right', when: 'still' }] },
    { camera: 'all', erase: true, callout: `overshoot: ${Math.round(overshoot * 100)}% of the jump`, focus: ['wave'], say: 'Everywhere else the sum gets as close as you like. At the jump, it always overshoots by about nine percent of the jump.' },
  ],
};

const bump = {
  type: 'table',
  chapter: 'The bump that stays',
  title: 'More waves, same overshoot',
  narration: 'Here are the numbers. For each count of waves, how high the bump climbs, and how far it sits from the jump.',
  columns: ['waves', 'top of the bump', 'distance from the jump'],
  rows: PEAK_N.map((n, i) => ({ cells: [String(n), f3(peaks[i].y), f3(Math.PI / (2 * n))], hidden: true })),
  callout: `limit: ${f3(limit)}`,
  steps: [
    { show: [0, 1], say: `Five waves, ${f3(peaks[0].y)}. Thirteen, ${f3(peaks[1].y)}.` },
    { show: [2, 3], say: `Fifty, ${f3(peaks[2].y)}. Two hundred, ${f3(peaks[3].y)}. The height settles and stops falling.` },
    { focus: ['col:distance from the jump'], say: 'Meanwhile the bump squeezes toward the jump, a quarter as far away for four times the waves.' },
    { focus: ['col:top of the bump'], tint: { 'top of the bump@3': 'warn' }, say: `The height heads to ${f3(limit)}, never to one. People call this the Gibbs phenomenon.` },
  ],
};

const takeaway = {
  type: 'text',
  chapter: 'What to keep',
  narration: 'So, can smooth waves make a sharp jump? Almost.',
  kicker: 'The answer',
  headline: 'Smooth waves can build a jump, almost',
  items: [
    'Each odd wave is a third, a fifth, a seventh as tall as the first',
    'Each one fixes part of the mistake the others leave',
    `At the jump the sum always overshoots by about ${Math.round(overshoot * 100)}%`,
  ],
  hidden: ['0-2'],
  steps: [
    { show: [0], say: 'The recipe is simple: the odd waves, each one a third, a fifth, a seventh as tall.' },
    { show: [1], say: 'Every wave you add fixes part of what the others got wrong.' },
    { show: [2], say: 'And right at the jump there is one mistake no amount of waves can fix: an overshoot of about nine percent, that only gets thinner.' },
  ],
};

const storyboard = {
  title: 'A square wave from sine waves',
  subtitle: 'How smooth waves add up to a sharp jump, and the bump that never goes away',
  scenes: [hook, oneWave, addWaves, recipe, jump, bump, takeaway],
};
const here = (f) => new URL(f, import.meta.url);
fs.writeFileSync(here('storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
fs.writeFileSync(here('hunks.json'), '{}\n');
fs.writeFileSync(here('meta.json'), `${JSON.stringify({ mode: 'explain' })}\n`);
console.log(`heights: ${heights.map(f3).join(', ')}`);
console.log(`middle at 1, 2, 3, 5, 13 waves: ${[1, 2, 3, 5, 13].map((n) => middle(n).toFixed(4)).join(', ')}`);
console.log(`peaks at ${PEAK_N.join(', ')} waves: ${peaks.map((p) => p.y.toFixed(4)).join(', ')}; limit ${limit.toFixed(5)}; overshoot ${(overshoot * 100).toFixed(2)}%`);
