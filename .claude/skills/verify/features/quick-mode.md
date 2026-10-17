# Quick mode and the voice before the page

`mr-cast init --quick` starts a short diagram video in `.mr-cast/quick-<title-slug>/`. `validate` lets it open without an intent scene and warns past 3 scenes or about 60 seconds of narration. `play` serves the player and prints its URL at once, voices in a child process with one progress line on stderr (`Voicing <k> of <n> lines... (--no-voice skips the voice)`), then opens the browser. A page opened before that shows `Making the voice-over...`. A quick run ends on a card of next steps.

## Sub-features

- `quick-run` names the run `quick-<title-slug>` and writes `"quick": true` to its `meta.json`.
- `quick-validate` skips the intent warning, warns `scenes: 4 scenes; a quick video keeps to 3, ...` and `the narration is <n> words, about <s> seconds; ...`, and keeps every other check.
- `quick-deeper` makes a later `init` of the same title without `--quick` start from the quick run's storyboard, snippets and voice, and print `note: started from the quick video in ...`.
- `play-voice-first` prints the URL in about 0.2 s and keeps answering while it voices, serves `/data/voiceover.json` with `"pending":true` until the voice is ready, and opens the browser only then: about 16 s for the 2-scene quick video on a first run, under 0.5 s with its clips cached. The page waits on `Making the voice-over...`, then reloads with the voice.
- `play-voice-failed` opens the page anyway when voicing fails, prints `mr-cast: voicing failed; the player plays silent with subtitles`, and the page plays silent with `Voice failed, see the terminal`.
- `play-edit-holds` keeps the open page on its storyboard and voice, with `Updating…` in the header, while an edit is voiced; `/data/storyboard.json` serves the old storyboard meanwhile. Then the page reloads once, at the same frame.
- `quick-end-card` shows `Next, say to Claude` with "go deeper", "the whole branch" and "save it" when a quick run ends.

## How to get to it (user POV)

- Ask Claude for "a quick diagram of this", or highlight code in the IDE and type `/mr-cast`.
- Or run `mr-cast init --quick --title <text>`, write `storyboard.json`, then `mr-cast validate` and `mr-cast play`.

## Driving it with verify.sh

Preconditions: launched `$RUN`, Kokoro cached (doctor). A 2-scene storyboard with no intent scene, such as a decision `graph` and a `sequence`, in `$RUN/work/quick.json`.

- **Start.** `$V mrc $RUN quick-init -- init --quick --title "Rate limiter quick"` prints `.../.mr-cast/quick-rate-limiter-quick`. Copy `$RUN/work/quick.json` there as `storyboard.json`.
- **Validate.** `$V mrc $RUN quick-validate -- validate` prints `✓ storyboard ok` and no `intent scene` warning.
- **Voice first.** `rm -rf $DEMO/.mr-cast/quick-rate-limiter-quick/audio $DEMO/.mr-cast/quick-rate-limiter-quick/voiceover.json`, then `URL=$($V play-start $RUN quick)`. `curl $URL/data/voiceover.json` shows `"pending":true` at first, and `$RUN/work/play/quick.err` counts `Voicing 0 of 5 lines...` up to `voice ready: 5 of 5 lines`.
- **Wait, voice, end card.** `$V browse $RUN quick-voice "$URL/" "wait:Making the voice-over" shot:waiting sleep:10000 "wait:Play with voice-over" shot:voiced sleep:2000 press:Space press:k sleep:17000 shot:end`. `waiting` shows no player, `voiced` reads `0:00 / 0:43` (voiced) under the `Play with voice-over` poster, and `end` shows `go deeper`.
- **Edit while open.** With the player above running and voiced, write a copy of the storyboard whose second scene has a new `chapter` and `narration` to `$RUN/work/edited.json`, then `$V browse $RUN edit "$URL/" "wait:Play with voice-over" sleep:2000 press:Space sleep:2000 "run:cp $RUN/work/edited.json $DEMO/.mr-cast/quick-rate-limiter-quick/storyboard.json" wait:Updating shot:updating "wait:<new chapter>" shot:reloaded`. `updating` shows `Updating…`, the old chapter name and the time still advancing; `reloaded` shows the new chapter at about the same time, about 3 s after the edit.
- **Failed voice.** `URL=$($V play-start $RUN failed --voice zz_bogus)`, then `$V browse $RUN failed "$URL/" "wait:Voice failed" sleep:2000 shot:failed`. The page plays silent at the reading length (`/ 0:53`).
- **Stop.** `$V play-stop $RUN quick` stops it at once, even mid-voice.

## Gotchas

- `browse` waits 15 s at most, so put a `sleep:` before waiting for a voice that takes longer.
- The first key press right after the page loads can be lost; `sleep:2000` before `press:Space`.
- The voice is made at about a third of real time, so the 43 s quick video takes about 16 s, mostly speaking, after about 2 s loading the model.
