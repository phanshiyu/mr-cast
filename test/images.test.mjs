import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { imageSize, readImages, resolveImages, sniffImage } from '../bin/lib/images.mjs';
import { validateStoryboard } from '../bin/lib/validate.mjs';

const png = (width, height) => sharp({ create: { width, height, channels: 3, background: '#3366cc' } }).png().toBuffer();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-images-'));
const board = (...srcs) => ({ title: 't', scenes: srcs.map((src) => ({ type: 'image', narration: 'x', src })) });

/** A server for one test: each path answers with the given status, type and body; it counts requests. */
async function serve(routes) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const route = routes[req.url];
    if (!route) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('nope');
    res.writeHead(route.status ?? 200, { 'Content-Type': route.type, ...(route.headers ?? {}) });
    res.end(route.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}

test('the header of each image type gives the size a browser draws it at', async () => {
  for (const format of ['png', 'jpeg', 'webp', 'gif']) {
    const buf = await sharp({ create: { width: 321, height: 123, channels: 3, background: '#808080' } }).toFormat(format).toBuffer();
    const type = sniffImage(buf);
    assert.equal(type, format === 'jpeg' ? 'jpg' : format);
    assert.deepEqual(imageSize(buf, type), { width: 321, height: 123 }, format);
  }
  // A phone photo stored landscape with orientation 6 is drawn portrait.
  const rotated = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#808080' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.deepEqual(imageSize(rotated, 'jpg'), { width: 200, height: 300 });
  assert.equal(sniffImage(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
});

test('a local image is copied into the run by its content, and images.json maps its source to the copy', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'shots'));
  fs.writeFileSync(path.join(dir, 'shots/before.png'), await png(640, 360));
  const { manifest, problems } = await resolveImages(dir, board('shots/before.png'), { repo: null });
  assert.deepEqual(problems, []);
  const entry = manifest['shots/before.png'];
  assert.match(entry.file, /^images\/[0-9a-f]{16}\.png$/);
  assert.deepEqual({ width: entry.width, height: entry.height }, { width: 640, height: 360 });
  assert.ok(fs.readFileSync(path.join(dir, entry.file)).equals(fs.readFileSync(path.join(dir, 'shots/before.png'))));
  assert.deepEqual(readImages(dir), manifest);
});

test('a source that cannot be shown is an error at its field that says why', async () => {
  const dir = tmp();
  const repo = tmp();
  fs.writeFileSync(path.join(dir, 'notes.png'), 'hello, I am text');
  fs.writeFileSync(path.join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>');
  const big = Buffer.alloc(11 * 1024 * 1024);
  (await png(4, 4)).copy(big);
  fs.writeFileSync(path.join(dir, 'huge.png'), big);
  fs.writeFileSync(path.join(path.dirname(dir), 'outside.png'), await png(4, 4));
  const sb = board('missing.png', 'notes.png', 'logo.svg', 'huge.png', `../${'outside.png'}`, '/etc/hosts', 'ftp://x/y.png');
  const { manifest, problems } = await resolveImages(dir, sb, { repo });
  assert.deepEqual(manifest, {});
  assert.deepEqual(problems.map((p) => `${p.path}: ${p.message}`), [
    `scenes[0].src: "missing.png" is not a file in ${dir} or in ${repo}`,
    'scenes[1].src: "notes.png" is not a PNG, JPEG, WebP or GIF image; its first bytes are of no image type mr-cast shows',
    'scenes[2].src: "logo.svg" is an SVG image, which mr-cast does not show as a picture since it can carry scripts; draw it in an svg scene, or convert it to PNG',
    'scenes[3].src: "huge.png" is 11.0 MB; an image may be up to 10 MB',
    `scenes[4].src: "../outside.png" is not a file in ${dir} or in ${repo}`,
    'scenes[5].src: "/etc/hosts" is an absolute path; write it relative to the run directory or the repository, or give an http(s) URL',
    'scenes[6].src: "ftp://x/y.png" is neither a relative path nor an http(s) URL',
  ]);
  assert.ok(problems.every((p) => p.level === 'error'));
});

test('a URL is downloaded once into the run, and later runs read the copy without asking the server', async () => {
  const body = await png(800, 600);
  const server = await serve({ '/cat.png': { type: 'image/png', body } });
  try {
    const dir = tmp();
    const src = `${server.url}/cat.png`;
    const first = await resolveImages(dir, board(src), { repo: null });
    assert.deepEqual(first.problems, []);
    assert.match(first.manifest[src].file, /^images\/[0-9a-f]{16}\.png$/);
    assert.equal(first.manifest[src].width, 800);
    const second = await resolveImages(dir, board(src, src), { repo: null });
    assert.deepEqual(second.manifest, first.manifest);
    assert.deepEqual(server.hits, ['/cat.png']);
  } finally {
    await server.close();
  }
});

test('a URL that cannot be downloaded or is no image is an error with the reason', async () => {
  const server = await serve({
    '/page': { type: 'text/html', body: '<html></html>' },
    '/fake.png': { type: 'image/png', body: 'not really' },
    '/big.png': { type: 'image/png', body: 'x', headers: { 'Content-Length': String(11 * 1024 * 1024) } },
    '/icon.svg': { type: 'image/svg+xml', body: '<svg></svg>' },
  });
  const closed = await serve({});
  const deadUrl = closed.url;
  await closed.close();
  try {
    const dir = tmp();
    const srcs = ['/missing.png', '/page', '/fake.png', '/big.png', '/icon.svg'].map((p) => server.url + p);
    const { problems } = await resolveImages(dir, board(...srcs, `${deadUrl}/x.png`), { repo: null });
    assert.deepEqual(problems.map((p) => p.message), [
      `"${srcs[0]}" could not be downloaded: the server answered HTTP 404 Not Found`,
      `"${srcs[1]}" is not a PNG, JPEG, WebP or GIF image: the server sends it as "text/html"`,
      `"${srcs[2]}" is not a PNG, JPEG, WebP or GIF image; its first bytes are of no image type mr-cast shows`,
      `"${srcs[3]}" is 11.0 MB; an image may be up to 10 MB`,
      `"${srcs[4]}" is not a PNG, JPEG, WebP or GIF image: the server sends it as "image/svg+xml"`,
      `"${deadUrl}/x.png" could not be downloaded: ECONNREFUSED`,
    ]);
    assert.deepEqual(fs.existsSync(path.join(dir, 'images')) ? fs.readdirSync(path.join(dir, 'images')) : [], []);
  } finally {
    await server.close();
  }
});

test('the read-only check downloads and writes nothing, and says a URL is not downloaded yet', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.png'), await png(10, 10));
  const { manifest, problems } = await resolveImages(dir, board('a.png', 'https://example.invalid/b.png'), { write: false, repo: null });
  assert.deepEqual(Object.keys(manifest), ['a.png']);
  assert.deepEqual(problems, [{ path: 'scenes[1].src', message: '"https://example.invalid/b.png" is not downloaded yet; `mr-cast validate` downloads it', level: 'warning' }]);
  assert.deepEqual(fs.readdirSync(dir), ['a.png']);
});

const imageScene = (extra) => ({ type: 'image', narration: 'A desk.', src: 'desk.png', ...extra });
const check = async (scene, images) => validateStoryboard({ title: 't', scenes: [scene] }, {}, { mode: 'explain', images });

test('validate names an image scene field that cannot be drawn', async () => {
  const { errors } = await check(
    imageScene({
      src: 'logo.svg',
      fit: 'stretch',
      regions: [{ id: 'a', box: [0.5, 0.5, 0.6, 0.2] }, { id: 'a', box: [0, 0, 0.1] }],
      kenBurns: { from: 'b', to: [0, 0, 0, 1] },
    }),
  );
  assert.deepEqual(errors, [
    'scenes[0].src: "logo.svg" is an SVG image, which mr-cast does not show as a picture since it can carry scripts; draw it in an svg scene, or convert it to PNG',
    'scenes[0].fit: must be one of contain, cover',
    'scenes[0].regions[0].box: runs past the picture; x + width and y + height are at most 1',
    'scenes[0].regions[1].id: "a" is taken; every region has its own id',
    'scenes[0].regions[1].box: must be [x, y, width, height], fractions of the picture from its top left, e.g. [0.1, 0.2, 0.3, 0.25]',
    'scenes[0].kenBurns.from: "b" is no region id; they are "a"',
    'scenes[0].kenBurns.to: needs a width and height above 0',
  ]);
  const compare = { type: 'compare', narration: 'x', rows: [{ cells: [{ image: 'a.png', fit: 'fill' }, { image: 'b.png' }] }] };
  assert.deepEqual((await check(compare)).errors, ['scenes[0].rows[0].cells[0].fit: must be one of contain, cover']);
});

test('validate reports a picture that cannot be shown, one drawn soft, and a step that names no region', async () => {
  const images = { manifest: { 'desk.png': { file: 'images/0123456789abcdef.png', width: 320, height: 200 } }, problems: [{ path: 'scenes[0].src', message: '"desk.png" is not a file in /run', level: 'error' }] };
  assert.deepEqual((await check(imageScene({}), images)).errors, ['scenes[0].src: "desk.png" is not a file in /run']);
  const { errors, warnings } = await check(imageScene({ regions: [{ id: 'laptop', box: [0.3, 0.3, 0.4, 0.4], label: 'the laptop' }], steps: [{ focus: 'laptop', say: 'The laptop.' }, { focus: 'mug', say: 'The mug.' }] }), { ...images, problems: [] });
  assert.deepEqual(errors, ['scenes[0].steps[1].focus: "mug" names nothing in this scene, where a ref is a region id']);
  assert.deepEqual(warnings, []);
  const soft = await check(imageScene({}), { ...images, problems: [] });
  assert.deepEqual(soft.warnings, ['scenes[0].src: the picture is 320×200 and is drawn 1286×804, 4.0 times its size, so it looks soft; use a larger image']);
});

test('a step that names a region by its label lights it, or the highlight check says so', async () => {
  const scene = imageScene({ regions: [{ id: 'laptop', box: [0.3, 0.3, 0.4, 0.4], label: 'the laptop' }, { id: 'router', box: [0.7, 0.5, 0.2, 0.2], label: 'router' }], steps: [{ focus: 'laptop', say: 'The router sits behind it.' }] });
  assert.deepEqual((await check(scene)).warnings, ['scenes[0].steps[0]: says "router" (region router "router"), which is not lit; it lights region laptop "the laptop". Focus what the words name, or say only what is lit']);
});

test('the player serves the run\'s picture copies by their hashed names and nothing else of the run', async () => {
  const { startServer } = await import('../bin/lib/server.mjs');
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'images'));
  const body = await png(4, 4);
  fs.writeFileSync(path.join(dir, 'images', '0123456789abcdef.png'), body);
  fs.writeFileSync(path.join(dir, 'images', 'notes.txt'), 'secret');
  fs.writeFileSync(path.join(dir, 'desk.png'), body);
  const server = await startServer({ distDir: dir, dataDir: dir, port: 0 });
  try {
    const get = (p) => fetch(server.url + p);
    const ok = await get('/data/images/0123456789abcdef.png');
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await ok.arrayBuffer()).equals(body));
    for (const p of ['/data/images/notes.txt', '/data/desk.png', '/data/images/..%2Fdesk.png']) assert.equal((await get(p)).status, 404, p);
  } finally {
    await server.close();
  }
});
