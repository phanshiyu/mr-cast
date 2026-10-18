// Writes storyboard.json, hunks.json and meta.json beside this file. Run: node examples/hardware/cpu-adder/generate.mjs
//
// Facts, computed below: 5 is 0101 and 3 is 0011 in four bits, and their sum is 1000, eight. A full adder's sum is
// A XOR B XOR Cin and its carry is (A AND B) OR (Cin AND (A XOR B)); the truth table and every bit of the ripple are
// checked against ordinary addition. In 0101 + 0011 the three right-hand columns each carry into the next, which is
// the ripple the chain scene shows.
import fs from 'node:fs';

const here = (name) => new URL(name, import.meta.url);
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

const fullAdder = (a, b, c) => {
  const p = a ^ b;
  const g = a & b;
  const h = c & p;
  return { p, g, h, sum: p ^ c, carry: g | h };
};
for (let i = 0; i < 8; i++) {
  const [a, b, c] = [(i >> 2) & 1, (i >> 1) & 1, i & 1];
  const { sum, carry } = fullAdder(a, b, c);
  assert(carry * 2 + sum === a + b + c, `full adder row ${i}`);
}

const WIDTH = 4;
const bits = (n) => n.toString(2).padStart(WIDTH, '0').split('').map(Number);
const A = 5, B = 3;
const a = bits(A), b = bits(B);
assert(a.join('') === '0101' && b.join('') === '0011', 'inputs');

// The ripple, right to left: column 0 is the ones, drawn at the right.
const ripple = [];
let carry = 0;
for (let col = 0; col < WIDTH; col++) {
  const i = WIDTH - 1 - col;
  const out = fullAdder(a[i], b[i], carry);
  ripple.push({ col, a: a[i], b: b[i], cin: carry, ...out });
  carry = out.carry;
}
const sum = ripple.map((r) => r.sum).reverse();
assert(sum.join('') === '1000' && parseInt(sum.join(''), 2) === A + B && carry === 0, 'sum is 1000');
assert(ripple.slice(0, 3).every((r) => r.carry === 1), 'the three right-hand columns carry');
const place = bits(0).map((_, i) => 2 ** (WIDTH - 1 - i));
assert(place.join() === '8,4,2,1', 'place values');

const scenes = [];

// Scene 1: the two numbers as rows of lights.
const lit = (name, values) => Object.fromEntries(values.flatMap((v, i) => (v ? [[`${name}[${i}]`, 'warn']] : [])));
scenes.push({
  type: 'array',
  chapter: 'Five and three',
  title: 'Two numbers, as lights',
  narration: 'Inside a computer, a number is a row of wires, each one on or off. Let\'s add five and three, in four bits.',
  arrays: [
    { name: 'worth', label: 'worth', values: place },
    { name: 'a', label: '5', values: a },
    { name: 'b', label: '3', values: b },
    { name: 'sum', label: 'sum', values: ['?', '?', '?', '?'], hidden: true },
  ],
  indexes: false,
  tint: { 'array:worth': 'dim' },
  steps: [
    { tint: lit('a', a), focus: ['a[1]', 'a[3]', 'worth[1]', 'worth[3]'], say: 'Five is a four plus a one, so the four light and the one light are on.' },
    { tint: lit('b', b), focus: ['b[2]', 'b[3]', 'worth[2]', 'worth[3]'], say: 'Three is a two plus a one.' },
    {
      show: ['array:sum'],
      focus: ['a[3]', 'b[3]', 'sum[3]'],
      say: 'To add them, the computer works like you would on paper: one column at a time, starting from the right.',
      draw: [{ box: ['a[3]', 'sum[3]'], when: 'one column' }],
    },
  ],
});

// Scene 2: one column's truth table.
const rows = [];
for (let i = 0; i < 8; i++) {
  const [x, y, c] = [(i >> 2) & 1, (i >> 1) & 1, i & 1];
  const out = fullAdder(x, y, c);
  rows.push({ cells: [x, y, c, out.carry, out.sum].map(String) });
}
const row = (x, y, c) => x * 4 + y * 2 + c;
const oddRows = rows.flatMap((r, i) => (r.cells[4] === '1' ? [i] : []));
const carryRows = rows.flatMap((r, i) => (r.cells[3] === '1' ? [i] : []));
assert(oddRows.join() === '1,2,4,7' && carryRows.join() === '3,5,6,7', 'sum and carry rows');
scenes.push({
  type: 'table',
  chapter: 'One column',
  title: 'Adding three bits',
  narration: 'One column adds three bits: the two digits, and a carry from the column before. The answer is at most three, so it fits in two bits, a carry and a sum.',
  columns: ['A', 'B', 'Carry in', 'Carry out', 'Sum'],
  rows,
  steps: [
    { focus: row(0, 1, 0), say: 'Zero plus one is one. Sum one, no carry.' },
    { focus: row(1, 1, 0), tint: { [row(1, 1, 0)]: 'warn' }, say: 'One plus one is two, which in binary is one zero. Sum zero, carry one.' },
    { focus: row(1, 1, 1), say: 'All three on makes three, one one. Sum one, carry one.' },
    { focus: 'col:Sum', tint: Object.fromEntries(oddRows.map((i) => [`Sum@${i}`, 'accent'])), callout: 'Sum = A ⊕ B ⊕ Cin', say: 'Look down the sum. It\'s on whenever an odd number of inputs are on. That\'s what an XOR gate does.' },
    { focus: 'col:Carry out', tint: Object.fromEntries(carryRows.map((i) => [`Carry out@${i}`, 'accent'])), callout: 'Carry = A·B + Cin·(A ⊕ B)', say: 'The carry is on whenever at least two are on. AND gates can catch that.' },
  ],
});

// Scene 3: the full adder as gates, with A = 1, B = 1, carry in 0, the right-hand column of 5 + 3.
const first = ripple[0];
assert(first.a === 1 && first.b === 1 && first.cin === 0 && first.sum === 0 && first.carry === 1, 'first column');
const andGate = (x, y) => `M${x} ${y - 50} H${x + 70} A50 50 0 0 1 ${x + 70} ${y + 50} H${x} Z`;
const orGate = (x, y) => `M${x} ${y - 50} Q${x + 90} ${y - 50} ${x + 140} ${y} Q${x + 90} ${y + 50} ${x} ${y + 50} Q${x + 30} ${y} ${x} ${y - 50} Z`;
const xorBack = (x, y) => `M${x - 16} ${y - 50} Q${x + 14} ${y} ${x - 16} ${y + 50}`;
const G = { xor1: [460, 200], and1: [460, 440], xor2: [880, 260], and2: [880, 600], or: [1180, 520] };
const gate = (id, kind, label, size = 26, color = 'var(--muted)') => {
  const [x, y] = G[id];
  const body = kind === 'and' ? andGate(x, y) : orGate(x, y);
  const back = kind === 'xor' ? `<path d="${xorBack(x, y)}" fill="none" stroke="${color}" stroke-width="5"/>` : '';
  return `<g id="${id}"><path d="${body}" fill="var(--surface)" stroke="${color}" stroke-width="5"/>${back}`
    + `<text x="${x + 58}" y="${y + size / 3}" text-anchor="middle" font-size="${size}" fill="var(--text)" font-family="mono">${label}</text></g>`;
};
// Each wire's path: inputs reach a gate 25 px above or below its middle, outputs leave at its tip.
const W = {
  a1: `M160 175 H444`, a2: `M300 175 V415 H460`,
  b1: `M160 225 H444`, b2: `M240 225 V465 H460`,
  c1: `M160 700 H760 V285 H864`, c2: `M760 625 H880`,
  p1: `M600 200 H700 V235 H864`, p2: `M700 235 V575 H880`,
  g: `M580 440 H1000 V495 H1180`,
  h: `M1000 600 H1060 V545 H1180`,
  s: `M1020 260 H1390`,
  co: `M1320 520 H1390`,
};
const value = { a1: first.a, a2: first.a, b1: first.b, b2: first.b, c1: first.cin, c2: first.cin, p1: first.p, p2: first.p, g: first.g, h: first.h, s: first.sum, co: first.carry };
const wires = (ids) => ids.map((id) => `<path d="${W[id]}" fill="none" stroke="var(--border)" stroke-width="6"/>`).join('');
const live = (id, ...ids) => `<g id="${id}" class="flow" fill="none" stroke="var(--warn)" stroke-width="8">${ids.map((w) => `<path d="${W[w]}"/>`).join('')}</g>`;
const label = (id, x, y, text, anchor = 'start', size = 34) => `<text id="${id}" x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" font-family="mono" fill="var(--text)">${text}</text>`;
const adderSvg = `<svg viewBox="0 0 1600 820">`
  + wires(Object.keys(W))
  + live('live-a', 'a1', 'a2') + live('live-b', 'b1', 'b2') + live('live-g', 'g') + live('live-co', 'co')
  + gate('xor1', 'xor', 'XOR') + gate('and1', 'and', 'AND') + gate('xor2', 'xor', 'XOR') + gate('and2', 'and', 'AND') + gate('or', 'or', 'OR')
  + label('in-a', 40, 187, 'A') + label('in-b', 40, 237, 'B') + label('in-c', 16, 712, 'Cin')
  + label('bit-a', 122, 187, String(first.a), 'middle', 30) + label('bit-b', 122, 237, String(first.b), 'middle', 30) + label('bit-c', 135, 712, String(first.cin), 'middle', 30)
  + label('bit-p', 640, 185, `${first.p}`, 'middle', 30) + label('bit-g', 640, 425, `${first.g}`, 'middle', 30) + label('bit-h', 1050, 630, `${first.h}`, 'middle', 30)
  + label('out-s', 1405, 272, `Sum ${first.sum}`) + label('out-c', 1405, 532, `Carry ${first.carry}`)
  + `</svg>`;
assert(value.p1 === 0 && value.g === 1 && value.h === 0, 'gate outputs for 1 + 1 + 0');
scenes.push({
  type: 'svg',
  chapter: 'A full adder',
  title: 'One column, in five gates',
  narration: 'Here are those rules as five gates: two XORs, two ANDs and an OR. This circuit is called a full adder.',
  svg: adderSvg,
  hidden: ['live-a', 'live-b', 'live-g', 'live-co', 'bit-a', 'bit-b', 'bit-c', 'bit-p', 'bit-g', 'bit-h', 'out-s', 'out-c'],
  labels: { xor1: 'first XOR', and1: 'first AND', xor2: 'second XOR', and2: 'second AND', or: 'OR gate', 'in-c': 'carry in' },
  steps: [
    {
      show: ['bit-a', 'bit-b', 'bit-c'],
      trace: [{ ref: 'live-a', when: 'a one on A' }, { ref: 'live-b', when: 'a one on B' }],
      focus: ['live-a', 'live-b', 'in-c'],
      say: 'Take the right-hand column: a one on A, a one on B, and no carry in.',
    },
    {
      camera: ['xor1', 'and1', 'bit-p', 'bit-g'],
      show: ['bit-p', 'bit-g'],
      trace: [{ ref: 'live-g', when: 'Are both on' }],
      focus: ['xor1', 'and1'],
      say: 'The first XOR asks, is exactly one of them on? No, so it outputs zero. The first AND asks, are both on? Yes.',
    },
    {
      camera: ['xor2', 'and2', 'out-s'],
      show: ['out-s', 'bit-h'],
      focus: ['xor2', 'and2', 'out-s'],
      say: 'The second XOR mixes in the carry. Zero and zero, so the sum is zero.',
    },
    {
      camera: 'all',
      show: ['out-c'],
      trace: [{ ref: 'live-co', when: 'carry' }],
      focus: ['or', 'out-c'],
      say: 'And the OR passes the first AND\'s one out as the carry. One plus one: write zero, carry one.',
    },
  ],
});

// Scene 4: four adders in a row, the carry rippling left. Column 0 sits at the right.
const BOX = { w: 240, h: 200, y: 260 };
const boxX = (col) => 1240 - col * 360;
const mini = (col) => {
  // The same five gates, shrunk to fit inside the box, shown only while the camera is in close.
  const s = 0.14, x = boxX(col) + 8, y = BOX.y + 40;
  return `<g id="inside-${col}" transform="translate(${x} ${y}) scale(${s})">${wires(Object.keys(W))}`
    + ['xor1', 'and1', 'xor2', 'and2', 'or'].map((id) => gate(id, id.replace(/\d/, ''), id.replace(/\d/, '').toUpperCase(), 48).replace(`id="${id}"`, `id="m${col}-${id}"`)).join('')
    + `</g>`;
};
const chain = [];
for (const r of ripple) {
  const x = boxX(r.col), cx = x + BOX.w / 2;
  const i = WIDTH - 1 - r.col;
  chain.push(
    `<line x1="${x + 70}" y1="150" x2="${x + 70}" y2="${BOX.y}" stroke="var(--border)" stroke-width="6"/>`,
    `<line x1="${x + 170}" y1="150" x2="${x + 170}" y2="${BOX.y}" stroke="var(--border)" stroke-width="6"/>`,
    `<line x1="${cx}" y1="${BOX.y + BOX.h}" x2="${cx}" y2="560" stroke="var(--border)" stroke-width="6"/>`,
    `<rect id="fa${r.col}" x="${x}" y="${BOX.y}" width="${BOX.w}" height="${BOX.h}" rx="18"/>`,
    `<text id="name${r.col}" x="${cx}" y="${BOX.y + BOX.h / 2 + 12}" text-anchor="middle" font-size="34" fill="var(--muted)">full adder</text>`,
    label(`a${r.col}`, x + 70, 130, `${r.a}`, 'middle'),
    label(`b${r.col}`, x + 170, 130, `${r.b}`, 'middle'),
    `<text x="${x + 70}" y="80" text-anchor="middle" font-size="24" fill="var(--muted)">A${3 - i}</text>`,
    `<text x="${x + 170}" y="80" text-anchor="middle" font-size="24" fill="var(--muted)">B${3 - i}</text>`,
    label(`s${r.col}`, cx, 610, `${r.sum}`, 'middle', 44),
    `<text x="${cx}" y="660" text-anchor="middle" font-size="24" fill="var(--muted)">worth ${2 ** r.col}</text>`,
    ...(r.col === 0 ? [mini(0)] : []),
  );
  // The carry out leaves the box's left side for the next column's right side, or the end of the row.
  const to = r.col === WIDTH - 1 ? x - 100 : boxX(r.col + 1) + BOX.w;
  const d = `M${x} ${BOX.y + 100} H${to}`;
  chain.push(`<path d="${d}" fill="none" stroke="var(--border)" stroke-width="6"/>`);
  chain.push(`<path id="carry${r.col}" class="flow" d="${d}" fill="none" stroke="${r.carry ? 'var(--warn)' : 'var(--border)'}" stroke-width="8"/>`);
  chain.push(label(`c${r.col}`, (x + to) / 2, BOX.y + 85, `${r.carry}`, 'middle', 30));
}
const chainSvg = `<svg viewBox="0 0 1600 700">`
  + `<path d="M${boxX(0) + BOX.w + 80} ${BOX.y + 100} H${boxX(0) + BOX.w}" fill="none" stroke="var(--border)" stroke-width="6"/>`
  + label('c-in', boxX(0) + BOX.w + 40, BOX.y + 85, '0', 'middle', 30)
  + chain.join('') + `</svg>`;
const sumHidden = ripple.flatMap((r) => [`s${r.col}`, `c${r.col}`, `carry${r.col}`]);
const insides = ['inside-0'];
const word = ['zero', 'one'];
scenes.push({
  type: 'svg',
  chapter: 'The ripple',
  title: 'Four full adders, one per bit',
  narration: 'Now copy that full adder four times, one per column, and wire each carry out into the next column\'s carry in.',
  svg: chainSvg,
  hidden: [...sumHidden, ...insides],
  labels: Object.fromEntries(ripple.map((r) => [`fa${r.col}`, `column worth ${2 ** r.col}`])),
  steps: [
    {
      camera: 'fa0',
      show: ['inside-0'],
      hide: ['name0'],
      focus: 'fa0',
      say: 'Each box is the same five gates we just traced.',
    },
    {
      camera: ['fa0', 'fa1', 'a0', 'b1', 's0', 'c0'],
      hide: ['inside-0'],
      show: ['name0', 's0', 'c0'],
      trace: [{ ref: 'carry0', when: 'carry one' }],
      focus: ['s0', 'carry0'],
      say: `The ones column gets one and one. It writes ${word[ripple[0].sum]}, and passes a carry one to its left.`,
    },
    ...ripple.slice(1).map((r) => ({
      camera: [`fa${r.col}`, `a${r.col}`, `b${r.col}`, ...(r.col < WIDTH - 1 ? [`fa${r.col + 1}`] : []), `s${r.col}`, `c${r.col}`],
      show: [`s${r.col}`, `c${r.col}`],
      trace: [{ ref: `carry${r.col}` }],
      focus: [`s${r.col}`, `carry${r.col}`],
      say: r.col === 1
        ? `The twos column could not start until that carry arrived. Zero, one and the carry make two again: ${word[r.sum]}, carry ${word[r.carry]}.`
        : r.col === 2
          ? `The fours column: one, zero and the carry. Again ${word[r.sum]}, carry ${word[r.carry]}.`
          : `The eights column has only the carry, so it writes ${word[r.sum]}, and nothing carries out.`,
    })),
    {
      camera: 'all',
      focus: sumHidden.filter((id) => id.startsWith('s')),
      say: 'Each carry had to wait for the one before it, rippling from right to left. That\'s why this is called a ripple carry adder.',
    },
  ],
});
for (const r of ripple) assert(r.col === 0 || r.cin === ripple[r.col - 1].carry, `carry into column ${r.col}`);

// Scene 5: back to the lights.
scenes.push({
  type: 'array',
  chapter: 'Eight',
  title: 'Five plus three',
  narration: 'Read the sum lights from left to right.',
  arrays: [
    { name: 'worth', label: 'worth', values: place },
    { name: 'a', label: '5', values: a },
    { name: 'b', label: '3', values: b },
    { name: 'sum', label: 'sum', values: sum },
  ],
  indexes: false,
  tint: { 'array:worth': 'dim', ...lit('a', a), ...lit('b', b) },
  callout: `${a.join('')} + ${b.join('')} = ?`,
  steps: [
    {
      tint: lit('sum', sum),
      focus: ['array:sum', 'worth[0]'],
      callout: `${a.join('')} + ${b.join('')} = ${sum.join('')}`,
      say: `One zero zero zero. Only the eights light is on, so the answer is eight. Five plus three, done with nothing but on and off.`,
    },
  ],
});

const storyboard = { title: 'How a CPU adds', subtitle: 'Five plus three, one gate at a time', scenes };
fs.writeFileSync(here('storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
fs.writeFileSync(here('hunks.json'), '{}\n');
fs.writeFileSync(here('meta.json'), `${JSON.stringify({ mode: 'explain' })}\n`);
