import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-model-download-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const { ensureVoiceover } = await import('../bin/lib/voice.mjs');
const { ensureVoiceoverInChild } = await import('../bin/lib/voice-child.mjs');
const { listArtifacts, select } = await import('../bin/lib/prune.mjs');
const { ENGINES } = await import('../bin/lib/voices.mjs');

let n = 0;
/** A fresh cache, and a model host that answers every request with a few bytes and then nothing. */
async function stalledHub() {
  const home = path.join(root, `case-${n++}`);
  process.env.XDG_CACHE_HOME = path.join(home, 'cache');
  const requests = [];
  let arrived;
  const firstRequest = new Promise((resolve) => { arrived = resolve; });
  const server = http.createServer((req, res) => {
    requests.push(req);
    res.writeHead(200, { 'content-length': '78268016' });
    res.write('ONNX');
    arrived();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.HF_ENDPOINT = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
  after(close);
  const project = path.join(home, 'run');
  fs.mkdirSync(project, { recursive: true });
  const args = { dataDir: project, storyboard: { scenes: [{ narration: 'The limiter keeps a bucket per client.' }] }, voice: 'kitten:luna', pace: { speed: 1, pauses: 1 } };
  return { requests, firstRequest, close, args };
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('prune sees the Kitten download in progress and will not delete the model under it', async () => {
  const hub = await stalledHub();
  const voicing = ensureVoiceover(hub.args).catch((err) => err);
  await hub.firstRequest;
  const kitten = listArtifacts(path.join(root, 'none')).find((a) => a.id === 'cache:kitten');
  assert.equal(kitten.busy, `mr-cast pid ${process.pid} is downloading into it`);
  assert.throws(() => select(listArtifacts(path.join(root, 'none')), { ids: ['cache:kitten'], kinds: null, all: false, except: [], olderThanDays: null }),
    /not pruning anything: cache:kitten is in use, mr-cast pid \d+ is downloading into it/);
  await hub.close();
  assert.match((await voicing).message, /could not load the kitten voice model/);
});

test('an edit that stops play\'s voicing leaves the model download running, and the next voicing waits on that one', async () => {
  const hub = await stalledHub();
  const first = new AbortController();
  const voicing = ensureVoiceoverInChild({ ...hub.args, signal: first.signal });
  await hub.firstRequest;
  first.abort();
  assert.equal(await voicing, null);
  const second = new AbortController();
  const next = ensureVoiceoverInChild({ ...hub.args, signal: second.signal });
  await settle(500);
  assert.equal(hub.requests.length, 1, 'one download, shared');
  assert.equal(hub.requests[0].socket.destroyed, false, 'the download was not stopped');
  second.abort();
  assert.equal(await next, null);
  await hub.close();
});

test('a download removes the partial files a killed download left, and keeps a live one', async () => {
  const hub = await stalledHub();
  const dir = ENGINES.kitten.dir();
  fs.mkdirSync(dir, { recursive: true });
  const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
  const dead = `kitten_tts_mini_v0_8.onnx.tmp-${gone}`;
  const live = `voices.npz.tmp-${process.ppid}`;
  for (const name of [dead, live]) fs.writeFileSync(path.join(dir, name), 'partial');
  const voicing = ensureVoiceover(hub.args).catch((err) => err);
  await hub.firstRequest;
  const left = fs.readdirSync(dir).filter((name) => name !== `kitten_tts_mini_v0_8.onnx.tmp-${process.pid}`);
  await hub.close();
  await voicing;
  assert.deepEqual(left, [live]);
});
