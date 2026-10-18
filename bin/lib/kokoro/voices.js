import path from "path";
import fs from "fs/promises";
import { env as hf } from "@huggingface/transformers";

export { VOICES } from "./voice-list.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE_DATA_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/voices`;

/**
 * The voice's style vectors from the model's cache directory, downloaded from the Hub on first use.
 * mr-cast change: kokoro-js read them from the voices/ folder its npm package ships.
 * @param {keyof typeof VOICES} id
 * @returns {Promise<ArrayBufferLike>}
 */
async function getVoiceFile(id) {
  const file = path.join(hf.cacheDir, MODEL_ID, "voices", `${id}.bin`);
  try {
    return (await fs.readFile(file)).buffer;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (!hf.allowRemoteModels) throw new Error(`voice ${id} is not in ${path.dirname(file)} and remote models are off`);
  const response = await fetch(`${VOICE_DATA_URL}/${id}.bin`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${response.url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, buffer);
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
