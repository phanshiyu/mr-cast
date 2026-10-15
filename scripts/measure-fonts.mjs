#!/usr/bin/env node
// Measures the advance width of every character mr-cast draws, in the render browser (Chrome Headless
// Shell, the one `still` and `render` use), and writes shared/font-metrics.mjs. Rerun it when the font
// stacks in src/components/theme.ts change: node scripts/measure-fonts.mjs
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WebSocket = createRequire(path.join(REPO, 'package.json'))('ws');
const OUT = path.join(REPO, 'shared/font-metrics.mjs');

const theme = fs.readFileSync(path.join(REPO, 'src/components/theme.ts'), 'utf8');
const stack = (name) => {
  const m = new RegExp(`${name}: '([^']+)'`).exec(theme);
  if (!m) throw new Error(`no ${name} font stack in theme.ts`);
  return m[1];
};
const FAMILIES = { sans: stack('sans'), mono: stack('mono') };
/** Other weights interpolate between these; a variable font's advances move smoothly with its weight. */
const WEIGHTS = [400, 500, 600, 700, 800];
/**
 * The system sans changes its optical size and tracking with the font size up to about 28px, so it is
 * measured at each of these sizes and interpolated between them; from the last one up it scales.
 */
const SIZES = [10, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 32, 40, 60, 80, 100];
const EXTRA = '…→←↔−–—·•’‘“”×÷≤≥≠≈✓✗€£¥°±§¶©®™¡¿«»';
/** Printable ASCII and the symbols the scenes draw. Accented letters measure as their base letter. */
const CHARS = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), ...EXTRA];

function chromePath() {
  const root = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'mr-cast/remotion/node_modules/.remotion/chrome-headless-shell');
  const found = execSync(`find ${JSON.stringify(root)} -name chrome-headless-shell -type f -perm -u+x 2>/dev/null | head -1`, { encoding: 'utf8' }).trim();
  if (!found) throw new Error(`no Chrome Headless Shell under ${root}; run any mr-cast still once to download it`);
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-fonts-'));
const chrome = spawn(chromePath(), ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  });
  let id = 0;
  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (msg) => (msg.error || msg.result.exceptionDetails ? reject(new Error(JSON.stringify(msg.error ?? msg.result.exceptionDetails))) : resolve(msg.result.result.value)));
      ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  const measured = await evaluate(`(async () => {
    const families = ${JSON.stringify(FAMILIES)};
    const weights = ${JSON.stringify(WEIGHTS)};
    const chars = ${JSON.stringify(CHARS)};
    const sizes = ${JSON.stringify(SIZES)};
    // Widths as the page lays text out: a canvas measures some fonts a little differently from the DOM.
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:0;top:0;white-space:pre;font-kerning:normal';
    document.body.appendChild(box);
    const widths = (family, weight, size, texts) => {
      box.style.font = weight + ' ' + size + 'px ' + family;
      // One span per line, so no text is shaped together with its neighbour's.
      box.replaceChildren(...texts.map((t) => Object.assign(document.createElement('div'), { innerHTML: '<span></span>' })));
      [...box.children].forEach((line, i) => (line.firstChild.textContent = texts[i]));
      const out = [...box.children].map((el) => el.firstChild.getBoundingClientRect().width);
      box.replaceChildren();
      return out;
    };
    const out = {};
    for (const [name, family] of Object.entries(families)) {
      out[name] = {};
      for (const w of weights) {
        out[name][w] = sizes.map((size) => widths(family, w, size, chars.map((c) => c.repeat(20))).map((px) => Math.round((px / 20 / size) * 10000) / 10000));
      }
    }
    // Kerning: what a pair of ASCII characters takes off (or adds to) their two advances. It moves with
    // the size, as the optical size does, and settles from 28px up. Each weight keeps two tables, one for
    // text sizes and one for display sizes, each with the value nearest zero (or the largest gain) across
    // its sizes: an estimate that never comes out narrower than the browser draws.
    const kern = {};
    const ascii = chars.filter((c) => c >= ' ' && c <= '~');
    const pairs = ascii.flatMap((a) => ascii.map((b) => a + b));
    const bands = { text: [12, 16, 20], display: [28, 100] };
    for (const [name, family] of Object.entries(families)) {
      if (name === 'mono') continue;
      kern[name] = {};
      for (const w of weights) {
        kern[name][w] = {};
        for (const [band, bandSizes] of Object.entries(bands)) {
          const best = new Map();
          for (const size of bandSizes) {
            const single = new Map(ascii.map((c, i) => [c, widths(family, w, size, [c.repeat(20)])[0] / 20]));
            const both = widths(family, w, size, pairs);
            pairs.forEach((pair, i) => {
              const k = (both[i] - single.get(pair[0]) - single.get(pair[1])) / size;
              best.set(pair, best.has(pair) ? Math.max(best.get(pair), k) : k);
            });
          }
          kern[name][w][band] = [...best].filter(([, k]) => Math.abs(k) >= 0.004).map(([pair, k]) => [pair, Math.round(k * 1000)]);
        }
      }
    }
    return { advances: out, kern };
  })()`);
  ws.close();

  const lines = [
    '// Generated by scripts/measure-fonts.mjs in Chrome Headless Shell, the browser that renders stills and videos.',
    '// Advance width of each character, in em, for each font family and weight mr-cast draws text in.',
    '// Do not edit by hand: rerun the script when the font stacks in src/components/theme.ts change.',
    '',
    `export const FONT_STACKS = ${JSON.stringify(FAMILIES, null, 2)};`,
    '',
    `export const MEASURED_CHARS = ${JSON.stringify(CHARS.join(''))};`,
    '',
    `export const MEASURED_SIZES = ${JSON.stringify(SIZES)};`,
    '',
    `export const MEASURED_WEIGHTS = ${JSON.stringify(WEIGHTS)};`,
    '',
    '/** ADVANCES[family][weight][k][i] is the width in em of MEASURED_CHARS[i] at MEASURED_SIZES[k]px; a monospace family has one row. */',
    'export const ADVANCES = {',
    ...Object.entries(measured.advances).map(([family, byWeight]) => {
      const rows = Object.entries(byWeight).map(([w, bySize]) => {
        const same = bySize.every((row) => row.every((v, i) => Math.abs(v - bySize[0][i]) < 0.0015));
        const kept = same ? [bySize[bySize.length - 1]] : bySize;
        return `    ${w}: [\n${kept.map((row) => `      [${row.join(', ')}],`).join('\n')}\n    ],`;
      });
      return `  ${family}: {\n${rows.join('\n')}\n  },`;
    }),
    '};',
    '',
    '/**',
    ' * KERNING[family][weight][band] lists each pair of ASCII characters that a font sets closer or wider than',
    ' * their two advances, as the pair and the change in thousandths of an em, one per line. The text',
    ' * band holds for sizes up to 20px and the display band from 28px; each keeps the change nearest zero across its sizes.',
    ' */',
    'export const KERNING = {',
    ...Object.entries(measured.kern).map(
      ([family, byWeight]) =>
        `  ${family}: {\n${Object.entries(byWeight)
          .map(([w, bands]) => `    ${w}: {\n${Object.entries(bands).map(([band, pairs]) => `      ${band}: ${JSON.stringify(pairs.map(([p, k]) => p + k).join('\n'))},`).join('\n')}\n    },`)
          .join('\n')}\n  },`,
    ),
    '};',
    '',
  ];
  fs.writeFileSync(OUT, lines.join('\n'));
  console.log(`wrote ${path.relative(REPO, OUT)}: ${CHARS.length} characters x ${WEIGHTS.length} weights x ${SIZES.length} sizes x ${Object.keys(FAMILIES).length} families`);
} finally {
  chrome.kill('SIGKILL');
  await sleep(200);
  fs.rmSync(profile, { recursive: true, force: true });
}
