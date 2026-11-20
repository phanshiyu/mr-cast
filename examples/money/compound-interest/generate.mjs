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
assert.deepEqual(
  years.map((r) => r.interest),
  [700, 749, 801.43],
);
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

// ---------- the pictures ----------
// The growth picture: thirty years of balance, drawn from the same formulas the checks above use.
const px = (t) => 130 + t * 31; // years 0..30 → 130..1060
const py = (v) => 570 - (v / 80000) * 530; // $0..$80,000 → 570..40
const r1 = (v) => Math.round(v * 10) / 10;
const pathOf = (f, from = 0, to = 30) => {
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const t = from + ((to - from) * i) / 60;
    pts.push(`${r1(px(t))} ${r1(py(f(t)))}`);
  }
  return pts;
};
const curve = (f) => `M${pathOf(f).join(' L')}`;
const between = (top, bottom) => `M${pathOf(top).join(' L')} L${pathOf(bottom).reverse().join(' L')} Z`;
const dot = (t, v, extra = '') => `<circle cx="${r1(px(t))}" cy="${r1(py(v))}" r="9" ${extra}/>`;
const T = (x, y, s, extra = '') => `<text x="${x}" y="${y}" font-size="24" ${extra}>${s}</text>`;
const grid = [20000, 40000, 60000, 80000]
  .map(
    (v) =>
      `<line x1="118" y1="${py(v)}" x2="130" y2="${py(v)}" stroke="var(--text)" stroke-width="3"/>${T(108, py(v) + 8, `$${v / 1000}k`, 'text-anchor="end" font-size="22" fill="var(--muted)"')}`,
  )
  .join('');
const ticks = [0, 5, 10, 15, 20, 25, 30]
  .map((t) => T(px(t), 606, t, 'text-anchor="middle" font-size="22" fill="var(--muted)"'))
  .join('');
const pair = (id, t) =>
  `<g id="${id}"><line x1="${px(t)}" y1="${r1(py(grown(t)))}" x2="${px(t)}" y2="${r1(py(real(t)))}" stroke="var(--text)" stroke-width="3" stroke-dasharray="6 6"/>${dot(t, grown(t), 'fill="var(--text)"')}${dot(t, real(t), 'class="tone-good"')}${T(px(t) - 16, r1(py(grown(t))) - 14, money(grown(t)), 'text-anchor="end"')}${T(px(t) + 14, r1(py(real(t))) + 40, money(real(t)), 'class="tone-good"')}</g>`;
const D = 2 * P;
const growthPicture = `<svg viewBox="0 0 1200 640">
${grid}<g><line x1="130" y1="570" x2="1070" y2="570" stroke="var(--text)" stroke-width="3"/><line x1="130" y1="40" x2="130" y2="570" stroke="var(--text)" stroke-width="3"/>${ticks}${T(1090, 606, 'years', 'font-size="22" fill="var(--muted)"')}</g>
<path id="extra" class="tone-good" stroke="none" d="${between(grown, simple)}"/>
<path id="gap" class="tone-bad" stroke="none" d="${between(grown, real)}"/>
<path id="simple" d="${curve(simple)}" fill="none" stroke="var(--muted)" stroke-width="3" stroke-dasharray="12 10"/>
<g id="simpleEnd">${dot(30, simple(30), 'fill="var(--muted)"')}${T(1080, r1(py(simple(30))) + 8, money(simple(30)), 'fill="var(--muted)"')}</g>
<path id="growth" d="${curve(grown)}" fill="none" stroke="var(--text)" stroke-width="4"/>
<path id="real" d="${curve(real)}" fill="none" class="stroke-good" stroke-width="4"/>
<g id="start">${dot(0, P, 'fill="var(--text)"')}${T(150, r1(py(P)) - 20, money(P))}</g>
<g id="end">${dot(30, grown(30), 'fill="var(--text)"')}${T(1080, r1(py(grown(30))) + 8, money(grown(30)))}</g>
<g id="realEnd">${dot(30, real(30), 'class="tone-good"')}${T(1080, r1(py(real(30))) + 8, money(real(30)), 'class="tone-good"')}</g>
${pair('m10', 10)}${pair('m20', 20)}
<g id="double"><line x1="130" y1="${py(D)}" x2="1070" y2="${py(D)}" stroke="var(--text)" stroke-width="3" stroke-dasharray="4 8"/>${T(1080, py(D) + 8, 'doubled')}</g>
<g id="d7"><line x1="${r1(px(exactDouble(RATE)))}" y1="${py(D)}" x2="${r1(px(exactDouble(RATE)))}" y2="570" stroke="var(--text)" stroke-width="3"/>${dot(exactDouble(RATE), D, 'fill="var(--text)"')}${T(r1(px(exactDouble(RATE))) - 14, py(D) - 22, `${Math.round(exactDouble(RATE))} years`, 'text-anchor="end"')}</g>
<g id="dReal"><line x1="${r1(px(realDouble))}" y1="${py(D)}" x2="${r1(px(realDouble))}" y2="570" class="stroke-good" stroke-width="3"/>${dot(realDouble, D, 'class="tone-good"')}${T(r1(px(realDouble)) + 14, py(D) + 40, `${Math.round(realDouble)} years`, 'class="tone-good"')}</g>
</svg>`;

// The first three years: each year's interest as a bar, with the part above $700 earned on earlier interest.
const S = 0.85; // px per dollar of interest
const yearRow = (r, i) => {
  const y = 150 + i * 160;
  const extra = r.interest - years[0].interest;
  return `<g id="y${r.y}">${T(40, y, `year ${r.y}: 7% of ${cents(r.start)}`, 'font-size="28"')}
<rect x="40" y="${y + 24}" width="${years[0].interest * S}" height="56" rx="6"/>
${extra ? `<rect id="extra${r.y}" x="${40 + years[0].interest * S}" y="${y + 24}" width="${r1(extra * S)}" height="56" rx="6" class="tone-good"/>` : ''}
${T(56 + r.interest * S, y + 62, cents(r.interest), 'font-size="26"')}
${T(1170, y + 62, `ends ${cents(r.end)}`, 'text-anchor="end" fill="var(--muted)"')}</g>`;
};
const firstYearsSvg = `<svg viewBox="0 0 1200 640">
${years.map(yearRow).join('\n')}
<g id="base"><line x1="${40 + 700 * S}" y1="80" x2="${40 + 700 * S}" y2="560" stroke="var(--muted)" stroke-width="2" stroke-dasharray="8 8"/>${T(40 + 700 * S, 70, '$700', 'text-anchor="middle" fill="var(--muted)"')}</g>
</svg>`;

// The rule of 72: a bar for each rate's shortcut, and a line across it at the exact answer.
const bx = (i) => 210 + i * 200;
const by = (yrs) => 570 - yrs * 12;
const ruleSvg = `<svg viewBox="0 0 1200 640">
<text id="formula" x="1170" y="60" text-anchor="end" font-size="30">years to double: about 72 / rate</text>
<line x1="80" y1="570" x2="1140" y2="570" stroke="var(--text)" stroke-width="3"/>
${RATES.map(
  (p, i) =>
    `<g id="bar${p}"><rect x="${bx(i) - 60}" y="${r1(by(rule[i]))}" width="120" height="${r1(rule[i] * 12)}" rx="6"/>${T(bx(i), r1(by(rule[i])) + 34, oneDecimal(rule[i]), 'text-anchor="middle" font-size="26"')}${T(bx(i), 610, `${p}%`, 'text-anchor="middle" font-size="26" fill="var(--muted)"')}</g>`,
).join('\n')}
${RATES.map(
  (p, i) =>
    `<g id="ex${p}"><line x1="${bx(i) - 80}" y1="${r1(by(exact[i]))}" x2="${bx(i) + 80}" y2="${r1(by(exact[i]))}" class="stroke-good" stroke-width="5"/>${T(bx(i), r1(by(Math.max(exact[i], rule[i]))) - 16, `exact ${exact[i].toFixed(i === 2 ? 2 : 1)}`, 'text-anchor="middle" class="tone-good"')}</g>`,
).join('\n')}
</svg>`;

// ---------- scenes ----------
const allLate = [
  'simple',
  'simpleEnd',
  'extra',
  'gap',
  'growth',
  'real',
  'realEnd',
  'm10',
  'm20',
  'double',
  'd7',
  'dReal',
];
const hook = {
  type: 'svg',
  chapter: 'The question',
  title: 'Ten thousand dollars, left alone',
  picture: 'growth',
  hidden: [...allLate, 'end'],
  labels: { start: 'ten thousand dollars', end: 'thirty years later' },
  narration:
    'Say you put ten thousand dollars away today, in something that grows seven percent a year, and you do not touch it.',
  steps: [
    {
      show: ['end'],
      focus: ['end'],
      say: `Thirty years later, the statement says ${money(grown(30))}. More than seven times what you put in.`,
      draw: [{ write: 'on paper', near: 'end', side: 'below', when: 'statement' }],
    },
    {
      focus: ['start', 'end'],
      say: 'That sounds great. But prices rise too. So how much of that is real?',
      draw: [{ write: 'but what will it buy?', near: 'end', side: 'left', tone: 'bad', when: 'how much' }],
    },
  ],
};

const firstYears = {
  type: 'svg',
  chapter: 'Interest on interest',
  title: 'Each year’s interest is bigger',
  svg: firstYearsSvg,
  hidden: ['y2', 'y3'],
  labels: { y1: 'year one', y2: 'year two', y3: 'year three', extra2: 'forty nine dollars', extra3: 'bigger' },
  narration: 'First, where the growth comes from. Here are the first three years, worked out by hand.',
  steps: [
    {
      focus: ['y1', 'base'],
      say: `In year one, seven percent of ten thousand is ${money(years[0].interest)}. You end the year with ${money(years[0].end)}.`,
    },
    {
      show: ['y2'],
      focus: ['extra2'],
      say: `In year two you earn seven percent of the new total, ${money(years[1].interest)}. Forty nine dollars more, because last year's interest is earning too.`,
      draw: [{ write: '+$49', near: 'extra2', side: 'above', tone: 'good', when: 'Forty nine' }],
    },
    {
      show: ['y3'],
      focus: ['extra3'],
      say: `Year three pays ${cents(years[2].interest)}. Each year's interest is bigger than the last.`,
      draw: [{ write: 'interest earns interest', near: 'extra3', side: 'below', tone: 'good', when: 'bigger' }],
    },
  ],
};

const thirtyYears = {
  type: 'svg',
  chapter: 'Interest on interest',
  title: 'Thirty years bends the line up',
  picture: 'growth',
  hidden: [...allLate, 'end'],
  labels: { simple: 'dashed line', growth: 'compounding', extra: 'shaded gap', simpleEnd: 'straight line' },
  narration: 'Now stretch that over thirty years.',
  steps: [
    {
      trace: [{ ref: 'simple', when: 'dashed line' }],
      show: ['simpleEnd'],
      focus: ['simple', 'simpleEnd'],
      say: `The dashed line is only the first ten thousand earning, seven hundred a year. It ends at ${money(simple(30))}.`,
    },
    {
      trace: [{ ref: 'growth', when: 'bends' }],
      show: ['end'],
      focus: ['growth', 'end'],
      say: `Compounding bends the line upward. It starts slow, then climbs faster every year, to ${money(grown(30))}.`,
    },
    {
      show: ['extra'],
      focus: ['extra'],
      say: `The shaded gap, ${money(grown(30) - simple(30))}, is interest earned on interest.`,
      draw: [
        {
          brace: ['end', 'simpleEnd'],
          note: `+${money(grown(30) - simple(30))}`,
          side: 'right',
          tone: 'good',
          when: 'shaded gap',
        },
      ],
    },
  ],
};

const doubling = {
  type: 'svg',
  chapter: 'The rule of 72',
  title: 'Divide 72 by the rate',
  svg: ruleSvg,
  hidden: RATES.map((p) => `ex${p}`),
  labels: { formula: 'seventy two', bar7: 'seven percent', ex7: 'exact answer' },
  narration: 'There is a shortcut for how fast this grows.',
  steps: [
    {
      focus: ['formula'],
      say: 'Divide seventy two by the growth rate, and you get roughly how many years it takes to double.',
    },
    {
      focus: ['bar7', 'formula'],
      say: `At seven percent, seventy two divided by seven is ${(72 / 7).toFixed(1)} years.`,
      draw: [{ write: `72 ÷ 7 = ${(72 / 7).toFixed(1)}`, near: 'bar7', side: 'above', when: 'divided by seven' }],
    },
    {
      show: ['ex7'],
      focus: ['ex7'],
      erase: true,
      say: `The exact answer is ${exactDouble(RATE).toFixed(2)} years. Less than a month apart.`,
    },
    {
      show: RATES.map((p) => `ex${p}`),
      focus: RATES.map((p) => `ex${p}`),
      say: 'The green lines are the exact answers. At every rate here, the shortcut lands within a year of them.',
    },
  ],
};

const inflation = {
  type: 'svg',
  chapter: 'Inflation',
  title: 'Inflation takes most of it back',
  picture: 'growth',
  hidden: ['simple', 'simpleEnd', 'extra', 'gap', 'real', 'realEnd', 'm10', 'm20', 'double', 'd7', 'dReal'],
  labels: { real: "today's money", realEnd: 'thirty year total', gap: 'shaded gap', end: 'final balance' },
  narration: `Now the catch. If prices rise three percent a year, something that costs a dollar today costs ${cents(priceLevel30)} in thirty years.`,
  steps: [
    {
      trace: [{ ref: 'real', when: 'divide' }],
      show: ['realEnd'],
      focus: ['real', 'realEnd'],
      say: `So divide each year's balance by how much prices have risen. In today's money, the thirty year total is worth ${money(real(30))}.`,
    },
    {
      show: ['gap'],
      focus: ['gap', 'end', 'realEnd'],
      say: `The shaded gap is what inflation takes: ${Math.round(lost(30) * 100)} percent of the final balance.`,
      draw: [
        {
          brace: ['end', 'realEnd'],
          note: money(grown(30) - real(30)),
          side: 'right',
          tone: 'bad',
          when: 'inflation takes',
        },
      ],
    },
  ],
};

const shrink = {
  type: 'svg',
  chapter: 'Inflation',
  title: 'Three times richer, not seven',
  picture: 'growth',
  labels: { m10: 'ten years', m20: 'twenty', realEnd: 'thirty', start: 'what you started with' },
  narration: 'Read it at three points along the way.',
  steps: [
    {
      show: ['m10'],
      focus: ['m10'],
      say: `After ten years, ${money(grown(10))} buys what ${money(real(10))} buys today.`,
    },
    {
      show: ['m20'],
      focus: ['m20'],
      say: `After twenty, ${money(grown(20))} buys what ${money(real(20))} does now.`,
    },
    {
      focus: ['realEnd', 'start'],
      say: `After thirty, ${money(real(30))} of today's money. Still three times what you started with. Just not seven.`,
      draw: [{ write: '× 3, not × 7', near: 'realEnd', side: 'above', tone: 'good', when: 'three times' }],
    },
  ],
};

const takeaway = {
  type: 'svg',
  chapter: 'The takeaway',
  title: 'Take inflation out of the rate first',
  picture: 'growth',
  hidden: ['simple', 'simpleEnd', 'extra', 'm10', 'm20', 'd7', 'dReal'],
  labels: { dReal: 'real growth' },
  narration:
    'So here is the one habit worth keeping. Before you use the rule of seventy two, take inflation out of the rate.',
  steps: [
    {
      show: ['double', 'd7'],
      focus: ['d7', 'double'],
      say: `On paper, seven percent doubles your money in about ${Math.round(exactDouble(RATE))} years.`,
    },
    {
      show: ['dReal'],
      focus: ['dReal'],
      say: `But seven percent growth with three percent inflation is about ${(realRate * 100).toFixed(1)} percent of real growth.`,
      draw: [
        {
          write: `72 ÷ ${(realRate * 100).toFixed(1)} ≈ ${Math.round(72 / (realRate * 100))}`,
          near: 'dReal',
          side: 'right',
          tone: 'good',
          when: 'real growth',
        },
      ],
    },
    {
      focus: ['dReal', 'real'],
      say: `The exact answer is ${realDouble.toFixed(1)} years. That is how long it takes to double what your money can actually buy.`,
    },
  ],
};

const storyboard = {
  title: 'Compound interest against inflation',
  subtitle: 'Why money grows faster every year, the rule of 72, and what three percent inflation takes back',
  tones: { good: 'growth you keep', bad: 'what inflation takes' },
  pictures: { growth: growthPicture },
  scenes: [hook, firstYears, thirtyYears, doubling, inflation, shrink, takeaway],
};
const here = (f) => new URL(f, import.meta.url);
fs.writeFileSync(here('storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
fs.writeFileSync(here('hunks.json'), '{}\n');
fs.writeFileSync(here('meta.json'), `${JSON.stringify({ mode: 'explain' })}\n`);
console.log(
  `on paper at 10, 20, 30: ${[10, 20, 30].map((t) => money(grown(t))).join(', ')}; today's dollars: ${[10, 20, 30].map((t) => money(real(t))).join(', ')}`,
);
console.log(
  `doubling, rule vs exact: ${RATES.map((p, i) => `${p}% ${rule[i].toFixed(1)}/${exact[i].toFixed(2)}`).join(', ')}`,
);
console.log(
  `real rate ${(realRate * 100).toFixed(2)}%, doubles in ${realDouble.toFixed(2)} years; inflation takes ${(lost(30) * 100).toFixed(1)}% by year 30`,
);
