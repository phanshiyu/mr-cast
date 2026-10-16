# Text fit and inline markup

Every text a scene draws is fitted to its place by `shared/textfit.mjs`: it wraps to the lines its slot allows, then shrinks to the slot's smallest readable size. A scene never cuts a word or ends a text in an ellipsis. Text that still does not fit at the smallest size is drawn at that size, running a little past its box, and `validate` fails, naming the scene, the item, the exact text and a fix. `validate` runs the player's own layout code (`src/fit/report.ts`, bundled with esbuild), so it and the video agree. Display text takes inline markup: `**bold**`, `` `code` ``, `==marked==` and `[words]{tone}`.

## Sub-features

- `fit-wrap` wraps and shrinks every display text: card titles and captions, edge and message labels, notes, state and transition labels, table cells and headers, chart labels and annotations, timeline events and spans, file notes, test names, proves and gaps, step labels, callouts, flow actions, the intent card and every scene's chapter and title.
- `fit-validate` fails with `<path>: "<text>" does not fit its <slot>, even at <n>px; <fix>` for text past its slot's floor, and fails when a table or tests scene does not fit the frame at its smallest font. A file's name or path, a hunk header and a line of code are the source's own, so they shrink with a warning instead.
- `fit-markup` draws `**bold**`, `` `code` `` chips, `==marked==` highlights and `[words]{good|bad|warn|accent|neutral}` in display text. `validate` fails on unclosed or unknown markup with its column, and warns when more than a third of a text of three or more words is styled. Narration, `say` and pen notes drop markup before the voice, the clip key and the subtitles, with a warning.
- `fit-metrics` measures with `shared/font-metrics.mjs`, per character, weight and size with kerning, made by `node scripts/measure-fonts.mjs` in Chrome Headless Shell from the bundled font files. In the player a fitted line is drawn within a pixel of its measured width.
- `fit-lint` (`pnpm typecheck` runs `scripts/check-text.mjs`) fails on text clipping or an ellipsis under `src/`, and on a component that fits text itself.

## How to get to it (user POV)

- Write long labels or markup in `storyboard.json`, then run `mr-cast validate`, `still`, `play` or `render`.

## Driving it with verify.sh

Preconditions: the baseline in `README.md`. The fixtures use the demo's diff, so copy `examples/demo/hunks.json` beside them.

- **Long text renders whole.** Run `mkdir -p $RUN/work/fits && cp $REPO/examples/demo/hunks.json $RUN/work/fits/ && cp $REPO/.claude/skills/verify/fixtures/stress/fits.json $RUN/work/fits/storyboard.json`, then `$V mrc $RUN fits-validate -- validate --dir $RUN/work/fits`. It exits 0 with only the two step-label length warnings. Run `$V mrc $RUN fits-still -- still --dir $RUN/work/fits --out $EV/fits` and open the 13 stills: every text is whole, wrapped or smaller, and the intent card's last bullet shows bold, a code chip, a marked phrase and red words.
- **Nothing is clipped in the player.** Run `URL=$($V play-start $RUN fits --no-voice --dir $RUN/work/fits)`, then `$V browse $RUN fits-scan "$URL/" wait:Stress click:1.5x textscan:50` and `node $REPO/.claude/skills/verify/scripts/text-check.mjs $RUN/work/fits/storyboard.json $EV/fits-scan/textscan.json`. It prints `text-check: ok`: every text of the storyboard was seen whole, no line has an ellipsis, no element in the video clips its text, and the widest fitted line is within 1px of its measured width. Stop the player with `$V play-stop $RUN fits`.
- **validate names what does not fit.** Copy `fixtures/stress/over.json` the same way into `$RUN/work/over` and run `$V mrc $RUN over-validate -- validate --dir $RUN/work/over`. It exits 1. Its error paths, `sed -nE 's/^error: (scenes\[[0-9]+\])( \("[^"]*"\))?([^:]*): .*/\1\3/p' $EV/over-validate.txt | sort -u`, equal `sort -u $REPO/.claude/skills/verify/fixtures/stress/over.expected.txt`: 18 items, one of them a bullet with two markup errors.

## Gotchas

- Text is drawn in the bundled Inter and JetBrains Mono (`src/fonts.ts`), which the metrics were measured from, so a fit is the same on macOS and Linux. A render waits for the fonts with `delayRender`, and the player paints only once they have loaded. A character outside the bundled subset (Latin, Latin-1 and Latin Extended-A, punctuation, arrows and a few math signs) falls back to a system font and measures as its base letter.
- A text exactly at its slot's floor fits; one character more fails. Recheck `over.expected.txt` after changing a slot in `src/fit/slots.ts`.
- `text-check.mjs` finds a text by its characters with spaces removed, so a text split over lines or uppercased by CSS still counts as seen.
