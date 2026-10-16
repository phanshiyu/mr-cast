# Simple style and snippets

Simple style is for a viewer who wants every changed line explained in plain words. `--audience new` (or `--simple`) on a command asks for it, for that command only, so `extract`, `validate`, `outline`, `still` and `render` each need the flag. Every code scene then walks its lines with `steps`, each step with words to say over its lines. `validate` and `outline` say `simple style` and warn when a code scene uses focus ranges or leaves changed lines without a step. `snippet` adds unchanged source, such as a caller or a definition, beside the diff as extra hunks `s1`, `s2`, ….

## Sub-features

- `simple-extract` prints the hunk index with a `style: simple · …` line.
- `simple-steps` renders a code scene step by step with a step diagram beside the code.
- `simple-checks` warns when a code scene uses `focusLinesAfter` or `flow`, or leaves changed lines without a step.
- `snippet-add` adds real source lines as hunk `s1` and prints them with the file's own line numbers.
- `snippet-kept` keeps snippets across a later `extract`.
- `simple-per-command` applies the style only to a command given the flag; the same run without it gets the familiar checks.

## How to get to it (user POV)

- Run `mr-cast extract --audience new` (or `--simple`, or `init --audience new`), and pass the same flag to each later command.
- Run `mr-cast snippet <file>:<start>-<end>` or `mr-cast snippet <file> <start>-<end>`, at most 80 lines each.
- Ask the installed `mr-cast` skill for a video "line by line", "ELI5" or "simple", or answer "Someone new to this code" to its Audience question.

## Driving it with verify.sh

Preconditions:

- Baseline from `README.md`.

- **Extract simple.** Run `$V mrc $RUN extract-simple -- extract --simple --name simple`. Exit 0, and the index ends with `style: simple · …`. `grep -c settings $DEMO/.mr-cast/simple/meta.json` prints `0`.
- **Add a snippet.** Run `$V mrc $RUN snippet -- snippet --name simple src/db/client.ts:1-5`. Exit 0. Stdout prints `s1 src/db/client.ts L1-5 · 5 lines`, the five lines numbered 1-5, and `snippets in .mr-cast/simple/hunks.json: s1 src/db/client.ts L1-5`. Then `cmp $DEMO/.mr-cast/simple/hunks.json $REPO/examples/demo-simple/hunks.json` is silent.
- **Validate simple.** Run `cp $REPO/examples/demo-simple/storyboard.json $DEMO/.mr-cast/simple/ && $V mrc $RUN validate-simple -- validate --name simple --simple`. Exit 0 and `✓ storyboard ok · 13 scenes · … · simple style · shows 5/6 hunks, skipped 1 · tests scene: 0 cases, 4 gaps`.
- **Simple checks.** Replace the steps of the first `h2` code scene with a focus range in a copy, and validate it. Run `mkdir -p $RUN/work/badsimple && cp $DEMO/.mr-cast/simple/{hunks,meta}.json $RUN/work/badsimple/ && (cd $DEMO && node -e 'const s=require("./.mr-cast/simple/storyboard.json");const c=s.scenes.find(x=>x.type==="code"&&x.hunkId==="h2");delete c.steps;c.focusLinesAfter=["11-12"];require("fs").writeFileSync(process.argv[1],JSON.stringify(s))' $RUN/work/badsimple/storyboard.json) && $V mrc $RUN validate-badsimple -- validate --dir $RUN/work/badsimple --simple`. Exit 0, with `warning: scenes[5]: simple style walks the code line by line; replace focusLinesAfter and flow with steps` and a warning that no step covers changed lines of `h2`.
- **Outline.** Run `$V mrc $RUN outline-simple -- outline --name simple --simple`. It lists 13 scenes and ends with `13 scenes · about 7:17 (estimated from word count) · simple style`.
- **Steps still.** Restore the good storyboard and render the snippet scene and a labelled-steps scene. Run `cp $REPO/examples/demo-simple/storyboard.json $DEMO/.mr-cast/simple/ && $V mrc $RUN still-simple -- still 4 6 --name simple --simple --out $EV/simple-stills`. Open both PNGs. `scene-05-code.png` (`WHAT SAVES AN ORDER TODAY`) shows the `s1` snippet `src/db/client.ts` with a `SOURCE` badge and lines 2-3 highlighted. `scene-07-code.png` (`COUNT THE REQUEST`) shows `src/api/rate-limit.ts` with a 3-box step diagram beside the code, ending at step 3 `On the first hit, expire the key after a minute` linked to line 13.
- **Snippet kept.** Re-extract. Run `$V mrc $RUN reextract-simple -- extract --simple --name simple`. Stderr has `note: kept 1 snippet (s1) from the last extract`, and `hunks.json` still has `s1`.
- **Style per command.** Run `$V mrc $RUN reextract-plain -- extract --name simple`. The index has no `style:` line. `$V mrc $RUN validate-plain -- validate --name simple` exits 0 without `simple style` in its verdict.

## Gotchas

- Simple-style rules are warnings, not errors. `validate` exits 0 with them, so assert the warning text, not the exit code.
- A step diagram appears beside the code only when every step has a `label`. The demo's scenes 6 and 9 (`The limiter, part one`, `Wiring it in`) have unlabelled steps and show the code full width.
- Scene indexes for `still` are 0-based. The outline numbers scenes from 1.
- The `s1` id is stable for the same file and range. Adding it again rereads the lines and keeps the id.
- `snippet` paths resolve from the current directory and display relative to the repo root. `$V mrc` runs in `$DEMO`, so `src/db/client.ts` works as written.
