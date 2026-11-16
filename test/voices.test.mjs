import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { UserError } from '../bin/lib/errors.mjs';
import { downloadChecked } from '../bin/lib/tiny-voca.mjs';
import { ensureVoiceover } from '../bin/lib/voice.mjs';
import { resolveVoice } from '../bin/lib/voices.mjs';
import { settingsArgs, settingsFrom } from '../bin/lib/settings.mjs';
import { clipFor, narrationKey } from '../shared/voice.mjs';

const BIN = fileURLToPath(new URL('../bin/mr-cast.mjs', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-voices-'));

function cli(...args) {
  const home = tmp();
  const env = {
    ...process.env,
    MR_CAST_NO_UPDATE_CHECK: '1',
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_STATE_HOME: path.join(home, 'state'),
    CLAUDE_CONFIG_DIR: path.join(home, 'claude'),
    MR_CAST_PROCS_SCAN: '0',
  };
  const run = (...more) => spawnSync(process.execPath, [BIN, ...more], { cwd: home, env, encoding: 'utf8' });
  return { home, env, run, result: run(...args) };
}

test('a voice is engine:name, and a Kitten or Kokoro voice reads as the closest tiny-voca voice with a notice', () => {
  const notices = [];
  const notify = (line) => notices.push(line);
  assert.equal(resolveVoice({}, notify), 'tiny-voca:m2');
  assert.equal(resolveVoice({ voice: 'f2' }, notify), 'tiny-voca:f2');
  assert.equal(resolveVoice({ voice: 'Tiny-Voca:M2' }, notify), 'tiny-voca:m2');
  assert.equal(resolveVoice({ engine: 'tiny-voca' }, notify), 'tiny-voca:m2');
  assert.equal(resolveVoice({ engine: 'tiny-voca', voice: 'f2' }, notify), 'tiny-voca:f2');
  assert.deepEqual(notices, []);
  for (const [old, now] of [
    ['kitten:luna', 'f2'],
    ['kitten:bruno', 'm2'],
    ['bella', 'f2'],
    ['af_heart', 'f2'],
    ['kokoro:am_michael', 'm2'],
    ['bm_george', 'm2'],
  ])
    assert.equal(resolveVoice({ voice: old }, notify), `tiny-voca:${now}`, old);
  assert.equal(resolveVoice({ engine: 'kokoro' }, notify), 'tiny-voca:m2');
  assert.equal(resolveVoice({ engine: 'kitten', voice: 'rosie' }, notify), 'tiny-voca:f2');
  assert.equal(notices[0], 'mr-cast: kitten:luna is no longer available; using tiny-voca:f2, the closest voice');
  assert.ok(
    notices.includes('mr-cast: the kokoro engine is no longer available; using tiny-voca:m2, the closest voice'),
  );
  resolveVoice({ voice: 'kitten:luna' }, notify);
  assert.equal(notices.filter((n) => n.startsWith('mr-cast: kitten:luna ')).length, 1, 'told once');
  assert.throws(
    () => resolveVoice({ engine: 'tiny-voca', voice: 'kokoro:af_heart' }),
    /is a kokoro voice, but --engine is tiny-voca/,
  );
  assert.throws(() => resolveVoice({ engine: 'espeak' }), /--engine must be one of tiny-voca \(got "espeak"\)/);
  assert.throws(() => resolveVoice({ voice: 'nope' }), /unknown voice "nope"; tiny-voca has f2, m2/);
});

test('settings carry the full voice name, and --no-voice refuses --engine as it refuses --voice', () => {
  assert.equal(settingsFrom({}).voice, 'tiny-voca:m2');
  assert.equal(settingsFrom({ voice: 'f2' }).voice, 'tiny-voca:f2');
  assert.equal(settingsArgs({ engine: 'tiny-voca' }), ' --voice tiny-voca:m2');
  assert.equal(settingsArgs({ voice: 'f2' }), ' --voice tiny-voca:f2');
  assert.throws(() => settingsFrom({ 'no-voice': true, engine: 'tiny-voca' }), /drop one of --no-voice and --engine/);
});

test('the voice chosen last is remembered, and a saved Kitten or Kokoro voice reads back as the closest one', () => {
  const { run, env } = cli('voices', '--sample', 'nope');
  // Not the last line: a running mr-cast anywhere on the machine adds a `running:` line after it.
  const lastVoice = () =>
    run('status')
      .stdout.split('\n')
      .find((l) => l.startsWith('last voice:'));
  assert.equal(lastVoice(), 'last voice: none yet (default tiny-voca:m2)');
  // validate needs a run; a run of an explanation needs no git.
  assert.equal(run('init', '--title', 'Voices', '--voice', 'f2').status, 0);
  assert.equal(lastVoice(), 'last voice: tiny-voca:f2');
  const file = path.join(env.XDG_CONFIG_HOME, 'mr-cast', 'last-choices.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).voice, 'tiny-voca:f2');
  fs.writeFileSync(file, JSON.stringify({ voice: 'kitten:bruno' }));
  assert.equal(lastVoice(), 'last voice: tiny-voca:m2');
  fs.writeFileSync(file, JSON.stringify({ voice: 'bf_emma' }));
  assert.equal(lastVoice(), 'last voice: tiny-voca:f2');
  const status = run('status');
  assert.match(status.stderr, /^mr-cast: bf_emma is no longer available; using tiny-voca:f2, the closest voice$/m);
  fs.writeFileSync(file, JSON.stringify({ voice: 'espeak:x' }));
  assert.equal(lastVoice(), 'last voice: none yet (default tiny-voca:m2)');
});

test('mr-cast voices lists the engine with its download, then its voices, marking the default and the last chosen', () => {
  const { run, home } = cli('voices');
  const before = run('voices').stdout.split('\n');
  assert.equal(before[0], 'tiny-voca · tiny-voca (n4ze3m, 4.5M parameters) · downloads about 27 MB on first use');
  assert.equal(
    before[1],
    '  tiny-voca:f2   female, American English (the model card says it sounds younger than intended)',
  );
  assert.equal(before[2], '  tiny-voca:m2   male, American English (default)');
  assert.equal(run('init', '--title', 'Voices', '--voice', 'f2').status, 0);
  assert.ok(
    run('voices')
      .stdout.split('\n')
      .includes(
        '  tiny-voca:f2   female, American English (the model card says it sounds younger than intended) (last chosen)',
      ),
  );
  assert.equal(run('voices', '--out', path.join(home, 'x.wav')).stderr, 'mr-cast: --out needs --sample\n');
});

test('clip keys include the voice: a clip of one voice never voices another, nor one from before engines', async () => {
  const text = 'The limiter keeps a bucket per client.';
  assert.notEqual(narrationKey(text, 'tiny-voca:m2'), narrationKey(text, 'tiny-voca:f2'));
  const dir = tmp();
  const key = narrationKey(text, 'tiny-voca:m2');
  fs.mkdirSync(path.join(dir, 'audio'));
  fs.writeFileSync(path.join(dir, 'audio', `${key}.wav`), 'RIFF');
  const old = narrationKey(text, 'af_heart');
  fs.writeFileSync(path.join(dir, 'audio', `${old}.wav`), 'RIFF');
  fs.writeFileSync(
    path.join(dir, 'voiceover.json'),
    JSON.stringify({
      voice: 'tiny-voca:m2',
      speed: 1,
      pauses: 1,
      clips: {
        [key]: { src: `audio/${key}.wav`, seconds: 2.5, voice: 'tiny-voca:m2', speed: 1 },
        [old]: { src: `audio/${old}.wav`, seconds: 2, voice: 'af_heart', speed: 1 },
      },
    }),
  );
  const voiceover = await ensureVoiceover({
    dataDir: dir,
    storyboard: { scenes: [{ narration: text }] },
    voice: 'tiny-voca:m2',
    pace: { speed: 1, pauses: 1 },
  });
  assert.deepEqual(clipFor(voiceover, text), {
    src: `audio/${key}.wav`,
    seconds: 2.5,
    voice: 'tiny-voca:m2',
    speed: 1,
  });
  assert.equal(clipFor({ ...voiceover, voice: 'tiny-voca:f2' }, text), undefined);
  assert.equal(
    clipFor({ ...voiceover, voice: 'kokoro:af_heart' }, text),
    undefined,
    'a clip voiced as af_heart before 0.27 is not reused',
  );
});

test('a download is kept only when its sha256 matches the pinned one', async () => {
  const dir = tmp();
  const body = Buffer.from('model weights');
  const file = {
    name: 'model.onnx',
    bytes: body.length,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
  };
  await assert.rejects(
    downloadChecked('https://example.test/model.onnx', dir, file, {
      fetchImpl: async () => new Response('tampered weights'),
    }),
    /model\.onnx failed its integrity check \(sha256 [0-9a-f]{64}, expected [0-9a-f]{64}\)/,
  );
  assert.deepEqual(fs.readdirSync(dir), []);
  await assert.rejects(
    downloadChecked('https://example.test/model.onnx', dir, file, {
      fetchImpl: async () => new Response('gone', { status: 404 }),
    }),
    /answered 404/,
  );
  await downloadChecked('https://example.test/model.onnx', dir, file, { fetchImpl: async () => new Response(body) });
  assert.deepEqual(fs.readdirSync(dir), ['model.onnx']);
  assert.equal(fs.readFileSync(path.join(dir, 'model.onnx'), 'utf8'), 'model weights');
});

/** A server whose response sends `chunks` (strings) with `gapMs` between them, then ends unless `stall`. */
async function slowServer({ chunks, gapMs, stall = false }) {
  const server = http.createServer(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    for (const chunk of chunks) {
      res.write(chunk);
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
    if (!stall) res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/model.onnx`,
    close: () => server.closeAllConnections() || server.close(),
  };
}

const pinned = (text) => ({
  name: 'model.onnx',
  bytes: Buffer.byteLength(text),
  sha256: crypto.createHash('sha256').update(text).digest('hex'),
});

test('a download gives up after a silence, not after a total time, and leaves no partial file', async () => {
  const dir = tmp();
  const steady = await slowServer({ chunks: ['a', 'b', 'c', 'd', 'e', 'f'], gapMs: 100 });
  await downloadChecked(steady.url, dir, pinned('abcdef'), { idleMs: 300 });
  steady.close();
  assert.deepEqual(fs.readdirSync(dir), ['model.onnx'], 'a 600 ms download that never pauses 300 ms is kept');
  fs.rmSync(path.join(dir, 'model.onnx'));
  const stalled = await slowServer({ chunks: ['a'], gapMs: 0, stall: true });
  await assert.rejects(
    downloadChecked(stalled.url, dir, pinned('abcdef'), { idleMs: 300 }),
    /model\.onnx sent nothing for 0\.3 s/,
  );
  stalled.close();
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a body that fails before its first byte leaves no empty partial file behind', async () => {
  const dir = tmp();
  const broken = () =>
    new Response(
      new ReadableStream({
        pull(c) {
          c.error(new Error('connection reset'));
        },
      }),
    );
  await assert.rejects(
    downloadChecked('https://example.test/model.onnx', dir, pinned('x'), { fetchImpl: async () => broken() }),
    /connection reset/,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a cache it cannot write to is a user error naming the directory', {
  skip: process.getuid?.() === 0 && 'root writes anywhere',
}, async () => {
  const dir = tmp();
  fs.chmodSync(dir, 0o500);
  const err = await downloadChecked('https://example.test/model.onnx', dir, pinned('x'), {
    fetchImpl: async () => new Response('x'),
  }).catch((e) => e);
  fs.chmodSync(dir, 0o700);
  assert.ok(err instanceof UserError, `a UserError, not ${err}`);
  assert.equal(err.message.split(' (')[0], `could not write model.onnx into ${dir}`);
  assert.match(err.message, /\(EACCES: /);
  assert.deepEqual(fs.readdirSync(dir), []);
});
