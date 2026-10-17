# Pre-read

`--audience preread` makes a reviewer's video with no code on screen, which ends on the order in which to read the code. Diagrams cite the hunks they explain in `from` and show an "In the code:" line. The closing `reading` scene lists the items to read with their file and lines from `hunks.json`. `validate` covers the diff with that reading order, writes `reading.md`, and `outline` prints the order as `path:line` lines. The player shows a Reading order panel with "Copy as checklist", and the plan page offers no code view and words its depths for a pre-read.

## Sub-features

- **No code on screen.** With `--audience preread`, `validate` fails on a `code` scene, a code cell in a `compare`, and a `review` scene, and on a `plan.json` topic that offers the `code` view (`mr-cast plan` exits 1 with `a pre-read puts no code on screen, so drop "code"`).
- **`from`.** A diagram's `from` names up to 3 hunk ids. The scene draws `In the code: <file names>` in the top margin. `validate` errors on an unknown id, warns past 3, and warns `nothing on screen names <id>` when neither the file's base name nor one of the hunk's code-style identifiers (camelCase, snake_case) appears in the scene's text.
- **Reading scene.** At most 6 items under "Read first", each with a number, `file:lines`, "Explained in: <chapter>" and its check, a finding in its severity's colour, and `+N routine changes, listed in reading.md`.
- **Coverage.** `✓ storyboard ok · ... · reading order 6/6 hunks`. A substantial hunk in neither the order nor `skipped` warns `is not in the reading order`. A missing reading scene, a reading scene that is not last, and narration naming an item the order does not number all warn.
- **reading.md and outline.** `validate` prints `wrote .mr-cast/<run>/reading.md`. `outline` ends with `reading order:` and one `  N. path:a-b  check` line per item, then `  skim: ...`.
- **Player panel.** Below the subtitles, "Reading order" lists every item; "Explained in" seeks the video to that chapter; "Copy as checklist" copies the Markdown, or shows it in a selected text box when the browser blocks the clipboard.
- **Plan page.** With `plan --audience preread`, the header adds "No code on screen: you read the code after the video.", each row shows its depth's hint under the control ("The picture and its key fact." or "Trace one real case through it, with the actual limits, keys and order."), and the closing row reads "The tests, then the order in which to read the code, with what to check at each place."

## How to get to it (user POV)

Ask `/mr-cast` for a "pre-read", a video "before I review", or one with "no code on screen", or pick "A reviewer who will read the code next" as the audience. Claude passes `--audience preread` to every command and ends its reply with the reading order.

## Driving it with verify.sh

Preconditions: `$V launch $RUN`, then `$V mrc $RUN extract -- extract --audience preread`. `D=$DEMO/.mr-cast/feature-rate-limit`, `F=$REPO/.claude/skills/verify/fixtures/preread`, `X=$REPO/examples/preread`.

- **Plan with a code view.** Add `"code"` to a topic's views in a copy of `$F/plan.json` in `$D/`, then `$V mrc $RUN plan-code -- plan --no-open --audience preread` exits 1 with `topics[1].views: a pre-read puts no code on screen`.
- **Plan page.** `cp $F/plan.json $D/ && PURL=$($V plan-start $RUN plan --audience preread)`, then `$V browse $RUN plan "$PURL" wait:Rate size:1440x1000 "wait:Trace one real case" press:ArrowDown press:3 sleep:600 shot:plan`. Both of the first two rows read "Trace one real case ...", the third "The picture and its key fact.", and "Saved" shows. `$V play-stop $RUN plan`.
- **Validate and outline.** `rm $D/plan.json $D/plan-built.json; cp $X/storyboard.json $D/`. `$V mrc $RUN validate -- validate --audience preread` ends `reading order 6/6 hunks` and writes `$D/reading.md`. `$V mrc $RUN outline -- outline --audience preread` ends with the three numbered `src/...:a-b` lines and `skim: src/queue/events.ts:1-3, docs.md:7-12, src/legacy-throttle.ts:1-6 (removed)`. Without `--audience preread` the same storyboard warns `only a pre-read (--audience preread) reads "from"` on each diagram.
- **Stills.** `$V mrc $RUN still -- still --audience preread --out $EV/stills`. Scene 2 shows `In the code: rate-limit.ts, server.ts, events.ts` top right; scene 6 shows three numbered rows and `+3 routine changes, listed in reading.md`.
- **Player.** `URL=$($V play-start $RUN main --audience preread)`, then `$V browse $RUN player "$(cat $RUN/work/play/main.token-url)" "wait:Reading order" size:1440x1400 "click:Now read the code" sleep:2500 shot:reading "click:Copy as checklist" "wait:blocked the clipboard" shot:copy`. The panel lists the same three items as the scene, and headless Chrome shows the selected text box.

## Gotchas

- The audience is a flag, not a storyboard field: pass `--audience preread` to `validate`, `outline`, `still`, `play`, `plan` and `render`, or the checks run for a familiar reviewer.
- Headless Chrome refuses `navigator.clipboard.writeText`, so "Copy as checklist" always shows the fallback text box under `browse`.
- The depth hint under each control shows only in a pre-read; elsewhere it stays a tooltip.
