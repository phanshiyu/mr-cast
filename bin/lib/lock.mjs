// A cross-process lock file for one-time downloads into the shared cache.

import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const POLL_MS = 500;
const HEARTBEAT_MS = 5_000;
/** A holder refreshes the lock's mtime every HEARTBEAT_MS, so one this old belongs to a hung or reused pid. */
const STALE_MS = 60_000;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** The lock's holder, or null when the lock is gone or abandoned (dead pid, or no heartbeat for STALE_MS). */
function liveHolder(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    const age = Date.now() - fs.statSync(file).mtimeMs;
    return Number.isInteger(pid) && pid > 0 && alive(pid) && age < STALE_MS ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Runs `fn` while holding `file`, created with O_EXCL and holding this pid. Waits while another live
 * process holds it, and breaks a stale one. `onWait(pid)` is called once if this process has to wait.
 */
export async function withLock(file, fn, onWait) {
  let waited = false;
  for (;;) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    const holder = liveHolder(file);
    if (holder === null) {
      // Give a holder that has just created the file a moment to write its pid before calling it stale.
      await sleep(50);
      if (liveHolder(file) === null) fs.rmSync(file, { force: true });
      continue;
    }
    if (!waited) onWait?.(holder);
    waited = true;
    await sleep(POLL_MS);
  }
  const heartbeat = setInterval(() => {
    const now = new Date();
    try { fs.utimesSync(file, now, now); } catch { /* removed under us; nothing to refresh */ }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    try {
      if (Number(fs.readFileSync(file, 'utf8').trim()) === process.pid) fs.rmSync(file, { force: true });
    } catch { /* already gone */ }
  }
}
