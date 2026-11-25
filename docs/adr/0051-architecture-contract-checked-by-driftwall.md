# 51. The architecture is a contract that driftwall checks

- Status: Accepted
- Date: 2026-11-26

## Context

mr-cast is about 100k lines across three runtimes: the Node CLI in `bin/`, the browser page in `src/`, and the Rust
engine in `engine/`. CONTRIBUTING's "Find your way around" listed files, but a new contributor could not see the parts,
which way they may depend on each other, or where the three stacks meet. A designed contract (`docs/architecture.mmd`,
22 parts) existed, but nothing ran it. It recorded 31 imports that broke it, from 4 causes, and those are now fixed.

## Decision

- **The contract is `architecture.mmd` at the repository root**, a Mermaid flowchart that
  [driftwall](https://github.com/phanshiyu/driftwall) reads. It nests stack ▸ layer ▸ part: 6 boxes at the top, 22
  parts in all, each labelled with its responsibility and mapped to its files with `%% map` lines.
- **Inside a stack, code imports only downward.** One `%% order` line per stack lists its layers from the top. An
  import across parts needs an arrow, and an arrow that points up a layer is a contract error, so the order cannot be
  silenced by drawing an arrow.
- **The stacks meet in three places, and none of them is an import:** the CLI spawns the engine binary with props JSON,
  the page loads the engine's wasm build through the `mrc-wasm` alias, and esbuild bundles the fit check and the
  highlighter from `src/` into the CLI. The contract's header says so, and its "Not expressible yet" block lists what
  lint cannot see.
- **`pnpm check` runs `pnpm arch`:** `driftwall lint --strict`, and `driftwall render --check` on the generated pictures
  in CONTRIBUTING.md (the 6-box overview) and engine/README.md (the engine's layers). So every commit and CI keeps the
  code, the contract and the pictures in agreement. `pnpm arch:update` redraws the pictures.
- **driftwall is a pinned devDependency**, so CI and every clone use the same version. Its npm package downloads its
  binary in a postinstall script, which `allowBuilds` permits.
- **Claude Code sessions in this repository load the contract and cannot stop while lint fails.** That is driftwall's
  `SessionStart` and `Stop` hooks in `.claude/hooks/`, plus its skill, which says to agree a new arrow with the user
  before drawing it.
- **The fit check stays one stack of its own** (`layout` and `fit`): a TS copy of the engine's layouts that only
  `validate` runs. Whether `validate` should ask the engine instead is a separate decision.

## Consequences

- A change that needs a new dependency between parts changes `architecture.mmd` in the same pull request, where the
  review sees it.
- A new file in `bin/lib/` or `engine/core/src/` fails lint until its part is named in a `%% map` line, because those
  directories hold files of several parts.
- The pictures in the docs cannot go stale, but they are dependency pictures, not data flow. CONTRIBUTING's prose still
  tells how one run moves through the parts.
