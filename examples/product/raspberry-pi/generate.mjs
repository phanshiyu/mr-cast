// Writes storyboard.json beside this file, then checks every spec, ratio, score and price against the facts below.
// Run: node examples/product/raspberry-pi/generate.mjs
//
// Every spec comes from Raspberry Pi's own product briefs, both published October 2026:
//   Pi 5: https://pip.raspberrypi.com/documents/RP-008348-DS-raspberry-pi-5-product-brief.pdf
//   Pi 4: https://pip.raspberrypi.com/documents/RP-008344-DS-raspberry-pi-4-product-brief.pdf
// The Pi 4 brief gives 1.8 GHz and names no GPU or memory speed, so neither does this video (early Pi 4 boards ran at
// 1.5 GHz; the brief no longer says so). "2 to 3×" is the Pi 5 brief's own claim, and the video says whose it is.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pi4 = {
  cpu: 'Cortex-A72', ghz: 1.8, graphics: 'OpenGL ES 3.0', memory: 'LPDDR4', ram: [1, 2, 3, 4, 8],
  camera: 'one 2-lane camera, one 2-lane display', amps: 3, maxC: 50, until: 'January 2034',
  price: { 1: 35, 2: 67.5, 3: 83.75, 4: 100, 8: 165 },
};
const pi5 = {
  cpu: 'Cortex-A76', ghz: 2.4, graphics: 'VideoCore VII, Vulkan 1.2', gpuMhz: 800, memory: 'LPDDR4X-4267', ram: [1, 2, 4, 8, 16],
  camera: 'two 4-lane, camera or display', amps: 5, maxC: 70, until: 'January 2036', claim: [2, 3],
  price: { 1: 45, 2: 77.5, 4: 110, 8: 175, 16: 305 },
};

const clockRatio = Math.round((pi5.ghz / pi4.ghz) * 1000) / 1000;
assert.equal(clockRatio, 1.333, 'the clock alone is a third faster');
assert(clockRatio < pi5.claim[0], 'the newer core, not the clock, makes most of the 2 to 3×');

const GB = (n) => `${n} GB`;
const range = (ram) => `${GB(ram[0])} to ${GB(ram.at(-1))}`;
const $ = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

// The scorecard: each row's winner, or null for a tie. Power is a cost, so the Pi 4's smaller charger wins that row.
const scorecard = [
  { spec: 'Processor', a: `${pi4.cpu} at ${pi4.ghz} GHz`, b: `${pi5.cpu} at ${pi5.ghz} GHz`, win: 'b' },
  { spec: 'Graphics', a: pi4.graphics, b: pi5.graphics, win: 'b' },
  { spec: 'Memory', a: `${pi4.memory}, ${range(pi4.ram)}`, b: `${pi5.memory}, ${range(pi5.ram)}`, win: 'b' },
  { spec: 'Camera and display', a: pi4.camera, b: pi5.camera, win: 'b' },
  { spec: 'USB and network', a: '2 × USB 3.0, 2 × USB 2.0, Gigabit', b: '2 × USB 3.0, 2 × USB 2.0, Gigabit', win: null },
  { spec: 'Power supply', a: `5 V, ${pi4.amps} A`, b: `5 V, ${pi5.amps} A`, win: 'a' },
  { spec: 'Works up to', a: `${pi4.maxC} °C`, b: `${pi5.maxC} °C`, win: 'b' },
  { spec: 'Made until at least', a: pi4.until, b: pi5.until, win: 'b' },
];
const score = { a: scorecard.filter((r) => r.win === 'a').length, b: scorecard.filter((r) => r.win === 'b').length };
assert.deepEqual(score, { a: 1, b: 6 }, 'six rows to the Pi 5, one to the Pi 4, one tie');
const winTint = (i) => (scorecard[i].win ? { [`${scorecard[i].win === 'a' ? 'Pi 4' : 'Pi 5'}@${i}`]: 'good' } : { [i]: 'dim' });
const tints = (...rows) => Object.assign({}, ...rows.map(winTint));
const tally = (n) => { const won = scorecard.slice(0, n); return `Pi 4: **${won.filter((r) => r.win === 'a').length}** · Pi 5: **${won.filter((r) => r.win === 'b').length}**`; };

// Prices at the memory sizes both boards come in.
const shared = pi4.ram.filter((g) => pi5.ram.includes(g));
assert.deepEqual(shared, [1, 2, 4, 8]);
const gaps = shared.map((g) => pi5.price[g] - pi4.price[g]);
assert.deepEqual(gaps, [10, 10, 10, 10], 'the Pi 5 costs ten dollars more at every shared size');
assert.equal(tally(8), `Pi 4: **${score.a}** · Pi 5: **${score.b}**`);
const pct8 = Math.round((gaps[3] / pi4.price[8]) * 1000) / 10;
assert.equal(pct8, 6.1);

const scenes = [
  {
    type: 'text',
    chapter: 'The question',
    narration: 'The Raspberry Pi five is out, and plenty of people still run a Pi four. So is the upgrade worth it?',
    kicker: 'Raspberry Pi 5 against Raspberry Pi 4',
    question: 'Is the upgrade worth it?',
    note: 'Every number here is from Raspberry Pi’s own product briefs',
    hidden: ['note'],
    steps: [{ show: ['note'], say: 'Every number in this video comes from the two boards’ official product briefs. No rumours.' }],
  },
  {
    type: 'table',
    chapter: 'Scorecard',
    title: 'Spec by spec',
    narration: 'Let’s go down the spec sheet one row at a time, and give each row to whichever board wins it.',
    columns: ['Spec', 'Pi 4', 'Pi 5'],
    rows: scorecard.map((r, i) => ({ cells: [r.spec, r.a, r.b], ...(i ? { hidden: true } : {}) })),
    callout: tally(0),
    steps: [
      { focus: 0, tint: tints(0), callout: tally(1), say: `The processor. The Pi five has a newer core, the A seventy six, and runs it at ${pi5.ghz} gigahertz instead of ${pi4.ghz}. First point goes to the five.` },
      { show: [1, 2], focus: [1, 2], tint: tints(1, 2), callout: tally(3), say: 'Graphics and memory both go to the five as well: a new graphics chip that runs Vulkan, newer memory, and up to sixteen gigabytes of it.' },
      { show: [3], focus: 3, tint: tints(3), callout: tally(4), say: 'The two camera and display ports are now twice as wide, and each one takes either a camera or a screen.' },
      { show: [4], focus: 4, tint: tints(4), say: 'USB and networking are the same on both. That one is a tie.' },
      { show: [5], focus: 5, tint: tints(5), callout: tally(6), say: `Power is where the four wins. The five wants a five amp supply, so your old ${pi4.amps} amp charger may not cut it.` },
      { show: [6, 7], focus: [6, 7], tint: tints(6, 7), callout: tally(8), say: `The five is rated to run hotter, up to ${pi5.maxC} degrees, and it will be made for two years longer. Final score, ${score.b} to ${score.a}.` },
    ],
  },
  {
    type: 'chart',
    chapter: 'How much faster',
    title: 'Processor speed, as times the Pi 4',
    kind: 'bar',
    unit: '×',
    better: 'higher',
    narration: 'Now the big one. How much faster is it, really? Start with both boards at the same height.',
    labels: ['Pi 4', 'Pi 5'],
    series: [{ name: 'times the Pi 4', values: [1, 1] }],
    callout: 'Pi 4 = 1',
    steps: [
      { set: { 'times the Pi 4': [1, clockRatio] }, focus: 'Pi 5', callout: `${pi5.ghz} ÷ ${pi4.ghz} GHz = ${clockRatio}×`, say: `The clock alone is ${pi5.ghz} against ${pi4.ghz}. That makes it only a third faster.` },
      { set: { 'times the Pi 4': [1, pi5.claim[0]] }, focus: 'Pi 5', callout: 'newer core: at least 2×', say: 'But each tick of the newer core gets more done. Raspberry Pi says the five is at least twice as fast.' },
      { set: { 'times the Pi 4': [1, pi5.claim[1]] }, focus: 'Pi 5', callout: 'Raspberry Pi’s claim: 2 to 3×', say: 'And up to three times, depending on the job. That is their number, not a test we ran, but most of it comes from the core, not the clock.', draw: [{ write: 'mostly the newer core,\nnot the clock', near: 'Pi 5', side: 'left', when: 'most of it' }] },
    ],
  },
  {
    type: 'compare',
    chapter: 'What is new',
    title: 'Things only the Pi 5 has',
    sides: [{ title: 'Pi 4' }, { title: 'Pi 5', tone: 'accent' }],
    narration: 'Then there are the things the Pi four simply does not have.',
    rows: [
      { label: 'Power button', cells: ['No', 'Yes'], verdict: [null, 'good'] },
      { label: 'Clock that keeps time when off', cells: ['No', 'Yes, with a small battery'], verdict: [null, 'good'] },
      { label: 'PCI Express, for fast drives', cells: ['No', 'One lane, with an add-on board'], verdict: [null, 'good'] },
      { label: 'Its own input and output chip', cells: ['No', 'Yes, made by Raspberry Pi'], verdict: [null, 'good'] },
    ],
    steps: [
      { focus: 0, say: 'A power button. Finally. No more pulling the cable out.' },
      { focus: 1, say: 'A real time clock, so it knows the time even after it was switched off, if you add a little battery.' },
      { focus: 2, say: 'A PCI Express slot. With an add-on board you can plug in a fast solid state drive instead of booting from a memory card.', draw: [{ circle: '2@Pi 5', when: 'solid state drive' }] },
      { focus: 3, say: 'And a chip Raspberry Pi designed itself, which handles most of the plugs and pins, and more than doubles the USB speed overall.' },
    ],
  },
  {
    type: 'chart',
    chapter: 'Price',
    // No `unit`: the chart prints it after the value, which reads "35 $"; the title names the currency instead.
    title: 'List price in US dollars, by memory size',
    kind: 'bar',
    better: 'lower',
    narration: 'So what does it cost? Here are the list prices for the memory sizes both boards come in.',
    labels: shared.map(GB),
    series: [
      { name: 'Pi 4', values: shared.map((g) => pi4.price[g]) },
      { name: 'Pi 5', values: shared.map((g) => pi5.price[g]) },
    ],
    steps: [
      { focus: GB(1), callout: `+${$(gaps[0])}`, say: `At one gigabyte, the five is ${gaps[0]} dollars more.` },
      { focus: [GB(2), GB(4)], callout: `+${$(gaps[1])}`, say: 'At two and four gigabytes, also ten dollars more.' },
      { focus: GB(8), callout: `+${$(gaps[3])}, ${pct8}% more`, say: `And at eight gigabytes, ten dollars again. On a ${pi4.price[8]} dollar board that is only about six percent.` },
    ],
  },
  {
    type: 'text',
    chapter: 'Verdict',
    narration: 'So here is my verdict.',
    kicker: 'The verdict',
    number: `${$(gaps[0])} more`,
    note: 'for two to three times the speed, by Raspberry Pi’s count',
    items: [
      'Buying new? Get the Pi 5',
      'Want a desktop, a fast drive or two cameras? Upgrade',
      'Pi 4 already doing its job? Keep it',
      'Upgrading? Budget for a 5 A power supply',
    ],
    hidden: ['0-3'],
    steps: [
      { show: [0], say: 'If you are buying a new board, the extra ten dollars is easily worth it. Get the five.', draw: [{ tick: 0 }] },
      { show: [1], say: 'If you want a small desktop, a fast drive, or two cameras, upgrade.', draw: [{ tick: 1 }] },
      { show: [2], say: 'But if your Pi four already runs your home server just fine, there is no need to throw it out.' },
      { show: [3], say: 'And if you do upgrade, plan on a bigger power supply.', draw: [{ underline: 3, when: 'bigger power supply' }] },
    ],
  },
];

fs.writeFileSync(
  new URL('./storyboard.json', import.meta.url),
  JSON.stringify({ title: 'Raspberry Pi 5 against Pi 4', subtitle: 'Is the upgrade worth it? A spec-by-spec scorecard from the product briefs', scenes }, null, 2) + '\n',
);
