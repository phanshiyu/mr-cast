# mr-cast engine

A native renderer for mr-cast videos, meant to replace Remotion (React drawn by headless Chrome). It reads the same
props the composition gets, draws every frame on the CPU and pipes them to ffmpeg.

```
engine/
  Cargo.toml             workspace (core, cli); rustfmt.toml: max_width 120
  assets/fonts/          Inter (variable, wght 400-800, opsz 14-32), JetBrains Mono (variable), Caveat 600, as TTF, with OFL texts
                         and the fallbacks for glyphs they lack, as Chrome falls back per character: Inter and
                         JetBrains Mono beyond Latin (Greek, Cyrillic, arrows, math), Noto Sans Symbols (variable),
                         Noto Sans Math and Noto Sans Symbols 2, each subset to its symbol blocks with pyftsubset
  core/                  mrc_core: no threads, files or processes; builds for wasm32-unknown-unknown
    data/                font-metrics.json and slots.json, written by scripts/engine-dump.mjs from the JS and TS
    src/
      lib.rs             Project, build_frame, render_frame (and _with/_into variants for reused buffers)
      model.rs           Props: storyboard (scenes kept as JSON, findings), hunks, voiceover, highlight (syntax colours),
                         icons (the storyboard's Lucide icons)
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
      icons.rs           built-in Lucide icons as path data, and the storyboard's own (`props.icons`)
      marks/             pen marks and ink: MarkTargets, Board, ref resolution (mod.rs); their geometry (geometry.rs)
      camera.rs          shared/camera.mjs: Camera, View, frame_shot, tween_view; draws a scene's content through a view
      states.rs          shared/state-steps.mjs's walk: StateModel, walk_states, StateFrame (shown, place, tint, changed)
      chrome/            backdrop, shell (chapter label, title, aside, content box, enter/exit, header_box,
                         HeaderCallout, source line), captions, fittext
      scenes/            mod.rs (registry and contract), one module per scene type, placeholder.rs
    tests/js_fixtures.rs timing, speech, text fitting, springs and easings against the JS's own outputs
    tests/marks_geometry.rs  pen and ink geometry against src/utils/penGeometry.ts and inkGeometry.ts
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
  text-shadow glow (a transparent colour draws the glow alone, as a halo); `run_paint(run, x, y, Paint)` for
  gradient-filled text (`background-clip: text`).
- clips: `push_clip(x, y, w, h, radius)`/`pop_clip` (CSS `overflow: hidden`; square clips snap to pixels);
  `push_fade_layer(x, y, w, h, fade)`/`pop_layer` for content masked to a rect with soft edges (the camera's view).

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
- Look: `theme::*` colours and `theme::tone(name)`, `color::Color::css("...")` for colours written in the TSX.
- Icons: a component's fixed icon (`<Check/>`) is `icons::draw(dl, "Check", x, y, size, color, stroke_width)`; add
  it to `icons.rs` from lucide-react. An icon the storyboard names (a node's `icon: "server"`) is
  `icons::draw_named(dl, &props.icons, name, ...)`: Node puts every `icon` the storyboard names into `props.icons`
  (`scripts/engine-dump.mjs`, `iconNames`/`iconPaths`; the CLI must do the same).
- Steps that change what a scene shows (`set`, `show`, `hide`, `tint`, `move`, `callout`, `sort`): implement
  `states::StateModel` for the type (its MODELS entry in shared/state-steps.mjs: `initial`, `set_prefixes`,
  `show_prefixes`, `tint_prefixes`, `callout`, `apply_move`, `apply_extra` for trace/morph), call
  `walk_states(&model, scene)` in `prepare`, and `StateFrame::at(&states, segments, frame)` in `draw` for
  `before`/`now`/`t`/`lit`, `shown(key)`, `place(key)`, `changed(key)` and `tint(key)` (`TintMix`, `main_tone`,
  `opacity`, `states::tint_fill`). `scenes/text.rs` (`TextModel`) is the worked example.
- The header callout (HeaderCallout.tsx): `chrome::shell::HeaderCallout::new(scene)`, drawn as the shell's aside with
  `.draw(dl, right, top, &state_frame)`; `shell::header_box(scene)` is the content box the TS layouts and camera use.

### Pen marks, ink and the camera

Every scene whose steps take `focus` (and code) gets pen marks (`mark`, `note`, code `token`, review `flag`), ink
(`draw`, `erase`) and the camera (`camera`) from the same boxes. In the TSX the scene computes
`targets(k): MarkTargets` and passes it to `SceneShell`'s `camera` and to `<PenMarks>`. In Rust:

1. Refs. Implement `marks::Refs` for the type: `resolve(&Value) -> Option<Vec<String>>` is the type's `resolve` in
   shared/targets.mjs (item keys such as `"n:api"`, `"b:2"`). Wrap it as `StepRefs::Scene(&refs)`; a code scene uses
   `StepRefs::Code(&hunk)`, which resolves lines (`ln:<i>`) and text (`tx:<i>:<at>:<len>`). `marks::resolve_ref`
   adds the "a digit string is an index" fallback.
2. Targets. In `prepare`, build each step's `MarkTargets` in content-box px, as the TSX's targets give them for step k
   once it has settled: `boxes` (key, `geometry::Bx`) in the TS map's order, `obstacles` (None for every box),
   `lines` (points on connectors), `area` (the content box, usually `0, 0, w, h`), `box_of` for keys not listed
   (code lines), `clip` (where ink shows, if content scrolls), `shifts: true` if the scene scrolls towards the step
   while it plays. `MarkTargets::new(boxes, area)` covers the common case; a diagram that scales its layout onto the
   stage (`staged`/`centredStage` in penGeometry.ts) scales its boxes the same way here.
3. Board. `let board = Board::new(scene, segments, &step_refs, &|k| targets[k].clone(), &|step| ink_of(step))`
   lays out every mark and ink item once (`ink_of` returns `Some(InkOf { color, label })` for a review flag; `|_| None`
   elsewhere).
4. Camera. `let camera = Camera::new(scene, &step_refs, shell::header_box(scene))`.
5. Draw. Inside the shell's content closure:

```rust
let view = self.camera.view(frame, f.segments, &|k| self.targets.get(k).cloned().flatten());
self.shell.draw(dl, frame, f.duration, aside, |dl, bx| {
    self.camera.draw(dl, view, |dl| {
        // ... the scene's content ...
        self.board.draw(dl, frame, f.segments, &|_k| None); // or Some(Pt) per step, while it scrolls
    });
});
```

The board draws last, over the content, inside the camera, so marks zoom and pan with what they mark, as `<PenMarks>`
inside `<SceneShell camera>` does. Ink that marks parts a later step moves follows them by itself (`follow`); a scene
that scrolls (code) passes the shift instead. Text, code and flow are wired this way: `scenes/text.rs` measures its
parts only when a step marks or draws, as TextCard does, and `scenes/code.rs` is the scrolling case.

### CSS that needs care

- The Remotion bundle does not load Tailwind's preflight: boxes are `content-box` unless the TSX says
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
3. Build and compare, and repeat until the table is flat:

```
cargo build --release --manifest-path engine/Cargo.toml
scripts/engine-compare.sh examples/primitives/<type> [--scenes 0,3,5] [--out dir]
```

For each chosen scene (0-based, as `mr-cast still` counts; all by default) it takes Remotion's still at the scene's
end and at the end of every step, and the engine's matching still, and prints one line per still:

```
still                                  mean worst-tile  at
scene-01-text                          1.31        7.1  896,704
scene-04-flow-step-2                   0.90       12.3  960,576
scene-07-code-step-2                   1.54       22.7  1344,576
```

`mean` is the mean absolute difference over the frame and `worst-tile` the worst 64-pixel tile, whose top left is
`at`, both in levels of 255. A faithful port reads about 1 to 1.5 mean and under about 25 in the worst tile (text
anti-aliasing never matches exactly); a misplaced or missing element shows as a worst tile of 50 or more. In `--out`
(default `/tmp/engine-compare/<dir name>`) are `compare-<still>.png` (Remotion on top, engine below),
`diff-<still>.png` (the difference four times brighter, black where they agree) and both originals; look at the
compare image of every still whose numbers stand out.

Remotion's stills are cached in `~/.cache/mr-cast-engine-compare/<hash>`, keyed by the run's files and by `src/`,
`shared/` and `bin/`, one file per still, so a run only asks Chrome for the stills it lacks and a re-run only redraws
the engine's side (about 2 s for 14 stills). The mr-cast commands run with temporary config, state and Claude
directories; the real `~/.cache/mr-cast` is kept so Chrome and the bundle are not fetched again.

`mr-cast-engine compare --remotion a.png --engine b.png [--out-compare c.png] [--out-diff d.png]` is the
comparison on its own. Stills show settled states; for motion, compare frames of a Remotion MP4 with the engine's
(`mr-cast-engine still --frame N`). Text, flow and code match Remotion to under 1.5 levels of mean grey difference
on every sampled frame of the demo.

## What is not ported yet

- Scene types other than text, code and flow draw a placeholder until their ports merge.
- Images (`ImagesContext` of src/Walkthrough.tsx) belong to the image scene's port.
- Audio: the engine writes silent video; the Node CLI muxes the voice.
- Handwriting (Caveat) is shaped by swash, where the TS measures notes with a canvas: a note can sit a few pixels off.
