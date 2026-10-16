# The plan page

Before Claude writes a storyboard, it writes `plan.json` with the change's topics. `mr-cast plan` checks it and serves a page where the user picks each topic's depth (Skip, Brief, Deep) and how it is shown, with the mouse or the keys. Each pick is saved into `plan.json` through a token-guarded POST, and Claude's own edits to `plan.json` reload the page. Once a storyboard exists, the player has the same page as a Plan tab, and a pick that differs from the built video is marked "Changed, not in the video yet".

## Sub-features

- **Check and serve.** `mr-cast plan` exits 1 when `plan.json` is missing or has errors, and otherwise prints `✓ plan ok · <n> topics · about m:ss` on stderr and `mr-cast plan: http://127.0.0.1:<port>/plan#token=<hex>` on stdout.
- **Picks.** Clicking a depth or a view tile saves at once ("Saved" by the header), and the length estimate follows. Keys: ArrowUp and ArrowDown move between rows, 1, 2 and 3 set Skip, Brief and Deep, ArrowLeft and ArrowRight change the view. A skipped row dims and hides its views. A topic with one view shows "Shown as: <label>". A changed row has an accent bar and "Back to suggested".
- **Live reload.** An edit of `plan.json` on disk reloads the page and outlines new or changed rows for about two seconds. An invalid `plan.json` shows "The plan has problems" with the errors.
- **Write guard.** POST `/plan/choice` needs the `X-Mr-Cast-Token` header and a JSON body `{ topic, choice }`. Without the token the page says "This page is read-only".
- **Topics in validate and outline.** `validate` checks scene `topic` ids and the storyboard's `plan` (the pick each topic was written from) against `plan.json`, warns `plan.<id>: the plan changed since the storyboard was written: ...` for a pick flipped since, and, when the storyboard is valid, writes the storyboard's `plan` to `plan-built.json`. `outline` groups scenes under `<title> (<depth>, <view label>)` headings.
- **Plan tab.** `play` with a `plan.json` shows Video and Plan tabs. A changed pick shows "Changed, not in the video yet" and the bar "In the terminal, say: update the video".

## How to get to it (user POV)

The `/mr-cast` skill writes `plan.json` after the questions, runs `mr-cast plan`, and asks "I opened the plan in your browser. Make the video from it?" in the terminal. The user picks in the browser, then presses Enter. Later, the player's Plan tab shows the same picks.

## Driving it with verify.sh

Preconditions: `$V launch $RUN`, then `$V mrc $RUN extract -- extract`. `D=$DEMO/.mr-cast/feature-rate-limit` and `F=$REPO/.claude/skills/verify/fixtures/plan`.

- **Missing plan.** `$V mrc $RUN plan-missing -- plan --no-open` exits 1 with `plan.json not found; write it first`.
- **Serve.** `cp $F/plan.json $D/ && PURL=$($V plan-start $RUN plan)`. It prints `http://127.0.0.1:<port>/plan#token=<32 hex>`.
- **Mouse, keys and reload.** `$V browse $RUN plan-edit "$PURL" wait:Rate size:1440x1000 "clickin:Orders use real prices::Before vs after" wait:Saved shot:mouse press:ArrowDown press:ArrowDown press:3 press:ArrowDown press:ArrowRight sleep:600 shot:keys reload wait:Rate shot:reloaded`. Then `grep -A3 '"choice"' $D/plan.json` shows `real-prices` at `brief`/`compare`, `data-model` at `deep`/`schema` and `order-events` at `brief`/`code`. The reloaded screenshot shows the same picks and "About 5:10".
- **Narrow.** `$V browse $RUN plan-narrow "$PURL" wait:Rate size:420x900 shot:narrow`. The depth control sits under each title and the view tiles stack.
- **Live reload and the invalid state.** Edit a title in `$D/plan.json` from a `run:` step, then `wait:<new title>` and `shot:edited`: the row has an amber outline. `run:echo '{' > $D/plan.json` then `wait:The plan has problems`. Restore the file and the topics come back.
- **Refused writes.** `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"topic":"rate-limiter","choice":{"depth":"deep","view":"calls"}}' "${PURL%/plan#*}/plan/choice"` prints `403`. With `-H "X-Mr-Cast-Token: ${PURL##*token=}"` and topic `nope` it prints `400`.
- **Validate, outline and the Plan tab.** `$V play-stop $RUN plan && cp $F/{plan,storyboard}.json $D/`, then `$V mrc $RUN validate -- validate` ends `✓ storyboard ok` and writes `$D/plan-built.json`. `$V mrc $RUN outline -- outline` groups the scenes under topic headings. `URL=$($V play-start $RUN main --no-voice)`, then `$V browse $RUN player-plan "$(cat $RUN/work/play/main.token-url)" "wait:Rate limiting for the Orders API" click:Plan "wait:Who calls" "clickin:Orders use real prices::Before vs after" "wait:Changed, not in the video yet" shot:changed`. The `play-main` stderr then shows the `plan.real-prices: the plan changed ...` warning from the re-validation, and the row keeps its badge. Rewriting the topic's scenes as a compare scene and setting `"real-prices": { "depth": "brief", "view": "compare" }` in the storyboard's `plan` clears it after the reload.
- **Read-only.** `$V browse $RUN plan-readonly "$URL/plan" wait:read-only shot:readonly`. Clicks change nothing in `$D/plan.json`.

## Gotchas

- The token is in the URL fragment. `play-start` prints the bare origin so recipes can append paths, and keeps the full URL in `$RUN/work/play/<label>.token-url`. `plan-start` prints the full plan URL.
- `browse`'s `click:` and `clickin:` call `element.click()`, which fires no `mousedown`, so the keyboard row does not move to the clicked topic. Keys start from the first row.
- `fullshot:` captures the whole page, and the fixed bottom bar lands where the viewport ended.
