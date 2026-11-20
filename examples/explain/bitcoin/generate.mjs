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

// Drawing helpers: every scene is a drawing on the board, 1200 by 640.
const VB = '0 0 1200 640';
const heads = `<defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" stroke="none"/></marker></defs>`;
const txt = (x, y, s, size = 26, extra = '') => `<text x="${x}" y="${y}" font-size="${size}"${extra}>${s}</text>`;
const mid = (x, y, s, size = 26, extra = '') => txt(x, y, s, size, ` text-anchor="middle"${extra}`);
const arrowLine = (id, x1, y1, x2, y2, extra = '') =>
  `<line${id ? ` id="${id}"` : ''} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--muted)" stroke-width="3" marker-end="url(#head)"${extra}/>`;

const scenes = [];

// The shared list: a page of who paid whom, and the opening question's coin.
const ledgerRows = [
  ['Alice pays Bob $20'],
  ['Bob pays Charlie $40'],
  ['Charlie pays Alice $10'],
  ['Alice pays Bob $100'],
];
const ledger = `<svg viewBox="${VB}">
<g id="coin"><circle cx="600" cy="320" r="170" stroke-width="4"/><circle cx="600" cy="320" r="140" fill="none" stroke="var(--muted)" stroke-width="2"/>${mid(600, 345, '1 BTC', 72)}</g>
<g id="page"><rect x="60" y="40" width="680" height="560" rx="10" stroke-width="3"/>${mid(400, 95, 'who paid whom', 26, ' fill="var(--muted)"')}
${[0, 1, 2, 3, 4].map((i) => `<line x1="90" y1="${180 + i * 100}" x2="710" y2="${180 + i * 100}" stroke="var(--border)" stroke-width="2"/>`).join('')}</g>
${ledgerRows.map(([s], i) => `<text id="row${i}" x="110" y="${165 + i * 100}" font-size="36">${s}</text>`).join('\n')}
<g id="tally">${mid(970, 160, 'settle up', 30)}
${txt(820, 250, 'Alice', 30)}${txt(1150, 250, '−$10', 30, ' text-anchor="end"')}
${txt(820, 320, 'Bob', 30)}${txt(1150, 320, '−$20', 30, ' text-anchor="end"')}
${txt(820, 390, 'Charlie', 30)}${txt(1150, 390, '+$30', 30, ' text-anchor="end"')}
<rect x="880" y="440" width="180" height="110" rx="14" stroke-width="3"/>${mid(970, 505, 'the pot', 26)}</g>
</svg>`;

scenes.push({
  type: 'svg',
  chapter: 'The question',
  title: 'What does it mean to own a bitcoin?',
  picture: 'ledger',
  narration: 'What does it mean to own a bitcoin?',
  hidden: ['page', 'row0', 'row1', 'row2', 'row3', 'tally'],
});

scenes.push({
  type: 'svg',
  chapter: 'A shared list',
  title: 'Friends keep one list of who paid whom',
  picture: 'ledger',
  narration:
    'Start with something simpler. A few friends pay for each other’s dinners, and they keep one shared list of who paid whom.',
  hidden: ['coin', 'row1', 'row2', 'row3', 'tally'],
  labels: { row0: 'Alice pays Bob twenty dollars', row1: 'more lines', row3: 'a hundred dollars', tally: 'settle up' },
  steps: [
    { focus: 'row0', say: 'Alice pays Bob twenty dollars, so she writes it down.' },
    { show: ['row1', 'row2'], focus: ['row1', 'row2'], say: 'More lines go on the list as the month goes by.' },
    {
      show: ['tally'],
      focus: 'tally',
      say: 'At the end of the month they settle up. Whoever is down puts cash in a pot, and whoever is up takes cash out.',
    },
    {
      show: ['row3'],
      tint: { row3: 'bad' },
      focus: 'row3',
      say: 'But anyone can add a line. What stops Bob from writing that Alice pays him a hundred dollars?',
      draw: [{ write: 'who wrote this?', near: 'row3', side: 'below', tone: 'bad', when: 'what stops' }],
    },
  ],
});

// Sign with the secret key, check with the public one.
const key = (id, x, y, label) =>
  `<g id="${id}"><circle cx="${x + 22}" cy="${y}" r="20" stroke-width="3" fill="none" stroke="var(--text)"/><path d="M${x + 42},${y} H${x + 110} M${x + 90},${y} V${y + 18} M${x + 104},${y} V${y + 14}" stroke="var(--text)" stroke-width="3" fill="none"/>${txt(x + 124, y + 9, label, 24)}</g>`;
const machine = (id, x, y, label) =>
  `<g id="${id}"><rect x="${x}" y="${y - 40}" width="170" height="80" rx="14" stroke-width="3"/>${mid(x + 85, y + 10, label, 30)}</g>`;
const signPic = `<svg viewBox="${VB}">${heads}
<g id="line">${txt(30, 110, '“Alice pays Bob $100”', 30)}</g>
${key('secret', 40, 170, 'Alice’s secret key')}
${arrowLine('', 380, 140, 470, 140)}${machine('signer', 480, 140, 'Sign')}${arrowLine('a-sig', 660, 140, 730, 140)}
<g id="signature">${txt(745, 128, `${s100.slice(0, 16)}…`, 28, ' font-family="mono"')}${txt(745, 168, 'the signature, 512 bits', 22, ' fill="var(--muted)"')}</g>
<line x1="30" y1="230" x2="1170" y2="230" stroke="var(--border)" stroke-width="2"/>
${key('public', 40, 362, 'Alice’s public key')}<g id="check">${txt(30, 310, 'the line + the signature', 26)}
${arrowLine('', 380, 335, 470, 335)}${machine('verifier', 480, 335, 'Verify')}${arrowLine('', 660, 335, 730, 335)}${txt(745, 346, 'true', 34, ' id="ok" class="tone-good"')}</g>
<line x1="30" y1="430" x2="1170" y2="430" stroke="var(--border)" stroke-width="2"/>
<g id="forged">${txt(30, 500, '“Alice pays Bob $900”', 30, ' id="forged-line"')}${txt(30, 550, '+ the same signature', 26, ' fill="var(--muted)"')}
${arrowLine('', 380, 515, 470, 515)}${machine('verifier2', 480, 515, 'Verify')}${arrowLine('', 660, 515, 730, 515)}${txt(745, 526, 'false', 34, ' id="no" class="tone-bad"')}</g>
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Signatures',
  title: 'Sign with a secret, check in public',
  svg: signPic,
  narration: 'The fix is a digital signature.',
  hidden: ['line', 'signer', 'a-sig', 'signature', 'check', 'forged'],
  labels: {
    signer: 'signing function',
    signature: 'five hundred and twelve bits',
    check: 'check',
    public: 'public key',
    ok: 'true',
    forged: 'changes the line',
    no: 'false',
    secret: 'secret key',
  },
  steps: [
    {
      focus: ['secret', 'public'],
      say: 'Each person makes a pair of keys: a secret key they never share, and a public key everyone can see.',
    },
    {
      show: ['line', 'signer'],
      focus: ['line', 'secret', 'signer'],
      say: 'Alice runs her line and her secret key through a signing function.',
    },
    {
      show: ['a-sig', 'signature'],
      focus: 'signature',
      say: 'Out comes a signature, a string of five hundred and twelve bits.',
    },
    {
      show: ['check'],
      focus: ['check', 'ok', 'public'],
      say: 'Anyone can check that signature against the line and Alice’s public key. The answer is true.',
    },
    {
      show: ['forged'],
      focus: ['forged', 'no'],
      say: 'If Bob changes the line, the old signature no longer fits, and the check says false.',
      draw: [{ underline: 'forged-line', tone: 'bad', when: 'changes the line' }],
    },
    {
      focus: 'secret',
      say: 'Without Alice’s secret key, he cannot make a new one.',
      draw: [{ underline: 'secret', tone: 'good', when: 'secret key' }],
    },
  ],
});

// Real signatures, one row per line.
const sigRows = [
  ['Alice pays Bob $100', s100, 'valid', 'good'],
  ['Alice pays Bob $101', s101, 'valid', 'good'],
  ['Alice pays Bob $900', s100, 'fails', 'bad'],
  ['Alice pays Bob $100', s100, 'valid, a copy', 'bad'],
  ['#342 Alice pays Bob $100', s342, 'valid', 'good'],
  ['#342 Alice pays Bob $100', s342, 'ID used already', 'bad'],
];
const sy = (i) => 135 + i * 82;
const signed = `<svg viewBox="${VB}">
${txt(40, 60, 'line', 24, ' fill="var(--muted)"')}${txt(440, 60, 'signature, first 64 of 512 bits', 24, ' fill="var(--muted)"')}${txt(900, 60, 'check', 24, ' fill="var(--muted)"')}
<line x1="30" y1="80" x2="1170" y2="80" stroke="var(--border)" stroke-width="2"/>
${sigRows
  .map(
    ([line, s, check, tone], i) =>
      `<g id="s${i}">${txt(40, sy(i), line, 28)}<text id="sig${i}" x="440" y="${sy(i)}" font-size="28" font-family="mono">${s.slice(0, 16)}…</text><text id="chk${i}" x="900" y="${sy(i)}" font-size="28" class="tone-${tone}">${check}</text></g>`,
  )
  .join('\n')}
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Copies and IDs',
  title: 'A signed line can still be copied',
  svg: signed,
  narration: 'Here are real signatures made with one secret key. Watch what happens when the line changes.',
  hidden: ['s1', 's2', 's3', 's4', 's5'],
  labels: {
    sig0: 'signature',
    s1: 'a hundred and one',
    s2: 'changed line',
    s3: 'whole signed line',
    s4: 'number of its own',
    s5: 'already on the list',
    sig1: 'completely different',
  },
  steps: [
    { focus: 'sig0', say: 'This is Alice’s signature for paying Bob a hundred dollars.' },
    {
      show: ['s1'],
      focus: ['sig0', 'sig1'],
      say: 'Change one character, a hundred to a hundred and one, and the signature looks completely different.',
    },
    { show: ['s2'], focus: 's2', say: 'Put the old one on a changed line, and the check fails.' },
    {
      show: ['s3'],
      focus: 's3',
      say: 'But Bob can still copy the whole signed line, word for word.',
      draw: [{ brace: ['s0', 's3'], note: 'same line, same signature', side: 'right', tone: 'bad', when: 'copy' }],
    },
    { focus: 'chk3', say: 'The copy checks out, so Alice would pay him twice.' },
    {
      show: ['s4'],
      erase: true,
      focus: 's4',
      say: 'So every line gets a number of its own, and signing covers that number too.',
    },
    {
      show: ['s5'],
      focus: 's5',
      say: 'Now a repeat has a number that is already on the list, and everyone ignores it.',
      draw: [{ cross: 's5', tone: 'bad', when: 'ignores' }],
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
const spot = { Alice: [130, 170], Bob: [450, 170], Charlie: [130, 470], David: [450, 470] };
const R = 66;
const person = (p) => {
  const [x, y] = spot[p];
  const by = y < 300 ? y - R - 22 : y + R + 44;
  return `<g id="${p}"><circle cx="${x}" cy="${y}" r="${R}" stroke-width="3"/>${mid(x, y + 9, p, 26)}</g><text id="bal-${p}" x="${x}" y="${by}" text-anchor="middle" font-size="28">100 LD</text>`;
};
// An arrow between two people, stopping at their circles, with its amount a third of the way along.
const payArrow = ([from, to, amt]) => {
  const [x1, y1] = spot[from];
  const [x2, y2] = spot[to];
  const d = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / d;
  const uy = (y2 - y1) / d;
  const a = [x1 + ux * (R + 6), y1 + uy * (R + 6), x2 - ux * (R + 10), y2 - uy * (R + 10)].map((v) => +v.toFixed(1));
  const lx = x1 + (x2 - x1) * 0.36 + (x1 === x2 ? -16 : 0);
  const ly = y1 + (y2 - y1) * 0.36 + (y1 === y2 ? -14 : 0);
  return `<g id="${from}->${to}">${arrowLine('', ...a, ' stroke-width="4"')}<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${x1 === x2 ? 'end' : 'middle'}" font-size="26">${amt}</text></g>`;
};
const ly = (i) => 210 + i * 90;
const ledgerDollars = `<svg viewBox="${VB}">${heads}
${pays.map(payArrow).join('')}
${Object.keys(bal).map(person).join('')}
<g id="listhead">${txt(640, 140, 'ID', 24, ' fill="var(--muted)"')}${txt(700, 140, 'payment', 24, ' fill="var(--muted)"')}${txt(1100, 140, 'OK?', 24, ' fill="var(--muted)" text-anchor="middle"')}
<line x1="630" y1="160" x2="1170" y2="160" stroke="var(--border)" stroke-width="2"/></g>
${pays.map(([from, to, amt], i) => `<g id="row:${i}">${txt(640, ly(i), `#${i + 1}`, 26)}${txt(700, ly(i), `${from} pays ${to} ${amt} LD`, 26)}</g><text id="ok${i}" x="1100" y="${ly(i)}" text-anchor="middle" font-size="26">?</text>`).join('\n')}
</svg>`;
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
      show: [`row:${i}`, `ok${i}`, `${from}->${to}`],
      set: { [`bal-${from}`]: `${bal[from]} LD`, [`bal-${to}`]: `${bal[to]} LD`, [`ok${i}`]: 'yes' },
      tint: { [`ok${i}`]: 'good' },
      focus: [`${from}->${to}`, `bal-${from}`],
      say: sayPay[i],
    });
  } else {
    assert(from === 'Charlie' && bal.Charlie === 0, 'rejection');
    ledgerSteps.push({
      show: [`row:${i}`, `ok${i}`, `${from}->${to}`],
      tint: { [`row:${i}`]: 'bad', [`${from}->${to}`]: 'bad', [`ok${i}`]: 'bad' },
      set: { [`ok${i}`]: 'no' },
      focus: [`${from}->${to}`, `row:${i}`],
      say: 'Then Charlie tries to pay David thirty. Read the list from the top, and he has nothing left.',
    });
    ledgerSteps.push({
      focus: `bal-${from}`,
      say: 'So everyone rejects that line.',
      draw: [{ cross: `${from}->${to}`, tone: 'bad', when: 'rejects' }],
    });
  }
});
assert(bal.Alice === 140 && bal.Bob === 140 && bal.Charlie === 0 && bal.David === 120, 'balances');
scenes.push({
  type: 'svg',
  chapter: 'Ledger dollars',
  title: 'A line counts only if the payer can cover it',
  svg: ledgerDollars,
  narration: 'Signatures stop fake lines, but not debt.',
  hidden: [
    'listhead',
    ...Object.keys(bal).map((p) => `bal-${p}`),
    ...pays.flatMap(([from, to], i) => [`row:${i}`, `ok${i}`, `${from}->${to}`]),
  ],
  labels: {
    listhead: 'a line counts',
    'Charlie->Alice': 'pays Alice sixty',
    'Charlie->Bob': 'pays Bob forty',
    'Alice->David': 'pays David twenty',
    'Charlie->David': 'pays David thirty',
    'bal-Charlie': 'forty left',
    'bal-Alice': 'plenty',
    'row:3': 'pay David thirty',
  },
  steps: [
    {
      focus: 'Charlie',
      say: 'Charlie could run up a huge bill and vanish.',
      draw: [{ write: 'debt?', near: 'Charlie', side: 'left', tone: 'bad', when: 'huge bill' }],
    },
    {
      show: Object.keys(bal).map((p) => `bal-${p}`),
      focus: Object.keys(bal).map((p) => `bal-${p}`),
      erase: true,
      say: 'So add a rule: everyone starts with a hundred.',
    },
    { show: ['listhead'], focus: 'listhead', say: 'And a line counts only if the list shows the payer has the money.' },
    ...ledgerSteps,
    {
      focus: ['Alice', 'Bob', 'Charlie', 'David'],
      say: 'Notice that nobody holds any dollars now. The money is just the list, so call it ledger dollars.',
      draw: [{ write: 'the history is the money', at: [0.54, 0.84], tone: 'good', when: 'just the list' }],
    },
    { focus: ['bal-Alice', 'bal-Bob', 'bal-David'], say: 'Owning some means the history says you have them.' },
  ],
});

// Many copies of the list, and lines that arrive in different orders.
const cw = 270;
const gap = 26;
const people = ['Alice', 'Bob', 'Charlie', 'David'];
const order = { Alice: ['#7', '#8'], Bob: ['#7', '#8'], Charlie: ['#8', '#7'], David: ['#8', '#7'] };
const lineText = { '#7': '#7 Alice pays Bob 10', '#8': '#8 David pays Charlie 5' };
const cx = (i) => 21 + i * (cw + gap);
const cards = people
  .map((p, i) => {
    const x = cx(i);
    const id = p.toLowerCase();
    return (
      `<g id="card-${id}"><rect x="${x}" y="250" width="${cw}" height="340" rx="16" stroke-width="3"/>` +
      mid(x + cw / 2, 300, `${p}’s copy`, 28) +
      txt(x + 18, 370, '#6 Bob pays David 2', 24, ' fill="var(--muted)"') +
      `<text id="${id}-a" x="${x + 18}" y="440" font-size="24"> </text>` +
      `<text id="${id}-b" x="${x + 18}" y="510" font-size="24"> </text></g>`
    );
  })
  .join('');
const arcs = [1, 2, 3]
  .map(
    (j) =>
      `<path d="M ${cx(0) + cw / 2} 248 Q ${(cx(0) + cx(j)) / 2 + cw / 2} ${170 - j * 20} ${cx(j) + cw / 2} 244" fill="none" stroke="var(--muted)" stroke-width="4" marker-end="url(#head)"/>`,
  )
  .join('');
const copies =
  `<svg viewBox="${VB}">${heads}` +
  `<g id="site"><rect x="430" y="20" width="340" height="80" rx="14" stroke-width="3"/>${mid(600, 70, 'one website keeps the list', 26)}</g>` +
  cards +
  `<g id="broadcast">${arcs}</g></svg>`;
const fillCopies = (k) =>
  Object.fromEntries(people.map((p) => [`${p.toLowerCase()}-${k === 0 ? 'a' : 'b'}`, lineText[order[p][k]]]));
scenes.push({
  type: 'svg',
  chapter: 'No one in charge',
  title: 'Everyone keeps a copy',
  narration: 'So far one website holds the list. But then you have to trust whoever runs it.',
  svg: copies,
  hidden: ['broadcast', 'card-alice', 'card-bob', 'card-charlie', 'card-david'],
  labels: {
    site: 'website',
    broadcast: 'broadcasts',
    'card-charlie': 'Charlie and David',
    'card-david': 'his line first',
    'card-alice': 'copy',
  },
  steps: [
    {
      show: ['card-alice', 'card-bob', 'card-charlie', 'card-david'],
      focus: ['site', 'card-alice', 'card-bob', 'card-charlie', 'card-david'],
      say: 'So drop the website. Instead, everyone keeps their own copy of the list.',
      draw: [{ cross: 'site', tone: 'bad', when: 'drop the website' }],
    },
    {
      show: ['broadcast'],
      set: { 'alice-a': lineText['#7'], 'bob-a': lineText['#7'] },
      focus: ['broadcast', 'card-alice'],
      say: 'To pay Bob, Alice broadcasts her signed line to everyone, and each person adds it to their copy.',
    },
    {
      set: { 'charlie-a': lineText['#8'], 'david-a': lineText['#8'] },
      focus: ['card-charlie', 'card-david'],
      say: 'But messages take time to travel. At the same moment, David sends a line of his own.',
    },
    {
      set: fillCopies(1),
      tint: { 'card-charlie': 'bad', 'card-david': 'bad' },
      focus: ['card-charlie', 'card-david'],
      say: 'Charlie and David get his line first, so their copies have the other order.',
    },
    {
      focus: ['card-alice', 'card-bob', 'card-charlie', 'card-david'],
      say: 'Now the copies disagree. With no one in charge, how does everyone agree on one history?',
      draw: [{ write: 'two orders, no one in charge', at: [0.04, 0.02], tone: 'bad', when: 'disagree' }],
    },
  ],
});

// SHA-256: two inputs one letter apart, and what comes out.
const hh = sha('Hello'),
  hl = sha('hello');
assert(hh.startsWith('185f8db3') && hl.startsWith('2cf24dba'), 'hello hashes');
const hexLines = (h) => [h.slice(0, 32), h.slice(32)].map((s) => s.match(/.{8}/g).join(' '));
const hashOut = (id, h, y) =>
  `<g id="${id}">${hexLines(h)
    .map((l, i) => `<text x="590" y="${y + i * 40}" font-size="26" font-family="mono">${l}</text>`)
    .join('')}</g>`;
const hashPic = `<svg viewBox="${VB}">${heads}
<g id="machine"><rect x="290" y="90" width="200" height="460" rx="18" stroke-width="3"/>${mid(390, 330, 'SHA-256', 32)}</g>
<path id="back" d="M700,150 C640,40 220,40 140,140" fill="none" stroke="var(--muted)" stroke-width="4" stroke-dasharray="12 10" marker-end="url(#head)"/>
<g id="nope" stroke="var(--bad)" stroke-width="6" stroke-linecap="round"><line x1="400" y1="42" x2="440" y2="98"/><line x1="440" y1="42" x2="400" y2="98"/></g>
<g id="in-Hello">${txt(60, 200, 'Hello', 48)}${arrowLine('', 200, 186, 280, 186)}</g>
${arrowLine('out-arrow1', 500, 186, 575, 186)}${hashOut('out-Hello', hh, 180)}
${mid(840, 270, '256 bits = 64 hex digits', 24, ' id="bits-note" fill="var(--muted)"')}
<g id="in-hello">${txt(60, 450, 'hello', 48, ' id="hello-word"')}${arrowLine('', 200, 436, 280, 436)}</g>
${arrowLine('out-arrow2', 500, 436, 575, 436)}${hashOut('out-hello', hl, 430)}
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Hashes',
  title: 'Any text in, 256 bits out',
  svg: hashPic,
  narration: 'The answer needs one more tool, a hash function called SHA-256.',
  hidden: ['back', 'nope', 'in-Hello', 'out-arrow1', 'out-Hello', 'bits-note', 'in-hello', 'out-arrow2', 'out-hello'],
  labels: {
    'in-Hello': 'Hello',
    'out-Hello': 'hash',
    'in-hello': 'lower case',
    'out-hello': 'whole result',
    machine: 'SHA',
    nope: 'no way back',
  },
  steps: [
    {
      show: ['in-Hello'],
      focus: ['in-Hello', 'machine'],
      say: 'It takes any text, short or long. Here, Hello, with a capital H.',
    },
    {
      show: ['out-arrow1', 'out-Hello', 'bits-note'],
      focus: ['out-Hello', 'bits-note'],
      say: 'It gives back two hundred and fifty six bits, written here as sixty four hex digits.',
    },
    {
      show: ['in-hello', 'out-arrow2', 'out-hello'],
      focus: ['in-hello', 'out-hello'],
      say: 'Change just that one letter to lower case, and the whole result changes.',
      draw: [{ circle: 'hello-word', tone: 'bad', when: 'one letter' }],
    },
    { focus: ['out-Hello', 'out-hello'], say: 'Nothing about it is close to the first.' },
    {
      focus: ['back', 'nope'],
      say: 'And there is no way back.',
      trace: ['back'],
      show: ['nope'],
      tint: { back: 'bad' },
    },
    {
      focus: ['out-Hello', 'out-hello'],
      say: 'To find text with a given hash, all you can do is guess, and the guesses would outlast the universe.',
      draw: [{ write: 'about 2^256 guesses', at: [0.04, 0.88], tone: 'bad', when: 'guess' }],
    },
  ],
});

// Proof of work: the same block with nonce after nonce, until its hash starts with 30 zero bits.
const b1 = chain[0];
const tries = [0, 1, 2, 3].map((n) => {
  const h = sha(blockText(b1.prev, b1.txs, n));
  return { n, h, z: zeroBits(h) };
});
assert(tries.every((t) => t.z < 30) && tries[1].z === 7, 'first tries');
const found = { n: b1.nonce, h: b1.hash, z: zeroBits(b1.hash) };
const bitsText = ({ h, z }) => {
  const b = bin32(h);
  return `<tspan class="fill-good">${b.slice(0, z)}</tspan>${b.slice(z)}`;
};
const ty = (i) => (i < 4 ? 190 + i * 64 : 500);
const pow = `<svg viewBox="${VB}">${heads}
<g id="block"><rect x="20" y="120" width="390" height="400" rx="16" stroke-width="3"/>${txt(44, 175, 'prev: 0000…0000', 24, ' font-family="mono"')}
${b1.txs.map((t, i) => txt(44, 235 + i * 50, t, 24)).join('')}
<text id="nonce" x="44" y="${235 + 3 * 50 + 30}" font-size="26" font-family="mono">nonce: 0</text></g>
${arrowLine('', 418, 300, 500, 300)}${mid(459, 280, 'SHA-256', 22, ' fill="var(--muted)"')}
<g id="thead">${txt(690, 120, 'nonce', 22, ' fill="var(--muted)" text-anchor="end"')}${txt(712, 120, 'first 32 bits of the hash', 22, ' fill="var(--muted)"')}${txt(1188, 120, 'zeros', 22, ' fill="var(--muted)" text-anchor="end"')}
<line x1="520" y1="138" x2="1190" y2="138" stroke="var(--border)" stroke-width="2"/></g>
${[...tries, found]
  .map(
    (t, i) =>
      `<g id="try${i}"><text x="690" y="${ty(i)}" text-anchor="end" font-size="22" font-family="mono">${N(t.n)}</text><text x="712" y="${ty(i)}" font-size="22" font-family="mono">${bitsText(t)}</text><text id="z${i}" x="1188" y="${ty(i)}" text-anchor="end" font-size="24">${t.z}</text></g>`,
  )
  .join('\n')}
<text id="dots" x="900" y="${ty(3) + 70}" text-anchor="middle" font-size="26" fill="var(--muted)">…</text>
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Proof of work',
  title: 'Hunting for 30 zeros',
  svg: pow,
  narration: 'Now a puzzle.',
  hidden: ['thead', 'try0', 'try1', 'try2', 'try3', 'try4', 'dots'],
  labels: {
    thead: 'thirty zero bits',
    try0: 'zero',
    z0: 'zero bit',
    nonce: 'nonce',
    try4: 'this number',
    z4: 'thirty zeros',
  },
  steps: [
    { focus: ['block', 'nonce'], say: 'Take a batch of lines, add a number called a nonce, and hash the lot.' },
    {
      show: ['thead'],
      focus: 'thead',
      say: 'The goal is a hash that starts with thirty zero bits.',
      draw: [{ write: 'goal: 30 zeros first', near: 'thead', side: 'above', tone: 'good', when: 'thirty zero bits' }],
    },
    {
      show: ['try0'],
      focus: ['nonce', 'try0'],
      say: `With a nonce of zero, the hash starts with only ${tries[0].z} zero bit.`,
    },
    {
      show: ['try1', 'try2', 'try3'],
      set: { nonce: 'nonce: 3' },
      focus: ['try1', 'try2', 'try3'],
      say: 'So try one, then two, then three. Each guess gives a hash that looks random.',
    },
    {
      show: ['dots', 'try4'],
      set: { nonce: `nonce: ${N(found.n)}` },
      tint: { z4: 'good' },
      focus: ['try4', 'nonce'],
      say: 'Our computer kept going for a few minutes, and this number finally worked.',
    },
    {
      focus: 'z4',
      say: 'Each bit halves the odds, so thirty zeros takes about two to the thirty guesses, around a billion.',
      draw: [{ write: '2^30 ≈ a billion guesses', near: 'try4', side: 'below', when: 'two to the thirty' }],
    },
    {
      focus: 'block',
      say: 'Finding it is slow, but checking it is fast. Anyone can hash the lines with this nonce once and see the zeros.',
      draw: [{ write: 'checking: 1 hash', near: 'block', side: 'above', tone: 'good', when: 'checking it is fast' }],
    },
  ],
});

// A chain of blocks, each starting with the hash of the one before.
const tampered = ['#1 Alice pays Bob 100 LD', ...b1.txs.slice(1)];
const th = sha(blockText(b1.prev, tampered, b1.nonce));
assert(zeroBits(th) < 30, 'tampered block fails the puzzle');
const BX = [20, 430, 840];
const BW = 340;
const blockSvg = (b, i) => {
  const x = BX[i];
  return `<g id="b${i + 1}"><rect x="${x}" y="150" width="${BW}" height="350" rx="16" stroke-width="3"/>${mid(x + BW / 2, 195, `Block ${i + 1}`, 30)}
<text id="prev${i + 1}" x="${x + 20}" y="245" font-size="22" font-family="mono">prev ${i ? short(b.prev) : '0000…'}</text>
${b.txs.map((t, k) => `<text${k === 0 ? ` id="tx${i + 1}"` : ''} x="${x + 20}" y="${295 + k * 38}" font-size="22">${t}</text>`).join('')}
${txt(x + 20, 430, `nonce ${N(b.nonce)}`, 22, ' font-family="mono" fill="var(--muted)"')}
<text id="hash${i + 1}" x="${x + 20}" y="478" font-size="22" font-family="mono">hash ${short(b.hash)}</text></g>`;
};
const chainPic = `<svg viewBox="${VB}">${heads}
${chain.map(blockSvg).join('\n')}
${[1, 2].map((i) => `<path id="link${i}" d="M${BX[i - 1] + BW + 2},470 C${BX[i] - 20},470 ${BX[i - 1] + BW + 20},238 ${BX[i] - 6},238" fill="none" stroke="var(--muted)" stroke-width="4" marker-end="url(#head)"/>`).join('')}
<g id="break" stroke="var(--bad)" stroke-width="6" stroke-linecap="round"><line x1="${BX[1] - 52}" y1="330" x2="${BX[1] - 18}" y2="378"/><line x1="${BX[1] - 18}" y1="330" x2="${BX[1] - 52}" y2="378"/></g>
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'A chain of blocks',
  title: 'Each block holds the hash of the one before',
  svg: chainPic,
  narration: 'Lines are grouped into blocks.',
  hidden: ['b2', 'b3', 'link1', 'link2', 'break'],
  labels: {
    break: 'broken',
    b1: 'block one',
    hash1: 'block one’s hash',
    prev2: 'its top',
    link1: 'old hash',
    tx1: 'old line',
    b2: 'block two',
    b3: 'every block after',
    link2: 'links them',
  },
  steps: [
    {
      focus: ['b1', 'hash1'],
      say: 'A block counts only if it solves the puzzle. Block one’s hash starts with the zeros its nonce bought.',
    },
    {
      show: ['b2'],
      trace: ['link1'],
      focus: ['link1', 'prev2'],
      say: 'Block two writes that hash at its top.',
    },
    {
      show: ['b3'],
      trace: ['link2'],
      focus: ['link2', 'prev3', 'b3'],
      say: 'So does every block after, about the one before it. That links them into a chain.',
    },
    {
      set: { tx1: tampered[0], hash1: `hash ${short(th)}` },
      tint: { tx1: 'bad', hash1: 'bad' },
      focus: ['tx1', 'hash1'],
      say: 'Now say someone changes an old line in block one, ten to a hundred. Its hash changes completely, and no longer starts with zeros.',
    },
    {
      tint: { link1: 'bad', prev2: 'bad' },
      show: ['break'],
      focus: ['link1', 'prev2', 'break'],
      say: 'Block two still points at the old hash, so the link is broken, and everyone can see it.',
    },
    {
      focus: ['b1', 'b2', 'b3'],
      say: 'To hide the change, the cheat must solve the puzzle again for block one, then for every block after it.',
      draw: [
        { brace: ['b1', 'b3'], note: 'redo all of this work', side: 'above', tone: 'bad', when: 'every block after' },
      ],
    },
  ],
});

// Miners race; two block fours, and the longest chain wins.
const fb = (id, x, y, title, line) =>
  `<g id="${id}"><rect x="${x}" y="${y}" width="300" height="130" rx="16" stroke-width="3"/>${mid(x + 150, y + 50, title, 30)}${mid(x + 150, y + 96, line, 24, ' fill="var(--muted)"')}</g>`;
const fork = `<svg viewBox="${VB}">${heads}
${fb('fb3', 30, 255, 'Block 3', 'everyone agrees')}
${arrowLine('e4a', 330, 300, 440, 170, ' stroke-width="4"')}${arrowLine('e4b', 330, 340, 440, 470, ' stroke-width="4"')}
${fb('b4a', 450, 80, 'Block 4', 'pays miner Maya 10')}${fb('b4b', 450, 420, 'Block 4', 'pays miner Omar 10')}
${arrowLine('e5', 750, 145, 850, 145, ' stroke-width="4"')}${fb('b5', 860, 80, 'Block 5', 'built on Maya’s')}
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Miners',
  title: 'The longest chain wins',
  svg: fork,
  narration:
    'People called miners collect the lines everyone broadcasts and race to solve the puzzle for the next block.',
  hidden: ['e4a', 'b4a', 'e4b', 'b4b', 'e5', 'b5'],
  labels: { b4a: 'Maya', b4b: 'Omar', b5: 'Maya’s block', e5: 'longer' },
  steps: [
    {
      show: ['e4a', 'b4a'],
      focus: 'b4a',
      say: 'Maya solves it first. The first line of her block pays her ten ledger dollars out of thin air.',
    },
    {
      focus: 'b4a',
      say: 'That reward is the only way new money appears.',
      draw: [{ write: 'new money, from nothing', near: 'b4a', side: 'below', tone: 'good', when: 'new money' }],
    },
    {
      show: ['e4b', 'b4b'],
      erase: true,
      focus: ['b4a', 'b4b'],
      say: 'But Omar solved a different block four at nearly the same moment. Now there are two chains of the same length.',
    },
    {
      show: ['e5', 'b5'],
      tint: { b4a: 'good', b5: 'good', e4a: 'good', e5: 'good' },
      focus: ['b5', 'e5'],
      say: 'The next miner happens to build on Maya’s block. That chain is longer now, and everyone follows the longest chain.',
    },
    {
      tint: { b4b: 'dim', e4b: 'dim' },
      focus: 'b4b',
      say: 'Omar’s block is dropped, and its lines go back into the pool.',
      draw: [{ cross: 'b4b', tone: 'bad', when: 'dropped' }],
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
const barX = (z) => 150 + z * 150;
const BASE = 540;
const bars = `<svg viewBox="${VB}">
<line x1="100" y1="${BASE}" x2="1170" y2="${BASE}" stroke="var(--text)" stroke-width="3"/>
${zs
  .map((z, i) => {
    const h = Math.max(4, (pct[i] / 100) * 400);
    return `<g id="z${z}"><rect x="${barX(z) - 45}" y="${BASE - h}" width="90" height="${h}" class="tone-bad" stroke-width="3"/>${mid(barX(z), BASE - h - 14, `${pct[i]}%`, 26)}${mid(barX(z), BASE + 40, `${z} block${z === 1 ? '' : 's'}`, 24, ' fill="var(--muted)"')}</g>`;
  })
  .join('\n')}
${mid(635, 630, 'blocks Bob waits on top of his payment', 24, ' fill="var(--muted)"')}
<g id="race-public">${txt(360, 92, 'everyone', 26)}${[0, 1, 2, 3, 4, 5].map((k) => `<rect x="${600 + k * 90}" y="60" width="66" height="46" rx="6" stroke-width="3"${k === 1 ? ' class="tone-good"' : ''}/>${k ? `<line x1="${600 + k * 90 - 24}" y1="83" x2="${600 + k * 90}" y2="83" stroke="var(--muted)" stroke-width="3"/>` : ''}`).join('')}${mid(723, 92, 'Bob', 22)}</g>
<g id="race-secret">${txt(360, 202, 'Alice, in secret', 26)}<path d="M633,106 C633,150 723,140 723,170" fill="none" stroke="var(--muted)" stroke-width="3"/>${[1, 2].map((k) => `<rect x="${600 + k * 90}" y="170" width="66" height="46" rx="6" class="tone-bad" stroke-width="3"/>`).join('')}<line x1="756" y1="193" x2="780" y2="193" stroke="var(--muted)" stroke-width="3"/></g>
<text id="chance" x="700" y="320" text-anchor="middle" font-size="28">chance Alice ever catches up, with 10% of the computing power</text>
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Double spending',
  title: 'Wait a few blocks, and a cheat cannot catch up',
  svg: bars,
  narration: 'Here is the attack.',
  hidden: ['race-public', 'race-secret', 'chance', ...zs.map((z) => `z${z}`)],
  labels: {
    'race-public': 'pays Bob',
    'race-secret': 'another chain',
    chance: 'a tenth',
    z0: 'everyone else',
    z1: 'one block',
    z6: 'six blocks',
    z2: 'extra block',
  },
  steps: [
    { show: ['race-public'], focus: 'race-public', say: 'Alice pays Bob in one block.' },
    {
      show: ['race-secret'],
      focus: 'race-secret',
      say: 'Meanwhile she secretly builds another chain, where that payment never happened.',
    },
    {
      focus: 'race-secret',
      say: 'If her chain gets longer, everyone switches to it, and her money comes back.',
      draw: [
        { write: 'longer? her money comes back', near: 'race-secret', side: 'right', tone: 'bad', when: 'gets longer' },
      ],
    },
    {
      show: ['chance', 'z0'],
      erase: true,
      focus: ['chance', 'z0'],
      say: 'But her one machine races everyone else’s together. Say she has a tenth of all the computing power.',
    },
    {
      show: ['z1'],
      focus: 'z1',
      say: 'If Bob waits for one block on top of his payment, her chance of ever catching up is about one in five.',
    },
    {
      show: ['z2', 'z3', 'z4', 'z5', 'z6'],
      focus: ['z2', 'z3', 'z4', 'z5', 'z6'],
      say: 'Each extra block makes it much smaller. After six blocks it is about two in ten thousand.',
    },
    {
      focus: 'z6',
      say: 'So Bob waits a few blocks before he trusts the payment.',
      draw: [{ write: 'about 2 in 10,000', near: 'z6', side: 'above', tone: 'good', when: 'trusts' }],
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
const yx = (y) => 90 + (y - 2009) * 54; // 2009 to 2028 across 90 to 1116
const RB = 520; // the baseline; 50 BTC stands 400 px tall
const stairs = `<svg viewBox="${VB}">
<line x1="80" y1="${RB}" x2="1140" y2="${RB}" stroke="var(--text)" stroke-width="3"/>
${eras
  .map(({ y, h, r }, i) => {
    const x1 = yx(+y);
    const x2 = yx(i < eras.length - 1 ? +eras[i + 1].y : 2028);
    const ht = r * 8;
    return `<g id="era${i}"><rect x="${x1}" y="${RB - ht}" width="${x2 - x1}" height="${ht}" stroke-width="3"/>${mid((x1 + x2) / 2, RB - ht - 14, `${r} BTC`, 26)}${txt(x1, RB + 36, y, 24)}${txt(x1, RB + 68, `block ${N(h)}`, 22, ' fill="var(--muted)"')}</g>`;
  })
  .join('\n')}
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Bitcoin itself',
  title: 'The reward halves every four years',
  svg: stairs,
  narration: 'That is Bitcoin.',
  hidden: ['era1', 'era2', 'era3', 'era4'],
  labels: {
    era0: 'fifty bitcoin',
    era1: 'reward halves',
    era2: 'twelve and a half',
    era3: 'six and a quarter',
    era4: 'three point one two five',
  },
  steps: [
    {
      focus: 'era0',
      say: 'The network adjusts the puzzle every two thousand and sixteen blocks, about two weeks, so a new block comes about every ten minutes.',
      draw: [{ write: 'a block every 10 minutes', at: [0.45, 0.06], when: 'every ten minutes' }],
    },
    {
      focus: 'era0',
      erase: true,
      say: 'In two thousand and nine, each block paid its miner fifty bitcoin.',
      draw: [{ circle: 'era0', when: 'fifty' }],
    },
    {
      show: ['era1'],
      erase: true,
      focus: 'era1',
      say: 'Every two hundred and ten thousand blocks, about four years, the reward halves.',
    },
    {
      show: ['era2', 'era3'],
      focus: ['era1', 'era2', 'era3'],
      say: 'Twenty five, then twelve and a half, then six and a quarter.',
    },
    {
      show: ['era4'],
      focus: 'era4',
      say: 'Since twenty twenty four it is three point one two five.',
    },
    {
      focus: ['era0', 'era1', 'era2', 'era3', 'era4'],
      say: 'Add up every halving and the total stops just short of twenty one million bitcoin.',
      draw: [{ write: `all ever made: ${N(cap)} BTC`, at: [0.45, 0.06], tone: 'good', when: 'twenty one million' }],
    },
    {
      focus: 'era4',
      say: 'Blocks also have a size limit, so people add a small fee for a spot, and miners pick the lines that pay best.',
      draw: [{ write: '+ fees', near: 'era4', side: 'above', when: 'fee' }],
    },
    {
      focus: 'era4',
      say: 'As the reward shrinks, fees pay more of the miners’ bills.',
      draw: [{ underline: 'era4', when: 'fees pay' }],
    },
  ],
});

// Recap: each problem and the tool that fixed it.
const recapRows = [
  ['Anyone can write a fake line', 'Signatures, from a secret key'],
  ['A signed line can be copied', 'A unique ID on every line'],
  ['People spend money they do not have', 'The history is the money'],
  ['Copies disagree, no one in charge', 'Proof of work, longest chain wins'],
  ['Someone rewrites an old block', 'Redoing the work costs too much'],
];
const ry = (i) => 110 + i * 112;
const recap = `<svg viewBox="${VB}">${heads}
${recapRows
  .map(
    ([p, t], i) =>
      `<text id="p${i}" x="30" y="${ry(i)}" font-size="28" class="tone-bad">${p}</text>${arrowLine(`a${i}`, 540, ry(i) - 9, 620, ry(i) - 9)}<text id="t${i}" x="640" y="${ry(i)}" font-size="28" class="tone-good">${t}</text>`,
  )
  .join('\n')}
</svg>`;
scenes.push({
  type: 'svg',
  chapter: 'Recap',
  title: 'One tool for each problem',
  svg: recap,
  narration: 'Each problem we hit along the way got one tool.',
  hidden: recapRows.flatMap((_, i) => [`a${i}`, `t${i}`]),
  labels: {
    t0: 'signatures',
    t1: 'IDs',
    p0: 'fake',
    p1: 'copied lines',
    t2: 'shared history',
    t3: 'proof of work',
    t4: 'longest chain',
    p3: 'strangers agree',
  },
  steps: [
    {
      show: ['a0', 't0', 'a1', 't1'],
      focus: ['p0', 'p1', 't0', 't1'],
      say: 'Signatures and IDs stop fake and copied lines.',
    },
    { show: ['a2', 't2'], focus: 't2', say: 'The shared history decides who owns what.' },
    {
      show: ['a3', 't3', 'a4', 't4'],
      focus: ['t3', 't4'],
      say: 'And proof of work, with the longest chain, lets strangers agree on one history without anyone in charge.',
    },
  ],
});

fs.writeFileSync(
  new URL('./storyboard.json', import.meta.url),
  JSON.stringify(
    {
      title: 'How Bitcoin works',
      subtitle: 'Building digital money from a shared list',
      tones: { good: 'what checks out, and the fix', bad: 'a fake, a copy or a cheat' },
      pictures: { ledger },
      scenes,
    },
    null,
    2,
  ) + '\n',
);
