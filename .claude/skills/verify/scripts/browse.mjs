#!/usr/bin/env node
// Drives the mr-cast player in a headless Chrome over CDP and saves what it saw.
// usage: node browse.mjs <url> <outdir> <step>...
//   wait:<text>    wait (15s max) until the page text contains <text>, ignoring case (CSS uppercases some labels)
//   click:<text>   click the first button whose text contains <text>
//   clickin:<scope>::<text>
//                  click the first button containing <text> inside the first list item (li) containing <scope>,
//                  such as one topic row of the plan page
//   press:<key>    press a key (ArrowRight, ArrowLeft, ArrowUp, ArrowDown, Space, j, k, v, 1, 2, 3), then wait
//                  300ms for the page to re-render
//   size:<w>x<h>   resize the viewport, such as size:420x900 for a phone width
//   fullshot:<name> like shot, but the whole page height, for a page that scrolls
//   reload         reload the page, then wait 1s for it to load its data
//   sleep:<ms>     wait
//   run:<command>  run a shell command (sh -c) and wait for it, e.g. to edit storyboard.json
//   shot:<name>    save <outdir>/<name>.png (1920x1080) and <outdir>/<name>.txt (the page's visible text)
// Console errors and uncaught exceptions go to <outdir>/console.txt. When a step fails, the page as it
// was goes to <outdir>/failed.png and failed.txt, and the exit code is 1.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [url, outDir, ...steps] = process.argv.slice(2);
if (!url || !outDir) {
  console.error('usage: node browse.mjs <url> <outdir> <step>...');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

/** A Chrome to drive: MR_CAST_CHROME, else an installed Google Chrome or Chromium. */
function chromePath() {
  const candidates = [
    process.env.MR_CAST_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const found = execSync(`command -v ${name}`, { encoding: 'utf8', shell: '/bin/sh' }).trim();
      if (found) return found;
    } catch {}
  }
  throw new Error('no Chrome found; install Google Chrome or set MR_CAST_CHROME to a Chrome or Chromium binary');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-verify-chrome-'));
const chrome = spawn(
  chromePath(),
  [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--mute-audio',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--window-size=1920,1080',
    // Without it, Linux hints glyphs to whole-pixel advances and text draws wider than measured.
    '--font-render-hinting=none',
    // Ubuntu 24.04 blocks the unprivileged user namespaces Chrome's sandbox needs, as on GitHub's runners.
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws;
let nextId = 1;
const pending = new Map();
const consoleLines = [];

function cdp(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

async function connect() {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      consoleLines.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleLines.push(
        `exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`,
      );
    }
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
}

const evaluate = async (expression) =>
  (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
const pageText = () => evaluate('document.body ? document.body.innerText : ""');

const KEYS = {
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  j: { code: 'KeyJ', keyCode: 74 },
  k: { code: 'KeyK', keyCode: 75 },
  1: { code: 'Digit1', keyCode: 49 },
  2: { code: 'Digit2', keyCode: 50 },
  3: { code: 'Digit3', keyCode: 51 },
  v: { code: 'KeyV', keyCode: 86 },
};

const STEPS = {
  async wait(text) {
    for (let i = 0; i < 150; i++) {
      if ((await pageText()).toLowerCase().includes(text.toLowerCase())) return;
      await sleep(100);
    }
    throw new Error(`page never showed "${text}"; it shows: ${(await pageText()).slice(0, 300).replace(/\n/g, ' | ')}`);
  },
  async click(text) {
    const ok = await evaluate(
      `(() => { const b = [...document.querySelectorAll('button')].find((el) => el.innerText.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`,
    );
    if (!ok) throw new Error(`no button containing "${text}"`);
  },
  async clickin(spec) {
    const [scope, text] = spec.split('::');
    const ok = await evaluate(`(() => {
      const row = [...document.querySelectorAll('li')].find((el) => el.innerText.includes(${JSON.stringify(scope)}));
      const b = row && [...row.querySelectorAll('button')].find((el) => el.innerText.includes(${JSON.stringify(text)}));
      if (!b) return false; b.click(); return true; })()`);
    if (!ok) throw new Error(`no button containing "${text}" in a list item containing "${scope}"`);
  },
  async reload() {
    await cdp('Page.reload', { ignoreCache: true });
    await sleep(1000);
  },
  async size(spec) {
    const [width, height] = spec.split('x').map(Number);
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  },
  async press(name) {
    const k = KEYS[name];
    if (!k) throw new Error(`unknown key "${name}"; use ${Object.keys(KEYS).join(', ')}`);
    const key = k.key ?? name;
    for (const type of ['keyDown', 'keyUp']) {
      await cdp('Input.dispatchKeyEvent', {
        type,
        key,
        code: k.code,
        windowsVirtualKeyCode: k.keyCode,
        nativeVirtualKeyCode: k.keyCode,
      });
    }
    // The player's key handler reads the active chapter from the last render; a second key before it re-renders repeats the same seek.
    await sleep(300);
  },
  sleep: (ms) => sleep(Number(ms)),
  run(command) {
    execSync(command, { stdio: 'inherit', shell: '/bin/sh' });
  },
  async fullshot(name) {
    const { cssContentSize: size } = await cdp('Page.getLayoutMetrics');
    const clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 };
    const { data } = await cdp('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
    fs.writeFileSync(path.join(outDir, `${name}.txt`), `${await pageText()}\n`);
    console.log(path.join(outDir, `${name}.png`));
  },
  async shot(name) {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
    fs.writeFileSync(path.join(outDir, `${name}.txt`), `${await pageText()}\n`);
    console.log(path.join(outDir, `${name}.png`));
  },
};

let failed = false;
try {
  await connect();
  await cdp('Page.navigate', { url });
  for (const step of steps) {
    const at = step.indexOf(':');
    const [verb, arg] = at < 0 ? [step, ''] : [step.slice(0, at), step.slice(at + 1)];
    if (!STEPS[verb]) throw new Error(`unknown step "${step}"`);
    console.log(`step ${step}`);
    await STEPS[verb](arg);
  }
} catch (err) {
  failed = true;
  console.error(`browse: ${err.message}`);
  if (ws) await STEPS.shot('failed').catch(() => {});
} finally {
  fs.writeFileSync(path.join(outDir, 'console.txt'), consoleLines.join('\n') + (consoleLines.length ? '\n' : ''));
  ws?.close();
  chrome.kill('SIGKILL');
  await sleep(200);
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
