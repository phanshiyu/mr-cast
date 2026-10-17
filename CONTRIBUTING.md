# Contributing to mr-cast

Bug reports, fixes and new scene types are welcome. This page shows how to set up a clone, run the checks, and get a change released.

## Report a bug or ask for a feature

Open an issue with the bug report or feature request form. For a bug, include the output of `mr-cast --version` and the command that failed. If the bug is in a video, attach the `storyboard.json` and a still from `mr-cast still`.

To report a vulnerability, do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Set up a clone

You need Node 22.12 or newer and [pnpm](https://pnpm.io). `corepack enable` provides the pnpm version pinned in `package.json`.

```bash
git clone https://github.com/phanshiyu/mr-cast.git
cd mr-cast
corepack enable
pnpm install
pnpm build              # prebuilds the player into dist/
pnpm install-skill      # points the Claude Code skills at this clone
```

`pnpm dev` serves the player with the data from `examples/demo`, or from the directory in `MR_CAST_DATA_DIR` when that is set.

## Run the checks

| Command | What it checks |
| --- | --- |
| `pnpm test` | The unit tests in `test/`. |
| `pnpm typecheck` | The TypeScript types, and `scripts/check-text.mjs`, which fails on text clipping or an ellipsis under `src/`. |
| `pnpm build` | The player build. |
| `pnpm validate:examples` | `mr-cast validate` on every storyboard under `examples/`. |

CI runs all of them on every push and pull request, with the unit tests on Node 22, 24 and 26. It also runs `pnpm audit`, a render, voice and player smoke test on Linux (`scripts/smoke.sh`), and an npm install of the packed tarball. The `ci-ok` check passes only when every job passes.

Run every `mr-cast` command in tests and experiments with a temporary `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `CLAUDE_CONFIG_DIR`, so nothing touches your own `~/.config/mr-cast`, `~/.cache/mr-cast` or `~/.claude`. `quality/shim.sh` does this.

## Find your way around

- `bin/` holds the CLI. `bin/mr-cast.mjs` parses the commands. In `bin/lib/`, `diff.mjs` parses unified diffs, `explain.mjs` turns source line ranges into snippets, `server.mjs` serves the player, `render.mjs` wraps the Remotion renderer, and `voice.mjs` makes the voice-over. `runs.mjs` finds a command's run, `settings.mjs` turns flags into settings, `lock.mjs` guards shared cache downloads, and `prune.mjs` lists and deletes artifacts. The `validate*.mjs` files hold the storyboard checks.
- `src/` holds the player. `types.ts` is the storyboard schema. `Walkthrough.tsx` is the Remotion composition, `components/` holds the scenes, and `App.tsx` is the browser shell with chapters and the subtitle bar.
- `shared/` holds code that the CLI and the player both run. `timing.mjs` computes scene durations, `steps.mjs` lists the steps each scene type speaks, `targets.mjs` lists what a `focus` can name, and `normalize.mjs` rewrites older field names where a storyboard enters.
- `shared/textfit.mjs` wraps and shrinks text using the widths in `shared/font-metrics.mjs`, which `node scripts/measure-fonts.mjs` generates. Each scene fits its text in layout code under `src/utils/`, against the places listed in `src/fit/slots.ts`. `src/fit/report.ts` runs the same layouts for `validate`.
- `skill/` holds the skill templates that `mr-cast install-skill` fills in (`bin/lib/install-skill.mjs`).
- `examples/` holds storyboards that CI validates. `quality/` holds the evaluation scripts.
- `docs/adr/` records the big design decisions and why they were made.

## Make a change

1. Branch from `main`.
2. Make the change, with a test for new behavior.
3. If the change is a big design decision, record it as an ADR in `docs/adr/` with the change. Supersede an accepted ADR instead of editing it. See [the ADR index](docs/adr/README.md).
4. Run the checks, then open a pull request.

Keep commits small, with a plain-prose subject. Never commit an MP4. Stills and storyboards are fine.

## Releases

CI publishes to npm, from `.github/workflows/publish.yml`. When CI passes on `main` and `package.json` holds a version that npm does not have yet, the workflow publishes it. To release, bump `version` in `package.json` and add that version's section to [CHANGELOG.md](CHANGELOG.md), in one commit on `main`. Never run `npm publish` locally. [ADR 12](docs/adr/0012-publish-from-ci.md) says why.

### Example videos and stills

Every example under `examples/` has a still and a video. Commit the stills: render them with `mr-cast still` and keep them beside the storyboard. Do not commit the videos. After each publish, the `media` job in `.github/workflows/publish.yml` runs `scripts/render-examples.mjs`, which renders every `examples/**/storyboard.json` with the audience its `meta.json` records, split across six runners with `--shard i/6`, and attaches the MP4s to that version's GitHub release. Link a video as `https://github.com/phanshiyu/mr-cast/releases/latest/download/<name>.mp4`, where `<name>` is the example's path under `examples/` with slashes as dashes, such as `primitives-array`. To render them locally, run `node scripts/render-examples.mjs <out dir> [--shard i/n] [--list] [name...]` with the temporary directories above. To render again for the current release, run the Publish workflow by hand. [ADR 21](docs/adr/0021-example-videos-as-release-assets.md) and [ADR 22](docs/adr/0022-shard-the-example-renders.md) say why.
