// Writes storyboard.json beside this file. Every character code, sum, slot and load factor is computed here from
// the toy hash (sum of character codes, mod the table size). Run: node examples/algorithms/hash-table/generate.mjs
import fs from 'node:fs';
const code = (c) => c.charCodeAt(0);
const sum = (k) => [...k].reduce((t, c) => t + code(c), 0);
const slot = (k, m) => sum(k) % m;
const N = (n) => n.toLocaleString('en-US');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

assert(sum('cat') === 312 && slot('cat', 8) === 0 && slot('act', 8) === 0, 'cat/act');
const worstBinary = Math.floor(Math.log2(10_000_000)) + 1;
assert(worstBinary === 24, 'binary worst case');

const scenes = [];
scenes.push({
  type: 'table',
  chapter: 'The problem of scale',
  title: 'Finding one number among 10 million',
  narration: 'Say you keep ten million phone numbers, and you need to find one of them, again and again, thousands of times a second.',
  columns: ['How it is stored', 'Checks for 10 million, at most', 'Grows like'],
  rows: [
    { cells: ['A list in any order', N(10_000_000), 'O(n)'] },
    { cells: ['A sorted list, with binary search', String(worstBinary), 'O(log n)'] },
    { cells: ['A hash table', 'about 1', 'O(1)'], hidden: true },
  ],
  steps: [
    { focus: 0, say: 'In a list with no order, you may have to check every one of the ten million.' },
    { focus: 1, say: 'Sort the list and you can halve it on each check, so twenty four checks are enough.' },
    { focus: 'Checks for 10 million, at most@1', say: 'That is fast. But when a busy system does this thousands of times a second, even twenty four checks add up.' },
    { show: [2], tint: { 2: 'good' }, say: 'What we want is one jump, straight to the spot where the number lives. No scanning, no halving. That is what a hash table gives you.' },
  ],
});

const cat = [...'cat'];
const empty8 = Array(8).fill('');
scenes.push({
  type: 'array',
  chapter: 'The hash function',
  title: 'Working out where "cat" goes',
  narration: 'The trick is to work out the spot from the key itself. The rule that does this is called a hash function.',
  arrays: [
    { name: 'key', label: '"cat"', values: cat },
    { name: 'table', label: 'table', values: empty8 },
  ],
  pointers: [{ name: 'h(cat)', array: 'table', at: 0, hidden: true }],
  callout: 'h(key) = (sum of character codes) mod 8',
  steps: [
    { focus: 'array:key', say: 'Our key is the word cat.' },
    { set: Object.fromEntries(cat.map((c, i) => [`key[${i}]`, code(c)])), callout: `c = ${code('c')},  a = ${code('a')},  t = ${code('t')}`, say: `Every letter is stored as a number. C is ${code('c')}, a is ${code('a')}, and t is ${code('t')}.` },
    { focus: 'array:key', callout: `${cat.map(code).join(' + ')} = ${sum('cat')}`, say: `Add them up, and you get ${sum('cat')}.` },
    { focus: 'array:table', callout: `${sum('cat')} mod 8 = ${slot('cat', 8)}`, say: `The table has only eight slots, so we keep the remainder after dividing by eight. ${sum('cat')} divided by eight leaves ${slot('cat', 8)}.` },
    { show: ['ptr:h(cat)'], set: { 'table[0]': 'cat' }, tint: { 'table[0]': 'good' }, say: 'So cat goes in slot zero.' },
    { focus: ['ptr:h(cat)', 'table[0]'], callout: `h("cat") = ${slot('cat', 8)}`, say: 'To find cat later, we do not search. We do the same sum, get zero again, and read slot zero.' },
  ],
});

const act = [...'act'];
scenes.push({
  type: 'array',
  chapter: 'A collision',
  title: '"act" lands on the same slot',
  narration: 'Now add a second word, act.',
  arrays: [
    { name: 'key', label: '"act"', values: act },
    { name: 'table', label: 'table', values: ['cat', ...empty8.slice(1)] },
  ],
  pointers: [{ name: 'h(act)', array: 'table', at: 0, hidden: true }],
  tint: { 'table[0]': 'good' },
  steps: [
    { set: Object.fromEntries(act.map((c, i) => [`key[${i}]`, code(c)])), callout: `${act.map(code).join(' + ')} = ${sum('act')}`, say: `It has the same letters as the first word, in a different order, so its sum is also ${sum('act')}.` },
    { show: ['ptr:h(act)'], callout: `${sum('act')} mod 8 = ${slot('act', 8)}`, say: 'And the remainder is zero again, so act points at slot zero.' },
    { tint: { 'table[0]': 'bad' }, callout: '[collision]{bad}', say: 'But cat is already there. Two different keys want the same slot. This is called a collision.' },
    { focus: 'array:table', callout: 'endless words, 8 slots', say: 'You cannot avoid it. There are endless possible words, and only eight slots. Put ten pigeons in nine holes, and some hole gets two.' },
  ],
});

scenes.push({
  type: 'memory',
  chapter: 'Fix one: chaining',
  title: 'Each slot holds a short list',
  narration: 'The first fix is called chaining. Each slot holds the start of a small linked list instead of one key.',
  frames: [],
  objects: [
    { id: 'slots', type: 'table, 8 slots', fields: { '[0]': { ref: 'n1' }, '[1]': 'null', '[2]': 'null', '[3] to [7]': 'null' } },
    { id: 'n1', type: 'node', fields: { key: '"cat"', next: 'null' } },
    { id: 'n2', type: 'node', fields: { key: '"act"', next: 'null' }, hidden: true },
  ],
  steps: [
    { focus: ['slots.[0]', 'n1'], say: 'Slot zero points at a node holding cat.' },
    { show: ['n2'], set: { 'n1.next': { ref: 'n2' } }, callout: 'slot 0: "cat" → "act" → null', say: 'When act collides with it, act just joins the end of that list.' },
    { focus: ['slots.[0]', 'n1', 'n1.next', 'n2'], callout: 'find "act": slot 0, then 2 checks', say: 'To find act, jump to slot zero, then walk the list until you meet act. Here that is two checks.' },
  ],
});

scenes.push({
  type: 'array',
  chapter: 'Fix two: open addressing',
  title: 'Take the next free slot',
  narration: 'The second fix is called open addressing. Every key lives in the table itself, and a taken slot sends you looking further along.',
  values: ['cat', ...empty8.slice(1)],
  pointers: [{ name: 'probe', at: 0 }],
  tint: { 0: 'good' },
  steps: [
    { focus: ['ptr:probe', 0], callout: 'h("act") = 0', say: 'Act starts at slot zero, its hash.' },
    { tint: { 0: 'bad' }, callout: 'slot 0 is taken', say: 'Slot zero is taken by cat.' },
    { move: { probe: 1 }, set: { 1: 'act' }, tint: { 0: 'good', 1: 'good' }, callout: 'try slot 1: free', say: 'So it steps to the next slot, slot one, which is free, and act goes there.' },
    { focus: [0, 1], callout: 'find "act": slot 0, then slot 1', say: 'To find act later, start at slot zero, see cat, and step along until you meet act or an empty slot.' },
  ],
});

// Load factor and resizing, with chaining. These seven keys all fall into three slots of eight.
const keys = ['cat', 'act', 'pig', 'owl', 'dog', 'ant', 'hen'];
const fill = (m) => { const t = Array.from({ length: m }, () => []); for (const k of keys) t[slot(k, m)].push(k); return t; };
const t8 = fill(8), t16 = fill(16);
const longest = (t) => Math.max(...t.map((ks) => ks.length));
assert(longest(t8) === 3 && longest(t16) === 2, 'chains');
assert(t16[8].join() === 'cat,act', 'anagrams stay together');
// Each chain is drawn as a column: row d holds the key at depth d of every slot's list.
const depth = (t, d) => t.map((ks) => ks[d] ?? '');
const rows = (t, name, label, hidden) => Array.from({ length: longest(t) }, (_, d) => ({ name: `${name}${d}`, label: d ? '' : label, values: depth(t, d), ...(hidden ? { hidden } : {}) }));
const cellsOf = (t, name) => t.flatMap((ks, i) => ks.map((_, d) => `${name}${d}[${i}]`));
const tintChains = (t, name) => Object.fromEntries(t.flatMap((ks, i) => ks.map((_, d) => [`${name}${d}[${i}]`, ks.length > 1 ? 'bad' : 'good'])));
const oldRows = rows(t8, 'old', '8 slots');
const newRows = rows(t16, 'new', '16 slots', true).map((r) => ({ ...r, values: r.values.map(() => '') }));
scenes.push({
  type: 'array',
  chapter: 'Load factor',
  title: 'When the table gets crowded',
  narration: 'With chaining, the danger is a crowded table. Here seven keys sit in eight slots, and each list hangs down below its slot.',
  arrays: [...oldRows, ...newRows],
  callout: 'load factor α = N / M',
  steps: [
    { focus: oldRows.map((r) => `array:${r.name}`), callout: `α = ${keys.length} / 8 = ${keys.length / 8}`, say: 'The load factor is the number of keys divided by the number of slots. Seven over eight is zero point eight seven five.' },
    { tint: tintChains(t8, 'old'), say: `The keys do not spread out evenly, so the lists grow. Slot zero holds ${t8[0].length} keys, and finding pig means walking past cat and act first.` },
    { show: newRows.map((r) => `array:${r.name}`), tint: Object.fromEntries(oldRows.map((r) => [`array:${r.name}`, 'dim'])), focus: newRows.map((r) => `array:${r.name}`), say: 'So the table grows. We make a new one with twice the slots, sixteen.' },
    { set: Object.fromEntries(t16.flatMap((ks, i) => ks.map((k, d) => [`new${d}[${i}]`, k]))), tint: tintChains(t16, 'new'), callout: `α = ${keys.length} / 16 ≈ ${(keys.length / 16).toFixed(2)}`, say: 'Then every key is hashed again, this time with the remainder after dividing by sixteen, and moves to its new slot. Most lists shrink to one key.' },
    { focus: ['new0[8]', 'new1[8]'], callout: `${sum('cat')} mod 16 = ${slot('cat', 16)}`, say: 'Cat and act still share slot eight, because their sums are equal whatever the size. Real hash functions mix in the order of the letters, so this happens far less.' },
  ],
});

scenes.push({
  type: 'table',
  chapter: 'The guarantee',
  title: 'What a hash table costs',
  narration: 'Many tables grow once the load factor passes about two thirds to three quarters. Then the lists stay short, and every operation is one jump plus a check or two.',
  columns: ['Operation', 'Average', 'Worst case'],
  rows: [
    { cells: ['Look up', 'O(1)', 'O(n)'] },
    { cells: ['Insert', 'O(1)', 'O(n)'] },
    { cells: ['Delete', 'O(1)', 'O(n)'] },
  ],
  steps: [
    { focus: 'col:Average', tint: { 'Average@0': 'good', 'Average@1': 'good', 'Average@2': 'good' }, say: 'On average, looking up, adding and removing all take the same short time, however big the table gets.' },
    { focus: 'col:Worst case', say: 'The worst case is every key in one slot, which a good hash function makes very unlikely.' },
    { focus: 'Average@1', say: 'Growing the table is slow when it happens, but it happens so rarely that it adds only a little to each insert on average. That is how dictionaries, database indexes and caches answer in an instant.' },
  ],
});

fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify({ title: 'Hash tables', subtitle: 'Turning a key into an address', scenes }, null, 2) + '\n');
