// The pictures a storyboard shows, as local copies in the run directory. A source is a path relative to the run
// directory or the repository, or an http(s) URL downloaded once. Every copy lands in <run>/images/ under a name
// from a hash, and images.json maps each source to its copy and its size. The player serves only that folder and
// renders read only the copies, so nothing loads from the network once `validate` has run.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { imageSources } from '../../shared/images.mjs';
import { findRepoRoot } from './git.mjs';
import { getPublic, Refused } from './public-fetch.mjs';

export const IMAGES_DIR = 'images';
export const IMAGES_FILE = 'images.json';
/** A copy's name: 16 hex digits of a hash, then the type's extension. The server serves nothing else from images/. */
export const IMAGE_NAME = /^[0-9a-f]{16}\.(?:png|jpg|webp|gif)$/;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;

/** The types an image may be, by the extension its copy gets, with the content type a server sends for it. */
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const TYPE_NAMES = 'a PNG, JPEG, WebP or GIF image';
/** Content types a server may send an image as; the first bytes then say which image it is. */
const SENT_TYPES = new Set([...Object.values(TYPES), 'image/jpg', 'application/octet-stream', 'binary/octet-stream']);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const LIMIT = `${MAX_IMAGE_BYTES / 1024 / 1024} MB`;

/** What the bytes are, by their first bytes: one of TYPES, "svg", or null. */
export function sniffImage(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'webp';
  const head = buf.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('<') && /<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

/** A JPEG's EXIF orientation, 1 to 8, which browsers apply when they draw it; 1 when it has none. */
function jpegOrientation(buf, at, length) {
  if (buf.subarray(at, at + 6).toString('latin1') !== 'Exif\0\0') return 1;
  const tiff = at + 6;
  const little = buf.subarray(tiff, tiff + 2).toString('latin1') === 'II';
  const u16 = (o) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > at + length) return 1;
  for (let i = 0, n = u16(ifd); i < n; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > at + length) return 1;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return 1;
}

/** Width and height as a browser draws the image, read from its header; null when the header does not say. */
export function imageSize(buf, type) {
  try {
    if (type === 'png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === 'gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (type === 'webp') {
      const chunk = buf.subarray(12, 16).toString('latin1');
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      return null;
    }
    if (type === 'jpg') {
      let orientation = 1;
      for (let at = 2; at + 9 < buf.length; ) {
        if (buf[at] !== 0xff) return null;
        const marker = buf[at + 1];
        const length = buf.readUInt16BE(at + 2);
        if (marker === 0xe1) orientation = jpegOrientation(buf, at + 4, length - 2);
        // Start of frame: every SOFn but DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          const size = { width: buf.readUInt16BE(at + 7), height: buf.readUInt16BE(at + 5) };
          return orientation >= 5 ? { width: size.height, height: size.width } : size;
        }
        at += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

const isUrl = (src) => /^https?:\/\//i.test(src);

/** Bytes that are a picture mr-cast draws, with its type and size; or the reason they are not. */
function checkBytes(buf) {
  const type = sniffImage(buf);
  if (type === 'svg')
    return {
      error: `is an SVG image, which mr-cast does not show as a picture since it can carry scripts; draw it in an svg scene, or convert it to PNG`,
    };
  if (!type) return { error: `is not ${TYPE_NAMES}; its first bytes are of no image type mr-cast shows` };
  const size = imageSize(buf, type);
  if (!size || !size.width || !size.height)
    return { error: `is a ${type.toUpperCase()} file whose width and height cannot be read; it may be cut short` };
  return { type, ...size };
}

const keyOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** The copy's path inside the run, images/<key>.<type>; with `write`, the bytes go there unless they already are. */
function store(dir, key, type, buf, write) {
  const file = path.join(IMAGES_DIR, `${key}.${type}`);
  const full = path.join(dir, file);
  if (write && !fs.existsSync(full)) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, full);
  }
  return file;
}

/** The copy of a URL already downloaded into the run, by the URL's hash. */
function cachedDownload(dir, src) {
  const key = keyOf(src);
  for (const type of Object.keys(TYPES)) {
    const file = path.join(IMAGES_DIR, `${key}.${type}`);
    if (fs.existsSync(path.join(dir, file))) return file;
  }
  return null;
}

/** Why a download failed, in a few words: the refusal, a timeout, the system's error code, or the message. */
function fetchReason(err) {
  if (err instanceof Refused) return err.message;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError')
    return `no answer within ${DOWNLOAD_TIMEOUT_MS / 1000} s`;
  const code = err?.code ?? err?.cause?.code;
  const hostname = err?.hostname ?? err?.cause?.hostname;
  return code ? `${code}${hostname ? ` for ${hostname}` : ''}` : (err?.message ?? String(err));
}

/** Downloads `src`, at most MAX_IMAGE_BYTES, checking the server's content type and then the bytes themselves. */
async function download(src) {
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let res;
  try {
    res = await getPublic(src, { signal, headers: { 'user-agent': 'mr-cast' } });
  } catch (err) {
    return { error: `could not be downloaded: ${fetchReason(err)}` };
  }
  const status = res.statusCode ?? 0;
  if (status < 200 || status > 299) {
    res.destroy();
    return {
      error: `could not be downloaded: the server answered HTTP ${status}${res.statusMessage ? ` ${res.statusMessage}` : ''}`,
    };
  }
  const type = (res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!SENT_TYPES.has(type)) {
    res.destroy();
    return { error: `is not ${TYPE_NAMES}: the server sends it as ${type ? `"${type}"` : 'no content type'}` };
  }
  const length = Number(res.headers['content-length']);
  if (length > MAX_IMAGE_BYTES) {
    res.destroy();
    return { error: `is ${mb(length)}; an image may be up to ${LIMIT}` };
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of res) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) {
        res.destroy();
        return { error: `is over ${LIMIT}, the most an image may be` };
      }
      chunks.push(chunk);
    }
  } catch (err) {
    return { error: `could not be downloaded: ${fetchReason(err)}` };
  }
  return { buf: Buffer.concat(chunks) };
}

/**
 * The file a relative `src` names: in the run directory, else in the repository; with the places tried. Links are
 * followed before the check, so a link that leads out of both is refused rather than read.
 */
function localFile(dir, repo, src) {
  const roots = [dir, ...(repo && path.resolve(repo) !== path.resolve(dir) ? [repo] : [])];
  const realRoots = roots.map((root) => {
    try {
      return fs.realpathSync(root) + path.sep;
    } catch {
      return path.resolve(root) + path.sep;
    }
  });
  let leadsOut = false;
  for (const root of roots) {
    const file = path.resolve(root, src);
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file)) continue;
    const real = fs.realpathSync(file);
    if (realRoots.some((inside) => real.startsWith(inside))) return { file: real };
    leadsOut = true;
  }
  return { tried: roots, leadsOut };
}

/**
 * One source made local: its copy, type and size, or the reason it cannot be shown. With `fetch` false nothing is
 * downloaded or copied: a local file is only checked, and a URL not downloaded yet is reported as such.
 */
async function resolveOne(dir, repo, src, { fetch: allowed }) {
  if (path.isAbsolute(src))
    return {
      error: `is an absolute path; write it relative to the run directory or the repository, or give an http(s) URL`,
    };
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !isUrl(src))
    return { error: `is neither a relative path nor an http(s) URL` };
  if (isUrl(src)) {
    const cached = cachedDownload(dir, src);
    if (cached) {
      const checked = checkBytes(fs.readFileSync(path.join(dir, cached)));
      return checked.error ? checked : { file: cached, ...checked };
    }
    if (!allowed) return { pending: true };
    const got = await download(src);
    if (got.error) return got;
    const checked = checkBytes(got.buf);
    if (checked.error) return checked;
    return { file: store(dir, keyOf(src), checked.type, got.buf, true), ...checked };
  }
  const found = localFile(dir, repo, src);
  if (found.leadsOut)
    return { error: `is a link to a file outside the run directory and the repository, which mr-cast does not read` };
  if (!found.file) return { error: `is not a file in ${found.tried.join(' or in ')}` };
  const stat = fs.statSync(found.file);
  if (!stat.isFile()) return { error: `is a directory, not an image file` };
  if (stat.size > MAX_IMAGE_BYTES) return { error: `is ${mb(stat.size)}; an image may be up to ${LIMIT}` };
  const buf = fs.readFileSync(found.file);
  const checked = checkBytes(buf);
  if (checked.error) return checked;
  return { file: store(dir, keyOf(buf), checked.type, buf, allowed), ...checked };
}

/**
 * Every image the storyboard shows, made local in run `dir`. Returns the manifest (by source: the copy's path
 * inside the run, its width and height) and a problem for each source that cannot be shown, at the field that
 * names it. With `write`, URLs are downloaded, local files copied into images/, and images.json rewritten; without
 * it (the hook's read-only check) nothing is written and a URL not downloaded yet is a warning.
 * @returns {Promise<{ manifest: import('../../src/types').ImageManifest, problems: { path: string, message: string, level: 'error' | 'warning' }[] }>}
 */
export async function resolveImages(dir, storyboard, { write = true, repo = findRepoRoot(dir) } = {}) {
  const manifest = {};
  const problems = [];
  const done = new Map();
  for (const { path: at, src } of imageSources(storyboard)) {
    if (!done.has(src)) done.set(src, await resolveOne(dir, repo, src, { fetch: write }));
    const result = done.get(src);
    if (result.error) problems.push({ path: at, message: `${JSON.stringify(src)} ${result.error}`, level: 'error' });
    else if (result.pending)
      problems.push({
        path: at,
        message: `${JSON.stringify(src)} is not downloaded yet; \`mr-cast validate\` downloads it`,
        level: 'warning',
      });
    else manifest[src] = { file: result.file, width: result.width, height: result.height };
  }
  if (write) {
    const file = path.join(dir, IMAGES_FILE);
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    // Rewritten only when it changes, since `play` watches the run's files.
    if (!Object.keys(manifest).length) fs.rmSync(file, { force: true });
    else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
  }
  return { manifest, problems };
}

/** images.json as `validate` last wrote it, or an empty manifest. */
export function readImages(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, IMAGES_FILE), 'utf8'));
  } catch {
    return {};
  }
}
