// ensureVoiceover in a child process. Kokoro's inference holds the thread it runs on for seconds per clip, so the
// player's server voices this way to keep answering while the clips are made. A child process, not a worker
// thread: stopping a worker in the middle of a clip aborts the whole process inside onnxruntime.

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { UserError } from './errors.mjs';
import { ensureVoiceover } from './voice.mjs';

const children = new Set();
let stopping = false;

/** Stops every voicing in progress, so a stopped player exits at once. A clip half made is not written. */
export function stopVoicing() {
  stopping = true;
  for (const child of children) child.kill('SIGKILL');
}

/**
 * ensureVoiceover's arguments and result, with its work and its progress events in a child process. Null when
 * stopVoicing stopped it, or had already.
 */
export function ensureVoiceoverInChild({ onProgress, ...args }) {
  return new Promise((resolve, reject) => {
    if (stopping) return resolve(null);
    const child = fork(fileURLToPath(import.meta.url), ['--voice-child'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    children.add(child);
    child.on('message', (msg) => {
      if (msg.type === 'progress') onProgress?.(msg.event);
      else if (msg.type === 'done') resolve(msg.voiceover);
      else if (msg.type === 'error') reject(msg.user ? new UserError(msg.message) : new Error(msg.message));
    });
    child.on('error', reject);
    // 'close', not 'exit': a large result can still be arriving when the child exits.
    child.on('close', (code, signal) => {
      children.delete(child);
      if (stopping) resolve(null);
      reject(new Error(`the voice process stopped (${signal ?? `exit ${code}`})`));
    });
    child.send({ type: 'start', args });
  });
}

if (process.argv[2] === '--voice-child') {
  // Ctrl+C reaches the whole process group. The parent stops this child itself, and dies with it if the parent goes.
  process.on('SIGINT', () => {});
  const orphaned = () => process.kill(process.pid, 'SIGKILL');
  process.once('disconnect', orphaned);
  process.once('message', async ({ args }) => {
    let reply;
    try {
      const voiceover = await ensureVoiceover({ ...args, onProgress: (event) => process.send({ type: 'progress', event }) });
      reply = { type: 'done', voiceover };
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
