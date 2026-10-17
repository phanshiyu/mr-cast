# 21. Example videos are rendered in CI and attached to the GitHub release

- Status: Accepted
- Date: 2026-10-17

## Context

Every scene type and every example should have a video and an image that a reader can open from GitHub. The repo
never commits an MP4: videos are large, change on every render, and would bloat every clone. Stills are small and
review well in a diff.

## Decision

- Authors commit the stills (PNGs from `mr-cast still`) beside the storyboards.
- CI renders the videos. `scripts/render-examples.mjs <out dir>` finds every `examples/**/storyboard.json`, renders a
  copy of each with voice, and writes `<out dir>/<name>.mp4`. `<name>` is the path under `examples/` with slashes as
  dashes (`examples/primitives/array` is `primitives-array.mp4`), because release assets are flat.
- The `media` job in `.github/workflows/publish.yml` runs after the `publish` job publishes a new version, and on every
  manual run. It renders every example and uploads the MP4s to the GitHub release `v<version>` with `GITHUB_TOKEN`
  (`contents: write`), replacing assets of the same name. When the release does not exist it creates it as a draft,
  and publishes it as the latest release only once the videos are attached.
- Docs link a video as `https://github.com/phanshiyu/mr-cast/releases/latest/download/<name>.mp4`.
- The job's permissions are separate from the `publish` job's: it has no `id-token` and does not run in the `prod`
  environment.

## Consequences

Good:
- No MP4 enters git history, and every published version has videos rendered from its own code.
- A link always shows the newest release's rendering of the example.

Bad:
- A link 404s until the first release with that example's video is published. A new example has no video until the
  next release, or a manual run of the workflow.
- One example that fails to render fails the job before anything is uploaded. The job then creates no release, so the
  links keep serving the previous release's videos until a manual run succeeds. A release someone made by hand for
  that tag is already latest, and has no videos until then.
- Rendering every example with voice lengthens the release run, and grows with every example added.
- The latest/download link cannot point at an older version's video.

## Alternatives considered

- Commit the MP4s, or keep them in Git LFS: breaks the repo rule, and LFS has bandwidth quotas.
- Upload them as workflow artifacts: they expire and need a signed-in user to download.
- Host them on a separate branch or GitHub Pages: still puts the videos in git history.
