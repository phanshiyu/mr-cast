// Writes storyboard.json, hunks.json and meta.json beside this file. Every number on screen is computed here or read
// from facts.json, made with h3-js 4.1.0: cellToParent(cell, 7) for the cell 8828308281fffff, getNumCells(0), and per
// level getHexagonAreaAvg(res, 'km2') and the mean edgeLength(e, 'km') over originToDirectedEdges of the cells under
// 5,000 random points on the sphere (`rnd` below, seeded with 11). Run: node examples/architecture/h3/generate.mjs
import fs from 'node:fs';

const facts = JSON.parse(fs.readFileSync(new URL('./facts.json', import.meta.url), 'utf8'));
const f1 = n => n.toFixed(1);
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pts = a => a.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ');
const svg = (w, h, body) => `<svg viewBox="0 0 ${w} ${h}">${body}</svg>`;
const text = (x, y, s, size, extra = '') => `<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" ${extra}>${s}</text>`;
const hexPts = (cx, cy, r, rot = 0) => Array.from({ length: 6 }, (_, k) => {
  const a = (rot + 60 * k) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});

// ---------- Scene 1: the city map ----------
function cityMap() {
  const X0 = 20, Y0 = 30, W = 720, H = 500;
  const xs = [X0, X0 + 250, X0 + 480, X0 + W], ys = [Y0, Y0 + 230, Y0 + H];
  const P = ys.map((y, j) => xs.map((x, i) => {
    const inner = i > 0 && i < 3, innerY = j === 1;
    return [x + (inner ? (rnd() - 0.5) * 60 : 0), y + (innerY && i > 0 && i < 3 ? (rnd() - 0.5) * 50 : innerY ? (rnd() - 0.5) * 40 : 0)];
  }));
  const edges = new Map();
  const edge = (a, b, boundary) => {
    const key = `${a}|${b}`;
    if (edges.has(key)) return edges.get(key);
    if (edges.has(`${b}|${a}`)) return [...edges.get(`${b}|${a}`)].reverse();
    const [p, q] = [a.split(',').map(Number), b.split(',').map(Number)];
    const A = P[p[0]][p[1]], B = P[q[0]][q[1]];
    const n = 10, line = [A];
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy);
    for (let k = 1; k < n; k++) {
      const t = k / n, j = boundary ? 0 : (rnd() - 0.5) * 34;
      line.push([A[0] + dx * t - dy / len * j, A[1] + dy * t + dx / len * j]);
    }
    line.push(B);
    edges.set(key, line);
    return line;
  };
  const zones = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) {
    const c = [[j, i], [j, i + 1], [j + 1, i + 1], [j + 1, i]].map(([a, b]) => `${a},${b}`);
    const ring = [];
    for (let k = 0; k < 4; k++) {
      const a = c[k], b = c[(k + 1) % 4];
      const boundary = (k === 0 && j === 0) || (k === 2 && j === 1) || (k === 3 && i === 0) || (k === 1 && i === 2);
      ring.push(...edge(a, b, boundary).slice(0, -1));
    }
    zones.push(ring);
  }
  const names = ['Riverside', 'Old Town', 'Harbour', 'Northgate', 'Midtown', 'Eastfield'];
  // the car sits just inside Old Town (zone 1), on its jagged border with Riverside (zone 0)
  const border = edges.get('0,1|1,1');
  const car = [border[4][0] + 3, border[4][1]];
  const dots = [];
  for (let k = 0; k < 150; k++) dots.push([X0 + 12 + rnd() * (W - 24), Y0 + 12 + rnd() * (H - 24)]);
  const drivers = dots.slice(0, 80).map(([x, y]) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="4.5"/>`).join('');
  const riders = dots.slice(80).map(([x, y]) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="4.5"/>`).join('');
  const zoneSvg = zones.map((z, k) => `<polygon id="zone-${k}" points="${pts(z)}" fill="var(--surface)" stroke="var(--muted)" stroke-width="2.5" stroke-linejoin="round"/>`).join('');
  const labels = zones.map((z, k) => {
    const cx = z.reduce((s, p) => s + p[0], 0) / z.length, cy = z.reduce((s, p) => s + p[1], 0) / z.length;
    return text(cx, cy + (k < 3 ? -40 : 50), names[k], 22, 'text-anchor="middle" fill="var(--faint)"');
  }).join('');
  // ray casting against Old Town's outline: count the outline edges the ray crosses
  const rayY = car[1];
  const hits = [];
  const ring = zones[1];
  for (let k = 0; k < ring.length; k++) {
    const [a, b] = [ring[k], ring[(k + 1) % ring.length]];
    if ((a[1] - rayY) * (b[1] - rayY) < 0) {
      const x = a[0] + (rayY - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
      if (x > car[0]) hits.push(x);
    }
  }
  if (hits.length % 2 !== 1) throw new Error(`car is not inside Old Town: ${hits.length} crossings`);
  const ray = `<g id="ray"><line x1="${f1(car[0])}" y1="${f1(rayY)}" x2="${X0 + W}" y2="${f1(rayY)}" stroke="var(--warn)" stroke-width="3" stroke-dasharray="10 7"/>${hits.map(x => `<circle cx="${f1(x)}" cy="${f1(rayY)}" r="8" fill="var(--warn)"/>`).join('')}</g>`;
  const R = 790;
  const body = [
    `<g id="zones">${zoneSvg}</g>`, labels,
    `<g id="riders" fill="var(--good)">${riders}</g>`,
    `<g id="drivers" fill="var(--accent)">${drivers}</g>`,
    ray,
    `<g id="car"><circle cx="${f1(car[0])}" cy="${f1(car[1])}" r="15" fill="var(--warn)" stroke="var(--text)" stroke-width="3"/></g>`,
    text(R, 70, 'Which zone is this car in?', 30, 'fill="var(--text)"'),
    `<g id="legend">${'<circle cx="806" cy="122" r="8" fill="var(--accent)"/>'}${text(824, 130, 'driver', 24, 'fill="var(--muted)"')}<circle cx="946" cy="122" r="8" fill="var(--good)"/>${text(964, 130, 'rider', 24, 'fill="var(--muted)"')}</g>`,
    `<g id="query">${text(R, 210, 'SELECT zone_id FROM zones', 23, 'font-family="mono"')}${text(R, 246, 'WHERE ST_Contains(geom,', 23, 'font-family="mono"')}${text(R + 40, 282, 'ST_Point(lng, lat));', 23, 'font-family="mono"')}</g>`,
    text(R, 360, 'For each car: walk every', 24, 'fill="var(--muted)"'),
    text(R, 392, 'edge of every zone border', 24, 'fill="var(--muted)"'),
    `<g id="timeout" class="tone-bad"><rect x="${R}" y="440" width="300" height="64" rx="12"/>${text(R + 150, 482, 'query timed out', 28, 'text-anchor="middle"')}</g>`,
  ].join('');
  return { svg: svg(1200, 560, body), crossings: hits.length };
}

// ---------- Scene 2: three tilings ----------
function tilings() {
  const parts = [];
  const lines = (cx, cy, targets, tone, dash) => targets.map(([x, y]) => `<line x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(x)}" y2="${f1(y)}"${dash ? ' stroke-dasharray="9 7"' : ''}/>`).join('');
  const lineGroup = (id, tone, inner) => `<g id="${id}" stroke="var(--${tone})" stroke-width="4" stroke-linecap="round">${inner}</g>`;
  // triangles: side a, centre triangle pointing up at (cx, cy)
  {
    const a = 92, h = a * Math.sqrt(3) / 2, ox = 200, oy = 270;
    const C = [ox, oy];
    const upV = [[ox - a / 2, oy + h / 3], [ox + a / 2, oy + h / 3], [ox, oy - 2 * h / 3]];
    const all = [];
    for (let j = -3; j <= 3; j++) for (let i = -4; i <= 4; i++) {
      const bx = ox - a / 2 + i * a + j * a / 2, by = oy + h / 3 - j * h; // lattice point
      all.push({ v: [[bx, by], [bx + a, by], [bx + a / 2, by - h]] });
      all.push({ v: [[bx + a, by], [bx + a / 2, by - h], [bx + 1.5 * a, by - h]] });
    }
    const cen = t => [(t.v[0][0] + t.v[1][0] + t.v[2][0]) / 3, (t.v[0][1] + t.v[1][1] + t.v[2][1]) / 3];
    const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.01;
    const d = a / Math.sqrt(3);
    const groups = { 1: [], 1.732: [], 2: [] };
    const shown = [];
    for (const t of all) {
      const c = cen(t);
      if (near(c, C)) continue;
      if (!t.v.some(p => upV.some(q => near(p, q)))) continue;
      shown.push(t);
      const k = (Math.hypot(c[0] - C[0], c[1] - C[1]) / d).toFixed(3);
      groups[k === '1.000' ? 1 : k === '1.732' ? 1.732 : 2].push(c);
    }
    parts.push(text(200, 40, 'Triangles', 28, 'text-anchor="middle" fill="var(--muted)"'));
    parts.push(`<g id="tri-cells">${shown.map(t => `<polygon points="${pts(t.v)}" stroke-width="2"/>`).join('')}</g>`);
    parts.push(`<polygon id="tri-me" points="${pts(upV)}" class="tone-accent"/>`);
    parts.push(lineGroup('tri-near', 'good', lines(...C, groups[1])));
    parts.push(lineGroup('tri-mid', 'warn', lines(...C, groups[1.732], true)));
    parts.push(lineGroup('tri-far', 'bad', lines(...C, groups[2], true)));
    parts.push(`<g id="tri-note">${text(200, 470, '3 at d, 6 at 1.73 d,', 26, 'text-anchor="middle"')}${text(200, 506, '3 at 2 d', 26, 'text-anchor="middle"')}</g>`);
    if (groups[1].length !== 3 || groups[1.732].length !== 6 || groups[2].length !== 3) throw new Error('triangle neighbours');
  }
  // squares
  {
    const s = 96, cx = 600, cy = 260;
    const side = [], corner = [];
    let cells = '';
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if (!i && !j) continue;
      const r = `<rect x="${cx + i * s - s / 2 + 4}" y="${cy + j * s - s / 2 + 4}" width="${s - 8}" height="${s - 8}" rx="8"/>`;
      (i && j ? corner : side).push([cx + i * s, cy + j * s, r]);
    }
    parts.push(text(cx, 40, 'Squares', 28, 'text-anchor="middle" fill="var(--muted)"'));
    parts.push(`<g id="sq-sides">${side.map(c => c[2]).join('')}</g><g id="sq-corners">${corner.map(c => c[2]).join('')}</g>`);
    parts.push(`<rect id="sq-me" x="${cx - s / 2 + 4}" y="${cy - s / 2 + 4}" width="${s - 8}" height="${s - 8}" rx="8" class="tone-accent"/>`);
    parts.push(lineGroup('sq-near', 'good', lines(cx, cy, side)));
    parts.push(lineGroup('sq-far', 'bad', lines(cx, cy, corner, true)));
    parts.push(`<g id="sq-note">${text(cx, 470, '4 at d, 4 at 1.41 d', 26, 'text-anchor="middle"')}</g>`);
  }
  // hexagons
  {
    const r = 58, cx = 1000, cy = 260, dd = r * Math.sqrt(3);
    const ring = Array.from({ length: 6 }, (_, k) => {
      const ang = (30 + 60 * k) * Math.PI / 180;
      return [cx + dd * Math.cos(ang), cy + dd * Math.sin(ang)];
    });
    parts.push(text(cx, 40, 'Hexagons', 28, 'text-anchor="middle" fill="var(--muted)"'));
    parts.push(`<g id="hex-ring">${ring.map(([x, y]) => `<polygon points="${pts(hexPts(x, y, r - 4))}"/>`).join('')}</g>`);
    parts.push(`<polygon id="hex-me" points="${pts(hexPts(cx, cy, r - 4))}" class="tone-accent"/>`);
    parts.push(lineGroup('hex-near', 'good', lines(cx, cy, ring)));
    parts.push(`<g id="hex-note">${text(cx, 470, '6 at d', 26, 'text-anchor="middle"')}</g>`);
  }
  return svg(1200, 530, parts.join(''));
}

// ---------- Scene 3: the icosahedron ----------
function icosahedron() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const V = [];
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) { V.push([0, s1, s2 * phi]); V.push([s1, s2 * phi, 0]); V.push([s2 * phi, 0, s1]); }
  const E = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
    const d = Math.hypot(...V[i].map((v, k) => v - V[j][k]));
    if (Math.abs(d - 2) < 1e-9) E.push([i, j]);
  }
  const F = [];
  for (const [i, j] of E) for (let k = j + 1; k < 12; k++)
    if (E.some(e => e[0] === Math.min(i, k) && e[1] === Math.max(i, k)) && E.some(e => e[0] === Math.min(j, k) && e[1] === Math.max(j, k))) F.push([i, j, k]);
  if (V.length !== 12 || E.length !== 30 || F.length !== 20) throw new Error(`icosahedron ${V.length} ${E.length} ${F.length}`);
  const rot = (p, ax, ay) => {
    let [x, y, z] = p;
    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
    return [x, y, z];
  };
  const R = Math.sqrt(1 + phi * phi), S = 200 / R, cx = 250, cy = 280;
  const P = V.map(p => rot(p, 0.42, 0.33)).map(([x, y, z]) => [cx + x * S, cy - y * S, z]);
  const front = E.filter(([i, j]) => P[i][2] + P[j][2] > -0.05);
  const back = E.filter(([i, j]) => P[i][2] + P[j][2] <= -0.05);
  const pent = (x, y, r) => Array.from({ length: 5 }, (_, k) => {
    const a = (-90 + 72 * k) * Math.PI / 180;
    return [x + r * Math.cos(a), y + r * Math.sin(a)];
  });
  const parts = [];
  parts.push(`<circle id="sphere" cx="${cx}" cy="${cy}" r="200" fill="var(--surface)" stroke="var(--border)" stroke-width="3"/>`);
  parts.push(`<g id="ico"><g stroke="var(--faint)" stroke-width="2" stroke-dasharray="6 6">${back.map(([i, j]) => `<line x1="${f1(P[i][0])}" y1="${f1(P[i][1])}" x2="${f1(P[j][0])}" y2="${f1(P[j][1])}"/>`).join('')}</g><g stroke="var(--accent)" stroke-width="3">${front.map(([i, j]) => `<line x1="${f1(P[i][0])}" y1="${f1(P[i][1])}" x2="${f1(P[j][0])}" y2="${f1(P[j][1])}"/>`).join('')}</g></g>`);
  parts.push(`<g id="corners">${P.map(([x, y, z]) => `<polygon points="${pts(pent(x, y, z > 0 ? 13 : 9))}" fill="var(--warn)" stroke="var(--bg)" stroke-width="2"${z > 0 ? '' : ' opacity="0.45"'}/>`).join('')}</g>`);
  // the net: 5 caps, a strip of 10, 5 bottoms
  const s = 88, h = s * Math.sqrt(3) / 2, nx = 620, ny = 150;
  const tris = [];
  for (let k = 0; k < 5; k++) {
    const x = nx + k * s;
    tris.push([[x, ny], [x + s, ny], [x + s / 2, ny - h]]);
    tris.push([[x, ny], [x + s, ny], [x + s / 2, ny + h]]);
    tris.push([[x + s, ny], [x + s / 2, ny + h], [x + 1.5 * s, ny + h]]);
    tris.push([[x + s / 2, ny + h], [x + 1.5 * s, ny + h], [x + s, ny + 2 * h]]);
  }
  parts.push(`<g id="net">${tris.map(t => `<polygon points="${pts(t)}" fill="var(--surface)" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>`).join('')}</g>`);
  const netV = [];
  for (let k = 0; k < 5; k++) netV.push([nx + k * s + s / 2, ny - h], [nx + k * s + s / 2 + s / 2, ny + 2 * h]);
  for (let k = 0; k <= 5; k++) netV.push([nx + k * s, ny], [nx + k * s + s / 2, ny + h]);
  parts.push(`<g id="net-corners">${netV.map(([x, y]) => `<polygon points="${pts(pent(x, y, 11))}" fill="var(--warn)" stroke="var(--bg)" stroke-width="2"/>`).join('')}</g>`);
  parts.push(text(250, 530, 'A ball with 20 triangles inside', 24, 'text-anchor="middle" fill="var(--muted)"'));
  parts.push(`<g id="net-label">${text(860, 530, 'Cut open and laid flat', 24, 'text-anchor="middle" fill="var(--muted)"')}</g>`);
  parts.push(`<g id="ocean" class="tone-good"><rect x="660" y="390" width="400" height="64" rx="12"/>${text(860, 432, 'all 12 corners in the ocean', 26, 'text-anchor="middle"')}</g>`);
  return { svg: svg(1200, 560, parts.join('')), V: V.length, E: E.length, F: F.length };
}

// ---------- Scene 4: seven children ----------
function aperture7() {
  const R = 230, cx = 300, cy = 285;
  const rotC = Math.atan(Math.sqrt(3) / 5) * 180 / Math.PI;
  const kids = (x, y, r, rot) => {
    const rc = r / Math.sqrt(7), rr = rot + rotC;
    return [[x, y], ...Array.from({ length: 6 }, (_, k) => {
      const a = (rr + 30 + 60 * k) * Math.PI / 180;
      return [x + Math.sqrt(3) * rc * Math.cos(a), y + Math.sqrt(3) * rc * Math.sin(a)];
    })].map(([px, py]) => ({ x: px, y: py, r: rc, rot: rr }));
  };
  const children = kids(cx, cy, R, 0);
  const grand = children.flatMap(c => kids(c.x, c.y, c.r, c.rot));
  const poly = (c, extra) => `<polygon points="${pts(hexPts(c.x, c.y, c.r, c.rot))}" ${extra}/>`;
  const parts = [];
  parts.push(`<g id="grandchildren">${grand.map(g => poly(g, 'fill="none" stroke="var(--faint)" stroke-width="1.5"')).join('')}</g>`);
  parts.push(`<g id="children">${children.map((c, k) => poly(c, `fill="none" stroke="var(--accent)" stroke-width="3.5"${k ? '' : ''}`)).join('')}</g>`);
  parts.push(`<polygon id="parent" points="${pts(hexPts(cx, cy, R, 0))}" fill="none" stroke="var(--text)" stroke-width="5" stroke-linejoin="round"/>`);
  const a0 = [cx + (R + 20) * Math.cos(0), cy];
  const a1 = [cx + (R / Math.sqrt(7)) * Math.cos(rotC * Math.PI / 180), cy + (R / Math.sqrt(7)) * Math.sin(rotC * Math.PI / 180)];
  const arcR = 120;
  parts.push(`<g id="angle" stroke="var(--warn)" stroke-width="3" fill="none"><line x1="${cx}" y1="${cy}" x2="${f1(cx + 200)}" y2="${cy}"/><line x1="${cx}" y1="${cy}" x2="${f1(cx + 200 * Math.cos(rotC * Math.PI / 180))}" y2="${f1(cy + 200 * Math.sin(rotC * Math.PI / 180))}"/><path d="M ${cx + arcR} ${cy} A ${arcR} ${arcR} 0 0 1 ${f1(cx + arcR * Math.cos(rotC * Math.PI / 180))} ${f1(cy + arcR * Math.sin(rotC * Math.PI / 180))}"/></g>`);
  parts.push(`<g id="angle-label">${text(cx + 205, cy + 60, '19.1°', 26, 'fill="var(--warn)"')}</g>`);
  const T = 640;
  parts.push(`<g id="count-1">${text(T, 140, 'Level 0: one big cell', 30)}</g>`);
  parts.push(`<g id="count-2">${text(T, 210, 'Level 1: 7 cells inside it', 30, 'fill="var(--accent)"')}</g>`);
  parts.push(`<g id="count-3">${text(T, 280, 'Level 2: 7 × 7 = 49', 30, 'fill="var(--muted)"')}</g>`);
  parts.push(`<g id="count-4">${text(T, 350, '16 levels, 0 to 15', 30)}</g>`);
  parts.push(`<g id="poke" class="tone-warn"><rect x="${T}" y="400" width="500" height="96" rx="12"/>${text(T + 250, 440, 'The children stick out a little:', 25, 'text-anchor="middle"')}${text(T + 250, 474, 'they cover the parent only roughly', 25, 'text-anchor="middle"')}</g>`);
  return { svg: svg(1200, 560, parts.join('')), rot: rotC };
}


// ---------- the 64-bit cell index ----------
function register(hex, parentHex) {
  const n = BigInt('0x' + hex), pn = BigInt('0x' + parentHex);
  const bit = (v, i) => Number((v >> BigInt(i)) & 1n);
  const fields = [
    { id: 'f-reserved', hi: 63, len: 1, name: '', tone: 'neutral' },
    { id: 'f-mode', hi: 62, len: 4, name: 'mode', tone: 'accent' },
    { id: 'f-spare', hi: 58, len: 3, name: '', tone: 'neutral' },
    { id: 'f-level', hi: 55, len: 4, name: 'level', tone: 'warn' },
    { id: 'f-base', hi: 51, len: 7, name: 'base cell', tone: 'good' },
    ...Array.from({ length: 15 }, (_, k) => ({ id: `f-d${k + 1}`, hi: 44 - 3 * k, len: 3, name: `${k + 1}`, tone: k < 8 ? 'accent' : 'neutral' })),
  ];
  const X = 24, BW = 18, Y = 170, BH = 40;
  const xOf = i => X + (63 - i) * BW;
  const val = (v, f) => Number((v >> BigInt(f.hi - f.len + 1)) & ((1n << BigInt(f.len)) - 1n));
  const parts = [];
  parts.push(text(600, 60, hex, 40, 'id="hex" text-anchor="middle" font-family="mono"'));
  parts.push(text(600, 100, 'one 64-bit number, bit 63 on the left', 22, 'text-anchor="middle" fill="var(--muted)"'));
  const changed = [];
  for (const f of fields) {
    const x0 = xOf(f.hi), w = f.len * BW;
    const bits = [];
    for (let i = f.hi; i > f.hi - f.len; i--) {
      const id = `b${i}`;
      bits.push(`<rect x="${xOf(i) + 1}" y="${Y}" width="${BW - 2}" height="${BH}" rx="3"/>`);
      bits.push(text(xOf(i) + BW / 2, Y + 27, String(bit(n, i)), 18, `id="${id}" text-anchor="middle" font-family="mono"`));
      if (bit(n, i) !== bit(pn, i)) changed.push([id, String(bit(pn, i))]);
    }
    parts.push(`<g id="${f.id}" class="tone-${f.tone}">${bits.join('')}</g>`);
    if (f.name) parts.push(text(x0 + w / 2, Y - 14, f.name, f.len > 3 ? 20 : 18, `text-anchor="middle" fill="var(--muted)"`));
    parts.push(text(x0 + w / 2, Y + BH + 34, String(val(n, f)), 22, `id="v-${f.id.slice(2)}" text-anchor="middle"`));
  }
  parts.push(`<g id="digits-label">${text(xOf(44) + 22.5 * BW, Y + BH + 84, 'one digit per level, 1 to 15: which of 7 children', 22, 'text-anchor="middle" fill="var(--muted)"')}</g>`);
  parts.push(`<g id="unused-label">${text(xOf(20) + 10.5 * BW, Y + BH + 124, '7 = level not used', 22, 'text-anchor="middle" fill="var(--muted)"')}</g>`);
  const set = Object.fromEntries(changed);
  set.hex = parentHex;
  set['v-level'] = String(val(pn, fields[3]));
  set['v-d8'] = String(val(pn, fields[12]));
  return { svg: svg(1200, 360, parts.join('')), set, changed: changed.map(c => c[0]) };
}

// ---------- the hex grid for the k-ring ----------
function kring() {
  const rows = 7, cols = 9, cr = 3, cc = 4;
  // odd rows sit half a cell right (the array scene's hex layout); convert to cube coordinates
  const cube = (r, c) => { const q = c - (r - (r & 1)) / 2; return [q, r, -q - r]; };
  const dist = (a, b) => Math.max(...a.map((v, k) => Math.abs(v - b[k])));
  const o = cube(cr, cc);
  const ring = { 1: [], 2: [] };
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const d = dist(cube(r, c), o);
      if (d === 1 || d === 2) ring[d].push(`r${r}[${c}]`);
      row.push(d);
    }
    grid.push(row);
  }
  return { rows, cols, cr, cc, ring, grid };
}

function build() {
  const map = cityMap();
  const ico = icosahedron();
  const ap = aperture7();
  const kr = kring();
  const reg = register(facts.cell, facts.parent7);
  if (kr.ring[1].length !== 6 || kr.ring[2].length !== 12) throw new Error('k-ring counts');
  // Each level as shown, with the number it stands for, checked against h3-js below.
  const levels = [
    [0, '4.4 million km²', 4.4e6, '1,280 km', 1280, `the ${facts.baseCells} starting cells`],
    [6, '36 km²', 36, '3.7 km', 3.7, 'trends across a city'],
    [7, '5.2 km²', 5.2, '1.4 km', 1.4, 'surge pricing, wide view'],
    [8, '0.74 km²', 0.74, '530 m', 0.53, 'surge pricing, local'],
    [9, '0.11 km²', 0.11, '200 m', 0.2, 'matching riders to drivers'],
    [15, '0.9 m²', 0.9e-6, '0.6 m', 0.6e-3, 'the smallest level'],
  ];
  const near = (shown, real) => Math.abs(shown - real) / real < 0.05;
  for (const [res, , area, , edge] of levels) {
    const real = facts.levels.find(l => l.res === res);
    if (!near(area, real.areaKm2) || !near(edge, real.meanEdgeKm)) throw new Error(`level ${res}: shown ${area} km², ${edge} km; h3-js says ${real.areaKm2}, ${real.meanEdgeKm}`);
  }
  // drivers: none at distance 1, three at distance 2, two farther out
  const cars = { 'r1[3]': 2, 'r4[6]': 2, 'r5[3]': 2, 'r0[8]': 4, 'r6[0]': 4 };
  for (const [ref, d] of Object.entries(cars)) {
    const [, r, c] = ref.match(/r(\d)\[(\d)\]/).map(Number);
    if (d === 2 ? kr.grid[r][c] !== 2 : kr.grid[r][c] < 3) throw new Error(`car ${ref} is at ${kr.grid[r][c]}, wanted ${d}`);
  }
  const arrays = Array.from({ length: kr.rows }, (_, r) => ({
    name: `r${r}`,
    values: Array.from({ length: kr.cols }, (_, c) => cars[`r${r}[${c}]`] ? 'car' : ''),
  }));
  arrays[kr.cr].values[kr.cc] = 'you';
  const tintOf = (refs, tone) => Object.fromEntries(refs.map(r => [r, tone]));
  const near3 = Object.keys(cars).filter(k => cars[k] === 2);

  const scenes = [
    {
      type: 'svg', chapter: 'The problem', title: 'A city as a ride app sees it',
      narration: 'Picture a busy city the way a ride app sees it. Every driver and every rider is a dot, and the city is cut into districts.',
      svg: map.svg,
      labels: { 'zone-1': 'Old Town', zones: 'districts', drivers: 'drivers', riders: 'riders', car: 'this car', ray: 'line out from it', query: 'database query', timeout: 'timed out' },
      hidden: ['ray', 'timeout'],
      steps: [
        { focus: ['zones'], say: 'The districts come from old maps, like postcodes. Their borders are jagged, and no two are the same size.' },
        { focus: ['drivers', 'riders', 'legend'], say: 'Each dot is a pair of numbers, a latitude and a longitude, and it moves every few seconds.' },
        { focus: ['car'], mark: 'circle', note: 'right on the border', say: 'This car sits right on the border between two of them. Cross the street, and it lands in the other one, with a different price.' },
        { show: ['ray'], focus: ['ray', 'zone-1'], callout: 'odd number of crossings = inside', say: `To learn if a point is inside Old Town, draw a line out from it and count how often it crosses Old Town\'s outline. It crosses ${map.crossings === 1 ? 'once' : map.crossings + ' times'}, an odd number, so the car is inside.` },
        { focus: ['query'], callout: 'each check walks every border edge', say: 'The database does this for every car. Each check walks every corner of every border it tests.' },
        { show: ['timeout'], say: 'With thousands of cars asking every few seconds, the query falls behind and times out.' },
      ],
    },
    {
      type: 'svg', chapter: 'Picking a shape', title: 'Three shapes that tile a flat map',
      narration: 'Only three regular shapes cover a flat map with no gaps: triangles, squares and hexagons. Look at how far away each cell\'s neighbours are.',
      svg: tilings(),
      labels: { 'tri-near': 'triangle neighbours', 'tri-mid': 'triangle neighbours', 'tri-far': 'triangle neighbours', 'sq-near': 'side neighbours', 'sq-far': 'corner neighbours', 'hex-near': 'hexagon neighbours', 'hex-ring': 'six neighbours', 'tri-cells': 'twelve triangles', 'sq-corners': 'corner squares' },
      steps: [
        { focus: ['tri-cells', 'tri-near', 'tri-mid', 'tri-far', 'tri-note'], say: 'A triangle touches twelve others, at three different distances. That makes "nearby" messy.' },
        { focus: ['sq-near', 'sq-note'], say: 'A square has four neighbours along its sides, all at the same distance, call it d.' },
        { focus: ['sq-far', 'sq-corners'], callout: '√2 ≈ 1.414, so corners are 41% farther', say: 'But the four corner neighbours are about one point four times as far. Forty one percent farther, yet they still count as next door.' },
        { focus: ['hex-ring', 'hex-near', 'hex-note'], callout: 'every neighbour at distance d', say: 'A hexagon has six neighbours, and every one is exactly the same distance away. No corner problem, so spreading things out to nearby cells stays even.' },
      ],
    },
    {
      type: 'svg', chapter: 'Wrapping the globe', title: 'From a ball to flat triangles',
      narration: 'The earth is a ball, and hexagons alone can\'t cover a ball. So H3 starts with a twenty sided shape inside it.',
      svg: ico.svg,
      labels: { sphere: 'ball', ico: 'twenty triangles', net: 'flat net', corners: 'twelve corners', 'net-corners': 'corners', ocean: 'ocean' },
      hidden: ['net', 'net-label', 'corners', 'net-corners', 'ocean'],
      steps: [
        { focus: ['sphere', 'ico'], callout: `${ico.F} faces, ${ico.E} edges, ${ico.V} corners`, say: 'Put a shape made of twenty triangles inside the ball, touching it at its corners.' },
        { show: ['net', 'net-label'], say: 'Cut it open and lay it flat. Each triangle becomes a flat map of its own patch of the earth, and hexagons tile each one.' },
        { show: ['corners', 'net-corners'], callout: 'V − E + F = 12 − 30 + 20 = 2', say: 'There\'s a catch at the twelve corners, where five triangles meet. A rule about closed shapes says some cells must have five sides, and here it\'s exactly twelve.' },
        { show: ['ocean'], say: 'So every level has twelve pentagons. H3 turns the shape so all twelve land in the ocean, where nobody calls a car.' },
      ],
    },
    {
      type: 'svg', chapter: 'Cells inside cells', title: 'Each cell holds seven smaller ones',
      narration: 'Here is one big hexagon. H3 fills it with smaller hexagons, then fills each of those again.',
      svg: ap.svg,
      labels: { parent: 'big cell', children: 'seven cells', grandchildren: 'forty nine', angle: 'turned', poke: 'stick out' },
      hidden: ['children', 'grandchildren', 'angle', 'angle-label', 'count-2', 'count-3', 'count-4', 'poke'],
      steps: [
        { focus: ['parent', 'count-1'], say: 'Start with one big cell.' },
        { show: ['children', 'count-2'], say: 'Seven smaller cells sit inside it: one in the middle and six around it.' },
        { show: ['angle', 'angle-label'], callout: `turned ${ap.rot.toFixed(1)}° each level`, say: 'Seven hexagons only make a big hexagon shape when they\'re turned, so each level sits turned about nineteen degrees from the one above.' },
        { show: ['grandchildren', 'count-3'], say: 'Do it again, and each of the seven holds seven more. Forty nine.' },
        { show: ['poke'], say: 'The fit isn\'t perfect. The small cells poke out past the big one\'s edge a little, and that\'s fine for counting cars.' },
        { show: ['count-4'], say: 'H3 repeats this sixteen times, from level zero to level fifteen.' },
      ],
    },
    {
      type: 'table', chapter: 'Picking a size', title: 'H3 levels Uber leans on',
      narration: 'Each level is about seven times smaller in area than the one above. Uber picks the level that fits the job.',
      columns: ['Level', 'Average area', 'Average edge', 'Used for'],
      rows: levels.map(([res, area, , edge, , use]) => ({ cells: [String(res), area, edge, use] })),
      tint: { 0: 'dim', 5: 'dim' },
      steps: [
        { focus: [0, 5], say: 'The biggest level has a hundred and twenty two cells for the whole planet. The smallest is under one square metre.' },
        { focus: 4, tint: { 4: 'accent' }, say: 'Matching happens at level nine, where a cell is about two hundred metres across an edge. That\'s about a city block.' },
        { focus: [2, 3], tint: { 2: 'good', 3: 'good' }, say: 'Surge pricing looks at levels seven and eight, where many blocks are counted together.' },
        { focus: 2, callout: 'level 9 cell → its level 7 parent', say: 'To go from a level nine cell to the level seven cell that holds it, you don\'t touch the map. You just change a few bits in its name.' },
      ],
    },
    {
      type: 'svg', chapter: 'One number per cell', title: 'A cell\'s name is one number',
      narration: 'Every H3 cell has a name that fits in one 64 bit number. This one names a cell in downtown San Francisco, at level eight.',
      svg: reg.svg,
      labels: { 'f-mode': 'mode', 'f-level': 'level', 'f-base': 'starting cell', hex: 'name', 'digits-label': 'digits', 'unused-label': 'not used' },
      hidden: ['unused-label'],
      steps: [
        { focus: ['f-reserved', 'f-mode', 'f-spare'], callout: 'mode 1 = this number names a cell', say: 'The first bits are housekeeping. The mode is one, which says this number names a cell.' },
        { focus: ['f-level', 'v-level'], callout: 'level: 4 bits, 0 to 15', say: 'Four bits hold the level. Here it\'s eight.' },
        { focus: ['f-base', 'v-base'], callout: 'starting cell: 7 bits, 0 to 121', say: 'Seven bits say which of the hundred and twenty two biggest cells it sits in. Here it\'s number twenty.' },
        { focus: ['f-d1', 'f-d2', 'f-d3', 'f-d4', 'f-d5', 'f-d6', 'f-d7', 'f-d8', 'digits-label'], callout: 'one digit per level: 0 to 6', say: 'Then come fifteen digits of three bits, each from zero to six. Each digit says which of the seven smaller cells to step into, one step at a time. This cell takes eight steps, so it uses eight digits.' },
        { show: ['unused-label'], tint: Object.fromEntries(Array.from({ length: 7 }, (_, k) => [`f-d${k + 9}`, 'dim'])), focus: ['unused-label', 'f-d9', 'f-d10', 'f-d11', 'f-d12', 'f-d13', 'f-d14', 'f-d15'], say: 'Levels this cell doesn\'t reach hold a seven, all three bits on, which means not used.' },
        { set: reg.set, tint: { 'f-level': 'good', 'f-d8': 'good' }, focus: ['hex', 'f-level', 'f-d8'], callout: 'parent: level 8 → 7, digit 8 → 7', say: 'To get the parent one level up, set the level to seven and mark the eighth digit not used. A few bit changes, and no map lookup.' },
      ],
    },
    {
      type: 'array', chapter: 'Finding nearby drivers', title: 'Searching ring by ring',
      narration: 'A rider asks for a car. Instead of measuring the distance to every car in the city, the app looks at cells around the rider.',
      cells: 'hex', indexes: false, arrays,
      tint: { [`r${kr.cr}[${kr.cc}]`]: 'accent' },
      callout: 'old way: √(dx² + dy²) for every car',
      steps: [
        { focus: `r${kr.cr}[${kr.cc}]`, say: 'The rider is in this cell. Its name is one number.' },
        { tint: tintOf(kr.ring[1], 'warn'), callout: 'ring 1: 6 cells, 0 cars', say: 'First, look up the six cells that touch it. Each is one lookup in a table of cars by cell. No cars there.' },
        { tint: tintOf(kr.ring[2], 'good'), callout: 'ring 2: 12 more cells, 19 in all, 3 cars', say: 'Widen by one ring. That\'s twelve more cells, nineteen in all, and three cars.' },
        { focus: near3, callout: 'only 3 cars go to the routing engine', say: 'Only those three cars go to the routing engine, which works out real driving times on real roads.' },
        { focus: ['r0[8]', 'r6[0]'], say: 'Cars farther out are never even looked at.' },
      ],
    },
    {
      type: 'compare', chapter: 'What changed', title: 'Before and after H3',
      narration: 'Here is what the switch bought Uber. They released H3 as open source in 2018.',
      sides: [{ title: 'Points and map shapes' }, { title: 'H3 cells' }],
      rows: [
        { label: 'Which area is a car in?', cells: ['Walk every edge of a border', 'Read one number'], verdict: ['bad', 'good'] },
        { label: 'Area borders', cells: ['Jagged districts of any size', 'Even hexagons'], verdict: ['bad', 'good'] },
        { label: 'Storing a place', cells: ['Two 64 bit decimals', 'One 64 bit whole number'] },
        { label: 'Rolling up to bigger areas', cells: ['Merge shapes', 'Change a few bits'], verdict: ['bad', 'good'] },
      ],
      steps: [
        { focus: 0, say: 'Finding a car\'s area went from checking border edges to reading a number.' },
        { focus: 1, say: 'Pricing areas went from jagged districts to even hexagons.' },
        { focus: 2, say: 'A place went from two sixty four bit numbers to one, a whole number you can group by and compare.' },
        { focus: 3, say: 'And rolling small cells up into bigger ones went from merging shapes to changing a few bits.' },
      ],
    },
  ];
  return { title: 'Why Uber cut the world into hexagons', subtitle: 'From map shapes to one number per place', scenes };
}

const sb = build();
fs.writeFileSync(new URL('./storyboard.json', import.meta.url), JSON.stringify(sb, null, 2) + '\n');
fs.writeFileSync(new URL('./hunks.json', import.meta.url), '{}\n');
fs.writeFileSync(new URL('./meta.json', import.meta.url), '{ "mode": "explain" }\n');
