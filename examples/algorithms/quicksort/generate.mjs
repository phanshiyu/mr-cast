// Writes storyboard.json beside this file, then checks every state a viewer sees against a run of Lomuto's quicksort.
// The split-depth drawing is generated here. hunks.json is not generated: it is `mr-cast snippet QuickSort.java 1-27`
// on the class whose code it holds. Run: node examples/algorithms/quicksort/generate.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkCallouts, distinct, plain, row, walkStates } from '../../lib/algorithm-checks.mjs';

function splitDrawing() {
  const cell = 46;
  const gap = 6;
  const rowH = 58;
  const top = 92;
  const parts = [];
  const row = (x, y, n, cls = '') =>
    Array.from(
      { length: n },
      (_, k) => `<rect x="${x + k * (cell + gap)}" y="${y}" width="${cell}" height="${cell}" rx="6"${cls}/>`,
    ).join('');
  parts.push(
    '<text x="300" y="44" text-anchor="middle" font-size="28" font-weight="600">Pivot lands in the middle</text>',
  );
  parts.push('<text x="900" y="44" text-anchor="middle" font-size="28" font-weight="600">List already sorted</text>');
  // Even splits: 8, then halves, quarters, single items. Each row still holds all 8 items.
  const even = [[8], [4, 4], [2, 2, 2, 2], [1, 1, 1, 1, 1, 1, 1, 1]];
  const evenRows = even.map((pieces, r) => {
    const y = top + r * rowH;
    const width = pieces.reduce((w, n) => w + n * (cell + gap) - gap, 0) + (pieces.length - 1) * 18;
    let x = 300 - width / 2;
    const cells = pieces.map((n) => {
      const s = row(x, y, n);
      x += n * (cell + gap) - gap + 18;
      return s;
    });
    return `<g id="even-${r}">${cells.join('')}</g>`;
  });
  parts.push(`<g id="even">${evenRows.join('')}</g>`);
  parts.push(
    `<text id="even-depth" x="300" y="${top + 4 * rowH + 50}" text-anchor="middle" font-size="26" fill="var(--muted)">3 rounds of splits: log₂ 8</text>`,
  );
  // Sorted input with the last item as pivot: each partition peels off one item.
  const sortedRows = Array.from({ length: 8 }, (_, r) => {
    const n = 8 - r;
    const y = top + r * rowH;
    const x = 680;
    return `<g id="sorted-${r}">${row(x, y, n - 1)}<rect class="tone-warn" x="${x + (n - 1) * (cell + gap)}" y="${y}" width="${cell}" height="${cell}" rx="6"/></g>`;
  });
  parts.push(`<g id="sorted">${sortedRows.join('')}</g>`);
  parts.push(
    `<text id="sorted-depth" x="900" y="${top + 8 * rowH + 50}" text-anchor="middle" font-size="26" fill="var(--muted)">7 rounds of splits: n − 1</text>`,
  );
  return `<svg viewBox="0 0 1200 ${top + 8 * rowH + 72}">${parts.join('')}</svg>`;
}

const story = {
  title: 'Quicksort',
  subtitle: 'Pick a pivot, split around it, repeat on each side',
  scenes: [
    {
      type: 'array',
      chapter: 'The idea',
      title: 'Split around one value',
      narration:
        'Quicksort is a divide and conquer sort. It picks one value, called the pivot, and moves everything smaller to its left and everything bigger to its right. Then it does the same thing to each side.',
      arrays: [
        { name: 'before', label: 'unsorted', values: [7, 2, 9, 4, 1, 8, 3, 5] },
        { name: 'after', label: 'after one split', values: [2, 4, 1, 3, 5, 8, 7, 9], splits: [4, 5], hidden: true },
      ],
      steps: [
        {
          focus: 'before[7]',
          tint: { 'before[7]': 'accent' },
          callout: 'pivot = last item = 5',
          say: 'In this version, the pivot is always the last item. Here that is five.',
        },
        {
          show: ['array:after'],
          tint: { 'after[0-3]': 'neutral', 'after[4]': 'accent', 'after[5-7]': 'neutral' },
          callout: 'smaller · [5]{accent} · bigger',
          say: 'After one split, the four smaller numbers sit on the left, and the three bigger ones on the right.',
        },
        {
          focus: 'after[4]',
          tint: { 'after[4]': 'good' },
          callout: '[5 is done]{good}',
          say: 'Five is now exactly where it belongs in the sorted list. It never moves again.',
        },
        {
          focus: ['after[0-3]', 'after[5-7]'],
          callout: 'repeat on each side',
          say: 'The two sides are still jumbled, so quicksort splits each of them the same way.',
        },
      ],
    },
    {
      type: 'array',
      chapter: 'One split, step by step',
      title: 'Partition around the pivot 5',
      narration:
        'Here is how one split works. The pointer j walks the list from left to right. The pointer i marks the end of the small pile, shown in green, and it starts just before the list. Bigger numbers turn amber.',
      values: [7, 2, 9, 4, 1, 8, 3, 5],
      pointers: [
        { name: 'i', at: -1, tone: 'good' },
        { name: 'j', at: 0, tone: 'accent' },
      ],
      tint: { 7: 'accent' },
      callout: 'pivot = 5',
      steps: [
        {
          focus: ['ptr:j', 0],
          tint: { 0: 'warn' },
          callout: '7 < 5? [no]{bad}',
          say: 'j looks at seven. Seven is not smaller than five, so it stays put.',
        },
        {
          move: { j: 1 },
          focus: ['ptr:j', 1, 0],
          callout: '2 < 5? [yes]{good}',
          say: 'j moves on to two. Two is smaller than the pivot, so it belongs in the small pile, which starts at the first cell.',
        },
        {
          move: { i: 0 },
          set: { 0: 2, 1: 7 },
          tint: { 0: 'good', 1: 'warn' },
          callout: 'i = 0, swap',
          say: 'So i steps forward, and the two swaps into the small pile.',
        },
        {
          move: { j: 2 },
          tint: { 2: 'warn' },
          callout: '9 < 5? [no]{bad}',
          say: 'Nine is bigger, so j just moves past it.',
        },
        {
          move: { j: 3 },
          focus: ['ptr:j', 3, 1],
          callout: '4 < 5? [yes]{good}',
          say: 'Four is smaller. The next spot in the small pile holds seven.',
        },
        {
          move: { i: 1 },
          set: { 1: 4, 3: 7 },
          tint: { 1: 'good', 3: 'warn' },
          callout: 'i = 1, swap',
          say: 'i steps forward, and four swaps places with the seven.',
        },
        {
          move: { j: 4 },
          focus: ['ptr:j', 4, 2],
          callout: '1 < 5? [yes]{good}',
          say: 'One is smaller too, and the next spot holds nine.',
        },
        {
          move: { i: 2 },
          set: { 2: 1, 4: 9 },
          tint: { 2: 'good', 4: 'warn' },
          callout: 'i = 2, swap',
          say: 'So one swaps with the nine.',
        },
        { move: { j: 5 }, tint: { 5: 'warn' }, callout: '8 < 5? [no]{bad}', say: 'Eight is bigger. Skip it.' },
        {
          move: { j: 6 },
          focus: ['ptr:j', 6, 3],
          callout: '3 < 5? [yes]{good}',
          say: 'Three is smaller, and the next spot holds seven.',
        },
        {
          move: { i: 3 },
          set: { 3: 3, 6: 7 },
          tint: { 3: 'good', 6: 'warn' },
          callout: 'i = 3, swap',
          say: 'Three swaps with the seven.',
        },
        {
          focus: [4, 7],
          callout: 'spot after the pile = i + 1 = 4',
          say: 'Now every number before the pivot has been checked. The spot right after the small pile holds nine.',
        },
        {
          set: { 4: 5, 7: 9 },
          tint: { 4: 'accent', 7: 'warn' },
          callout: 'swap arr[i + 1] with the pivot',
          say: 'So the pivot and the nine swap.',
        },
        {
          focus: 4,
          callout: '[5 lands at index 4]{accent}',
          mark: 'circle',
          note: 'its final place',
          say: 'Five lands at index four. Smaller on its left, bigger on its right. That is its final resting place.',
        },
      ],
    },
    {
      type: 'array',
      chapter: 'Recursion',
      title: 'The same split on each side',
      narration:
        'Now quicksort calls itself on the left side, then on the right side. Each call gets a smaller piece, from low to high.',
      values: [2, 4, 1, 3, 5, 8, 7, 9],
      tint: { 4: 'good' },
      ranges: [{ name: 'low to high', from: 0, to: 3, tone: 'accent' }],
      callout: 'quickSort(arr, 0, 3)',
      steps: [
        {
          focus: ['range:low to high', 3],
          tint: { 3: 'accent' },
          say: 'The left side runs from index zero to three. Its pivot is three.',
        },
        {
          set: { 1: 1, 2: 3, 3: 4 },
          tint: { 2: 'good', 3: 'clear' },
          callout: '[3 lands at index 2]{good}',
          say: 'After the split, three lands at index two.',
        },
        {
          move: { 'low to high': '0-1' },
          tint: { 1: 'accent' },
          callout: 'quickSort(arr, 0, 1)',
          say: 'Next, the piece from zero to one. Its pivot is one.',
        },
        {
          set: { 0: 1, 1: 2 },
          tint: { 0: 'good', 1: 'clear' },
          callout: '[1 lands at index 0]{good}',
          say: 'One is smaller than two, so it lands at index zero.',
        },
        {
          focus: [1, 3],
          tint: { 1: 'good', 3: 'good' },
          callout: 'low < high? [no]{bad}, stop',
          say: 'What is left are single items: the two, and the four. A single item is already sorted, so the calls stop there. That is the base case.',
        },
        {
          move: { 'low to high': '5-7' },
          tint: { 7: 'accent' },
          callout: 'quickSort(arr, 5, 7)',
          say: 'Now the three cells on the right. Their pivot is nine.',
        },
        {
          focus: [5, 6, 7],
          tint: { 7: 'good' },
          callout: '[9 stays at index 7]{good}',
          say: 'Eight and seven are both smaller, so nine stays at the end.',
        },
        {
          move: { 'low to high': '5-6' },
          tint: { 6: 'accent' },
          callout: 'quickSort(arr, 5, 6)',
          say: 'Then the two cells left of it, with pivot seven.',
        },
        {
          set: { 5: 7, 6: 8 },
          tint: { 5: 'good', 6: 'good' },
          callout: '[sorted]{good}',
          say: 'Seven swaps in front of eight, and eight is left on its own. The whole list is sorted.',
        },
      ],
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
          say: 'quickSort first checks the base case. If low is not below high, the piece has one item or none, so there is nothing to do.',
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
      narration:
        'How fast is it? Each round of splits touches every item about once. So the speed depends on how many rounds there are.',
      svg: splitDrawing(),
      labels: { even: 'pivot lands in the middle', sorted: 'already sorted list' },
      hidden: ['sorted'],
      steps: [
        {
          focus: ['even', 'even-depth'],
          callout: 'n per row × log₂ n rows',
          say: 'When the pivot lands near the middle, each row halves the pieces. Eight items take three rounds, which is log two of eight. That gives n log n, both on average and at best.',
        },
        {
          show: ['sorted'],
          focus: ['sorted', 'sorted-depth'],
          callout: 'n + (n − 1) + … + 1 ≈ n² / 2',
          say: 'But give it a list that is already sorted. The last item is always the biggest, so each split peels off just one item. That makes about n rounds, and the time grows with n squared. This is the worst case.',
        },
      ],
    },
    {
      type: 'table',
      chapter: 'Summary',
      title: 'Quicksort at a glance',
      narration: 'Here is the summary.',
      columns: ['Case', 'Time', 'When'],
      rows: [
        { cells: ['Best', '**O(n log n)**', 'every pivot lands in the middle'] },
        { cells: ['Average', '**O(n log n)**', 'random order'] },
        { cells: ['Worst', '**O(n²)**', 'already sorted, pivot at the end'] },
        { cells: ['Space', '**O(log n)**', 'the stack of calls; O(n) in the worst case'] },
      ],
      steps: [
        { focus: [0, 1], tint: { 0: 'good', 1: 'good' }, say: 'Best and average are both n log n.' },
        {
          focus: 2,
          tint: { 2: 'bad' },
          say: 'The worst case is n squared, when every pivot is the biggest or smallest item.',
        },
        {
          focus: 3,
          tint: { 3: 'accent' },
          say: 'It sorts in place, so the only extra memory is the stack of calls waiting to finish. That is about log n deep on average, and n deep in that worst case.',
        },
      ],
    },
  ],
};

function lomuto(input) {
  const a = [...input];
  const partitions = [];
  const sort = (low, high) => {
    if (low >= high) return;
    const pivot = a[high];
    let i = low - 1;
    const steps = [];
    for (let j = low; j < high; j++) {
      const less = a[j] < pivot;
      if (less) {
        i++;
        [a[i], a[j]] = [a[j], a[i]];
      }
      steps.push({ j, i, after: [...a] });
    }
    [a[i + 1], a[high]] = [a[high], a[i + 1]];
    const p = i + 1;
    partitions.push({ low, high, pivot, p, steps, after: [...a] });
    sort(low, p - 1);
    sort(p + 1, high);
  };
  sort(0, a.length - 1);
  return { sorted: a, partitions };
}

const input = [7, 2, 9, 4, 1, 8, 3, 5];
const qs = lomuto(input);
const first = qs.partitions[0];
const intro = walkStates(story.scenes[0]).states.at(-1);
assert.deepEqual(row(intro, 'before', 8), input, 'intro input');
assert.deepEqual(row(intro, 'after', 8), first.after, 'intro after one split');
story.scenes.slice(0, 3).forEach((scene, k) => checkCallouts(scene, `scene ${k}`));

const part = walkStates(story.scenes[1]).states;
assert.deepEqual(
  distinct(part.map((st) => row(st, null, 8))),
  distinct([input, ...first.steps.map((x) => x.after), first.after]),
  'partition values differ from the simulation',
);
part.forEach((st, k) => {
  if (k === 0) return;
  const now = row(st, null, 8);
  if (JSON.stringify(row(part[k - 1], null, 8)) === JSON.stringify(now)) return;
  const sim = first.steps.find((x) => JSON.stringify(x.after) === JSON.stringify(now));
  if (sim)
    assert.ok(
      st.places['ptr:i'][0] === sim.i && st.places['ptr:j'][0] === sim.j,
      `partition state ${k}: i/j at ${st.places['ptr:i'][0]}/${st.places['ptr:j'][0]}, sim ${sim.i}/${sim.j}`,
    );
  const m = plain(st.callout).match(/^(\d+) < 5\?/);
  if (m)
    assert.equal(
      st.values[`c:${st.places['ptr:j'][0]}`],
      Number(m[1]),
      `partition state ${k}: the callout names a value j is not on`,
    );
});
assert.ok(plain(part.at(-1).callout).includes(`index ${first.p}`), 'pivot index');

const rec = walkStates(story.scenes[2]).states;
assert.deepEqual(
  distinct(rec.map((st) => row(st, null, 8))),
  distinct(qs.partitions.map((p) => p.after)),
  'recursion values differ from the simulation',
);
assert.equal(Object.values(rec.at(-1).tints).filter((t) => t === 'good').length, 8, 'every cell ends green');
rec.forEach((st, k) => {
  const call = st.callout.match(/quickSort\(arr, (\d+), (\d+)\)/);
  if (call) {
    const [low, high] = [Number(call[1]), Number(call[2])];
    assert.ok(
      qs.partitions.some((p) => p.low === low && p.high === high),
      `recursion state ${k}: no partition(${low}, ${high}) in the simulation`,
    );
    assert.deepEqual(st.places['rg:low to high'], [low, high], `recursion state ${k}: range is not ${low}-${high}`);
  }
  const lands = plain(st.callout).match(/^(\d+) (?:lands at|stays at) index (\d+)/);
  if (lands)
    assert.ok(
      qs.partitions.some((p) => p.pivot === Number(lands[1]) && p.p === Number(lands[2])),
      `pivot ${lands[1]} at ${lands[2]}`,
    );
});

const hunk = JSON.parse(fs.readFileSync(new URL('./hunks.json', import.meta.url), 'utf8')).s1;
const line = (n) => hunk.lines.find((l) => l.newLine === n).text.trim();
assert.deepEqual(
  [3, 11, 12, 19, 20].map(line),
  ['if (low < high) {', 'int pivot = arr[high];', 'int i = low - 1;', 'swap(arr, i + 1, high);', 'return i + 1;'],
  'the code lines the scenes point at',
);

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), `${JSON.stringify(story, null, 2)}\n`);
