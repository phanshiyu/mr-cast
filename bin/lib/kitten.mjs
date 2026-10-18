// Kitten TTS (KittenML/kitten-tts-mini-0.8) in Node: the ONNX model and its voices, run with onnxruntime-node.
// Each step matches the kittenml 0.9.4 Python package's ONNX path (kittentts_legacy/onnx_model.py) at the
// default clean_text=False: sentence chunks, espeak-ng phonemes with punctuation kept, its symbol table, the
// style row picked by the chunk's length, and the last 5000 samples trimmed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './errors.mjs';

export const KITTEN_REPO = 'KittenML/kitten-tts-mini-0.8';
export const KITTEN_REVISION = 'c02725660cea441db4c383af69f1f26f5cd00947';
/** What a first use downloads, pinned by revision and checked by size and sha256 before it is kept. */
export const KITTEN_FILES = [
  { name: 'kitten_tts_mini_v0_8.onnx', bytes: 78268016, sha256: '0f5bbae4fc4800c98dbc544a87ecfa79510de2fb8222db30d12e5bfe9177df91' },
  { name: 'voices.npz', bytes: 3278902, sha256: '40ad2638952b77b7b2f30127e2608e169fc69dd256b53bd8aaa3409a33193c42' },
];
export const KITTEN_MB = Math.round(KITTEN_FILES.reduce((n, f) => n + f.bytes, 0) / 1e6);
export const KITTEN_SAMPLE_RATE = 24000;

/** The model's voice for each name its config.json gives (voice_aliases). */
const VOICE_FILES = {
  bella: 'expr-voice-2-f', jasper: 'expr-voice-2-m', luna: 'expr-voice-3-f', bruno: 'expr-voice-3-m',
  rosie: 'expr-voice-4-f', hugo: 'expr-voice-4-m', kiki: 'expr-voice-5-f', leo: 'expr-voice-5-m',
};
const TRIM_SAMPLES = 5000;
const STYLE_DIM = 256;

/** The files' directory for the pinned revision; only files that passed their check are under their names. */
export const kittenDir = (cacheRoot) => path.join(cacheRoot, `${KITTEN_REPO.split('/')[1]}-${KITTEN_REVISION.slice(0, 8)}`);

export const kittenDownloaded = (dir) => KITTEN_FILES.every((f) => fs.statSync(path.join(dir, f.name), { throwIfNoEntry: false })?.size === f.bytes);

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
    throw WRITE_ERRORS.has(err.code) ? new UserError(`could not write ${file.name} into ${dir} (${err.code}: ${err.message})`) : err;
  };
  let out = null;
  try {
    stillSending();
    const res = await fetchImpl(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const hash = crypto.createHash('sha256');
    out = await fs.promises.open(tmp, 'w').catch(cannotWrite);
    for await (const chunk of res.body) {
      stillSending();
      hash.update(chunk);
      await out.write(chunk).catch(cannotWrite);
    }
    await out.close().catch(cannotWrite);
    out = null;
    const sha256 = hash.digest('hex');
    if (sha256 !== file.sha256) throw new Error(`${file.name} failed its integrity check (sha256 ${sha256}, expected ${file.sha256})`);
    fs.renameSync(tmp, dest);
  } finally {
    clearTimeout(timer);
    await out?.close().catch(() => {});
    fs.rmSync(tmp, { force: true });
  }
}

/** The Hub, or the mirror HF_ENDPOINT names, as huggingface_hub reads it. */
export const hubUrl = () => (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, '');

export async function downloadKitten(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of KITTEN_FILES) {
    if (fs.statSync(path.join(dir, file.name), { throwIfNoEntry: false })?.size === file.bytes) continue;
    await downloadChecked(`${hubUrl()}/${KITTEN_REPO}/resolve/${KITTEN_REVISION}/${file.name}`, dir, file);
  }
}

/** The float32 arrays of an .npz whose entries are stored uncompressed, as numpy.savez writes them. */
export function readNpz(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const entries = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const arrays = {};
  for (let i = 0; i < entries; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    if (method !== 0) throw new Error(`${name} is compressed`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    arrays[name.replace(/\.npy$/, '')] = readNpy(buf.subarray(start, start + size));
  }
  return arrays;
}

function readNpy(buf) {
  const major = buf[6];
  const headerLen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
  const offset = (major === 1 ? 10 : 12) + headerLen;
  const header = buf.toString('latin1', major === 1 ? 10 : 12, offset);
  if (!/'descr':\s*'<f4'/.test(header) || /'fortran_order':\s*True/.test(header)) throw new Error(`unsupported array (${header.trim()})`);
  const shape = header.match(/'shape':\s*\(([^)]*)\)/)[1].split(',').filter((s) => s.trim()).map(Number);
  const data = new Float32Array(buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + buf.length));
  return { shape, data };
}

// The sentence chunks of kittenml's chunk_text, at its max_len of 400 characters.
const NON_BOUNDARY = new Set(['dr', 'prof', 'mr', 'mrs', 'ms', 'fig', 'figs', 'pp', 'p', 'ch', 'sec', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'al']);
const MAX_CHUNK = 400;

function isBoundary(chars, i) {
  const char = chars[i];
  if (!'.!?'.includes(char)) return false;
  if (char === '.') {
    if (i > 0 && i < chars.length - 1 && /\d/.test(chars[i - 1]) && /\d/.test(chars[i + 1])) return false;
    const before = chars.slice(0, i).join('');
    const token = (before.match(/([A-Za-z]+)$/)?.[1] ?? '').toLowerCase();
    if (NON_BOUNDARY.has(token)) return false;
    if ((token === 'a' || token === 'p') && chars[i + 1]?.toLowerCase() === 'm') return false;
    if (token === 'm' && /\b[ap]\.m$/i.test(before)) {
      const next = chars.slice(i + 1).join('').trim();
      return !next || next[0] === next[0].toUpperCase() && next[0] !== next[0].toLowerCase();
    }
  }
  const next = chars.slice(i + 1);
  return next.length === 0 || /\s/.test(next[0]);
}

const ensurePunctuation = (text) => (text && !'.!?,;:'.includes(text.at(-1)) ? `${text},` : text);

export function chunkText(text) {
  const chars = [...text];
  const sentences = [];
  let start = 0;
  for (let i = 0; i < chars.length; i++) {
    if (isBoundary(chars, i)) {
      sentences.push(chars.slice(start, i + 1).join(''));
      start = i + 1;
    }
  }
  if (start < chars.length) sentences.push(chars.slice(start).join(''));
  const chunks = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length <= MAX_CHUNK) {
      chunks.push(ensurePunctuation(sentence));
      continue;
    }
    let part = '';
    for (const word of sentence.split(/\s+/)) {
      if (part.length + word.length + 1 <= MAX_CHUNK) part = part ? `${part} ${word}` : word;
      else {
        if (part) chunks.push(ensurePunctuation(part.trim()));
        part = word;
      }
    }
    if (part) chunks.push(ensurePunctuation(part.trim()));
  }
  return chunks;
}

// phonemizer's EspeakBackend(language="en-us", preserve_punctuation=True, with_stress=True): espeak reads the
// text between punctuation marks (;:,.!?¡¿—…"«»“”(){}[]), and the marks are kept as they are.
// A comma or a period between two digits is a decimal separator, read with the number, not a mark.
const MARKS_PATTERN = /(\s*(?:[;:!?¡¿—…"«»“”(){}[\]]|(?<![0-9])[,.]|[,.](?![0-9]))+\s*)+/g;

/** The phonemes the model reads for `text`, as kittenml makes them before its tokenizer. */
export async function kittenPhonemes(text) {
  // Imported here, not at the top: its Emscripten module installs process-wide crash handlers that print its source.
  const { phonemize: espeak } = await import('phonemizer');
  const parts = [];
  let prev = 0;
  for (const match of text.matchAll(MARKS_PATTERN)) {
    if (prev < match.index) parts.push({ mark: false, text: text.slice(prev, match.index) });
    parts.push({ mark: true, text: match[0] });
    prev = match.index + match[0].length;
  }
  if (prev < text.length) parts.push({ mark: false, text: text.slice(prev) });
  const read = await Promise.all(parts.map(async (p) => (p.mark ? p.text : (await espeak(p.text, 'en-us')).join(' '))));
  // The phonemizer package's espeak-ng says "or" as oːɹ, where kittenml's espeak-ng 1.52 says ɔːɹ; 1.52 has no oː.
  // basic_english_tokenize: Python's \w+|[^\w\s], with Python's Unicode \w (letters, digits and underscore).
  return (read.join('').replaceAll('oːɹ', 'ɔːɹ').match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) ?? []).join(' ');
}

// TextCleaner's symbols. The duplicated quote marks are upstream's: the last index of each wins.
const SYMBOLS = ['$', ...';:,.!?¡¿—…"«»"" ', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ...'ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘\'̩\'ᵻ'];
const SYMBOL_IDS = new Map(SYMBOLS.map((s, i) => [s, i]));

/** The model's input ids for phonemes: a start token, each known symbol, then the end tokens. */
export const kittenTokens = (phonemes) => [0, ...[...phonemes].flatMap((c) => (SYMBOL_IDS.has(c) ? [SYMBOL_IDS.get(c)] : [])), 10, 0];

/** Loads the downloaded model. `speak` yields each chunk of `text` with its samples at 24 kHz. */
export async function loadKitten(dir) {
  const ort = await import('onnxruntime-node');
  const session = await ort.InferenceSession.create(path.join(dir, KITTEN_FILES[0].name), { executionProviders: ['cpu'] });
  const voices = readNpz(fs.readFileSync(path.join(dir, KITTEN_FILES[1].name)));
  async function* speak(text, voice, speed) {
    const style = voices[VOICE_FILES[voice]];
    if (!style) throw new Error(`Kitten has no voice "${voice}"`);
    for (const chunk of chunkText(text)) {
      const ids = kittenTokens(await kittenPhonemes(chunk));
      const row = Math.min([...chunk].length, style.shape[0] - 1);
      const { waveform } = await session.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
        style: new ort.Tensor('float32', style.data.slice(row * STYLE_DIM, (row + 1) * STYLE_DIM), [1, STYLE_DIM]),
        speed: new ort.Tensor('float32', [speed], [1]),
      });
      yield { sentence: chunk, audio: waveform.data.slice(0, Math.max(0, waveform.data.length - TRIM_SAMPLES)) };
    }
  }
  return { speak, sampleRate: KITTEN_SAMPLE_RATE };
}
