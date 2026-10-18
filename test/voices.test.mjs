import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chunkText, downloadChecked, kittenPhonemes, kittenTokens } from '../bin/lib/kitten.mjs';
import { UserError } from '../bin/lib/errors.mjs';
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

test('a voice is engine:name; a bare name finds its engine, so the Kokoro names of 0.26 still pick Kokoro', () => {
  assert.equal(resolveVoice({}), 'kitten:luna');
  assert.equal(resolveVoice({ voice: 'bella' }), 'kitten:bella');
  assert.equal(resolveVoice({ voice: 'Kitten:Leo' }), 'kitten:leo');
  for (const old of ['af_heart', 'af_bella', 'am_michael', 'bf_emma', 'bm_george'])
    assert.equal(resolveVoice({ voice: old }), `kokoro:${old}`);
  assert.equal(resolveVoice({ engine: 'kokoro' }), 'kokoro:af_heart');
  assert.equal(resolveVoice({ engine: 'kitten', voice: 'rosie' }), 'kitten:rosie');
  assert.throws(
    () => resolveVoice({ engine: 'kitten', voice: 'af_heart' }),
    /unknown voice "af_heart" for kitten; kitten has bella, jasper, luna/,
  );
  assert.throws(
    () => resolveVoice({ engine: 'kitten', voice: 'kokoro:af_heart' }),
    /is a kokoro voice, but --engine is kitten/,
  );
  assert.throws(() => resolveVoice({ engine: 'espeak' }), /--engine must be one of kitten, kokoro \(got "espeak"\)/);
  assert.throws(() => resolveVoice({ voice: 'nope' }), /unknown voice "nope"; kitten has/);
});

test('settings carry the full voice name, and --no-voice refuses --engine as it refuses --voice', () => {
  assert.equal(settingsFrom({}).voice, 'kitten:luna');
  assert.equal(settingsFrom({ voice: 'af_heart' }).voice, 'kokoro:af_heart');
  assert.equal(settingsArgs({ engine: 'kokoro' }), ' --voice kokoro:af_heart');
  assert.equal(settingsArgs({ voice: 'luna' }), ' --voice kitten:luna');
  assert.throws(() => settingsFrom({ 'no-voice': true, engine: 'kitten' }), /drop one of --no-voice and --engine/);
});

test('the voice chosen last is remembered with its engine, and a stored bare Kokoro name reads back as Kokoro', () => {
  const { run, env } = cli('voices', '--sample', 'nope');
  // Not the last line: a running mr-cast anywhere on the machine adds a `running:` line after it.
  const lastVoice = () =>
    run('status')
      .stdout.split('\n')
      .find((l) => l.startsWith('last voice:'));
  assert.equal(lastVoice(), 'last voice: none yet (default kitten:luna)');
  // validate needs a run; a run of an explanation needs no git.
  assert.equal(run('init', '--title', 'Voices', '--engine', 'kokoro').status, 0);
  assert.equal(lastVoice(), 'last voice: kokoro:af_heart');
  assert.equal(run('init', '--title', 'Voices', '--voice', 'bruno').status, 0);
  assert.equal(lastVoice(), 'last voice: kitten:bruno');
  const file = path.join(env.XDG_CONFIG_HOME, 'mr-cast', 'last-choices.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).voice, 'kitten:bruno');
  fs.writeFileSync(file, JSON.stringify({ voice: 'bf_emma' }));
  assert.equal(lastVoice(), 'last voice: kokoro:bf_emma');
  fs.writeFileSync(file, JSON.stringify({ voice: 'kitten:af_heart' }));
  assert.equal(lastVoice(), 'last voice: none yet (default kitten:luna)');
});

test('mr-cast voices lists each engine with its download, then its voices, marking the default and the last chosen', () => {
  const { run, home } = cli('voices');
  const before = run('voices').stdout.split('\n');
  assert.equal(
    before[0],
    'kitten (default engine) · Kitten TTS mini 0.8 (KittenML, 80M parameters) · downloads about 82 MB on first use',
  );
  assert.equal(before[1], '  kitten:bella       female, American English');
  assert.equal(before[3], '  kitten:luna        female, American English (default)');
  assert.equal(before[9], 'kokoro · Kokoro 82M v1.0 (hexgrad, 82M parameters) · downloads about 90 MB on first use');
  assert.equal(before[10], '  kokoro:af_heart    female, American English, model card grade A');
  assert.ok(before.includes('  kokoro:bm_george   male, British English, model card grade C'));
  assert.equal(run('init', '--title', 'Voices', '--voice', 'am_michael').status, 0);
  assert.ok(
    run('voices')
      .stdout.split('\n')
      .includes('  kokoro:am_michael  male, American English, model card grade C+ (last chosen)'),
  );
  assert.equal(run('voices', '--out', path.join(home, 'x.wav')).stderr, 'mr-cast: --out needs --sample\n');
});

test('clip keys include the engine: a clip of one engine never voices another, nor one from before engines', async () => {
  const text = 'The limiter keeps a bucket per client.';
  assert.notEqual(narrationKey(text, 'kitten:luna'), narrationKey(text, 'kokoro:af_heart'));
  const dir = tmp();
  const key = narrationKey(text, 'kitten:luna');
  fs.mkdirSync(path.join(dir, 'audio'));
  fs.writeFileSync(path.join(dir, 'audio', `${key}.wav`), 'RIFF');
  const old = narrationKey(text, 'af_heart');
  fs.writeFileSync(path.join(dir, 'audio', `${old}.wav`), 'RIFF');
  fs.writeFileSync(
    path.join(dir, 'voiceover.json'),
    JSON.stringify({
      voice: 'kitten:luna',
      speed: 1,
      pauses: 1,
      clips: {
        [key]: { src: `audio/${key}.wav`, seconds: 2.5, voice: 'kitten:luna', speed: 1 },
        [old]: { src: `audio/${old}.wav`, seconds: 2, voice: 'af_heart', speed: 1 },
      },
    }),
  );
  const voiceover = await ensureVoiceover({
    dataDir: dir,
    storyboard: { scenes: [{ narration: text }] },
    voice: 'kitten:luna',
    pace: { speed: 1, pauses: 1 },
  });
  assert.deepEqual(clipFor(voiceover, text), { src: `audio/${key}.wav`, seconds: 2.5, voice: 'kitten:luna', speed: 1 });
  assert.equal(clipFor({ ...voiceover, voice: 'kokoro:luna' }, text), undefined);
  assert.equal(
    clipFor({ ...voiceover, voice: 'kokoro:af_heart' }, text),
    undefined,
    'a clip voiced as af_heart before 0.27 is not reused',
  );
});

test('a download is kept only when its sha256 matches the pinned one', async () => {
  const dir = tmp();
  const body = Buffer.from('kitten weights');
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
  assert.equal(fs.readFileSync(path.join(dir, 'model.onnx'), 'utf8'), 'kitten weights');
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

// The phonemes and ids kittenml 0.9.4 makes for these lines (espeak-ng 1.52), from its Python package.
test('the phonemes and token ids match the kittenml Python package', async () => {
  assert.equal(await kittenPhonemes('Hello, world.'), 'həlˈoʊ , wˈɜːld .');
  assert.deepEqual(
    kittenTokens(await kittenPhonemes('Hello, world.')),
    [0, 50, 83, 54, 156, 57, 135, 16, 3, 16, 65, 156, 87, 158, 54, 46, 16, 4, 10, 0],
  );
  assert.equal(
    await kittenPhonemes('Each request fails with 429 before the store recovers.'),
    'ˈiːtʃ ɹᵻkwˈɛst fˈeɪlz wɪð fˈɔːɹhˈʌndɹɪd twˈɛnti nˈaɪn bᵻfˌɔːɹ ðə stˈɔːɹ ɹᵻkˈʌvɚz .',
  );
  const decimal = 'It loads in 3.5 seconds; then it stops!';
  assert.equal(await kittenPhonemes(decimal), 'ɪt lˈoʊdz ɪn θɹˈiː pɔɪnt fˈaɪv sˈɛkəndz ; ðˈɛn ɪt stˈɑːps !');
  assert.deepEqual(
    kittenTokens(await kittenPhonemes(decimal)),
    [
      0, 102, 62, 16, 54, 156, 57, 135, 46, 68, 16, 102, 56, 16, 119, 123, 156, 51, 158, 16, 58, 76, 102, 56, 62, 16,
      48, 156, 43, 102, 64, 16, 61, 156, 86, 53, 83, 56, 46, 68, 16, 1, 16, 81, 156, 86, 56, 16, 102, 62, 16, 61, 62,
      156, 69, 158, 58, 61, 16, 5, 10, 0,
    ],
  );
  assert.deepEqual(chunkText('Dr. Smith left at 5 p.m. Then he came back. Is it done? Yes'), [
    'Dr. Smith left at 5 p.m.',
    'Then he came back.',
    'Is it done?',
    'Yes,',
  ]);
});

test('a command that voices nothing loads no phonemizer, whose crash handlers would print its minified source', () => {
  const home = tmp();
  const probe = `data:text/javascript,process.on('exit',()=>process.stderr.write('handlers '+process.listenerCount('uncaughtException')+' '+process.listenerCount('unhandledRejection')))`;
  const env = {
    ...process.env,
    MR_CAST_NO_UPDATE_CHECK: '1',
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    CLAUDE_CONFIG_DIR: path.join(home, 'claude'),
  };
  const result = spawnSync(process.execPath, ['--import', probe, BIN, 'voices'], { cwd: home, env, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, 'handlers 0 0');
});
