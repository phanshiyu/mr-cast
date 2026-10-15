# mr-cast verification map

This directory is the maintained source for verifying mr-cast's user-facing behavior. Read this index, then use the matching feature file as the recipe. Commands assume the two setup lines from `../SKILL.md` ran in the same shell call (`V`, `RUN`, and `eval "$($V env $RUN)"`).

## Baseline preconditions

- `$V launch $RUN` printed `verify: ready`, and `$V doctor $RUN` printed no `FAIL`.
- `$DEMO` is the demo repo from `scripts/demo.sh`: branch `feature/rate-limit`, one commit ahead of `main`, hunks `h1`-`h6` identical to `examples/demo/hunks.json`.
- `CLAUDE_CONFIG_DIR` is `$RUN/work/claude`, never `~/.claude`. `MR_CAST_NO_UPDATE_CHECK=1` unless a recipe says otherwise.
- Each recipe starts from a fresh `$RUN` or from the state the previous step of the same recipe left.
- Never drive a player this run did not start, and never point a command at `examples/` or the real `~/.cache/mr-cast` for deletion.

## Driving conventions

- Run CLI actions through `$V mrc $RUN <label> -- <args>`, so every command leaves a transcript in `$EV/<label>.txt`.
- Run player actions through `$V play-start` and `$V browse`. Prefer visible text as the handle: the `h1` storyboard title, chapter names in the `Chapters` list, the `Play with voice-over` poster, and `Could not load <file>` errors.
- Write stills and videos into `$EV` with `--out`.
- Treat quoted strings in the recipes as exact output to look for.

## Proof and skip reporting

- CLI proof is the transcript (command, stdout, stderr, exit code) plus the files the command wrote.
- Visual proof is a PNG you opened with the Read tool, with the scene or page identity visible (chapter label, title).
- Video proof is `$V probe` output (duration, h264 1920x1080, an aac stream when voiced) plus one `$V frame` PNG you opened.
- Record the feature ID and entry point with each artifact. Report an unreachable entry point as skipped, with the command and the unmet precondition.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify.sh`, `Gotchas`. The driving section starts with `Preconditions:` and pairs each user action with an exact command and its observable result.

## Features

- [Diff walkthrough](./diff-walkthrough.md) covers extract, validate, outline, still, voice and render on a branch diff, named runs, `--working`, and the gallery of scene types.
- [Simple style and snippets](./simple-mode.md) covers `extract --simple`, line-by-line `steps`, snippets beside a diff, and the simple-style checks.
- [Explain mode](./explain-mode.md) covers `explain init/snippet/validate/outline/still/render`, the current explanation, and explanations outside a git repo.
- [Diagram nodes and focus](./diagrams.md) covers icons, captions, change and key marks on nodes, arch edges, layouts and groups, focus steps on every diagram, their validation hints, and 0.10 storyboards.
- [Browser player](./player.md) covers `play`: serving, chapter navigation, live reload, voiced poster, port fallback, the Host check and load errors.
- [Skills and upkeep](./skills-and-upkeep.md) covers `install-skill`, the version-change refresh, `uninstall-skill`, `prune`, `upgrade` and the update notice.
