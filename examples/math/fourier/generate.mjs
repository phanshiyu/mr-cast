// Writes storyboard.json, hunks.json and meta.json beside this file: why a square wave is a sum of sine waves. Every
// number on screen and in the words is computed here, through shared/expr.mjs, the parser the plot scene draws with,
// and checked against the known results.
//
// Sources for the facts asserted below:
// - The square wave sign(sin x) has the Fourier series (4/π) Σ sin(kx)/k over odd k, and no even terms. Any text on
//   Fourier series derives it; e.g. E. Kreyszig, Advanced Engineering Mathematics, 10th ed., section 11.1, example 1.
//   It is recomputed here: each wave's height is (1/π) ∫ f(x) sin(kx) dx over one period, by numerical integration.
// - The overshoot at a jump tends to (2/π)·Si(π) ≈ 1.17898 for a jump from −1 to 1, about 8.95% of the jump, however
//   many terms are added: the Gibbs phenomenon. H. Wilbraham, "On a certain periodic function", Cambridge and Dublin
//   Mathematical Journal 3 (1848), 198-201; J. W. Gibbs, "Fourier's series", Nature 59 (1899), 606; and E. Hewitt and
//   R. E. Hewitt, "The Gibbs-Wilbraham phenomenon: an episode in Fourier analysis", Archive for History of Exact
//   Sciences 21 (1979), 129-160. Si(π) is computed here by Simpson's rule.
// Run: node examples/math/fourier/generate.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exprOf } from '../../../shared/expr.mjs';

const at = (expr, scope) => exprOf(expr).fn(scope);
const f2 = (v) => v.toFixed(2);
const f3 = (v) => v.toFixed(3);

// Simpson's rule over [a, b] with n (even) slices.
const integrate = (f, a, b, n = 20000) => {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
};

// ---------- each wave's height, from the square wave itself ----------
const square = (x) => Math.sign(Math.sin(x));
const height = (k) => integrate((x) => square(x) * Math.sin(k * x), 0, 2 * Math.PI) / Math.PI;
const ODD = [1, 3, 5, 7, 9, 11];
const heights = ODD.map(height);
for (const [i, k] of ODD.entries()) assert.ok(Math.abs(heights[i] - 4 / (Math.PI * k)) < 1e-6, `height of sin ${k}x`);
for (const k of [2, 4, 6]) assert.ok(Math.abs(height(k)) < 1e-9, `no sin ${k}x`);
assert.equal(f3(heights[0]), '1.273');

// ---------- the partial sums, as the scene draws them ----------
// n is how many odd waves are added: sin x, sin 3x, ..., sin (2n − 1)x.
const SUM = 'sum(j, 1, n, 4 / (pi * (2*j - 1)) * sin((2*j - 1) * x))';
const middle = (n) => at(SUM, { n, x: Math.PI / 2 });
// The research's figures: 1.2732 with one wave, 0.8488 with two, 1.1035 with three, 1.0244 with thirteen (k ≤ 25).
assert.equal(middle(1).toFixed(4), '1.2732');
assert.equal(middle(2).toFixed(4), '0.8488');
assert.equal(middle(3).toFixed(4), '1.1035');
assert.equal(middle(13).toFixed(4), '1.0244');

// The highest the sum climbs before the jump at x = π, found on a fine grid; it sits at x = π − π/(2n).
const peakOf = (n) => {
  let best = { x: 0, y: -Infinity };
  for (let i = 1; i <= 40000; i++) {
    const x = Math.PI / 2 + (i / 40000) * (Math.PI / 2);
    const y = at(SUM, { n, x });
    if (y > best.y) best = { x, y };
  }
  return best;
};
const PEAK_N = [5, 13, 50, 200];
const peaks = PEAK_N.map(peakOf);
for (const [i, n] of PEAK_N.entries())
  assert.ok(Math.abs(peaks[i].x - (Math.PI - Math.PI / (2 * n))) < 2e-4, `peak of ${n} at ${peaks[i].x}`);
const si = (z) => integrate((t) => (t === 0 ? 1 : Math.sin(t) / t), 0, z);
const limit = (2 / Math.PI) * si(Math.PI);
assert.equal(limit.toFixed(5), '1.17898');
const overshoot = (limit - 1) / 2;
assert.equal((overshoot * 100).toFixed(2), '8.95');
// Every peak from 13 waves on rounds to the limit's 1.18; the bump's width shrinks as 1/n.
for (const p of peaks.slice(1)) assert.equal(f2(p.y), f2(limit));
assert.ok(peaks[3].y - limit < 1e-4);

// ---------- the board: the plot drawn as svg, every curve computed here ----------
// The board's lettering has no π, so the x ticks are written as numbers: 1.57, 3.14, 4.71, 6.28.
const X0 = 80,
  X1 = 1160,
  Y0 = 320,
  YK = 186; // px per unit of y; y runs from about −1.5 to 1.5
const px = (x) => X0 + (x / (2 * Math.PI)) * (X1 - X0);
const py = (y) => Y0 - y * YK;
// Ramer-Douglas-Peucker: drop points within tol px of the line through their neighbours.
const simplify = (pts, tol = 0.35) => {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i],
      [bx, by] = pts[j];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1,
      best = tol;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / len;
      if (d > best) [best, far] = [d, k];
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([i, far], [far, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
};
const curve = (f, samples = 2400) => {
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * 2 * Math.PI;
    pts.push([px(x), py(f(x))]);
  }
  return `M${simplify(pts)
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' L')}`;
};
const sumCurve = (n) => curve((x) => at(SUM, { n, x }), n > 20 ? 8000 : 2400);
const path = (id, d, extra) => `<path id="${id}" d="${d}" fill="none" ${extra}/>`;
const good = 'class="stroke-good" stroke-width="4"';
const pointG = (id, x, y, label, side = 'above') => {
  const [cx, cy] = [px(x), py(y)];
  const t =
    side === 'above'
      ? `x="${cx.toFixed(1)}" y="${(cy - 22).toFixed(1)}" text-anchor="middle"`
      : side === 'below'
        ? `x="${cx.toFixed(1)}" y="${(cy + 44).toFixed(1)}" text-anchor="middle"`
        : `x="${(cx - 18).toFixed(1)}" y="${(cy - 14).toFixed(1)}" text-anchor="end"`;
  return `<g id="${id}"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" class="tone-bad"/><text id="${id}-v" ${t} font-size="28" class="fill-bad">${label}</text></g>`;
};
const tick = (x, label) =>
  `<line x1="${px(x)}" y1="${Y0 - 8}" x2="${px(x)}" y2="${Y0 + 8}" stroke="var(--muted)" stroke-width="2"/><text x="${px(x)}" y="${Y0 + 40}" font-size="24" text-anchor="middle" fill="var(--muted)">${label}</text>`;
const mid1 = 4 / Math.PI;
const edgeY = mid1 * Math.sin(0.4);
const peak13x = Math.PI - Math.PI / 26,
  peak50x = Math.PI - Math.PI / 100;
const waves = `<svg viewBox="0 0 1200 640">
<g id="axes"><line x1="${X0}" y1="${Y0}" x2="${X1}" y2="${Y0}" stroke="var(--muted)" stroke-width="2"/><line x1="${X0}" y1="${py(1.5)}" x2="${X0}" y2="${py(-1.5)}" stroke="var(--muted)" stroke-width="2"/>
${[1, 2, 3, 4].map((q) => tick((q * Math.PI) / 2, f2((q * Math.PI) / 2))).join('')}
<text x="${X0 - 14}" y="${py(1) + 8}" font-size="24" text-anchor="end" fill="var(--muted)">1</text><text x="${X0 - 14}" y="${py(-1) + 8}" font-size="24" text-anchor="end" fill="var(--muted)">−1</text>
<line x1="${X0 - 6}" y1="${py(1)}" x2="${X0 + 6}" y2="${py(1)}" stroke="var(--muted)" stroke-width="2"/><line x1="${X0 - 6}" y1="${py(-1)}" x2="${X0 + 6}" y2="${py(-1)}" stroke="var(--muted)" stroke-width="2"/></g>
${path('square', `M${X0},${Y0} V${py(1)} H${px(Math.PI)} V${py(-1)} H${X1} V${Y0}`, 'stroke="var(--muted)" stroke-width="3" stroke-dasharray="12 9"')}
${path('sin1', curve(Math.sin), good)}
${path(
  'sinA',
  curve((x) => mid1 * Math.sin(x)),
  good,
)}
${path(
  'next3',
  curve((x) => (4 / (3 * Math.PI)) * Math.sin(3 * x)),
  'stroke="var(--text)" stroke-width="3" stroke-dasharray="10 8"',
)}
${path('wave', sumCurve(1), good)}
${[2, 3, 5].map((n) => path(`n${n}`, sumCurve(n), good)).join('')}
${path('n13', sumCurve(13), good)}
${path('n50', sumCurve(50), good)}
${pointG('mid', Math.PI / 2, mid1, f2(mid1))}
${pointG('edge', 0.4, edgeY, f2(edgeY), 'below')}
${pointG('peak13', peak13x, peaks[1].y, f3(peaks[1].y), 'left')}
${pointG('peak50', peak50x, peaks[2].y, f3(peaks[2].y), 'left')}
<text id="question" x="900" y="64" font-size="30" text-anchor="middle">Can smooth waves add up to a sharp jump?</text>
</svg>`;
const ALL = [
  'sin1',
  'sinA',
  'next3',
  'wave',
  'n2',
  'n3',
  'n5',
  'n13',
  'n50',
  'mid',
  'edge',
  'peak13',
  'peak50',
  'question',
];
const except = (...ids) => ALL.filter((id) => !ids.includes(id));
const midShift = (n) => `translate(0 ${((middle(1) - middle(n)) * YK).toFixed(1)})`;

const hook = {
  type: 'svg',
  chapter: 'The puzzle',
  title: 'Smooth waves, and a shape that jumps',
  picture: 'waves',
  narration: 'Here is a strange claim. Add enough perfectly smooth waves, and you get a shape with a sharp jump in it.',
  hidden: [...except(), 'square'],
  labels: { sin1: 'sine wave', square: 'square wave', question: 'how could this ever work' },
  steps: [
    {
      trace: [{ ref: 'sin1', when: 'bends' }],
      focus: 'sin1',
      say: 'A sine wave bends gently, everywhere. It never has a corner.',
    },
    {
      trace: [{ ref: 'square', when: 'sits flat' }],
      focus: 'square',
      say: 'A square wave sits flat, then jumps straight down, then jumps back up.',
    },
    {
      show: ['question'],
      focus: 'question',
      say: 'Adding smooth things should give something smooth. So how could this ever work? Let us try it and see.',
    },
  ],
};

const oneWave = {
  type: 'svg',
  chapter: 'One wave',
  title: 'The best single wave is still wrong',
  picture: 'waves',
  narration: 'The dashed line is our target, the square wave. It is one for half the time, then minus one.',
  hidden: except('sin1'),
  labels: { sin1: 'sin x', sinA: 'stretch', mid: 'middle', edge: 'near the jump' },
  steps: [
    {
      focus: ['sin1', 'square'],
      say: 'Start with the plainest wave there is, sin x. It goes up when the square wave is up, and down when it is down.',
    },
    {
      hide: ['sin1'],
      trace: [{ ref: 'sinA', when: 'stretch' }],
      focus: 'sinA',
      say: `Now stretch it until it matches the target as well as one wave can. That is a height of four over pi.`,
      draw: [{ write: `best height: 4 ÷ π = ${f2(mid1)}`, near: 'sinA', side: 'right', when: 'four over pi' }],
    },
    {
      show: ['mid'],
      erase: true,
      focus: ['mid'],
      tint: { mid: 'bad' },
      say: `It is not a good match yet. In the middle it climbs to ${f2(middle(1))}, too high.`,
      draw: [{ write: 'too high', near: 'mid', side: 'right', when: 'too high', tone: 'bad' }],
    },
    {
      show: ['edge'],
      focus: ['edge'],
      say: `And near the jump it is far too low, only ${f2(edgeY)}.`,
      draw: [{ write: 'too low', near: 'edge', side: 'right', when: 'far too low', tone: 'bad' }],
    },
  ],
};

const addWaves = {
  type: 'svg',
  chapter: 'Adding waves',
  title: 'Each faster, smaller wave fixes some of the error',
  picture: 'waves',
  narration: 'To fix it, we add a second wave, three times as fast and one third as tall.',
  hidden: except('sinA', 'mid'),
  labels: { next3: 'small, fast wave', wave: 'add it in', mid: 'middle' },
  steps: [
    {
      hide: ['edge'],
      trace: [{ ref: 'next3', when: 'alone' }],
      focus: ['next3'],
      say: 'Here is that small, fast wave alone. It dips at the centre and rises at the edges, just where the first wave was wrong.',
    },
    {
      hide: ['next3', 'sinA'],
      show: ['wave'],
      morph: { wave: 'n2' },
      move: { mid: midShift(2) },
      set: { 'mid-v': f2(middle(2)) },
      focus: ['wave', 'mid'],
      say: `Add it in. The middle drops from ${f2(middle(1))} to ${f2(middle(2))}, now a little too low, and the shoulders lift.`,
    },
    {
      morph: { wave: 'n3' },
      move: { mid: midShift(3) },
      set: { 'mid-v': f2(middle(3)) },
      focus: ['wave', 'mid'],
      say: `Then add one five times as fast and one fifth as tall. With it, the middle comes back up to ${f2(middle(3))}.`,
    },
    {
      morph: { wave: 'n5' },
      move: { mid: midShift(5) },
      set: { 'mid-v': f2(middle(5)) },
      focus: ['wave', 'mid'],
      say: `Each wave fixes some of the last one's mistake. With five, the middle is ${f2(middle(5))} and the sides are getting steep.`,
      draw: [{ write: 'sin x + sin 3x ÷ 3 + sin 5x ÷ 5 + …', near: 'wave', side: 'below', when: 'Each wave' }],
    },
  ],
};

// The recipe: each wave's height as a bar, odd waves only; the even slots are drawn empty.
const BASE = 560,
  HK = 330;
const slotX = (k) => 110 + (k - 1) * 96;
const slot = (k) => {
  const h = k % 2 ? heights[ODD.indexOf(k)] : 0;
  const x = slotX(k);
  const name = k === 1 ? 'sin x' : `sin ${k}x`;
  const bar = h
    ? `<rect x="${x - 30}" y="${(BASE - h * HK).toFixed(1)}" width="60" height="${(h * HK).toFixed(1)}" class="tone-good" stroke-width="3"/><text x="${x}" y="${(BASE - h * HK - 14).toFixed(1)}" font-size="24" text-anchor="middle">${f2(h)}</text>`
    : `<text x="${x}" y="${BASE - 14}" font-size="24" text-anchor="middle" fill="var(--muted)">0</text>`;
  return `<g id="k${k}">${bar}<text x="${x}" y="${BASE + 40}" font-size="24" text-anchor="middle"${h ? '' : ' fill="var(--muted)"'}>${name}</text></g>`;
};
const recipeSvg = `<svg viewBox="0 0 1200 640"><line x1="50" y1="${BASE}" x2="1170" y2="${BASE}" stroke="var(--muted)" stroke-width="3"/>${Array.from({ length: 11 }, (_, i) => slot(i + 1)).join('')}</svg>`;
const EVEN = [2, 4, 6, 8, 10];
const recipe = {
  type: 'svg',
  chapter: 'The recipe',
  title: 'Each wave is a third, a fifth, a seventh as tall',
  svg: recipeSvg,
  narration: 'So what is the recipe? How much each wave lines up with the square wave tells you how tall to make it.',
  hidden: ODD.slice(1)
    .map((k) => `k${k}`)
    .concat(EVEN.map((k) => `k${k}`)),
  labels: { k1: 'first wave', k3: 'three times', k5: 'five times', k2: 'two', k4: 'four' },
  steps: [
    { focus: 'k1', say: `The first wave lines up best, so it is the tallest, ${f2(heights[0])}.` },
    {
      show: ['k3', 'k5'],
      focus: ['k3', 'k5'],
      say: 'The wave three times as fast gets a third of that. Five times as fast, a fifth.',
    },
    {
      show: ['k7', 'k9', 'k11'],
      focus: ['k7', 'k9', 'k11'],
      say: 'And so on, smaller and smaller, forever.',
      draw: [{ write: 'height = 4 ÷ (π × k)', near: 'k3', side: 'above', when: 'smaller and smaller' }],
    },
    {
      focus: ['k1', 'k3', 'k5'],
      say: 'Notice the list skips from one to three to five. What about waves two or four times as fast?',
      draw: [{ circle: 'k2', when: 'two or four' }, { circle: 'k4' }],
    },
    {
      show: EVEN.map((k) => `k${k}`),
      focus: ['k2', 'k4'],
      say: 'They line up with the top half exactly as much as they fight it, so they cancel out. Their height is zero.',
    },
    {
      focus: ODD.map((k) => `k${k}`),
      say: 'Only the odd ones are in the recipe.',
      draw: [{ write: 'odd waves only', near: 'k9', side: 'above', when: 'odd ones' }],
    },
  ],
};

const jump = {
  type: 'svg',
  chapter: 'The jump',
  title: 'More waves, but the bump stays',
  picture: 'waves',
  narration: 'Here is the sum again, with the jump down at pi in the middle. Let us keep adding waves.',
  hidden: except('wave'),
  labels: { peak13: 'just before it', n50: 'fifty', peak50: 'bump' },
  steps: [
    {
      morph: { wave: 'n13' },
      focus: 'wave',
      say: `With thirteen of them, the fastest is twenty five times as fast as the first, and the middle is ${f2(middle(13))}, almost exactly one.`,
    },
    {
      show: ['peak13'],
      camera: { on: 'peak13', zoom: 3 },
      focus: ['peak13'],
      say: `But look closely at the jump. Just before it, the sum shoots past one, up to ${f2(peaks[1].y)}.`,
    },
    {
      morph: { wave: 'n50' },
      hide: ['peak13'],
      show: ['peak50'],
      focus: ['peak50'],
      say: `Surely more waves fix that. Here are fifty. The bump gets thinner and moves closer to the jump, but it is still ${f2(peaks[2].y)} tall.`,
      draw: [{ write: 'still there', near: 'peak50', side: 'left', when: 'still' }],
    },
    {
      camera: 'all',
      erase: true,
      focus: ['wave'],
      say: 'Everywhere else the sum gets as close as you like. At the jump, it always overshoots by about nine percent of the jump.',
      draw: [
        {
          write: `overshoot: ${Math.round(overshoot * 100)}% of the jump`,
          near: 'peak50',
          side: 'right',
          when: 'overshoots',
        },
      ],
    },
  ],
};

// The bump at each count of waves: its top as a bar against the limit, and its distance from the jump as a bar.
const rowY = (i) => 200 + i * 100;
const TOPK = 300,
  DISTK = 1100;
const bumpRow = (n, i) => {
  const p = peaks[i],
    d = Math.PI / (2 * n);
  return `<g id="row${i}"><text x="150" y="${rowY(i) + 10}" font-size="28" text-anchor="end">${n} waves</text>
<g id="top${i}"><rect x="190" y="${rowY(i) - 22}" width="${(p.y * TOPK).toFixed(1)}" height="44" class="tone-bad" stroke-width="3"/><text x="${(190 + p.y * TOPK + 14).toFixed(1)}" y="${rowY(i) + 10}" font-size="26">${f3(p.y)}</text></g>
<g id="dist${i}"><rect x="720" y="${rowY(i) - 22}" width="${(d * DISTK).toFixed(1)}" height="44" stroke-width="3"/><text x="${(720 + d * DISTK + 14).toFixed(1)}" y="${rowY(i) + 10}" font-size="26">${f3(d)}</text></g></g>`;
};
const bumpSvg = `<svg viewBox="0 0 1200 640">
<text x="190" y="110" font-size="28" fill="var(--muted)">top of the bump</text><text x="720" y="110" font-size="28" fill="var(--muted)">distance from the jump</text>
${PEAK_N.map(bumpRow).join('')}
<g id="limit"><line x1="${(190 + limit * TOPK).toFixed(1)}" y1="140" x2="${(190 + limit * TOPK).toFixed(1)}" y2="600" stroke="var(--text)" stroke-width="3" stroke-dasharray="10 8"/><text x="${(190 + limit * TOPK).toFixed(1)}" y="630" font-size="26" text-anchor="middle">${f3(limit)}</text></g>
<g id="one"><line x1="${190 + TOPK}" y1="140" x2="${190 + TOPK}" y2="600" stroke="var(--muted)" stroke-width="2"/><text x="${190 + TOPK}" y="630" font-size="24" text-anchor="end" fill="var(--muted)">1  </text></g>
</svg>`;
const bump = {
  type: 'svg',
  chapter: 'The bump that stays',
  title: 'The bump stays as tall, and only gets thinner',
  svg: bumpSvg,
  narration:
    'Here are the numbers. For each count of waves, how high the bump climbs, and how far it sits from the jump.',
  hidden: ['row0', 'row1', 'row2', 'row3', 'limit'],
  labels: {
    row0: 'five waves',
    row1: 'thirteen',
    row2: 'fifty',
    row3: 'two hundred',
    limit: 'heads to',
    top3: 'height',
  },
  steps: [
    {
      show: ['row0', 'row1'],
      focus: ['row0', 'row1'],
      say: `Five waves, ${f3(peaks[0].y)}. Thirteen, ${f3(peaks[1].y)}.`,
    },
    {
      show: ['row2', 'row3'],
      focus: ['row2', 'row3'],
      say: `Fifty, ${f3(peaks[2].y)}. Two hundred, ${f3(peaks[3].y)}. The height settles and stops falling.`,
    },
    {
      focus: ['dist0', 'dist1', 'dist2', 'dist3'],
      say: 'Meanwhile the bump squeezes toward the jump, a quarter as far away for four times the waves.',
    },
    {
      show: ['limit'],
      focus: ['limit', 'top3'],
      say: `The height heads to ${f3(limit)}, never to one. People call this the Gibbs phenomenon.`,
      draw: [{ write: 'the Gibbs phenomenon', near: 'dist3', side: 'right', when: 'Gibbs' }],
    },
  ],
};

const takeaway = {
  type: 'svg',
  chapter: 'What to keep',
  title: 'Smooth waves can build a jump, almost',
  picture: 'waves',
  narration: 'So, can smooth waves make a sharp jump? Almost.',
  hidden: except('n50'),
  labels: { next3: 'odd waves', n50: 'every wave', peak50: 'overshoot' },
  steps: [
    {
      show: ['next3'],
      focus: 'next3',
      say: 'The recipe is simple: the odd waves, each one a third, a fifth, a seventh as tall.',
      draw: [{ write: 'odd waves: 1, 1/3, 1/5, 1/7 as tall', near: 'next3', side: 'below', when: 'odd waves' }],
    },
    {
      hide: ['next3'],
      focus: 'n50',
      say: 'Every wave you add fixes part of what the others got wrong.',
      draw: [{ write: 'each fixes part of the mistake', near: 'n50', side: 'below', when: 'fixes' }],
    },
    {
      show: ['peak50'],
      focus: 'peak50',
      say: 'But right at the jump, no amount of waves can fix one mistake: an overshoot of about nine percent, that only gets thinner.',
      draw: [{ circle: 'peak50', when: 'overshoot' }],
    },
  ],
};

const storyboard = {
  title: 'A square wave from sine waves',
  subtitle: 'How smooth waves add up to a sharp jump, and the bump that never goes away',
  tones: { good: 'the waves and their sum', bad: 'where the sum misses the square wave' },
  pictures: { waves },
  scenes: [hook, oneWave, addWaves, recipe, jump, bump, takeaway],
};
const here = (f) => new URL(f, import.meta.url);
fs.writeFileSync(here('storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
fs.writeFileSync(here('hunks.json'), '{}\n');
fs.writeFileSync(here('meta.json'), `${JSON.stringify({ mode: 'explain' })}\n`);
console.log(`heights: ${heights.map(f3).join(', ')}`);
console.log(`middle at 1, 2, 3, 5, 13 waves: ${[1, 2, 3, 5, 13].map((n) => middle(n).toFixed(4)).join(', ')}`);
console.log(
  `peaks at ${PEAK_N.join(', ')} waves: ${peaks.map((p) => p.y.toFixed(4)).join(', ')}; limit ${limit.toFixed(5)}; overshoot ${(overshoot * 100).toFixed(2)}%`,
);
