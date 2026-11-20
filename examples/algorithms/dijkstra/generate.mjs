// Writes storyboard.json beside this file. Every cost, crossed-out guess, previous place and sum on the board comes
// from running Dijkstra on the map here, so the drawing cannot drift from the algorithm.
// Run: node examples/algorithms/dijkstra/generate.mjs
import fs from 'node:fs';

const W = { 'S->A': 4, 'S->B': 2, 'B->A': 1, 'B->C': 5, 'A->C': 2, 'A->E': 6, 'C->E': 1 };
const NODES = ['S', 'A', 'B', 'C', 'E'];
const INF = '∞';
const show = (x) => (x === Infinity ? INF : String(x));
const say = (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n];

// The run. Each place keeps every cost and every previous place it was given, in order, so the table on the board
// can show old guesses crossed out beside the new one.
const st = { d: { S: 0, A: Infinity, B: Infinity, C: Infinity, E: Infinity }, prev: {}, done: new Set() };
const costs = Object.fromEntries(NODES.map((n) => [n, [show(st.d[n])]]));
const prevs = Object.fromEntries(NODES.map((n) => [n, []]));
const cost = (n, i = costs[n].length - 1) => `d${n}${i}`;

/** Settle u, the unvisited place with the smallest cost, which the run checks. */
const settle = (u) => {
  const open = NODES.filter((n) => !st.done.has(n));
  const best = open.reduce((a, b) => (st.d[b] < st.d[a] ? b : a));
  if (best !== u || open.filter((n) => st.d[n] === st.d[u]).length > 1)
    throw new Error(`settle ${u} but smallest is ${best}`);
  st.done.add(u);
  return { show: [`ok${u}`], tint: { [u]: 'good', [cost(u)]: 'good' }, focus: [u, cost(u), `ok${u}`] };
};
/** Relax u->v: the parts to show (new cost, its previous place, old ones struck) and the real sum. */
const relax = (u, v) => {
  const w = W[`${u}->${v}`];
  const cand = st.d[u] + w;
  const old = st.d[v];
  const better = cand < old;
  const parts = [];
  const was = cost(v);
  if (better) {
    parts.push(`x${was}`);
    costs[v].push(String(cand));
    parts.push(cost(v));
    if (prevs[v].length) parts.push(`xp${v}${prevs[v].length - 1}`);
    prevs[v].push(u);
    parts.push(`p${v}${prevs[v].length - 1}`);
    st.d[v] = cand;
    st.prev[v] = u;
  }
  return { better, cand, old, was, parts, sum: `${st.d[u]} + ${w} = ${cand}`, edge: u + v };
};

// The map on the left, drawn from where each place sits; the handwritten table on the right.
const P = { S: [90, 330], A: [320, 140], B: [320, 520], C: [560, 520], E: [560, 140] };
const R = 42;
const edgeSvg = (k, w) => {
  const [u, v] = k.split('->');
  const [x1, y1] = P[u];
  const [x2, y2] = P[v];
  const len = Math.hypot(x2 - x1, y2 - y1);
  const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
  const a = [x1 + ux * (R + 4), y1 + uy * (R + 4)];
  const b = [x2 - ux * (R + 10), y2 - uy * (R + 10)];
  // The weight sits off the middle of the road, on its left-hand side.
  const [mx, my] = [(x1 + x2) / 2 - uy * 26, (y1 + y2) / 2 + ux * 26 + 9];
  return `<g id="${u}${v}"><line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="var(--muted)" stroke-width="4" marker-end="url(#head)"/><text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle" font-size="28">${w}</text></g>`;
};
const nodeSvg = (n) =>
  `<g id="${n}"><circle cx="${P[n][0]}" cy="${P[n][1]}" r="${R}" stroke-width="3"/><text x="${P[n][0]}" y="${P[n][1] + 11}" text-anchor="middle" font-size="32">${n}</text></g>`;

const TX = 660;
const rowY = (i) => 240 + i * 82;
const COST_X = 790;
const COST_STEP = 72;
const FROM_X = 1030;
const FROM_STEP = 50;
const struck = (id, x, y, w) =>
  `<line id="x${id}" x1="${x - 6}" y1="${y - 10}" x2="${x + w}" y2="${y - 10}" class="stroke-bad" stroke-width="4"/>`;

const buildPicture = () => {
  const rows = NODES.map((n, i) => {
    const y = rowY(i);
    const cs = costs[n]
      .map((c, j) => {
        const x = COST_X + j * COST_STEP;
        const w = 18 * c.length + 8;
        // The board's hand has no ∞, so infinity is drawn as a loop.
        const [mx, my] = [x + 20, y - 10];
        const value =
          c === INF
            ? `<path id="d${n}${j}" d="M${mx} ${my} C${mx + 6} ${my - 11} ${mx + 18} ${my - 11} ${mx + 18} ${my} C${mx + 18} ${my + 11} ${mx + 6} ${my + 11} ${mx} ${my} C${mx - 6} ${my - 11} ${mx - 18} ${my - 11} ${mx - 18} ${my} C${mx - 18} ${my + 11} ${mx - 6} ${my + 11} ${mx} ${my} Z" fill="none" stroke="var(--text)" stroke-width="3"/>`
            : `<text id="d${n}${j}" x="${x}" y="${y}" font-size="30">${c}</text>`;
        return `${value}${j < costs[n].length - 1 ? struck(`d${n}${j}`, x, y, c === INF ? 44 : w) : ''}`;
      })
      .join('');
    const ps = prevs[n]
      .map((p, j) => {
        const x = FROM_X + j * FROM_STEP;
        return `<text id="p${n}${j}" x="${x}" y="${y}" font-size="30">${p}</text>${j < prevs[n].length - 1 ? `<line id="xp${n}${j}" x1="${x - 6}" y1="${y - 10}" x2="${x + 26}" y2="${y - 10}" class="stroke-bad" stroke-width="4"/>` : ''}`;
      })
      .join('');
    const tick = `<path id="ok${n}" d="M1124 ${y - 14} L1136 ${y} L1160 ${y - 30}" fill="none" class="stroke-good" stroke-width="5"/>`;
    return `<text id="row${n}" x="${TX + 30}" y="${y}" font-size="30">${n}</text>${cs}${ps}${tick}`;
  }).join('\n');
  return `<svg viewBox="0 0 1200 640">
<defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" stroke="none"/></marker></defs>
${Object.entries(W)
  .map(([k, w]) => edgeSvg(k, w))
  .join('')}
${NODES.map(nodeSvg).join('')}
<g id="table"><text x="${TX + 30}" y="160" font-size="26" fill="var(--muted)">place</text><text id="hCost" x="${COST_X}" y="160" font-size="26" fill="var(--muted)">cost so far</text><text id="hFrom" x="${FROM_X - 10}" y="160" font-size="26" fill="var(--muted)">from</text><text id="hDone" x="1116" y="160" font-size="26" fill="var(--muted)">done</text>
<line x1="${TX}" y1="180" x2="1190" y2="180" stroke="var(--muted)" stroke-width="3"/><line x1="${COST_X - 24}" y1="120" x2="${COST_X - 24}" y2="600" stroke="var(--muted)" stroke-width="3"/><line x1="${FROM_X - 24}" y1="120" x2="${FROM_X - 24}" y2="600" stroke="var(--muted)" stroke-width="3"/><line x1="1104" y1="120" x2="1104" y2="600" stroke="var(--muted)" stroke-width="3"/></g>
${rows}
</svg>`;
};

const scenes = [];

// Scene 1: the map, and why trying every route does not scale.
scenes.push({
  type: 'svg',
  chapter: 'The map',
  title: 'Which way from S to E is cheapest?',
  picture: 'map',
  labels: { S: 'S', E: 'E', SA: 'S to A', AE: 'A to E', SB: 'S to B', BC: 'B to C', CE: 'C to E', table: 'table' },
  narration: 'Say you want the cheapest way to get from S to E.',
  steps: [
    {
      focus: Object.keys(W).map((k) => k.replace('->', '')),
      say: 'Each arrow is a one way road, and its number is what that road costs.',
    },
    { focus: ['S', 'E'], say: 'S is where we start, and E is where we want to end up.' },
    {
      focus: ['SA', 'AE'],
      say: 'One way is S to A, then A to E. That costs four plus six, which is ten.',
      draw: [
        { write: `S → A → E: 4 + 6 = ${W['S->A'] + W['A->E']}`, near: 'AE', side: 'above', when: 'four plus six' },
      ],
    },
    {
      focus: ['SB', 'BC', 'CE'],
      say: 'Another is S to B, B to C, then C to E. That costs two plus five plus one, which is eight.',
      draw: [
        {
          write: `S → B → C → E: 2 + 5 + 1 = ${W['S->B'] + W['B->C'] + W['C->E']}`,
          near: 'BC',
          side: 'below',
          when: 'two plus five',
        },
      ],
    },
    {
      focus: NODES,
      erase: true,
      say: 'Checking every route works on five places. On a real road map with millions of crossings, there are far too many routes to try.',
    },
    {
      show: ['table', ...NODES.map((n) => `row${n}`)],
      focus: 'table',
      say: "Dijkstra's method keeps a table instead.",
    },
    {
      focus: ['hCost', 'hFrom', 'hDone'],
      say: 'For each place it notes the cheapest cost found so far, the place you came from, and whether that cost is settled.',
    },
  ],
});

// Scene 2: the first two picks.
{
  const s = settle('S');
  const ra = relax('S', 'A');
  const rb = relax('S', 'B');
  const unvisited = ['A', 'B', 'C', 'E'].map((n) => cost(n));
  const sb = settle('B');
  scenes.push({
    type: 'svg',
    chapter: 'The first pick',
    title: 'Visit the cheapest place first',
    picture: 'map',
    labels: {
      dS0: 'zero',
      dA0: 'infinity',
      dB0: 'infinity',
      okS: 'final',
      [ra.parts[1]]: 'four',
      [rb.parts[1]]: 'two',
      okB: 'settled',
    },
    narration: 'First, write a starting guess for every place.',
    steps: [
      { show: ['dS0'], focus: 'dS0', say: 'S starts at zero, since it costs nothing to stay put.' },
      {
        show: NODES.slice(1).map((n) => `d${n}0`),
        focus: NODES.slice(1).map((n) => `d${n}0`),
        say: 'Every other place starts at infinity, because we have no route to it yet.',
      },
      { ...s, say: 'S is the smallest, so we visit it first, and its zero is final.' },
      {
        show: ra.parts,
        focus: ['SA', ra.was, ...ra.parts],
        say: 'From S, the road to A costs four. So A drops from infinity to four, and we note that it came from S.',
        draw: [{ write: ra.sum, near: 'SA', side: 'left', when: 'costs four' }],
      },
      {
        show: rb.parts,
        focus: ['SB', rb.was, ...rb.parts],
        say: 'The road to B costs two. So B is two, also from S.',
        draw: [{ write: rb.sum, near: 'SB', side: 'left', when: 'costs two' }],
      },
      {
        focus: unvisited,
        erase: true,
        say: 'Now the greedy rule. Of the places not yet visited, pick the one with the smallest cost.',
      },
      {
        ...sb,
        say: 'That is B, at two. No road costs less than nothing, so no other way can reach B for less.',
        draw: [{ circle: cost('B'), note: 'final', tone: 'good', when: 'for less' }],
      },
    ],
  });
}

// Scene 3: the shortcut through B.
{
  const known = st.d.A;
  const knownId = cost('A');
  const ra = relax('B', 'A');
  const rc = relax('B', 'C');
  if (!ra.better || !rc.better) throw new Error('both roads from B are shortcuts');
  const [strikeA, newA, ...fromA] = ra.parts;
  scenes.push({
    type: 'svg',
    chapter: 'Finding a shortcut',
    title: 'A detour through B is cheaper',
    picture: 'map',
    labels: {
      [knownId]: 'four',
      BA: 'B to A',
      [newA]: 'three',
      [fromA.at(-1)]: 'comes from B',
      [rc.parts[1]]: 'seven',
      BC: 'B to C',
    },
    narration: 'Now we look at the roads leaving B.',
    steps: [
      {
        focus: knownId,
        say: 'We already know a way to A that costs four, straight from S.',
        draw: [{ circle: knownId, note: 'via S', when: 'four' }],
      },
      {
        focus: ['SB', 'BA', knownId],
        say: 'But going S to B, then B to A, costs two plus one, which is three. Three is less than four.',
        draw: [
          { write: ra.sum, near: 'BA', side: 'right', when: 'two plus one' },
          { write: `${ra.cand} < ${known}`, near: knownId, side: 'below', tone: 'good', when: 'three is less' },
        ],
      },
      {
        show: [strikeA, newA, ...fromA],
        focus: [newA, fromA.at(-1)],
        erase: true,
        say: 'So we cross out four, write three, and note that A now comes from B.',
      },
      {
        focus: 'BA',
        say: 'This is called relaxing a road. We found a shortcut, so we replace the old guess.',
        draw: [{ write: 'relax: keep the cheaper', near: 'BA', side: 'right', tone: 'good', when: 'relaxing' }],
      },
      {
        show: rc.parts,
        focus: ['BC', ...rc.parts],
        erase: true,
        say: 'The road from B to C costs five, so C becomes seven, by way of B.',
        draw: [{ write: rc.sum, near: 'BC', side: 'below', when: 'costs five' }],
      },
    ],
  });
}

// Scene 4: the same two moves until E is settled, then the route read backward.
{
  const steps = [];
  const sa = settle('A');
  steps.push({ ...sa, say: 'A is cheapest at three, so we visit it.' });
  const rc = relax('A', 'C');
  steps.push({
    show: rc.parts,
    focus: ['AC', ...rc.parts],
    say: `Through A, C costs three plus two, which is ${say(rc.cand)}. That beats ${say(rc.old)}.`,
    draw: [{ write: rc.sum, near: 'AC', side: 'right', when: 'three plus two' }],
  });
  const re = relax('A', 'E');
  steps.push({
    show: re.parts,
    focus: ['AE', ...re.parts],
    say: `And E costs three plus six, which is ${say(re.cand)}.`,
    draw: [{ write: re.sum, near: 'AE', side: 'above', when: 'three plus six' }],
  });
  steps.push({ ...settle('C'), erase: true, say: 'C is next, at five.' });
  const re2 = relax('C', 'E');
  steps.push({
    show: re2.parts,
    focus: ['CE', ...re2.parts],
    say: `Through C, E costs five plus one, which is ${say(re2.cand)}. Six beats nine.`,
    draw: [{ write: re2.sum, near: 'CE', side: 'right', when: 'five plus one' }],
  });
  steps.push({
    ...settle('E'),
    erase: true,
    say: 'Now E is the cheapest place left, so its cost of six is settled, and we can stop.',
  });
  // Walk the previous places back from E.
  const path = ['E'];
  while (st.prev[path[0]]) path.unshift(st.prev[path[0]]);
  if (path.join('') !== 'SBACE' || st.d.E !== 6) throw new Error(`path ${path} ${st.d.E}`);
  const back = [];
  for (let i = path.length - 1; i > 0; i--) back.push(`${path[i - 1]}${path[i]}`);
  const lastFrom = (n) => `p${n}${prevs[n].length - 1}`;
  steps.push({
    focus: ['A', 'B', 'C', 'E'].map(lastFrom),
    say: 'To read the route, follow the from column backward. E came from C, C from A, A from B, and B from S.',
    draw: [
      { write: 'E ← C ← A ← B ← S', near: 'hCost', side: 'above', tone: 'good', when: 'backward' },
      ...['E', 'C', 'A', 'B'].map((n, i) => ({ circle: lastFrom(n), ...(i === 0 ? { when: 'E came from' } : {}) })),
    ],
  });
  steps.push({
    tint: Object.fromEntries(back.map((e) => [e, 'good'])),
    focus: back,
    erase: true,
    say: `Turn that around, and the cheapest route is S, B, A, C, E, for a total of ${say(st.d.E)}.`,
    draw: [{ write: `S → B → A → C → E = ${st.d.E}`, near: 'BC', side: 'below', tone: 'good', when: 'cheapest route' }],
  });
  scenes.push({
    type: 'svg',
    chapter: 'Reaching E',
    title: 'Repeat until E is settled',
    picture: 'map',
    labels: {
      A: 'A',
      C: 'C',
      E: 'E',
      AC: 'through A',
      CE: 'through C',
      [lastFrom('E')]: 'E came from C',
      [lastFrom('A')]: 'A from B',
    },
    narration:
      'We keep repeating the same two moves: pick the cheapest unvisited place, then relax the roads leaving it.',
    steps,
  });
}

// Everything the table ever shows starts hidden; the scenes show it as the run reaches it.
const pictureMap = buildPicture();
const allIds = [...pictureMap.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
const tableParts = allIds.filter((id) => /^(d|xd|p|xp|ok|row)[A-Z]\d*$/.test(id) || id === 'table');
scenes[0].hidden = tableParts;

const sb = {
  title: "Dijkstra's shortest path",
  subtitle: 'Pick the cheapest place, then look for shortcuts',
  tones: { good: 'settled costs and the cheapest route', bad: 'guesses crossed out for a cheaper one' },
  pictures: { map: pictureMap },
  scenes,
};
fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify(sb, null, 2) + '\n');
