# 46. Voice with tiny-voca in the engine, and drop Kitten and Kokoro

- Status: Accepted
- Date: 2026-11-16
- Supersedes: the engine choice of 0023 (Kitten by default, Kokoro as an option)

## Context

ADR 23 voices with Kitten TTS mini 0.8 (80M parameters, about 82 MB) by default and keeps Kokoro (82M, about 90 MB) as
an option. Both run in Node: onnxruntime-node, @huggingface/transformers and the phonemizer package (espeak-ng in
WebAssembly). Those three are about 740 MB of the 1.0 GB a production install of mr-cast takes. Since ADR 42 the
frames are drawn and encoded by a Rust engine that ships in the package, so the voice can move there too.

The user asked for tiny-voca (https://github.com/n4ze3m/tiny-voca): a 4.5M-parameter English model with two voices,
F2 and M2, trained from scratch on synthetic speech, Apache-2.0. Its ONNX file is 21.4 MB (opset 17, 24 kHz). Its
front end is dizione (https://github.com/n4ze3m/dizione, Apache-2.0), a Python package: text rules, a CMUdict
lexicon, homograph rules and a linear classifier, morphology, and a small BiGRU for unknown words. Its built data
(5.4 MB) comes with the model.

## Decision

- **One engine, `tiny-voca`, with voices `tiny-voca:m2` (the default) and `tiny-voca:f2`.** M2 is the default of the
  model's own demo; the model card says F2 sounds younger than intended.
- **dizione is ported to Rust** (`engine/dizione`), module by module, from commit 8cd889e. Its hand-written tables are
  compiled in; the built data is read from the model's download. A test compares it with the Python package on 7,702
  sentences (the narration of every example, split as tiny-voca splits it, dizione's own test sentences, and generated
  figures, dates, money, versions, identifiers, made-up words, signs and Unicode): every one gives the same ids and
  stress.
- **The model runs in tract** (tract-onnx 0.23, pure Rust), so the binary needs no shared library. tract runs every
  op of the graph once two things are set when it loads: ONNX casts to int64 stay int64 (tract reads them as
  symbolic sizes, which its CumSum cannot add), and the graph's random noise gets a fixed seed, so a text always
  sounds the same.
- **`mr-cast-engine voice`** speaks a job of clips as tiny-voca's `speak_text` does: a full stop added when a text
  ends without a mark, sentence by sentence, a sentence too long for one call cut after commas and then between
  words, a sentence with nothing to say skipped, and the clip scaled down when it peaks above 0.99. Clips and their
  sentences run on every core. It writes each WAV and prints its timing as it finishes, so a player sees clips
  arrive as before.
- **Words are timed from the model's durations.** Each sentence in voiceover.json gains `times`, where each of its
  words starts. A word of the text is given the spoken words its prefix adds (a number can be several, a sign none)
  and starts at the first phone of the first of them. Captions and cues (shared/timing.mjs, engine/core timing.rs)
  use `times` where a sentence has them and spread words evenly over the sentence otherwise, as before.
- **Node downloads, the engine reads.** `bin/lib/tiny-voca.mjs` downloads the seven files the engine needs (26.8 MB)
  at revision e5f9b116 into `~/.cache/mr-cast/tiny-voca/e5f9b116/`, each kept only when its sha256 matches, under the
  engine's lock, as Kitten's download did. `mr-cast prune` lists `cache:tiny-voca`, and `cache:kitten` and
  `cache:models` while they exist.
- **A Kitten or Kokoro voice reads as the closest tiny-voca voice**, from a flag or a saved choice, with a one-line
  notice: Kitten's female voices and Kokoro's `?f_` voices as F2, the male ones as M2. Clips keep their old names in
  the run, so a run voiced before is voiced again once.
- Kitten, Kokoro, bin/lib/kokoro/, onnxruntime-node, @huggingface/transformers and phonemizer are removed.

## Consequences

Measured on this machine (Apple silicon, other work running), voicing examples/demo-simple (47 clips) with
`mr-cast voice`, the model already downloaded:

| | Kitten (before) | tiny-voca |
|---|---|---|
| Wall time | 32 s | 1.5 s |
| Speech | 7 min 12 s | 5 min 9 s |
| Model download | 82 MB | 27 MB |
| `node_modules` of a production install | 1.0 GB | 267 MB |
| Engine binary (darwin-arm64) | 33.5 MB | 47.8 MB |

Against onnxruntime 1.32 (Python) on the same inputs, with the same noise fed to both: identical durations on six
sentences, and audio within 2.6e-3 of each other (peaks of 0.7 to 0.94).

Good:
- Voicing is about 20 times faster, the install is about 0.75 GB smaller, and nothing outside the engine runs the voice.
- Captions and pen cues follow each word, not an even spread over the sentence.
- Every downloaded file is checked against a pinned hash, as before.

Bad:
- Kokoro's 28 voices, British English among them, and Kitten's eight are gone: two voices remain, American English
  only. tiny-voca reads English only; a sentence in another script is skipped.
- The voice is clear but can sound slightly synthetic, by the model card's own account.
- The engine binary grows by about 14 MB (tract and the phonemizer).
- dizione is ported at one commit; a newer dizione or model needs the port checked again (`engine/dizione/tests`).

## Alternatives considered

- Keep the voice in Node with onnxruntime-node: keeps the 740 MB this removes.
- The `ort` crate with onnxruntime linked statically: not needed, since tract runs the graph; it would add a C++
  build on five platforms.
- Run dizione in Python or Pyodide: needs Python on every machine, or a WebAssembly runtime in the engine.
