# mr-cast engine

A native renderer for mr-cast videos, meant to replace Remotion (React drawn by headless Chrome). It reads the same
props the composition gets, draws every frame on the CPU and pipes them to ffmpeg.

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
  cli/                   mr-cast-engine: render (parallel, repeats skipped, ffmpeg) and still
```

## Running it

```
node scripts/engine-dump.mjs props <run dir> props.json     # the props, as bin/lib/render.mjs builds them, plus syntax colours
cargo build --release --manifest-path engine/Cargo.toml
engine/target/release/mr-cast-engine render --props props.json --out video.mp4 [--frames a..b | --scenes 1,4..12]
                                            [--encoder x264|videotoolbox|none] [--cfr yes] [--scale 0.5]
engine/target/release/mr-cast-engine still --props props.json (--frame N | --scene N [--step k]) --out still.png
```

`--scene N` and `--step k` pick the frame `mr-cast still` shows (N is 1-based here). ffmpeg comes from
`MR_CAST_FFMPEG` or the PATH.

By default a frame that draws exactly what the frame before drew (equal display-list fingerprints) is neither drawn
nor encoded again: frames go to ffmpeg as a Matroska stream with timestamps, and the MP4 is timestamped per frame
(`-bf 0`, so the muxer keeps every frame's duration). 80% of the demo's frames repeat. `--cfr yes` sends every
frame as raw video instead.

After changing shared/textfit.mjs, shared/font-metrics.mjs, src/fit/slots.ts or shared/timing.mjs, run
`node scripts/engine-dump.mjs data` and `node scripts/engine-dump.mjs fixtures`; `cargo test` then shows any drift.

Checks: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and
`cargo build -p mrc_core --target wasm32-unknown-unknown`.

## Adding a scene type

A scene type is one file, `core/src/scenes/<type>.rs`, ported from `src/components/<Component>.tsx` and its layout in
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

- The Remotion bundle does not load Tailwind's preflight: boxes are `content-box` unless the TSX says
  `boxSizing: 'border-box'`, so a bordered box is 2 px larger, and flex then shrinks items in proportion to their
  inner sizes (see the strip and card in `scenes/flow.rs`).
- Line boxes come from line heights, not font sizes: a unitless `lineHeight` multiplies the size; a parent with
  none is `normal`, and the default font size of text outside a FitText is 16px.
- An `inline-block` with `overflow: hidden` sits on the line with its bottom edge as its baseline.
- `transform-origin` defaults to the centre; `scale_about` takes it explicitly.

### Checking a port

Compare against Remotion: `mr-cast still <0-based index> --no-voice --out <dir> [--step k]` (with the temporary
config directories CLAUDE.md asks for) against `mr-cast-engine still --scene <1-based> [--step k]`, and across the
whole scene, frames of the Remotion MP4 against the engine's. Text, flow and code match Remotion to under 1.5 levels
of mean grey difference on every sampled frame of the demo.

## What is not ported yet

- 21 scene types draw a placeholder. Of the three ported: text steps that `set` new text, number and question
  gradient fills (solid colour instead), flow steps with real `code` and step icons, code `typing` and output panes,
  and every scene's pen marks, ink and camera.
- The source line of pre-read diagrams (`SourceLine` in src/Walkthrough.tsx) and images.
- Audio: the engine writes silent video; the Node CLI would mux the voice as it does today.
