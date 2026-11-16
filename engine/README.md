# mr-cast engine

The renderer for mr-cast videos. It reads the props `bin/lib/engine.mjs` writes (storyboard, hunks, voice timing, images), draws every frame on the CPU, and encodes and writes the MP4 itself (no ffmpeg; see
docs/adr/0044-encode-in-the-engine.md).

```
engine/
  Cargo.toml             workspace (core, cli); rustfmt.toml: max_width 120
  assets/fonts/          Inter (variable, wght 400-800, opsz 14-32), JetBrains Mono (variable), Caveat 600, as TTF, with OFL texts
  core/                  mrc_core: no threads, files or processes; builds for wasm32-unknown-unknown
    data/                font-metrics.json and slots.json, written by scripts/engine-dump.mjs from the JS and TS
    src/
      lib.rs             Project, build_frame, render_frame (and _with/_into variants for reused buffers)
      model.rs           Props: storyboard (scenes kept as JSON), hunks, voiceover, highlight (syntax colours)
      timing.rs          shared/timing.mjs + steps.mjs + voice lookup: segments, durations, spoken_at
      speech.rs, markup.rs   shared/speech.mjs and shared/markup.mjs
      textfit.rs         shared/textfit.mjs over the measured advances: fit_text, fit_text_at, fit_lines, measure, Slot::named
      focus.rs           shared/focus.mjs: line refs and focus ranges of code scenes
      anim.rs            Remotion's interpolate, spring (incl. durationInFrames), Easing.bezier/out(cubic)
      steps.rs           src/utils/spotlight.ts: Spotlight/Emphasis, spotlight_starts, current_step, step_move, step_spring
      theme.rs           colours, SAFE, content_box, tones, code_columns
      color.rs           CSS colour parsing (hex, rgb(a), hsl)
      text.rs            fonts, swash shaping (Chrome's wght/opsz/kerning/ligatures), line metrics, baselines
      display.rs         the display list and its builder; svg_path; fingerprint (frame equality)
      raster.rs          tiny-skia for paths, hand-rolled box fills, cached glyph/shadow/glow masks, clips, layers
      icons.rs           lucide icons as path data
      chrome/            backdrop, shell (chapter label, title, aside, content box, enter/exit), captions, fittext
      scenes/            mod.rs (registry and contract), one module per scene type, placeholder.rs
    tests/js_fixtures.rs timing, speech, text fitting, springs and easings against the JS's own outputs
  cli/                   mr-cast-engine: render, still, sheet, probe
    src/encode.rs        repeats, runs of frames per core, rendering and encoding in rounds, yuv420p
    src/h264.rs          OpenH264 (openh264-sys2, built from source): one encoder per run, samples as MP4 wants them
    src/aac.rs           FDK AAC (fdk-aac-sys, built from source): the voice-over as AAC-LC, and back for checks
    src/mp4.rs           the MP4 writer (faststart, VFR durations, edit lists, chapters both ways) and its reader
    src/audio.rs         the voice clips mixed at their frames, at 48 kHz
  wasm/                  mrc_wasm: the core for the browser player (wasm-bindgen); scripts/build-wasm.mjs builds wasm/pkg
```

## Running it

```
node scripts/engine-dump.mjs props <run dir> props.json     # the props, as bin/lib/render.mjs builds them, plus syntax colours
cargo build --release --manifest-path engine/Cargo.toml
engine/target/release/mr-cast-engine render --props props.json --out video.mp4 [--frames a..b | --scenes 1,4..12]
                                            [--media-dir <run dir>] [--encoder h264|none] [--qp 22] [--cfr yes]
                                            [--scale 0.5] [--progress yes]
engine/target/release/mr-cast-engine still --props props.json (--frame N | --scene N [--step k]) --out still.png
engine/target/release/mr-cast-engine still --props props.json --scenes 1,3..6 [--step k] --out-dir stills/
engine/target/release/mr-cast-engine sheet --props props.json --tiles tiles.json --out sheet.png
engine/target/release/mr-cast-engine probe --in video.mp4 [--pcm voice.raw]
```

The Node CLI runs these (bin/lib/engine.mjs and render.mjs): `mr-cast render`, `still` and `still --sheet` write the
props into the run's directory, call the engine and remove them (`MR_CAST_DEBUG=1` keeps them and shows the engine's
output). `--scene N` and `--step k` pick the frame `mr-cast still` shows (N is 1-based here); `--scenes` writes
`scene-NN-<type>[-step-k].png` for each. `sheet` lays `[{ "scene": N, "label": "..." }]` out as contact sheets did.
`probe` prints an MP4's tracks, sample counts, edits and chapters (the text track's and the `chpl` box's) as JSON, and
with `--pcm` writes the voice-over as it plays, 16-bit mono at 48 kHz; the tests and `scripts/smoke.sh` use it.

With `--media-dir`, `render` mixes each segment's voice clip (`clip.src` under that directory) into one track from the
segment's voice frame to its end, as the player plays them, and encodes it as AAC-LC (mono, 48 kHz, 96 kbit/s)
while the frames render. A whole-video render also writes a chapter per run of scenes with one chapter title.

By default a frame that draws exactly what the frame before drew (equal display-list fingerprints) is neither drawn
nor encoded again: the sample before it lasts longer in the MP4 (a variable frame rate, in a 1/30 s timescale).
77% of the demo-simple frames repeat. `--cfr yes` makes every frame a sample (a repeat is copied, not drawn).

The frames that change are split into one run per core, each at least about 300 changing frames; each run has its own
H.264 encoder and starts on an IDR frame. Rendering goes in rounds of a few frames of every run at once, so all runs
advance together and the encoders, on their own threads, keep up. The encoders share their settings (High profile,
CABAC, QP 22 with no rate control, no B-frames), so their SPS and PPS are the same and the runs join into one track.
`--qp` trades size for sharpness (lower is sharper; 22 keeps text as sharp as x264 at CRF 18 did).

The encoders are C and C++ built by cargo with the system compiler, so a clean build takes longer. OpenH264's x86
assembly needs nasm; without it (and in published builds, `OPENH264_NO_ASM=1`) x86 builds use C. Their licences are
in `THIRD-PARTY-NOTICES.md` at the repository's root, which ships in the package.

After changing shared/textfit.mjs, shared/font-metrics.mjs, src/fit/slots.ts or shared/timing.mjs, run
`node scripts/engine-dump.mjs data` and `node scripts/engine-dump.mjs fixtures`; `cargo test` then shows any drift.

Checks: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and
`cargo build -p mrc_core --target wasm32-unknown-unknown`.

## Adding a scene type

A scene type is one file, `core/src/scenes/<type>.rs`, ported from the React scene that drew it before Remotion was removed (`git show b6e4efd:src/components/<Component>.tsx`) and its layout in
`src/utils/*Layout.ts`. Register it with one line in `scenes/mod.rs`: `pub mod <type>;` and an entry in `REGISTRY`.
Until then the type draws a placeholder card.

### What a scene receives and returns

```rust
pub fn prepare(input: &SceneInput) -> Result<Box<dyn SceneView>, String>
```

`prepare` runs once per project. `SceneInput` has:

- `scene: &serde_json::Value` - the storyboard scene. Read your fields with `super::parse::<MyScene>(input)`, a serde
  struct with only the fields you use (unknown fields are ignored; use `#[serde(rename_all = "camelCase")]`).
- `index` - its index in the storyboard.
- `props: &Props` - `props.hunks` (by id), `props.highlight.hunks[id]` (each hunk line's `[text, css colour]` tokens,
  as Prism with One Dark colours them) and `props.highlight.snippets["<language>\n<code>"]` for other code,
  `props.storyboard`.
- `duration` - the scene's length in frames.
- `segments: &[Segment]` - what it speaks: segment 0 is the narration, segment k + 1 is step k (`from`,
  `mark_from`, `voice_from`, `duration`, `speaking_frames`), exactly as shared/timing.mjs times them.

Do all layout here (text fitting is the expensive part) and keep the result in your view struct. Return
`Err(reason)` for a scene you cannot draw; it then draws a placeholder that says why.

```rust
impl SceneView for MyView {
    fn draw(&self, f: &Frame, dl: &mut DisplayList);
}
```

`draw` runs for every frame, on any thread, so the view holds no per-frame state. `Frame` has `frame` (frames
since the scene's start, Remotion's `useCurrentFrame()` inside the scene's `Sequence`), `duration` and `segments`.
Draw in frame pixels (1920 by 1080); the caller scales. Captions and the backdrop are drawn for you; the shell is
not, because a scene chooses its own aside:

```rust
self.shell.draw(dl, f.frame, f.duration, aside, |dl, bx| {
    // dl is translated to the content box's top left; bx.w and bx.h are its size.
});
```

`Shell::new(input.scene)` fits the chapter label and title. `Aside { height, draw }` is what the TSX passes as
`aside` (drawn at the header's right end; its height can push the content box down, as flex does in CSS).

### The display list

`DisplayList` is a CSS-like builder; every item takes the current transform and opacity:

- state: `save`/`restore`/`group(|dl| ..)`, `translate`, `scale_about(s, x, y)` (CSS scale with a
  transform-origin), `fade(k)` (multiplies opacity, item by item; `push_layer(opacity)`/`pop_layer` for true group
  opacity where overlapping children must fade as one).
- boxes: `rect(x, y, w, h, BoxStyle)` with `BoxStyle::fill(color or Paint).radius(r).border(color, w).shadow(Shadow::new(dx, dy, blur, color))`;
  borders are drawn inside the box as CSS does, and outer shadows are cut out under the box. `fill_rect` for plain ones.
  `Paint::Linear`, `Paint::Radial` (elliptical), `Paint::css_linear(angle, w, h, stops)`, `Paint::vertical`.
- paths: `path(Path, fill, Some(Stroke::solid(c, w)))`, `Stroke::dashed`, `.rounded()`; `circle`; `display::svg_path(d)`.
- text: `text(str, Style, x, baseline_y, color)` returns the advance; `run(shape(..), ..)`; `run_glow` for a
  text-shadow glow.
- clips: `push_clip(x, y, w, h, radius)`/`pop_clip` (CSS `overflow: hidden`; square clips snap to pixels).

### Helpers that mirror the TSX

- Text: `Slot::named("<key in src/fit/slots.ts>", width)` then adjust fields (`lines`, `size`, ...) as the TS spreads
  them; `fit_text`, `fit_text_at`, `fit_lines`, `measure` give the same lines and sizes as the JS. Draw a fit with
  `chrome::fittext::draw_fit(dl, &fit, x, top, TextOpts::new(color))` - `.normal()` for `lineHeight: 'normal'`,
  `.weight(w)` for FitText's `weight`, `.centered(width)` for `align="center"`. `fit_height` and `drawn_width` measure.
- Vertical placement: `text::baseline_in(face, size, line_box_height)` is where CSS puts a baseline in a line box;
  `text::line_metrics(face, size).normal` is `line-height: normal`. For flex `align-items: center`, centre the
  line box (`(h - normal) / 2`) and add the ascent.
- Animation: `anim::interpolate(frame, &[..], &[..], CLAMP)` (`CLAMP.eased(Easing::OutCubic)`), `clamped(frame, a, b, from, to)`,
  `spring(frame - delay, FPS, Spring::damping(18.0).with_stiffness(120.0))`, `spring_full(.., Some(duration))`.
- Steps: `steps::Spotlight::new(frame, &starts).emphasis(&[k])`, `spotlight_starts`, `current_step`, `step_move`,
  `step_spring`, `timing::build_frames(type)`, `timing::index_range`; `focus::line_focus_ranges` for code refs.
- Look: `theme::*` colours and `theme::tone(name)`, `icons::draw(dl, "Check", x, y, size, color, stroke_width)`
  (add icons to `icons.rs` from lucide-react), `color::Color::css("...")` for colours written in the TSX.

### CSS that needs care

- The old React scenes did not load Tailwind's preflight: boxes are `content-box` unless the TSX says
  `boxSizing: 'border-box'`, so a bordered box is 2 px larger, and flex then shrinks items in proportion to their
  inner sizes (see the strip and card in `scenes/flow.rs`).
- Line boxes come from line heights, not font sizes: a unitless `lineHeight` multiplies the size; a parent with
  none is `normal`, and the default font size of text outside a FitText is 16px.
- An `inline-block` with `overflow: hidden` sits on the line with its bottom edge as its baseline.
- `transform-origin` defaults to the centre; `scale_about` takes it explicitly.

## Porting a scene

1. Pick an example that uses the type, such as `examples/primitives/<type>` (any directory with a storyboard.json;
   hunks.json and meta.json are optional, so explanation runs work too).
2. Write `core/src/scenes/<type>.rs` from the TSX and register it (above).
3. Build, look at the stills (`mr-cast still`), and compare them with the old React drawing by checking out
   b6e4efd in a separate worktree and rendering the same run there; the comparison script went with Remotion.

```
cargo build --release --manifest-path engine/Cargo.toml
```

## Font metrics

`shared/font-metrics.mjs` holds the width of every character mr-cast draws, for each font, weight and size, with the
kerning pairs. `validate` and the layout code in `src/utils/` fit text with it, so a text that passes `validate` fits
the picture. It is fixed data: it was measured once from the fonts in `engine/assets/fonts/` and `src/assets/` (Inter,
JetBrains Mono, Caveat), and nothing regenerates it. The fonts must not change (a new version, a different subset)
without measuring again, or `validate` will pass text that does not fit. The engine shapes with swash and the file
was measured in Chrome, so a new measurement would have to be checked against `mr-cast still` on the examples; there
is no `metrics` command because writing a file that matches the old one is not a few lines of work.

## What is not ported yet

- `image`, `map`, `mermaid` and `svg` scenes draw a placeholder. Of the ones ported: text steps that `set` new text, number and question
  gradient fills (solid colour instead), flow steps with real `code` and step icons, code `typing` and output panes,
  and every scene's pen marks, ink and camera.
- The source line of pre-read diagrams (`SourceLine` in the old src/Walkthrough.tsx) and images.
