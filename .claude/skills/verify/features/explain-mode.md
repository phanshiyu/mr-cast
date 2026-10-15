# Explanations

An explanation is a run with no diff. `init --title` creates `.mr-cast/<title-slug>/` and makes it the current run. `snippet` adds the code to show as `s1`, `s2`, …. The user writes a storyboard whose code scenes point at those snippets. Then `validate`, `outline`, `voice`, `play`, `render` and `still` work on it as on a branch's run, because they work on the current run. 0.11's `explain <command>` still works as a hidden alias.

## Sub-features

- `init` creates the run dir from the title's slug, writes `meta.json` with `"mode": "explain"`, prints the dir, and records it in `.mr-cast/.current`.
- `init-reopen` keeps the storyboard and snippets when the same title is initialised again, unless `--reset`.
- `snippet` adds snippets to the current run.
- `validate` checks the storyboard and reports `explain` in its summary.
- `outline`, `still` and `render` work as for a branch's run.
- `init-outside-repo` puts `.mr-cast/` in the current directory when there is no git repo.
- `explain-alias` runs `explain init`, `explain validate` and the rest as the plain commands, and names `init` for an unknown one.
- `older-data` reaches a 0.11 explanation in `.mr-cast/explain/<name>` with `--dir`, and a missing run points at it.

## How to get to it (user POV)

- Run `mr-cast init --title "<text>" [--name slug] [--audience a] [--reset]`.
- Run `mr-cast snippet <file>:<start>-<end>`, then write the storyboard and run `mr-cast validate`, and so on.
- Ask Claude Code to "animate that" after it explains something, or run `/mr-cast` on a branch with no changes (the installed `mr-cast` skill).

## Driving it with verify.sh

Preconditions:

- Baseline from `README.md`.
- The fixture `$REPO/.claude/skills/verify/fixtures/explain-storyboard.json` exists. It explains `src/api/rate-limit.ts` with snippet `s1` = lines 1-20.

- **Init.** Run `$V mrc $RUN init -- init --title "How the rate limiter works"`. Exit 0. Stdout is `$DEMO/.mr-cast/how-the-rate-limiter-works`, and stderr has `mr-cast: run "how-the-rate-limiter-works" in .mr-cast/how-the-rate-limiter-works; later commands use it until the next extract or init`. Then `cat $DEMO/.mr-cast/.current` prints `how-the-rate-limiter-works`.
- **Snippet.** Run `$V mrc $RUN snippet -- snippet src/api/rate-limit.ts:1-20`. Stderr has `mr-cast: using run "how-the-rate-limiter-works" (the most recent; pass --name to pick another)`. Stdout lists `s1 src/api/rate-limit.ts L1-20`.
- **Storyboard and validate.** Run `cp $REPO/.claude/skills/verify/fixtures/explain-storyboard.json $DEMO/.mr-cast/how-the-rate-limiter-works/storyboard.json && $V mrc $RUN explain-validate -- validate`. Exit 0 and `✓ storyboard ok · 3 scenes · 0:48 · explain`.
- **Outline.** Run `$V mrc $RUN explain-outline -- outline`. It lists `1. intent    The idea`, `2. sequence  Who calls whom` and `3. code      The limiter     s1 src/api/rate-limit.ts · lines 11-12, 13, 14-17`.
- **Still.** Run `$V mrc $RUN explain-still -- still 2 --out $EV/explain-stills`. Open `scene-03-code.png`. It shows `THE LIMITER`, a `SOURCE` badge (not `NEW`), `src/api/rate-limit.ts` with lines 14-17 highlighted, and the callout `The key changes every window, so old counters simply expire.`
- **Render.** Run `$V mrc $RUN explain-render -- render --no-voice --out $EV/explain.mp4`. `$V probe` shows h264 1920x1080 and a duration near 48 s.
- **Reopen.** Run `$V mrc $RUN reinit -- init --title "How the rate limiter works"`. Stderr has `note: kept existing storyboard "How the rate limiter works" and 1 snippet`.
- **Alias.** Run `$V mrc $RUN alias-validate -- explain validate`. The same `✓ storyboard ok · 3 scenes · … · explain` as **Storyboard and validate**. Run `$V mrc $RUN explain-bogus -- explain bogus`. Exit 1 and ``mr-cast: unknown command "explain bogus"; `mr-cast init` starts an explanation and the other commands work on it, see `mr-cast help` ``.
- **Older data.** Lay out a 0.11 explanation and reach it. Run `mkdir -p $RUN/work/old/.mr-cast/explain/old-one && cp $DEMO/.mr-cast/how-the-rate-limiter-works/{hunks,meta,storyboard}.json $RUN/work/old/.mr-cast/explain/old-one/ && $V mrc $RUN old-missing --cwd $RUN/work/old -- validate`. Exit 1 with `mr-cast: no current run; start one with \`mr-cast extract\` or \`mr-cast init --title "..."\`; walkthroughs from mr-cast 0.11 or earlier: --dir .mr-cast/explain/old-one`. Then `$V mrc $RUN old-dir --cwd $RUN/work/old -- validate --dir .mr-cast/explain/old-one` exits 0 with `· explain`.
- **Outside a repo.** Run `mkdir -p $RUN/work/norepo && $V mrc $RUN init-norepo --cwd $RUN/work/norepo -- init --title "Outside a repo"`. Stdout is `$RUN/work/norepo/.mr-cast/outside-a-repo`.

## Gotchas

- The "outside a repo" and "older data" checks only hold if `$RUN` is not inside a git work tree. Check with `git -C $RUN rev-parse --show-toplevel`, which should fail. If it succeeds, the run lands in that repo's `.mr-cast`.
- A new `--title` with a slug already taken by another run gets a numbered suffix (`-2`). The same title reopens the existing explanation.
- Code scenes in an explanation must use snippet ids. A diff hunk id like `h2` fails validation, because the explanation's `hunks.json` holds only snippets.
- `init --name x` refuses when `.mr-cast/x` holds a branch's walkthrough, with `holds a branch walkthrough`. `extract --name x` refuses an explanation the same way.
- `init` and `extract` both move `.current`. After this recipe, commands without `--name` act on the explanation, not on `feature-rate-limit`.
