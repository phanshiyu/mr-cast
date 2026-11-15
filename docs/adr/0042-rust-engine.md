# 42. Draw and encode videos with a Rust engine, not Remotion

- Status: Accepted; amended by [ADR 43](0043-engine-ships-in-the-package.md) (the engine ships inside the package, and
  Remotion stays behind a switch until every scene type is ported)
- Date: 2026-11-16

## Context

Since [ADR 1](0001-local-cli-skill-remotion-kokoro.md), mr-cast has drawn every frame with Remotion. Remotion opens a
headless Chrome, lays out a React page for each frame, screenshots it and hands the screenshot to ffmpeg. Measured on
an 8-core Apple M1, a silent 7.5-minute demo (13 scenes, 1920×1080 at 30 fps, 13,380 frames) took 189 s to render, about
70 frames a second, and kept about 3.7 cores busy the whole time. Nearly all of that is the browser, not the drawing.
The install needs 1.8 GB of node_modules and a 459 MB Chrome download, and the first render bundles the player.

The scenes are boxes, text, lines and simple shapes. Their layout is already plain TypeScript that does not ask the
browser: text widths come from measured font metrics (`shared/textfit.mjs`), so `validate` and the player agree on
every line break.

## Decision

A Rust engine in `engine/` draws and encodes every frame:

- `engine/core` (`mrc_core`) holds the storyboard model, timing, text fitting, each scene type's layout and animation,
  and a rasterizer. It has no threads, files or processes, so it also compiles to WebAssembly.
- `engine/cli` (`mr-cast-engine`) renders frames in parallel and encodes the MP4, and draws stills and contact sheets.
- The browser player draws with the same core compiled to WebAssembly on a canvas, so the player and the MP4 cannot
  disagree. The page around it (guide panel, reading panel, plan page) stays a small React app; only the video is the
  engine's.
- The Node CLI keeps the commands that are not drawing (extract, validate, voice, play's server, skills, prune). It
  writes the same props Remotion received as JSON and runs the engine binary. Moving those to Rust is a later, separate
  decision; they are not where the time goes.
- The engine ships inside the npm package as a prebuilt binary per platform, through optional platform packages as
  esbuild and Biome do, so `npm i -g @shiyuphan/mr-cast` and `mr-cast upgrade` keep working.

Remotion, React rendering of scenes, headless Chrome and the player bundle cache are removed.

## Consequences

- Rendering is measured, not assumed; the numbers are in the CHANGELOG for the release that ships this.
- Scenes must look as they did. Each scene type is ported from its TSX and compared with Remotion's stills before
  Remotion is removed.
- Text fitting lives twice, in `shared/textfit.mjs` for `validate` and in Rust for drawing, with fixtures generated
  from the JS so the two cannot drift silently.
- A release builds the engine for each platform in CI. A platform without a binary cannot render.
- The Mermaid scene draws through Mermaid's JavaScript; see the engine README for how it is handled.

## Alternatives considered

- **Keep Remotion and tune it** (concurrency, hardware encoding, reuse unchanged scenes): perhaps 2 to 3 times faster,
  but Chrome stays, and so do its size and its cost per frame.
- **Rewrite the whole CLI in Rust at once**: the CLI is not slow, and its 13,000 lines are well tested. Doing both at
  once would delay the speed-up and risk regressions in validation that the skill depends on.
- **A native window instead of a browser player**: more platform work and no guide panel for free.
