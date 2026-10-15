#!/usr/bin/env node
// Checks what the player drew against the storyboard, from a browse.mjs textscan: no line ends in an
// ellipsis, no text is clipped by CSS (an ellipsis, a line clamp or hidden overflow, which leave the DOM
// text whole), every text the storyboard puts on screen appears whole, and no fitted line is drawn wider
// than the text fit measured it.
// usage: node text-check.mjs <storyboard.json> <textscan.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { plainText } = await import(path.join(REPO, 'shared/markup.mjs'));
const [storyboardPath, scanPath] = process.argv.slice(2);
if (!storyboardPath || !scanPath) {
  console.error('usage: node text-check.mjs <storyboard.json> <textscan.json>');
  process.exit(2);
}
const storyboard = JSON.parse(fs.readFileSync(storyboardPath, 'utf8'));
const scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));

/** Keys whose strings are not drawn as written: spoken words, ids, refs, enums and code the scene draws its own way. */
const NOT_DRAWN = new Set(['narration', 'say', 'type', 'id', 'from', 'to', 'hunkId', 'kind', 'icon', 'tone', 'change', 'layout', 'view', 'unit', 'cardinality', 'initial', 'status', 'mark', 'token', 'focus', 'lines', 'oldLines', 'at', 'better', 'direction', 'style', 'shape', 'code', 'payload', 'series', 'explainsChange', 'chapter', 'subtitle', 'title', 'badge', 'path', 'risk', 'focusLinesAfter', 'focusLinesBefore', 'highlight']);
const drawn = [];
const walk = (value, key, where) => {
  if (typeof value === 'string') {
    if (!NOT_DRAWN.has(key)) drawn.push({ where, text: plainText(value) });
  } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, key, `${where}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k, `${where}.${k}`);
};
storyboard.scenes.forEach((scene, i) => {
  walk(scene, '', `scenes[${i}]`);
  for (const key of ['chapter', 'title']) if (typeof scene[key] === 'string') drawn.push({ where: `scenes[${i}].${key}`, text: scene[key] });
});

const squash = (text) => text.replace(/\s+/g, '').toLowerCase();
const seen = squash(scan.lines.join(''));
const missing = drawn.filter((d) => d.text.trim() && !seen.includes(squash(d.text)));
const ellipses = scan.lines.filter((line) => line.includes('…') && !/^Loading walkthrough…$/.test(line));
const wide = scan.fits.filter((f) => f.drawn > f.measured + 1);
const clipped = (scan.clipped ?? []).filter((text) => text);
const worst = scan.fits.length ? scan.fits.reduce((m, f) => Math.max(m, f.drawn - f.measured), -Infinity) : NaN;

console.log(`text-check: ${drawn.length} texts on screen, ${scan.lines.length} lines seen, ${scan.fits.length} fitted lines`);
console.log(`text-check: widest fitted line is ${worst.toFixed(1)}px past its measured width (allowed: 1px)`);
for (const m of missing) console.log(`MISSING ${m.where}: ${JSON.stringify(m.text)}`);
for (const e of ellipses) console.log(`ELLIPSIS ${JSON.stringify(e)}`);
for (const w of wide) console.log(`WIDER ${JSON.stringify(w.text)}: drawn ${w.drawn}px, measured ${w.measured}px`);
for (const c of clipped) console.log(`CLIPPED ${JSON.stringify(c)}`);
const ok = !missing.length && !ellipses.length && !wide.length && !clipped.length;
console.log(ok ? 'text-check: ok' : 'text-check: FAIL');
process.exit(ok ? 0 : 1);
