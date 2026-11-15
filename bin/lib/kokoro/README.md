# Vendored kokoro-js

The Kokoro text-to-speech wrapper from [hexgrad/kokoro](https://github.com/hexgrad/kokoro/tree/2668b2e2/kokoro.js/src), the source of kokoro-js 1.2.1, under the Apache License 2.0 in `LICENSE`.

mr-cast vendors it because kokoro-js 1.2.1 pins `@huggingface/transformers` to 3.x, whose `onnxruntime-node` and `sharp` carry known vulnerabilities, and npm ignores a dependency's `overrides`. The files are upstream's except three changes. In `voices.js`, `getVoiceFile` downloads a voice's style vectors into the transformers cache directory on first use, instead of reading the `voices/` folder the npm package shipped. It refuses an id that is not in the voice table, and a download that is not 522,240 bytes (510 vectors of 256 float32 values) or holds a number that is not finite and at most 100, and writes the numbers it decoded rather than the bytes it received. In `phonemize.js`, Redis is said "red-iss" rather than espeak's "ri-deez". The voice table moved from `voices.js` into `voice-list.js`, so `mr-cast voices` can list the voices without loading transformers.js.

Check it against upstream with `diff` before changing it.
