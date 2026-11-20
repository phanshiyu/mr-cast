// Writes storyboard.json beside this file. Every drawing that shows the list is built from a run of Lomuto's
// quicksort below: where each card slides, which pointer moves, and what each comparison says. hunks.json is not
// generated: it is `mr-cast snippet QuickSort.java 1-27` on the class whose code it holds.
// Run: node examples/algorithms/quicksort/generate.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';

function lomuto(input) {
  const a = [...input];
  const partitions = [];
  const sort = (low, high, depth) => {
    if (low >= high) return;
    const before = a.slice(low, high + 1);
    const pivot = a[high];
    let i = low - 1;
    const steps = [];
    for (let j = low; j < high; j++) {
      const less = a[j] < pivot;
      const was = [...a];
      if (less) {
        i++;
        [a[i], a[j]] = [a[j], a[i]];
      }
      steps.push({ j, i, value: was[j], less, swapped: less ? [was[i], was[j]] : null, after: [...a] });
    }
    [a[i + 1], a[high]] = [a[high], a[i + 1]];
    const p = i + 1;
    partitions.push({ low, high, depth, pivot, p, before, steps, after: [...a] });
    sort(low, p - 1, depth + 1);
    sort(p + 1, high, depth + 1);
  };
  sort(0, a.length - 1, 0);
  return { sorted: a, partitions };
}

const input = [7, 2, 9, 4, 1, 8, 3, 5];
const qs = lomuto(input);
const first = qs.partitions[0];
assert.deepEqual(
  qs.sorted,
  [...input].sort((x, y) => x - y),
  'the run sorts the list',
);

// ---------- the row of cards: scenes 1, 2 and 6 ----------
const PITCH = 130;
const CARD = 110;
const X0 = 150;
const cx = (k) => X0 + k * PITCH + CARD / 2;
const card = (id, k, y, v, h = 100, size = 44) =>
  `<g id="${id}"><rect x="${X0 + k * PITCH}" y="${y}" width="${CARD}" height="${h}" rx="12" stroke-width="3"/><text x="${cx(k)}" y="${y + h / 2 + size * 0.36}" text-anchor="middle" font-size="${size}">${v}</text></g>`;
const ROW_Y = 90;
const pointer = (name, k) =>
  `<g id="ptr-${name}"><line x1="${cx(k)}" y1="${ROW_Y + 160}" x2="${cx(k)}" y2="${ROW_Y + 114}" stroke="var(--text)" stroke-width="4"/><polyline points="${cx(k) - 14},${ROW_Y + 130} ${cx(k)},${ROW_Y + 114} ${cx(k) + 14},${ROW_Y + 130}" fill="none" stroke="var(--text)" stroke-width="4"/><text x="${cx(k)}" y="${ROW_Y + 196}" text-anchor="middle" font-size="34" font-family="mono">${name}</text></g>`;
const split = first.after; // [2, 4, 1, 3, 5, 8, 7, 9]
const AFTER_Y = 400;
const sum = (id, y, what, time, when) =>
  `<g id="${id}"><text x="${X0}" y="${y}" font-size="30">${what}</text><text x="${X0 + 230}" y="${y}" font-size="30" font-family="mono">${time}</text><text x="${X0 + 480}" y="${y}" font-size="26" fill="var(--muted)">${when}</text></g>`;
const row = `<svg viewBox="0 0 1200 640">
${input.map((v, k) => card(`c${v}`, k, ROW_Y, v)).join('')}
<g id="after"><text x="${X0}" y="${AFTER_Y - 24}" font-size="26" fill="var(--muted)">after one split</text>${split.map((v, k) => card(`a${v}`, k, AFTER_Y, v)).join('')}</g>
${pointer('j', 0)}${pointer('i', -1)}
<text id="cmp" x="600" y="430" text-anchor="middle" font-size="40" font-family="mono">pivot = 5</text>
${sum('sum-best', 330, 'Best', 'O(n log n)', 'every pivot lands in the middle')}
${sum('sum-avg', 400, 'Average', 'O(n log n)', 'random order')}
${sum('sum-worst', 470, 'Worst', 'O(n²)', 'already sorted, pivot at the end')}
${sum('sum-space', 540, 'Space', 'O(log n)', 'the stack of calls; O(n) at worst')}
</svg>`;

// Moves for the cards of the row: value v from where the drawing puts it to index k.
const home = Object.fromEntries(input.map((v, k) => [v, k]));
const slide = (v, k) => (k === home[v] ? '' : `translate(${(k - home[v]) * PITCH} 0)`);
const ptrAt = (name, k) => {
  const start = name === 'i' ? -1 : 0;
  return k === start ? '' : `translate(${(k - start) * PITCH} 0)`;
};

// ---------- scene 2: one split, built from the run ----------
const P = first.pivot;
// What the voice says at each comparison and swap, in the order the run makes them.
const compareSays = [
  'j looks at seven. Seven is not smaller than five, so it stays put.',
  'j moves on to two. Two is smaller than the pivot, so it belongs in the small pile.',
  'Nine is bigger, so j just moves past it.',
  'Four is smaller. The next spot in the small pile holds seven.',
  'One is smaller too, and the next spot holds nine.',
  'Eight is bigger. Skip it.',
  'Three is smaller, and the next spot holds seven.',
];
const swapSays = [
  'So i steps forward, and the two swaps into the small pile.',
  'i steps forward, and four swaps places with the seven.',
  'So one swaps with the nine.',
  'Three swaps with the seven.',
];
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const partitionSteps = [];
let swapK = 0;
first.steps.forEach((s, n) => {
  const say = compareSays[n];
  assert.ok(say.toLowerCase().includes(words[s.value]), `compare ${n} names ${s.value}`);
  assert.equal(/not smaller|bigger/.test(say), !s.less, `compare ${n}: the words say the wrong side`);
  partitionSteps.push({
    ...(n ? { move: { 'ptr-j': ptrAt('j', s.j) } } : {}),
    set: { cmp: `${s.value} < ${P}?  ${s.less ? 'yes' : 'no'}` },
    tint: { cmp: s.less ? 'good' : 'bad', ...(s.less ? {} : { [`c${s.value}`]: 'bad' }) },
    focus: ['ptr-j', `c${s.value}`, 'cmp'],
    say,
  });
  if (s.less) {
    const [a, b] = s.swapped; // a sits at i, b at j; they trade places
    const sw = swapSays[swapK++];
    assert.ok(sw.toLowerCase().includes(words[b]), `swap names ${b}`);
    partitionSteps.push({
      move: { 'ptr-i': ptrAt('i', s.i), ...(a === b ? {} : { [`c${b}`]: slide(b, s.i), [`c${a}`]: slide(a, s.j) }) },
      set: { cmp: `i = ${s.i}, swap` },
      tint: { cmp: 'clear', [`c${b}`]: 'good' },
      focus: ['ptr-i', `c${b}`, `c${a}`],
      say: sw,
    });
  }
});
const spot = first.p;
const displaced = first.steps.at(-1).after[spot];
partitionSteps.push(
  {
    set: { cmp: `spot after the pile: i + 1 = ${spot}` },
    focus: [`c${displaced}`, `c${P}`],
    say: 'Every number before the pivot has been checked. The spot right after the small pile holds nine.',
  },
  {
    move: { [`c${P}`]: slide(P, spot), [`c${displaced}`]: slide(displaced, first.high) },
    set: { cmp: 'swap arr[i + 1] with the pivot' },
    focus: [`c${P}`, `c${displaced}`],
    say: 'So the pivot and the nine swap.',
  },
  {
    set: { cmp: `${P} lands at index ${spot}` },
    focus: [`c${P}`, 'cmp'],
    draw: [{ underline: `c${P}`, note: 'its final place', when: 'index four' }],
    say: 'Five lands at index four. Smaller on its left, bigger on its right.',
  },
);
assert.equal(words[displaced], 'nine', 'the card the pivot trades with');
assert.equal(spot, 4, 'pivot index');
assert.equal(partitionSteps.length, 14);

// ---------- scene 3: the calls under the first split, one row per depth ----------
const calls = qs.partitions.slice(1);
const RY = (d) => 50 + d * 145;
const callRow = (c) => {
  const label = `<text x="${X0 + c.low * PITCH}" y="${RY(c.depth) - 12}" font-size="22" font-family="mono" fill="var(--muted)">sort(${c.low}, ${c.high})</text>`;
  return `<g id="call-${c.low}-${c.high}">${label}${c.before.map((v, k) => card(`d${c.depth}-${v}`, c.low + k, RY(c.depth), v, 80, 36)).join('')}</g>`;
};
const callSlide = (c, v, k) => {
  const from = c.low + c.before.indexOf(v);
  return k === from ? '' : `translate(${(k - from) * PITCH} 0)`;
};
const done = qs.sorted;
const tree = `<svg viewBox="0 0 1200 640">
<g id="top"><text x="${X0}" y="${RY(0) - 12}" font-size="22" font-family="mono" fill="var(--muted)">sort(0, 7)</text>${split.map((v, k) => card(`t${v}`, k, RY(0), v, 80, 36)).join('')}</g>
${calls.map(callRow).join('')}
<g id="sorted"><text x="${X0 - 24}" y="${RY(3) + 50}" text-anchor="end" font-size="26" fill="var(--muted)">sorted</text>${done.map((v, k) => card(`s${v}`, k, RY(3), v, 80, 36)).join('')}</g>
</svg>`;
const callOf = (low, high) => calls.find((c) => c.low === low && c.high === high);
const recSteps = [];
const showCall = (c, say, extra = {}) =>
  recSteps.push({ show: [`call-${c.low}-${c.high}`], focus: `call-${c.low}-${c.high}`, say, ...extra });
const splitCall = (c, say, when) => {
  const s = c.steps;
  const final = c.after.slice(c.low, c.high + 1);
  const move = Object.fromEntries(
    final.map((v, k) => [`d${c.depth}-${v}`, callSlide(c, v, c.low + k)]).filter(([, t]) => t),
  );
  const tint = Object.fromEntries(
    c.before.filter((v) => v !== c.pivot).map((v) => [`d${c.depth}-${v}`, v < c.pivot ? 'good' : 'bad']),
  );
  assert.ok(s.length === c.high - c.low);
  recSteps.push({
    ...(Object.keys(move).length ? { move } : {}),
    tint,
    focus: `d${c.depth}-${c.pivot}`,
    draw: [{ underline: `d${c.depth}-${c.pivot}`, when }],
    say,
  });
};
const c03 = callOf(0, 3);
const c01 = callOf(0, 1);
const c57 = callOf(5, 7);
const c56 = callOf(5, 6);
assert.ok(c03.pivot === 3 && c03.p === 2 && c01.pivot === 1 && c01.p === 0, 'left calls');
assert.ok(c57.pivot === 9 && c57.p === 7 && c56.pivot === 7 && c56.p === 5, 'right calls');
assert.equal(calls.length, 4, 'four calls under the first split');
showCall(c03, 'The left side runs from index zero to three. Its pivot is three.');
splitCall(c03, 'After the split, three lands at index two.', 'index two');
showCall(c01, 'Next, the piece from zero to one. Its pivot is one.');
splitCall(c01, 'One is smaller than two, so it lands at index zero.', 'index zero');
recSteps.push({
  focus: [`d2-2`, `d1-4`],
  draw: [
    { circle: 'd2-2', when: 'the two' },
    { circle: 'd1-4', note: 'one item: stop', when: 'the four' },
  ],
  say: 'What is left are single items: the two, and the four. One item is already sorted, so the calls stop.',
});
showCall(c57, 'Now the three cells on the right. Their pivot is nine.');
splitCall(c57, 'Eight and seven are both smaller, so nine stays at the end.', 'stays at the end');
showCall(c56, 'Then the pair left of it, with pivot seven.');
splitCall(c56, 'Seven swaps in front of eight, and eight is left on its own.', 'on its own');
recSteps.push({ show: ['sorted'], focus: 'sorted', say: 'Every pivot landed in its place. The whole list is sorted.' });

// ---------- scene 5: how deep the splits go ----------
function depthDrawing() {
  const cell = 40;
  const gap = 6;
  const rowH = 56;
  const top = 70;
  const parts = [];
  const cells = (x, y, n) =>
    Array.from(
      { length: n },
      (_, k) => `<rect x="${x + k * (cell + gap)}" y="${y}" width="${cell}" height="${cell}" rx="6" stroke-width="2"/>`,
    ).join('');
  parts.push('<text x="300" y="40" text-anchor="middle" font-size="28">Pivot lands in the middle</text>');
  parts.push('<text x="900" y="40" text-anchor="middle" font-size="28">List already sorted</text>');
  const even = [[8], [4, 4], [2, 2, 2, 2], [1, 1, 1, 1, 1, 1, 1, 1]];
  even.forEach((pieces, r) => {
    const y = top + r * rowH;
    const width = pieces.reduce((w, n) => w + n * (cell + gap) - gap, 0) + (pieces.length - 1) * 18;
    let x = 300 - width / 2;
    const row = pieces.map((n) => {
      const s = cells(x, y, n);
      x += n * (cell + gap) - gap + 18;
      return s;
    });
    parts.push(`<g id="even-${r}">${row.join('')}</g>`);
  });
  parts.push(
    `<text id="even-depth" x="300" y="${top + 4 * rowH + 40}" text-anchor="middle" font-size="26" fill="var(--muted)">3 rounds: 8 → 4 → 2 → 1</text>`,
  );
  // Sorted input with the last item as pivot: each split peels off one item, and the pivot is the biggest.
  const sorted = Array.from({ length: 8 }, (_, r) => {
    const n = 8 - r;
    const y = top + r * rowH;
    const x = 680;
    const piv = x + (n - 1) * (cell + gap);
    return `${cells(x, y, n - 1)}<rect id="piv-${r}" x="${piv}" y="${y}" width="${cell}" height="${cell}" rx="6" fill="var(--text)" stroke="var(--text)"/>`;
  });
  parts.push(`<g id="sorted">${sorted.join('')}</g>`);
  parts.push(
    `<text id="sorted-depth" x="900" y="${top + 8 * rowH + 40}" text-anchor="middle" font-size="26" fill="var(--muted)">7 rounds of splits: n − 1</text>`,
  );
  return `<svg viewBox="0 0 1200 640">${parts.join('')}</svg>`;
}
// Check the drawing's counts against the run: even splits of 8 take log₂ 8 rounds, a sorted 8 takes 7.
assert.equal(Math.log2(8), 3);
assert.equal(lomuto([1, 2, 3, 4, 5, 6, 7, 8]).partitions.length, 7, 'a sorted list of 8 splits 7 times');
assert.equal(Math.max(...lomuto([1, 3, 2, 5, 7, 6, 8, 4]).partitions.map((p) => p.depth)) + 1, 3, 'middle pivots');

const story = {
  title: 'Quicksort',
  subtitle: 'Pick a pivot, split around it, repeat on each side',
  tones: { good: 'smaller than the pivot', bad: 'bigger than the pivot' },
  pictures: { row },
  scenes: [
    {
      type: 'svg',
      chapter: 'The idea',
      title: 'Split around one value',
      picture: 'row',
      hidden: ['after', 'ptr-i', 'ptr-j', 'cmp', 'sum-best', 'sum-avg', 'sum-worst', 'sum-space'],
      labels: { after: 'after one split', c5: 'five' },
      narration: 'Quicksort is a divide and conquer sort. Here is a list of eight numbers.',
      steps: [
        {
          focus: 'c5',
          draw: [{ write: 'pivot', near: 'c5', side: 'below', when: 'last item' }],
          say: 'It picks one value, the pivot. In this version, the pivot is always the last item. Here that is five.',
        },
        {
          show: ['after'],
          tint: Object.fromEntries(split.filter((v) => v !== P).map((v) => [`a${v}`, v < P ? 'good' : 'bad'])),
          focus: 'after',
          say: 'One split moves the smaller numbers to its left, and the bigger ones to its right.',
        },
        {
          focus: 'a5',
          draw: [{ underline: 'a5', note: 'done', when: 'never moves' }],
          say: 'The pivot is now exactly where it belongs in the sorted list. It never moves again.',
        },
        {
          focus: ['a2', 'a4', 'a1', 'a3', 'a8', 'a7', 'a9'],
          draw: [
            { brace: ['a2', 'a3'], note: 'repeat', side: 'below', when: 'still jumbled' },
            { brace: ['a8', 'a9'], note: 'repeat', side: 'below' },
          ],
          say: 'The two sides are still jumbled, so quicksort splits each of them the same way.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'One split, step by step',
      title: 'Partition around the pivot 5',
      picture: 'row',
      hidden: ['after', 'sum-best', 'sum-avg', 'sum-worst', 'sum-space'],
      labels: { 'ptr-i': 'pointer i', 'ptr-j': 'pointer j', cmp: 'comparison' },
      narration: 'Here is how one split works.',
      steps: [
        {
          focus: ['ptr-j', 'ptr-i'],
          draw: [{ write: 'pivot', near: 'c5', side: 'above', when: 'pivot' }],
          say: 'The pointer j walks from left to right, comparing each number with the pivot.',
        },
        {
          focus: 'ptr-i',
          draw: [{ write: 'end of the small pile', near: 'ptr-i', side: 'below', tone: 'good', when: 'small pile' }],
          say: 'The pointer i marks the end of the small pile. It starts just before the list.',
        },
        ...partitionSteps,
      ],
    },
    {
      type: 'svg',
      chapter: 'Recursion',
      title: 'The same split on each side',
      svg: tree,
      hidden: calls.map((c) => `call-${c.low}-${c.high}`).concat('sorted'),
      tint: Object.fromEntries(split.filter((v) => v !== P).map((v) => [`t${v}`, v < P ? 'good' : 'bad'])),
      labels: {
        top: 'first split',
        'call-0-3': 'left side',
        'call-0-1': 'zero to one',
        'call-5-7': 'three cells on the right',
        'call-5-6': 'the pair',
        sorted: 'sorted list',
        'd2-2': 'the two',
        'd1-4': 'the four',
      },
      narration: 'Now quicksort calls itself on the left side, then on the right. Each call gets a smaller piece.',
      steps: recSteps,
    },
    {
      type: 'code',
      chapter: 'The code',
      hunkId: 's1',
      narration: 'Here is the same thing in Java: two short methods.',
      steps: [
        {
          lines: 3,
          label: 'stop when low < high is false',
          say: 'quickSort first checks the base case. If low is not below high, the piece has one item or none.',
        },
        {
          lines: 4,
          label: 'split, get the pivot spot',
          say: 'Otherwise it splits the piece and gets back where the pivot landed.',
        },
        {
          lines: '5-6',
          label: 'sort each side',
          say: 'Then it sorts the part left of the pivot, and the part right of it.',
        },
        {
          lines: '11-12',
          label: 'pivot is the last item',
          say: 'partition takes the last item as the pivot, and starts i just before low.',
        },
        {
          lines: '13-18',
          label: 'grow the small pile',
          say: 'j walks from low up to the pivot. Each time it finds a smaller number, i steps forward and the two swap.',
        },
        {
          lines: '19-20',
          label: 'put the pivot in place',
          outcome: 'pivot index',
          say: 'Last, the pivot swaps in right after the small pile, and partition returns that spot.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'How fast',
      title: 'How deep the splits go',
      narration: 'How fast is it? Each round of splits touches every item about once.',
      svg: depthDrawing(),
      labels: {
        'even-0': 'eight items',
        'even-1': 'halves',
        sorted: 'already sorted list',
        'sorted-depth': 'n rounds',
        'even-depth': 'three rounds',
      },
      hidden: ['even-1', 'even-2', 'even-3', 'even-depth', 'sorted', 'sorted-depth'],
      steps: [
        { focus: 'even-0', say: 'So the speed depends on how many rounds there are.' },
        {
          show: ['even-1', 'even-2', 'even-3'],
          focus: 'even-1',
          say: 'When the pivot lands near the middle, each round halves the pieces.',
        },
        {
          show: ['even-depth'],
          focus: ['even-0', 'even-depth'],
          draw: [{ brace: ['even-1', 'even-3'], side: 'left', note: '3', when: 'three rounds' }],
          say: 'Eight items take three rounds, which is log two of eight.',
        },
        {
          focus: 'even-depth',
          draw: [{ write: 'n × log n', near: 'even-depth', side: 'below', when: 'n log n' }],
          say: 'Each round costs n, so that gives n log n, both on average and at best.',
        },
        {
          show: ['sorted'],
          focus: 'sorted',
          say: 'But give it a list that is already sorted.',
        },
        {
          focus: ['piv-0', 'piv-1', 'piv-2'],
          draw: [{ circle: 'piv-0', note: 'pivot: the biggest', when: 'always the biggest' }],
          say: 'The last item is always the biggest, so each split peels off just one item.',
        },
        {
          show: ['sorted-depth'],
          focus: 'sorted-depth',
          draw: [{ write: 'n + (n − 1) + … + 1 ≈ n² / 2', near: 'sorted-depth', side: 'below', when: 'n squared' }],
          say: 'That makes about n rounds, and the time grows with n squared. This is the worst case.',
        },
      ],
    },
    {
      type: 'svg',
      chapter: 'Summary',
      title: 'Quicksort at a glance',
      picture: 'row',
      hidden: ['after', 'ptr-i', 'ptr-j', 'cmp', 'sum-best', 'sum-avg', 'sum-worst', 'sum-space'],
      labels: { 'sum-best': 'best', 'sum-avg': 'average', 'sum-worst': 'worst case', 'sum-space': 'extra memory' },
      narration: 'Here is the summary.',
      steps: [
        {
          move: Object.fromEntries(done.map((v, k) => [`c${v}`, slide(v, k)]).filter(([, t]) => t)),
          focus: done.map((v) => `c${v}`),
          say: 'Quicksort sorted our list in place, with no second list.',
        },
        {
          show: ['sum-best', 'sum-avg'],
          focus: ['sum-best', 'sum-avg'],
          say: 'Best and average are both n log n.',
        },
        {
          show: ['sum-worst'],
          focus: 'sum-worst',
          draw: [{ underline: 'sum-worst', when: 'n squared' }],
          say: 'The worst case is n squared, when every pivot is the biggest or smallest item.',
        },
        {
          show: ['sum-space'],
          focus: 'sum-space',
          say: 'The only extra memory is the stack of calls waiting to finish.',
        },
        {
          focus: 'sum-space',
          draw: [{ write: 'log n deep, or n at worst', near: 'sum-space', side: 'below', when: 'log n deep' }],
          say: 'That stack is about log n deep, and n deep when every pivot is the biggest.',
        },
      ],
    },
  ],
};

const hunk = JSON.parse(fs.readFileSync(new URL('./hunks.json', import.meta.url), 'utf8')).s1;
const line = (n) => hunk.lines.find((l) => l.newLine === n).text.trim();
assert.deepEqual(
  [3, 11, 12, 19, 20].map(line),
  ['if (low < high) {', 'int pivot = arr[high];', 'int i = low - 1;', 'swap(arr, i + 1, high);', 'return i + 1;'],
  'the code lines the scenes point at',
);

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), `${JSON.stringify(story, null, 2)}\n`);
