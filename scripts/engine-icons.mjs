#!/usr/bin/env node
// Writes engine/core/data/lucide.json: the Lucide icons a storyboard names in `icon` fields (every one used by
// examples/ and skill/, plus a base set and the engine's own), as SVG path data on a 24 by 24 grid, keyed by
// the lucide-react component name. The engine's icons.rs reads it for icons it has no hand-copied paths for.
//
//   node scripts/engine-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = [
  'server',
  'database',
  'user',
  'users',
  'headset',
  'building-2',
  'smartphone',
  'file-text',
  'sticky-note',
  'globe',
  'cloud',
  'lock',
  'key',
  'shield',
  'cpu',
  'hard-drive',
  'laptop',
  'monitor',
  'mail',
  'bell',
  'box',
  'package',
  'git-branch',
  'terminal',
  'code',
  'layers',
  'zap',
  'clock',
  'credit-card',
  'shopping-cart',
];

function iconNames() {
  const names = new Set(BASE);
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(json|md)$/.test(e.name)) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/"icon":\s*"([a-z0-9-]+)"/g)) names.add(m[1]);
      }
    }
  };
  for (const d of ['examples', 'skill']) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
  return [...names].sort();
}

const pascal = (name) =>
  name
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

const num = (v, d = 0) => (v === undefined ? d : Number(v));

/** An SVG shape element as path data. */
function toPath(tag, a) {
  switch (tag) {
    case 'path':
      return a.d;
    case 'circle': {
      const [cx, cy, r] = [num(a.cx), num(a.cy), num(a.r)];
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = [num(a.cx), num(a.cy), num(a.rx), num(a.ry)];
      return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`;
    }
    case 'line':
      return `M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}`;
    case 'polyline':
    case 'polygon': {
      const pts = String(a.points)
        .trim()
        .split(/[\s,]+/);
      let d = '';
      for (let i = 0; i + 1 < pts.length; i += 2) d += `${i ? 'L' : 'M'} ${pts[i]} ${pts[i + 1]} `;
      return d.trim() + (tag === 'polygon' ? ' Z' : '');
    }
    case 'rect': {
      const [x, y, w, h] = [num(a.x), num(a.y), num(a.width), num(a.height)];
      const rx = Math.min(num(a.rx ?? a.ry), w / 2);
      const ry = Math.min(num(a.ry ?? a.rx), h / 2);
      if (!rx && !ry) return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
      return `M ${x + rx} ${y} h ${w - 2 * rx} a ${rx} ${ry} 0 0 1 ${rx} ${ry} v ${h - 2 * ry} a ${rx} ${ry} 0 0 1 ${-rx} ${ry} h ${-(w - 2 * rx)} a ${rx} ${ry} 0 0 1 ${-rx} ${-ry} v ${-(h - 2 * ry)} a ${rx} ${ry} 0 0 1 ${rx} ${-ry} Z`;
    }
    default:
      throw new Error(`unknown icon element ${tag}`);
  }
}

const out = {};
for (const name of iconNames()) {
  const dir = path.join(root, 'node_modules/lucide-react/dist/esm/icons');
  let file = path.join(dir, `${name}.mjs`);
  if (!fs.existsSync(file)) {
    console.error(`no lucide icon ${name}`);
    continue;
  }
  // Some names are aliases: `export { default } from './other.mjs'`.
  const alias = /export \{ default \} from '\.\/(.+?)'/.exec(fs.readFileSync(file, 'utf8'));
  if (alias) file = path.join(dir, alias[1]);
  const mod = await import(file);
  out[pascal(name)] = mod.__iconData.node.map(([tag, attrs]) => toPath(tag, attrs));
}
fs.writeFileSync(path.join(root, 'engine/core/data/lucide.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${Object.keys(out).length} icons`);
