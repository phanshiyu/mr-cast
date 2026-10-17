# 22. Render the examples on six runners, and keep the release a draft until all finish

- Status: Accepted; amended 2026-10-18 (see Amendment: recovery, a read-only render, and its own concurrency)
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

## Amendment: recovery, a read-only render, and its own concurrency

- Date: 2026-10-18
- Supersedes: in the Decision above, each shard uploading its own videos and the `undraft` job; and the workflow-wide
  `publish` concurrency group

Review of the first version of this workflow found three problems:

- **"Re-run all jobs" after a failed shard left the release a draft and the run green.** On the rerun the version
  was already on npm, so `publish` reported nothing published, and `release`, the shards and `undraft` were skipped.
- **The render job held `contents: write`** while it installed dependencies, built the player and ran the
  repository's render script, so any code in that path could write to the repository.
- **One `publish` concurrency group covered the whole workflow**, so a version bump waited behind the previous
  version's hour of renders before npm saw it.

Decision:

- **A run renders when it published the version, was started by hand, or finds the version's release still a
  draft.** The `release` job, which can see drafts, decides and passes `render` to the later jobs. "Re-run all
  jobs", the next push to `main`, or a run started by hand therefore finishes a draft that a failed run left.
- **Rendering and publishing are split by permission.** The six `render` shards run with `contents: read` and
  upload their MP4s as workflow artifacts, `media-1` to `media-6`. One `upload` job, with `contents: write` and no
  checkout, downloads them, fails while any shard has none, attaches them with `gh release upload --clobber`, and
  publishes the draft as the latest.
- **Concurrency is per job.** `publish` alone is in the `publish` group. `release` and `upload` share a
  `release-v<version>` group, so two runs for one version never attach or publish at once, and renders hold no
  group at all.

Consequences:

- A failed shard now attaches no videos at all, where before the draft held the other shards' videos. The draft is
  never published, so the links keep serving the previous release either way.
- Recovery is "Re-run all jobs" on the failed run. "Re-run failed jobs" reruns the failed shard and the upload job;
  if the upload job finds a shard without videos, it fails and says to re-run all jobs.
- The videos pass through workflow artifacts kept for three days, which costs one download of about the size of
  the release's assets.
