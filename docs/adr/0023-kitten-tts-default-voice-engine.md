# 23. Kitten TTS is the default voice engine, and Kokoro stays as an option

- Status: Accepted
- Date: 2026-10-18
- Supersedes: the voice part of 0001 (Kokoro as the only voice)

## Context

ADR 0001 voices every video with Kokoro (`onnx-community/Kokoro-82M-v1.0-ONNX`, q8, about 90 MB), and `--voice` takes a
Kokoro name such as `af_heart`. The user tried Kitten TTS (KittenML) and found it sounds much better, and asked to keep
Kokoro as an option: users choose a voice model, then a voice of that model.

Kitten has two families (KittenTTS README, kittenml 0.9.4):

- KittenTTS 2: a 1.7B-parameter speech language model, 506 to 947 MiB, run with PyTorch, vLLM or a llama.cpp fork,
  under the Stellon Labs Community License.
- The ONNX models of 0.8: nano (15M, 25 to 56 MB), micro (40M, 41 MB) and mini (80M, about 80 MB), with eight voices,
  under Apache 2.0 for both the code and the weights. They run with ONNX Runtime and need espeak-ng for phonemes.

mr-cast runs in Node with no Python, and its first voice-over downloads the model.

## Decision

- **Two engines, `kitten` (the default) and `kokoro`.** A voice is named `engine:name`, such as `kitten:luna` or
  `kokoro:af_heart`. `--voice` takes that name or a bare one: with `--engine`, a bare name is that engine's, and without
  it, the engine that has the name, so `--voice af_heart` and the other Kokoro names still pick Kokoro. `--engine` alone
  picks the engine's default voice. `bin/lib/voices.mjs` holds the engines, their voices and their sizes.
- **The Kitten model is `KittenML/kitten-tts-mini-0.8`**, the largest ONNX model, pinned to revision
  `c02725660cea441db4c383af69f1f26f5cd00947`: `kitten_tts_mini_v0_8.onnx` (78,268,016 bytes) and `voices.npz`
  (3,278,902 bytes), about 82 MB. Each file downloads on first use into `~/.cache/mr-cast/kitten/` and gets its name
  only when its sha256 matches the pinned one. A user who keeps the default never downloads Kokoro, and a Kokoro user
  keeps the model already in `~/.cache/mr-cast/models`.
- **Kitten runs in Node.** `bin/lib/kitten.mjs` follows kittenml 0.9.4's ONNX path at its default `clean_text=False`:
  the same sentence chunks (`chunk_text`), espeak-ng phonemes for `en-us` with stress and punctuation kept (the
  `phonemizer` Python package's rules, decimal separators included), its tokenizer and symbol table, the style row
  picked by the chunk's length, and the last 5000 samples trimmed. The phonemes come from the `phonemizer` npm package
  (espeak-ng in WebAssembly) that the Kokoro path already uses, with one fix: its espeak-ng says "or" as `oːɹ` where
  kittenml's espeak-ng 1.52 says `ɔːɹ`. ONNX Runtime is `onnxruntime-node` 1.30.0, the version transformers.js uses.
- **The default voice is `kitten:luna`.** Of Kitten's female voices it is closest to `af_heart` in pitch: on six test
  lines its median F0 is 205 Hz against 200 Hz, with the same spread (36 Hz against 35 Hz).
- **A clip's key includes the engine**, because the key hashes the full voice name. Clips made before 0.27 are keyed by
  a bare Kokoro name, so a Kokoro user's first voice-over in 0.27 voices them again.
- **The voice chosen last is remembered** with its engine in `last-choices.json`, beside the pace; `mr-cast status`
  prints it and the skill passes it. A stored bare Kokoro name reads as Kokoro.
- **`mr-cast voices`** lists each engine with its download size and whether it is downloaded, then its voices with the
  model card's description, marking the default and the last chosen. `mr-cast voices --sample engine:name` voices one
  sentence into a WAV file.
- `mr-cast prune` offers `cache:kitten` and, as before, `cache:models` (Kokoro). CI caches the Kitten model.

## Consequences

Good:
- The default voice sounds better, the model is about the same size as Kokoro's, and a voice-over takes less CPU: the
  35 lines of `examples/algorithms/binary-search` voice in about 63 s with the download, against 96 s for Kokoro.
- The Node path matches the Python package. On the 880 spoken texts of the examples (1,377 chunks), 1,373 chunks get the
  same token ids. Kitten's audio is not deterministic, so two Python runs of a line correlate at 0.988 to 0.994; the
  Node and Python audio of the same line have the same length to the sample and correlate at 0.988 to 0.994 too.
- Every download is checked against a pinned hash, which the Kokoro path through transformers.js does not do.

Bad:
- Kitten speaks more slowly: `binary-search` is 4:26 voiced with `kitten:luna` and 3:55 with `kokoro:af_heart`.
- Of the four chunks that differ, two are where the npm espeak-ng stresses "one" differently at a clause end. The other
  two are where kittenml drops words. Its punctuation step loses "point five" in "in 3.5." because a decimal number
  ends the sentence. mr-cast reads those words.
- Kitten's voices are all American English, and its model card describes each one only as female or male.
- A newer espeak-ng in kittenml, or a newer `phonemizer` npm package, can change the phonemes again; the tests pin a few
  lines to the Python package's output.

## Alternatives considered

- Replace Kokoro outright: the user asked to keep it as an option.
- KittenTTS 2: better still, but 506 MiB or more, a different license, and no runtime that mr-cast can run in Node.
- espeak-ng 1.52 in WebAssembly instead of the `phonemizer` npm package: one more dependency to fix two vowel spellings,
  which a single replacement already fixes.
- Phonemes from a Python subprocess: needs Python and espeak-ng on every machine.
