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
    export { interpolate, spring, Easing } from 'remotion';
    export { normalizeStoryboard } from './shared/normalize.mjs';
    export { parseStoryboard } from './shared/storyboard-json.mjs';
    export { isHunkCell, resolveHunkCell } from './shared/compare.mjs';
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
  // A compare scene's code cells: inline snippets, and the lines its hunk cells read from hunks.json.
  for (const scene of storyboard.scenes)
    for (const row of scene.type === 'compare' ? (scene.rows ?? []) : [])
      for (const cell of (row.cells ?? []).slice(0, 2)) {
        const read = m.isHunkCell(cell)
          ? m.resolveHunkCell(cell, hunks)
          : cell && typeof cell === 'object' && !('image' in cell)
            ? { code: cell.code, lang: cell.lang ?? 'plain' }
            : null;
        if (!read || 'error' in read || typeof read.code !== 'string') continue;
        const code = read.code.replace(/\s+$/, '');
        highlight.snippets[`${read.lang}\n${code}`] = colored(m, m.tokenizeLines(code, read.lang));
      }
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
