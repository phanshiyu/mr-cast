---
name: mr-cast-review
description: Turn the current git branch or merge request diff into an animated video walkthrough explaining architecture, flows, and code changes, for review. Use when the user asks for a video, walkthrough, or animation of a branch, pull request, or merge request.
---

# mr-cast review

Make an animated walkthrough of the current branch's diff with mr-cast. You write a storyboard JSON. mr-cast renders it in a browser player or as an MP4.

The CLI is `{{MR_CAST}}/bin/mr-cast`. Run every command from inside the user's repository. The wrapper finds a working Node itself, so call it directly rather than through `node`.

If a command prints `mr-cast <version> is available`, tell the user once, at the end of your reply, that they can ask you to upgrade mr-cast. Do not upgrade unless they ask.

## 1. Extract the diff

```bash
{{MR_CAST}}/bin/mr-cast extract [base]
```

- Pass a base branch when the user names one. Otherwise mr-cast picks origin's default branch, then `main` or `master`.
- Add `--working` when the changes are uncommitted or the user is still on the base branch.
- For a PR or MR number that isn't checked out, check it out first with `gh pr checkout <n>` or `glab mr checkout <n>`.

- Several walkthroughs can coexist in one repository, such as one per branch, or one rendering while you write the next. Pass `--name <slug>` (lowercase letters, digits and dashes) to `extract` and to every later command. Its files then live in `.mr-cast/<slug>/` instead of `.mr-cast/`.

The output is a hunk index: each file, its hunk ids (`h1`, `h2`, ...), and the changed lines with their line numbers. Full hunks go to `.mr-cast/hunks.json`. Don't read that file. Read the source files instead when a change needs more context to explain.

When unchanged code is needed to understand the change, such as the function that calls the changed one, a type it uses, or the config a value comes from, add those lines as a snippet.

```bash
{{MR_CAST}}/bin/mr-cast snippet src/db/client.ts:1-5
```

A snippet gets an id (`s1`, `s2`, ...) and its lines keep the file's own numbers. Show it in a `code` scene like a hunk. Snippets do not count toward coverage, and a later `extract` keeps them. Add only code you will show.

## 2. Ask what the video is for

Read the hunk index so you can name the areas of the change. Then ask the user with one `AskUserQuestion` call, before you write any scenes.

Ask only what the request leaves open. Skip a question when the user already answered it, such as "a simple video" (audience), "slowly" (pace), "focus on the migration" (focus), or `--simple`, `--pace` or `--no-voice` among the arguments. A request for a quick or short video answers the audience with the quick overview. Skip the call entirely when the user said to just render it, or when nothing is left open. Say in one line which choice you used for each question you skipped.

Every question is multiple choice. Put the recommended option first and end its label with "(Recommended)", so the user can accept every default by pressing enter.

1. Header "Audience", question "Who is this video for?"
   - "A reviewer of this change (Recommended)". Description: "Diagrams, then each change and its tests. Assumes they know the codebase."
   - "Someone new to this code". Description: "Walks the changed lines one at a time in plain words, after the code around them. Good for a second-language reader. Longer."
   - "A quick overview for the team". Description: "Diagrams and behavior, with very little code. Usually under 3 minutes."
2. Header "Focus", `multiSelect: true`, question "Anything to go deeper on? Everything is still covered."
   - First "All areas equally (Recommended)". Description: "Weigh each area by what a reviewer needs."
   - Then up to 3 options, each an area of this change in a few concrete words, such as "Rate limiter (Redis counter, 429)". Group small areas so the options cover the change. When the change has tests, one of the 3 can be "Walk through the test code", with the description "Step through each test's setup and assertions."
3. Header "Pace", question "How should it sound?"
   - "Normal pace (Recommended)". Description: "About 130 words a minute, with pauses between steps."
   - "Slower". Description: "A slower voice and longer pauses. Good for new readers or a second language."
   - "Faster". Description: "A quicker voice and shorter pauses."
   - "No voice, subtitles only". Description: "A silent video, timed for reading."

   When you already know the audience is someone new to this code, list "Slower (Recommended)" first and "Normal pace" second.

Also decide here whether the user wants the browser player or an MP4. They want an MP4 when they ask for a video file, an MP4 or a render, or ran a render command. Otherwise start the player.

Apply the answers:

- Audience. A reviewer gets the walkthrough described below. Someone new gets simple mode. Rerun `extract` with `--simple` and the same base and options, then follow [Simple mode](#simple-mode). A quick overview gets [Overview mode](#overview-mode).
- Focus. Give each picked area more depth, such as code steps on its key lines, its own diagram, and its edge cases. Still cover every other area, briefly. With nothing picked, or only "All areas equally", weigh each area by what a reviewer needs.
- Pace. Pass `--pace normal`, `--pace slower` or `--pace faster` to every later `validate`, `outline`, `play` and `render`. Later runs keep the last pace, so pass normal too. For "No voice, subtitles only", pass `--no-voice` to `play` and `render` as well.

## 3. Write `.mr-cast/storyboard.json`

With `--name <slug>`, write `.mr-cast/<slug>/storyboard.json` instead.

The JSON must match this TypeScript schema exactly.

```ts
{{STORYBOARD_TYPES}}
```

Then check it.

```bash
{{MR_CAST}}/bin/mr-cast validate
```

Fix every error and rerun until it prints `✓ storyboard ok`. Resolve these warnings too, because each one marks a gap a reviewer would notice:

- A hunk is not shown or tests are not walked through. Add a code scene for the hunk, link it from a `tests` scene case, or add a `skipped` entry with a reason.
- The scenes are out of top-down order, a diagram comes after code, a change to several files has no diagram, or many code scenes rest on too few diagrams. Move or add scenes as the warning says.
- The storyboard has no `tests` scene. Add one as described below.

Treat other warnings as advice.

### Writing a good storyboard

The viewer is a reviewer who has not read the diff. A good walkthrough lets them understand the change, judge whether it is correct, and know what to check, without reading the code themselves. Complete coverage of the important details matters more than a short video. When you are unsure whether a detail belongs, include it.

- Plan before you write scenes. Decide the problem this change solves, the one to three things a reviewer must check (risks, questionable choices, missing cases), the key behaviors ("when X happens, Y happens"), and which tests prove each behavior. Every scene must serve one of these.
- Order the video top-down. Start with the overview, then high-level diagrams of the system and of the change, then the code, then the tests. Put all the high-level diagrams (`arch`, `sequence`, `flow`, `er`, `state`, `mermaid`) before the first code scene, and never go back to a diagram scene once the code starts. A code scene may still carry a `flow` step diagram beside its code. The reviewer should know where each piece fits before they see its code.
- Open with one `intent` scene. The narration says what problem the change solves and what it does about it. The bullets are the review concerns from your plan: at most three, one short line each, concrete enough to act on ("a crash after claiming leaves the delivery stuck forever"), not a list of features. State the risk honestly. `high` means data migrations, auth, money, or public API breaks.
- When the change touches more than two files, add a `files` scene right after the intent. Leave out `files` and it lists every changed file from the diff as a tree, with line counts and tests marked. Give the files the narration names a short `notes` entry each, under 60 characters, and the scene spotlights them in order. To name the files one at a time, give the scene `steps` instead, each a `path` and the words to `say`, and the file lights just before its words.
- Follow the intent with diagrams. Begin with an `arch` scene of the components the change touches and how they connect. Then diagram the change itself. Whenever a behavior can be shown as a diagram, draw it in the diagram section, then show the code that implements it later. A change with four or more code scenes usually needs at least two diagrams, such as a `sequence` for a call chain and a `state` for a lifecycle. Component interactions, call order, a lifecycle, a schema, and data moving through steps all belong in diagrams.
- Use a `flow` scene when the change alters how a request or data moves. Each step names a real actor (function, service, component) and shows the payload as it looks after that step. Use 3 to 7 steps.
- Use a `sequence` scene when the order of calls between components matters, such as a new hop, a call moved before or after another, async work, or retries. List messages in time order, use `return` for responses and `async` for fire-and-forget, and mark only the participants and messages this change adds or alters as `modified`. Use a self-message (`from` equal to `to`) for significant internal work. Keep it to 6 participants and 12 messages. Prefer `flow` when the data's shape is the story, and `sequence` when who calls whom is.
- Use an `er` scene when the diff changes a schema, such as migrations, ORM models, or table definitions. Read the migration or model files, and show each changed table plus its directly related tables. List keys and the fields the change touches, and mark each with `change` (`added`, `removed` or `modified`). Show the migration hunk in a `code` scene later, in the code section.
- Use a `state` scene when the change touches a lifecycle or status machine, such as a new status, a removed or new transition, or a changed guard. Find the states in enums, status columns, or reducers. Set `initial` to the starting state, mark terminal states `final`, label each transition with its event or guard, and mark what the change added, removed or modified. Keep it to 10 states.
- Use a `mermaid` scene only for a diagram no other scene covers, such as a class diagram, gantt chart, git graph, or pie chart. Prefer `arch`, `sequence`, `er`, `state`, and `flow`, because they highlight what the change touched and Mermaid cannot. Keep Mermaid diagrams small, about 12 nodes or fewer, so the text stays readable. `validate` checks Mermaid syntax, but run `{{MR_CAST}}/bin/mr-cast still <sceneIndex>` on each mermaid scene to confirm it renders and fits.
- Use a `table` scene for facts that line up in rows, such as config or env changes, API parameters, error codes, or a decision matrix. Mark added and removed rows with `change`. Write a changed value as `{ "before": "0", "after": "3" }`, and the scene strikes the old value beside the new one. List row indexes in `highlight` in the order the narration names them, or give the scene `steps`, each a `row` and the words to `say`, so each row lights just before its words. Keep it to 10 rows and 6 columns, and put it before the code with the diagrams.
- Use a `chart` scene when the change moves a number, such as latency, bundle size, memory, a count, or a limit. Use `bar` for categories like p50, p95 and p99, and `line` for a trend over time or load. Give two series named `before` and `after` to get a change badge on each label, and set `better` to `lower` or `higher` so the badges read green or red. Use real measured or documented values, never invented ones. Set `annotation` on the one point the narration explains.
- Use a `timeline` scene when timing is the story, such as retries and backoff, timeouts, expiry windows, a cron schedule, or a rollout plan. Place each event at its real time in one `unit`, and draw waits and windows as `spans`. Keep it to 8 events and 4 spans.
- Show one idea per code scene. A `code` scene covers one change, and the narration explains exactly the lines highlighted. When a hunk mixes several changes, split them into separate scenes. The `calloutText` must be about the code on screen, never a concern from elsewhere.
- Say behavior outright in the narration, with real values: "after twenty requests in a minute the limiter answers too many requests", "a failed delivery retries with doubling delays and is marked dead after eight attempts". The reviewer should never have to read the code to learn what happens. When a scene explains a behavior without showing its code, name the file and function it lives in.
- Explain each rule once, completely, in one place. If a behavior spans several files, such as when something retries and when it gives up, explain it fully in one `flow`, `state` or `sequence` scene instead of in pieces across code scenes.
- Show every substantive hunk in a `code` scene. Skip only formatting, renames, generated files, and boilerplate, and record each skipped hunk in `skipped` with a short reason. Reference hunks by `hunkId` and never paste code into the storyboard.
- Set `focusLinesAfter` from the line numbers in the index, as numbers or `"start-end"` strings, on the lines the narration talks about. Use `focusLinesBefore` for removed code. Always set a focus on hunks with more than 12 changed lines.
- Highlight at most 8 lines per range and 4 ranges per scene. The ranges play top to bottom, one at a time, so narrate them in that order. Consecutive plain numbers join into one range, and each `"start-end"` string is a range of its own, so write `["11-12", "13", "14-17"]` to walk contiguous lines as three steps.
- Set `flow` on a code scene whose lines carry control flow, such as a branch, a retry-or-give-up decision, an allow-or-reject path, a state change, or a multi-step algorithm. The scene then draws a step diagram beside the code, and each step lights up with its range. Split the focus into one range per step, up to 4, and give `flow` one entry per range in the same top-to-bottom order. Write each `label` in plain words about what that range does, such as "count the request in Redis", in under 60 characters. Add an `outcome` to a step that branches or ends the flow, such as "past twenty it answers too many requests". Leave `flow` off declarations, config, and plain data shapes, which stay plain code scenes.
- Use `steps` instead of `focusLinesAfter` and `flow` when the voice should track the lines. Each step names its `lines` (or `oldLines` for removed code) and the words to `say` while they are highlighted, and lasts as long as those words take. Write the steps top to bottom, at most 8 per scene, and give every step a `label` to draw the step diagram beside the code. The scene's `narration` is then the intro spoken before the first step, so use it to say what the code is. Simple mode uses `steps` on every code scene.
- Always end with the tests. Tests are how the reviewer judges whether the code is correct, so give them as much care as the code. Add a `tests` scene after the code it tests. List every relevant test case with its name as written in code, the behavior it proves in plain words, and its `status`. Use `existing` for an unchanged test that covers the changed code. Set each case's `hunkId` to the hunk that holds its code.
- In the same `tests` scene, list in `gaps` the important behaviors this change introduces that no test covers, such as error paths, limits, concurrency, and a failing dependency. Check each key behavior from your plan against the tests. Leave `gaps` empty only when every one has a test.
- After the `tests` scene, add `code` scenes on the key test hunks. Focus on the inputs that set up each case and the assertions that check it, not on setup boilerplate. Narrate which scenario each test proves.
- When the change has no tests, still add a `tests` scene, with `cases: []` and the untested behaviors in `gaps`. The video then says plainly that the change ships without tests and what that leaves unverified.
- Write narration to be spoken aloud, 15 to 50 words per scene, and at most 35 over an `arch` or `sequence` diagram, where the viewer learns the names the rest of the video uses. A text-to-speech voice reads it, so use short sentences and plain words.
- Spell out symbols and code the way a person would say them: "the create order function", not `createOrder()`, and "four twenty-nine" or "too many requests", not `429`. Avoid markdown, slashes, arrows, and abbreviations the voice could misread.
- Scene length comes from the spoken audio, or from word count without it, so never compute frames or seconds.
- Let the change set the length. If the user asks for a shorter or longer video, cut or add detail, not coverage. Cover every hunk and behavior a reviewer needs to judge the change, and cut only what is genuinely trivial. Even a small change needs an overview, a diagram, its code, and its tests. A large one can run several minutes. List each deliberate omission in `skipped` with its reason. Give each scene a short `chapter` title.

### Simple mode

Use simple mode when the user picks "Someone new to this code", or asks for it with phrases like "explain like I'm stupid", "ELI5", "simple", "line by line", "for a non-native speaker", "I'm new to this", or `--simple` among the arguments. Pass `--simple` to `extract`. It records the style in `meta.json`, and `validate` and `outline` then say `simple style` and check the rules below.

The viewer is new to the codebase, reads English as a second language, or both. They want to understand every line. A long video is fine.

Build context first. Before you write scenes, read what the diff touches but does not show: the callers of each changed function, the definitions and types it uses, the tests, and the config a value comes from. Add the key pieces with `{{MR_CAST}}/bin/mr-cast snippet` and show them in `code` scenes before the change, as what this code does today. Diagrams still come first. Draw the system and the change before any code, and use them to anchor the names the steps will use.

Write every `code` scene with `steps`. Walk the changed lines in order, one line or a small group of up to 3 lines per step, until every changed line of the hunk is in a step. `validate` warns about the lines you miss. Spend the time where the code is hard. Put imports in one short step, and fold a closing brace into the step before it. Split a dense line, such as one that builds a key from several values, into two steps that each explain one part. Give the scene a short `narration` that says what the thing is before the steps say what it does, such as "This is the rate limit function. It runs before each request to the orders route."

Write for someone reading subtitles in a second language:

- Use plain words. Prefer "gets" to "retrieves" and "stops" to "short-circuits".
- Keep sentences under 18 words, one idea each. `validate` warns about longer ones.
- Name what a thing is before what it does. "Redis is a fast store for small values. The limiter keeps its counters there."
- Avoid idioms. Avoid jargon, or define it the first time. "A middleware is a function that runs before the route."
- Say the value and its effect. "Max is twenty, so the twenty first request in a minute is refused."
- In each step, say what the line does to the data, not how the syntax reads, unless the syntax is the point.

### Overview mode

Use overview mode when the user wants a quick overview for the team. The viewer wants to know what changed and why, not how each line works.

- Keep the intent scene, the diagrams, and the tests scene.
- Show at most 3 `code` scenes, on the lines that carry the main behavior. List the other substantive hunks in `skipped` with the reason "covered by the diagrams in this overview". Show no test code, and list test hunks in `skipped` with the reason "the tests scene covers them".
- Say behavior in the diagram narration, with real values, instead of in code scenes.
- Aim for under 3 minutes.

## 4. Check the plan with the user

Print the plan of the walkthrough, with the same `--pace` as before.

```bash
{{MR_CAST}}/bin/mr-cast outline
```

When you are about to start the player, show the outline and go straight to the next step. The player reloads as you edit, so the user can ask for changes while it plays.

Before a render, show the outline as it prints, with at most one sentence of your own. Then ask with one `AskUserQuestion` call, header "Plan", question "Render this plan?":

- "Render it (Recommended)". Description: "Make the MP4 now."
- "Make it shorter". Description: "Cut minor scenes and trim the narration."
- "Make it longer". Description: "Add more steps, diagrams and edge cases."

The user can pick Other to describe any other change. Apply the change and rerun `validate`. If the change was substantial, show the new outline and ask again. Render once they pick "Render it".

If the user's request already said to just render, or not to ask, skip the question.

## 5. Show it

Start the player as a background command so it keeps running.

```bash
{{MR_CAST}}/bin/mr-cast play
```

`play` and `render` voice the narration first. The first run downloads a voice model of about 90 MB into `~/.cache/mr-cast`, which takes a minute. After that, each new or changed scene takes a few seconds to speak. Options for both commands:

- `--pace slower|normal|faster` sets how fast the voice speaks and how long it pauses. Later runs keep the last choice.
- `--voice <name>` picks the voice: `af_heart` (default), `af_bella`, `am_michael`, `bf_emma`, or `bm_george`. Later runs keep the last choice.
- `--no-voice` makes a silent walkthrough with subtitles, timed for reading.

If the voice model cannot load, the command prints a warning and continues without voice. Tell the user if that happens.

It prints `mr-cast player: http://127.0.0.1:<port>` and opens the browser. Give the user that URL and tell them to click play, since a voiced walkthrough does not autoplay. The player also has a speed control from 0.75x to 1.5x. The player reloads when `storyboard.json` changes, after it voices any changed narration, so edit and revalidate to iterate while it runs.

If the user wants an MP4, run `{{MR_CAST}}/bin/mr-cast render` instead of `play` (add `--out <path>` to choose the location). It takes minutes, so give it a long timeout or run it in the background. It writes the MP4 into the data directory, named after the storyboard title, such as `.mr-cast/rate-limiting-for-the-orders-api.mp4`, and prints its path. The MP4 has a chapter marker for each chapter title. Give the user that path. The first render downloads a headless Chrome and takes a few minutes. Renders of different `--name` runs can run at the same time.

To check how scenes look without a browser, run `{{MR_CAST}}/bin/mr-cast still [sceneIndex...]` and read the PNGs it prints. Do this when a scene has long text, many nodes, or a large hunk.
