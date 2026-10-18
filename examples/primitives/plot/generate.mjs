// Writes storyboard.json, hunks.json and meta.json beside this file, the plot scene's demo. Every number on screen and
// in the words is computed here, and checked against the same expressions the scene draws, through shared/expr.mjs.
// Run: node examples/primitives/plot/generate.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exprOf } from '../../../shared/expr.mjs';

const at = (expr, scope) => exprOf(expr).fn(scope);
const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

// ---------- a square wave as a sum of sine waves ----------
// The partial sum of 4/(πk)·sin(kx) over the first n odd k.
const SUM = 'sum(j, 1, n, 4 / (pi * (2*j - 1)) * sin((2*j - 1) * x))';
const TERMS = [1, 3, 5, 15];
const middle = TERMS.map((n) => at(SUM, { n, x: Math.PI / 2 }));
// The highest the sum climbs past the jump at x = 0: its first peak, found on a fine grid.
const peakOf = (n) => {
  let best = { x: 0, y: -Infinity };
  for (let i = 1; i <= 20000; i++) {
    const x = (i / 20000) * (Math.PI / 2);
    const y = at(SUM, { n, x });
    if (y > best.y) best = { x, y };
  }
  return best;
};
const peak = peakOf(15);
// The first peak sits at x = π/(2n): checked, so the point the scene places there is on the curve's top.
assert.ok(Math.abs(peak.x - Math.PI / 30) < 1e-3, `first peak at ${peak.x}`);
assert.equal(middle[0].toFixed(4), '1.2732');
assert.equal(middle[1].toFixed(4), '1.1035');
const overshoot = (peak.y - 1) / 2;
assert.ok(overshoot > 0.088 && overshoot < 0.091, `overshoot ${overshoot}`);

const fourier = {
  type: 'plot',
  chapter: 'Fourier',
  title: 'A square wave from sine waves',
  narration: 'The grey line jumps between one and minus one. We will build it out of smooth sine waves.',
  x: { from: 0, to: 2 * Math.PI, ticks: 'pi' },
  y: { from: -1.5, to: 1.5, ticks: 0.5, grid: true },
  params: { n: 1 },
  functions: [
    { id: 'square', y: 'sign(sin(x))', tone: 'neutral', dashed: true },
    { id: 'wave', y: SUM, label: 'n = {n:0}' },
  ],
  points: [
    { id: 'middle', at: ['pi/2', SUM.replaceAll('* x', '* pi/2')], label: '{' + SUM.replaceAll('* x', '* pi/2') + ':3}', side: 'above', hidden: true },
    { id: 'peak', at: ['pi/(2*n)', SUM.replaceAll('* x', '* pi/(2*n)')], label: '{' + SUM.replaceAll('* x', '* pi/(2*n)') + ':3}', side: 'right', tone: 'warn', hidden: true },
  ],
  callout: 'sin x + sin 3x / 3 + sin 5x / 5 + …',
  steps: [
    { trace: ['wave'], say: 'One sine wave already rises and falls in step with the square wave.' },
    { show: ['middle'], focus: ['middle'], say: `In the middle it reaches ${middle[0].toFixed(2)}, too high.` },
    { set: { n: 3 }, focus: ['wave', 'middle'], say: `Add the next two odd waves and the shoulders flatten. The middle drops to ${middle[1].toFixed(2)}.` },
    { set: { n: 5 }, focus: ['wave', 'middle'], say: 'Five waves, and the sides get steeper.' },
    { set: { n: 15 }, focus: ['wave', 'middle'], say: `With fifteen it hugs the square wave, ${middle[3].toFixed(3)} in the middle.` },
    {
      hide: ['middle'],
      show: ['peak'],
      focus: ['peak'],
      callout: `peak ${peak.y.toFixed(3)}: ${Math.round(overshoot * 100)}% of the jump`,
      say: `Except right at the jump, where it overshoots to ${peak.y.toFixed(2)}. More waves move that bump closer to the jump, but never shrink it.`,
    },
  ],
};

// ---------- compound interest against inflation ----------
const GROW = '10000 * 1.07^x';
const REAL = '10000 * (1.07 / 1.03)^x';
const grown = (t) => at(GROW, { x: t });
const real = (t) => at(REAL, { x: t });
assert.equal(grown(10).toFixed(2), '19671.51');
assert.equal(grown(30).toFixed(2), '76122.55');
assert.equal(real(30).toFixed(2), '31361.48');
const exactDouble = Math.log(2) / Math.log(1.07);
assert.equal(exactDouble.toFixed(2), '10.24');
const ruleOf72 = 72 / 7;

const interest = {
  type: 'plot',
  chapter: 'Compound interest',
  title: '$10,000 at 7% a year',
  narration: 'Put ten thousand dollars somewhere that grows seven percent a year, and leave it alone.',
  x: { from: 0, to: 30, ticks: 5, label: 'years' },
  y: { from: 0, to: 80000, ticks: 20000, prefix: '$', grid: true },
  params: { year: 0 },
  functions: [
    { id: 'growth', y: GROW, label: 'at 7%' },
    { id: 'today', y: REAL, label: "in today's dollars", tone: 'good' },
  ],
  areas: [{ id: 'gap', between: ['growth', 'today'], tone: 'warn', hidden: true }],
  points: [{ id: 'marker', at: ['year', GROW.replaceAll('x', 'year')], label: '${' + GROW.replaceAll('x', 'year') + ':0}', side: 'left', guides: true, hidden: true }],
  steps: [
    { trace: ['growth'], set: { year: 30 }, show: ['marker'], say: `Year by year it bends upward, to ${money(grown(30))} after thirty years.` },
    { set: { year: 10 }, focus: ['marker'], callout: `72 ÷ 7 = ${ruleOf72.toFixed(1)} years · exact ${exactDouble.toFixed(2)}`, say: `It doubles in about ten years, to ${money(grown(10))}. The rule of seventy two says the same.` },
    { trace: ['today'], focus: ['today'], callout: '', say: `But prices rise three percent a year. In today's money the thirty year total is worth ${money(real(30))}.` },
    { show: ['gap'], focus: ['gap', 'growth', 'today'], say: 'The shaded gap is what inflation takes.' },
  ],
};

const storyboard = {
  title: 'Plot scene',
  subtitle: 'Curves that reshape as a parameter changes, and a marker that rides a growing line',
  scenes: [fourier, interest],
};
const here = (f) => new URL(f, import.meta.url);
fs.writeFileSync(here('storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
fs.writeFileSync(here('hunks.json'), '{}\n');
fs.writeFileSync(here('meta.json'), `${JSON.stringify({ mode: 'explain' })}\n`);
console.log(`middle at 1, 3, 5, 15 waves: ${middle.map((v) => v.toFixed(4)).join(', ')}; peak ${peak.y.toFixed(4)} at x = ${peak.x.toFixed(4)}; overshoot ${(overshoot * 100).toFixed(2)}%`);
console.log(`growth 10, 30: ${money(grown(10))}, ${money(grown(30))}; today's dollars at 30: ${money(real(30))}; doubling ${exactDouble.toFixed(2)} (rule of 72: ${ruleOf72.toFixed(2)})`);
