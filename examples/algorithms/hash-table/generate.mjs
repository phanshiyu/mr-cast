// Writes storyboard.json beside this file. Every character code, sum, slot and load factor on the board is computed
// here from the toy hash (sum of character codes, mod the table size). Run: node examples/algorithms/hash-table/generate.mjs
import fs from 'node:fs';
const code = (c) => c.charCodeAt(0);
const sum = (k) => [...k].reduce((t, c) => t + code(c), 0);
const slot = (k, m) => sum(k) % m;
const N = (n) => n.toLocaleString('en-US');
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

assert(sum('cat') === 312 && slot('cat', 8) === 0 && slot('act', 8) === 0, 'cat/act');
const worstBinary = Math.floor(Math.log2(10_000_000)) + 1;
assert(worstBinary === 24, 'binary worst case');

const head = (id, color) =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${color}" stroke="none"/></marker>`;
const defs = `<defs>${head('head', 'var(--text)')}</defs>`;

// Scene 1: three ways to store ten million numbers, each a strip of boxes and what finding one costs.
const strip = (y, n) =>
  Array.from(
    { length: n },
    (_, k) => `<rect x="${40 + k * 50}" y="${y}" width="42" height="46" rx="6" stroke-width="3"/>`,
  ).join('') + `<text x="${40 + n * 50 + 6}" y="${y + 34}" font-size="28" fill="var(--muted)">…</text>`;
const scale = `<svg viewBox="0 0 1200 640">${defs}
<g id="any"><text x="40" y="50" font-size="28">a list in any order</text>${strip(70, 14)}
<path d="M64 140 H700" fill="none" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/><text x="64" y="176" font-size="22" fill="var(--muted)">check every one</text>
<text id="anyN" x="1160" y="106" text-anchor="end" font-size="30">${N(10_000_000)} checks</text></g>
<g id="sorted"><text x="40" y="260" font-size="28">a sorted list, with binary search</text>${strip(280, 14)}
<path d="M40 340 H730 M390 354 H730 M390 368 H560 M390 382 H470" fill="none" stroke="var(--muted)" stroke-width="3"/><text x="760" y="380" font-size="22" fill="var(--muted)">halve it on each check</text>
<text id="sortedN" x="1160" y="316" text-anchor="end" font-size="30">${worstBinary} checks</text></g>
<g id="hash"><text x="40" y="470" font-size="28">a hash table</text>${strip(490, 14)}
<path d="M40 600 Q300 650 460 545" fill="none" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/><text x="480" y="610" font-size="22" fill="var(--muted)">one jump, straight to it</text>
<text id="hashN" x="1160" y="526" text-anchor="end" font-size="30">about 1 check</text></g>
</svg>`;

// Scenes 2 to 5: two keys worked out on top, the eight slots below, and what each fix hangs off slot 0.
const SW = 120;
const SX = 150;
const SY = 330;
const sx = (i) => SX + i * SW;
const keyBoxes = (word, x0) =>
  [...word]
    .map(
      (c, i) =>
        `<rect x="${x0 + i * 90}" y="40" width="80" height="70" rx="8" stroke-width="3"/><text x="${x0 + i * 90 + 40}" y="88" text-anchor="middle" font-size="34" font-family="mono">${c}</text>`,
    )
    .join('');
const codes = (word, x0) =>
  [...word]
    .map((c, i) => `<text x="${x0 + i * 90 + 40}" y="146" text-anchor="middle" font-size="26">${code(c)}</text>`)
    .join('');
const keySide = (
  word,
  x0,
) => `<g id="${word}L"><text x="${x0}" y="28" font-size="24" fill="var(--muted)">key "${word}"</text>${keyBoxes(word, x0)}</g>
<g id="${word}C">${codes(word, x0)}</g>
<text id="${word}Sum" x="${x0}" y="196" font-size="26">${[...word].map(code).join(' + ')} = ${sum(word)}</text>
<text id="${word}Mod" x="${x0}" y="240" font-size="26">${sum(word)} mod 8 = ${slot(word, 8)}</text>`;
const slots = Array.from(
  { length: 8 },
  (_, i) =>
    `<g id="slot${i}"><rect x="${sx(i)}" y="${SY}" width="${SW - 8}" height="80" rx="8" stroke-width="3"/></g><text x="${sx(i) + (SW - 8) / 2}" y="${SY - 12}" text-anchor="middle" font-size="22" fill="var(--muted)">${i}</text>`,
).join('');
const inSlot = (id, i, word) =>
  `<text id="${id}" x="${sx(i) + (SW - 8) / 2}" y="${SY + 52}" text-anchor="middle" font-size="28" font-family="mono">${word}</text>`;
const node = (id, x, word) =>
  `<g id="${id}"><rect x="${x}" y="480" width="130" height="64" rx="8" stroke-width="3"/><text x="${x + 65}" y="522" text-anchor="middle" font-size="28" font-family="mono">${word}</text></g>`;
const hashPic = `<svg viewBox="0 0 1200 640">${defs}
${keySide('cat', 30)}
${keySide('act', 690)}
<text x="20" y="${SY + 50}" font-size="24" fill="var(--muted)">slots</text>
${slots}
${inSlot('catIn', slot('cat', 8), 'cat')}${inSlot('actIn', slot('act', 8) + 1, 'act')}
<path id="toCat" d="M120 252 Q120 290 ${sx(0) + 40} ${SY - 4}" fill="none" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/>
<path id="toAct" d="M780 252 Q600 300 ${sx(0) + 80} ${SY - 4}" fill="none" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/>
<g id="ptr0"><circle cx="${sx(0) + 56}" cy="${SY + 40}" r="8" fill="var(--text)" stroke="none"/><path d="M${sx(0) + 56} ${SY + 48} V472" fill="none" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/></g>
${node('nodeCat', sx(0) - 8, 'cat')}
<g id="link"><path d="M${sx(0) + 126} 512 H${sx(0) + 186}" fill="none" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/></g>
${node('nodeAct', sx(0) + 192, 'act')}
<g id="null"><path d="M${sx(0) + 326} 512 H${sx(0) + 386}" fill="none" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/><text x="${sx(0) + 396}" y="521" font-size="26" fill="var(--muted)" font-family="mono">null</text></g>
<path id="probe" d="M${sx(0) + 56} ${SY + 86} Q${sx(0) + 112} ${SY + 150} ${sx(1) + 50} ${SY + 88}" fill="none" stroke="var(--text)" stroke-width="3" marker-end="url(#head)"/>
<text id="rule" x="600" y="620" text-anchor="middle" font-size="26" fill="var(--muted)">h(key) = (sum of character codes) mod 8</text>
</svg>`;

// Scene 6: seven keys in eight slots, then in sixteen; each slot's list hangs below it.
const keys = ['cat', 'act', 'pig', 'owl', 'dog', 'ant', 'hen'];
const fill = (m) => {
  const t = Array.from({ length: m }, () => []);
  for (const k of keys) t[slot(k, m)].push(k);
  return t;
};
const t8 = fill(8);
const t16 = fill(16);
const longest = (t) => Math.max(...t.map((ks) => ks.length));
assert(longest(t8) === 3 && longest(t16) === 2, 'chains');
assert(t16[8].join() === 'cat,act', 'anagrams stay together');
assert(t8[0].join() === 'cat,act,pig', 'pig sits behind cat and act');
const table = (t, name, label, y, w) => {
  const cells = t
    .map(
      (_ks, i) =>
        `<g id="${name}s${i}"><rect x="${150 + i * w}" y="${y}" width="${w - 6}" height="52" rx="6" stroke-width="3"/></g><text x="${150 + i * w + (w - 6) / 2}" y="${y - 8}" text-anchor="middle" font-size="22" fill="var(--muted)">${i}</text>`,
    )
    .join('');
  const chains = t
    .flatMap((ks, i) =>
      ks.map(
        (k, d) =>
          `<g id="${name}${i}_${d}"><rect x="${150 + i * w + 3}" y="${y + 62 + d * 50}" width="${w - 12}" height="44" rx="6" stroke-width="2"/><text x="${150 + i * w + (w - 6) / 2}" y="${y + 92 + d * 50}" text-anchor="middle" font-size="22" font-family="mono">${k}</text></g>`,
      ),
    )
    .join('');
  return `<g id="${name}"><text x="20" y="${y + 36}" font-size="24" fill="var(--muted)">${label}</text>${cells}</g><g id="${name}Keys">${chains}</g>`;
};
const grow = `<svg viewBox="0 0 1200 640">
${table(t8, 'old', '8 slots', 44, 120)}
${table(t16, 'new', '16 slots', 340, 64)}
</svg>`;
const chainTint = (t, name) =>
  Object.fromEntries(t.flatMap((ks, i) => ks.map((_, d) => [`${name}${i}_${d}`, ks.length > 1 ? 'bad' : 'good'])));

// Scene 7: what each operation costs, as a handwritten table.
const ops = ['look up', 'insert', 'delete'];
const costs = `<svg viewBox="0 0 1200 640">
<text x="120" y="110" font-size="30" fill="var(--muted)">operation</text><text id="avgH" x="560" y="110" font-size="30" fill="var(--muted)">on average</text><text id="worstH" x="880" y="110" font-size="30" fill="var(--muted)">worst case</text>
<line x1="100" y1="140" x2="1100" y2="140" stroke="var(--muted)" stroke-width="3"/><line x1="520" y1="60" x2="520" y2="520" stroke="var(--muted)" stroke-width="3"/><line x1="840" y1="60" x2="840" y2="520" stroke="var(--muted)" stroke-width="3"/>
${ops
  .map(
    (op, i) =>
      `<text x="120" y="${230 + i * 110}" font-size="34">${op}</text><text id="avg${i}" x="600" y="${230 + i * 110}" font-size="34" font-family="mono">O(1)</text><text id="worst${i}" x="920" y="${230 + i * 110}" font-size="34" font-family="mono">O(n)</text>`,
  )
  .join('')}
</svg>`;

const cat = [...'cat'];
const scenes = [];
scenes.push({
  type: 'svg',
  chapter: 'The problem of scale',
  title: 'Finding one number among 10 million',
  svg: scale,
  hidden: ['sorted', 'hash'],
  labels: {
    any: 'a list with no order',
    anyN: 'ten million',
    sorted: 'sort the list',
    sortedN: 'twenty four checks',
    hash: 'hash table',
  },
  narration:
    'Say you keep ten million phone numbers, and you need to find one of them, again and again, thousands of times a second.',
  steps: [
    { focus: ['any', 'anyN'], say: 'In a list with no order, you may have to check every one of the ten million.' },
    {
      show: ['sorted'],
      focus: 'sorted',
      say: 'Sort the list and you can halve it on each check, so twenty four checks are enough.',
    },
    {
      focus: 'sortedN',
      say: 'That is fast. But when a busy system does this thousands of times a second, even twenty four checks add up.',
    },
    {
      show: ['hash'],
      focus: 'hash',
      tint: { hashN: 'good' },
      say: 'What we want is one jump, straight to the spot where the number lives.',
    },
    {
      focus: 'hashN',
      say: 'No scanning, no halving. That is what a hash table gives you.',
      draw: [{ circle: 'hashN', tone: 'good', when: 'hash table' }],
    },
  ],
});

const hashParts = [
  'catC',
  'catSum',
  'catMod',
  'catIn',
  'toCat',
  'actL',
  'actC',
  'actSum',
  'actMod',
  'actIn',
  'toAct',
  'ptr0',
  'nodeCat',
  'link',
  'nodeAct',
  'null',
  'probe',
];
const hiddenBut = (...ids) => hashParts.filter((id) => !ids.includes(id));
scenes.push({
  type: 'svg',
  chapter: 'The hash function',
  title: 'Working out where "cat" goes',
  picture: 'hash',
  hidden: hiddenBut(),
  labels: {
    catL: 'cat',
    catC: 'number',
    catSum: 'add them up',
    catMod: 'remainder',
    slot0: 'slot zero',
    toCat: 'same sum',
    rule: 'hash function',
  },
  narration:
    'The trick is to work out the spot from the key itself. The rule that does this is called a hash function.',
  steps: [
    { focus: 'catL', say: 'Our key is the word cat.' },
    {
      show: ['catC'],
      focus: 'catC',
      say: `Every letter is stored as a number. C is ${code('c')}, a is ${code('a')}, and t is ${code('t')}.`,
    },
    { show: ['catSum'], focus: 'catSum', say: `Add them up, and you get ${sum('cat')}.` },
    {
      show: ['catMod'],
      focus: ['catMod', 'slot0', 'slot7'],
      say: `The table has only eight slots, so we keep the remainder after dividing by eight. ${sum('cat')} divided by eight leaves ${slot('cat', 8)}.`,
    },
    {
      show: ['toCat', 'catIn'],
      focus: ['catL', 'toCat', 'slot0', 'catIn'],
      tint: { slot0: 'good' },
      say: 'So cat goes in slot zero.',
    },
    {
      focus: ['rule', 'slot0', 'toCat'],
      say: 'To find cat later, we do not search. We do the same sum, get zero again, and read slot zero.',
      draw: [{ write: `h("cat") = ${slot('cat', 8)}`, near: 'toCat', side: 'right', tone: 'good', when: 'same sum' }],
    },
  ],
});

scenes.push({
  type: 'svg',
  chapter: 'A collision',
  title: '"act" lands on the same slot',
  picture: 'hash',
  labels: {
    actL: 'act',
    actSum: 'sum',
    actMod: 'remainder',
    toAct: 'points at slot zero',
    slot0: 'cat is already there',
    slot7: 'eight slots',
  },
  narration: 'Now add a second word, act.',
  steps: [
    {
      show: ['actL', 'actC', 'actSum'],
      focus: ['actL', 'actSum'],
      say: `It has the same letters as the first word, in a different order, so its sum is also ${sum('act')}.`,
    },
    {
      show: ['actMod', 'toAct'],
      focus: ['actL', 'actMod', 'toAct'],
      say: 'And the remainder is zero again, so act points at slot zero.',
    },
    {
      tint: { slot0: 'bad' },
      focus: 'slot0',
      say: 'But cat is already there. Two different keys want the same slot. This is called a collision.',
      draw: [{ write: 'collision', near: 'slot0', side: 'below', tone: 'bad', when: 'collision' }],
    },
    {
      focus: ['slot0', 'slot7'],
      erase: true,
      say: 'You cannot avoid it. There are endless possible words, and only eight slots.',
      draw: [{ brace: ['slot0', 'slot7'], note: 'endless words, 8 slots', side: 'below', when: 'endless' }],
    },
    {
      focus: 'slot0',
      say: 'Put ten pigeons in nine holes, and some hole gets two.',
    },
  ],
});

scenes.push({
  type: 'svg',
  chapter: 'Fix one: chaining',
  title: 'Each slot holds a short list',
  picture: 'hash',
  labels: { ptr0: 'points at a node', nodeCat: 'cat', nodeAct: 'act', link: 'joins the end', slot0: 'slot zero' },
  narration: 'The first fix is called chaining.',
  steps: [
    {
      hide: ['catIn'],
      show: ['ptr0', 'nodeCat'],
      tint: { slot0: 'clear', nodeCat: 'good' },
      focus: ['slot0', 'ptr0', 'nodeCat'],
      say: 'Each slot holds the start of a small linked list instead of one key. Slot zero points at a node holding cat.',
    },
    {
      show: ['link', 'nodeAct', 'null'],
      tint: { nodeAct: 'good' },
      focus: ['link', 'nodeAct'],
      say: 'When act collides with it, act just joins the end of that list.',
    },
    {
      focus: ['slot0', 'nodeCat', 'nodeAct'],
      say: 'To find act, jump to slot zero, then walk the list until you meet act. Here that is two checks.',
      draw: [{ write: 'find "act": 2 checks', near: 'null', side: 'right', when: 'walk the list' }],
    },
  ],
});

scenes.push({
  type: 'svg',
  chapter: 'Fix two: open addressing',
  title: 'Take the next free slot',
  picture: 'hash',
  hidden: hiddenBut('catC', 'catSum', 'catMod', 'catIn', 'toCat', 'actL', 'actC', 'actSum', 'actMod', 'toAct'),
  tint: { slot0: 'good' },
  labels: {
    toAct: 'its hash',
    slot0: 'slot zero',
    slot1: 'slot one',
    probe: 'steps to the next slot',
    actIn: 'act goes there',
  },
  narration: 'The second fix is called open addressing. Every key lives in the table itself.',
  steps: [
    { focus: ['toAct', 'slot0'], say: 'Act starts at slot zero, its hash.' },
    { tint: { slot0: 'bad' }, focus: 'slot0', say: 'Slot zero is taken by cat.' },
    {
      trace: ['probe'],
      show: ['actIn'],
      tint: { slot0: 'good', slot1: 'good' },
      focus: ['probe', 'slot1', 'actIn'],
      say: 'So it steps to the next slot, slot one, which is free, and act goes there.',
    },
    {
      focus: ['slot0', 'slot1'],
      say: 'To find act later, start at slot zero, see cat, and step along until you meet act or an empty slot.',
      draw: [{ write: 'find "act": slot 0, then slot 1', near: 'slot1', side: 'below', when: 'step along' }],
    },
  ],
});

scenes.push({
  type: 'svg',
  chapter: 'Load factor',
  title: 'When the table gets crowded',
  svg: grow,
  hidden: ['new', 'newKeys'],
  labels: {
    old: 'seven keys sit in eight slots',
    olds0: 'slot zero',
    new: 'sixteen',
    newKeys: 'every key is hashed again',
    old0_2: 'pig',
  },
  narration:
    'With chaining, the danger is a crowded table. Here seven keys sit in eight slots, and each list hangs below its slot.',
  steps: [
    {
      focus: ['old', 'oldKeys'],
      say: 'The load factor is the number of keys divided by the number of slots. Seven over eight is zero point eight seven five.',
      draw: [
        {
          write: `α = ${keys.length} / 8 = ${keys.length / 8}`,
          near: 'olds7',
          side: 'right',
          when: 'seven over eight',
        },
      ],
    },
    {
      tint: chainTint(t8, 'old'),
      focus: ['olds0', 'old0_2'],
      say: `The keys do not spread out evenly, so the lists grow. Slot zero holds ${t8[0].length} keys.`,
    },
    {
      focus: ['old0_0', 'old0_1', 'old0_2'],
      say: 'Finding pig means walking past the two keys in front of it.',
      draw: [{ circle: 'old0_2', when: 'pig' }],
    },
    {
      show: ['new'],
      tint: { old: 'dim', oldKeys: 'dim' },
      focus: 'new',
      erase: true,
      say: 'So the table grows. We make a new one with twice the slots, sixteen.',
    },
    {
      show: ['newKeys'],
      tint: chainTint(t16, 'new'),
      focus: ['new', 'newKeys'],
      say: 'Then every key is hashed again, with the remainder after dividing by sixteen, and moves to its new slot.',
      draw: [
        {
          write: `α = ${keys.length} / 16 ≈ ${(keys.length / 16).toFixed(2)}`,
          near: 'new0_0',
          side: 'below',
          tone: 'good',
          when: 'sixteen',
        },
      ],
    },
    {
      focus: ['new8_0', 'new8_1'],
      say: 'Most lists shrink to one key. But cat and act still share slot eight, because their sums are equal whatever the size.',
      draw: [
        {
          write: `${sum('cat')} mod 16 = ${slot('cat', 16)}`,
          near: 'new8_1',
          side: 'below',
          tone: 'bad',
          when: 'slot eight',
        },
      ],
    },
    {
      focus: 'newKeys',
      say: 'Real hash functions mix in the order of the letters, so this happens far less.',
    },
  ],
});

scenes.push({
  type: 'svg',
  chapter: 'The guarantee',
  title: 'What a hash table costs',
  svg: costs,
  labels: { avgH: 'on average', worstH: 'worst case', avg1: 'insert' },
  narration: 'Many tables grow once the load factor passes about two thirds to three quarters.',
  steps: [
    {
      focus: ['avg0', 'avg1', 'avg2'],
      say: 'Then the lists stay short, and every operation is one jump plus a check or two.',
    },
    {
      focus: 'avgH',
      tint: { avg0: 'good', avg1: 'good', avg2: 'good' },
      say: 'On average, looking up, adding and removing all take the same short time, however big the table gets.',
    },
    {
      focus: ['worstH', 'worst0', 'worst1', 'worst2'],
      tint: { worst0: 'bad', worst1: 'bad', worst2: 'bad' },
      say: 'The worst case is every key in one slot, which a good hash function makes very unlikely.',
    },
    {
      focus: ['avgH', 'avg1'],
      say: 'Growing the table is slow when it happens, but it happens so rarely that it adds only a little to each insert on average.',
      draw: [
        { write: 'growing: rare, so cheap on average', near: 'avg2', side: 'below', tone: 'good', when: 'so rarely' },
      ],
    },
    {
      focus: ['avg0', 'avg1', 'avg2'],
      say: 'That is how dictionaries, database indexes and caches answer in an instant.',
    },
  ],
});

// The arithmetic on the board is the toy hash's.
assert(hashPic.includes(`${cat.map(code).join(' + ')} = 312`) && hashPic.includes('312 mod 8 = 0'), 'cat on the board');

fs.writeFileSync(
  new URL('./storyboard.json', import.meta.url),
  JSON.stringify(
    {
      title: 'Hash tables',
      subtitle: 'Turning a key into an address',
      tones: { good: 'a key in its own place', bad: 'two keys after the same place' },
      pictures: { hash: hashPic },
      scenes,
    },
    null,
    2,
  ) + '\n',
);
