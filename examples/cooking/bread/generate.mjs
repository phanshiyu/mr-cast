// Writes storyboard.json beside this file, then checks every gram, percentage and minute against the sources below.
// Run: node examples/cooking/bread/generate.mjs
//
// The formula is King Arthur Baking's white bread in baker's percentages, flour 100%, water 66%, salt 2%, yeast 1.2%,
// which its blog writes out for 500 g of flour as 330 g, 10 g and 6 g:
//   https://www.kingarthurbaking.com/pro/reference/bakers-percentage
//   https://www.kingarthurbaking.com/blog/2022/04/28/what-is-bakers-math-and-how-can-i-use-it-in-my-everyday-bread-baking
// Scaling to a dough weight divides it by the total percentage, as the first page's "formula conversion factor" does.
// What 60% and 80% doughs are like is King Arthur's bread hydration guide:
//   https://www.kingarthurbaking.com/blog/2023/01/11/bread-hydration
// and, for wet doughs opening the crumb, https://www.kingarthurbaking.com/blog/2020/11/05/producing-an-open-crumb-in-sourdough-bread
// The method and its times are King Arthur's tested "Easiest Loaf of Bread You'll Ever Bake", a lean dough of about the
// same hydration (379 g water to 600 g flour, which the guide above calls 63%):
//   https://www.kingarthurbaking.com/recipes/easiest-loaf-bread-youll-ever-bake-recipe
// Rising times depend on the kitchen, so the video says "until doubled" and gives the recipe's range, 1 to 2 hours.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const formula = [
  { name: 'Flour', pct: 100 },
  { name: 'Water', pct: 66 },
  { name: 'Salt', pct: 2 },
  { name: 'Yeast', pct: 1.2 },
];
const grams = (flour) => formula.map((f) => Math.round((flour * f.pct) / 100));
const loaf = grams(500);
assert.deepEqual(loaf, [500, 330, 10, 6], 'King Arthur’s 500 g example');
const totalPct = formula.reduce((s, f) => s + f.pct, 0);
assert.equal(totalPct, 169.2);
const dough = loaf.reduce((a, b) => a + b, 0);
assert.equal(dough, 846);

const two = grams(1000);
assert.deepEqual(two, loaf.map((g) => g * 2), 'doubling the flour doubles every ingredient');

// A target dough weight: flour = dough ÷ total percentage.
const target = 1200;
const targetFlour = Math.round(target / (totalPct / 100));
assert.equal(targetFlour, 709);
const scaled = grams(targetFlour);
assert.deepEqual(scaled, [709, 468, 14, 9]);
assert(Math.abs(scaled.reduce((a, b) => a + b, 0) - target) <= 1, 'the scaled dough weighs what we asked for');

const hydration = (water, flour) => Math.round((water / flour) * 1000) / 10;
assert.equal(hydration(loaf[1], loaf[0]), 66);
assert.equal(hydration(379, 600), 63.2, 'the tested recipe is the same kind of dough');
const water = (pct) => (500 * pct) / 100;
assert.deepEqual([water(60), water(80)], [300, 400]);

// The tested recipe's times, in minutes, taking the quick end of each range.
const t = { knead: 6, rise: [60, 120], proof: 45, bake: [20, 25] };
const mixAt = 0;
const riseAt = mixAt + t.knead;
const shapeAt = riseAt + t.rise[0];
const ovenAt = shapeAt + t.proof;
const doneAt = ovenAt + t.bake[1];
assert.deepEqual([riseAt, shapeAt, ovenAt, doneAt], [6, 66, 111, 136]);
const waiting = t.rise[0] + t.proof;
const waitingShare = Math.round((waiting / doneAt) * 100);
assert.equal(waitingShare, 77, 'the dough rises for three quarters of the time');
const slowDone = doneAt + (t.rise[1] - t.rise[0]);
assert.equal(slowDone, 196);
const ovenC = Math.round(((450 - 32) * 5) / 9);
assert.equal(ovenC, 232);

const hm = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;

const scenes = [
  {
    type: 'table',
    chapter: 'The formula',
    title: 'White bread, in baker’s percentages',
    narration: 'Here is the thing most bread recipes do not tell you. Every ingredient is really just a percentage of the flour.',
    columns: ['Ingredient', 'Baker’s %', 'Grams'],
    rows: formula.map((f, i) => ({ cells: [f.name, `${f.pct}%`, `${loaf[i]} g`], ...(i ? { hidden: true } : {}) })),
    callout: 'flour is always **100%**',
    steps: [
      { focus: 0, say: `The flour is always one hundred percent. Say we use ${loaf[0]} grams.` },
      { show: [1], focus: 1, callout: `${loaf[0]} g × 66% = **${loaf[1]} g**`, say: `Water is sixty six percent of that, so ${loaf[1]} grams.` },
      { show: [2], focus: 2, callout: `${loaf[0]} g × 2% = **${loaf[2]} g**`, say: `Salt is two percent, ${loaf[2]} grams.` },
      { show: [3], focus: 3, callout: `${loaf[0]} g × 1.2% = **${loaf[3]} g**`, say: `And yeast is one point two percent, just ${loaf[3]} grams.` },
      { focus: 'col:Baker’s %', callout: `${totalPct}% = **${dough} g** of dough`, say: `Add the percentages up and you get more than a hundred, ${totalPct}. That is fine. It just means the dough weighs ${dough} grams.` },
    ],
  },
  {
    type: 'text',
    chapter: 'Hydration',
    narration: 'The most important number in that list is the water. Bakers call it hydration.',
    kicker: 'Hydration = water ÷ flour',
    number: '66%',
    note: `${loaf[1]} g of water ÷ ${loaf[0]} g of flour`,
    steps: [
      { focus: 'note', say: `It is just the water divided by the flour. ${loaf[1]} over ${loaf[0]} is sixty six percent.`, draw: [{ underline: 'note', when: 'divided by' }] },
      { set: { note: 'tells you how the dough will feel, before you touch it' }, say: 'And that one number tells you how the dough will feel before you even touch it.' },
    ],
  },
  {
    type: 'compare',
    chapter: 'Wet or dry',
    title: `Two doughs, each with ${loaf[0]} g of flour`,
    sides: [{ title: '60% water', tone: 'neutral' }, { title: '80% water', tone: 'accent' }],
    narration: 'So what changes if you go drier or wetter? Here is the same flour at sixty and at eighty percent.',
    rows: [
      { label: 'Water', cells: [`${water(60)} g`, `${water(80)} g`] },
      { label: 'In your hands', cells: ['Firm, even stiff', 'Slack and sticky'] },
      { label: 'Inside the loaf', cells: ['Closed, with a chewy bite', 'Moister, and keeps longer'] },
      { label: 'The catch', cells: ['Can bake up tight', 'Harder to shape, longer bake'], verdict: ['bad', 'bad'] },
      { label: 'Good for', cells: ['Braids, bagels, pretzels', 'Open-crumb, rustic loaves'] },
    ],
    steps: [
      { focus: 0, say: `Only ${water(80) - water(60)} grams of water separate these two.` },
      { focus: 1, say: 'At sixty percent the dough is firm and easy to handle. At eighty it is slack and sticky.' },
      { focus: 2, say: 'The drier one bakes up tight and chewy. The wetter one is moister inside, and stays fresh longer.' },
      { focus: 3, say: 'But a wet dough takes more skill to shape, and longer in the oven.' },
      { focus: 4, say: 'Which is why bagels and pretzels are stiff doughs, and big rustic loaves are wet ones. Sixty six sits comfortably in between.', draw: [{ write: '66% sits in between', at: [0.4, 0.79], when: 'in between' }] },
    ],
  },
  {
    type: 'chart',
    chapter: 'Scaling',
    title: 'Grams of each ingredient',
    kind: 'bar',
    unit: 'g',
    narration: 'And here is why bakers love percentages. Scaling a recipe stops being a headache.',
    labels: formula.map((f) => f.name),
    series: [{ name: 'dough', values: loaf }],
    callout: `one loaf, ${dough} g`,
    steps: [
      { set: { dough: two }, callout: `two loaves: flour × 2`, say: 'Want two loaves? Double the flour, and every other number doubles with it.' },
      { set: { dough: scaled }, callout: `${target} g ÷ ${totalPct / 100} = **${targetFlour} g** flour`, say: `Want exactly ${target} grams of dough for a big pan? Divide it by one point six nine two, the total percentage. That gives ${targetFlour} grams of flour, and the percentages do the rest.` },
    ],
  },
  {
    type: 'text',
    chapter: 'The method',
    narration: 'Now the method. The times come from a tested recipe for this same kind of dough.',
    kicker: 'Method',
    headline: 'One lean loaf',
    items: [
      `Mix and knead · **${t.knead} min**`,
      `Rise until doubled · **1 to 2 h**`,
      'Shape into a loaf',
      `Rise again · **${t.proof} min**`,
      `Bake at 450 °F (${ovenC} °C) · **${t.bake[0]} to ${t.bake[1]} min**`,
      'Cool on a rack before slicing',
    ],
    steps: [
      { focus: 0, say: `Mix everything and knead for about ${t.knead} minutes, until it is smooth.`, draw: [{ tick: 0 }] },
      { focus: 1, say: 'Cover it and let it rise until it has doubled. That takes one to two hours, depending on how warm your kitchen is.', draw: [{ tick: 1 }] },
      { focus: 2, say: 'Shape it into a loaf.', draw: [{ tick: 2 }] },
      { focus: 3, say: `Let it rise again, about ${t.proof} minutes.`, draw: [{ tick: 3 }] },
      { focus: 4, say: `Bake it hot, four hundred and fifty Fahrenheit, for twenty to twenty five minutes.`, draw: [{ tick: 4 }] },
      { focus: 5, say: 'And let it cool before you cut it. It is still cooking inside.', draw: [{ tick: 5 }] },
    ],
  },
  {
    type: 'timeline',
    chapter: 'Where the time goes',
    title: 'One loaf, on the clock',
    unit: 'min',
    narration: 'Put those times on a clock, taking the quick end of each one.',
    events: [
      { at: mixAt, label: 'Mix', detail: 'hands on' },
      { at: riseAt, label: 'Covered', detail: 'first rise' },
      { at: shapeAt, label: 'Shape', detail: 'hands on' },
      { at: ovenAt, label: 'Into the oven', detail: `450 °F` },
      { at: doneAt, label: 'Bread', detail: hm(doneAt), tone: 'good' },
    ],
    spans: [
      { from: riseAt, to: shapeAt, label: 'rise until doubled', tone: 'warn' },
      { from: shapeAt, to: ovenAt, label: `rise ${t.proof} min`, tone: 'warn' },
      { from: ovenAt, to: doneAt, label: 'bake' },
    ],
    steps: [
      { focus: [0, 1], say: `The mixing and kneading is about ${t.knead} minutes of work.` },
      { focus: ['span:rise until doubled', 2], say: `Then you wait an hour while the yeast does its thing, and shape it. In a cool kitchen it can take two, which pushes the bread back to ${hm(slowDone).replace(' h ', ' hours ')} minutes.` },
      { focus: ['span:rise 45 min', 3], say: 'Another forty five minutes of waiting, and into the oven.' },
      { focus: ['span:bake', 4], say: `About two and a quarter hours from start to bread. And for ${waitingShare} percent of that, you are not doing anything at all.`, draw: [{ brace: ['span:rise until doubled', 'span:rise 45 min'], note: `${waitingShare}% waiting`, when: 'not doing anything' }] },
    ],
  },
];

fs.writeFileSync(
  new URL('./storyboard.json', import.meta.url),
  JSON.stringify({ title: 'Bread by baker’s percentages', subtitle: 'Why every bread recipe is four numbers, and how to scale it', scenes }, null, 2) + '\n',
);
