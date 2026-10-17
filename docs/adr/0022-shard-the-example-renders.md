# 22. Render the examples on six runners, and keep the release a draft until all finish

- Status: Accepted
- Date: 2026-10-18
- Supersedes: parts of 0021 (the single `media` job, and when the release is created and published)

## Context

ADR 0021 renders every example in one `media` job. By 0.26 there are 38 examples, and a voiced render takes about two
minutes each, so one runner needs well over an hour. Two of them, `examples/preread` and `examples/primitives/reading`,
must render with `--audience preread`; `scripts/render-examples.mjs` knew that from a table of names, and the scene
gallery linked videos as `<type>.mp4` while the script names them `primitives-<type>.mp4`.

## Decision

- **An example's flags come from its meta.json.** `scripts/lib/examples.mjs` finds every example, names it by its path
  with slashes as dashes, and passes `--audience <a>` when its `meta.json` records one. `render-examples.mjs`,
  `validate-examples.mjs` and `gallery.mjs` use it, so no script holds a list of names. `examples/preread` gains a
  `meta.json` for this.
- **Every doc links the script's names**, such as `primitives-array.mp4` and `algorithms-dijkstra.mp4`.
- **Six shards.** `render-examples.mjs --shard i/n` deals the examples, longest spoken text first, to the group with
  the fewest words so far, and renders group `i`. The `media` job is a matrix of six shards with `fail-fast: false`;
  each uploads its own videos with `--clobber`.
- **The release opens as a draft before any shard runs and is published after all of them.** A `release` job creates
  the draft when the tag has no release. An `undraft` job, which needs every shard, publishes it as the latest. When a
  shard fails, the release stays a draft holding the other shards' videos, and the links keep serving the previous
  release until a rerun of the failed shard succeeds.

## Consequences

- The media stage takes about as long as its longest shard, roughly a sixth of the single job.
- A release made by hand for the tag before the run is already published, so it shows videos as each shard attaches
  them, as before.
- Six runners each install dependencies, restore the Chrome and voice caches and build the player.
- A new example renders with the right audience once its `meta.json` says so, with no script to edit.

## Alternatives considered

- **Shard by index** (every sixth example). Simpler, but the long examples (Bitcoin, GPT, H3, OAuth, React) clustered
  on two runners in sorted order.
- **One job per example.** 38 runners each paying the setup cost, for a stage only a few minutes shorter.
