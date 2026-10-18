// ensureVoiceover in a child process. Kokoro's inference holds the thread it runs on for seconds per clip, so the
// player's server voices this way to keep answering while the clips are made. A child process, not a worker
// thread: stopping a worker in the middle of a clip aborts the whole process inside onnxruntime.

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { UserError } from './errors.mjs';
import { register, removeEntry, runFields } from './procs.mjs';
import { downloadVoice, ensureVoiceover } from './voice.mjs';
import { ENGINES, voiceParts } from './voices.mjs';

const children = new Set();
let stopping = false;

/** Stops every voicing and download in progress, so a stopped player exits at once. A clip half made is not written. */
export function stopVoicing() {
  stopping = true;
  for (const child of children) child.kill('SIGKILL');
}

/** `task` with `args` in a child process: its result, or null when `signal` aborted it or stopVoicing stopped it. */
function inChild(task, args, onProgress, signal) {
  return new Promise((resolve, reject) => {
    if (stopping || signal?.aborted) return resolve(null);
    const child = fork(fileURLToPath(import.meta.url), ['--voice-child'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    children.add(child);
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.on('message', (msg) => {
      if (msg.type === 'progress') onProgress?.(msg.event);
      else if (msg.type === 'done') resolve(msg.result);
      else if (msg.type === 'error') reject(msg.user ? new UserError(msg.message) : new Error(msg.message));
    });
    child.on('error', reject);
    // 'close', not 'exit': a large result can still be arriving when the child exits.
    child.on('close', (code, killedBy) => {
      children.delete(child);
      // A child killed mid-clip cannot remove its own registry entry.
      removeEntry(child.pid);
      signal?.removeEventListener('abort', abort);
      if (stopping || signal?.aborted) resolve(null);
      reject(new Error(`the voice process stopped (${killedBy ?? `exit ${code}`})`));
    });
    child.send({ type: 'start', task, args });
  });
}

/**
 * Model downloads in progress, by voice. A download runs in a child of its own that an edit does not stop: stopping
 * it would throw the download away, and on a slow first run every edit would start it again.
 */
const downloads = new Map();

function download(voice, onProgress) {
  if (!downloads.has(voice)) {
    const running = inChild('download', { voice }, onProgress).finally(() => downloads.delete(voice));
    running.catch(() => {});
    downloads.set(voice, running);
  }
  return downloads.get(voice);
}

/**
 * ensureVoiceover's arguments and result, with its work and its progress events in a child process. Null when
 * `signal` aborted it or stopVoicing stopped it, or had already. A model it needs is downloaded first, and an abort
 * leaves that download running for the next voicing.
 */
export async function ensureVoiceoverInChild({ onProgress, signal, ...args }) {
  if (stopping || signal?.aborted) return null;
  const { engine } = voiceParts(args.voice);
  if (Object.hasOwn(ENGINES, engine) && !ENGINES[engine].downloaded()) {
    const aborted = new Promise((resolve) => signal?.addEventListener('abort', () => resolve(null), { once: true }));
    if (await Promise.race([download(args.voice, onProgress).then(() => !stopping), aborted]) !== true) return null;
  }
  return inChild('ensure', args, onProgress, signal);
}

if (process.argv[2] === '--voice-child') {
  // Ctrl+C reaches the whole process group. The parent stops this child itself, and dies with it if the parent goes.
  process.on('SIGINT', () => {});
  const orphaned = () => process.kill(process.pid, 'SIGKILL');
  process.once('disconnect', orphaned);
  process.once('message', async ({ task, args }) => {
    register({ kind: task === 'download' ? 'download' : 'voice', url: null, ...runFields(args.dataDir) });
    const onProgress = (event) => process.send({ type: 'progress', event });
    let reply;
    try {
      const result = task === 'download' ? await downloadVoice(args.voice, onProgress) : await ensureVoiceover({ ...args, onProgress });
      reply = { type: 'done', result };
    } catch (err) {
      reply = { type: 'error', message: err.message, user: err instanceof UserError };
    }
    // Disconnecting before the send is written drops a large reply.
    process.send(reply, () => {
      process.off('disconnect', orphaned);
      process.disconnect();
    });
  });
}
