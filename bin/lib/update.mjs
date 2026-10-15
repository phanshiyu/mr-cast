// Tells the user when a newer mr-cast is on npm without making any command wait for the network: a
// command reads what an earlier background check cached, and starts a new check at most once a day.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheRoot } from './cache.mjs';

export const PACKAGE = '@shiyuphan/mr-cast';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const cacheFile = () => path.join(cacheRoot(), 'update-check.json');

/** A clone has .git at its root; its developers update with git, not npm. */
export const isGitClone = (root) => fs.existsSync(path.join(root, '.git'));

const checksDisabled = (env) => Boolean(env.CI || env.NO_UPDATE_NOTIFIER || env.MR_CAST_NO_UPDATE_CHECK);

/** Negative, zero or positive as a is older than, the same as, or newer than b. Prereleases sort first. */
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?/.exec(v);
    return m ? { nums: m.slice(1, 4).map(Number), pre: m[4] ?? null } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The version npm's `latest` tag points at. Throws when the registry is unreachable or slow. */
export async function fetchLatest(timeoutMs) {
  const registry = (process.env.MR_CAST_REGISTRY ?? 'https://registry.npmjs.org').replace(/\/+$/, '');
  const res = await fetch(`${registry}/${PACKAGE}/latest`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${registry} answered ${res.status}`);
  const { version } = await res.json();
  if (typeof version !== 'string') throw new Error(`${registry} sent no version`);
  return version;
}

function readCache() {
  try {
    const { checkedAt, latest } = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    return { checkedAt: Number(checkedAt) || 0, latest: typeof latest === 'string' ? latest : null };
  } catch {
    return { checkedAt: 0, latest: null };
  }
}

export function writeCache(latest) {
  const file = cacheFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ checkedAt: Date.now(), latest })}\n`);
  fs.renameSync(tmp, file);
}

/**
 * The one-line notice to print when an earlier check found a newer version, else null. Starts a
 * detached check when the last one is a day old; this command does not wait for it. Never throws.
 */
export function updateNotice(root, version, env = process.env) {
  try {
    if (checksDisabled(env) || isGitClone(root)) return null;
    const { checkedAt, latest } = readCache();
    if (Date.now() - checkedAt > CHECK_INTERVAL_MS) {
      // Record the attempt first, so commands run while it is in flight, or offline, start no more.
      writeCache(latest);
      const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'update-check.mjs');
      spawn(process.execPath, [worker], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    }
    if (!latest || compareVersions(latest, version) <= 0) return null;
    return `mr-cast ${latest} is available (you have ${version}). Run \`mr-cast upgrade\`.`;
  } catch {
    return null;
  }
}
