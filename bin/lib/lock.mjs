// A cross-process lock file for one-time downloads into the shared cache, and per-process markers
// that tell `mr-cast prune` which cache directories a running render is reading.

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const POLL_MS = 500;
const HEARTBEAT_MS = 5_000;
/** A holder refreshes the lock's mtime every HEARTBEAT_MS, so one this old belongs to a hung or reused pid. */
const STALE_MS = 60_000;
/** Waits shorter than this (another process checking an existing download) go unannounced. */
const ANNOUNCE_AFTER_MS = 2_000;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** The lock's holder, or null when the lock is gone or abandoned (dead pid, or no heartbeat for STALE_MS). */
export function liveHolder(file) {
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
 * process holds it, and breaks a stale one. `onWait(pid)` is called once if the wait grows long.
 */
export async function withLock(file, fn, onWait) {
  const start = Date.now();
  let announced = false;
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
    if (!announced && Date.now() - start > ANNOUNCE_AFTER_MS) {
      onWait?.(holder);
      announced = true;
    }
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

const usersDir = (dir) => `${dir}.users`;

/** Runs `fn` with a `<dir>.users/<pid>` marker on each of `dirs`, so `prune` leaves them alone meanwhile. */
export async function whileUsing(dirs, fn) {
  const markers = dirs.map((dir) => path.join(usersDir(dir), String(process.pid)));
  for (const marker of markers) {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, '');
  }
  try {
    return await fn();
  } finally {
    for (const marker of markers) fs.rmSync(marker, { force: true });
  }
}

/** Pids of live processes with a `whileUsing` marker on `dir`. A crashed process's marker counts for nothing. */
export function usersOf(dir) {
  let names = [];
  try { names = fs.readdirSync(usersDir(dir)); } catch { /* nobody has used it */ }
  return names.map(Number).filter((pid) => Number.isInteger(pid) && pid > 0 && alive(pid));
}
