import path from "path";
import fs from "fs/promises";
import { env as hf } from "@huggingface/transformers";
import { VOICES } from "./voice-list.js";

export { VOICES };

const VOICE_FILE_BYTES = 510 * 256 * 4;
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/**
 * The voice's style vectors from the model's cache directory, downloaded from the Hub on first use.
 * mr-cast change: kokoro-js read them from the voices/ folder its npm package ships.
 * @param {keyof typeof VOICES} id
 * @returns {Promise<ArrayBufferLike>}
 */
async function getVoiceFile(id) {
  // mr-cast change: only a voice in the table names a file, so the id never carries a path or a URL part.
  if (!Object.hasOwn(VOICES, id)) throw new Error(`unknown voice ${id}`);
  const file = path.join(hf.cacheDir, MODEL_ID, "voices", `${id}.bin`);
  try {
    return (await fs.readFile(file)).buffer;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (!hf.allowRemoteModels) throw new Error(`voice ${id} is not in ${path.dirname(file)} and remote models are off`);
  const host = hf.remoteHost.replace(/\/+$/, "");
  const response = await fetch(`${host}/${MODEL_ID}/resolve/main/voices/${id}.bin`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${response.url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  // mr-cast change: every voice file is 510 style vectors of 256 float32 values; anything else is not one.
  if (buffer.length !== VOICE_FILE_BYTES) throw new Error(`voice ${id} is ${buffer.length} bytes, not ${VOICE_FILE_BYTES}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.rm(tmp, { force: true });
  await fs.writeFile(tmp, buffer, { flag: "wx" });
  await fs.rename(tmp, file);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

const VOICE_CACHE = new Map();
export async function getVoiceData(voice) {
  if (VOICE_CACHE.has(voice)) {
    return VOICE_CACHE.get(voice);
  }

  const buffer = new Float32Array(await getVoiceFile(voice));
  VOICE_CACHE.set(voice, buffer);
  return buffer;
}
