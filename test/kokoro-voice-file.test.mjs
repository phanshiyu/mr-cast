import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { env as hf } from '@huggingface/transformers';
import { getVoiceData } from '../bin/lib/kokoro/voices.js';

const FLOATS = 510 * 256;

test('a Kokoro voice file is cached only when it is 510 style vectors of small finite numbers', async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-voice-file-'));
  const saved = { cacheDir: hf.cacheDir, remoteHost: hf.remoteHost, allow: hf.allowRemoteModels };
  let body = Buffer.from(new Float32Array(FLOATS).fill(0.25).buffer);
  const server = http.createServer((_req, res) => res.end(body));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  hf.cacheDir = cache;
  hf.remoteHost = `http://127.0.0.1:${server.address().port}`;
  hf.allowRemoteModels = true;
  const cached = () => path.join(cache, 'onnx-community/Kokoro-82M-v1.0-ONNX/voices');
  try {
    const bad = {
      af_alloy: Buffer.alloc(100),
      af_bella: Buffer.from(new Float32Array(FLOATS).fill(Number.NaN).buffer),
      af_heart: Buffer.from(new Float32Array(FLOATS).fill(1e9).buffer),
    };
    for (const [id, bytes] of Object.entries(bad)) {
      body = bytes;
      await assert.rejects(getVoiceData(id), /voice af_/);
    }
    await assert.rejects(getVoiceData('../../etc/passwd'), /unknown voice/);
    assert.ok(!fs.existsSync(cached()) || fs.readdirSync(cached()).length === 0);
    body = Buffer.from(new Float32Array(FLOATS).fill(0.25).buffer);
    const data = await getVoiceData('af_nova');
    assert.equal(data.length, FLOATS);
    assert.deepEqual(fs.readdirSync(cached()), ['af_nova.bin']);
  } finally {
    server.close();
    Object.assign(hf, { cacheDir: saved.cacheDir, remoteHost: saved.remoteHost, allowRemoteModels: saved.allow });
    fs.rmSync(cache, { recursive: true, force: true });
  }
});
