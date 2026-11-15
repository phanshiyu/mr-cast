# 43. Ship the engine inside the one npm package, and switch to it before every scene is ported

- Status: Accepted
- Date: 2026-11-16
- Amends: [ADR 42](0042-rust-engine.md)

## Context

[ADR 42](0042-rust-engine.md) planned to ship the engine through optional platform packages, as esbuild and Biome do,
and to remove Remotion with the switch. Two things changed that plan while the Node CLI and the player were moved to
the engine:

- npm publishes only from CI with trusted publishing ([ADR 12](0012-publish-from-ci.md)). A trusted publisher is set up
  on npmjs.com for a package that already exists, so five new platform packages could not be published by CI without
  first publishing each by hand with a token, which ADR 12 rules out.
- Scene types are ported one by one, on separate branches. Waiting for all of them before the CLI, the player and CI
  use the engine would keep the integration untested until the end.

## Decision

- The engine binaries ship inside `@shiyuphan/mr-cast`, under `engine/bin/<platform>-<arch>/` for darwin-arm64,
  darwin-x64, linux-x64, linux-arm64 and win32-x64. `publish.yml` builds them when a new version is due and puts them
  in the package before `npm publish`. `bin/lib/engine.mjs` looks for `MR_CAST_ENGINE`, then the package's binary, then
  a checkout's `cargo build`.
- ffmpeg comes from the `ffmpeg-static` package, which ships libx264; `MR_CAST_FFMPEG` and the PATH come before and
  after it.
- `render`, `still` and the player use the engine now. A scene type not yet ported draws a card naming it.
  `MR_CAST_RENDERER=remotion` renders and plays with Remotion until the last scene is ported; Remotion, the React
  scenes and Chrome are removed then.
- The engine mixes the voice clips at their frames and encodes the mix as AAC while the frames render; ffmpeg then
  copies the video, the voice and the chapters into the MP4 without encoding again. On the loaded machine the
  measurements were taken on, ffmpeg 6 (ffmpeg-static's) rendered up to twice as slowly when it read the voice beside
  the pipe of frames in one pass; the copy at the end takes about a second.

## Consequences

- The package is about 40 MB larger unpacked, with five binaries of about 8 MB, against the 459 MB Chrome download and
  the player bundle it no longer needs. Every install downloads every platform's binary.
- A platform outside the five cannot render; `engine.mjs` says so and names `MR_CAST_ENGINE`.
- Until the last scene type is ported, videos with those types show cards in their place unless
  `MR_CAST_RENDERER=remotion` is set, and the package still carries Remotion.
- npm installs that block install scripts leave ffmpeg-static without its binary; mr-cast then uses an ffmpeg on the
  PATH or says how to install one.
