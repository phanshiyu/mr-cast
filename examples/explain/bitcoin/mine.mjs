// Mines the toy chain in facts.json, which generate.mjs reads: each block's SHA-256 must start with BITS zero bits.
// Slow on purpose (minutes per block on every core). Run: node examples/explain/bitcoin/mine.mjs
import { createHash } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';

const BITS = 30;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const zeroBits = (hex) => { let n = 0; for (const ch of hex) { const v = parseInt(ch, 16); if (v === 0) { n += 4; continue; } return n + Math.clz32(v) - 28; } return n; };
const blockText = (prev, txs, nonce) => `prev: ${prev}\n${txs.join('\n')}\nnonce: ${nonce}`;

if (!isMainThread) {
  const { prev, txs, start, step } = workerData;
  for (let n = start; ; n += step) {
    if (zeroBits(sha(blockText(prev, txs, n))) >= BITS) { parentPort.postMessage(n); break; }
  }
} else {
  const blocks = [
    ['#1 Alice pays Bob 10 LD', '#2 Bob pays Charlie 5 LD', '#3 Charlie pays David 3 LD'],
    ['#4 David pays Alice 2 LD', '#5 Bob pays David 4 LD'],
    ['#6 Alice pays Charlie 7 LD', '#7 Charlie pays Bob 1 LD'],
  ];
  const mine = (prev, txs) => new Promise((resolve) => {
    const k = os.cpus().length; const ws = [];
    const found = [];
    for (let i = 0; i < k; i++) {
      const w = new Worker(new URL(import.meta.url), { workerData: { prev, txs, start: i, step: k } });
      w.on('message', (n) => { found.push(n); ws.forEach((x) => x.terminate()); resolve(Math.min(...found)); });
      ws.push(w);
    }
  });
  let prev = '0'.repeat(64); const out = [];
  for (const txs of blocks) {
    const t = Date.now();
    const nonce = await mine(prev, txs);
    const hash = sha(blockText(prev, txs, nonce));
    out.push({ prev, txs, nonce, hash, zeroBits: zeroBits(hash), seconds: (Date.now() - t) / 1000 });
    console.log(JSON.stringify(out.at(-1)));
    prev = hash;
  }
  fs.writeFileSync(new URL('./facts.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
}
