# Diff walkthrough

A user on a feature branch runs `mr-cast extract` to index the branch's diff into hunks, writes `.mr-cast/storyboard.json`, checks it with `validate` and `outline`, previews scenes as PNG stills, and renders an MP4 named after the storyboard title, voiced by Kokoro unless `--no-voice`.

## Sub-features

- `extract-index` writes `.mr-cast/hunks.json` and `meta.json`, prints a hunk index, and adds `.mr-cast/` to `.git/info/exclude`.
- `extract-errors` refuses a branch with no changes and points at `--working` or another base.
- `extract-working` diffs the merge-base against uncommitted changes.
- `extract-keeps-storyboard` keeps an existing storyboard on re-extract and names the hunks that changed.
- `validate` prints `✓ storyboard ok` with scene count, length and coverage, or errors with exit 1.
- `outline` prints the numbered scene plan with length and coverage.
- `still` renders settled end-state PNGs of chosen scenes (0-based).
- `voice` speaks each scene's narration into `audio/*.wav`.
- `render` writes an H.264 1920x1080 MP4, with an AAC track when voiced.
- `named-runs` keeps separate walkthroughs in `.mr-cast/<name>` with `--name`, or any dir with `--dir`.
- `scene-gallery` renders every scene type (files, state, table, chart, timeline, mermaid and the rest).

## How to get to it (user POV)

- Run `mr-cast extract [base] [--working] [--name slug]` in a git repo on a branch.
- Write `storyboard.json` by hand or through the installed `mr-cast-review` skill.
- Run `mr-cast validate`, `mr-cast outline`, `mr-cast still [i...] [--out dir]`, `mr-cast voice`, `mr-cast render [--out f.mp4] [--no-voice]`, each with optional `--name` or `--dir`.
- Run `/mr-cast-render` in Claude Code, which drives the same commands through the review skill.

## Driving it with verify.sh

Preconditions:

- Baseline from `README.md`. `$DEMO/.mr-cast` does not exist yet.
- Doctor reports Chrome Headless Shell and the voice model as present, or the run allows minutes for the first download.

- **Extract.** Index the branch. Run `$V mrc $RUN extract -- extract`. Exit 0. Stdout starts with `mr-cast: feature/rate-limit vs main (1 commit) · 6 files · 6 hunks · +34 −8` and lists `h1`-`h6`. Then run `tail -1 $DEMO/.git/info/exclude`, which prints `.mr-cast/`. Run `cmp $DEMO/.mr-cast/hunks.json $REPO/examples/demo/hunks.json`, which is silent.
- **Write the storyboard.** Copy the demo storyboard. Run `cp $REPO/examples/demo/storyboard.json $DEMO/.mr-cast/`.
- **Validate.** Run `$V mrc $RUN validate -- validate`. Exit 0 and stdout `✓ storyboard ok · 9 scenes · 1:53 · shows 3/6 hunks · tests scene: 0 cases, 4 gaps` (the length reads from word count, or from audio once voiced).
- **Validate failure.** Break a hunk id in a copy and validate it: `mkdir -p $RUN/work/bad && cp $DEMO/.mr-cast/{hunks,meta}.json $RUN/work/bad/ && sed 's/"hunkId": "h2"/"hunkId": "h99"/' $DEMO/.mr-cast/storyboard.json > $RUN/work/bad/storyboard.json && $V mrc $RUN validate-bad -- validate --dir $RUN/work/bad`. Exit 1, with `error: scenes[5].hunkId: "h99" not found in hunks.json`, a `hint:` listing `h1`-`h6`, and `✗ storyboard invalid · 1 error, 1 warning`.
- **Outline.** Run `$V mrc $RUN outline -- outline`. Exit 0. It prints 9 numbered scenes, from `1. intent    Why this change` to `9. tests     What is tested`, then `9 scenes · about 1:53 (estimated from word count)`.
- **Still.** Render the intent and the limiter code scene. Run `$V mrc $RUN still -- still 0 5 --out $EV/stills`. Exit 0 and two paths `scene-01-intent.png` and `scene-06-code.png`. Open `scene-06-code.png`. It shows `THE LIMITER`, `src/api/rate-limit.ts` with an `ADDED` badge, and a 4-step flow ending `Under the limit, pass the request on`.
- **Short cut for render.** Make a 2-scene named run. Run `mkdir -p $DEMO/.mr-cast/short && cp $DEMO/.mr-cast/hunks.json $DEMO/.mr-cast/short/ && (cd $DEMO && node -e 'const s=require("./.mr-cast/storyboard.json");s.title="Short verify cut";s.scenes=[s.scenes[0],s.scenes[6]];require("fs").writeFileSync(".mr-cast/short/storyboard.json",JSON.stringify(s,null,2))')`. Then `$V mrc $RUN validate-short -- validate --name short` exits 0 with `✓ storyboard ok · 2 scenes` and three coverage warnings.
- **Render silent.** Run `$V mrc $RUN render-silent -- render --name short --no-voice --out $EV/short-silent.mp4`. Exit 0, stdout is the MP4 path, in about 10 s. `$V probe $EV/short-silent.mp4` shows one `h264` 1920x1080 video stream, no audio stream, and a duration near 30 s, and a `bin_data` stream that holds the chapter markers.
- **Voice.** Run `$V mrc $RUN voice -- voice --name short`. Exit 0 and `✓ voiceover · 2 clips (2 new)`. `ls $DEMO/.mr-cast/short/audio` lists two `.wav` files. A second run prints `(0 new)`.
- **Render voiced.** Run `$V mrc $RUN render-voiced -- render --name short --out $EV/short-voiced.mp4`. `$V probe` shows an `aac` audio stream beside the video. Run `$V frame $EV/short-voiced.mp4 20 $EV/short-voiced-20s.png` and open it. It shows the `WIRING IT IN` code scene for `src/api/server.ts`.
- **Default output name.** Run `$V mrc $RUN render-default -- render --name short --no-voice`. Stdout ends with `.mr-cast/short/short-verify-cut.mp4`, the slug of the title.
- **Re-extract keeps the storyboard.** Re-extract with different context so hunks change. Run `$V mrc $RUN reextract -- extract --context 2`. Exit 0, and stderr has `note: kept existing .mr-cast/storyboard.json; hunks changed or gone since last extract: h1, h3, h6`. Restore with `$V mrc $RUN reextract-back -- extract`, after which `validate` passes again.
- **No changes.** Run `git -C $DEMO checkout -q main && $V mrc $RUN extract-main -- extract; git -C $DEMO checkout -q feature/rate-limit`. Exit 1 with `mr-cast: HEAD is on the base (main) with no changes ahead of main; use \`mr-cast extract --working\` …`.
- **Working tree.** Edit a file without committing and extract it into a named run. Run `echo '// wip' >> $DEMO/src/db/client.ts && $V mrc $RUN extract-working -- extract --working --name wip; git -C $DEMO checkout -- src/db/client.ts`. Exit 0, and the index lists `src/db/client.ts` with the added `// wip` line. `$DEMO/.mr-cast/wip/hunks.json` exists.
- **Scene gallery.** Run `mkdir -p $RUN/work/gallery && cp $REPO/examples/gallery/*.json $RUN/work/gallery/ && $V mrc $RUN gallery -- still --dir $RUN/work/gallery --out $EV/gallery`. Exit 0 and 9 PNGs. Open the `files`, `state`, `chart`, `timeline` and `mermaid` ones. Each scene draws its content fully, without clipping.
- **Proof.** Save the data tree with `ls -R $DEMO/.mr-cast > $EV/mr-cast-tree.txt`. The evidence then holds the transcripts, the stills, both MP4s with probe output and a frame.

## Gotchas

- `validate` length strings change once audio exists, because voiced length replaces the word-count estimate. Match the `✓ storyboard ok · 9 scenes` prefix, not the duration, after voicing.
- Coverage warnings (`h2 … is not shown`, `no scene draws how they fit together`) are advice. They leave the exit code 0. Only errors exit 1.
- `still` without `--out` writes to `<data dir>/stills`, which cleanup deletes. Always use `--out $EV/...` for proof.
- A still is the settled end state of a scene, not its animation. To prove motion or timing, extract frames from a render at chosen seconds.
- `render` and `voice` without `--no-voice` need the Kokoro model in `~/.cache/mr-cast/models`. A voice failure prints `warning: continuing without voice-over` and still exits 0, so check for the audio stream with `probe` rather than trusting the exit code.
- `extract` names the base from `origin/HEAD`, then `main`, `master`, and so on. The demo repo has no remote, so it picks `main`.
- A re-extract whose hunks are identical prints no note at all. Only changed or vanished hunk ids are reported.
- Pass `--name` to every command of a named run. Without it, commands use the default `.mr-cast/` run.
