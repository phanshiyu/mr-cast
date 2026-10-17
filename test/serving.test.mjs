import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../bin/lib/server.mjs';
import { createServing } from '../bin/lib/serving.mjs';

const board = (title, narration) => ({ title, scenes: [{ type: 'intent', narration, bullets: ['a'] }] });
const voiceFor = (sb) => ({ voice: 'af_heart', clips: { [sb.scenes[0].narration]: { src: 'audio/x.wav', seconds: 3 } } });
const voicedOf = (sb, voiceover) => sb.scenes.every((s) => voiceover.clips[s.narration]);

/** A voicing the test finishes by hand: each call to `voice` waits until `finish()` or `fail()`. */
function handVoice({ onDisk = {} } = {}) {
  const calls = [];
  const clips = { ...onDisk };
  return {
    calls,
    now: async (sb) => {
      const voiceover = { voice: 'af_heart', clips: { ...clips } };
      return { voiceover, wait: !voicedOf(sb, voiceover) };
    },
    voice: (sb) => new Promise((resolve) => calls.push({
      finish: () => {
        Object.assign(clips, voiceFor(sb).clips);
        resolve({ voice: 'af_heart', clips: { ...clips } });
      },
      fail: () => resolve({ voice: 'af_heart', clips: {}, failed: true }),
    })),
  };
}

const settledWithin = (promise, ms) => Promise.race([promise.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);
const until = async (check) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), 'condition met within 2 s');
};

test('play is ready to open the page only once the first storyboard is voiced', async () => {
  const sb = board('First', 'The limiter counts requests per minute.');
  const fake = handVoice();
  const serving = await createServing({ raw: sb, storyboard: sb, now: fake.now, voice: fake.voice, reload: () => {} });
  serving.start();
  await until(() => fake.calls.length === 1);
  assert.equal(await settledWithin(serving.ready, 50), false, 'not ready while voicing');
  assert.equal(serving.voiceover().pending, true);

  fake.calls[0].finish();
  assert.equal(await settledWithin(serving.ready, 500), true, 'ready once voiced');
  assert.deepEqual(serving.voiceover(), { voice: 'af_heart', clips: voiceFor(sb).clips });
});

test('a failed voicing still opens the page, served as failed', async () => {
  const sb = board('First', 'The limiter counts requests per minute.');
  const fake = handVoice();
  const serving = await createServing({ raw: sb, storyboard: sb, now: fake.now, voice: fake.voice, reload: () => {} });
  serving.start();
  await until(() => fake.calls.length === 1);
  fake.calls[0].fail();
  assert.equal(await settledWithin(serving.ready, 500), true);
  assert.deepEqual(serving.voiceover(), { voice: 'af_heart', clips: {}, failed: true });
});

test('a storyboard already voiced is ready at once and voices nothing', async () => {
  const sb = board('First', 'The limiter counts requests per minute.');
  const fake = handVoice({ onDisk: voiceFor(sb).clips });
  const serving = await createServing({ raw: sb, storyboard: sb, now: fake.now, voice: fake.voice, reload: () => {} });
  serving.start();
  assert.equal(await settledWithin(serving.ready, 50), true);
  assert.equal(fake.calls.length, 0);
});

/** The server's event stream, as the names of the events received so far. */
function listen(url) {
  const names = [];
  const req = http.get(`${url}/events`, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      for (const m of chunk.matchAll(/^event: (\w+)$/gm)) names.push(m[1]);
    });
  });
  req.on('error', () => {});
  return { names, close: () => req.destroy() };
}

const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve(JSON.parse(body)));
  }).on('error', reject);
});

test('an edit keeps the page on the old storyboard and voice until it is voiced, then reloads it once', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-serving-'));
  const before = board('Before the edit', 'The limiter counts requests per minute.');
  const after = board('After the edit', 'The limiter now refuses the next request.');
  fs.writeFileSync(path.join(dataDir, 'storyboard.json'), JSON.stringify(before));
  const fake = handVoice({ onDisk: voiceFor(before).clips });

  let server = null;
  const serving = await createServing({ raw: before, storyboard: before, now: fake.now, voice: fake.voice, reload: () => server?.reload() });
  serving.start();
  const onDataChange = (file) => {
    if (file !== 'storyboard.json') return serving.holding() ? 'hold' : undefined;
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'storyboard.json'), 'utf8'));
    return serving.edit(raw, raw);
  };
  server = await startServer({ distDir: dataDir, dataDir, port: 4900, onDataChange, getVoiceover: serving.voiceover, getStoryboard: serving.storyboard });
  const events = listen(server.url);
  try {
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(dataDir, 'storyboard.json'), JSON.stringify(after));
    await until(() => events.names.includes('updating'));
    assert.equal((await getJson(`${server.url}/data/storyboard.json`)).title, 'Before the edit');
    assert.deepEqual((await getJson(`${server.url}/data/voiceover.json`)).clips, voiceFor(before).clips);

    // Another file changing meanwhile does not reload the page early.
    fs.writeFileSync(path.join(dataDir, 'hunks.json'), '{}');
    await until(() => events.names.filter((n) => n === 'updating').length === 2);
    assert.deepEqual(events.names, ['updating', 'updating']);

    fake.calls[0].finish();
    await until(() => events.names.includes('change'));
    assert.deepEqual(events.names, ['updating', 'updating', 'change']);
    assert.equal((await getJson(`${server.url}/data/storyboard.json`)).title, 'After the edit');
    assert.deepEqual(Object.keys((await getJson(`${server.url}/data/voiceover.json`)).clips).sort(), [before.scenes[0].narration, after.scenes[0].narration].sort());
  } finally {
    events.close();
    await server.close();
  }
});
