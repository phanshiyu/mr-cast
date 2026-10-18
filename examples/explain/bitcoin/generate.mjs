// Writes storyboard.json beside this file. Hashes, signatures and probabilities are computed here. The three mined
// blocks (nonce and hash each) are read from facts.json, which mine.mjs wrote: it searched for nonces whose SHA-256
// starts with 30 zero bits, which took about 12 minutes on every core of a laptop. Every block is re-hashed and
// checked below. Run: node examples/explain/bitcoin/generate.mjs
import fs from 'node:fs';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
const chain = JSON.parse(fs.readFileSync(new URL('./facts.json', import.meta.url), 'utf8'));
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const blockText = (prev, txs, nonce) => `prev: ${prev}\n${txs.join('\n')}\nnonce: ${nonce}`;
const bin32 = (hex) => parseInt(hex.slice(0, 8), 16).toString(2).padStart(32, '0');
const zeroBits = (hex) => {
  const b = [...hex].map((c) => parseInt(c, 16).toString(2).padStart(4, '0')).join('');
  return b.indexOf('1');
};
const bytes = (b) => b.match(/.{8}/g).join(' ');
const N = (n) => n.toLocaleString('en-US');
const short = (h) => `${h.slice(0, 12)}…`;
for (const [i, b] of chain.entries()) {
  assert(sha(blockText(b.prev, b.txs, b.nonce)) === b.hash, `block ${i + 1} hash`);
  assert(zeroBits(b.hash) >= 30, `block ${i + 1} work`);
  assert(b.prev === (i ? chain[i - 1].hash : '0'.repeat(64)), `block ${i + 1} link`);
}

// Signatures: a fixed Ed25519 key, so every run prints the same signatures.
const seed = createHash('sha256').update('alice, example key').digest();
const sk = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  format: 'der',
  type: 'pkcs8',
});
const pk = createPublicKey(sk);
const sigOf = (m) => sign(null, Buffer.from(m), sk).toString('hex');
const valid = (m, s) => verify(null, Buffer.from(m), pk, Buffer.from(s, 'hex'));
const s100 = sigOf('Alice pays Bob $100'),
  s101 = sigOf('Alice pays Bob $101'),
  s342 = sigOf('#342 Alice pays Bob $100');
assert(s100.length * 4 === 512 && seed.length * 8 === 256, 'sizes');
assert(!valid('Alice pays Bob $900', s100) && valid('Alice pays Bob $100', s100), 'verify');
const sig16 = (s) => `\`${s.slice(0, 16)}…\``;

const scenes = [];

scenes.push({
  type: 'text',
  chapter: 'The question',
  narration: 'What does it mean to own a bitcoin?',
  kicker: 'How Bitcoin works',
  question: 'What does it mean to own a bitcoin?',
});

scenes.push({
  type: 'table',
  chapter: 'A shared list',
  title: 'Who paid whom',
  narration:
    'Start with something simpler. A few friends pay for each other’s dinners, and they keep one shared list of who paid whom.',
  columns: ['Who', 'Pays whom', 'Amount'],
  rows: [
    { cells: ['Alice', 'Bob', '$20'] },
    { cells: ['Bob', 'Charlie', '$40'], hidden: true },
    { cells: ['Charlie', 'Alice', '$10'], hidden: true },
    { cells: ['Alice', 'Bob', '$100'], hidden: true, badge: 'fake', tone: 'bad' },
  ],
  steps: [
    { focus: 0, say: 'Alice pays Bob twenty dollars, so she writes it down.' },
    { show: [1, 2], say: 'More lines go on the list as the month goes by.' },
    {
      focus: [0, 1, 2],
      callout: 'Alice −$10 · Bob −$20 · Charlie +$30',
      say: 'At the end of the month they settle up. Whoever is down puts cash in a pot, and whoever is up takes cash out.',
    },
    {
      show: [3],
      tint: { 3: 'bad' },
      callout: '[who wrote this line?]{bad}',
      say: 'But anyone can add a line. What stops Bob from writing that Alice pays him a hundred dollars?',
    },
  ],
});

scenes.push({
  type: 'flow',
  chapter: 'Signatures',
  title: 'Sign with a secret, check in public',
  narration:
    'The fix is a digital signature. Each person makes a pair of keys: a secret key they never share, and a public key everyone can see.',
  steps: [
    {
      actor: 'Alice',
      action: 'signs the line with her secret key',
      payload: `Sign("Alice pays Bob $100", secret key) → ${s100.slice(0, 16)}…`,
      icon: 'key-round',
      say: 'Alice runs her line and her secret key through a signing function. Out comes a signature, a string of five hundred and twelve bits.',
    },
    {
      actor: 'Anyone',
      action: 'checks it with her public key',
      payload: 'Verify(line, signature, public key) → true',
      icon: 'badge-check',
      tone: 'good',
      say: 'Anyone can check that signature against the line and Alice’s public key. The answer is true.',
    },
    {
      actor: 'Bob',
      action: 'changes $100 to $900',
      payload: 'Verify(changed line, same signature, public key) → false',
      icon: 'user',
      tone: 'bad',
      say: 'If Bob changes the line, the old signature no longer fits, and the check says false. Without Alice’s secret key, he cannot make a new one.',
    },
  ],
});

scenes.push({
  type: 'table',
  chapter: 'Copies and IDs',
  title: 'Real signatures, first 64 of 512 bits',
  narration: 'Here are real signatures made with one secret key. Watch what happens when the line changes.',
  columns: ['Line', 'Signature', 'Check'],
  rows: [
    { cells: ['Alice pays Bob $100', sig16(s100), 'valid'] },
    { cells: ['Alice pays Bob $101', sig16(s101), 'valid'], hidden: true },
    { cells: ['Alice pays Bob $900', sig16(s100), 'fails'], hidden: true },
    { cells: ['Alice pays Bob $100', sig16(s100), 'valid, a copy'], hidden: true },
    { cells: ['#342 Alice pays Bob $100', sig16(s342), 'valid'], hidden: true },
    { cells: ['#342 Alice pays Bob $100', sig16(s342), 'ID used already'], hidden: true },
  ],
  steps: [
    { focus: 'Signature@0', say: 'This is Alice’s signature for paying Bob a hundred dollars.' },
    {
      show: [1],
      focus: ['Signature@0', 'Signature@1'],
      say: 'Change one character, a hundred to a hundred and one, and the signature looks completely different.',
    },
    { show: [2], tint: { 2: 'bad' }, say: 'Put the old signature on a changed line, and the check fails.' },
    {
      show: [3],
      tint: { 3: 'warn' },
      callout: '[same line, same signature]{warn}',
      say: 'But Bob can still copy the whole signed line, word for word. The copy checks out, so Alice would pay him twice.',
    },
    {
      show: [4],
      tint: { 3: 'dim', 4: 'good' },
      callout: 'every line gets a unique ID',
      say: 'So every line gets a number of its own, and the signature covers that number too.',
    },
    {
      show: [5],
      tint: { 5: 'bad' },
      callout: '',
      say: 'Now a copy carries a number that is already on the list, and everyone ignores it.',
    },
  ],
});

// Ledger dollars: everyone starts with 100, and a line counts only if its payer can cover it.
const bal = { Alice: 100, Bob: 100, Charlie: 100, David: 100 };
const pays = [
  ['Charlie', 'Alice', 60],
  ['Charlie', 'Bob', 40],
  ['Alice', 'David', 20],
  ['Charlie', 'David', 30],
];
const ledgerSteps = [];
const sayPay = [
  'Charlie pays Alice sixty. He can cover it, so the line counts, and he has forty left.',
  'Charlie pays Bob forty. That leaves him with nothing.',
  'Alice pays David twenty. She has plenty.',
];
pays.forEach(([from, to, amt], i) => {
  if (bal[from] >= amt) {
    bal[from] -= amt;
    bal[to] += amt;
    ledgerSteps.push({
      show: [`row:${i}`, `${from}->${to}`],
      set: { [from]: String(bal[from]), [to]: String(bal[to]), [`OK?@${i}`]: 'yes' },
      callout: `${from} ${bal[from] + amt} − ${amt} = ${bal[from]}`,
      say: sayPay[i],
    });
  } else {
    assert(from === 'Charlie' && bal.Charlie === 0, 'rejection');
    ledgerSteps.push({
      show: [`row:${i}`, `${from}->${to}`],
      tint: { [`row:${i}`]: 'bad', [`${from}->${to}`]: 'bad' },
      set: { [`OK?@${i}`]: 'no' },
      callout: `[Charlie has ${bal.Charlie}, not ${amt}]{bad}`,
      say: 'Then Charlie tries to pay David thirty. Read the list from the top, and he has nothing left, so everyone rejects that line.',
    });
  }
});
assert(bal.Alice === 140 && bal.Bob === 140 && bal.Charlie === 0 && bal.David === 120, 'balances');
scenes.push({
  type: 'graph',
  chapter: 'Ledger dollars',
  layout: 'TB',
  narration:
    'Signatures stop fake lines, but not debt. Charlie could run up a huge bill and vanish. So add a rule: everyone starts with a hundred, and a line counts only if the list shows the payer has the money.',
  nodes: Object.keys(bal).map((id) => ({ id, label: id, icon: 'user', badge: '100' })),
  edges: pays.map(([from, to, amt]) => ({ from, to, label: String(amt), hidden: true })),
  table: {
    columns: ['ID', 'Payment', 'OK?'],
    rows: pays.map(([from, to, amt], i) => ({
      cells: [`#${i + 1}`, `${from} pays ${to} ${amt} LD`, '?'],
      hidden: true,
    })),
  },
  callout: 'everyone starts with 100 LD',
  steps: [
    ...ledgerSteps,
    {
      focus: ['Alice', 'Bob', 'Charlie', 'David'],
      callout: 'the history is the money',
      say: 'Notice that nobody holds any dollars now. The money is just the list, so call it ledger dollars. Owning some means the history says you have them.',
    },
  ],
});

// Many copies of the list, and lines that arrive in different orders.
const W = 1280,
  H = 600,
  cw = 290,
  gap = 30;
const people = ['Alice', 'Bob', 'Charlie', 'David'];
const order = { Alice: ['#7', '#8'], Bob: ['#7', '#8'], Charlie: ['#8', '#7'], David: ['#8', '#7'] };
const lineText = { '#7': '#7 Alice pays Bob 10', '#8': '#8 David pays Charlie 5' };
const cx = (i) => 20 + i * (cw + gap);
const cards = people
  .map((p, i) => {
    const x = cx(i),
      id = p.toLowerCase();
    return (
      `<g id="card-${id}"><rect x="${x}" y="230" width="${cw}" height="340" rx="16"/>` +
      `<text x="${x + cw / 2}" y="278" text-anchor="middle" font-size="28">${p}’s copy</text>` +
      `<text x="${x + 22}" y="340" font-size="22" fill="var(--muted)">#6 Bob pays David 2</text>` +
      `<text id="${id}-a" x="${x + 22}" y="395" font-size="22"> </text>` +
      `<text id="${id}-b" x="${x + 22}" y="450" font-size="22"> </text></g>`
    );
  })
  .join('');
const arrows = [1, 2, 3]
  .map(
    (j) =>
      `<path d="M ${cx(0) + cw / 2} 230 Q ${(cx(0) + cx(j)) / 2 + cw / 2} ${150 - j * 20} ${cx(j) + cw / 2} 226" fill="none" stroke="var(--accent)" stroke-width="4" marker-end="url(#head)"/>`,
  )
  .join('');
const svg =
  `<svg viewBox="0 0 ${W} ${H}"><defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" stroke="none"/></marker></defs>` +
  `<g id="site"><rect x="${W / 2 - 170}" y="20" width="340" height="80" rx="14"/><text x="${W / 2}" y="70" text-anchor="middle" font-size="28">one website keeps the list</text></g>` +
  `<g id="cross" stroke="var(--bad)" stroke-width="7" stroke-linecap="round"><line x1="${W / 2 - 180}" y1="14" x2="${W / 2 + 180}" y2="106"/><line x1="${W / 2 + 180}" y1="14" x2="${W / 2 - 180}" y2="106"/></g>` +
  cards +
  `<g id="broadcast">${arrows}</g></svg>`;
const fillCopies = (k) =>
  Object.fromEntries(people.map((p) => [`${p.toLowerCase()}-${k === 0 ? 'a' : 'b'}`, lineText[order[p][k]]]));
scenes.push({
  type: 'svg',
  chapter: 'No one in charge',
  title: 'Everyone keeps a copy',
  narration: 'So far one website holds the list. But then you have to trust whoever runs it.',
  svg,
  hidden: ['cross', 'broadcast'],
  labels: { site: 'website', broadcast: 'broadcast', 'card-charlie': 'Charlie’s copy', 'card-david': 'David’s copy' },
  steps: [
    {
      show: ['cross'],
      focus: ['site', 'card-alice', 'card-bob', 'card-charlie', 'card-david'],
      say: 'So drop the website. Instead, everyone keeps their own copy of the list.',
    },
    {
      show: ['broadcast'],
      focus: ['broadcast', 'card-alice'],
      callout: 'Alice broadcasts “#7 Alice pays Bob 10”',
      say: 'To pay Bob, Alice broadcasts her signed line to everyone, and each person adds it to their copy.',
    },
    {
      set: { ...fillCopies(0) },
      tint: { 'card-charlie': 'warn', 'card-david': 'warn' },
      say: 'But messages take time to travel. At the same moment, David sends a line of his own, and Charlie and David get his line first.',
    },
    {
      set: { ...fillCopies(1) },
      callout: '[two orders, no one in charge]{warn}',
      focus: ['card-alice', 'card-bob', 'card-charlie', 'card-david'],
      say: 'Now the copies disagree about the order. With no one in charge, how does everyone agree on one history?',
    },
  ],
});

const hh = sha('Hello'),
  hl = sha('hello');
assert(hh.startsWith('185f8db3') && hl.startsWith('2cf24dba'), 'hello hashes');
const hex2 = (h) => `\`${h.slice(0, 32).match(/.{8}/g).join(' ')}\` \`${h.slice(32).match(/.{8}/g).join(' ')}\``;
scenes.push({
  type: 'table',
  chapter: 'Hashes',
  title: 'Any text in, 256 bits out',
  narration:
    'The answer needs one more tool, a hash function called SHA-256. It takes any text, short or long, and gives back two hundred and fifty six bits, written here as sixty four hex digits.',
  columns: ['Text', 'SHA-256'],
  rows: [{ cells: ['Hello', hex2(hh)] }, { cells: ['hello', hex2(hl)], hidden: true }],
  steps: [
    { focus: 0, say: 'This is the hash of Hello, with a capital H.' },
    {
      show: [1],
      say: 'Change just that one letter to lower case, and the whole result changes. Nothing about it is close to the first.',
    },
    {
      focus: 'SHA-256@1',
      callout: 'reversing it: about 2²⁵⁶ guesses',
      say: 'And there is no way back. To find text with a given hash, all you can do is guess, and the guesses would outlast the universe.',
    },
  ],
});

const b1 = chain[0];
const tries = [0, 1, 2, 3].map((n) => {
  const h = sha(blockText(b1.prev, b1.txs, n));
  return { n, h, z: zeroBits(h) };
});
assert(tries.every((t) => t.z < 30) && tries[1].z === 7, 'first tries');
scenes.push({
  type: 'table',
  chapter: 'Proof of work',
  title: 'Hunting for 30 zeros',
  narration:
    'Now a puzzle. Take a batch of lines, add a number called a nonce, and hash the lot. The goal is a hash that starts with thirty zero bits.',
  columns: ['Nonce', 'First 32 bits of the hash', 'Zeros'],
  rows: [
    ...tries.map((t, i) => ({
      cells: [String(t.n), `\`${bytes(bin32(t.h))}\``, String(t.z)],
      ...(i ? { hidden: true } : {}),
    })),
    { cells: [N(b1.nonce), `\`${bytes(bin32(b1.hash))}\``, String(zeroBits(b1.hash))], hidden: true },
  ],
  callout: 'SHA-256(lines + nonce) starts with 30 zero bits?',
  steps: [
    { focus: 0, say: `With a nonce of zero, the hash starts with only ${tries[0].z} zero bit.` },
    { show: [1, 2, 3], say: 'So try one, then two, then three. Each guess gives a hash that looks random.' },
    {
      show: [4],
      tint: { 4: 'good' },
      callout: `[${N(b1.nonce)} → ${zeroBits(b1.hash)} zeros]{good}`,
      say: 'Our computer kept going for a few minutes, and this number finally worked. Each bit halves the odds, so thirty zeros takes about two to the thirty guesses, around a billion.',
    },
    {
      focus: 'Nonce@4',
      callout: '1 hash to check it',
      say: 'Finding it is slow, but checking it is fast. Anyone can hash the lines with this nonce once and see the zeros.',
    },
  ],
});

const tampered = ['#1 Alice pays Bob 100 LD', ...b1.txs.slice(1)];
const th = sha(blockText(b1.prev, tampered, b1.nonce));
assert(zeroBits(th) < 30, 'tampered block fails the puzzle');
const blocks = chain.map((_, i) => ({ id: `b${i + 1}`, i }));
scenes.push({
  type: 'graph',
  chapter: 'A chain of blocks',
  layout: 'TB',
  narration:
    'Lines are grouped into blocks. A block counts only if it solves the puzzle, and each block starts with the hash of the block before it. That links them into a chain.',
  nodes: blocks.map(({ id, i }) => ({
    id,
    label: `Block ${i + 1}`,
    shape: 'step',
    caption: `${chain[i].txs.length} payments · nonce ${N(chain[i].nonce)}`,
  })),
  edges: blocks.slice(1).map(({ id, i }) => ({ from: `b${i}`, to: id, label: 'prev hash' })),
  table: {
    columns: ['Block', 'Prev', 'Hash'],
    rows: chain.map((b, i) => ({ cells: [String(i + 1), i ? short(b.prev) : '0000…', short(b.hash)] })),
  },
  steps: [
    { focus: ['b1', 'Hash@0'], say: 'Block one’s hash starts with the zeros its nonce bought.' },
    {
      focus: ['b1->b2', 'b2', 'Prev@1'],
      say: 'Block two writes that hash at its top. So does every block after, about the one before it.',
    },
    {
      set: { b1: 'edited', 'Hash@0': { before: short(b1.hash), after: short(th) } },
      tint: { b1: 'bad', 'row:0': 'bad' },
      callout: '“Alice pays Bob 10” → “100”',
      say: 'Now say someone changes an old line in block one, ten to a hundred. Its hash changes completely, and no longer starts with zeros.',
    },
    {
      tint: { 'b1->b2': 'bad' },
      focus: ['b1->b2', 'Prev@1', 'Hash@0'],
      callout: '[block 2’s prev no longer matches]{bad}',
      say: 'Block two still points at the old hash, so the link is broken, and everyone can see it.',
    },
    {
      tint: { b2: 'warn', b3: 'warn' },
      focus: ['b1', 'b2', 'b3'],
      callout: 'redo the work for every later block',
      say: 'To hide the change, the cheat must solve the puzzle again for block one, then for every block after it.',
    },
  ],
});

scenes.push({
  type: 'graph',
  chapter: 'Miners',
  layout: 'LR',
  narration:
    'People called miners collect the lines everyone broadcasts and race to solve the puzzle for the next block.',
  nodes: [
    { id: 'b3', label: 'Block 3', shape: 'step', caption: 'everyone agrees' },
    { id: 'b4a', label: 'Block 4', shape: 'step', caption: 'first line: 10 LD to miner Maya', hidden: true },
    { id: 'b4b', label: 'Block 4', shape: 'step', caption: 'first line: 10 LD to miner Omar', hidden: true },
    { id: 'b5', label: 'Block 5', shape: 'step', caption: 'built on Maya’s block 4', hidden: true },
  ],
  edges: [
    { from: 'b3', to: 'b4a', hidden: true },
    { from: 'b3', to: 'b4b', hidden: true },
    { from: 'b4a', to: 'b5', hidden: true },
  ],
  steps: [
    {
      show: ['b4a', 'b3->b4a'],
      callout: 'reward: new money, from nothing',
      say: 'Maya solves it first. The first line of her block pays her ten ledger dollars out of thin air. That reward is the only way new money appears.',
    },
    {
      show: ['b4b', 'b3->b4b'],
      tint: { b4a: 'warn', b4b: 'warn' },
      callout: '[two chains, equal length]{warn}',
      say: 'But Omar solved a different block four at nearly the same moment. Now there are two chains of the same length.',
    },
    {
      show: ['b5', 'b4a->b5'],
      tint: { b4a: 'good', b5: 'good', b4b: 'dim' },
      callout: 'rule: follow the longest chain',
      say: 'The next miner happens to build on Maya’s block. That chain is longer now, and the rule is simple: everyone follows the longest chain. Omar’s block is dropped, and its lines go back into the pool.',
    },
  ],
});

// Nakamoto's whitepaper, section 11: the chance an attacker with share q of the hashing ever catches up from z behind.
const catchUp = (q, z) => {
  const p = 1 - q,
    lam = z * (q / p);
  let s = 1;
  for (let k = 0; k <= z; k++) {
    let po = Math.exp(-lam);
    for (let i = 1; i <= k; i++) po *= lam / i;
    s -= po * (1 - (q / p) ** (z - k));
  }
  return s;
};
const zs = [0, 1, 2, 3, 4, 5, 6];
const pct = zs.map((z) => Number((catchUp(0.1, z) * 100).toPrecision(3)));
assert(pct[1] === 20.5 && pct[6] === 0.0243, `whitepaper numbers ${pct}`);
scenes.push({
  type: 'chart',
  chapter: 'Double spending',
  title: 'Chance a cheat with a tenth of the computing power catches up',
  kind: 'bar',
  unit: '%',
  better: 'lower',
  narration:
    'Here is the attack. Alice pays Bob in one block, while secretly building another chain where that payment never happened. If her chain gets longer, everyone switches to it, and her money comes back.',
  labels: zs.map((z) => `${z} block${z === 1 ? '' : 's'}`),
  series: [{ name: 'chance', values: pct }],
  annotation: { at: '6 blocks', text: 'about 2 in 10,000' },
  steps: [
    {
      focus: '0 blocks',
      say: 'But her one machine races everyone else’s together. Say she has a tenth of all the computing power.',
    },
    {
      focus: '1 block',
      say: 'If Bob waits for one block on top of his payment, her chance of ever catching up is about one in five.',
    },
    {
      focus: '6 blocks',
      say: 'Each extra block makes it much smaller. After six blocks it is about two in ten thousand. So Bob waits a few blocks before he trusts the payment.',
    },
  ],
});

// Halvings: the reward starts at 50 and halves every 210,000 blocks. The years are when each halving block was mined.
const eras = [
  ['2009', 0],
  ['2012', 210_000],
  ['2016', 420_000],
  ['2020', 630_000],
  ['2024', 840_000],
].map(([y, h], i) => ({ y, h, r: 50 / 2 ** i }));
assert(eras.at(-1).r === 3.125, 'reward today');
const cap = (() => {
  let r = 50 * 1e8,
    t = 0;
  while (r > 0) {
    t += 210000 * r;
    r = Math.floor(r / 2);
  }
  return t / 1e8;
})();
assert(cap === 20999999.9769, 'supply cap');
scenes.push({
  type: 'table',
  chapter: 'Bitcoin itself',
  title: 'The reward halves',
  narration:
    'That is Bitcoin. The network adjusts the puzzle every two thousand and sixteen blocks, about two weeks, so a new block comes about every ten minutes.',
  columns: ['Year', 'From block', 'Reward per block'],
  rows: eras.map(({ y, h, r }, i) => ({ cells: [y, N(h), `${r} BTC`], ...(i ? { hidden: true } : {}) })),
  steps: [
    { focus: 0, say: 'In two thousand and nine, each block paid its miner fifty bitcoin.' },
    {
      show: [1, 2, 3],
      say: 'Every two hundred and ten thousand blocks, about four years, the reward halves. Twenty five, then twelve and a half, then six and a quarter.',
    },
    {
      show: [4],
      tint: { 4: 'accent' },
      callout: `all ever made: ${N(cap)} BTC`,
      say: 'Since twenty twenty four it is three point one two five. Add up every halving and the total stops just short of twenty one million bitcoin.',
    },
    {
      focus: 'col:Reward per block',
      callout: 'plus fees, for a spot in a full block',
      say: 'Blocks also have a size limit, so people add a small fee to their line, and miners pick the lines that pay them best. As the reward shrinks, fees pay more of the miners’ bills.',
    },
  ],
});

scenes.push({
  type: 'table',
  chapter: 'Recap',
  title: 'One tool for each problem',
  narration: 'Each problem we hit along the way got one tool.',
  columns: ['Problem', 'Tool'],
  rows: [
    { cells: ['Anyone can write a fake line', 'Signatures, from a secret key'] },
    { cells: ['A signed line can be copied', 'A unique ID on every line'] },
    { cells: ['People spend money they do not have', 'The history is the money'] },
    { cells: ['Copies disagree, and no one is in charge', 'Proof of work, and the longest chain wins'] },
    { cells: ['Someone rewrites an old block', 'Redoing the work is too expensive'] },
  ],
  steps: [
    { focus: [0, 1], say: 'Signatures and IDs stop fake and copied lines.' },
    { focus: 2, say: 'The shared history decides who owns what.' },
    {
      focus: [3, 4],
      say: 'And proof of work, with the longest chain, lets strangers agree on one history without anyone in charge.',
    },
  ],
});

fs.writeFileSync(
  new URL('./storyboard.json', import.meta.url),
  JSON.stringify(
    { title: 'How Bitcoin works', subtitle: 'Building digital money from a shared list', scenes },
    null,
    2,
  ) + '\n',
);
