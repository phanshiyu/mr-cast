import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { BUILT_FILE, PLAN_FILE, writeChoice } from './plan.mjs';
import { AUDIO_NAME } from './voice.mjs';

const HOST = '127.0.0.1';
const PORT_ATTEMPTS = 21;
const DEBOUNCE_MS = 150;
const KEEPALIVE_MS = 25_000;
const DATA_FILES = new Set(['hunks.json', 'storyboard.json', 'meta.json', PLAN_FILE, BUILT_FILE]);
// A choice is a topic id and two words; anything near this size is not one.
const BODY_MAX = 4096;
export const TOKEN_HEADER = 'x-mr-cast-token';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

/** Streams `file`, honouring a single-range Range header so media elements can seek. */
export function sendFile(req, res, file, headers = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (!range || (!range[1] && !range[2])) {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', ...headers });
      return fs.createReadStream(file).pipe(res);
    }
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${st.size}`,
      'Accept-Ranges': 'bytes',
      ...headers,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

/** Resolve a URL path inside `root`, or null if it would escape it. */
function safeJoin(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const file = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

/**
 * POST /plan/choice from the plan page. A page on another site can send this request too, so it must carry the
 * token from the URL mr-cast opened, which other sites cannot read. A JSON content type makes a browser ask
 * first for a cross-site request, which this server never allows.
 */
function postChoice(req, res, { token, dataDir }) {
  const given = Buffer.from(String(req.headers[TOKEN_HEADER] ?? ''));
  if (given.length !== token.length || !timingSafeEqual(given, token)) return sendJson(res, 403, { error: 'missing or wrong token; open the URL mr-cast printed' });
  if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) return sendJson(res, 415, { error: 'send application/json' });
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > BODY_MAX) {
      sendJson(res, 413, { error: 'request too large' });
      req.destroy();
    } else chunks.push(chunk);
  });
  req.on('end', () => {
    if (size > BODY_MAX) return;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return sendJson(res, 400, { error: 'body is not JSON' }); }
    let result;
    try { result = writeChoice(dataDir, body); } catch (err) { result = { status: 500, error: `could not write plan.json: ${err.message}` }; }
    sendJson(res, result.status, result.error ? { error: result.error } : { ok: true });
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolve(server.address().port); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

/**
 * Serve the player from `distDir` and live data from `dataDir`.
 * `onDataChange(fileName)` runs (debounced, one batch at a time, awaited) before clients are told to reload.
 * `getVoiceover()` is the voiceover the player should use, or null for silent scenes.
 * The plan page changes plan.json through POST /plan/choice, with the returned `token` in TOKEN_HEADER.
 */
export async function startServer({ distDir, dataDir, port, onDataChange, getVoiceover }) {
  const root = path.resolve(distDir);
  const token = randomBytes(16).toString('hex');
  const tokenBytes = Buffer.from(token);
  const clients = new Set();
  let allowedHosts = new Set();

  const server = http.createServer((req, res) => {
    // Binding to 127.0.0.1 does not stop DNS rebinding: a page on evil.example can resolve
    // its own name to 127.0.0.1 and read responses, but its requests carry the wrong Host.
    if (!allowedHosts.has(req.headers.host?.toLowerCase())) return send(res, 403, 'forbidden host');
    const { pathname } = new URL(req.url, `http://${HOST}`);
    if (pathname === '/plan/choice') {
      if (req.method !== 'POST') return send(res, 405, 'method not allowed');
      return postChoice(req, res, { token: tokenBytes, dataDir });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');

    if (pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (pathname === '/data/voiceover.json') {
      const voiceover = getVoiceover?.();
      if (!voiceover) return send(res, 404, 'not found');
      res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(voiceover));
    }

    const audio = pathname.match(/^\/data\/audio\/([^/]+)$/);
    if (audio) {
      if (!AUDIO_NAME.test(audio[1])) return send(res, 404, 'not found');
      // Clip names are content hashes, so a cached clip never goes stale.
      return sendFile(req, res, path.join(dataDir, 'audio', audio[1]), { 'Cache-Control': 'max-age=31536000, immutable' });
    }

    const data = pathname.match(/^\/data\/([^/]+)$/);
    if (data) {
      if (!DATA_FILES.has(data[1])) return send(res, 404, 'not found');
      return sendFile(req, res, path.join(dataDir, data[1]), { 'Cache-Control': 'no-store' });
    }

    const file = safeJoin(root, pathname);
    if (!file) return send(res, 403, 'forbidden');
    fs.stat(file, (err, st) => {
      if (!err && st.isFile()) return sendFile(req, res, file);
      // Client-side routes have no extension; missing assets should 404, not return HTML.
      if (path.extname(pathname)) return send(res, 404, 'not found');
      sendFile(req, res, path.join(root, 'index.html'), { 'Cache-Control': 'no-store' });
    });
  });

  let bound;
  for (let p = port; p < port + PORT_ATTEMPTS && !bound; p++) {
    try {
      bound = await listen(server, p);
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  if (!bound) throw new Error(`ports ${port}-${port + PORT_ATTEMPTS - 1} are all in use; pass --port`);
  allowedHosts = new Set([`${HOST}:${bound}`, `localhost:${bound}`]);

  const broadcast = (msg) => { for (const c of clients) c.write(msg); };
  const keepalive = setInterval(() => broadcast(': keepalive\n\n'), KEEPALIVE_MS);

  const pending = new Set();
  let timer = null;
  let handling = Promise.resolve();
  const watcher = fs.watch(dataDir, (_event, name) => {
    // Some platforms omit the file name; treat that as "something changed".
    const file = name ? String(name) : 'storyboard.json';
    if (!DATA_FILES.has(file)) return;
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const changed = [...pending];
      pending.clear();
      handling = handling.then(async () => {
        for (const f of changed) {
          try {
            await onDataChange?.(f);
          } catch (err) {
            console.error(`mr-cast: ${f} changed · ${err.message}`);
          }
        }
        broadcast('event: change\ndata: change\n\n');
      });
    }, DEBOUNCE_MS);
  });
  watcher.on('error', (err) => console.error(`mr-cast: stopped watching ${dataDir} (${err.message}); restart play to resume live reload`));

  const close = () => new Promise((resolve) => {
    clearInterval(keepalive);
    clearTimeout(timer);
    watcher.close();
    for (const c of clients) c.end();
    server.close(() => resolve());
    server.closeAllConnections?.();
  });

  // Tells open players that more of the voice-over is ready, without reloading the walkthrough.
  const voiceProgress = () => broadcast('event: voice\ndata: voice\n\n');
  // Tells open players to reload the walkthrough, as after a change to its files.
  const reload = () => broadcast('event: change\ndata: change\n\n');

  return { url: `http://${HOST}:${bound}`, token, close, voiceProgress, reload };
}
