# Quick mode and background voice

`mr-cast init --quick` starts a short diagram video in `.mr-cast/quick-<title-slug>/`. `validate` lets it open without an intent scene and warns past 3 scenes or about 60 seconds of narration. `play` serves the player at once and voices in a child process. Until the voice is ready the player plays muted with subtitles and shows `Voice: <k> of <n> scenes`. Then it shows `Play with voice (V)`, and never switches the audio in the middle of a play. A quick run ends on a card of next steps.

## Sub-features

- `quick-run` names the run `quick-<title-slug>` and writes `"quick": true` to its `meta.json`.
- `quick-validate` skips the intent warning, warns `scenes: 4 scenes; a quick video keeps to 3, ...` and `the narration is <n> words, about <s> seconds; ...`, and keeps every other check.
- `quick-deeper` makes a later `init` of the same title without `--quick` start from the quick run's storyboard, snippets and voice, and print `note: started from the quick video in ...`.
- `play-background-voice` serves the page in about 0.2 s whatever the voice still has to make, and keeps answering in about 20 ms while it voices.
- `play-voice-pill` shows `Voice: <k> of <n> scenes` while voicing, then `Play with voice (V)`. The timeline keeps its silent length until the viewer presses V or clicks the button.
- `quick-end-card` shows `Next, say to Claude` with "go deeper", "the whole branch" and "save it" when a quick run ends.

## How to get to it (user POV)

- Ask Claude for "a quick diagram of this", or highlight code in the IDE and type `/mr-cast`.
- Or run `mr-cast init --quick --title <text>`, write `storyboard.json`, then `mr-cast validate` and `mr-cast play`.

## Driving it with verify.sh

Preconditions: launched `$RUN`, Kokoro cached (doctor). A 2-scene storyboard with no intent scene, such as a decision `graph` and a `sequence`, in `$RUN/work/quick.json`.

- **Start.** `$V mrc $RUN quick-init -- init --quick --title "Rate limiter quick"` prints `.../.mr-cast/quick-rate-limiter-quick`. Copy `$RUN/work/quick.json` there as `storyboard.json`.
- **Validate.** `$V mrc $RUN quick-validate -- validate` prints `✓ storyboard ok` and no `intent scene` warning.
- **Background voice.** `rm -rf $DEMO/.mr-cast/quick-rate-limiter-quick/audio $DEMO/.mr-cast/quick-rate-limiter-quick/voiceover.json`, then `URL=$($V play-start $RUN quick)`. `curl $URL/data/voiceover.json` shows `"pending":true` at first.
- **Pill, button, voice, end card.** `$V browse $RUN quick-voice "$URL/" "wait:Voice:" shot:building sleep:16000 "wait:Play with voice (V)" shot:ready press:v sleep:2500 shot:voice-on press:k sleep:17000 shot:end`. The time label reads `/ 0:53` (silent) in `building` and `ready`, `/ 0:43` (voiced) in `voice-on`, and `end` shows `go deeper`.
- **Stop.** `$V play-stop $RUN quick` stops it at once, even mid-voice.

## Gotchas

- Chrome takes several seconds to start, so on a 2-scene video `wait:Voice:` can miss the pill. Use `examples/gallery` with `--dir` to see `Voice: 0 of 15 scenes` for longer.
- A walkthrough fully voiced before `play` starts shows `Play with voice-over` and waits for a click, as before.
- The voice is made at about half real time, so a minute of narration takes about 30 s.
