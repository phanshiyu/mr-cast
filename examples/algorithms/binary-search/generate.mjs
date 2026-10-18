// Writes storyboard.json beside this file, then checks every pointer, halving row and worst-case count against a run of
// binary search. Run: node examples/algorithms/binary-search/generate.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkCallouts, distinct, walkStates } from '../../lib/algorithm-checks.mjs';

const values = [2, 5, 8, 12, 16, 23, 38, 45, 56, 67, 72, 79, 84, 91, 95, 99];

const story = {
  title: 'Binary search',
  subtitle: 'Why a sorted list can be searched in a handful of looks',
  scenes: [
    {
      type: 'array',
      chapter: 'Checking one by one',
      title: 'Looking for 72 the slow way',
      label: 'list',
      narration: 'Say you want to find seventy two in this list. If you do not know the list is in order, all you can do is check every box, starting from the first.',
      values,
      pointers: [{ name: 'check', at: 0, tone: 'bad' }],
      ranges: [{ name: 'sorted', from: 0, to: 15, tone: 'good', hidden: true }],
      callout: 'target = **72**',
      steps: [
        { focus: ['ptr:check', 0], tint: { 0: 'bad' }, say: 'Is it two? No.' },
        { move: { check: 1 }, tint: { 1: 'bad' }, say: 'Is it five? No.' },
        { move: { check: 2 }, tint: { 2: 'bad' }, say: 'Eight? No.' },
        { move: { check: 10 }, tint: { '3-9': 'bad', 10: 'good' }, callout: '11 checks to reach 72', say: 'And so on, until the eleventh box finally holds seventy two.' },
        { focus: [15], callout: 'worst case: n checks', say: 'If the number sits at the very end, or is not there at all, you check all sixteen. For four billion rows, that is four billion checks.' },
        { show: ['range:sorted'], tint: { '0-15': 'clear' }, callout: 'the list **must** be sorted', say: 'We can do much better, if the list is sorted. That one rule is the whole trick.' },
      ],
    },
    {
      type: 'array',
      chapter: 'The middle',
      title: 'Two pointers and a midpoint',
      label: 'list',
      narration: 'Instead of starting at the front, put one pointer at each end.',
      values,
      pointers: [
        { name: 'L', at: 0, tone: 'good' },
        { name: 'R', at: 15, tone: 'accent' },
        { name: 'mid', at: 7, tone: 'warn', hidden: true },
      ],
      callout: 'mid = L + ⌊(R − L) / 2⌋',
      steps: [
        { focus: ['ptr:L', 'ptr:R'], say: 'L marks the start, at index zero. R marks the end, at index fifteen.' },
        { show: ['ptr:mid'], callout: 'mid = 0 + ⌊(15 − 0) / 2⌋ = 7', say: 'Halfway between them is index seven.' },
        { focus: 7, callout: '72 ? 45', say: 'It holds forty five. Now ask one question. Is seventy two equal to it, smaller, or bigger?' },
        { focus: ['ptr:L', 'ptr:R'], callout: '(L + R) / 2 [can overflow]{bad}', say: 'Why not just add L and R and halve it? On a huge list, that sum can get too big for the number type in Java or C, and wrap around. Taking half the gap from L never gets that big.' },
      ],
    },
    {
      type: 'array',
      chapter: 'Throwing half away',
      title: 'One look rules out half',
      label: 'list',
      narration: 'Here is where the order pays off.',
      values,
      pointers: [
        { name: 'L', at: 0, tone: 'good' },
        { name: 'R', at: 15, tone: 'accent' },
        { name: 'mid', at: 7, tone: 'warn' },
      ],
      callout: 'mid = 0 + ⌊(15 − 0) / 2⌋ = 7',
      steps: [
        // The pen writes each comparison and brackets each half it rules out; the header keeps the pointer arithmetic.
        { focus: 7, say: 'The target is bigger than forty five.', draw: [{ circle: 7 }, { write: `72 > ${values[7]}`, near: 7, when: 'bigger' }] },
        { tint: { '0-7': 'dim' }, move: { L: 8 }, callout: 'L = mid + 1 = 8', say: 'Every box left of it is even smaller. So none of those first eight can be the one. We cross them all out in one go, and L jumps to index eight.', draw: [{ brace: '0-7', note: `all ≤ ${values[7]}, so not here`, when: 'even smaller' }] },
        { move: { mid: 11 }, erase: true, callout: 'mid = 8 + ⌊(15 − 8) / 2⌋ = 11', say: 'Find the new middle. It is index eleven.' },
        { focus: 11, say: 'It holds seventy nine. The target is smaller.', draw: [{ circle: 11 }, { write: `72 < ${values[11]}`, near: 11, when: 'smaller' }] },
        { focus: ['11-15', 'ptr:R'], tint: { '11-15': 'dim' }, move: { R: 10 }, callout: 'R = mid − 1 = 10', say: 'So index eleven and everything right of it are out. R moves to index ten.', draw: [{ brace: '11-15', note: 'out', when: 'everything right' }] },
        { focus: '8-10', erase: true, callout: '16 → 8 → 3 left', say: 'Sixteen boxes went down to half, and now just three are left, after only two looks.', draw: [{ box: '8-10', note: 'still in play', when: 'three are left' }] },
      ],
    },
    {
      type: 'array',
      chapter: 'Found it',
      title: 'Closing in on 72',
      label: 'list',
      narration: 'Three boxes are left: fifty six, sixty seven and seventy two.',
      values,
      pointers: [
        { name: 'L', at: 8, tone: 'good' },
        { name: 'R', at: 10, tone: 'accent' },
        { name: 'mid', at: 9, tone: 'warn', hidden: true },
      ],
      tint: { '0-7': 'dim', '11-15': 'dim' },
      steps: [
        { show: ['ptr:mid'], callout: 'mid = 8 + ⌊(10 − 8) / 2⌋ = 9', say: 'The middle is index nine.' },
        { focus: 9, callout: '[72 > 67]{good}', say: 'It holds sixty seven, which is too small.' },
        { tint: { '8-9': 'dim' }, move: { L: 10 }, callout: 'L = mid + 1 = 10', say: 'So L moves past it, to index ten.' },
        { move: { mid: 10 }, callout: 'mid = 10 + ⌊(10 − 10) / 2⌋ = 10', say: 'Now L and R meet, and the middle is index ten.' },
        { focus: 10, tint: { 10: 'good' }, callout: '[72 = 72]{good} found', mark: 'circle', note: '4 looks', say: 'It holds seventy two. Found, on the fourth look.' },
      ],
    },
    {
      type: 'array',
      chapter: 'Halving',
      title: 'What was left after each look',
      narration: 'Line up what was still in play before each look.',
      indexes: false,
      arrays: [
        { name: 'look1', label: 'look 1', values },
        { name: 'look2', label: 'look 2', values: values.slice(8), hidden: true },
        { name: 'look3', label: 'look 3', values: values.slice(8, 11), hidden: true },
        { name: 'look4', label: 'look 4', values: values.slice(10, 11), hidden: true },
      ],
      steps: [
        { focus: 'array:look1', callout: '16 left', say: 'Sixteen boxes before the first look.' },
        { show: ['array:look2'], callout: '8 left', say: 'Half of them before the second.' },
        { show: ['array:look3'], callout: '3 left', say: 'Three before the third. Each look also throws out the middle box, and the two sides are not always equal, so this search went sixteen, eight, three, one.' },
        { show: ['array:look4'], tint: { 'look4[0]': 'good' }, callout: '1 left', say: 'And one box for the last look.' },
        { focus: ['array:look1', 'array:look4'], callout: 'n / 2ᵏ = 1, so k = log₂ n', say: 'In general, every look halves what is left. Halve n about log two of n times, and one box is left. So doubling the list adds just one more look.' },
      ],
    },
    {
      type: 'chart',
      chapter: 'At scale',
      title: 'The most looks binary search needs',
      kind: 'line',
      unit: 'looks',
      better: 'lower',
      narration: 'Here is the most looks it can ever take, as the list grows.',
      labels: ['16', '1 thousand', '1 million', '1 billion', '4 billion'],
      series: [{ name: 'most looks', values: [5, 10, 20, 30, 32], tone: 'good' }],
      annotation: { at: '4 billion', text: 'checking one by one: 4 billion' },
      steps: [
        { focus: '16', say: 'Sixteen boxes take at most five looks. Our search got lucky and needed four.' },
        { focus: '1 million', say: 'A million take at most twenty.' },
        { focus: 'most looks@4 billion', say: 'And four billion take at most thirty two, where checking one by one could take four billion.' },
      ],
    },
  ],
};

function binarySearch(a, target) {
  let L = 0;
  let R = a.length - 1;
  const steps = [];
  while (L <= R) {
    const mid = L + Math.floor((R - L) / 2);
    steps.push({ L, R, mid });
    if (a[mid] === target) return steps;
    if (target > a[mid]) L = mid + 1;
    else R = mid - 1;
  }
  return steps;
}

const steps = binarySearch(values, 72);
story.scenes.forEach((scene, k) => scene.type === 'array' && checkCallouts(scene, `scene ${k}`));
const mids = story.scenes.flatMap((scene) => (scene.type === 'array' && scene.values ? walkStates(scene).states.filter((st) => st.places['ptr:mid'] && !st.hidden['ptr:mid']).map((st) => st.places['ptr:mid'][0]) : []));
assert.deepEqual(distinct(mids), steps.map((x) => x.mid), 'mid positions differ from the simulation');
const linear = walkStates(story.scenes[0]).states.at(-1);
assert.ok(linear.values['c:10'] === 72 && values.indexOf(72) === 10, 'linear search finds 72 at index 10');
const chart = story.scenes.find((x) => x.type === 'chart');
const ns = { 16: 16, '1 thousand': 1e3, '1 million': 1e6, '1 billion': 1e9, '4 billion': 4e9 };
chart.labels.forEach((l, k) => assert.equal(chart.series[0].values[k], Math.floor(Math.log2(ns[l])) + 1, `worst case for ${l}`));
const halving = story.scenes.find((x) => x.arrays && x.arrays[0].values.length === 16);
halving.arrays.forEach((r, k) => assert.deepEqual(r.values, values.slice(steps[k].L, steps[k].R + 1), `halving row ${k}`));

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), `${JSON.stringify(story, null, 2)}\n`);
