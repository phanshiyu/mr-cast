#!/usr/bin/env node
// Writes the world outlines the map scene draws, shared/world/ne-110m.mjs and shared/world/ne-50m.mjs, from Natural
// Earth's admin-0 countries at version 5.1.2 (public domain, https://www.naturalearthdata.com/about/terms-of-use/).
// Each country keeps its code, its names, its label point and its polygons, rounded to 0.01 degrees and stored as
// delta-encoded integers. A country too small to keep a ring, such as Vatican City, keeps its code and label point. The 1:50m outline is first simplified with Douglas-Peucker at 0.02 degrees (about 2 km).
// Run: node scripts/world-data.mjs [--from <dir with ne_110m_admin_0_countries.geojson and ne_50m_...>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoArea } from 'd3-geo';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '5.1.2';
const SOURCE = (scale) =>
  `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v${VERSION}/geojson/ne_${scale}_admin_0_countries.geojson`;
const QUANTUM = 100;
const SCALES = { '110m': { simplify: 0 }, '50m': { simplify: 0.02 } };

const from = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null;

async function read(scale) {
  if (from) return JSON.parse(fs.readFileSync(path.join(from, `ne_${scale}_admin_0_countries.geojson`), 'utf8'));
  const res = await fetch(SOURCE(scale));
  if (!res.ok) throw new Error(`${SOURCE(scale)}: ${res.status}`);
  return res.json();
}

/** Douglas-Peucker on one ring, keeping its two ends. */
function simplify(points, tolerance) {
  if (!tolerance || points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const todo = [[0, points.length - 1]];
  while (todo.length) {
    const [a, b] = todo.pop();
    const [[ax, ay], [bx, by]] = [points[a], points[b]];
    const [dx, dy] = [bx - ax, by - ay];
    const length = Math.hypot(dx, dy);
    let far = -1;
    let most = tolerance;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = points[i];
      const d = length === 0 ? Math.hypot(x - ax, y - ay) : Math.abs(dy * x - dx * y + bx * ay - by * ax) / length;
      if (d > most) [most, far] = [d, i];
    }
    if (far > 0) {
      keep[far] = 1;
      todo.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A ring rounded to the quantum, as [x0, y0, dx1, dy1, ...] in quanta; null when it rounds to less than a triangle. */
function encodeRing(ring, tolerance) {
  const out = [];
  let [px, py] = [0, 0];
  for (const [x, y] of simplify(ring, tolerance)) {
    const [X, Y] = [Math.round(x * QUANTUM), Math.round(y * QUANTUM)];
    if (out.length && X === px && Y === py) continue;
    out.push(X - px, Y - py);
    [px, py] = [X, Y];
  }
  return out.length >= 8 ? out : null;
}

const decodeRing = (ring) => {
  const out = [];
  for (let i = 0, x = 0, y = 0; i < ring.length; i += 2)
    out.push([(x += ring[i]) / QUANTUM, (y += ring[i + 1]) / QUANTUM]);
  return out;
};

/** The code a country is named by: ISO 3166-1 alpha-3, else Natural Earth's own (KOS, SOL, CYN and the like). */
function codeOf(p, taken) {
  for (const code of [p.ISO_A3, p.ISO_A3_EH, p.ADM0_A3]) if (/^[A-Z]{3}$/.test(code) && !taken.has(code)) return code;
  throw new Error(`no free code for ${p.NAME}`);
}

const written = {};
for (const [scale, { simplify: tolerance }] of Object.entries(SCALES)) {
  const geojson = await read(scale);
  const taken = new Set();
  const countries = [];
  let points = 0;
  for (const f of geojson.features) {
    const p = f.properties;
    const code = codeOf(p, taken);
    taken.add(code);
    const polygons = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flatMap(
      (polygon) => {
        let rings = polygon.map((ring) => encodeRing(ring, tolerance));
        if (!rings[0]) return [];
        rings = rings.filter(Boolean);
        // d3-geo reads a ring that encloses more than half the globe as everything outside it; turn such a polygon round.
        if (geoArea({ type: 'Polygon', coordinates: rings.map(decodeRing) }) > 2 * Math.PI)
          rings = rings.map((r) => encodeRing(decodeRing(r).reverse(), 0));
        points += rings.reduce((n, r) => n + r.length / 2, 0);
        return [rings];
      },
    );
    const names = [...new Set([p.NAME, p.NAME_LONG, p.ADMIN].filter((n) => typeof n === 'string' && n.trim()))];
    countries.push([
      code,
      names,
      [Math.round(p.LABEL_X * QUANTUM) / QUANTUM, Math.round(p.LABEL_Y * QUANTUM) / QUANTUM],
      polygons,
    ]);
  }
  countries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  written[scale] = countries;
  const file = path.join(ROOT, 'shared/world', `ne-${scale}.mjs`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = `// Natural Earth ${VERSION}, admin-0 countries at 1:${scale}, public domain (https://www.naturalearthdata.com/about/terms-of-use/).\n// Written by scripts/world-data.mjs; do not edit. Each country is [code, names, label [lng, lat], polygons], a polygon\n// its rings, a ring [x0, y0, dx1, dy1, ...] in hundredths of a degree of longitude and latitude.\n`;
  fs.writeFileSync(
    file,
    `${head}export default ${JSON.stringify({ version: VERSION, scale, quantum: QUANTUM, countries })};\n`,
  );
  console.log(
    `${path.relative(ROOT, file)}: ${countries.length} countries, ${points} points, ${Math.round(fs.statSync(file).size / 1024)} KB`,
  );
}
const fine = new Set(written['50m'].map(([code]) => code));
const missing = written['110m'].filter(([code]) => !fine.has(code)).map(([code]) => code);
if (missing.length) throw new Error(`in 1:110m but not 1:50m: ${missing.join(', ')}`);
