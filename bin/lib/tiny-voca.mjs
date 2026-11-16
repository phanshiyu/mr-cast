// tiny-voca (n4ze3m/tiny-voca), the voice model, run by the engine: `mr-cast-engine voice` reads its files from the
// directory this module downloads them into (docs/adr/0046-tiny-voca-voice.md). Node downloads, checks and locks;
// the engine phonemizes and speaks.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runEngine } from './engine.mjs';
import { UserError } from './errors.mjs';

export const TINY_VOCA_REPO = 'n4ze3m/tiny-voca';
const TINY_VOCA_REVISION = 'e5f9b11651a4db525fb207a56a91e4df2d1dd387';
/** What a first use downloads, pinned by revision and checked by size and sha256 before it is kept. */
const TINY_VOCA_FILES = [
  {
    name: 'onnx/model.onnx',
    bytes: 21386372,
    sha256: 'fe6d918791a15b82e37465981d7f27a070e46b46635e5a3482fc8dff87a1ae46',
  },
  { name: 'config.json', bytes: 2129, sha256: '27bcbf322fc428581f0e959be1c141dd7751c61f4fed5eded326e779b215f69c' },
  {
    name: 'phonemizer/lexicon.tsv',
    bytes: 3454357,
    sha256: '3fc930345c6b3cabc533981c4b212fa309eec83913fcdbd42919338270d64b06',
  },
  {
    name: 'phonemizer/align.json',
    bytes: 29729,
    sha256: '864763dbd558a864950266b2c30627f1cad203e75062ee842ee63c653e823b75',
  },
  {
    name: 'phonemizer/g2p.json',
    bytes: 834,
    sha256: 'c518fd839ea0109c0b2b4f778c17506bf0d7653557b8b8c97a4c8dd9883d4432',
  },
  {
    name: 'phonemizer/g2p.npz',
    bytes: 1840104,
    sha256: 'eb3fd519ff00e72d850928d2fccb968adc36134bca2f3bda09de7e794c2ed01b',
  },
  {
    name: 'phonemizer/homographs.json',
    bytes: 51956,
    sha256: '9c3a96fcdf79fa27d1b3686dc6a507c37e4f754966928608ee9ddb617ba39192',
  },
];
export const TINY_VOCA_MB = Math.round(TINY_VOCA_FILES.reduce((n, f) => n + f.bytes, 0) / 1e6);

/** The files' directory for the pinned revision; only files that passed their check are under their names. */
export const tinyVocaDir = (cacheRoot) => path.join(cacheRoot, TINY_VOCA_REVISION.slice(0, 8));

export const tinyVocaDownloaded = (dir) =>
  TINY_VOCA_FILES.every((f) => fs.statSync(path.join(dir, f.name), { throwIfNoEntry: false })?.size === f.bytes);

/** A download that sends nothing for this long is given up, however large it is. */
const IDLE_MS = 120_000;
const WRITE_ERRORS = new Set(['ENOSPC', 'EDQUOT', 'EACCES', 'EPERM', 'EROFS']);

/**
 * Downloads `file` into `dir`, keeping it only when its sha256 matches the pinned one. It is written to
 * `<name>.tmp-<pid>` meanwhile, which the next download removes once this process is gone.
 */
export async function downloadChecked(url, dir, file, { fetchImpl = fetch, idleMs = IDLE_MS } = {}) {
  const dest = path.join(dir, file.name);
  const tmp = `${dest}.tmp-${process.pid}`;
  const ctl = new AbortController();
  let timer;
  const stillSending = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctl.abort(new Error(`${url} sent nothing for ${idleMs / 1000} s`)), idleMs);
  };
  const cannotWrite = (err) => {
    throw WRITE_ERRORS.has(err.code)
      ? new UserError(`could not write ${file.name} into ${dir} (${err.code}: ${err.message})`)
      : err;
  };
  let out = null;
  try {
    stillSending();
    const res = await fetchImpl(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const hash = crypto.createHash('sha256');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    out = await fs.promises.open(tmp, 'w').catch(cannotWrite);
    for await (const chunk of res.body) {
      stillSending();
      hash.update(chunk);
      await out.write(chunk).catch(cannotWrite);
    }
    await out.close().catch(cannotWrite);
    out = null;
    const sha256 = hash.digest('hex');
    if (sha256 !== file.sha256)
      throw new Error(`${file.name} failed its integrity check (sha256 ${sha256}, expected ${file.sha256})`);
    fs.renameSync(tmp, dest);
  } finally {
    clearTimeout(timer);
    await out?.close().catch(() => {});
    fs.rmSync(tmp, { force: true });
  }
}

/** The Hub, or the mirror HF_ENDPOINT names, as huggingface_hub reads it. */
export const hubUrl = () => (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, '');

export async function downloadTinyVoca(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of TINY_VOCA_FILES) {
    if (fs.statSync(path.join(dir, file.name), { throwIfNoEntry: false })?.size === file.bytes) continue;
    await downloadChecked(`${hubUrl()}/${TINY_VOCA_REPO}/resolve/${TINY_VOCA_REVISION}/${file.name}`, dir, file);
  }
}

/**
 * Speaks `clips` ({ text, voice, speed, out }) with the engine, every core at once. Each clip's result,
 * { clip, seconds, sentences }, goes to `onClip` as soon as its WAV is written; `signal` stops the engine.
 */
export async function speakClips(dir, clips, { onClip, signal } = {}) {
  if (!clips.length) return;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-cast-voice-'));
  try {
    const job = path.join(work, 'job.json');
    fs.writeFileSync(job, JSON.stringify({ clips }));
    await runEngine(['voice', '--model-dir', dir, '--job', job, '--parent-pipe', 'yes'], {
      signal,
      onLine: (line) => onClip?.(JSON.parse(line)),
    });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
