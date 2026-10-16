# Browser player

`mr-cast play` validates the storyboard and serves the player at once on `http://127.0.0.1:4747`, or the next free port up to 20 above it. Unless `--no-voice`, it voices the narration in the background (see [quick-mode.md](./quick-mode.md)). It opens the browser unless `--no-open`. The page shows the storyboard title, a `Chapters` list with start times, the Remotion player and a subtitle panel. Space plays or pauses, `←`/`→` or `J`/`K` move between chapters. When `storyboard.json` or `hunks.json` changes on disk, the server revalidates, revoices and pushes a reload over SSE (`/events`). The page reloads at the same frame.

## Sub-features

- `play-serve` serves `/` (the player), `/data/{storyboard,hunks,meta}.json`, `/data/voiceover.json` (404 with `--no-voice`) and `/data/audio/<hash>.wav`.
- `play-chapters` lists every scene as a chapter, with keyboard and click navigation.
- `play-live-reload` picks up storyboard edits without a restart and logs `mr-cast: storyboard.json changed` with the validation result.
- `play-load-error` shows `Could not load storyboard.json` when the file on disk becomes invalid JSON.
- `play-voiced` shows a `Play with voice-over` poster instead of autoplaying when clips exist.
- `play-port` falls back to the next free port when the requested one is taken.
- `play-host-check` answers 403 `forbidden host` to a foreign Host header (DNS-rebinding guard).
- `play-refuses-invalid` exits 1 before serving when the storyboard has errors.
- `play-explain` serves an explanation, the current run after `init`.
- `play-pace` prints `mr-cast: pace: slower` to stderr when `--pace` or `--speed` makes the pace not normal, and keeps that pace when `storyboard.json` changes and it voices again. `render` prints the same line.
- `play-real-time` plays at real time: 30 frames a second at 1x, so a voiced clip never drifts from its scene. Measured over 30 s of play, the time label advances 30 s and no audio tag is re-seeked.

## How to get to it (user POV)

- Run `mr-cast play [--port N] [--no-open] [--voice name] [--no-voice] [--name slug | --dir path]` in the repo, then open the printed URL.
- Run `mr-cast play` after `mr-cast init` for an explanation.
- The installed `mr-cast` skill runs `play` as its last step and hands the user the URL.

## Driving it with verify.sh

Preconditions:

- Baseline from `README.md`, then the **Extract** and **Write the storyboard** steps of `diff-walkthrough.md`, so the current run `$DEMO/.mr-cast/feature-rate-limit` holds the 9-scene demo.
- No player of this run is running. `$V doctor $RUN` lists none, or lists only ones that own their port.

- **Start.** Run `URL=$($V play-start $RUN main --no-voice --port 4747)`. It prints `http://127.0.0.1:<port>`. The port is 4747, or higher when 4747 is busy. `$V doctor $RUN` then reports `PASS player main pid <pid> owns port <port>`.
- **Serve data.** `curl -s -o /dev/null -w '%{http_code}\n' $URL/` prints `200`. `curl -s $URL/data/storyboard.json | head -3` shows `"title": "Rate limiting for the Orders API"`. `curl -s -o /dev/null -w '%{http_code}\n' $URL/data/voiceover.json` prints `404`.
- **Host check.** `curl -s -w ' %{http_code}\n' -H 'Host: evil.example' $URL/` prints `forbidden host 403`.
- **Load and navigate.** Run `$V browse $RUN player "$URL/" "wait:Rate limiting for the Orders API" shot:loaded press:ArrowRight press:ArrowRight sleep:500 shot:chapter3`. Open `$EV/player/chapter3.png`. Chapter 3 `Who calls whom` is highlighted, the scene shows `WHO CALLS WHOM` and `POST /orders`, and the time reads `0:27`. `$EV/player/loaded.txt` lists all 9 chapter names. `$EV/player/console.txt` has no `exception:` line.
- **Live reload.** Change the title on disk while the page is open. Run `$V browse $RUN reload "$URL/" "wait:Rate limiting for the Orders API" "run:sed -i '' 's/Rate limiting for the Orders API/Live reload works/' $DEMO/.mr-cast/feature-rate-limit/storyboard.json" "wait:Live reload works" shot:reloaded`. Expected: exit 0, and `$EV/reload/reloaded.png` shows `Live reload works` as the heading. The server side is checked separately. `$V play-stop $RUN main` copies the log, and `$EV/play-main.stderr.txt` should have `mr-cast: storyboard.json changed` with the validation line. `curl -s $URL/data/storyboard.json | head -2` should show the new title.
- **Load error and Retry.** Break the JSON, load the page, then fix the file and choose `Retry`. Run `$V browse $RUN retry "$URL/" "run:printf '{' > $DEMO/.mr-cast/feature-rate-limit/storyboard.json" sleep:500 click:Retry "wait:Could not load storyboard.json" shot:error "run:cp $REPO/examples/demo/storyboard.json $DEMO/.mr-cast/feature-rate-limit/" sleep:500 click:Retry "wait:Rate limiting for the Orders API" shot:retried`. Exit 0. `error.png` shows the `COULD NOT LOAD STORYBOARD.JSON` card with `invalid JSON: …` and a `Retry` button. `retried.png` shows the walkthrough again.
- **Port fallback.** With `main` still running on 4747, run `URL2=$($V play-start $RUN second --no-voice --port 4747)`. It prints `http://127.0.0.1:4748`. Then run `$V play-stop $RUN second`.
- **Refuses invalid.** Run `mkdir -p $RUN/work/bad && cp $DEMO/.mr-cast/feature-rate-limit/{hunks,meta}.json $RUN/work/bad/ && sed 's/"hunkId": "h2"/"hunkId": "h99"/' $DEMO/.mr-cast/feature-rate-limit/storyboard.json > $RUN/work/bad/storyboard.json && $V play-start $RUN bad --no-voice --dir $RUN/work/bad`. It fails with `verify: player bad exited before serving`, after printing the validation error for `h99`.
- **Voiced poster.** Create the 2-scene `short` run with the **Short cut for render** step of `diff-walkthrough.md`. Run `URL3=$($V play-start $RUN voiced --name short)`, which voices 2 clips first (about 8 s), then run `$V browse $RUN voiced "$URL3/" "wait:Play with voice-over" shot:poster`. The screenshot shows `Short verify cut`, two chapters, and the `Play with voice-over` button over a paused player at `0:00 / 0:23`. `curl -s -o /dev/null -w '%{http_code}\n' $URL3/data/voiceover.json` prints `200`.
- **Explain play.** Run the **Init**, **Snippet** and **Storyboard and validate** steps of `explain-mode.md`, then `URL4=$($V play-start $RUN explain --no-voice)`, which serves the current run, the explanation `init` made and `$V browse $RUN explain-play "$URL4/" "wait:How the rate limiter works" shot:explain`. The page shows the explanation's title and the chapters `The idea`, `Who calls whom` and `The limiter`.
- **Stop.** Run `$V play-stop $RUN`. Each player prints `verify: stopped player <label>`, and `lsof -nP -iTCP:<port> -sTCP:LISTEN` is empty.

## Gotchas

- Without `--no-voice`, `play-start` waits for Kokoro to voice every scene before the URL appears. The 9-scene demo takes about a minute. Use `--no-voice` unless voice is the point.
- Without `--no-open`, play opens the user's real browser. `play-start` always passes `--no-open`.
- Two chapter keys sent back to back can land as one move, because the page's key handler reads the active chapter from its last render. `press:` waits 300 ms after each key for this reason. Read the time label (`0:27 / 1:53` for chapter 3) in the saved `.txt` to confirm where you are.
- A silent walkthrough autoplays muted, so the frame moves between two screenshots. Navigate with `press:` and assert the highlighted chapter and the time label, not exact pixels.
- `sed -i ''` is the macOS form. The server watches the data dir, so an edit through a rename or copy also triggers it.
- Some labels are uppercased by CSS, so the page text reads `COULD NOT LOAD STORYBOARD.JSON` and `CHAPTERS`. `wait:` ignores case. Assertions on the saved `.txt` files must ignore case too.
- The header's branch badge comes from `meta.json`. A run dir without one, such as the hand-made `short` run, shows only the title and length.
- The Host check accepts `127.0.0.1:<port>` and `localhost:<port>` only. Curl with the printed URL sends the right Host.
- Plain `chrome-headless-shell --screenshot` hangs on this machine (Chromium 157), even on a blank page. Use `$V browse`, which drives Chrome over CDP.
