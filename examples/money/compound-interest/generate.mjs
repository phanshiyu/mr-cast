// Writes storyboard.json, hunks.json and meta.json beside this file: compound interest against inflation, and the
// rule of 72. Every number on screen and in the words is computed here, the curves through shared/expr.mjs, the
// parser the plot scene draws with, and checked below.
//
// The growth rate (7% a year) and inflation (3% a year) are round assumptions for the example, not forecasts. The
// formulas are the standard ones: a balance after t years at rate r is P(1 + r)^t, its value in today's money divides
// by (1 + i)^t for inflation i, and the real rate is (1 + r)/(1 + i) − 1 (the Fisher relation; I. Fisher, The Theory
// of Interest, 1930, chapter II). The rule of 72 approximates the doubling time ln 2 / ln(1 + r) by 72 / (100 r); its
// first known statement is in L. Pacioli, Summa de arithmetica (1494), and the error table below is computed, not
// quoted. Run: node examples/money/compound-interest/generate.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exprOf } from '../../../shared/expr.mjs';

const at = (expr, scope) => exprOf(expr).fn(scope);
const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
const cents = (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const P = 10000;
const RATE = 0.07;
const INFLATION = 0.03;

// ---------- the balance, nominal and in today's money ----------
const GROW = '10000 * 1.07^x';
const REAL = '10000 * (1.07 / 1.03)^x';
const SIMPLE = '10000 + 700 * x';
const grown = (t) => at(GROW, { x: t });
const real = (t) => at(REAL, { x: t });
const simple = (t) => at(SIMPLE, { x: t });
for (const t of [0, 7, 30]) assert.ok(Math.abs(grown(t) - P * (1 + RATE) ** t) < 1e-6);
// The research's figures (docs/research/youtube-devices.md, E4).
assert.equal(grown(10).toFixed(2), '19671.51');
assert.equal(grown(20).toFixed(2), '38696.84');
assert.equal(grown(30).toFixed(2), '76122.55');
assert.equal(real(10).toFixed(2), '14637.45');
assert.equal(real(20).toFixed(2), '21425.50');
assert.equal(real(30).toFixed(2), '31361.48');
assert.equal(simple(30), 31000);

// ---------- the first three years, worked by hand ----------
const years = [];
for (let y = 1, start = P; y <= 3; y++) {
  const interest = Math.round(start * RATE * 100) / 100;
  years.push({ y, start, interest, end: Math.round((start + interest) * 100) / 100 });
  start = years.at(-1).end;
}
assert.deepEqual(years.map((r) => r.interest), [700, 749, 801.43]);
assert.equal(years[2].end.toFixed(2), grown(3).toFixed(2));

// ---------- the rule of 72 against the exact doubling time ----------
const exactDouble = (r) => Math.log(2) / Math.log(1 + r);
const RATES = [2, 4, 7, 10, 12];
const rule = RATES.map((p) => 72 / p);
const exact = RATES.map((p) => exactDouble(p / 100));
assert.equal(exactDouble(RATE).toFixed(2), '10.24');
assert.equal((72 / 7).toFixed(1), '10.3');
// Within a year of the exact answer at every rate shown, and within a month at 7%.
for (const [i, p] of RATES.entries()) assert.ok(Math.abs(rule[i] - exact[i]) < 1, `rule of 72 at ${p}%`);
assert.ok(Math.abs(72 / 7 - exactDouble(RATE)) * 12 < 1);
const oneDecimal = (v) => Math.round(v * 10) / 10;

// ---------- inflation ----------
const realRate = (1 + RATE) / (1 + INFLATION) - 1;
assert.equal((realRate * 100).toFixed(2), '3.88');
const realDouble = exactDouble(realRate);
assert.equal(realDouble.toFixed(1), '18.2');
const priceLevel30 = (1 + INFLATION) ** 30;
assert.equal(priceLevel30.toFixed(2), '2.43');
const lost = (t) => 1 - real(t) / grown(t);
assert.equal(Math.round(lost(30) * 100), 59);

// ---------- scenes ----------
const hook = {
  type: 'text',
  chapter: 'The question',
  narration: 'Say you put ten thousand dollars away today, in something that grows seven percent a year, and you do not touch it.',
  kicker: 'Put away today',
  number: '$10,000',
  note: 'growing 7% a year, untouched',
  steps: [
    { set: { number: money(grown(30)), note: 'thirty years later, on paper' }, say: `Thirty years later, the statement says ${money(grown(30))}. More than seven times what you put in.` },
    { set: { kicker: 'But what will it buy?' }, focus: ['kicker'], say: 'That sounds great. But prices rise too. So how much of that is real? Let us work it out, one piece at a time.' },
  ],
};

const firstYears = {
  type: 'table',
  chapter: 'Interest on interest',
  title: 'The first three years at 7%',
  narration: 'First, where the growth comes from. Here are the first three years, worked out by hand.',
  columns: ['year', 'start', 'interest', 'end'],
  rows: years.map((r) => ({ cells: [String(r.y), cents(r.start), cents(r.interest), cents(r.end)], hidden: true })),
  steps: [
    { show: [0], say: `In year one, seven percent of ten thousand is ${money(years[0].interest)}. You end the year with ${money(years[0].end)}.` },
    { show: [1], focus: ['interest@1'], say: `In year two you earn seven percent of the new total, which is ${money(years[1].interest)}. Forty nine dollars more, because last year's interest is earning too.` },
    { show: [2], focus: ['interest@2'], say: `Year three pays ${cents(years[2].interest)}. Each year's interest is bigger than the last.`, callout: 'interest earns interest' },
  ],
};

const thirtyYears = {
  type: 'plot',
  chapter: 'Interest on interest',
  title: 'Thirty years of growth',
  narration: 'Now stretch that over thirty years. The dashed line is what you would get if only the first ten thousand earned interest, seven hundred dollars every year.',
  x: { from: 0, to: 30, ticks: 5, label: 'years' },
  y: { from: 0, to: 80000, ticks: 20000, prefix: '$', grid: true },
  params: { year: 0 },
  functions: [
    { id: 'simple', y: SIMPLE, label: 'no interest on interest', tone: 'neutral', dashed: true },
    { id: 'growth', y: GROW, label: 'at 7%', hidden: true },
  ],
  areas: [{ id: 'extra', between: ['growth', 'simple'], tone: 'accent', hidden: true }],
  points: [{ id: 'marker', at: ['year', GROW.replaceAll('x', 'year')], label: '${' + GROW.replaceAll('x', 'year') + ':0}', side: 'left', guides: true, hidden: true }],
  steps: [
    { focus: ['simple'], say: `That straight line ends at ${money(simple(30))}.` },
    { trace: ['growth'], set: { year: 30 }, show: ['marker'], focus: ['growth', 'marker'], say: `Compounding bends the line upward. It starts slow, then climbs faster every year, to ${money(grown(30))}.` },
    { show: ['extra'], focus: ['extra'], say: `The shaded gap, ${money(grown(30) - simple(30))}, is interest earned on interest.` },
  ],
};

const doubling = {
  type: 'chart',
  chapter: 'The rule of 72',
  title: 'Years to double your money',
  kind: 'bar',
  unit: ' yr',
  badges: false,
  narration: 'There is a shortcut for how fast this grows. Divide seventy two by the growth rate, and you get roughly how many years it takes to double.',
  labels: RATES.map((p) => `${p}%`),
  series: [
    { name: 'rule of 72', values: rule.map(oneDecimal), tone: 'accent' },
    { name: 'exact', values: RATES.map(() => 0), tone: 'good' },
  ],
  callout: 'years to double ≈ 72 ÷ rate',
  steps: [
    { focus: ['rule of 72@7%'], callout: `72 ÷ 7 = ${(72 / 7).toFixed(1)} years`, camera: { on: '7%', zoom: 2 }, say: `At seven percent, seventy two divided by seven is ${(72 / 7).toFixed(1)} years.` },
    { set: { exact: exact.map(oneDecimal) }, focus: ['exact@7%'], callout: `exact: ${exactDouble(RATE).toFixed(2)} years`, say: `The exact answer is ${exactDouble(RATE).toFixed(2)} years. Less than a month apart.` },
    { camera: 'all', focus: ['series:exact'], callout: 'years to double ≈ 72 ÷ rate', say: 'The green bars are the exact answers. At every rate here, the shortcut lands within a year of them.' },
  ],
};

const inflation = {
  type: 'plot',
  chapter: 'Inflation',
  title: "The same money in today's dollars",
  narration: `Now the catch. If prices rise three percent a year, something that costs a dollar today costs ${cents(priceLevel30)} in thirty years.`,
  x: { from: 0, to: 30, ticks: 5, label: 'years' },
  y: { from: 0, to: 80000, ticks: 20000, prefix: '$', grid: true },
  params: { year: 0 },
  functions: [
    { id: 'growth', y: GROW, label: 'on paper' },
    { id: 'today', y: REAL, label: "in today's dollars", tone: 'good', hidden: true },
  ],
  areas: [{ id: 'gap', between: ['growth', 'today'], tone: 'warn', hidden: true }],
  points: [
    { id: 'marker', at: ['year', REAL.replaceAll('x', 'year')], label: '${' + REAL.replaceAll('x', 'year') + ':0}', side: 'left', hidden: true },
    { id: 'top', at: [30, GROW.replaceAll('x', '30')], label: '${' + GROW.replaceAll('x', '30') + ':0}', side: 'left', tone: 'accent', hidden: true },
  ],
  steps: [
    { trace: ['today'], set: { year: 30 }, show: ['marker'], focus: ['today', 'marker'], say: `So divide each year's balance by how much prices have risen. In today's money, the thirty year total is worth ${money(real(30))}.` },
    { show: ['gap', 'top'], focus: ['gap', 'top', 'marker'], say: `The shaded gap is what inflation takes: ${Math.round(lost(30) * 100)} percent of the final balance.`, draw: [{ brace: ['top', 'marker'], note: `${money(grown(30) - real(30))}`, side: 'right', when: 'inflation takes' }] },
  ],
};

const LABELS = ['10 years', '20 years', '30 years'];
const paper = [10, 20, 30].map((t) => Math.round(grown(t)));
const buys = [10, 20, 30].map((t) => Math.round(real(t)));
const shrink = {
  type: 'chart',
  chapter: 'Inflation',
  title: 'What the balance buys, in dollars',
  kind: 'bar',
  better: 'higher',
  narration: 'Here is the same story as bars. Each pair starts out as the balance on your statement.',
  labels: LABELS,
  series: [
    { name: 'on paper', values: paper, tone: 'accent' },
    { name: "in today's dollars", values: paper, tone: 'good' },
  ],
  steps: [
    { set: { "in today's dollars": buys }, say: `Now take inflation out. After ten years, ${money(grown(10))} buys what ${money(real(10))} buys today.` },
    { focus: ["in today's dollars@30 years"], say: `After thirty, ${money(grown(30))} buys what ${money(real(30))} does now. Still three times what you started with. Just not seven.` },
  ],
};

const takeaway = {
  type: 'text',
  chapter: 'The takeaway',
  narration: 'So here is the one habit worth keeping. Before you use the rule of seventy two, take inflation out of the rate.',
  kicker: 'Years to double',
  headline: 'Use the rule of 72 on the rate after inflation',
  sides: [
    { label: 'on paper', number: '7%', note: `doubles in about ${Math.round(exactDouble(RATE))} years`, tone: 'accent' },
    { label: 'what it buys', number: `${(realRate * 100).toFixed(1)}%`, note: `doubles in about ${Math.round(realDouble)} years`, tone: 'good' },
  ],
  hidden: ['right'],
  steps: [
    { focus: ['left'], say: `On paper, seven percent doubles your money in about ${Math.round(exactDouble(RATE))} years.` },
    { show: ['right'], say: `But seven percent growth with three percent inflation is about ${(realRate * 100).toFixed(1)} percent of real growth. Seventy two divided by that is about ${Math.round(72 / (realRate * 100))} years, and the exact answer is ${realDouble.toFixed(1)}. That is how long it takes to double what your money can actually buy.` },
  ],
};

const storyboard = {
  title: 'Compound interest against inflation',
  subtitle: 'Why money grows faster every year, the rule of 72, and what three percent inflation takes back',
  scenes: [hook, firstYears, thirtyYears, doubling, inflation, shrink, takeaway],
};
const here = (f) => new URL(f, import.meta.url);
fs.writeFileSync(here('storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
fs.writeFileSync(here('hunks.json'), '{}\n');
fs.writeFileSync(here('meta.json'), `${JSON.stringify({ mode: 'explain' })}\n`);
console.log(`on paper at 10, 20, 30: ${paper.map(money).join(', ')}; today's dollars: ${buys.map(money).join(', ')}`);
console.log(`doubling, rule vs exact: ${RATES.map((p, i) => `${p}% ${rule[i].toFixed(1)}/${exact[i].toFixed(2)}`).join(', ')}`);
console.log(`real rate ${(realRate * 100).toFixed(2)}%, doubles in ${realDouble.toFixed(2)} years; inflation takes ${(lost(30) * 100).toFixed(1)}% by year 30`);
