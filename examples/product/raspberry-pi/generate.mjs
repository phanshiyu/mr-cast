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
  cpu: 'Cortex-A72',
  ghz: 1.8,
  graphics: 'OpenGL ES 3.0',
  memory: 'LPDDR4',
  ram: [1, 2, 3, 4, 8],
  camera: 'one 2-lane camera, one 2-lane display',
  amps: 3,
  maxC: 50,
  until: 'January 2034',
  price: { 1: 35, 2: 67.5, 3: 83.75, 4: 100, 8: 165 },
};
const pi5 = {
  cpu: 'Cortex-A76',
  ghz: 2.4,
  graphics: 'VideoCore VII, Vulkan 1.2',
  gpuMhz: 800,
  memory: 'LPDDR4X-4267',
  ram: [1, 2, 4, 8, 16],
  camera: 'two 4-lane, camera or display',
  amps: 5,
  maxC: 70,
  until: 'January 2036',
  claim: [2, 3],
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
  {
    spec: 'USB and network',
    a: '2 × USB 3.0, 2 × USB 2.0, Gigabit',
    b: '2 × USB 3.0, 2 × USB 2.0, Gigabit',
    win: null,
  },
  { spec: 'Power supply', a: `5 V, ${pi4.amps} A`, b: `5 V, ${pi5.amps} A`, win: 'a' },
  { spec: 'Works up to', a: `${pi4.maxC} °C`, b: `${pi5.maxC} °C`, win: 'b' },
  { spec: 'Made until at least', a: pi4.until, b: pi5.until, win: 'b' },
];
const score = { a: scorecard.filter((r) => r.win === 'a').length, b: scorecard.filter((r) => r.win === 'b').length };
assert.deepEqual(score, { a: 1, b: 6 }, 'six rows to the Pi 5, one to the Pi 4, one tie');

// Prices at the memory sizes both boards come in.
const shared = pi4.ram.filter((g) => pi5.ram.includes(g));
assert.deepEqual(shared, [1, 2, 4, 8]);
const gaps = shared.map((g) => pi5.price[g] - pi4.price[g]);
assert.deepEqual(gaps, [10, 10, 10, 10], 'the Pi 5 costs ten dollars more at every shared size');
const pct8 = Math.round((gaps[3] / pi4.price[8]) * 1000) / 10;
assert.equal(pct8, 6.1);

// ---------- the pictures ----------
const T = (x, y, s, extra = '') => `<text x="${x}" y="${y}" font-size="22" ${extra}>${s}</text>`;
const part = (id, x, y, w, h, label, extra = '') =>
  `<g${id ? ` id="${id}"` : ''}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" stroke-width="3"${extra}/>${label ? T(x + w / 2, y + h / 2 + 8, label, 'text-anchor="middle"') : ''}</g>`;
const pins = (x, y) =>
  `<g>${part('', x, y, 360, 34, '')}${Array.from({ length: 20 }, (_, i) => `<circle cx="${x + 9 + i * 18}" cy="${y + 17}" r="4" fill="var(--muted)"/>`).join('')}</g>`;
// One board, 456 by 300 (the boards are 85 by 56 mm), with what both have; the Pi 5 adds four parts.
const board = (
  id,
  x0,
  name,
  y0 = 50,
) => `<g id="${id}"><rect x="${x0}" y="${y0}" width="456" height="300" rx="18" stroke-width="4"/>
${[
  [20, 20],
  [436, 20],
  [20, 280],
  [436, 280],
]
  .map(
    ([dx, dy]) => `<circle cx="${x0 + dx}" cy="${y0 + dy}" r="9" fill="none" stroke="var(--muted)" stroke-width="2"/>`,
  )
  .join('')}
${pins(x0 + 40, y0 + 14)}
${part('', x0 + 140, y0 + 110, 120, 110, 'processor')}
${part('', x0 + 380, y0 + 64, 96, 60, 'USB')}${part('', x0 + 380, y0 + 140, 96, 60, 'USB')}${part('', x0 + 380, y0 + 216, 96, 70, 'LAN')}
${part('', x0 + 60, y0 + 262, 80, 46, 'power')}${part('', x0 + 160, y0 + 270, 60, 38, '')}${part('', x0 + 240, y0 + 270, 60, 38, '')}
</g>${T(x0 + 228, y0 + 360, name, 'text-anchor="middle" font-size="36"')}`;
const X4 = 40;
const X5 = 684;
const boards = `<svg viewBox="0 0 1200 640">
${board('pi4', X4, 'Pi 4')}
${board('pi5', X5, 'Pi 5')}
<g id="button"><circle cx="${X5 + 34}" cy="${50 + 240}" r="14" class="tone-good" stroke-width="3"/>${T(X5 + 56, 50 + 248, 'power button', 'class="tone-good"')}</g>
<g id="rtc"><rect x="${X5 + 30}" y="${50 + 66}" width="40" height="26" rx="4" class="tone-good" stroke-width="3"/>${T(X5 + 78, 50 + 88, 'clock', 'class="tone-good"')}</g>
<g id="pcie"><rect x="${X5 + 20}" y="${50 + 130}" width="26" height="82" rx="4" class="tone-good" stroke-width="3"/>${T(X5 + 56, 50 + 182, 'PCIe', 'class="tone-good"')}</g>
<g id="rp1"><rect x="${X5 + 280}" y="${50 + 120}" width="84" height="90" rx="6" class="tone-good" stroke-width="3"/>${T(X5 + 322, 50 + 173, 'RP1', 'text-anchor="middle" class="tone-good"')}</g>
<text id="source" x="600" y="500" text-anchor="middle" font-size="26" fill="var(--muted)">every number: Raspberry Pi’s own product briefs</text>
<g id="v1">${T(X5, 480, 'buying new? get the Pi 5', 'font-size="26"')}</g>
<g id="v2">${T(X5, 530, 'desktop, fast drive, two cameras?', 'font-size="26"')}${T(X5, 566, 'upgrade', 'font-size="26"')}</g>
<g id="v3">${T(X4, 480, 'already doing its job? keep it', 'font-size="26"')}</g>
<g id="v4">${T(X5, 616, 'upgrading? budget for a 5 A supply', 'font-size="26" class="tone-bad"')}</g>
</svg>`;

// The scorecard: one row per spec, the winner's cell in green, and the tally at the top.
const RY = (i) => 140 + i * 62;
const scoreSvg = `<svg viewBox="0 0 1200 640">
<text id="t4" x="510" y="60" text-anchor="middle" font-size="34">Pi 4: 0</text><text id="t5" x="950" y="60" text-anchor="middle" font-size="34">Pi 5: 0</text>
<line x1="20" y1="90" x2="1180" y2="90" stroke="var(--muted)" stroke-width="2"/>
${scorecard
  .map(
    (r, i) =>
      `<g id="row${i}">${T(20, RY(i), r.spec, 'fill="var(--muted)"')}<text id="a${i}" x="300" y="${RY(i)}" font-size="22">${r.a}</text><text id="b${i}" x="740" y="${RY(i)}" font-size="22">${r.b}</text></g>`,
  )
  .join('\n')}
</svg>`;
const count = (n) => ({
  t4: `Pi 4: ${scorecard.slice(0, n).filter((r) => r.win === 'a').length}`,
  t5: `Pi 5: ${scorecard.slice(0, n).filter((r) => r.win === 'b').length}`,
});
// What the tally says after n rows, only the boards whose count moved since row m.
const won = (n, m) => Object.fromEntries(Object.entries(count(n)).filter(([k, v]) => count(m)[k] !== v));
const winTint = (...rows) =>
  Object.assign(
    {},
    ...rows.map((i) => (scorecard[i].win ? { [`${scorecard[i].win}${i}`]: 'good' } : { [`row${i}`]: 'dim' })),
  );
assert.deepEqual(count(8), { t4: `Pi 4: ${score.a}`, t5: `Pi 5: ${score.b}` });

// Speed: two bars, the Pi 5's growing from the clock alone to Raspberry Pi's own claim.
const U = 140; // px per "times the Pi 4"
const bar = (x, v) => `M${x} ${580 - v * U} H${x + 220} V580 H${x} Z`;
const speedSvg = `<svg viewBox="0 0 1200 640">
<line x1="160" y1="580" x2="1040" y2="580" stroke="var(--text)" stroke-width="3"/>
<path id="bar4" d="${bar(250, 1)}" stroke-width="3"/>
<path id="bar5" d="${bar(650, 1)}" stroke-width="3"/>
<path id="bar5clock" d="${bar(650, clockRatio)}"/><path id="bar5two" d="${bar(650, pi5.claim[0])}"/><path id="bar5three" d="${bar(650, pi5.claim[1])}"/>
<text x="360" y="620" text-anchor="middle" font-size="30">Pi 4</text><text x="760" y="620" text-anchor="middle" font-size="30">Pi 5</text>
<text x="360" y="556" text-anchor="middle" font-size="30">1×</text>
<text id="x5" x="760" y="556" text-anchor="middle" font-size="30">1×</text>
<g id="two"><line x1="620" y1="${580 - 2 * U}" x2="900" y2="${580 - 2 * U}" stroke="var(--text)" stroke-width="3" stroke-dasharray="10 8"/>${T(910, 580 - 2 * U + 8, 'at least 2×', 'font-size="26"')}</g>
</svg>`;

// Price: the two boards' list prices at each shared memory size; the Pi 5's extra ten dollars in orange.
const PS = 2.6; // px per dollar
const gx = (i) => 170 + i * 260;
const priceSvg = `<svg viewBox="0 0 1200 640">
<line x1="60" y1="560" x2="1160" y2="560" stroke="var(--text)" stroke-width="3"/>
${shared
  .map((g, i) => {
    const p4 = pi4.price[g];
    const p5 = pi5.price[g];
    return `<g id="g${g}"><rect x="${gx(i)}" y="${560 - p4 * PS}" width="90" height="${p4 * PS}" rx="4" stroke-width="3"/>${T(gx(i) + 45, 560 - p4 * PS - 12, $(p4), 'text-anchor="middle"')}
<rect x="${gx(i) + 100}" y="${560 - p4 * PS}" width="90" height="${p4 * PS}" rx="4" stroke-width="3"/>
<rect id="extra${g}" x="${gx(i) + 100}" y="${560 - p5 * PS}" width="90" height="${(p5 - p4) * PS}" rx="4" class="tone-bad" stroke-width="3"/>${T(gx(i) + 145, 560 - p5 * PS - 12, $(p5), 'text-anchor="middle"')}
${T(gx(i) + 95, 600, GB(g), 'text-anchor="middle" font-size="26"')}</g>`;
  })
  .join('\n')}
<g>${T(60, 60, 'left: Pi 4', 'font-size="26" fill="var(--muted)"')}${T(60, 96, 'right: Pi 5', 'font-size="26" fill="var(--muted)"')}</g>
</svg>`;

const newParts = ['button', 'rtc', 'pcie', 'rp1'];
const verdict = ['v1', 'v2', 'v3', 'v4'];
const scenes = [
  {
    type: 'svg',
    chapter: 'The question',
    title: 'Is the Pi 5 worth the upgrade?',
    picture: 'boards',
    hidden: [...newParts, ...verdict, 'source'],
    labels: { pi4: 'Pi four', pi5: 'Pi five' },
    narration: 'The Raspberry Pi five is out, and plenty of people still run a Pi four.',
    steps: [
      { focus: ['pi4', 'pi5'], say: 'So is the upgrade worth it?' },
      {
        show: ['source'],
        focus: ['source'],
        say: 'Every number in this video comes from the two boards’ official product briefs. No rumours.',
      },
    ],
  },
  {
    type: 'svg',
    chapter: 'Scorecard',
    title: 'Six rows to the Pi 5, one to the Pi 4',
    svg: scoreSvg,
    hidden: scorecard.map((_, i) => `row${i}`).slice(1),
    labels: {
      row0: 'processor',
      row1: 'graphics',
      row2: 'memory',
      row3: 'camera and display ports',
      row4: 'USB',
      row5: 'power',
      row6: 'hotter',
      row7: 'made',
    },
    narration: 'Let’s go down the spec sheet one row at a time, and give each row to whichever board wins it.',
    steps: [
      {
        focus: ['row0', 't5'],
        tint: winTint(0),
        set: won(1, 0),
        say: `The processor. The Pi five has a newer core, the A seventy six, at ${pi5.ghz} gigahertz instead of ${pi4.ghz}. First point to the five.`,
      },
      {
        show: ['row1', 'row2'],
        focus: ['row1', 'row2'],
        tint: winTint(1, 2),
        set: won(3, 1),
        say: 'Graphics and memory go to the five as well: a new graphics chip that runs Vulkan, and up to sixteen gigabytes of newer memory.',
      },
      {
        show: ['row3'],
        focus: ['row3'],
        tint: winTint(3),
        set: won(4, 3),
        say: 'The two camera and display ports are now twice as wide, and each takes a camera or a screen.',
      },
      {
        show: ['row4'],
        focus: ['row4'],
        tint: winTint(4),
        say: 'USB and networking are the same on both. That one is a tie.',
      },
      {
        show: ['row5'],
        focus: ['row5', 't4'],
        tint: winTint(5),
        set: won(6, 4),
        say: `Power is where the four wins. The five wants a five amp supply, so your old ${pi4.amps} amp charger may not cut it.`,
      },
      {
        show: ['row6', 'row7'],
        focus: ['row6', 'row7', 't4', 't5'],
        tint: winTint(6, 7),
        set: won(8, 6),
        say: `The five runs hotter, up to ${pi5.maxC} degrees, and will be made two years longer. Final score, ${score.b} to ${score.a}.`,
      },
    ],
  },
  {
    type: 'svg',
    chapter: 'How much faster',
    title: 'Two to three times, mostly from the core',
    svg: speedSvg,
    hidden: ['bar5clock', 'bar5two', 'bar5three', 'two'],
    labels: { bar5: 'Pi five', bar4: 'Pi four', x5: 'third faster', two: 'twice as fast' },
    narration: 'Now the big one. How much faster is it, really? Start with both boards at the same height.',
    steps: [
      {
        morph: { bar5: 'bar5clock' },
        set: { x5: `${clockRatio}×` },
        focus: ['bar5', 'x5'],
        say: `The clock alone is ${pi5.ghz} against ${pi4.ghz}. That makes it only a third faster.`,
        draw: [{ write: `${pi5.ghz} ÷ ${pi4.ghz} GHz`, near: 'bar5', side: 'right', when: 'clock alone' }],
      },
      {
        morph: { bar5: 'bar5two' },
        show: ['two'],
        set: { x5: `${pi5.claim[0]}×` },
        focus: ['bar5', 'two'],
        erase: true,
        say: 'But each tick of the newer core gets more done. Raspberry Pi says the five is at least twice as fast.',
      },
      {
        morph: { bar5: 'bar5three' },
        set: { x5: `${pi5.claim[0]} to ${pi5.claim[1]}×` },
        focus: ['bar5', 'x5'],
        say: 'And up to three times, depending on the job.',
      },
      {
        focus: ['bar5'],
        say: 'That is their number, not a test we ran. But most of it comes from the core, not the clock.',
        draw: [
          {
            write: 'mostly the newer core,\nnot the clock',
            near: 'bar4',
            side: 'above',
            tone: 'good',
            when: 'most of it',
          },
        ],
      },
    ],
  },
  {
    type: 'svg',
    chapter: 'What is new',
    title: 'Four things only the Pi 5 has',
    picture: 'boards',
    hidden: [...newParts, ...verdict, 'source'],
    labels: { button: 'power button', rtc: 'real time clock', pcie: 'PCI Express', rp1: 'chip' },
    narration: 'Then there are the things the Pi four simply does not have.',
    steps: [
      { show: ['button'], focus: ['button'], say: 'A power button. Finally. No more pulling the cable out.' },
      {
        show: ['rtc'],
        focus: ['rtc'],
        say: 'A real time clock, so it knows the time even after it was switched off, if you add a little battery.',
      },
      {
        show: ['pcie'],
        focus: ['pcie'],
        say: 'A PCI Express slot. With an add-on board you can plug in a fast solid state drive instead of a memory card.',
        draw: [{ circle: 'pcie', when: 'solid state drive' }],
      },
      {
        show: ['rp1'],
        focus: ['rp1'],
        say: 'And a chip Raspberry Pi designed itself, which handles most of the plugs and pins, and more than doubles the USB speed overall.',
      },
    ],
  },
  {
    type: 'svg',
    chapter: 'Price',
    title: 'Ten dollars more at every size',
    svg: priceSvg,
    labels: { g1: 'one gigabyte', g2: 'two', g4: 'four', g8: 'eight gigabytes', extra8: 'six percent' },
    narration: 'So what does it cost? Here are the list prices for the memory sizes both boards come in.',
    steps: [
      {
        focus: ['g1', 'extra1'],
        tint: { extra1: 'bad' },
        say: `At one gigabyte, the five is ${gaps[0]} dollars more.`,
        draw: [{ write: `+${$(gaps[0])}`, near: 'extra1', side: 'right', tone: 'bad', when: 'dollars more' }],
      },
      { focus: ['g2', 'g4'], say: 'At two and four gigabytes, also ten dollars more.' },
      {
        focus: ['g8', 'extra8'],
        say: `And at eight gigabytes, ten dollars again. On a ${pi4.price[8]} dollar board that is only about six percent.`,
        draw: [{ write: `+${pct8}%`, near: 'g8', side: 'above', tone: 'bad', when: 'six percent' }],
      },
    ],
  },
  {
    type: 'svg',
    chapter: 'Verdict',
    title: 'Buy the 5, keep a working 4',
    picture: 'boards',
    hidden: [...verdict, 'source'],
    labels: { v1: 'buying a new board', v2: 'desktop', v3: 'home server', v4: 'power supply', pi4: 'Pi four' },
    narration: 'So here is my verdict.',
    steps: [
      {
        show: ['v1'],
        focus: ['v1'],
        say: 'If you are buying a new board, the extra ten dollars is easily worth it. Get the five.',
        draw: [{ tick: 'v1' }],
      },
      {
        show: ['v2'],
        focus: ['v2'],
        say: 'If you want a small desktop, a fast drive, or two cameras, upgrade.',
        draw: [{ tick: 'v2' }],
      },
      {
        show: ['v3'],
        focus: ['v3', 'pi4'],
        say: 'But if your Pi four already runs your home server just fine, there is no need to throw it out.',
      },
      {
        show: ['v4'],
        focus: ['v4'],
        say: 'And if you do upgrade, plan on a bigger power supply.',
        draw: [{ underline: 'v4', tone: 'bad', when: 'bigger power supply' }],
      },
    ],
  },
];

fs.writeFileSync(
  new URL('./storyboard.json', import.meta.url),
  JSON.stringify(
    {
      title: 'Raspberry Pi 5 against Pi 4',
      subtitle: 'Is the upgrade worth it? A spec-by-spec scorecard from the product briefs',
      tones: { good: 'what the Pi 5 wins or adds', bad: 'what the upgrade costs' },
      pictures: { boards },
      scenes,
    },
    null,
    2,
  ) + '\n',
);
