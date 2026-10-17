// Writes storyboard.json beside this file. Every distance, previous pointer and callout sum comes from running
// Dijkstra on the blueprint's graph here, so the scenes cannot drift from the algorithm.
// Run: node examples/algorithms/dijkstra/generate.mjs
import fs from 'node:fs';
const W = { 'S->A': 4, 'S->B': 2, 'B->A': 1, 'B->C': 5, 'A->C': 2, 'A->E': 6, 'C->E': 1 };
const NODES = ['S', 'A', 'B', 'C', 'E'];
const INF = '∞';
const st = { d: { S: 0, A: Infinity, B: Infinity, C: Infinity, E: Infinity }, prev: {}, done: new Set(), tint: {} };
const show = (x) => (x === Infinity ? INF : String(x));

const snapshot = () => ({
  // The layout ranks this graph as one column, S B A C E. A spacer that never shows sits in C's row, left of C, so
  // the three roads that skip a row each get their own lane instead of sharing one.
  nodes: [...NODES.slice(0, 3), 'spacer', ...NODES.slice(3)].map((id) => (id === 'spacer' ? { id, label: 'spacer', shape: 'terminal', hidden: true } : { id, label: id, shape: 'terminal', badge: show(st.d[id]) })),
  table: { columns: ['Node', 'Distance', 'Previous', 'Visited'], rows: NODES.map((n) => ({ cells: [n, show(st.d[n]), st.prev[n] ?? '–', st.done.has(n) ? 'Yes' : 'No'] })) },
  tint: { ...st.tint },
});
const edges = [...Object.entries(W).map(([k, w]) => { const [from, to] = k.split('->'); return { from, to, label: String(w) }; }), { from: 'A', to: 'spacer', hidden: true }];

/** Settle u: the unvisited node with the smallest distance, which the simulation checks. */
const settle = (u) => {
  const open = NODES.filter((n) => !st.done.has(n));
  const best = open.reduce((a, b) => (st.d[b] < st.d[a] ? b : a));
  if (best !== u || open.filter((n) => st.d[n] === st.d[u]).length > 1) throw new Error(`settle ${u} but smallest is ${best}`);
  st.done.add(u); st.tint[u] = 'warn';
  return { tint: { [u]: 'warn' }, set: { ['Visited@' + u]: 'Yes' } };
};
/** Relax u->v: returns the step changes and the callout with the real sum. */
const relax = (u, v) => {
  const w = W[`${u}->${v}`]; const cand = st.d[u] + w; const old = st.d[v];
  const better = cand < old;
  const callout = better
    ? `[${st.d[u]} + ${w} = ${cand} < ${show(old)}]{good}`
    : `[${st.d[u]} + ${w} = ${cand} ≥ ${show(old)}]{bad}`;
  const set = {};
  if (better) {
    set[v] = String(cand);
    set['Distance@' + v] = old === Infinity ? String(cand) : { before: String(old), after: String(cand) };
    set['Previous@' + v] = u;
    st.d[v] = cand; st.prev[v] = u;
  }
  return { set, callout, better };
};
const col = (h) => NODES.map((n) => `${h}@${n}`);
const merge = (...parts) => parts.reduce((a, p) => ({ ...a, ...p, set: { ...(a.set ?? {}), ...(p.set ?? {}) }, tint: { ...(a.tint ?? {}), ...(p.tint ?? {}) } }), {});
const clean = (s) => { for (const k of ['set', 'tint']) if (s[k] && !Object.keys(s[k]).length) delete s[k]; return s; };

const scenes = [];
const scene = (fields, build) => {
  const snap = snapshot();
  const steps = build().map(clean);
  scenes.push({ type: 'graph', layout: 'TB', ...fields, nodes: snap.nodes, edges, table: snap.table, ...(Object.keys(snap.tint).length ? { tint: snap.tint } : {}), steps });
};

scene({ chapter: 'The map', narration: 'Say you want the cheapest way to get from S to E. Each arrow is a one way road, and its number is what that road costs.', callout: 'cheapest S → E?' }, () => [
  { focus: ['S', 'E'], say: 'S is where we start, and E is where we want to end up.' },
  { focus: ['S->A', 'A->E'], say: 'One way is S to A, then A to E. That costs four plus six, which is ten.', callout: 'S → A → E: 4 + 6 = 10' },
  { focus: ['S->B', 'B->C', 'C->E'], say: 'Another is S to B, B to C, then C to E. That costs two plus five plus one, which is eight.', callout: 'S → B → C → E: 2 + 5 + 1 = 8' },
  { focus: ['S', 'A', 'B', 'C', 'E'], say: 'Checking every route works on five places. On a real road map with millions of crossings, there are far too many routes to try.', callout: '' },
  { focus: [...col('Distance'), ...col('Previous'), ...col('Visited')], say: "Dijkstra's method keeps a table instead. For each place it notes the cheapest cost found so far, the place you came from, and whether that cost is settled." },
]);

scene({ chapter: 'The first pick', narration: 'Start S at zero, since it costs nothing to stay put. Every other place starts at infinity, because we have no route to it yet.', callout: 'pick the smallest unvisited' }, () => {
  const s1 = merge(settle('S'));
  const ra = relax('S', 'A'); const rb = relax('S', 'B');
  return [
    { ...s1, focus: ['S', 'row:S'], say: 'S is the smallest, so we visit it first, and its zero is final.' },
    { set: ra.set, callout: '0 + 4 = 4', say: 'From S, the road to A costs four. So A drops from infinity to four, and we note that it came from S.' },
    { set: rb.set, callout: '0 + 2 = 2', say: 'The road to B costs two. So B is two, also from S.' },
    { focus: ['row:A', 'row:B', 'row:C', 'row:E'], callout: 'unvisited: A 4, B 2, C ∞, E ∞', say: 'Now the greedy rule. Of the places not yet visited, pick the one with the smallest cost.' },
    { ...settle('B'), callout: '[B = 2 is final]{good}', say: 'That is B, at two. No road costs less than nothing, so no other way can reach B for less than two. Its cost is settled.' },
  ];
});

scene({ chapter: 'Finding a shortcut', narration: 'Now we look at the roads leaving B.', callout: 'if d(u) + w(u, v) < d(v), then d(v) = d(u) + w(u, v)' }, () => {
  const ra = relax('B', 'A'); const rc = relax('B', 'C');
  return [
    { focus: ['B->A', 'Distance@A'], say: 'We already know a way to A that costs four, straight from S.' },
    { set: ra.set, callout: ra.callout, say: 'But going S to B, then B to A, costs two plus one, which is three. Three is less than four.' },
    { focus: ['row:A', 'A'], callout: 'if d(u) + w(u, v) < d(v), then d(v) = d(u) + w(u, v)', say: 'So we cross out four, write three, and note that A now comes from B. This is called relaxing a road. We found a shortcut, so we replace the old guess.' },
    { set: rc.set, callout: '2 + 5 = 7 < ∞', say: 'The road from B to C costs five, so C becomes seven, by way of B.' },
  ];
});

scene({ chapter: 'Reaching E', narration: 'We keep repeating the same two moves: pick the cheapest unvisited place, then relax the roads leaving it.', callout: 'unvisited: A 3, C 7, E ∞' }, () => {
  const steps = [];
  steps.push({ ...settle('A'), callout: '[A = 3 is final]{good}', say: 'A is cheapest at three, so we visit it.' });
  const rc = relax('A', 'C'); steps.push({ set: rc.set, callout: rc.callout, say: 'Through A, C costs three plus two, which is five. That beats seven.' });
  const re = relax('A', 'E'); steps.push({ set: re.set, callout: '3 + 6 = 9 < ∞', say: 'And E costs three plus six, which is nine.' });
  steps.push({ ...settle('C'), callout: 'unvisited: C 5, E 9', say: 'C is next, at five.' });
  const re2 = relax('C', 'E'); steps.push({ set: re2.set, callout: re2.callout, say: 'Through C, E costs five plus one, which is six. Six beats nine.' });
  steps.push({ ...settle('E'), callout: '[E = 6 is final]{good}', say: 'Now E is the cheapest place left, so its cost of six is settled, and we can stop.' });
  // Walk the previous pointers back from E.
  const path = ['E']; while (st.prev[path[0]]) path.unshift(st.prev[path[0]]);
  if (path.join('') !== 'SBACE' || st.d.E !== 6) throw new Error(`path ${path} ${st.d.E}`);
  const back = []; for (let i = path.length - 1; i > 0; i--) back.push(`${path[i - 1]}->${path[i]}`);
  steps.push({ tint: Object.fromEntries(back.map((e) => [e, 'good'])), focus: [...back, ...['A', 'B', 'C', 'E'].map((n) => `Previous@${n}`)], callout: 'E ← C ← A ← B ← S', say: 'To read the route, follow the previous column backward. E came from C, C from A, A from B, and B from S.' });
  steps.push({ focus: [...path, ...back], callout: `[S → B → A → C → E costs ${st.d.E}]{good}`, say: 'Turn that around, and the cheapest route is S, B, A, C, E, for a total of six.' });
  return steps;
});

const sb = { title: "Dijkstra's shortest path", subtitle: 'Pick the cheapest place, then look for shortcuts', scenes };
fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify(sb, null, 2) + '\n');
