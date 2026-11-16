#!/usr/bin/env node
// Writes what the Rust engine (engine/) reads, from the TS and JS it ports, so the two cannot drift:
//
//   node scripts/engine-dump.mjs props <run dir> <out.json>   the composition's inputProps for a run, as
//                                                              bin/lib/render.mjs builds them, plus the
//                                                              syntax tokens of every hunk and payload
//   node scripts/engine-dump.mjs data                          engine/core/data: font metrics and text slots
//   node scripts/engine-dump.mjs fixtures                      engine/core/tests/fixtures: timing and text
//                                                              fitting as the JS computes them
//   node scripts/engine-dump.mjs icons                         engine/core/data/lucide.json: every Lucide icon
//                                                              as path data, by component name
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The TS modules the dump needs, bundled into one ES module so plain Node can run them. */
async function load() {
  const entry = `
    export { SLOTS } from './src/fit/slots';
    export { syntaxColours } from './src/engine/highlight';
    export * as textfit from './shared/textfit.mjs';
    export * as timing from './shared/timing.mjs';
    export * as metrics from './shared/font-metrics.mjs';
    export { speechText } from './shared/speech.mjs';
    export { normalizeStoryboard } from './shared/normalize.mjs';
    export { parseStoryboard } from './shared/storyboard-json.mjs';
  `;
  const out = await build({
    stdin: { contents: entry, resolveDir: REPO, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'error',
  });
  const file = path.join(fs.mkdtempSync(path.join(REPO, 'node_modules/.engine-dump-')), 'bundle.mjs');
  fs.writeFileSync(file, out.outputFiles[0].text);
  try {
    return await import(file);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  console.log(path.relative(process.cwd(), file));
};

async function props(m, dir, out) {
  // An explanation run may have no hunks.json; it then shows no code.
  const hunksFile = path.join(dir, 'hunks.json');
  const hunks = fs.existsSync(hunksFile) ? JSON.parse(fs.readFileSync(hunksFile, 'utf8')) : {};
  const raw = m.parseStoryboard(fs.readFileSync(path.join(dir, 'storyboard.json'), 'utf8'));
  const storyboard = m.normalizeStoryboard(raw, hunks);
  const highlight = m.syntaxColours(storyboard, hunks);
  write(out, { storyboard, hunks, showCaptions: true, voiceover: null, images: {}, highlight });
}

function data(m) {
  const dir = path.join(REPO, 'engine/core/data');
  const { MEASURED_CHARS, MEASURED_SIZES, MEASURED_WEIGHTS, ADVANCES, KERNING } = m.metrics;
  write(path.join(dir, 'font-metrics.json'), {
    chars: MEASURED_CHARS,
    sizes: MEASURED_SIZES,
    weights: MEASURED_WEIGHTS,
    advances: ADVANCES,
    kerning: KERNING,
  });
  write(path.join(dir, 'slots.json'), m.SLOTS);
}

/** Every storyboard in examples/, for timing fixtures. */
function storyboards() {
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'storyboard.json') found.push(p);
    }
  };
  walk(path.join(REPO, 'examples'));
  return found.sort();
}

const TEXTS = [
  'Limit POST /orders to 20 per minute per IP, price items from the pricing service, and publish order.created.',
  'Why this change',
  'A request, step by step',
  'Rate limiting for the Orders API, line by line',
  'The event is sent after the save, so a queue error fails a saved order',
  'The **key** expires with the `window`, so ==Redis== cleans it up.',
  '[Retry-After]{warn} tells the client how many seconds to wait.',
  'PaymentProviderClient.createIdempotentChargeWithRetries/handler_name',
  'Ünïcödé façade — naïve “quotes” → arrows… and €5 × 3',
  'line one\nline two after a written break',
  'src/services/orders/really/deep/path/to/a/file-with-a-long-name.ts',
  'x',
  '',
];

function fixtures(m) {
  const dir = path.join(REPO, 'engine/core/tests/fixtures');
  const voiceovers = [null, { voice: 'kitten:luna', speed: 0.85, pauses: 1.5, clips: {} }];
  const timing = [];
  for (const file of storyboards()) {
    let sb;
    try {
      sb = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const voiceover of voiceovers)
      for (const scene of sb.scenes ?? [])
        timing.push({
          // Only what timing reads, to keep the fixture small.
          scene: {
            type: scene.type,
            narration: scene.narration,
            steps: scene.steps?.map((step) => ({ say: step?.say, mark: step?.mark, flag: step?.flag })),
          },
          voiceover,
          segments: m.timing.sceneSegments(scene, voiceover).map(({ clip, ...s }) => s),
          duration: m.timing.sceneDurationInFrames(scene, voiceover),
          spoken: [0, 7, 45, 90, 200].map((f) => m.timing.spokenAt(m.timing.sceneSegments(scene, voiceover), f)),
        });
  }
  write(path.join(dir, 'timing.json'), timing);

  const fits = [];
  for (const [name, base] of Object.entries(m.SLOTS))
    for (const width of [180, 420, 900, 1712])
      for (const text of TEXTS) {
        const slot = { ...base, width };
        const f = m.textfit.fitText(text, slot, name);
        fits.push({
          slot,
          text,
          fit: { size: f.size, lines: f.lines, widths: f.widths, height: f.height, fits: f.fits },
        });
      }
  const lines = [];
  for (const name of ['code', 'payload', 'flowCode'])
    for (const width of [300, 800, 1600])
      lines.push({
        slot: { ...m.SLOTS[name], width },
        lines: ['export const db = {', '  async insert(table: string, row: Record<string, unknown>) {', '};'],
        height: 400,
        fit: (({ size, widths, fits }) => ({ size, widths, fits }))(
          m.textfit.fitLines(
            ['export const db = {', '  async insert(table: string, row: Record<string, unknown>) {', '};'],
            { ...m.SLOTS[name], width },
            400,
            'x',
          ),
        ),
      });
  const measures = [];
  for (const family of ['sans', 'mono'])
    for (const weight of [400, 450, 550, 650, 800])
      for (const size of [11, 15, 22, 24, 30, 36, 50, 68, 120])
        for (const text of TEXTS.slice(0, 9))
          measures.push({
            text,
            font: { family, weight, size, letterSpacing: size > 40 ? -1.5 : 0, upper: size === 22 },
            width: m.textfit.measure(text, {
              family,
              weight,
              size,
              letterSpacing: size > 40 ? -1.5 : 0,
              upper: size === 22,
            }),
          });
  write(path.join(dir, 'textfit.json'), { fits, lines, measures });

  const phrases = [
    'wait 5ms, e.g. a → b',
    'in the 90s and 5s later',
    'it took 1.5s.',
    'mid-90s',
    '100s of',
    'v0.14 and 1.2.3',
    '/v1/orders',
    'version v2.1',
    '20 req/min and 5/s',
    'i.e., the end',
    'a -> b --> c <- d',
    '3 reqs',
    'v87 only',
    '10.0.0.1 and 1.2.3.4',
    'nothing to rewrite here',
  ];
  write(
    path.join(dir, 'speech.json'),
    phrases.map((text) => ({ text, spoken: m.speechText(text) })),
  );

  // anim.json, the springs and easings the engine's animation follows, is no longer regenerated; it stays as recorded.
}

/** An icon element as SVG path data, so the engine draws every Lucide icon with one primitive. */
function elementPath(tag, a) {
  const n = (k, d = 0) => Number(a[k] ?? d);
  const pts = (s) =>
    String(s)
      .trim()
      .split(/[\s,]+/)
      .map(Number);
  const poly = (close) => {
    const p = pts(a.points);
    let d = '';
    for (let i = 0; i + 1 < p.length; i += 2) d += `${i ? 'L' : 'M'}${p[i]} ${p[i + 1]}`;
    return close ? `${d}Z` : d;
  };
  switch (tag) {
    case 'path':
      return a.d;
    case 'line':
      return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
    case 'polyline':
      return poly(false);
    case 'polygon':
      return poly(true);
    case 'circle':
    case 'ellipse': {
      const [cx, cy] = [n('cx'), n('cy')];
      const [rx, ry] = tag === 'circle' ? [n('r'), n('r')] : [n('rx'), n('ry')];
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
    }
    case 'rect': {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
      const rx = Math.min(n('rx', a.ry ?? 0), w / 2);
      const ry = Math.min(n('ry', a.rx ?? 0), h / 2);
      if (!rx && !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`;
    }
    default:
      throw new Error(`icon element <${tag}>`);
  }
}

/** Every Lucide icon, by component name, as a list of path data; aliases share one entry. */
function icons() {
  const require = createRequire(path.join(REPO, 'package.json'));
  const { icons: all } = require('lucide-react');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const shapes = [];
  const seen = new Map();
  const names = {};
  for (const [name, Icon] of Object.entries(all).sort(([a], [b]) => a.localeCompare(b))) {
    const html = renderToStaticMarkup(React.createElement(Icon));
    const paths = [...html.matchAll(/<(path|line|polyline|polygon|circle|ellipse|rect)\b([^>]*)>/g)].map(
      ([, tag, attrs]) =>
        elementPath(tag, Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]))),
    );
    const key = JSON.stringify(paths);
    if (!seen.has(key)) seen.set(key, shapes.push(paths) - 1);
    names[name] = seen.get(key);
  }
  write(path.join(REPO, 'engine/core/data/lucide.json'), { names, shapes });
}

const [cmd, ...args] = process.argv.slice(2);
const m = await load();
if (cmd === 'props' && args.length === 2) await props(m, path.resolve(args[0]), path.resolve(args[1]));
else if (cmd === 'data') data(m);
else if (cmd === 'fixtures') fixtures(m);
else if (cmd === 'icons') icons();
else {
  console.error('usage: engine-dump.mjs props <run dir> <out.json> | data | fixtures | icons');
  process.exit(2);
}
