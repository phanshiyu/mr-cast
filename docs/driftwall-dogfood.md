# driftwall dogfood: mr-cast

This project was used to test [driftwall](https://github.com/phanshiyu/driftwall), a linter that
fails the build when code drifts from an architecture diagram. `docs/architecture.mmd` is the
diagram `driftwall init` derived from this repository's code with no hand-written input: one node
per architectural unit, one edge per dependency it found in the source. An independent review
agent then checked the result against the code. This page records what it found.

- driftwall commit `f14a200` (binary `driftwall-r5`), reviewed 2026-11-23.
- The `.arch` tag files `init` writes are not committed; the diagram is a snapshot, not yet an
  enforced contract. See [Reproduce](#reproduce) to regenerate it or adopt it.

## Verdict

**Satisfactory** after 4 review rounds (rounds 1 to 3 unsatisfactory, round 4 satisfactory).

- Precision and recall: 551 of 551 JS/TS/HTML/CSS cross-node import sites in both directions, plus
  Rust `use` paths sampled by hand; 1,666 sites in total.
- Granularity: 74 nodes, one per Rust module of the engine crates and per web module or directory.
- Earlier rounds found: the engine as one 118-file node; imports of the generated
  `shared/world/ne-*.mjs` reported as missing; the Vite alias `mrc-wasm` reported as a missing
  package; JSDoc `import()` types unread. All fixed in driftwall.

## Observations for this project

- The web app reaches the Rust engine only through `mrc-wasm` (`src/player/CanvasPlayer.tsx:5`),
  an alias to `engine/wasm/pkg`, the git-ignored wasm-pack output. driftwall shows it as
  `alias-target-missing`; the edge appears once the package is built.
- Cycles: `fit` ↔ `utils` (runtime both ways), `engine-core-scenes` ↔ `states`,
  `engine-core-scenes` ↔ `targets`, `engine-core-camera` ↔ `marks`.
- `engine-core-scenes` depends on 21 other modules.
- `scripts/engine-dump.mjs` bundles `src/fit`, `src/engine` and `shared` from an esbuild stdin
  template; tests reach `src/utils` only by bundling it. No static tool can see those dependencies.

## Measured

| | |
|---|---|
| Nodes | 74 |
| Edges | 209 |
| Source files mapped | 449 |
| Import sites behind the edges | 1697 (runtime 1613, type-only 78, asset 6; 219 test-only) |
| init + lint + brief wall time | 2 s |
| Files driftwall cannot read | none |
| Files excluded (generated, vendored, minified) | generated 3 |
| Files ignored by `.driftwallignore` | 0 |
| Skipped references (visible, not edges) | dynamic-specifier 45, embed-non-source 23, file-reference-missing 7, alias-target-missing 1 |
| Unresolved imports | 0 |

## Structure facts computed from the graph

- Highest fan-out: `engine-core-scenes` (21), `engine-core-chrome` (13), `engine-core-marks` (11), `engine-dizione-engine` (11), `engine-cli-main` (10).
- Highest fan-in: `engine-core-timing` (14), `shared` (12), `engine-core-color` (11), `engine-core-display` (10), `engine-core-model` (10).
- Dependency cycles through production code (runtime, asset or embed imports outside tests):
  - `engine-core-arrays` ↔ `engine-core-chrome` ↔ `engine-core-scenes` ↔ `engine-core-states` ↔ `engine-core-targets`
  - `engine-core-camera` ↔ `engine-core-marks`
  - `src-fit` ↔ `src-utils`

## Skipped references

References driftwall saw but did not turn into edges, with the reason. First five per reason;
`driftwall brief --format json` lists all of them.

- **alias-target-missing** (1):
  - `src/player/CanvasPlayer.tsx:5` `mrc-wasm`
- **dynamic-specifier** (45):
  - `.claude/skills/verify/scripts/sync-check.mjs:26` `path.join(REPO, 'shared/timing.mjs')`
  - `.claude/skills/verify/scripts/sync-check.mjs:30` `path.join(REPO, 'shared/steps.mjs')`
  - `.claude/skills/verify/scripts/sync-check.mjs:39` `path.join(REPO, 'shared/normalize.mjs')`
  - `.claude/skills/verify/scripts/sync-check.mjs:63` `pathToFileURL(fromRepo.resolve('sharp')).href`
  - `bin/lib/engine.mjs:106` ``data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString(`
- **embed-non-source** (23):
  - `engine/cli/src/voice.rs:497` `../tests/fixtures/voice-splits.json`
  - `engine/core/src/icons.rs:78` `../data/lucide.json`
  - `engine/core/src/scenes/map/mod.rs:112` `../../../data/world-110m.json`
  - `engine/core/src/scenes/map/mod.rs:114` `../../../data/world-50m.json`
  - `engine/core/src/text.rs:37` `../../assets/fonts/inter-latin.ttf`
- **file-reference-missing** (7):
  - `test/code-typing.test.mjs:20` `../examples/primitives/code-typing/`
  - `test/install-skill.test.mjs:14` `..`
  - `test/intent-alias.test.mjs:7` `..`
  - `test/map-scene.test.mjs:239` `..`
  - `test/primitives.test.mjs:8` `..`

## Reproduce

```sh
# install driftwall, then from the repository root:
driftwall init . --contract docs/architecture.mmd   # writes .arch tags and the diagram
driftwall lint --contract docs/architecture.mmd     # exit 0: code matches the diagram
driftwall brief --contract docs/architecture.mmd    # nodes, edges, blind spots
driftwall neighbors <node> --contract docs/architecture.mmd
```

To enforce the diagram, commit the `.arch` files, edit `docs/architecture.mmd` into the
architecture you intend (drop edges you consider violations, group nodes into subgraphs), and run
`driftwall lint --strict --contract docs/architecture.mmd` in CI.
