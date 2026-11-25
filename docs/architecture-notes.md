# mr-cast designed contract: design notes

Contract: `architecture.mmd` at the repository root, checked by `pnpm check` (ADR 51).
Result: 22 nodes in 6 stacks, `driftwall lint --strict` clean. The 31 errors the first check found (4 root causes, listed below) are fixed.

## Stacks, layers and order (ADR 51)

The 22 nodes did not change. What changed is how they are grouped and what lint enforces between them:

- Every node sits in a layer boundary, and every layer in a stack: `cli-stack`, `page`, `fit-check`, `foundation`, `engine` and `dev`.
  `driftwall render --depth 1` draws the 6 stacks, which is the picture in CONTRIBUTING.md, and `--focus engine` draws the engine's layers in engine/README.md.
- One `%% order` line per stack (CLI, page and fit check down to the foundation, the foundation, the engine) replaces the
  "Forbidden directions" prose. An arrow that points up a layer is now a contract error, so the order cannot be silenced by drawing an arrow.
  The rest of that prose (which part may import which) was already enforced, because an import without an arrow fails lint.
- `dev` (tooling and tests) is in no order chain: tests import every stack.

## Sources used

- `docs/adr/0042-rust-engine.md` and `0043-engine-ships-in-the-package.md` (engine, Node CLI and page split; process boundary; wasm player).
- `docs/adr/0027-process-registry.md`, `0025-ink-board.md`, `0028`/`0033` (camera and ink), `0013-evaluation-harness.md` (quality/), `0046-tiny-voca-voice.md`.
- `CONTRIBUTING.md:54-57` ("Find your way around": bin, src, shared, fit and layout), `CLAUDE.md`, `README.md`.
- `engine/README.md` (module table, "Pen marks, ink and the camera", scene registry at :111), crate and module `//!` docs, `.fallowrc.jsonc` (entry points).
- the `driftwall init` draft.
- Style references: driftwall's `architecture.mmd`, the follow-me, pocketlab, getby and home contracts.

## Rework after the independent review (supersedes the first design)

The first design had 34 nodes, 12 of them in engine-core cut by file; the review called that a second inventory. Now 22 nodes.

- Engine core is five nodes, cut by the concerns ADR 42 names: `core-api` (lib.rs, raster.rs: Project and the rasterizer), `core-scenes`
  (scenes/, chrome/, review.rs: one registry of scene types plus what every scene shares), `core-steps` (targets/, arrays.rs, states.rs, marks/,
  camera.rs: refs, state walks, pen and camera, one subsystem in engine/README.md:199-250), `core-draw` (display, icons, diagram, look, text, textfit,
  color, anim, theme, steps), `core-script` (model, markup, speech, timing, focus, chapters). `core-scenes` stays one node (README:111).
- marks <-> camera is now inside `core-steps` on purpose (docs treat it as one subsystem); recorded under "Not expressible yet". If split later, Pen goes in a module above both (README:226).
- Deviations from the reviewer's set: `cli-serve` is kept as its own node (22 nodes, not 21). server.mjs:6 imports AUDIO_NAME from voice.mjs (cli-engine)
  and cli-engine imports procs.mjs (cli-workspace, voice-child.mjs:7), so merging server/serving into cli-workspace would hide a cycle workspace <-> engine.
  `quality/` and `examples/` are merged into `tooling`; `engine-encode` into `engine-cli` (one crate, acyclic); the player and timeline into `web-app`.
- Nodes now: tooling, tests; cli, cli-validate, cli-engine, cli-serve, cli-workspace, cli-base; web-app, web-engine, layout, fit; shared, types;
  engine-cli, engine-wasm, dizione; core-api, core-scenes, core-steps, core-draw, core-script. Edges: 42 solid, 15 test, 1 planned.
  Subgraph order: tooling and tests, Node CLI (entry, features, workspace, helpers), web, foundation, engine binaries, core (composition, steps, foundations).
- Responsibilities and evidence are those of the first design, merged: cli-workspace = old cli-ops + cli-content (procs.mjs:1-5, prune.mjs:14-20,
  images.mjs:9-11); web-app = old web-app + web-app (App.tsx:30-53, CanvasPlayer.tsx:5, utils/timing.ts:1-2); engine-cli = old engine-cli +
  engine-encode (main.rs:1, encode.rs:1, mp4.rs:1); core-draw and core-scenes as listed above (display.rs:1-4, text.rs:1, textfit.rs:1-4, chrome/mod.rs:1, scenes/mod.rs:1-2).
- `core-api` exports: the symbols the binaries import from lib.rs. Not described as a front door: lib.rs makes every module pub and engine-cli also imports
  core-script and core-draw (main.rs timing and Props, sheet.rs text and display list).
- The theme stays in `types`. `web-app --> engine-wasm` is solid: driftwall now counts an alias into a node's directory (the git-ignored wasm-pack output) as a dependency on that node.

## Mapping trade-off
`bin/lib/` and `engine/core/src/` are flat directories whose files belong to different nodes, so those maps are file lists (or `name*` patterns). A new file there fails lint as `unmapped-file` until someone places it in a node; that is intended, it forces the placement decision.
`layout` and `fit` form their own subgraph (validate's TS fit check, bundled by the CLI); `src/fit/report.ts` stays mapped to `fit` until the move in the debt list.

## Violation list (31 sites, 4 root causes, all fixed)

Fixed by the change "Remove the 4 upward imports". Kept as the record of why the code moved. All genuine. All four fixes applied together to a scratch copy (deleted): `lint --strict` clean (lint-checked, not compiled or run).

1. core-steps --> core-scenes, 4 imports: `states.rs:589` (`scenes::svg::motion::parse_transform`) and `targets/mod.rs:19, 20, 21` (`scenes::text::resolve_value`,
   `table::resolve`, `chart::resolve`). PROJECT OBSERVATION: upward imports, the legs of the chrome/scenes/states/targets/arrays cycle (scenes imports targets 38 times, states 23).
   Docs and design disagree: `targets/mod.rs:3-4` calls the dispatch into scene modules deliberate; the contract follows the layering and lint shows the gap (criterion 5).
   Fix: only scenes calls `targets::resolve*` (SceneRefs, with_fallback; checked by grep), so give the text, table and chart REGISTRY entries their resolver, or move the dispatch
   `resolve` into scenes (no OnceLock hook, no global state in a wasm crate). For states.rs:589 the svg scene passes the transform check to its StateModel like `move_key` and `morph` (states.rs:577-598).
2. fit --> layout, 25 imports: `src/fit/report.ts:6, 11-26, 28, 29, 31-33, 36, 52, 53`. PROJECT OBSERVATION: the runtime cycle fit <-> utils (layout imports fit 37 times). report.ts is the top of the
   layout code but sits under fit. Fix: move it to `src/utils/`, update `ENTRY` (`bin/lib/validate-fit.mjs:17`), `.fallowrc.jsonc:10`, CONTRIBUTING.md:57, `scripts/check-text.mjs:3,31`,
   `bin/lib/validate-camera.mjs:20`, `src/utils/sceneTargets.ts:2`.
3. cli-workspace --> cli-validate, 1 import: `bin/lib/summary.mjs:10` (`mixLine`). PROJECT OBSERVATION, minor: a "pure formatting" module reaches into a check. Fix: move `runsOf` and `mixLine`
   (`validate-mix.mjs:33-56`) to `shared/brief.mjs` (summary.mjs already imports `briefLine` from it); validate-mix imports them from shared.
4. web-engine --> layout, 1 import: `src/engine/highlight.ts:7` (`formatPayload` from `utils/flowLayout.ts:28-34`, a six-line JSON pretty-printer). PROJECT OBSERVATION: it pulls flowLayout,
   fit/slots, textfit and codeLayout into the browser player and defeats "the player never imports layout"; it is debt, so the edge is not declared. Fix: move `formatPayload` to `shared/` (checked: lint clean) or into `src/engine/`.

Debt lint cannot report is in the contract's "Not expressible yet" block (marks <-> camera inside core-steps, esbuild bundling, type-only imports, wasm purity, global look state).

## DRIFTWALL DEFECTS

1. DRIFTWALL DEFECT (cannot express the design; a fix is reported under way): an alias to a git-ignored build output never becomes an edge, even though the tool names the owner.
   Repro: `vite.config.ts` has `resolve: { alias: { 'mrc-wasm': path.resolve('engine/wasm/pkg/mrc_wasm.js') } }`; `engine/wasm/pkg` is git-ignored output; `src/player/CanvasPlayer.tsx:5`
   does `import init, { Player } from 'mrc-wasm'`; the contract maps `engine/wasm/` to `engine-wasm`. `driftwall neighbors web-app --contract architecture.mmd` prints
   `skipped: src/player/CanvasPlayer.tsx:5 mrc-wasm (alias-target-missing) ... the target lies in the directory of node engine-wasm`, yet no edge web-app --> engine-wasm is recorded. Consequences:
   the declared `web-app -.-> engine-wasm` stays dotted forever (never `planned-realized`), and any other node importing `mrc-wasm` passes lint. Suggested: when the message can name the owner node, emit that edge
   (kind from the import), so the edge is checked and a solid edge can be declared.
2. Limitation, not a defect (documented blind spot): esbuild bundling (`bin/lib/validate-fit.mjs:17`, `bin/lib/engine.mjs:98`, `scripts/engine-dump.mjs` stdin) hides three real cross-stack dependencies; listed under "Not expressible yet".

## Open questions
- Should `core-steps` be split later (refs/states below the pen and camera)? Not now: docs treat it as one subsystem.
- Should `engine-cli` reach core-script and core-draw directly, or through core-api? Allowed today because lib.rs makes every module pub.
- Is the Remotion-era TS layout (`layout` + `fit`) meant to live on? CONTRIBUTING.md:55 says it exists for `validate`.
