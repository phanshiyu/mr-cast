// Writes storyboard.json beside this file. The drawings are computed here, and the numbers are checked.
// Run: node examples/science/mrna-vaccine/generate.mjs
//
// Primary source: CDC, "COVID-19 Vaccine Basics" (https://www.cdc.gov/covid/vaccines/how-they-work.html, updated
// 3 September 2024). It says mRNA vaccines use "mRNA created in a laboratory" to teach cells to make "a harmless piece
// of what is called the spike protein"; the cells "display the spike protein piece on their surface"; "This triggers
// our immune system to produce antibodies"; the mRNA does "not enter the nucleus of the cell where our DNA (genetic
// material) is located", so it "cannot change or influence our genes"; and afterwards "our cells break down the mRNA
// and remove it". The CDC page does not describe the fat bubble or memory cells. For those: the lipid nanoparticle
// protects the mRNA and carries it into the cell (Swiss Academies of Sciences, "How does an mRNA vaccine work?",
// naturalsciences.ch), and memory B cells stay after the antibodies (Frontiers for Young Minds,
// doi:10.3389/frym.2023.1100502). The spike protein of SARS-CoV-2 is 1,273 amino acids long (UniProt P0DTC2).
// Three letters of mRNA (a codon) code for one amino acid, and the message ends on a stop codon.
import fs from 'node:fs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const N = (n) => n.toLocaleString('en-US');
const f1 = (x) => x.toFixed(1);

const spikeLength = 1273; // amino acids, UniProt P0DTC2
const letters = spikeLength * 3;
assert(letters === 3819, 'three letters a block');
const codons = 4 ** 3;
assert(codons === 64, 'four letters, three at a time');

// A spike protein drawn pointing up from (0, 0): a stalk and a club-shaped head.
const spikeD = (s = 1) =>
  `M ${-5 * s} 0 L ${-5 * s} ${-30 * s} C ${-26 * s} ${-36 * s} ${-26 * s} ${-70 * s} 0 ${-74 * s} C ${26 * s} ${-70 * s} ${26 * s} ${-36 * s} ${5 * s} ${-30 * s} L ${5 * s} 0 Z`;
// A copy of it standing on a circle or ellipse at angle t (radians from straight up), turned to point outward.
const rad = (d) => (d * Math.PI) / 180;
const onEllipse = (cx, cy, rx, ry, deg) => {
  const t = rad(deg);
  const x = cx + rx * Math.sin(t),
    y = cy - ry * Math.cos(t);
  const nx = Math.sin(t) / rx,
    ny = -Math.cos(t) / ry; // outward normal, unnormalised
  const turn = (Math.atan2(nx, -ny) * 180) / Math.PI;
  return { x, y, turn };
};
const spikeAt = (id, { x, y, turn }, s, cls) =>
  `<path${id ? ` id="${id}"` : ''} class="${cls}" stroke-width="2" transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(turn)})" d="${spikeD(s)}"/>`;
const wave = (x0, x1, y, amp, step) => {
  let d = `M ${x0} ${y}`;
  for (let x = x0, up = true; x < x1; x += step, up = !up)
    d += ` Q ${x + step / 2} ${y + (up ? -amp : amp)} ${x + step} ${y}`;
  return d;
};

const scenes = [];

// An immune cell, with its sensors, and an antibody: a Y.
const yShape = (s = 1) =>
  `<path d="M 0 ${24 * s} L 0 0 M 0 0 L ${-16 * s} ${-20 * s} M 0 0 L ${16 * s} ${-20 * s}" fill="none" class="stroke-good" stroke-width="${6 * s}" stroke-linecap="round"/>`;
const bcell = (id, x, y, extra = '') =>
  `<g id="${id}"${extra}><circle cx="${x}" cy="${y}" r="78" class="tone-good" stroke-width="4"/><circle cx="${x + 10}" cy="${y + 6}" r="34" fill="none" class="stroke-good" stroke-width="3"/>${[0, 90, 180, 270, 45, 135, 225, 315].map((d) => `<g transform="translate(${f1(x + 86 * Math.sin(rad(d)))} ${f1(y - 86 * Math.cos(rad(d)))}) rotate(${d})">${yShape(0.8)}</g>`).join('')}</g>`;

// ---------- the virus picture: the virus, and the one part the body has to learn ----------
const vx = 820,
  vy = 450,
  vr = 190;
const virusSpikes = Array.from({ length: 14 }, (_, i) => onEllipse(vx, vy, vr, vr, (i * 360) / 14));
// Antibodies: each starts by the memory cell on the left and ends on a spike's tip, arms towards the virus.
const mem = { x: 330, y: 450 };
const abs = virusSpikes.map((p, i) => {
  const t = rad(p.turn);
  const end = { x: p.x + 104 * Math.sin(t), y: p.y - 104 * Math.cos(t) };
  const start = { x: mem.x + 120 + (i % 3) * 36, y: mem.y - 200 + i * 30 };
  return { i, end, start, turn: p.turn + 180 };
});
const virusSvg =
  `<svg viewBox="160 110 1260 680">` +
  `<g id="virus"><circle cx="${vx}" cy="${vy}" r="${vr}" stroke="var(--text)" fill="none" stroke-width="6"/>` +
  `<path d="${wave(vx - 120, vx + 120, vy - 40, 22, 30)}" fill="none" stroke="var(--text)" stroke-width="4"/>` +
  `<path d="${wave(vx - 100, vx + 100, vy + 40, 22, 25)}" fill="none" stroke="var(--text)" stroke-width="4"/>` +
  virusSpikes
    .slice(1)
    .map((p) => spikeAt('', p, 1, 'tone-bad'))
    .join('') +
  `</g>` +
  spikeAt('spike', virusSpikes[0], 1, 'tone-bad') +
  `<text id="genes" x="${vx}" y="${vy + 110}" text-anchor="middle" font-size="30" fill="var(--muted)">its genes</text>` +
  `<g id="spike-detail"><text x="${vx + 70}" y="${vy - vr - 60}" font-size="30">spike protein</text><text x="${vx + 70}" y="${vy - vr - 24}" font-size="26" fill="var(--muted)">the key it uses to get into cells</text></g>` +
  bcell('memory', mem.x, mem.y) +
  `<text id="memory-label" x="${mem.x}" y="${mem.y + 130}" text-anchor="middle" font-size="28" class="tone-good">memory cell</text>` +
  abs
    .map(
      ({ i, start, turn }) =>
        `<g id="ab${i}"><g transform="translate(${f1(start.x)} ${f1(start.y)}) rotate(${f1(turn)})">${yShape(1.3)}</g></g>`,
    )
    .join('') +
  `</svg>`;
const abIds = abs.map(({ i }) => `ab${i}`);
const abMoves = Object.fromEntries(
  abs.map(({ i, start, end }) => [`ab${i}`, `translate(${f1(end.x - start.x)} ${f1(end.y - start.y)})`]),
);
const later = ['memory', 'memory-label', ...abIds];

scenes.push({
  type: 'svg',
  chapter: 'The question',
  title: 'How can a message teach your body?',
  picture: 'virus',
  hidden: ['virus', 'spike', 'genes', 'spike-detail', ...later],
  labels: { virus: 'germ', spike: 'germ' },
  narration: 'Your immune system is very good at fighting germs it has met before.',
  steps: [
    {
      trace: ['virus', 'spike'],
      focus: ['virus', 'spike'],
      say: 'The trouble is the first meeting.',
      draw: [{ write: 'never met before', near: 'virus', side: 'right', tone: 'bad', when: 'first meeting' }],
    },
    {
      focus: ['virus'],
      say: 'So how can a message teach your body to fight a virus it has never met?',
    },
  ],
});

scenes.push({
  type: 'svg',
  chapter: 'The virus',
  title: 'What the body has to learn',
  picture: 'virus',
  narration: 'This is the virus that causes COVID. A shell of fat, with its genes inside, and covered in spikes.',
  labels: { spike: 'spike', genes: 'genes', virus: 'whole virus' },
  hidden: ['genes', 'spike-detail', ...later],
  steps: [
    { show: ['genes'], focus: 'genes', say: 'The genes are its instructions for making more viruses.' },
    {
      show: ['spike-detail'],
      focus: ['spike', 'spike-detail'],
      say: 'Each spike is a protein. It is the key the virus uses to get into your cells.',
    },
    {
      hide: ['spike-detail'],
      focus: 'spike',
      say: `It is a chain of ${N(spikeLength)} building blocks, folded into this shape.`,
      draw: [{ write: `${N(spikeLength)} building blocks`, near: 'spike', side: 'right', tone: 'bad', when: 'chain' }],
    },
    {
      focus: ['spike', 'virus'],
      say: 'If your body knew this one shape, it could spot the virus at once.',
    },
  ],
});

// ---------- one cell, from the outside in. The cell's outline is an ellipse; the bubble starts outside it ----------
const C = { x: 920, y: 470, rx: 620, ry: 370 };
const nuc = { x: 1260, y: 470, r: 150 };
const lnp0 = { x: 150, y: 470 },
  lnpIn = { x: 470, y: 470 };
assert(lnp0.x < C.x - C.rx - 50 && lnpIn.x > C.x - C.rx + 60, 'the bubble starts outside the cell and ends inside');
const strand = { x0: 480, x1: 960, y: 500 };
const ribo0 = { x: 500, y: 488 },
  riboTravel = 420;
assert(
  ribo0.x + riboTravel < strand.x1 && strand.x1 < nuc.x - nuc.r,
  'the ribosome reads the strand, which stays out of the nucleus',
);
// The protein chain: a zigzag that grows above the strand as the ribosome moves along it.
const chainPts = [];
for (let x = ribo0.x; x <= ribo0.x + riboTravel; x += 20)
  chainPts.push(`${x} ${ribo0.y - 34 - (((x - ribo0.x) / 20) % 2 ? 14 : 0)}`);
const chainD = `M ${chainPts[0]} L ${chainPts.slice(1).join(' L ')}`;
// The spike the chain becomes, standing on top of the cell. Written in absolute coordinates so the chain can morph into it.
const top = onEllipse(C.x, C.y, C.rx, C.ry, -8);
const absSpike = (p, s) => {
  const t = rad(p.turn),
    pt = (lx, ly) =>
      `${f1(p.x + lx * Math.cos(t) - ly * Math.sin(t))} ${f1(p.y + lx * Math.sin(t) + ly * Math.cos(t))}`;
  return `M ${pt(-5 * s, 0)} L ${pt(-5 * s, -30 * s)} C ${pt(-26 * s, -36 * s)} ${pt(-26 * s, -70 * s)} ${pt(0, -74 * s)} C ${pt(26 * s, -70 * s)} ${pt(26 * s, -36 * s)} ${pt(5 * s, -30 * s)} L ${pt(5 * s, 0)} Z`;
};
const surface = [-60, 30, 70, 150, 205, 240].map((d) => onEllipse(C.x, C.y, C.rx, C.ry, d));
const lipids = Array.from({ length: 16 }, (_, i) => {
  const t = (i * Math.PI) / 8;
  return `<circle cx="${f1(lnp0.x + 52 * Math.cos(t))}" cy="${f1(lnp0.y + 52 * Math.sin(t))}" r="9"/>`;
}).join('');
const bits = Array.from({ length: 9 }, (_, i) => {
  const x = strand.x0 + 20 + i * 52,
    y = strand.y + (i % 2 ? 30 : -6);
  return `<path d="M ${x} ${y} q 8 -10 16 0 t 16 0" fill="none" stroke="var(--muted)" stroke-width="6"/>`;
}).join('');
const cellSvg =
  `<svg viewBox="40 -10 1550 880">` +
  `<ellipse id="cell" cx="${C.x}" cy="${C.y}" rx="${C.rx}" ry="${C.ry}" fill="none" stroke="var(--muted)" stroke-width="8"/>` +
  `<g id="nucleus"><circle cx="${nuc.x}" cy="${nuc.y}" r="${nuc.r}" fill="none" stroke="var(--text)" stroke-width="5"/><path d="${wave(nuc.x - 90, nuc.x + 90, nuc.y - 20, 18, 20)}" fill="none" stroke="var(--text)" stroke-width="3"/><path d="${wave(nuc.x - 70, nuc.x + 70, nuc.y + 30, 18, 20)}" fill="none" stroke="var(--text)" stroke-width="3"/></g>` +
  `<text id="nucleus-label" x="${nuc.x}" y="${nuc.y + nuc.r + 44}" text-anchor="middle" font-size="36">nucleus, with your DNA</text>` +
  `<path id="mrna" d="${wave(strand.x0, strand.x1, strand.y, 10, 20)}" fill="none" stroke="var(--text)" stroke-width="5"/>` +
  `<g id="bits">${bits}</g>` +
  `<path id="chain" d="${chainD}" fill="none" class="stroke-bad" stroke-width="5" stroke-linejoin="round"/>` +
  `<path id="spike-made" d="${absSpike(top, 1.3)}"/>` +
  `<g id="ribosome"><ellipse cx="${ribo0.x}" cy="${ribo0.y - 6}" rx="30" ry="20" fill="none" stroke="var(--text)" stroke-width="3"/><ellipse cx="${ribo0.x}" cy="${ribo0.y + 22}" rx="22" ry="12" fill="none" stroke="var(--text)" stroke-width="3"/></g>` +
  `<g id="read-detail"><text x="${ribo0.x - 30}" y="${strand.y + 64}" font-size="20" font-family="mono">A U G · U U U · G U U</text><text x="${ribo0.x - 30}" y="${strand.y + 88}" font-size="18" fill="var(--muted)">3 letters, 1 building block</text></g>` +
  `<g id="surface">${surface.map((p) => spikeAt('', p, 1.3, 'tone-bad')).join('')}</g>` +
  `<g id="lnp"><g fill="var(--muted)" stroke="none">${lipids}</g><path d="${wave(lnp0.x - 30, lnp0.x + 30, lnp0.y, 10, 15)}" fill="none" stroke="var(--text)" stroke-width="5"/></g>` +
  `<text id="lnp-label" x="${lnp0.x}" y="${lnp0.y + 100}" text-anchor="middle" font-size="32" fill="var(--muted)">bubble of fat</text>` +
  `</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Inside a cell',
  title: 'The message, read and thrown away',
  narration:
    'The vaccine does not contain the virus. It holds only a message: the instructions for the spike, written in mRNA.',
  svg: cellSvg,
  labels: {
    cell: 'whole cell',
    lnp: 'bubble',
    mrna: 'message',
    ribosome: 'ribosome',
    chain: 'chain',
    'spike-made': 'spike',
    surface: 'surface',
    nucleus: 'nucleus',
    bits: 'pieces',
  },
  hidden: ['mrna', 'bits', 'chain', 'spike-made', 'read-detail', 'surface'],
  steps: [
    { focus: ['lnp', 'lnp-label'], say: 'The message is fragile, so it travels wrapped in a tiny bubble of fat.' },
    {
      move: { lnp: `translate(${lnpIn.x - lnp0.x} 0)` },
      hide: ['lnp-label'],
      focus: ['lnp', 'cell'],
      say: 'The bubble merges with the outer skin of a cell near the shot, and slips inside.',
    },
    { hide: ['lnp'], show: ['mrna'], focus: 'mrna', say: 'There it lets go of the message.' },
    {
      camera: { on: 'ribosome', zoom: 4 },
      show: ['read-detail'],
      focus: 'ribosome',
      say: 'A ribosome, the cell’s protein maker, grabs it and reads it three letters at a time.',
    },
    {
      camera: { on: ['ribosome', 'chain'] },
      move: { ribosome: `translate(${riboTravel} 0)` },
      trace: ['chain'],
      hide: ['read-detail'],
      focus: ['ribosome', 'chain'],
      say: 'For every three letters it adds one building block to a chain, until the whole spike is built.',
      draw: [
        { write: `${N(spikeLength)} × 3 = ${N(letters)} letters`, near: 'chain', side: 'above', when: 'whole spike' },
      ],
    },
    {
      camera: 'all',
      morph: { chain: 'spike-made' },
      show: ['surface'],
      focus: ['chain', 'surface'],
      erase: true,
      say: 'The cell folds the spikes and carries them out to its surface, where they stick out like flags.',
    },
    {
      hide: ['mrna', 'ribosome'],
      show: ['bits'],
      focus: 'bits',
      say: 'Then the cell breaks the message into pieces and gets rid of it. Its job is done.',
    },
    {
      hide: ['bits'],
      focus: 'nucleus',
      draw: [{ write: 'the message never\ngets in here', near: 'nucleus', side: 'left', when: 'never' }],
      say: 'And notice where the message never went: into the nucleus, where your DNA is kept.',
    },
  ],
});

// ---------- the nucleus up close, and the CDC's words ----------
const dnaSvg =
  `<svg viewBox="0 0 1200 640">` +
  `<g id="nucleus"><circle cx="230" cy="320" r="190" fill="none" stroke="var(--text)" stroke-width="5"/><path d="${wave(110, 350, 290, 24, 30)}" fill="none" stroke="var(--text)" stroke-width="4"/><path d="${wave(130, 330, 360, 24, 25)}" fill="none" stroke="var(--text)" stroke-width="4"/><text x="230" y="560" text-anchor="middle" font-size="28">nucleus, with your DNA</text></g>` +
  `<path id="mrna" d="${wave(500, 640, 320, 10, 20)}" fill="none" stroke="var(--text)" stroke-width="5"/>` +
  `<text x="570" y="380" text-anchor="middle" font-size="24" fill="var(--muted)">the message</text>` +
  `<line id="tries" x1="485" y1="320" x2="432" y2="320" stroke="var(--text)" stroke-width="4" stroke-dasharray="8 6"/>` +
  `<g id="quote">${[
    '“They do not enter the nucleus',
    'of the cell where our DNA is',
    'located, so they cannot change',
    'or influence our genes.”',
  ]
    .map((l, i) => `<text x="680" y="${210 + i * 48}" font-size="32">${l}</text>`)
    .join('')}<text x="680" y="430" font-size="24" fill="var(--muted)">CDC, COVID-19 Vaccine Basics, 2024</text></g>` +
  `</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Your DNA',
  title: 'It never reaches your DNA',
  svg: dnaSvg,
  labels: { quote: 'words', nucleus: 'nucleus', mrna: 'they', tries: 'enter' },
  hidden: ['quote', 'tries'],
  narration: 'That is the answer to the most common worry about these vaccines.',
  steps: [
    {
      show: ['quote'],
      focus: 'quote',
      say: 'In the words of the US Centers for Disease Control:',
    },
    {
      show: ['tries'],
      focus: ['mrna', 'tries', 'nucleus'],
      say: 'They do not enter the nucleus, where our DNA is kept, so they cannot change our genes.',
      draw: [{ cross: 'tries', tone: 'good', when: 'do not enter' }],
    },
  ],
});

// ---------- an immune cell learns the spike. The spiky cell's edge is an arc on the right ----------
const edge = { x: 1900, y: 450, r: 560 };
const flags = [-118, -104, -90, -76, -62].map((d) => onEllipse(edge.x, edge.y, edge.r, edge.r, d));
const tips = flags.map(({ x, y, turn }) => ({
  x: x + 92 * Math.sin(rad(turn)),
  y: y - 92 * Math.cos(rad(turn)),
  turn,
}));
const B0 = { x: 260, y: 450 },
  meet = 560; // the B cell slides right to meet the spikes
assert(B0.x + meet + 100 < tips[2].x, 'the B cell stops short of the spikes');
const clonesTo = [
  [300, 180],
  [300, 720],
  [560, 300],
  [560, 610],
  [180, 450],
];
const home = [B0.x + meet, B0.y];
const abStart = clonesTo.slice(0, 4).map(([x, y]) => [x + 100, y]);
const antibodies = tips
  .slice(0, 4)
  .map(
    (_, i) => `<g id="ab${i}" transform="translate(${abStart[i][0]} ${abStart[i][1]}) rotate(90)">${yShape(1.4)}</g>`,
  )
  .join('');
const immuneSvg =
  `<svg viewBox="0 0 1600 900">` +
  `<circle cx="${edge.x}" cy="${edge.y}" r="${edge.r}" fill="none" stroke="var(--muted)" stroke-width="8"/>` +
  `<g id="flags">${flags.map((p) => spikeAt('', p, 1.3, 'tone-bad')).join('')}</g>` +
  `<text x="1480" y="440" text-anchor="middle" font-size="30" fill="var(--muted)">the cell</text><text x="1480" y="478" text-anchor="middle" font-size="30" fill="var(--muted)">from before</text>` +
  clonesTo.map((_, i) => bcell(`clone${i}`, ...home)).join('') +
  bcell('bcell', B0.x, B0.y) +
  `<text id="b-label" x="${B0.x}" y="${B0.y + 130}" text-anchor="middle" font-size="30" class="tone-good">an immune cell</text>` +
  antibodies +
  `<text id="memory" x="440" y="860" font-size="30" class="tone-good">memory cells stay behind</text>` +
  `</svg>`;
const abMoves4 = Object.fromEntries(
  tips.slice(0, 4).map((t, i) => {
    const dx = t.x - abStart[i][0] - 30 * Math.sin(rad(t.turn)),
      dy = t.y - abStart[i][1] + 30 * Math.cos(rad(t.turn));
    return [`ab${i}`, `translate(${f1(dx)} ${f1(dy)})`];
  }),
);
scenes.push({
  type: 'svg',
  chapter: 'Learning the shape',
  title: 'An immune cell meets the spike',
  narration: 'Now the spikes on that cell are something your body has never seen before.',
  svg: immuneSvg,
  labels: { bcell: 'immune cell', flags: 'spikes', clone0: 'copies', ab0: 'antibodies', memory: 'memory cells' },
  hidden: ['clone0', 'clone1', 'clone2', 'clone3', 'clone4', 'ab0', 'ab1', 'ab2', 'ab3', 'memory'],
  steps: [
    {
      move: { bcell: `translate(${meet} 0)` },
      hide: ['b-label'],
      focus: ['bcell', 'flags'],
      say: 'An immune cell drifting past bumps into the spikes, and its sensors happen to fit their shape.',
    },
    {
      show: ['clone0', 'clone1', 'clone2', 'clone3', 'clone4'],
      move: Object.fromEntries(clonesTo.map(([x, y], i) => [`clone${i}`, `translate(${x - home[0]} ${y - home[1]})`])),
      focus: ['clone0', 'clone1', 'clone2', 'clone3', 'clone4'],
      say: 'That match tells it to make copies of itself, again and again.',
    },
    {
      show: ['ab0', 'ab1', 'ab2', 'ab3'],
      move: abMoves4,
      focus: ['ab0', 'ab1', 'ab2', 'ab3', 'flags'],
      say: 'Those new cells pour out antibodies: small Y shaped proteins that grab onto the spike and nothing else.',
    },
    {
      show: ['memory'],
      focus: ['memory', 'clone0', 'clone1'],
      say: 'And some of the copies become memory cells. They stay in your body, and remember the shape.',
      draw: [
        { circle: 'clone0', tone: 'good', when: 'memory cells' },
        { circle: 'clone1', tone: 'good' },
      ],
    },
  ],
});

// ---------- the real virus, back on the first picture ----------
scenes.push({
  type: 'svg',
  chapter: 'The real thing',
  title: 'The virus meets a body that knows it',
  picture: 'virus',
  hidden: ['spike-detail', 'genes', ...later],
  labels: { virus: 'virus', memory: 'memory cells', ab0: 'antibodies', spike: 'spikes' },
  narration: 'Later, the real virus gets in. This time your body has met its spike before.',
  steps: [
    {
      focus: ['virus', 'spike'],
      say: 'The virus lands in your nose and starts looking for cells to enter.',
    },
    {
      show: ['memory', 'memory-label'],
      focus: ['memory', 'spike'],
      say: 'Memory cells recognise its spikes straight away.',
    },
    {
      show: abIds,
      focus: abIds,
      say: 'They multiply and pour out antibodies much faster than the first time.',
    },
    {
      move: abMoves,
      focus: [...abIds, 'virus'],
      say: 'The antibodies stick to the spikes, so the key no longer fits a cell’s lock.',
    },
    {
      focus: ['virus'],
      say: 'The virus is stopped before it can spread far.',
      draw: [{ cross: 'virus', tone: 'good', when: 'stopped' }],
    },
    {
      focus: ['memory'],
      say: 'The message that taught your body is long gone. Only the memory stays.',
    },
  ],
});

fs.writeFileSync(
  new URL('./storyboard.json', import.meta.url),
  JSON.stringify(
    {
      title: 'How an mRNA vaccine works',
      subtitle: 'A message that teaches your cells one shape, then disappears',
      tones: { good: 'your immune defence', bad: 'the spike, the shape to learn' },
      pictures: { virus: virusSvg },
      scenes,
    },
    null,
    2,
  ) + '\n',
);
