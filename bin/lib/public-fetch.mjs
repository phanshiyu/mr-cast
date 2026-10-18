// GET a URL from the public internet only. Each hop's host is resolved first, every address it has must be public,
// and the connection goes to the address that was checked, so a second DNS answer cannot swap in another one.
// Redirects are followed by hand, at most MAX_REDIRECTS, and each one is checked the same way.

import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const MAX_REDIRECTS = 5;
/** Lets loopback addresses through, so the test suite can download from a server on 127.0.0.1. */
export const ALLOW_LOOPBACK_ENV = 'MR_CAST_IMAGES_ALLOW_LOOPBACK';

/** A download mr-cast refuses to make; its message says why without naming addresses. */
export class Refused extends Error {}

const v4Number = (address) => address.split('.').reduce((n, part) => n * 256 + Number(part), 0);

/** IPv4 blocks that are not the public internet, as [first address, prefix length]. */
const V4_RESERVED = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].map(([base, bits]) => [v4Number(base), 2 ** (32 - bits)]);

const v4Public = (n) => !V4_RESERVED.some(([base, size]) => n >= base && n < base + size);
const v4Loopback = (n) => n >>> 24 === 127;

/** The eight 16-bit groups of an IPv6 address, a dotted IPv4 tail included. */
function v6Groups(address) {
  let text = address;
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const n = v4Number(dotted[2]);
    text = `${dotted[1]}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const groups = (part) => (part ? part.split(':') : []);
  const all =
    tail === undefined
      ? groups(head)
      : [...groups(head), ...Array(8 - groups(head).length - groups(tail).length).fill('0'), ...groups(tail)];
  return all.map((group) => parseInt(group, 16));
}

/** Whether mr-cast may download from `address`: a public one, or loopback when `loopback` is allowed. */
export function isAllowedAddress(address, { loopback = false } = {}) {
  const v4 = (n) => v4Public(n) || (loopback && v4Loopback(n));
  if (net.isIPv4(address)) return v4(v4Number(address));
  if (!net.isIPv6(address) || address.includes('%')) return false;
  const g = v6Groups(address);
  const embedded = (hi, lo) => hi * 65536 + lo;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4(embedded(g[6], g[7]));
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return loopback;
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && (g[1] < 0x200 || g[1] === 0xdb8)) return false;
  if (g[0] === 0x2002) return v4Public(embedded(g[1], g[2]));
  if (g[0] === 0x3fff && g[1] < 0x1000) return false;
  return true;
}

/** The address to connect to for `host`, once every address it resolves to is allowed. */
async function checkedAddress(host) {
  const loopback = process.env[ALLOW_LOOPBACK_ENV] === '1';
  const family = net.isIP(host);
  const found = family ? [{ address: host, family }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!found.length || found.some(({ address }) => !isAllowedAddress(address, { loopback }))) {
    throw new Refused('its host is a private, local or reserved address, which mr-cast does not download from');
  }
  return found[0];
}

function get(url, { address, family }, { headers, signal }) {
  const lib = url.protocol === 'https:' ? https : http;
  const lookup = (_host, options, done) =>
    options?.all ? done(null, [{ address, family }]) : done(null, address, family);
  return new Promise((resolve, reject) => {
    lib.get(url, { headers, signal, agent: false, lookup }, resolve).on('error', reject);
  });
}

/**
 * The response to GET `src`, after any redirects, as node's IncomingMessage. Throws Refused for a URL mr-cast does
 * not download from, and the system's error for one that fails.
 * @param {string} src
 * @param {{ headers?: Record<string, string>, signal?: AbortSignal }} [options]
 * @returns {Promise<import('node:http').IncomingMessage>}
 */
export async function getPublic(src, { headers = {}, signal } = {}) {
  let url = new URL(src);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new Refused('it redirects to a URL that is not http(s)');
    const res = await get(url, await checkedAddress(url.hostname.replace(/^\[|\]$/g, '')), { headers, signal });
    const location = res.headers.location;
    if (![301, 302, 303, 307, 308].includes(res.statusCode ?? 0) || !location) return res;
    res.resume();
    if (hop === MAX_REDIRECTS) throw new Refused(`it redirects more than ${MAX_REDIRECTS} times`);
    try {
      url = new URL(location, url);
    } catch {
      throw new Refused('it redirects to a location that is no URL');
    }
  }
}
