# Explain mode

Explain mode animates an explanation instead of a diff. `explain init --title` creates `.mr-cast/explain/<slug>/` and makes it the current explanation. `explain snippet` adds the code to show as `s1`, `s2`, …. The user writes a storyboard whose code scenes point at those snippets. Then `explain validate/outline/voice/play/render/still` work on the current explanation, or on the one named by `--name` or `--dir`.

## Sub-features

- `explain-init` creates the explanation dir from the title's slug, writes `meta.json` with `"mode": "explain"`, prints the dir, and records it in `.mr-cast/explain/.current`.
- `explain-reopen` keeps the storyboard and snippets when the same title is initialised again, unless `--reset`.
- `explain-snippet` adds snippets to the current explanation.
- `explain-validate` checks the storyboard and reports `explain` in its summary.
- `explain-outline`, `explain-still` and `explain-render` work as their diff counterparts, on the explanation's dir.
- `explain-outside-repo` puts `.mr-cast/explain` in the current directory when there is no git repo.
- `explain-errors` names the valid subcommands for an unknown one.

## How to get to it (user POV)

- Run `mr-cast explain init --title "<text>" [--name slug] [--simple] [--reset]`.
- Run `mr-cast explain snippet <file>:<start>-<end>`, then write the storyboard and run `mr-cast explain validate`, and so on.
- Ask Claude Code to "animate that explanation" (the installed `mr-cast-explain` skill), or run `/mr-cast-explain-render`.

## Driving it with verify.sh

Preconditions:

- Baseline from `README.md`.
- The fixture `$REPO/.claude/skills/verify/fixtures/explain-storyboard.json` exists. It explains `src/api/rate-limit.ts` with snippet `s1` = lines 1-20.

- **Init.** Run `$V mrc $RUN explain-init -- explain init --title "How the rate limiter works"`. Exit 0. Stdout is `$DEMO/.mr-cast/explain/how-the-rate-limiter-works`, and stderr has `mr-cast: explanation "how-the-rate-limiter-works"`. Then `cat $DEMO/.mr-cast/explain/.current` prints `how-the-rate-limiter-works`.
- **Snippet.** Run `$V mrc $RUN explain-snippet -- explain snippet src/api/rate-limit.ts:1-20`. Stderr has `mr-cast: using explanation "how-the-rate-limiter-works" (the most recent; …)`. Stdout lists `s1 src/api/rate-limit.ts L1-20`.
- **Storyboard and validate.** Run `cp $REPO/.claude/skills/verify/fixtures/explain-storyboard.json $DEMO/.mr-cast/explain/how-the-rate-limiter-works/storyboard.json && $V mrc $RUN explain-validate -- explain validate`. Exit 0 and `✓ storyboard ok · 3 scenes · 0:36 · explain`.
- **Outline.** Run `$V mrc $RUN explain-outline -- explain outline`. It lists `1. intent    The idea`, `2. sequence  Who calls whom` and `3. code      The limiter     s1 src/api/rate-limit.ts · lines 11-12, 13, 14-17`.
- **Still.** Run `$V mrc $RUN explain-still -- explain still 2 --out $EV/explain-stills`. Open `scene-03-code.png`. It shows `THE LIMITER`, a `SOURCE` badge (not `ADDED`), `src/api/rate-limit.ts` with lines 14-17 highlighted, and the callout `The key changes every window, so old counters simply expire.`
- **Render.** Run `$V mrc $RUN explain-render -- explain render --no-voice --out $EV/explain.mp4`. `$V probe` shows h264 1920x1080 and a duration near 36 s.
- **Reopen.** Run `$V mrc $RUN explain-reinit -- explain init --title "How the rate limiter works"`. Stderr has `note: kept existing storyboard "How the rate limiter works" and 1 snippet`.
- **Outside a repo.** Run `mkdir -p $RUN/work/norepo && $V mrc $RUN explain-norepo --cwd $RUN/work/norepo -- explain init --title "Outside a repo"`. Stdout is `$RUN/work/norepo/.mr-cast/explain/outside-a-repo`.
- **Unknown subcommand.** Run `$V mrc $RUN explain-bogus -- explain bogus`. Exit 1 and `mr-cast: explain needs one of init, snippet, validate, outline, voice, play, render, still (got "bogus")`.

## Gotchas

- The "outside a repo" check only holds if `$RUN` is not inside a git work tree. Check with `git -C $RUN rev-parse --show-toplevel`, which should fail. If it succeeds, the explanation lands in that repo's `.mr-cast`.
- A new `--title` with a slug already taken by a different explanation gets a numbered suffix (`-2`). The same title reopens the existing one.
- Code scenes in an explanation must use snippet ids. A diff hunk id like `h2` fails validation, because the explanation's `hunks.json` holds only snippets.
- `explain init` in a dir that holds a diff walkthrough refuses with `holds a diff walkthrough`. Use another `--name` or `--dir`.
