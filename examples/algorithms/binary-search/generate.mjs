// Writes storyboard.json beside this file, drawing every scene on the board from a run of binary search: each
// pointer, each midpoint sum, each halving row and each worst-case count comes from the run below.
// Run: node examples/algorithms/binary-search/generate.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';

const values = [2, 5, 8, 12, 16, 23, 38, 45, 56, 67, 72, 79, 84, 91, 95, 99];
const target = 72;

function binarySearch(a, t) {
  let L = 0;
  let R = a.length - 1;
  const steps = [];
  while (L <= R) {
    const mid = L + Math.floor((R - L) / 2);
    steps.push({ L, R, mid });
    if (a[mid] === t) return steps;
    if (t > a[mid]) L = mid + 1;
    else R = mid - 1;
  }
  return steps;
}
const looks = binarySearch(values, target);
assert.deepEqual(
  looks.map((s) => s.mid),
  [7, 11, 9, 10],
  'the scenes below walk four looks at 7, 11, 9 and 10',
);
const at = values.indexOf(target);
assert.equal(at, 10, 'checking one by one reaches 72 on the eleventh box');
const formula = ({ L, R, mid }) => `mid = ${L} + ⌊(${R} − ${L}) / 2⌋ = ${mid}`;
const cmp = (k) => `${target} ${target > values[k] ? '>' : target < values[k] ? '<' : '='} ${values[k]}`;
const [l1, l2, l3, l4] = looks;

// The row of sixteen boxes, with a copy of each pointer at every index it stops at: a picture's moves do not carry
// into the next scene, so scenes that hand the row on show and hide copies, and only the last one on it moves.
const PITCH = 72;
const X0 = 30;
const cx = (k) => X0 + k * PITCH + 33;
const cells = values
  .map(
    (v, k) =>
      `<g id="c${k}"><rect x="${X0 + k * PITCH}" y="250" width="66" height="76" rx="8" stroke-width="3"/><text x="${cx(k)}" y="299" text-anchor="middle" font-size="28">${v}</text></g><text x="${cx(k)}" y="362" text-anchor="middle" font-size="22" fill="var(--muted)">${k}</text>`,
  )
  .join('');
/** A pointer above the row (arrow down) or below it (arrow up), drawn at index k; dx sets L left and R right. */
const above = (name, k) =>
  `<g id="${name}${k}"><text x="${cx(k)}" y="190" text-anchor="middle" font-size="26">${name}</text><path d="M${cx(k) - 11} 208 L${cx(k) + 11} 208 L${cx(k)} 240 Z" fill="var(--text)" stroke="none"/></g>`;
const below = (name, k, dx) =>
  `<g id="${name}${k}"><path d="M${cx(k) + dx - 10} 412 L${cx(k) + dx + 10} 412 L${cx(k) + dx} 382 Z" fill="var(--text)" stroke="none"/><text x="${cx(k) + dx}" y="444" text-anchor="middle" font-size="26">${name}</text></g>`;
const checks = [0, 1, 2, at];
const Ls = [...new Set(looks.map((s) => s.L))];
const Rs = [...new Set(looks.map((s) => s.R))];
const mids = looks.map((s) => s.mid);
const pointers = [
  ...checks.map((k) => above('check', k)),
  ...Ls.map((k) => below('L', k, -14)),
  ...Rs.map((k) => below('R', k, 14)),
  ...mids.map((k) => above('mid', k)),
];
const allPointers = [
  ...checks.map((k) => `check${k}`),
  ...Ls.map((k) => `L${k}`),
  ...Rs.map((k) => `R${k}`),
  ...mids.map((k) => `mid${k}`),
];
/** Every pointer hidden but the ones named. */
const only = (...ids) => allPointers.filter((id) => !ids.includes(id));
const row = `<svg viewBox="0 0 1200 640">
<text id="goal" x="30" y="80" font-size="30">looking for ${target}</text>
${cells}
${pointers.join('')}
</svg>`;
const shift = (from, to) => `translate(${(to - from) * PITCH} 0)`;

// What was still in play before each look, each box in its own column.
const HP = 66;
const HX = 150;
const halving = `<svg viewBox="0 0 1200 640">
${looks
  .map(({ L, R }, r) => {
    const y = 40 + r * 150;
    const boxes = values
      .slice(L, R + 1)
      .map(
        (v, j) =>
          `<rect x="${HX + (L + j) * HP}" y="${y}" width="60" height="70" rx="8" stroke-width="3"/><text x="${HX + (L + j) * HP + 30}" y="${y + 46}" text-anchor="middle" font-size="26">${v}</text>`,
      )
      .join('');
    return `<g id="look${r + 1}"><text x="20" y="${y + 32}" font-size="24">look ${r + 1}</text><text x="20" y="${y + 64}" font-size="22" fill="var(--muted)">${R - L + 1} left</text>${boxes}</g>`;
  })
  .join('\n')}
</svg>`;

// The most looks for each list size, one bar each, beside the one-by-one count that runs off the board.
const sizes = [
  ['16', 16],
  ['1 thousand', 1e3],
  ['1 million', 1e6],
  ['1 billion', 1e9],
  ['4 billion', 4e9],
];
const most = sizes.map(([, n]) => Math.floor(Math.log2(n)) + 1);
assert.deepEqual(most, [5, 10, 20, 30, 32], 'worst cases');
assert.ok(looks.length <= most[0], 'our search fits the worst case for 16');
const BASE = 520;
const UNIT = 12; // px per look: 32 looks is 384 px
const bars = sizes
  .map(([label], k) => {
    const x = 90 + k * 200;
    const h = most[k] * UNIT;
    return `<g id="n${k}"><rect x="${x}" y="${BASE - h}" width="110" height="${h}" class="tone-good" stroke-width="3"/><text x="${x + 55}" y="${BASE - h - 14}" text-anchor="middle" font-size="28">${most[k]}</text><text x="${x + 55}" y="${BASE + 40}" text-anchor="middle" font-size="24" fill="var(--muted)">${label}</text></g>`;
  })
  .join('');
const chart = `<svg viewBox="0 0 1200 640">
<line x1="60" y1="${BASE}" x2="1160" y2="${BASE}" stroke="var(--muted)" stroke-width="3"/>
<text x="60" y="${BASE + 90}" font-size="24" fill="var(--muted)">list size</text>
<text x="60" y="40" font-size="24" fill="var(--muted)">most looks</text>
${bars}
<g id="linear"><rect x="1030" y="20" width="110" height="${BASE - 20}" class="tone-bad" stroke-width="3"/><path d="M1030 20 L1060 4 L1085 24 L1110 4 L1140 20" fill="none" stroke="var(--bad)" stroke-width="3"/><text x="1085" y="${BASE + 40}" text-anchor="middle" font-size="24" fill="var(--muted)">one by one</text></g>
</svg>`;

const story = {
  title: 'Binary search',
  subtitle: 'Why a sorted list can be searched in a handful of looks',
  tones: { good: 'where 72 is, and what is still in play', bad: 'boxes checked or ruled out' },
  pictures: { row, halving },
  scenes: [
    {
      type: 'svg',
      chapter: 'Checking one by one',
      title: 'Looking for 72 the slow way',
      picture: 'row',
      hidden: only(),
      labels: { check0: 'check', c0: 'two', c1: 'five', c2: 'eight', c10: 'eleventh box', c15: 'very end' },
      narration: 'Say you want to find seventy two in this list.',
      steps: [
        {
          show: ['check0'],
          focus: 'check0',
          say: 'If you do not know the list is in order, all you can do is check every box, starting from the first.',
        },
        { focus: 'c0', tint: { c0: 'bad' }, say: 'Is it two? No.' },
        { hide: ['check0'], show: ['check1'], tint: { c1: 'bad' }, say: 'Is it five? No.' },
        { hide: ['check1'], show: ['check2'], tint: { c2: 'bad' }, say: 'Eight? No.' },
        {
          hide: ['check2'],
          show: [`check${at}`],
          tint: { ...Object.fromEntries([3, 4, 5, 6, 7, 8, 9].map((k) => [`c${k}`, 'bad'])), [`c${at}`]: 'good' },
          say: 'And so on, until the eleventh box finally holds seventy two.',
          draw: [{ write: `${at + 1} checks`, near: `c${at}`, side: 'below', tone: 'bad', when: 'eleventh' }],
        },
        {
          focus: 'c15',
          erase: true,
          say: 'If the number sits at the very end, or is not there at all, you check all sixteen.',
          draw: [{ circle: 'c15', note: 'worst case: n checks', tone: 'bad', when: 'all sixteen' }],
        },
        {
          hide: [`check${at}`],
          tint: Object.fromEntries(values.map((_, k) => [`c${k}`, 'clear'])),
          focus: ['c0', 'c15'],
          erase: true,
          say: 'We can do much better, if the list is sorted. That one rule is the whole trick.',
          draw: [{ brace: ['c0', 'c15'], note: 'sorted: small to big', side: 'below', tone: 'good', when: 'sorted' }],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'The middle',
      title: 'Two pointers and a midpoint',
      picture: 'row',
      hidden: only(`L${l1.L}`, `R${l1.R}`),
      labels: { [`L${l1.L}`]: 'L', [`R${l1.R}`]: 'R', [`mid${l1.mid}`]: 'halfway', c7: 'forty five' },
      narration: 'Instead of starting at the front, put one pointer at each end.',
      steps: [
        {
          focus: [`L${l1.L}`, `R${l1.R}`],
          say: 'L marks the start, at index zero. R marks the end, at index fifteen.',
        },
        {
          show: [`mid${l1.mid}`],
          focus: `mid${l1.mid}`,
          say: 'Halfway between them is index seven.',
          draw: [{ write: formula(l1), near: 'goal', side: 'right', when: 'halfway' }],
        },
        {
          focus: 'c7',
          say: 'It holds forty five. Now ask one question. Is seventy two equal to it, smaller, or bigger?',
          draw: [{ circle: 'c7', note: `${target} ? ${values[7]}`, when: 'one question' }],
        },
        {
          focus: [`L${l1.L}`, `R${l1.R}`],
          erase: true,
          say: 'Why not add L and R and halve that? On a huge list, the sum can overflow in Java or C.',
          draw: [{ write: '(L + R) / 2 can overflow', near: 'goal', side: 'right', tone: 'bad', when: 'overflow' }],
        },
        {
          focus: `mid${l1.mid}`,
          say: 'Taking half the gap from L never gets that big.',
          draw: [
            { write: 'L + (R − L) / 2 cannot', near: `R${l1.R}`, side: 'left', tone: 'good', when: 'half the gap' },
          ],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Throwing half away',
      title: 'One look rules out half',
      picture: 'row',
      hidden: only(`L${l1.L}`, `R${l1.R}`, `mid${l1.mid}`),
      labels: {
        c7: 'forty five',
        c11: 'seventy nine',
        [`mid${l2.mid}`]: 'new middle',
        [`L${l2.L}`]: 'L',
        [`R${l3.R}`]: 'R',
      },
      narration: 'Here is where the order pays off.',
      steps: [
        {
          focus: 'c7',
          say: 'The target is bigger than forty five.',
          draw: [{ circle: 'c7', note: cmp(l1.mid), when: 'bigger' }],
        },
        {
          tint: Object.fromEntries(values.slice(0, l2.L).map((_, k) => [`c${k}`, 'bad'])),
          focus: ['c0', 'c7'],
          say: 'Every box left of it is even smaller. So none of those first eight can be the one.',
          draw: [{ brace: ['c0', 'c7'], note: `all ≤ ${values[7]}, so not here`, side: 'below', when: 'even smaller' }],
        },
        {
          hide: [`L${l1.L}`],
          show: [`L${l2.L}`],
          focus: `L${l2.L}`,
          say: 'We cross them all out in one go, and L jumps to index eight.',
        },
        {
          hide: [`mid${l1.mid}`],
          show: [`mid${l2.mid}`],
          erase: true,
          say: 'Find the new middle. It is index eleven.',
          draw: [{ write: formula(l2), near: 'goal', side: 'right', when: 'new middle' }],
        },
        {
          focus: 'c11',
          say: 'It holds seventy nine. The target is smaller.',
          draw: [{ circle: 'c11', note: cmp(l2.mid), when: 'smaller' }],
        },
        {
          tint: Object.fromEntries(values.slice(l2.mid).map((_, j) => [`c${l2.mid + j}`, 'bad'])),
          hide: [`R${l1.R}`],
          show: [`R${l3.R}`],
          focus: [`R${l3.R}`, 'c11', 'c15'],
          say: 'So index eleven and everything right of it are out. R moves to index ten.',
          draw: [{ brace: ['c11', 'c15'], note: 'out', side: 'below', when: 'everything right' }],
        },
        {
          hide: [`mid${l2.mid}`],
          focus: ['c8', 'c10'],
          erase: true,
          say: 'Sixteen boxes went down to half, and now just three are left, after only two looks.',
          draw: [
            { brace: ['c8', 'c10'], note: '16 → 8 → 3 left', side: 'above', tone: 'good', when: 'three are left' },
          ],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Found it',
      title: 'Closing in on 72',
      picture: 'row',
      labels: { [`mid${l3.mid}`]: 'middle', c9: 'sixty seven', c10: 'seventy two', [`L${l3.L}`]: 'L', c8: 'fifty six' },
      narration: 'Three boxes are left: fifty six, sixty seven and seventy two.',
      steps: [
        {
          show: [`mid${l3.mid}`],
          focus: `mid${l3.mid}`,
          say: 'The middle is index nine.',
          draw: [{ write: formula(l3), near: 'goal', side: 'right', when: 'middle' }],
        },
        {
          focus: 'c9',
          say: 'It holds sixty seven, which is too small.',
          draw: [{ circle: 'c9', note: cmp(l3.mid), when: 'too small' }],
        },
        {
          tint: { c8: 'bad', c9: 'bad' },
          move: { [`L${l3.L}`]: shift(l3.L, l4.L) },
          erase: true,
          say: 'So L moves past it, to index ten.',
        },
        {
          move: { [`mid${l3.mid}`]: shift(l3.mid, l4.mid) },
          say: 'Now L and R meet, and the middle is index ten.',
          draw: [{ write: formula(l4), near: 'goal', side: 'right', when: 'meet' }],
        },
        {
          focus: 'c10',
          tint: { c10: 'good' },
          say: 'It holds seventy two. Found, on the fourth look.',
          draw: [{ circle: 'c10', note: `${cmp(l4.mid)}: ${looks.length} looks`, tone: 'good', when: 'found' }],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Halving',
      title: 'Each look leaves half or less',
      picture: 'halving',
      hidden: ['look2', 'look3', 'look4'],
      labels: { look1: 'sixteen boxes', look2: 'half of them', look3: 'three', look4: 'one box' },
      narration: 'Line up what was still in play before each look.',
      steps: [
        { focus: 'look1', say: 'Sixteen boxes before the first look.' },
        { show: ['look2'], focus: 'look2', say: 'Half of them before the second.' },
        {
          show: ['look3'],
          focus: 'look3',
          say: 'Three before the third. Each look also throws out the middle box.',
        },
        { show: ['look4'], focus: 'look4', tint: { look4: 'good' }, say: 'And one box for the last look.' },
        {
          focus: ['look1', 'look2', 'look3', 'look4'],
          say: 'Sixteen, eight, three, one. Every look halves what is left. Halve n about log two of n times, and one box is left.',
          draw: [
            {
              write: 'n halved k times = 1, so k = log₂ n',
              near: 'look4',
              side: 'right',
              tone: 'good',
              when: 'log two',
            },
          ],
        },
        {
          focus: 'look1',
          say: 'So doubling the list adds just one more look.',
          draw: [{ write: '32 boxes: one more look', near: 'look3', side: 'right', when: 'one more look' }],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'At scale',
      title: 'Four billion boxes, 32 looks',
      svg: chart,
      hidden: ['n1', 'n2', 'n3', 'n4', 'linear'],
      labels: { n0: 'sixteen boxes', n2: 'a million', n4: 'thirty two', linear: 'one by one' },
      narration: 'Here is the most looks it can ever take, as the list grows.',
      steps: [
        { focus: 'n0', say: 'Sixteen boxes take at most five looks. Our search got lucky and needed four.' },
        { show: ['n1', 'n2'], focus: 'n2', say: 'A thousand take at most ten, and a million at most twenty.' },
        { show: ['n3', 'n4'], focus: 'n4', say: 'And four billion take at most thirty two.' },
        {
          show: ['linear'],
          focus: 'linear',
          say: 'Checking one by one, the worst case is a check for every box. That bar would run millions of times off the board.',
          draw: [
            {
              write: 'one by one:\n4,000,000,000 checks',
              at: [0.2, 0.2],
              tone: 'bad',
              id: 'billions',
              when: 'every box',
            },
            { arrow: ['billions', 'linear'], tone: 'bad', when: 'off the board' },
          ],
        },
      ],
    },
  ],
};

// The scenes walk the run: each formula written is the run's, and each halving row is what the run had left.
const written = story.scenes
  .flatMap((s) => s.steps.flatMap((st) => st.draw ?? []))
  .map((d) => d.write)
  .filter((w) => w?.startsWith('mid ='));
assert.deepEqual(written, looks.map(formula), 'every midpoint written is a look of the run, in order');
assert.ok((4e9 * UNIT) / 640 > 1e6, 'the one-by-one bar runs millions of boards high');

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), `${JSON.stringify(story, null, 2)}\n`);
