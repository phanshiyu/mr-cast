import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fetchLatest, isVersion, writeCache } from '../bin/lib/update.mjs';

test('only a version number counts as the latest version', () => {
  for (const ok of ['1.2.3', '0.28.0', '1.0.0-beta.1', 'v1.2.3'.slice(1)]) assert.equal(isVersion(ok), true, ok);
  for (const bad of [
    '',
    'latest',
    '1.2',
    '../../etc/passwd',
    '1.2.3\n; rm -rf',
    '1.2.3-',
    7,
    null,
    undefined,
    'x'.repeat(100),
  ])
    assert.equal(isVersion(bad), false, String(bad));
});

test('what the registry sends is written to the cache only when it is a version number', async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-update-'));
  const saved = { cache: process.env.XDG_CACHE_HOME, registry: process.env.MR_CAST_REGISTRY };
  let body = { version: '9.9.9' };
  const server = http.createServer((_req, res) => res.end(JSON.stringify(body)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.XDG_CACHE_HOME = cache;
  process.env.MR_CAST_REGISTRY = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await fetchLatest(5000), '9.9.9');
    body = { version: '../../evil' };
    await assert.rejects(fetchLatest(5000), /sent no version/);
    body = { version: 9 };
    await assert.rejects(fetchLatest(5000), /sent no version/);
    assert.throws(() => writeCache('not a version'), /version number/);
    writeCache('9.9.9');
    const [file] = fs.readdirSync(path.join(cache, 'mr-cast'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(cache, 'mr-cast', file), 'utf8')).latest, '9.9.9');
  } finally {
    server.close();
    for (const [key, name] of [
      ['cache', 'XDG_CACHE_HOME'],
      ['registry', 'MR_CAST_REGISTRY'],
    ])
      if (saved[key] === undefined) delete process.env[name];
      else process.env[name] = saved[key];
    fs.rmSync(cache, { recursive: true, force: true });
  }
});
