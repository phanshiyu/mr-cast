---
name: verify
description: Drive mr-cast (the CLI that turns a git diff or an explanation into an animated Remotion walkthrough) the way a user does, and capture proof. Covers the CLI in a demo git repo (status, extract, init, snippet, validate, outline, voice, still, render, settings flags, prune, upgrade, install-skill), the browser player that `play` serves, and the Claude Code skills it installs. Use to prove a change to mr-cast works before calling it done, to reproduce a bug, or when asked to run, render or screenshot mr-cast.
---

# Verify mr-cast

mr-cast is a CLI. A user runs `bin/mr-cast` inside a git repo, writes a storyboard JSON, and gets PNG stills, an MP4, or a live browser player. Three surfaces:

- **CLI** (primary). `bin/mr-cast` is a bash launcher that finds Node 22.12 or newer and runs `bin/mr-cast.mjs`. Each walkthrough is a run in `<repo>/.mr-cast/<name>/`. `extract` names it after the branch (`feature-rate-limit` in the demo), `init` after the title, and later commands work on the current run in `.mr-cast/.current`.
- **Browser player.** `mr-cast play` serves the built player (`dist/`) and the run's data on `127.0.0.1:4747`, or the next free port.
- **Installed Claude Code skills.** `install-skill` writes the `mr-cast` skill (with `references/`), `mr-cast-prune` and `mr-cast-upgrade` into `$CLAUDE_CONFIG_DIR` (default `~/.claude`) with a manifest.

Everything goes through one harness, `scripts/verify.sh`, plus `scripts/browse.mjs` for the player. The feature map in [`features/README.md`](features/README.md) holds one recipe per feature. Read it before you drive anything.

## Setup for every shell call

Each Bash call starts a fresh shell, so start each one with these two lines. Pick `RUN` once per verification. Use a new absolute path under your session scratchpad (for example `<scratchpad>/mr-cast-verify-player-1`), or `$(mktemp -d)`. Never share a `RUN` with another agent.

```bash
V=<mr-cast checkout>/.claude/skills/verify/scripts/verify.sh; RUN=<your run dir>
eval "$($V env $RUN)"   # sets PATH to a real Node 22.12+, MR_CAST_NO_UPDATE_CHECK=1, CLAUDE_CONFIG_DIR=$RUN/work/claude, XDG_CONFIG_HOME=$RUN/work/config, and $EV $DEMO $MRC $REPO $V
```

Use the checkout you are verifying (a worktree verifies its own code), for example `~/projects/mr-cast`.

## Launch

```bash
$V launch $RUN
```

It prints `verify: ready run=<run> repo=<run>/work/repo evidence=<run>/evidence` when usable. Launch is idempotent. It does three things:

1. It creates the demo repo with `scripts/demo.sh`. The repo is on branch `feature/rate-limit`, one commit ahead of `main`, with 6 files changed (an add, a modify, a rename, a delete). `extract` on it reproduces `examples/demo/hunks.json` byte for byte, so the storyboards in `examples/demo` and `examples/demo-simple` validate against it.
2. It creates `$RUN/evidence` and the run's own `CLAUDE_CONFIG_DIR`.
3. It builds `dist/` with vite if `dist/index.html` is missing. The checkout needs `pnpm install` first (pnpm is pinned in `package.json`; `corepack enable` provides it).

There is no server to keep alive for the CLI. The player is started per recipe with `play-start` (see Drive).

First use on a fresh machine downloads Chrome Headless Shell (about 580 MB) and the Kitten voice model (about 82 MB; Kokoro, about 90 MB, only for a kokoro voice) into `~/.cache/mr-cast` on the first `still`/`render`/`voice`. Doctor reports whether they are already there.

## Doctor

```bash
$V doctor $RUN
```

It is read-only and exits 1 on any `FAIL`. It checks five things: the launcher runs Node 22.12 or newer, `dist/index.html` exists, the demo repo is on `feature/rate-limit` one commit ahead of `main`, the evidence dir exists, and Chrome Headless Shell, the voice model and ffprobe are present. It also checks that every player this run started still owns its port. Run it first, and again whenever something looks off.

## Drive

| What | Command |
| --- | --- |
| Run the CLI as a user, with a transcript | `$V mrc $RUN <label> -- <mr-cast args>` runs in `$DEMO`. It writes `$EV/<label>.txt` (the command, stdout, stderr and `--- exit N`), echoes the output, and exits with the CLI's code. Add `--cwd <dir under $RUN>` before `--` to run elsewhere, for example outside any git repo. |
| Start the player | `URL=$($V play-start $RUN <label> --no-voice [--port N] [--name x \| --dir d])` starts `mr-cast play --no-open` on the current run in the background and prints `http://127.0.0.1:<port>` once it serves. The URL with the plan's write token is in `$RUN/work/play/<label>.token-url`. |
| Start the plan page | `PURL=$($V plan-start $RUN <label>)` starts `mr-cast plan --no-open` and prints its URL with the token, `http://127.0.0.1:<port>/plan#token=<hex>`. Stop it with `play-stop`. |
| Drive the player | `$V browse $RUN <label> "$URL/" wait:<text> press:ArrowRight shot:<name> ...` writes `$EV/<label>/<name>.png`, `$EV/<label>/<name>.txt` (visible page text) and `$EV/<label>/console.txt`. Steps are `wait:`, `click:`, `press:`, `sleep:`, `run:` and `shot:`, documented at the top of `scripts/browse.mjs`. |
| Stop the player | `$V play-stop $RUN [label]` copies its stdout and stderr to `$EV/play-<label>.*.txt`. |
| Inspect a video | `$V probe <mp4>` prints duration and streams. `$V frame <mp4> <seconds> <out.png>` extracts one frame. |

Put render and still output straight into evidence with `--out`, for example `$V mrc $RUN still -- still 0 5 --out $EV/stills`. Otherwise it lands in the run's directory under `$DEMO/.mr-cast`, which cleanup deletes.

Fixtures:

- **`examples/demo/storyboard.json`.** Copy it into `$DEMO/.mr-cast/feature-rate-limit/` after `extract`. It has 9 scenes (intent, graph, sequence, flow, er, 3 code, tests).
- **`examples/demo-simple/storyboard.json`.** Use it after `extract --simple` plus `snippet src/db/client.ts:1-5`. It has 13 scenes.
- **`examples/gallery/{hunks,storyboard}.json`.** Copy both into a dir under `$RUN` and use `--dir`. It covers the files, state, flowchart graph, table, chart, timeline, mermaid, compare, terminal, layers, array and memory scenes.
- **`.claude/skills/verify/fixtures/stress/{fits,over}.json`.** Long text in every scene type, and the same with 18 items past their fit, listed in `over.expected.txt`; use them with `examples/demo/hunks.json` (see `features/text-fit.md`).
- **`.claude/skills/verify/fixtures/layers.json`.** Four layers scenes: items with a returning path and no steps, seven layers of five items with pen marks, three bare layers walked in steps, and a middleware chain a cache answers early; use it with an empty `hunks.json` (see `features/diagrams.md`).
- **`.claude/skills/verify/fixtures/sequence-20.json`.** Two 20-message sequences, one walked in steps with a pen mark and one without steps; use it with `examples/demo/hunks.json`.
- **`.claude/skills/verify/fixtures/state-scenes.json`.** A 16-cell binary search with three pointers meeting on one cell and a range that shrinks then hides, a ring buffer whose tail runs past the end, and a linked list in memory with a call frame that comes and goes and a reference back to the first node; use it with a `hunks.json` of `{}` (see `features/diagrams.md`).
- **`.claude/skills/verify/fixtures/plan/{plan,storyboard}.json`.** A five-topic plan of the demo diff (one deep, three brief, one skipped, one with a single view) and the demo storyboard with each scene tagged by topic; use them after `extract` (see `features/plan.md`).
- **`examples/preread/{plan,storyboard}.json` and `.claude/skills/verify/fixtures/preread/plan.json`.** The demo diff as a pre-read, with every hunk in the reading order and its scenes tagged by the two topics of its `plan.json`, and a three-topic plan with no code view for the plan page; use them after `extract` with `--audience preread` on every command (see `features/preread.md`).
- **`examples/review/storyboard.json`.** A reviewed walkthrough of the repository `scripts/review-demo.sh <dir>` creates (branch `feature/password-reset`, a planted bug, risk and nit). Use it after `extract` in that repository (see `features/review-mode.md`).
- **`.claude/skills/verify/fixtures/explain-storyboard.json`.** An explanation of `src/api/rate-limit.ts` (snippet `s1` = lines 1-20).

Never point a command at `examples/` itself. `voice`, `still` and `render` write `audio/`, `stills/` and MP4s into the data dir.

## Evidence

Evidence lives in `$RUN/evidence` and survives cleanup. A proof contains:

- **The user path.** Use the real CLI through the launcher (`$V mrc`) and the real served player through Chrome. Never call `bin/lib/*.mjs` functions directly or set internal state.
- **The action and the resulting state.** Keep the transcript of each command (with its exit code) and the artifact it produced: stills you have looked at, an MP4 with `probe` output and an extracted frame, or a player screenshot with its page text.
- **Side effects.** Check the files written in `$DEMO/.mr-cast/…`, `.git/info/exclude`, the manifest in `$CLAUDE_CONFIG_DIR`, and what `prune` actually deleted. Record them with `ls`/`cat` into a transcript, for example `ls -R $DEMO/.mr-cast > $EV/tree.txt`.
- **Pixels.** Read the PNGs with the Read tool before you claim a visual result. A still that renders the wrong scene still exits 0.
- **Dry runs.** Prove what they skip by observation. `upgrade --check` still fetches from the registry, so point `MR_CAST_REGISTRY` at a local fake (see the skills feature). `--no-voice` produces an MP4 with no audio stream, which `probe` shows.

Report each feature ID with the entry point you used. An entry point you could not reach is reported as skipped, with the command and the reason. Never count it as verified through another path.

## Cleanup

```bash
$V cleanup $RUN
```

It stops every player this run started (by recorded pid, never by process name), deletes `$RUN/work` (the demo repo, its `.mr-cast`, the temp Claude config and any temp cache), and lists what remains in `$RUN/evidence`. `browse.mjs` kills its own Chrome and deletes its profile on exit. Run cleanup after failed attempts too, so no player keeps a port.

## Isolation and safety

- **Runs in parallel.** Each run has its own demo repo and config dir. `play` picks the next free port. Renders share `~/.cache/mr-cast` safely (atomic bundle cache, download locks).
- **Never touch the user's real state.** `~/.claude/.mr-cast-install.json` points at this clone, so any mr-cast command run without a temp `CLAUDE_CONFIG_DIR` can rewrite `~/.claude` skills when versions differ. `extract`, `init` and any command given `--audience`, `--pace` or `--no-voice` write the user's last choices into `$XDG_CONFIG_HOME/mr-cast`. `verify.sh` always sets `CLAUDE_CONFIG_DIR=$RUN/work/claude` and `XDG_CONFIG_HOME=$RUN/work/config`.
- **Never prune the real cache.** `~/.cache/mr-cast` holds Chrome and the voice model that renders need. For prune or upgrade tests, prefix the command with `XDG_CACHE_HOME=$RUN/work/xdg`. `verify.sh mrc` refuses `prune cache:*` unless `XDG_CACHE_HOME` is under `$RUN`.
- **Use only the Node versions the harness picks.** Never call `node` bare in Claude Code's shell, where it is a broken nvm lazy-load function. `eval "$($V env $RUN)"` puts a real Node on PATH. Node 22, 24 (the `.nvmrc` and CI version) and 26 all render; an earlier Node 26 hang no longer reproduces with nvm 26.12 or Homebrew 26.8. The launcher `bin/mr-cast` finds Node on its own.
- **ffmpeg and ffprobe.** They live in the `@remotion/compositor-darwin-arm64` package, which pnpm keeps under `node_modules/.pnpm/` beside `@remotion/renderer`, and need `DYLD_LIBRARY_PATH` set to that dir. `$V probe`, `$V frame` and `sync-check.mjs` resolve it through `@remotion/renderer`.

## Timing (measured on this machine, warm cache)

`still` of 2 scenes takes about 1 s. `render --no-voice` of a 2-scene, 24 s cut takes about 8 s. `voice` for 2 clips takes about 9 s. A full 9-scene demo render with voice takes a few minutes. Prove a render on a cut-down storyboard (see `features/diff-walkthrough.md`) unless full length is the point.

## CI

`.github/workflows/ci.yml` runs typecheck, build, unit tests (`pnpm test`, Node 22, 24 and 26), `pnpm validate:examples`, `pnpm audit`, an npm install of the packed tarball, and `scripts/smoke.sh` on Linux: stills of the gallery and demo, one voiced clip, and the player text scan of `fixtures/stress/fits.json` checked by `text-check.mjs`. Run `scripts/smoke.sh <dir>` locally for the same check. It is a gate, not proof of a feature. Drive the recipes here for that.

## Maintaining this skill

`/maintain-verification-skill` audits the feature map against the source and fixes drift. Add a feature file when a user-facing command or player behavior lands.
