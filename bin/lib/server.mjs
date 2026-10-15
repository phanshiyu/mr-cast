import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const HOST = '127.0.0.1';
const PORT_ATTEMPTS = 21;
const DEBOUNCE_MS = 150;
const KEEPALIVE_MS = 25_000;
const DATA_FILES = new Set(['hunks.json', 'storyboard.json', 'meta.json']);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

function sendFile(res, file, headers = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': st.size,
      ...headers,
    });
    fs.createReadStream(file).pipe(res);
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
 * `onDataChange(fileName)` runs (debounced) before clients are told to reload.
 */
export async function startServer({ distDir, dataDir, port, onDataChange }) {
  const root = path.resolve(distDir);
  const clients = new Set();
  let allowedHosts = new Set();

  const server = http.createServer((req, res) => {
    // Binding to 127.0.0.1 does not stop DNS rebinding: a page on evil.example can resolve
    // its own name to 127.0.0.1 and read responses, but its requests carry the wrong Host.
    if (!allowedHosts.has(req.headers.host?.toLowerCase())) return send(res, 403, 'forbidden host');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    const { pathname } = new URL(req.url, `http://${HOST}`);

    if (pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    const data = pathname.match(/^\/data\/([^/]+)$/);
    if (data) {
      if (!DATA_FILES.has(data[1])) return send(res, 404, 'not found');
      return sendFile(res, path.join(dataDir, data[1]), { 'Cache-Control': 'no-store' });
    }

    const file = safeJoin(root, pathname);
    if (!file) return send(res, 403, 'forbidden');
    fs.stat(file, (err, st) => {
      if (!err && st.isFile()) return sendFile(res, file);
      // Client-side routes have no extension; missing assets should 404, not return HTML.
      if (path.extname(pathname)) return send(res, 404, 'not found');
      sendFile(res, path.join(root, 'index.html'), { 'Cache-Control': 'no-store' });
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
  const watcher = fs.watch(dataDir, (_event, name) => {
    // Some platforms omit the file name; treat that as "something changed".
    const file = name ? String(name) : 'storyboard.json';
    if (!DATA_FILES.has(file)) return;
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const changed = [...pending];
      pending.clear();
      for (const f of changed) onDataChange?.(f);
      broadcast('data: change\n\n');
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

  return { url: `http://${HOST}:${bound}`, close };
}
