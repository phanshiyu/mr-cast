# Vendored kokoro-js

The Kokoro text-to-speech wrapper from [hexgrad/kokoro](https://github.com/hexgrad/kokoro/tree/2668b2e2/kokoro.js/src), the source of kokoro-js 1.2.1, under the Apache License 2.0 in `LICENSE`.

mr-cast vendors it because kokoro-js 1.2.1 pins `@huggingface/transformers` to 3.x, whose `onnxruntime-node` and `sharp` carry known vulnerabilities, and npm ignores a dependency's `overrides`. The files are upstream's except two changes. In `voices.js`, `getVoiceFile` downloads a voice's style vectors into the transformers cache directory on first use, instead of reading the `voices/` folder the npm package shipped. In `phonemize.js`, Redis is said "red-iss" rather than espeak's "ri-deez".

Check it against upstream with `diff` before changing it.
