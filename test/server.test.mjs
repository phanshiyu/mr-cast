import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-server-'));

test('a request the URL parser refuses is a 400, and the server keeps serving', async () => {
  const { startServer } = await import('../bin/lib/server.mjs');
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
  const server = await startServer({ distDir: dir, dataDir: dir, port: 0 });
  try {
    const port = Number(new URL(server.url).port);
    // fetch rewrites the path, so send it as-is with node:http.
    const status = await new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '//' }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        })
        .on('error', reject);
    });
    assert.equal(status, 400);
    const after = await fetch(`${server.url}/data/settings.json`);
    assert.equal(after.status, 200);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a file that cannot be opened is a 404, and the server keeps serving', {
  skip: process.getuid?.() === 0 && 'root reads any file',
}, async () => {
  const { startServer } = await import('../bin/lib/server.mjs');
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
  const locked = path.join(dir, 'locked.js');
  fs.writeFileSync(locked, 'x');
  fs.chmodSync(locked, 0o000);
  const server = await startServer({ distDir: dir, dataDir: dir, port: 0 });
  try {
    const res = await fetch(`${server.url}/locked.js`);
    assert.equal(res.status, 404);
    const after = await fetch(`${server.url}/data/settings.json`);
    assert.equal(after.status, 200);
  } finally {
    fs.chmodSync(locked, 0o644);
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
