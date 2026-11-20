// Writes storyboard.json beside this file, drawing every scene on the board from a run of merge sort: each level of
// the split, each merge and each bar comes from the run below. Run: node examples/algorithms/merge-sort/generate.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';

const input = [51, 13, 89, 4, 62, 28, 77, 35];

function merge(x, y) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) out.push(x[i] <= y[j] ? x[i++] : y[j++]);
  return [...out, ...x.slice(i), ...y.slice(j)];
}

/** Each comparison a merge makes, in order: the two fronts and which side wins. */
function zipper(x, y) {
  const steps = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const left = x[i] <= y[j];
    steps.push({ i, j, a: x[i], b: y[j], left });
    if (left) i++;
    else j++;
  }
  return { steps, rest: i < x.length ? { side: 'left', from: i } : { side: 'right', from: j } };
}

function levels(a) {
  const down = [[a]];
  while (down.at(-1).some((p) => p.length > 1))
    down.push(down.at(-1).flatMap((p) => (p.length > 1 ? [p.slice(0, p.length >> 1), p.slice(p.length >> 1)] : [p])));
  const up = [down.at(-1)];
  while (up.at(-1).length > 1) {
    const level = up.at(-1);
    const next = [];
    for (let k = 0; k < level.length; k += 2) next.push(merge(level[k], level[k + 1]));
    up.push(next);
  }
  return { down, up };
}

const { down, up } = levels(input);
assert.equal(down.length, 4, 'eight items split in three levels');
assert.equal(up.length, 4, 'and merge back in three');

// One picture for the whole sort: the list split down to single items, then merged back up, row by row.
const rows = [
  ['the list', down[0]],
  ['halves', down[1]],
  ['quarters', down[2]],
  ['single items', down[3]],
  ['pairs', up[1]],
  ['fours', up[2]],
  ['sorted', up[3]],
];
const PREFIX = ['a', 'b', 'c', 'd', 'P', 'F', 'S'];
const CW = 72;
const PITCH = 78;
const GAP = 30;
const rowY = (r) => 20 + r * 88;
/** The x of each cell of a row cut into pieces, centred on the drawing's right part. */
const cellXs = (pieces) => {
  const width = 8 * PITCH - (PITCH - CW) + (pieces.length - 1) * GAP;
  let x = 690 - width / 2;
  const xs = [];
  pieces.forEach((p) => {
    p.forEach(() => {
      xs.push(x);
      x += PITCH;
    });
    x += GAP;
  });
  return xs;
};
const cell = (id, x, y, v) =>
  `<g id="${id}"><rect x="${x}" y="${y}" width="${CW}" height="60" rx="8" stroke-width="3"/><text x="${x + CW / 2}" y="${y + 41}" text-anchor="middle" font-size="28">${v}</text></g>`;
const cellId = (r, k) => `${PREFIX[r]}${k}`;
const tree = `<svg viewBox="0 0 1200 640">
${rows
  .map(([label, pieces], r) => {
    const xs = cellXs(pieces);
    const flat = pieces.flat();
    return `<g id="row${r}"><text x="20" y="${rowY(r) + 40}" font-size="24" fill="var(--muted)">${label}</text>${flat.map((v, k) => cell(cellId(r, k), xs[k], rowY(r), v)).join('')}</g>`;
  })
  .join('\n')}
${cell('one', 960, rowY(2), 42)}
</svg>`;
const cells = (r, ks) => ks.map((k) => cellId(r, k));
const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);

// The zipper on the first four: the pairs row's first two pieces merge into the fours row's first piece.
const [pairL, pairR] = up[1];
const zip = zipper(pairL, pairR);
assert.deepEqual(
  zip.steps.map((s) => [s.a, s.b, s.left]),
  [
    [13, 4, false],
    [13, 89, true],
    [51, 89, true],
  ],
  'the zipper makes three comparisons, as the narration says',
);
const pairCell = (side, i) => cellId(4, side === 'left' ? i : pairL.length + i);

// The chart: n² against n log₂ n, as bars drawn to the same scale.
const ns = [8, 16, 32, 64, 128];
const sq = ns.map((n) => n * n);
const nlog = ns.map((n) => n * Math.log2(n));
assert.deepEqual(nlog, [24, 64, 160, 384, 896], 'n log n');
const saved = Math.round((1 - nlog.at(-1) / sq.at(-1)) * 100);
assert.equal(saved, 95, 'about ninety five percent less work at 128');
const BASE = 540;
const TOP = 440;
const h = (v) => (v / sq.at(-1)) * TOP;
const bar = (id, x, v, tone) =>
  `<g id="${id}"><rect x="${x}" y="${(BASE - Math.max(h(v), 3)).toFixed(1)}" width="80" height="${Math.max(h(v), 3).toFixed(1)}" class="tone-${tone}" stroke-width="3"/><text x="${x + 40}" y="${(BASE - Math.max(h(v), 3) - 12).toFixed(1)}" text-anchor="middle" font-size="24">${v.toLocaleString('en-US')}</text></g>`;
const chart = `<svg viewBox="0 0 1200 640">
<line x1="40" y1="${BASE}" x2="1180" y2="${BASE}" stroke="var(--muted)" stroke-width="3"/>
${ns.map((n, k) => `<text x="${150 + k * 220}" y="${BASE + 44}" text-anchor="middle" font-size="26" fill="var(--muted)">n = ${n}</text>`).join('')}
<g id="sq">${ns.map((_, k) => bar(`sq${k}`, 60 + k * 220, sq[k], 'bad')).join('')}</g>
<g id="nlog">${ns.map((_, k) => bar(`nl${k}`, 150 + k * 220, nlog[k], 'good')).join('')}</g>
<g id="key"><text x="40" y="60" font-size="28" class="fill-bad">n²: every pair</text><text x="40" y="100" font-size="28" class="fill-good">n log n: merge sort</text></g>
</svg>`;

const allRows = range(1, 7).map((r) => `row${r}`);
const story = {
  title: 'Merge sort',
  subtitle: 'Split the list to single items, then zip them back in order',
  tones: { good: 'pieces already in order', bad: 'checking every pair: n² steps' },
  pictures: { tree },
  scenes: [
    {
      type: 'svg',
      chapter: 'The idea',
      title: 'The easiest list to sort',
      picture: 'tree',
      hidden: [...allRows, 'one'],
      labels: { row0: 'eight numbers', one: 'forty two' },
      narration: 'Sorting a whole list at once feels hard, because every number competes with every other number.',
      steps: [
        { focus: 'row0', say: 'Here are eight numbers in no order at all.' },
        {
          show: ['one'],
          focus: 'one',
          say: 'But what is the easiest list in the world to sort? A list with just one item.',
        },
        {
          tint: { one: 'good' },
          focus: 'one',
          say: 'Is forty two sorted? Yes. A single item is always in order.',
          draw: [{ write: 'sorted, trivially', near: 'one', side: 'below', tone: 'good', when: 'always in order' }],
        },
        {
          focus: ['row0', 'one'],
          say: 'Merge sort uses that. It breaks the list down until every piece is one item, then stitches the pieces back together in order.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Divide',
      title: 'Split in half, again and again',
      picture: 'tree',
      hidden: [...allRows, 'one'],
      labels: { row1: 'cut the list in two', row2: 'each half', row3: 'single item', row0: 'list' },
      narration: 'Step one is to divide.',
      steps: [
        { show: ['row1'], focus: 'row1', say: 'Find the middle, and cut the list in two.' },
        { show: ['row2'], focus: 'row2', say: 'Cut each half in two again.' },
        {
          show: ['row3'],
          focus: 'row3',
          tint: Object.fromEntries(cells(3, range(0, 8)).map((id) => [id, 'good'])),
          say: 'And again, until every piece is a single item. That is where the splitting stops.',
        },
        {
          focus: ['row0', 'row3'],
          say: 'Notice that no number has changed places yet. We have only pulled them apart.',
          draw: [{ write: 'nothing has moved yet', near: 'row3', side: 'right', when: 'no number' }],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'First merges',
      title: 'Merging single items into pairs',
      picture: 'tree',
      hidden: ['one', 'row5', 'row6', ...cells(4, range(0, 8))],
      labels: {
        d0: 'fifty one',
        d1: 'thirteen',
        d2: 'eighty nine',
        d3: 'four',
        P0: 'thirteen goes first',
        P1: 'fifty one',
      },
      narration: 'Step two is to merge. Start with the first two single items.',
      steps: [
        {
          focus: ['d0', 'd1'],
          say: 'Compare fifty one and thirteen. Thirteen is smaller.',
          draw: [{ circle: 'd1', note: '13 < 51', when: 'smaller' }],
        },
        {
          show: ['P0'],
          focus: 'P0',
          tint: { d1: 'dim' },
          say: 'So thirteen goes first.',
        },
        {
          show: ['P1'],
          focus: 'P1',
          tint: { d0: 'dim', P0: 'good', P1: 'good' },
          erase: true,
          say: 'Then fifty one. That pair is sorted.',
        },
        {
          focus: ['d2', 'd3'],
          say: 'Same for eighty nine and four. Four is smaller.',
          draw: [{ circle: 'd3', note: '4 < 89', when: 'smaller' }],
        },
        {
          show: ['P2', 'P3'],
          focus: ['P2', 'P3', 'd2', 'd3'],
          tint: { d2: 'dim', d3: 'dim', P2: 'good', P3: 'good' },
          erase: true,
          say: 'So four goes first, then eighty nine.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'The zipper',
      title: 'Merging two sorted pairs',
      picture: 'tree',
      hidden: ['one', 'row6', ...cells(4, range(4, 8)), ...cells(5, range(0, 8))],
      labels: {
        P0: 'thirteen',
        P1: 'fifty one',
        P2: 'four',
        P3: 'eighty nine',
        F0: 'four takes the first spot',
        F3: 'leftover eighty nine',
      },
      narration:
        'Now merge the two sorted pairs. Both are already in order, so we only ever look at the front of each one.',
      steps: (() => {
        const say = [
          [
            'Compare thirteen and four. Four is smaller.',
            'So four takes the first spot, and the right pair moves on to eighty nine.',
          ],
          [
            'Compare thirteen and eighty nine. Thirteen wins.',
            'Thirteen takes the next spot, and the left pair moves on to fifty one.',
          ],
          ['Fifty one against eighty nine. Fifty one wins.', 'Now the left pair is used up.'],
        ];
        const steps = [];
        zip.steps.forEach((s, k) => {
          const a = pairCell('left', s.i);
          const b = pairCell('right', s.j);
          const win = s.left ? a : b;
          steps.push({
            focus: [a, b],
            erase: true,
            say: say[k][0],
            draw: [
              {
                circle: win,
                note: `${Math.min(s.a, s.b)} < ${Math.max(s.a, s.b)}`,
                when: ['smaller', 'wins', 'wins'][k],
              },
            ],
          });
          const side = s.left ? 'left' : 'right';
          const at = (s.left ? s.i : s.j) + 1;
          const next = at < (s.left ? pairL : pairR).length ? [pairCell(side, at)] : [];
          steps.push({ show: [cellId(5, k)], focus: [cellId(5, k), ...next], tint: { [win]: 'dim' }, say: say[k][1] });
        });
        const left = zip.rest.side === 'left' ? pairL.slice(zip.rest.from) : pairR.slice(zip.rest.from);
        assert.deepEqual(left, [89], 'eighty nine is left over');
        const k = zip.steps.length;
        steps.push({
          show: [cellId(5, k)],
          focus: cellId(5, k),
          tint: {
            [pairCell(zip.rest.side, zip.rest.from)]: 'dim',
            ...Object.fromEntries(cells(5, range(0, 4)).map((id) => [id, 'good'])),
          },
          erase: true,
          say: 'So the leftover eighty nine just copies over. It is like two sorted decks of cards feeding one sorted pile.',
          draw: [
            {
              brace: cells(5, range(0, 4)),
              note: merge(pairL, pairR).join(', '),
              side: 'right',
              tone: 'good',
              when: 'one sorted pile',
            },
          ],
        });
        return steps;
      })(),
    },
    {
      type: 'svg',
      chapter: 'Why n log n',
      title: 'Every level moves all eight once',
      picture: 'tree',
      labels: {
        row4: 'merging into pairs',
        row5: 'pairs into fours',
        row6: 'last merge',
        row1: 'halving',
        row3: 'three levels',
      },
      narration: 'The same zipper runs at every level, until the whole list is back together.',
      steps: [
        {
          show: cells(4, range(4, 8)),
          focus: 'row4',
          tint: Object.fromEntries(cells(4, range(4, 8)).map((id) => [id, 'good'])),
          say: 'Merging into pairs moves all eight numbers once.',
          draw: [{ write: '8 moves', near: 'row4', side: 'right', when: 'all eight' }],
        },
        {
          show: cells(5, range(4, 8)),
          focus: 'row5',
          tint: Object.fromEntries(cells(5, range(4, 8)).map((id) => [id, 'good'])),
          say: 'Merging pairs into fours moves all eight again.',
          draw: [{ write: '8 moves', near: 'row5', side: 'right', when: 'all eight' }],
        },
        {
          show: ['row6'],
          focus: 'row6',
          tint: { row6: 'good' },
          say: 'And the last merge moves all eight one more time. The list is sorted.',
          draw: [{ write: '8 moves', near: 'row6', side: 'right', when: 'all eight' }],
        },
        {
          focus: ['row1', 'row2', 'row3'],
          erase: true,
          say: 'Halving eight items takes three levels, which is log two of eight.',
          draw: [
            {
              brace: ['row1', 'row3'],
              note: `${down.length - 1} levels = log₂ 8`,
              side: 'right',
              when: 'three levels',
            },
          ],
        },
        {
          focus: ['row4', 'row5', 'row6'],
          say: 'Each level does about n work. So the total is n times log n.',
          draw: [
            {
              brace: ['row4', 'row6'],
              note: `${up.length - 1} × 8 = ${(up.length - 1) * 8} moves`,
              side: 'right',
              tone: 'good',
              when: 'n times log n',
            },
          ],
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Compared',
      title: 'n log n stays low as n grows',
      svg: chart,
      hidden: ['sq', 'nlog'],
      labels: { sq: 'n squared', nlog: 'n log n', sq4: 'sixteen thousand', nl4: 'nine hundred' },
      narration: 'Compare that with a simple sort that checks every pair, which takes about n squared steps.',
      steps: [
        {
          show: ['sq'],
          focus: ['sq', 'sq4'],
          say: 'n squared shoots up. At a hundred twenty eight items it is over sixteen thousand.',
        },
        { show: ['nlog'], focus: ['nlog', 'nl4'], say: 'n log n climbs gently, to under nine hundred.' },
        {
          focus: ['sq4', 'nl4'],
          say: 'That is about ninety five percent less work. And merge sort gets this every time. Unlike quicksort, it has no bad pivot days.',
          draw: [{ circle: 'nl4', note: `${saved}% less work`, tone: 'good', when: 'ninety five percent' }],
        },
      ],
    },
  ],
};

// The rows drawn are the run's rows: every split level and every merge level, in order.
rows.forEach(([, pieces], r) =>
  assert.deepEqual(pieces.flat(), r < 4 ? down[r].flat() : up[r - 3].flat(), `row ${r} is the run's level`),
);
assert.deepEqual(
  up[3][0],
  [...input].sort((x, y) => x - y),
  'the last row is sorted',
);

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), `${JSON.stringify(story, null, 2)}\n`);
