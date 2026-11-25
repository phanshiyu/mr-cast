# Architecture contract and driftwall review: mr-cast

`architecture.mmd` is this project's architecture as a design: a small set of components,
each with one responsibility, grouped in layers, and arrows for the dependencies the design
**allows**. The `%% map` lines in the same file assign every source file to a component, and the
`%%` comments record why each non-obvious arrow exists, which directions are forbidden, the debt
the code has today, and the rules a tool cannot check yet. The reasoning behind each component and
violation is in [`architecture-notes.md`](architecture-notes.md).

[driftwall](https://github.com/phanshiyu/driftwall) checks the contract: it parses every source
file (tree-sitter), resolves each import to a file and a component, and reports every dependency
the design does not allow. Arrows marked `-->|test|` allow only test code to cross.

Reviewed 2026-11-23 with driftwall `daaf073`.

## Review

An independent review agent judged the contract against a six-point rubric: right components,
complete mapping, real layers, arrows that allow only the intended dependencies (debt stays visible
as violations), fidelity to the project's own docs, and usefulness to a newcomer. **Satisfactory in
round 2.** Round 1 rejected a 34-component draft as a second inventory: the engine core was cut into
eleven small pieces while `scenes` (29% of the code) stayed whole. The redesign follows ADR 42's
concerns (22 components for three languages and three runtimes) and stopped allowing
`web-engine --> layout`, which pulled the layout chain into the browser player for a six-line helper.

The remaining debt has four root causes: the core targets/states → scenes cycle, `src/fit/report.ts`
living below the code it runs, a CLI summary helper importing a check, and `formatPayload`. The web
app reaches the Rust engine only through the `mrc-wasm` alias to git-ignored wasm-pack output.

## What lint reports today

22 components, 58 arrows (43 implemented, 15 test).
**31 violations** in 4 groups, 0 warnings. Each violation is a
place where the code breaks the design; the notes give the fix for each.

- **fit → layout** (25):
  - `src/fit/report.ts:6`
  - `src/fit/report.ts:11`
  - `src/fit/report.ts:12`
  - `src/fit/report.ts:13`
  - `src/fit/report.ts:14`
  - `src/fit/report.ts:15`
  - and 19 more
- **core-steps → core-scenes** (4):
  - `engine/core/src/states.rs:589`
  - `engine/core/src/targets/mod.rs:19`
  - `engine/core/src/targets/mod.rs:20`
  - `engine/core/src/targets/mod.rs:21`
- **cli-workspace → cli-validate** (1):
  - `bin/lib/summary.mjs:10`
- **web-engine → layout** (1):
  - `src/engine/highlight.ts:7`

## Components

| Component | Responsibility | Files |
|---|---|---|
| `cli` | argv parsing and command orchestration | 2 |
| `cli-base` | UserError, JSON, git, diff parsing, cache and lock | 7 |
| `cli-engine` | drives the Rust engine, its stills, and the voice-over with its settings | 8 |
| `cli-serve` | the local server for play and plan | 2 |
| `cli-validate` | the storyboard checks and their suggestions | 27 |
| `cli-workspace` | the CLI's on-disk state and content: runs, processes, pruning, updates, skill install, snippets, change maps, images and plans | 13 |
| `core-api` | Project, build_frame and render_frame, and the rasterizer | 2 |
| `core-draw` | display list, icons, diagram paths, board look, fonts, text fitting, colours, easing, the palette, and step light and motion | 10 |
| `core-scenes` | one module per scene type behind one registry, with the chrome every scene shares | 66 |
| `core-script` | the props model, timing, markup, speech, focus and chapters | 6 |
| `core-steps` | what a step's focus names, how steps change a scene, pen marks, ink and the camera | 8 |
| `dizione` | English text to tiny-voca phoneme tokens | 13 |
| `engine-cli` | mr-cast-engine commands (render, still, sheet, probe, voice) and the MP4 encoder | 8 |
| `engine-wasm` | the browser player's renderer, core behind wasm-bindgen | 1 |
| `fit` | the places text goes: slots, shell box, callout and source fit | 5 |
| `layout` | the TS scene layouts validate runs (the fit report is mapped to fit until it moves) | 29 |
| `shared` | storyboard semantics both runtimes run: timing, steps, targets, textfit, normalize | 75 |
| `tests` | the node test suites and the Rust fixture tests against the JS | 77 |
| `tooling` | repo scripts, vite config, index.html, the agent verify skill, the evaluation harness and the example generators | 72 |
| `types` | the storyboard schema and the palette and frame tokens | 2 |
| `web-app` | the page shell, the panels and the canvas player with its timeline | 12 |
| `web-engine` | syntax colours handed to the engine | 4 |

## What driftwall cannot see

- Files in languages it does not read: none.
- References it saw but could not turn into dependencies: dynamic-specifier 45, embed-non-source 23, alias-target-missing 1, file-reference-missing 7 (`driftwall brief` lists each one).
- Anything that is not an import: subprocess calls, file paths in strings, network calls, and the
  rules listed under "Not expressible yet" in the contract.

## Use it

```sh
driftwall lint --contract architecture.mmd            # violations, exit 1 if any
driftwall where <file> --contract architecture.mmd    # which component owns a file
driftwall neighbors <component> --contract architecture.mmd
```

Fix a violation by changing the code, or, if the design should change, by editing the contract in
review. Add `driftwall lint --contract architecture.mmd` to CI once the violations are fixed
or accepted.
