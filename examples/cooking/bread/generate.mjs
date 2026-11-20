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
assert.deepEqual(
  two,
  loaf.map((g) => g * 2),
  'doubling the flour doubles every ingredient',
);

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

// The recipe picture: one row per ingredient, its baker's percentage, its grams, and a bar as long as its weight.
const ids = formula.map((f) => f.name.toLowerCase());
const rowY = (i) => 130 + i * 105;
const BAR_X = 600;
const PX_PER_G = 0.55; // 1000 g of flour fills 550 px
const bar = (i, g) => {
  const w = Math.max(4, Math.round(g * PX_PER_G));
  return `M${BAR_X},${rowY(i) - 34} H${BAR_X + w} V${rowY(i) + 10} H${BAR_X} Z`;
};
const recipe = `<svg viewBox="0 0 1200 640">
<text x="330" y="50" text-anchor="middle" font-size="24" fill="var(--muted)">baker’s %</text>
<text x="500" y="50" text-anchor="end" font-size="24" fill="var(--muted)">grams</text>
<line x1="40" y1="68" x2="1160" y2="68" stroke="var(--border)" stroke-width="2"/>
${formula
  .map(
    (f, i) =>
      `<g id="${ids[i]}"><text x="60" y="${rowY(i)}" font-size="34">${f.name}</text>` +
      `<text id="p-${ids[i]}" x="330" y="${rowY(i)}" text-anchor="middle" font-size="32">${f.pct}%</text>` +
      `<text id="g-${ids[i]}" x="500" y="${rowY(i)}" text-anchor="end" font-size="32">${loaf[i]} g</text>` +
      `<path id="bar-${ids[i]}" d="${bar(i, loaf[i])}" stroke-width="3"/>` +
      `<path id="bar2-${ids[i]}" d="${bar(i, two[i])}"/><path id="bar3-${ids[i]}" d="${bar(i, scaled[i])}"/></g>`,
  )
  .join('\n')}
<g id="total"><line x1="40" y1="${rowY(3) + 42}" x2="540" y2="${rowY(3) + 42}" stroke="var(--text)" stroke-width="3"/>
<text x="60" y="${rowY(3) + 100}" font-size="32">Dough</text><text id="p-total" x="330" y="${rowY(3) + 100}" text-anchor="middle" font-size="32">${totalPct}%</text><text id="g-total" x="500" y="${rowY(3) + 100}" text-anchor="end" font-size="32">${dough} g</text></g>
</svg>`;
const ghostBars = ids.flatMap((id) => [`bar2-${id}`, `bar3-${id}`]);

// Two doughs side by side, 60% and 80% water, and a hydration ruler under them.
const col = (x0, pct, g, firm) => {
  const c = x0 + 300;
  const holes = firm
    ? [...Array(14)]
        .map(
          (_, k) => `<circle cx="${c - 96 + (k % 7) * 32}" cy="${360 + Math.floor(k / 7) * 26 + (k % 2) * 6}" r="6"/>`,
        )
        .join('')
    : [
        [-110, 360, 16, 11],
        [-55, 385, 22, 14],
        [5, 355, 26, 15],
        [70, 382, 20, 13],
        [120, 360, 14, 10],
      ]
        .map(([dx, y, rx, ry]) => `<ellipse cx="${c + dx}" cy="${y}" rx="${rx}" ry="${ry}"/>`)
        .join('');
  const k = firm ? 'dry' : 'wet';
  return `<text x="${c}" y="46" text-anchor="middle" font-size="32">${pct}% water</text>
<g id="water-${k}"><rect x="${c - 200}" y="68" width="${g * 0.8}" height="30" rx="4" stroke-width="3"/><text x="${c - 190 + g * 0.8}" y="92" font-size="26">${g} g</text></g>
<g id="dough-${k}">${firm ? `<path d="M${c - 120},250 C${c - 120},140 ${c + 120},140 ${c + 120},250 Z" stroke-width="3"/>` : `<path d="M${c - 190},250 C${c - 160},205 ${c + 160},205 ${c + 190},250 Z" stroke-width="3"/>`}
<text x="${c}" y="292" text-anchor="middle" font-size="26">${firm ? 'firm, even stiff' : 'slack and sticky'}</text></g>
<g id="crumb-${k}"><ellipse cx="${c}" cy="375" rx="170" ry="50" stroke-width="3"/><g fill="var(--bg)" stroke="var(--muted)" stroke-width="2">${holes}</g>
<text x="${c}" y="460" text-anchor="middle" font-size="26">${firm ? 'closed, with a chewy bite' : 'moister, and keeps longer'}</text></g>
<text id="catch-${k}" x="${c}" y="502" text-anchor="middle" font-size="26" class="tone-bad">${firm ? 'can bake up tight' : 'harder to shape, longer bake'}</text>
<text id="for-${k}" x="${c}" y="544" text-anchor="middle" font-size="26" fill="var(--muted)">${firm ? 'bagels, pretzels, braids' : 'open, rustic loaves'}</text>`;
};
const rx = (pct) => 300 + ((pct - 60) / 20) * 600; // the ruler: 60% under the dry dough, 80% under the wet one
const doughs = `<svg viewBox="0 0 1200 640">
<line x1="600" y1="20" x2="600" y2="550" stroke="var(--border)" stroke-width="2"/>
${col(0, 60, water(60), true)}
${col(600, 80, water(80), false)}
<g id="ruler"><line x1="${rx(60)}" y1="586" x2="${rx(80)}" y2="586" stroke="var(--text)" stroke-width="3"/>
${[60, 70, 80].map((p) => `<line x1="${rx(p)}" y1="574" x2="${rx(p)}" y2="598" stroke="var(--text)" stroke-width="3"/><text x="${rx(p)}" y="626" text-anchor="middle" font-size="24" fill="var(--muted)">${p}%</text>`).join('')}</g>
<g id="ours"><circle cx="${rx(66)}" cy="586" r="12" class="tone-good" stroke-width="3"/><text x="${rx(66)}" y="562" text-anchor="middle" font-size="26" class="tone-good">66%</text></g>
</svg>`;

// The clock: one lean loaf from mixing to bread, the quick end of each range, in minutes along a line.
const X0 = 70;
const PX_PER_MIN = 6.6;
const mx = (min) => +(X0 + min * PX_PER_MIN).toFixed(1);
const seg = (id, from, to, name, time) =>
  `<g id="${id}"><rect x="${mx(from)}" y="270" width="${mx(to) - mx(from)}" height="120" rx="8" stroke-width="3"/>` +
  `<text x="${(mx(from) + mx(to)) / 2}" y="245" text-anchor="middle" font-size="26">${name}</text>` +
  `<text x="${(mx(from) + mx(to)) / 2}" y="432" text-anchor="middle" font-size="24" fill="var(--muted)">${time}</text></g>`;
const at = (id, min, label) =>
  `<text id="${id}" x="${mx(min)}" y="${min === riseAt ? 566 : 526}" text-anchor="middle" font-size="24">${label}</text>`;
const clock = `<svg viewBox="0 0 1200 640">
${seg('knead', mixAt, riseAt, 'knead', `${t.knead} min`)}
${seg('rise', riseAt, shapeAt, 'rise until doubled', '1 to 2 h')}
<g id="shape"><line x1="${mx(shapeAt)}" y1="262" x2="${mx(shapeAt)}" y2="398" stroke="var(--text)" stroke-width="6"/><text x="${mx(shapeAt)}" y="245" text-anchor="middle" font-size="26">shape</text></g>
${seg('proof', shapeAt, ovenAt, 'rise again', `${t.proof} min`)}
${seg('bake', ovenAt, doneAt, `bake ${ovenC} °C`, `${t.bake[0]}–${t.bake[1]} min`)}
<g id="cool"><rect x="${mx(doneAt) + 14}" y="270" width="${1170 - mx(doneAt) - 14}" height="120" rx="8" stroke-width="3" stroke-dasharray="10 8" fill="none"/><text x="${(mx(doneAt) + 1170) / 2 + 7}" y="245" text-anchor="middle" font-size="26">cool</text><text x="${(mx(doneAt) + 1170) / 2 + 7}" y="432" text-anchor="middle" font-size="24" fill="var(--muted)">then slice</text></g>
<g id="times"><line x1="${mx(0)}" y1="478" x2="${mx(doneAt)}" y2="478" stroke="var(--muted)" stroke-width="2"/>
${at('t-mix', mixAt, '0')}${at('t-rise', riseAt, `${riseAt} min`)}${at('t-shape', shapeAt, hm(shapeAt))}${at('t-oven', ovenAt, hm(ovenAt))}</g>
<g id="done"><circle cx="${mx(doneAt)}" cy="478" r="12" class="tone-good" stroke-width="3"/><text x="${mx(doneAt)}" y="526" text-anchor="middle" font-size="26" class="tone-good">bread, ${hm(doneAt)}</text></g>
</svg>`;

const scenes = [
  {
    type: 'svg',
    chapter: 'The formula',
    title: 'Every ingredient is a share of the flour',
    picture: 'recipe',
    narration:
      'Here is the thing most bread recipes do not tell you. Every ingredient is really just a percentage of the flour.',
    hidden: ['water', 'salt', 'yeast', 'total', ...ghostBars],
    labels: { 'p-total': 'percentages', 'g-total': 'dough weighs' },
    steps: [
      {
        focus: 'flour',
        say: `The flour is always one hundred percent. Say we use ${loaf[0]} grams.`,
        draw: [{ underline: 'p-flour', tone: 'good', when: 'one hundred percent' }],
      },
      {
        show: ['water'],
        focus: 'water',
        say: `Water is sixty six percent of that, so ${loaf[1]} grams.`,
        draw: [{ write: `${loaf[0]} × 66%`, near: 'bar-water', side: 'right', when: 'sixty six' }],
      },
      { show: ['salt'], focus: 'salt', say: `Salt is two percent, ${loaf[2]} grams.` },
      { show: ['yeast'], focus: 'yeast', say: `And yeast is one point two percent, just ${loaf[3]} grams.` },
      {
        show: ['total'],
        focus: ['p-total', 'g-total'],
        say: `Add the percentages up and you get more than a hundred, ${totalPct}.`,
      },
      {
        focus: 'g-total',
        say: `That is fine. It just means the dough weighs ${dough} grams.`,
        draw: [{ circle: 'g-total', when: 'dough weighs' }],
      },
    ],
  },
  {
    type: 'svg',
    chapter: 'Hydration',
    title: 'Hydration is water over flour',
    picture: 'recipe',
    narration: 'The most important number in that list is the water. Bakers call it hydration.',
    tint: { 'p-water': 'good' },
    labels: { 'bar-water': 'water', 'bar-flour': 'flour' },
    steps: [
      {
        focus: ['bar-water', 'bar-flour'],
        say: `It is just the water divided by the flour. ${loaf[1]} over ${loaf[0]} is sixty six percent.`,
        draw: [
          {
            arrow: ['bar-water', 'bar-flour'],
            note: `${loaf[1]} ÷ ${loaf[0]} = 66%`,
            side: 'right',
            when: 'divided by',
          },
        ],
      },
      {
        focus: 'p-water',
        say: 'And that one number tells you how the dough will feel before you even touch it.',
        draw: [{ write: 'how the dough feels', near: 'p-water', side: 'below', tone: 'good', when: 'feel' }],
      },
    ],
  },
  {
    type: 'svg',
    chapter: 'Wet or dry',
    title: 'Drier is easier, wetter is lighter',
    svg: doughs,
    narration: 'So what changes if you go drier or wetter? Here is the same flour at sixty and at eighty percent.',
    hidden: [
      'dough-dry',
      'dough-wet',
      'crumb-dry',
      'crumb-wet',
      'catch-dry',
      'catch-wet',
      'for-dry',
      'for-wet',
      'ruler',
      'ours',
    ],
    labels: {
      'water-dry': 'grams of water',
      'water-wet': 'grams',
      'dough-dry': 'firm',
      'dough-wet': 'slack',
      'crumb-dry': 'tight',
      'crumb-wet': 'moister',
      'catch-wet': 'shape',
      'for-dry': 'bagels',
      'for-wet': 'rustic loaves',
      ours: 'sixty six',
    },
    steps: [
      { focus: ['water-dry', 'water-wet'], say: `Only ${water(80) - water(60)} grams of water separate these two.` },
      {
        show: ['dough-dry', 'dough-wet'],
        focus: ['dough-dry', 'dough-wet'],
        say: 'At sixty percent the dough is firm and easy to handle. At eighty it is slack and sticky.',
      },
      {
        show: ['crumb-dry', 'crumb-wet'],
        focus: ['crumb-dry', 'crumb-wet'],
        say: 'The drier one bakes up tight and chewy. The wetter one is moister inside, and stays fresh longer.',
      },
      {
        show: ['catch-dry', 'catch-wet'],
        focus: ['catch-dry', 'catch-wet'],
        say: 'But a wet dough takes more skill to shape, and longer in the oven.',
      },
      {
        show: ['for-dry', 'for-wet'],
        focus: ['for-dry', 'for-wet'],
        say: 'Which is why bagels and pretzels are stiff doughs, and big rustic loaves are wet ones.',
      },
      { show: ['ruler', 'ours'], focus: 'ours', say: 'Sixty six sits comfortably in between.' },
    ],
  },
  {
    type: 'svg',
    chapter: 'Scaling',
    title: 'Scale the flour, and the rest follows',
    picture: 'recipe',
    narration: 'And here is why bakers love percentages. Scaling a recipe stops being a headache.',
    hidden: ghostBars,
    labels: { 'bar-flour': 'flour', 'g-total': 'grams of dough', 'p-total': 'total percentage' },
    steps: [
      {
        morph: Object.fromEntries(ids.map((id) => [`bar-${id}`, `bar2-${id}`])),
        set: { ...Object.fromEntries(ids.map((id, i) => [`g-${id}`, `${two[i]} g`])), 'g-total': `${dough * 2} g` },
        focus: 'flour',
        say: 'Want two loaves? Double the flour, and every other number doubles with it.',
      },
      {
        set: { 'g-total': `${target} g` },
        focus: ['g-total', 'p-total'],
        say: `Want exactly ${target} grams of dough for a big pan? Divide it by one point six nine two, the total percentage.`,
        draw: [
          { write: `${target} ÷ ${totalPct / 100} = ${targetFlour}`, near: 'g-total', side: 'right', when: 'divide' },
        ],
      },
      {
        morph: Object.fromEntries(ids.map((id) => [`bar-${id}`, `bar3-${id}`])),
        set: Object.fromEntries(ids.map((id, i) => [`g-${id}`, `${scaled[i]} g`])),
        tint: { 'g-flour': 'good' },
        focus: 'flour',
        say: `That gives ${targetFlour} grams of flour, and the percentages do the rest.`,
      },
    ],
  },
  {
    type: 'svg',
    chapter: 'The method',
    title: 'One lean loaf, step by step',
    picture: 'clock',
    narration: 'Now the method. The times come from a tested recipe for this same kind of dough.',
    hidden: ['knead', 'rise', 'shape', 'proof', 'bake', 'cool', 'times', 'done'],
    labels: { knead: 'knead', rise: 'rise', proof: 'rise again', bake: 'bake', cool: 'cool' },
    steps: [
      {
        show: ['knead'],
        focus: 'knead',
        say: `Mix everything and knead for about ${t.knead} minutes, until it is smooth.`,
      },
      {
        show: ['rise'],
        focus: 'rise',
        say: 'Cover it and let it rise until it has doubled. That takes one to two hours, depending on how warm your kitchen is.',
      },
      { show: ['shape'], focus: 'shape', say: 'Shape it into a loaf.' },
      { show: ['proof'], focus: 'proof', say: `Let it rise again, about ${t.proof} minutes.` },
      {
        show: ['bake'],
        focus: 'bake',
        say: 'Bake it hot, four hundred and fifty Fahrenheit, for twenty to twenty five minutes.',
      },
      { show: ['cool'], focus: 'cool', say: 'And let it cool before you cut it. It is still cooking inside.' },
    ],
  },
  {
    type: 'svg',
    chapter: 'Where the time goes',
    title: 'Most of the time, you wait',
    picture: 'clock',
    narration: 'Put those times on a clock, taking the quick end of each one.',
    hidden: ['times', 't-shape', 't-oven', 'done'],
    labels: { 't-rise': 'minutes of work', 't-shape': 'shape', 't-oven': 'into the oven', done: 'bread' },
    steps: [
      {
        show: ['times'],
        focus: ['knead', 't-rise'],
        say: `The mixing and kneading is about ${t.knead} minutes of work.`,
      },
      {
        show: ['t-shape'],
        focus: ['rise', 't-shape'],
        say: 'Then you wait an hour while the yeast does its thing, and shape it.',
      },
      {
        focus: 'rise',
        say: `In a cool kitchen it can take two, which pushes the bread back to ${hm(slowDone).replace(' h ', ' hours ')} minutes.`,
        draw: [{ write: `cool kitchen: +1 h, bread at ${hm(slowDone)}`, at: [0.3, 0.06], when: 'cool kitchen' }],
      },
      {
        show: ['t-oven'],
        focus: ['proof', 't-oven'],
        erase: true,
        say: 'Another forty five minutes of waiting, and into the oven.',
      },
      {
        show: ['done'],
        focus: ['bake', 'done'],
        say: 'About two and a quarter hours from start to bread.',
      },
      {
        focus: ['rise', 'proof'],
        say: `And for ${waitingShare} percent of that, you are not doing anything at all.`,
        draw: [
          { brace: ['rise', 'proof'], note: `${waitingShare}% waiting`, side: 'above', when: 'not doing anything' },
        ],
      },
    ],
  },
];

fs.writeFileSync(
  new URL('./storyboard.json', import.meta.url),
  JSON.stringify(
    {
      title: 'Bread by baker’s percentages',
      subtitle: 'Why every bread recipe is four numbers, and how to scale it',
      tones: { good: 'our loaf: 66% water', bad: 'the catch' },
      pictures: { recipe, clock },
      scenes,
    },
    null,
    2,
  ) + '\n',
);
