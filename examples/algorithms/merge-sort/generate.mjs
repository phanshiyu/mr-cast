// Writes storyboard.json beside this file, then checks every level, merge and chart value against a run of merge sort.
// Run: node examples/algorithms/merge-sort/generate.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkCallouts, distinct, row, walkStates } from '../../lib/algorithm-checks.mjs';

const input = [51, 13, 89, 4, 62, 28, 77, 35];

const story = {
  title: 'Merge sort',
  subtitle: 'Split the list to single items, then zip them back in order',
  scenes: [
    {
      type: 'array',
      chapter: 'The idea',
      title: 'The easiest list to sort',
      narration: 'Sorting a whole list at once feels hard, because every number competes with every other number.',
      arrays: [
        { name: 'list', label: 'unsorted', values: input },
        { name: 'one', label: 'one item', values: [42], hidden: true },
      ],
      steps: [
        { focus: 'array:list', say: 'Here are eight numbers in no order at all.' },
        { show: ['array:one'], say: 'But what is the easiest list in the world to sort? A list with just one item.' },
        {
          focus: 'one[0]',
          tint: { 'one[0]': 'good' },
          callout: 'sorted? [yes, trivially]{good}',
          say: 'Is forty two sorted? Yes. A single item is always in order.',
        },
        {
          focus: ['array:list', 'one[0]'],
          callout: 'break down, then stitch back',
          say: 'Merge sort uses that. It breaks the list down until every piece is one item, then stitches the pieces back together in order.',
        },
      ],
    },
    {
      type: 'array',
      chapter: 'Divide',
      title: 'Split in half, again and again',
      narration: 'Step one is to divide.',
      indexes: false,
      arrays: [
        { name: 'level0', label: 'the list', values: input },
        { name: 'level1', label: 'halves', values: input, splits: [4], hidden: true },
        { name: 'level2', label: 'quarters', values: input, splits: [2, 4, 6], hidden: true },
        { name: 'level3', label: 'single items', values: input, splits: [1, 2, 3, 4, 5, 6, 7], hidden: true },
      ],
      steps: [
        { show: ['array:level1'], say: 'Find the middle, and cut the list in two.' },
        { show: ['array:level2'], say: 'Cut each half in two again.' },
        {
          show: ['array:level3'],
          tint: { 'array:level3': 'good' },
          say: 'And again, until every piece is a single item. That is where the splitting stops.',
        },
        {
          focus: ['array:level0', 'array:level3'],
          callout: 'nothing has moved yet',
          say: 'Notice that no number has changed places yet. We have only pulled them apart.',
        },
      ],
    },
    {
      type: 'array',
      chapter: 'First merges',
      title: 'Merging single items into pairs',
      narration: 'Step two is to merge. Start with the first two single items.',
      indexes: false,
      arrays: [
        { name: 'singles', label: 'single items', values: [51, 13, 89, 4], splits: [1, 2, 3] },
        { name: 'pairs', label: 'merged pairs', values: ['', '', '', ''], splits: [2] },
      ],
      steps: [
        {
          focus: 'singles[0-1]',
          callout: '[13 < 51]{good}',
          say: 'Compare fifty one and thirteen. Thirteen is smaller.',
        },
        { set: { 'pairs[0]': 13 }, tint: { 'singles[1]': 'dim' }, say: 'So thirteen goes first.' },
        {
          set: { 'pairs[1]': 51 },
          tint: { 'singles[0]': 'dim', 'pairs[0-1]': 'good' },
          callout: '',
          say: 'Then fifty one. That pair is sorted.',
        },
        { focus: 'singles[2-3]', callout: '[4 < 89]{good}', say: 'Same for eighty nine and four. Four is smaller.' },
        {
          set: { 'pairs[2]': 4, 'pairs[3]': 89 },
          tint: { 'singles[2-3]': 'dim', 'pairs[2-3]': 'good' },
          callout: '',
          say: 'So four goes first, then eighty nine.',
        },
      ],
    },
    {
      type: 'array',
      chapter: 'The zipper',
      title: 'Merging two sorted pairs',
      narration:
        'Now merge the two sorted pairs. Both are already in order, so we only ever look at the front of each one.',
      arrays: [
        { name: 'left', values: [13, 51] },
        { name: 'right', values: [4, 89] },
        { name: 'out', label: 'merged', values: ['', '', '', ''] },
      ],
      pointers: [
        { name: 'p1', array: 'left', at: 0, tone: 'accent' },
        { name: 'p2', array: 'right', at: 0, tone: 'warn' },
      ],
      steps: [
        {
          focus: ['left[0]', 'right[0]'],
          callout: '[4 < 13]{good}',
          say: 'Compare thirteen and four. Four is smaller.',
        },
        {
          set: { 'out[0]': 4 },
          tint: { 'right[0]': 'dim' },
          move: { p2: 1 },
          say: 'So four takes the first spot, and p two moves on to eighty nine.',
        },
        {
          focus: ['left[0]', 'right[1]'],
          callout: '[13 < 89]{good}',
          say: 'Compare thirteen and eighty nine. Thirteen wins.',
        },
        {
          set: { 'out[1]': 13 },
          tint: { 'left[0]': 'dim' },
          move: { p1: 1 },
          say: 'Thirteen takes the next spot, and p one moves on to fifty one.',
        },
        {
          focus: ['left[1]', 'right[1]'],
          callout: '[51 < 89]{good}',
          say: 'Fifty one against eighty nine. Fifty one wins.',
        },
        {
          set: { 'out[2]': 51 },
          tint: { 'left[1]': 'dim' },
          move: { p1: 2 },
          callout: 'left is empty',
          say: 'Now the left pair is used up.',
        },
        {
          set: { 'out[3]': 89 },
          tint: { 'right[1]': 'dim', 'array:out': 'good' },
          move: { p2: 2 },
          callout: '[4, 13, 51, 89]{good}',
          say: 'So the leftover eighty nine just copies over. It is like two sorted decks of cards feeding one sorted pile.',
        },
      ],
    },
    {
      type: 'array',
      chapter: 'Why n log n',
      title: 'Merging all the way back up',
      narration: 'The same zipper runs at every level, until the whole list is back together.',
      indexes: false,
      arrays: [
        { name: 'ones', label: 'single items', values: input, splits: [1, 2, 3, 4, 5, 6, 7] },
        { name: 'twos', label: 'pairs', values: [13, 51, 4, 89, 28, 62, 35, 77], splits: [2, 4, 6], hidden: true },
        { name: 'fours', label: 'fours', values: [4, 13, 51, 89, 28, 35, 62, 77], splits: [4], hidden: true },
        { name: 'all', label: 'sorted', values: [4, 13, 28, 35, 51, 62, 77, 89], hidden: true },
      ],
      steps: [
        { show: ['array:twos'], callout: '8 moves', say: 'Merging into pairs moves all eight numbers once.' },
        { show: ['array:fours'], callout: '8 moves', say: 'Merging pairs into fours moves all eight again.' },
        {
          show: ['array:all'],
          tint: { 'array:all': 'good' },
          callout: '8 moves',
          say: 'And the last merge moves all eight one more time. The list is sorted.',
        },
        {
          focus: ['array:twos', 'array:fours', 'array:all'],
          callout: '3 levels × 8 = 24 = log₂ 8 × 8',
          say: 'Halving eight items takes three levels, which is log two of eight. Each level does about n work. So the total is n times log n.',
        },
      ],
    },
    {
      type: 'chart',
      chapter: 'Compared',
      title: 'Work as the list grows',
      kind: 'line',
      unit: 'steps',
      better: 'lower',
      narration: 'Compare that with a simple sort that checks every pair, which takes about n squared steps.',
      labels: ['n = 8', 'n = 16', 'n = 32', 'n = 64', 'n = 128'],
      series: [
        { name: 'n²', values: [64, 256, 1024, 4096, 16384], tone: 'bad' },
        { name: 'n log₂ n', values: [24, 64, 160, 384, 896], tone: 'good' },
      ],
      steps: [
        {
          focus: 'series:n²',
          say: 'n squared shoots up. At a hundred twenty eight items it is over sixteen thousand.',
        },
        { focus: 'series:n log₂ n', say: 'n log n climbs gently, to under nine hundred.' },
        {
          focus: 'n log₂ n@n = 128',
          say: 'That is about ninety five percent less work. And merge sort gets this every time. Unlike quicksort, it has no bad pivot days.',
        },
      ],
    },
  ],
};

function merge(x, y) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) out.push(x[i] <= y[j] ? x[i++] : y[j++]);
  return [...out, ...x.slice(i), ...y.slice(j)];
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
const divide = story.scenes.find((x) => x.chapter === 'Divide');
down.forEach((level, k) => {
  let at = 0;
  assert.deepEqual(divide.arrays[k].values, level.flat(), `divide level ${k}`);
  assert.deepEqual(
    divide.arrays[k].splits ?? [],
    level.slice(0, -1).map((p) => (at += p.length)),
    `divide level ${k} splits`,
  );
});
const pairs = walkStates(story.scenes.find((x) => x.chapter === 'First merges')).states.at(-1);
assert.deepEqual(row(pairs, 'pairs', 4), [...merge([51], [13]), ...merge([89], [4])], 'first merges');
const zip = story.scenes.find((x) => x.chapter === 'The zipper');
const zs = walkStates(zip).states;
assert.deepEqual(row(zs.at(-1), 'out', 4), merge([13, 51], [4, 89]), 'zipper result');
assert.equal(
  distinct(zs.map((st) => row(st, 'out', 4).filter((v) => v !== '').length)).length - 1,
  4,
  'the out slots fill one at a time',
);
const conquer = story.scenes.find((x) => x.chapter === 'Why n log n');
up.forEach((level, k) => assert.deepEqual(conquer.arrays[k].values, level.flat(), `merge level ${k}`));
story.scenes.filter((x) => x.type === 'array').forEach((scene, k) => checkCallouts(scene, `scene ${k}`));
const chart = story.scenes.find((x) => x.type === 'chart');
chart.labels.forEach((l, k) => {
  const n = Number(l.replace(/\D/g, ''));
  assert.ok(chart.series[0].values[k] === n * n && chart.series[1].values[k] === n * Math.log2(n), `chart at ${l}`);
});

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), `${JSON.stringify(story, null, 2)}\n`);
