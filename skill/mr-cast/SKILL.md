---
name: mr-cast
description: Makes a narrated, animated video of this branch's changes, of something just explained, of a concept the user names, or of code the user selected, played in the browser or saved as an MP4. Use when the user asks for a video, walkthrough, or animation of a branch, diff, pull request, or merge request, asks to animate, visualize, or make a video of an explanation, such as "animate that", "make a video of this", "explain quicksort in a video", or "turn that into a video", or asks for a quick diagram video, such as "explain this flow in a diagram", "just a diagram" or "/mr-cast quick". It can also mark what looks wrong in the branch, when the user asks for a review, or make a pre-read with no code on screen. Not for a code review or an explanation that asks for no video.
argument-hint: "[quick] [mp4] [pre-read] [review] [base-branch | --working | what to focus on]"
hooks:
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "'{{MR_CAST}}/bin/mr-cast' hook"
---

# mr-cast

mr-cast turns a storyboard you write, `storyboard.json`, into a narrated, animated video: a browser player that reloads as you edit, or an MP4. You decide what the video covers, in what order, how long it is, and which scenes show it. mr-cast gives you the scenes, a voice, a validator and a way to look at the result.

The CLI is `{{MR_CAST}}/bin/mr-cast`. Run every command from the user's repository, or from the directory the explanation is about. Call it directly, not through `node`. If a command prints `mr-cast <version> is available`, tell the user once, at the end of your reply, that they can ask you to upgrade. Do not upgrade unless they ask.

## What the user asked for

Pick the row that matches the user's words first, then what is in context.

| The request | The video |
| --- | --- |
| After a quick video in this conversation: "save it", "render it", "go deeper", "the whole branch" | About that video. "Save it" renders the quick run as it is. "Go deeper" runs `init` with the same `--title` and no `--quick`, which starts from the quick video's scenes. "The whole branch" runs `extract` for a full video of the branch's changes. |
| "mp4", "render", "save", "share", "video file" | An MP4. Otherwise the browser player. |
| "pre-read", "before I review", "no code on screen", "without code" | A pre-read: pass `--audience preread` (below). |
| "review it", "what looks wrong", "flag problems" | Review on: add `findings` (below). |
| "quick", "just a diagram", "sketch", `/mr-cast quick`, or a bare `/mr-cast` with selected code | A quick video: `init --quick`. |
| "this branch", "this PR", "the diff", a base branch, `--working`, a PR or MR number | The branch. |
| "animate that", "what you said", a concept to explain | The explanation. |

When the IDE is connected, the lines the user highlights arrive with the prompt, such as "Selected 14 lines from src/limiter.ts", and keep arriving while they stay highlighted.

```bash
{{MR_CAST}}/bin/mr-cast status
```

`status` prints the branch, the commits and files ahead of its base, the uncommitted files, and the pace and voice chosen last time. When the words name neither source, use the branch if it has changes and nothing was explained in this conversation, the explanation if one was, and ask which when both are there. When neither is, say in two sentences what `/mr-cast` makes and stop.

## Start the run

For the branch:

```bash
{{MR_CAST}}/bin/mr-cast extract [base] [--working] <flags>
```

It prints the run's directory, `.mr-cast/<branch-slug>/`, and a hunk index: each file, its hunk ids (`h1`, `h2`, ...) and the changed lines with their line numbers. Full hunks go to `hunks.json`. Pass a base when the user names one. Add `--working` for uncommitted changes. For a PR or MR that is not checked out, run `gh pr checkout <n>` or `glab mr checkout <n>` first. Running `extract` again refreshes the diff and keeps the storyboard and snippets.

For an explanation, or a quick video:

```bash
{{MR_CAST}}/bin/mr-cast init --title "How the rate limiter works" [--quick] [--reset] <flags>
```

The run is `.mr-cast/<title-slug>/`, or `.mr-cast/quick-<title-slug>/` with `--quick`. The same title reopens the run; `--reset` starts it over.

To show source code that is not in the diff, add it as a snippet, at most 80 lines each:

```bash
{{MR_CAST}}/bin/mr-cast snippet src/limiter.ts:12-40 src/server.ts:5-18
```

Each snippet gets an id (`s1`, `s2`, ...) and keeps the file's line numbers. A `code` scene shows a snippet by its id, like a hunk.

The run becomes the current one, which every later command works on; pass `--name <slug>` to work on another. `<flags>` are `--audience preread` for a pre-read, and `--pace slower|normal|faster`, `--voice <engine:name>` or `--no-voice`. When the user names no pace, pass the last pace `status` printed: `--pace <it>`, or `--no-voice` for `silent`. When the user names no voice, pass the last voice `status` printed, `--voice <it>`, unless it says `none yet`. A flag applies to its own command only, so pass the same flags to every command.

## Write the storyboard

Write `storyboard.json` in the run's directory. Print the fields:

```bash
{{MR_CAST}}/bin/mr-cast schema          # the storyboard and what every scene shares
{{MR_CAST}}/bin/mr-cast schema <type>   # one scene type
```

The scene types, each with an example: [array](references/scenes/array.md), [chart](references/scenes/chart.md), [code](references/scenes/code.md), [compare](references/scenes/compare.md), [er](references/scenes/er.md), [files](references/scenes/files.md), [flow](references/scenes/flow.md), [graph](references/scenes/graph.md), [layers](references/scenes/layers.md), [map](references/scenes/map.md), [memory](references/scenes/memory.md), [mermaid](references/scenes/mermaid.md), [reading](references/scenes/reading.md), [review](references/scenes/review.md), [sequence](references/scenes/sequence.md), [state](references/scenes/state.md), [svg](references/scenes/svg.md), [table](references/scenes/table.md), [terminal](references/scenes/terminal.md), [tests](references/scenes/tests.md), [text](references/scenes/text.md), [timeline](references/scenes/timeline.md). Any stepped scene can also write and draw on itself with a step's `draw`, which stays until a step's `erase`: [ink](references/ink.md). Whole storyboards: `{{MR_CAST}}/examples/demo/storyboard.json` (a branch), `{{MR_CAST}}/examples/people/storyboard.json` (an explanation), `{{MR_CAST}}/examples/review/storyboard.json` (review on), `{{MR_CAST}}/examples/preread/storyboard.json` (a pre-read), and a short demo of each scene type in `{{MR_CAST}}/examples/primitives/<type>/storyboard.json`.

Longer explanations with real numbers, each `{{MR_CAST}}/examples/<path>/storyboard.json`:

- `algorithms/quicksort`: a partition on an `array` with pointers, `set` and ranges, the Java in a `code` scene, an `svg` of how deep the splits go, a cost `table`.
- `algorithms/binary-search`: pointers closing on a value, ruled-out halves dimmed with `tint`, the midpoint formula in a `callout`, a `chart` of steps by size.
- `algorithms/merge-sort`: several `arrays` splitting and zipping back with a pointer on each, and a `chart`.
- `algorithms/dijkstra`: a `graph` and the tracker `table` beside it, changing in the same step with `set` and `tint`.
- `algorithms/hash-table`: a key's sum in a `callout`, slots as `arrays`, a collision, chaining in `memory`, open addressing and a resize.
- `architecture/youtube`: `graph` pipelines with a `table` beside, a `terminal` manifest, a `timeline` of chunks, an `svg` CDN map.
- `architecture/react`: JSX beside its object in `compare`, Fiber trees in `memory` with `set`, a `graph` diff, a `timeline` of frames.
- `architecture/oauth`: `svg` figures, the redirect as a `sequence`, `terminal` requests with a real PKCE hash, a `timeline` of token expiry.
- `architecture/h3`: `svg` maps and tilings, a `table` of resolutions, a 64-bit index as `array` cells, a k-ring on a hex grid.
- `explain/bitcoin`: a ledger `table` whose rows arrive and get rejected, real proof of work, a `graph` chain of blocks.
- `explain/gpt`: tokens as `array` cells, an `svg` vector plot, softmax `table`s and `chart`s at three temperatures.

Write every narration and `say` in plain words. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another.

The voice reads the narration and each step's `say` aloud, and each scene lasts as long as its words take. It reads "e.g.", "5s", "200 ms", an arrow and "v0.14" as words. Markup in spoken text is read as plain words.

**Review.** List what looks wrong in the storyboard's `findings`, and set `"flag": "<id>"` on the code step that shows a finding's line to circle it there. A `review` scene lists every finding. `validate` writes `review.md` in the run's directory.

**Pre-read.** With `--audience preread`, no code goes on screen: `validate` rejects a `code` scene and a code cell. A diagram can cite the hunks it explains in `"from": ["h1"]`. A `reading` scene lists the order in which to read the code, and `validate` writes it to `reading.md`.

**Plan page.** When the user wants to pick the topics first, see [references/plan.md](references/plan.md).

## Check it

A hook runs `validate` after every write to `storyboard.json` and shows you the errors. Run it yourself too:

```bash
{{MR_CAST}}/bin/mr-cast validate <flags>
```

Fix every error until it prints `✓ storyboard ok`. Errors are what would not render or names that do not exist. Warnings report what you cannot see without rendering, such as text that does not fit or a step whose words name something it does not light.

These show you what the viewer will see:

```bash
{{MR_CAST}}/bin/mr-cast still [sceneIndex...] <flags>   # PNG stills, into the run's stills/; read them; --step k shows each as step k ends
{{MR_CAST}}/bin/mr-cast steps [sceneIndex...] <flags>   # each step's words beside what it lights
{{MR_CAST}}/bin/mr-cast outline <flags>                 # the scenes and the length
```

## Show it

Start the player as a background command:

```bash
{{MR_CAST}}/bin/mr-cast play <flags>
```

It prints `mr-cast player: <url>` at once, voices the narration, and opens the browser when the voice is ready; clips already made are reused. The first use of a voice engine downloads its model, about 82 MB for Kitten or 90 MB for Kokoro. If it prints that voicing failed, the player plays silent with subtitles.

A voice is `engine:name`. The engines are `kitten` (the default, voice `kitten:luna`) and `kokoro` (voice `kokoro:af_heart`); `{{MR_CAST}}/bin/mr-cast voices` lists every voice with a description. Only when the user asks to change the voice, ask with AskUserQuestion for the engine, then for one of its voices from that list, and pass `--voice <engine:name>` to every command from then on. `{{MR_CAST}}/bin/mr-cast voices --sample <engine:name>` writes a sentence in that voice to a WAV file and prints its path, for a user who wants to hear one first.

For an MP4, run `{{MR_CAST}}/bin/mr-cast render <flags>` instead, with a long timeout or in the background. `--out <path>` picks the location. It prints the MP4's path, then the paths of `review.md` and `reading.md` copies when it saves outside the run.

## Tell the user

- The player's URL, and that the page opens once the voice is ready. Add: "Say 'save it as an MP4' when you want a file to share."
- For an MP4, its path.
- With review on, every finding as `severity file:line claim`, one per line, and the path of `review.md`, or that nothing looked wrong.
- In a pre-read, the reading order as `outline` prints it, one `path:line  check` line per item, and the path of `reading.md`.
