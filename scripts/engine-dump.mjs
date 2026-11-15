#!/usr/bin/env node
// Writes what the Rust engine (engine/) reads, from the TS and JS it ports, so the two cannot drift:
//
//   node scripts/engine-dump.mjs props <run dir> <out.json>   the composition's inputProps for a run, as
//                                                              bin/lib/render.mjs builds them, plus the
//                                                              syntax tokens of every hunk and payload
//   node scripts/engine-dump.mjs data                          engine/core/data: font metrics and text slots
//   node scripts/engine-dump.mjs fixtures                      engine/core/tests/fixtures: timing and text
//                                                              fitting as the JS computes them
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The TS modules the dump needs, bundled into one ES module so plain Node can run them. */
async function load() {
  const entry = `
    export { SLOTS } from './src/fit/slots';
    export { tokenizeHunkLines, tokenizeLines, tokenColor, plainCodeColor } from './src/utils/highlight';
    export * as textfit from './shared/textfit.mjs';
    export * as timing from './shared/timing.mjs';
    export * as metrics from './shared/font-metrics.mjs';
    export { speechText } from './shared/speech.mjs';
    export * as pen from './src/utils/penGeometry';
    export { renderToStaticMarkup } from 'react-dom/server';
    export { createElement } from 'react';
    export { lucideIcon } from './src/components/icons';
    export * as inkg from './src/utils/inkGeometry';
    export { interpolate, spring, Easing } from 'remotion';
    export { normalizeStoryboard } from './shared/normalize.mjs';
    export { parseStoryboard } from './shared/storyboard-json.mjs';
  `;
  const out = await build({
    stdin: { contents: entry, resolveDir: REPO, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    // Packages load from node_modules as they are; bundled, their CommonJS cannot require Node's built-ins or React.
    packages: 'external',
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

/** Each line's tokens as [text, colour] pairs; the engine draws them in exactly these colours. */
const colored = (m, lines) =>
  lines.map((tokens) => tokens.map((t) => [t.content, m.tokenColor(t.types) ?? m.plainCodeColor]));

/** Pretty-printed JSON when the payload parses, otherwise the raw text, as src/utils/flowLayout.ts formats it. */
function formatPayload(payload) {
  try {
    return { text: JSON.stringify(JSON.parse(payload), null, 2), language: 'json' };
  } catch {
    return { text: payload, language: 'plain' };
  }
}

/** A Lucide icon's elements as SVG path data on its 24 by 24 grid, one string per element. */
function iconPaths(m, name) {
  const Icon = m.lucideIcon(name);
  if (!Icon) return null;
  const svg = m.renderToStaticMarkup(m.createElement(Icon));
  const attr = (s, k) => {
    const v = new RegExp(`\\b${k}="([^"]*)"`).exec(s)?.[1];
    return v === undefined ? undefined : Number.isNaN(Number(v)) ? v : Number(v);
  };
  const out = [];
  for (const [, tag, rest] of svg.matchAll(/<(path|circle|line|rect|polyline|polygon|ellipse)([^>]*)\/?>/g)) {
    if (tag === 'path') out.push(attr(rest, 'd'));
    else if (tag === 'line')
      out.push(`M${attr(rest, 'x1')} ${attr(rest, 'y1')}L${attr(rest, 'x2')} ${attr(rest, 'y2')}`);
    else if (tag === 'circle' || tag === 'ellipse') {
      const [cx, cy] = [attr(rest, 'cx'), attr(rest, 'cy')];
      const [rx, ry] = tag === 'circle' ? [attr(rest, 'r'), attr(rest, 'r')] : [attr(rest, 'rx'), attr(rest, 'ry')];
      out.push(`M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`);
    } else if (tag === 'polyline' || tag === 'polygon') {
      const p = String(attr(rest, 'points'))
        .trim()
        .split(/[\s,]+/);
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      out.push(tag === 'polygon' ? `${d}Z` : d);
    } else if (tag === 'rect') {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => attr(rest, k) ?? 0);
      const r = attr(rest, 'rx') ?? 0;
      out.push(
        r
          ? `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
          : `M${x} ${y}h${w}v${h}h${-w}Z`,
      );
    }
  }
  return out;
}

/** Every `icon` a storyboard names, anywhere in it. */
function iconNames(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) iconNames(v, out);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (k === 'icon' && typeof v === 'string') out.add(v);
      else iconNames(v, out);
    }
  return out;
}

async function props(m, dir, out) {
  // An explanation run may have no hunks.json; it then shows no code.
  const hunksFile = path.join(dir, 'hunks.json');
  const hunks = fs.existsSync(hunksFile) ? JSON.parse(fs.readFileSync(hunksFile, 'utf8')) : {};
  const raw = m.parseStoryboard(fs.readFileSync(path.join(dir, 'storyboard.json'), 'utf8'));
  const storyboard = m.normalizeStoryboard(raw, hunks);
  const highlight = { plain: m.plainCodeColor, hunks: {}, snippets: {} };
  for (const [id, hunk] of Object.entries(hunks))
    highlight.hunks[id] = colored(m, m.tokenizeHunkLines(hunk.lines, hunk.language));
  for (const scene of storyboard.scenes)
    for (const step of scene.type === 'flow' ? (scene.steps ?? []) : [])
      if (typeof step.payload === 'string') {
        const { text, language } = formatPayload(step.payload);
        highlight.snippets[`${language}\n${text}`] = colored(m, m.tokenizeLines(text, language));
      }
  const icons = {};
  for (const name of iconNames(storyboard)) {
    const paths = iconPaths(m, name);
    if (paths) icons[name] = paths;
  }
  write(out, { storyboard, hunks, showCaptions: true, voiceover: null, images: {}, highlight, icons });
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

  const frames = [-3, 0, 1, 2.5, 5, 9, 14, 20, 33, 47.25, 80];
  const springs = [];
  for (const config of [
    {},
    { damping: 18 },
    { damping: 16, stiffness: 120 },
    { damping: 18, stiffness: 120 },
    { damping: 200 },
  ])
    for (const frame of frames) {
      springs.push({ config, frame, value: m.spring({ frame, fps: 30, config }) });
      springs.push({ config, frame, duration: 12, value: m.spring({ frame, fps: 30, config, durationInFrames: 12 }) });
    }
  const easings = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    easings.push({ t, bezier: m.Easing.bezier(0.25, 0.1, 0.25, 1)(t), outCubic: m.Easing.out(m.Easing.cubic)(t) });
  }
  write(path.join(dir, 'anim.json'), { springs, easings });

  // Pen and ink geometry on a few targets among obstacles.
  const area = { x: 0, y: 0, width: 1712, height: 760 };
  const targets = [
    { x: 300, y: 200, width: 240, height: 60 },
    { x: 40, y: 20, width: 600, height: 40 },
    { x: 1500, y: 680, width: 180, height: 70 },
  ];
  const obstacles = [
    { x: 560, y: 205, width: 200, height: 50 },
    { x: 100, y: 205, width: 180, height: 50 },
    { x: 300, y: 300, width: 400, height: 80 },
  ];
  const pts = [
    { x: 400, y: 330 },
    { x: 900, y: 100 },
  ];
  const geometry = [];
  targets.forEach((target, i) => {
    const seed = m.pen.seedOf(`${i}:circle:note`);
    const clutter = { target, obstacles, lines: pts };
    for (const mark of ['circle', 'box', 'underline', 'strike', 'cross']) {
      const sketch = m.pen.sketchMark(mark, target, area, obstacles, seed, 4.5);
      geometry.push({
        kind: 'mark',
        mark,
        target,
        seed,
        sketch,
        note: m.pen.placeNote(mark, { width: 220, height: 43 }, sketch, clutter, area),
      });
    }
    const arrow = m.pen.placeArrow({ width: 220, height: 43 }, clutter, area);
    geometry.push({ kind: 'arrow', target, seed, arrow, sketch: m.pen.arrowSketch(arrow.tail, target, seed, 4.5) });
    geometry.push({ kind: 'tick', target, seed, sketch: m.inkg.tickSketch(target, seed, 4.5) });
    for (const side of ['above', 'below', 'left', 'right'])
      geometry.push({
        kind: 'brace',
        side,
        target,
        seed,
        sketch: m.inkg.braceSketch(target, side, seed, 4.5),
        clear: m.inkg.clearOf(target, side, obstacles),
        beside: m.inkg.besideClear(target, side, { width: 200, height: 50 }, 16, obstacles, area),
      });
    const other = targets[(i + 1) % targets.length];
    geometry.push({
      kind: 'link',
      target,
      seed,
      source: other,
      sketch: m.inkg.linkSketch(
        other,
        m.pen.edgeToward(other, { x: target.x, y: target.y }),
        target,
        obstacles,
        seed,
        4.5,
      ),
      text: m.inkg.placeText(target, target, { width: 200, height: 50 }, obstacles, area),
      leader: m.inkg.leader(target, { width: 200, height: 50 }, obstacles, area, seed, 4.5),
      rowEnd: m.inkg.rowEnd(target, { width: 200, height: 50 }, obstacles, area),
    });
  });
  write(path.join(dir, 'marks.json'), geometry);
}

const [cmd, ...args] = process.argv.slice(2);
const m = await load();
if (cmd === 'props' && args.length === 2) await props(m, path.resolve(args[0]), path.resolve(args[1]));
else if (cmd === 'data') data(m);
else if (cmd === 'fixtures') fixtures(m);
else {
  console.error('usage: engine-dump.mjs props <run dir> <out.json> | data | fixtures');
  process.exit(2);
}
