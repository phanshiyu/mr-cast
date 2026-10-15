---
name: mr-cast-explain
description: Turn what you just explained (a system, a flow, a bug, a design) into an animated walkthrough with diagrams and real code. Use when the user asks to animate, visualize, or make a video of an explanation, such as "animate that", "show me", or "make a video of this".
---

# mr-cast explain

You have just explained something in this conversation, such as how a subsystem works, why a bug happens, or how a design fits together. Now turn that explanation into an animated walkthrough with mr-cast. You write a storyboard JSON with diagrams and real code snippets. mr-cast plays it in a browser player or renders it as an MP4.

The video retells the explanation you already gave. It is not a new investigation. Open files again only to get exact line numbers for the code you show.

The CLI is `{{MR_CAST}}/bin/mr-cast`. Run every command from the directory your explanation is about, usually the repository root, because snippet paths are relative to it. The wrapper finds a working Node itself, so call it directly rather than through `node`.

If a command prints `mr-cast <version> is available`, tell the user once, at the end of your reply, that they can ask you to upgrade mr-cast. Do not upgrade unless they ask.

## 1. Ask what the video is for

Decide the scope of the video first: the key points of your explanation and the code behind each. Then ask the user with one `AskUserQuestion` call.

Ask only what the request leaves open. Skip a question when the user already answered it, such as "a simple video" (audience), "slowly" (pace), "focus on the retry logic" (focus), or `--simple`, `--pace` or `--no-voice` among the arguments. A request for a quick or short video answers the audience with the quick overview. Skip the call entirely when the user said to just render it, or when nothing is left open. Say in one line which choice you used for each question you skipped.

Every question is multiple choice. Put the recommended option first and end its label with "(Recommended)", so the user can accept every default by pressing enter.

1. Header "Audience", question "Who is this video for?"
   - "A teammate who knows this code (Recommended)". Description: "Diagrams, then the code behind each point."
   - "Someone new to this code". Description: "Walks the code one line at a time in plain words, after the code around it. Good for a second-language reader. Longer."
   - "A quick overview for the team". Description: "Diagrams and behavior, with very little code. Usually under 3 minutes."
2. Header "Focus", `multiSelect: true`, question "Anything to go deeper on? Everything is still covered."
   - First "All points equally (Recommended)". Description: "Weigh each point by what the viewer needs."
   - Then up to 3 options, each a key point of your explanation in a few concrete words, such as "Retry with doubling waits". Group small points so the options cover the explanation.
3. Header "Pace", question "How should it sound?"
   - "Normal pace (Recommended)". Description: "About 130 words a minute, with pauses between steps."
   - "Slower". Description: "A slower voice and longer pauses. Good for new readers or a second language."
   - "Faster". Description: "A quicker voice and shorter pauses."
   - "No voice, subtitles only". Description: "A silent video, timed for reading."

   When you already know the audience is someone new to this code, list "Slower (Recommended)" first and "Normal pace" second.

Also decide here whether the user wants the browser player or an MP4. They want an MP4 when they ask for a video file, an MP4 or a render, or ran a render command. Otherwise start the player.

Apply the answers:

- Audience. A teammate gets the walkthrough described below. Someone new gets simple mode. Pass `--simple` to `explain init`, then follow [Simple mode](#simple-mode). A quick overview gets [Overview mode](#overview-mode).
- Focus. Give each picked point more depth, such as code steps on its key lines, its own diagram, and its edge cases. Still cover every other point, briefly. With nothing picked, or only "All points equally", weigh each point by what the viewer needs.
- Pace. Pass `--pace normal`, `--pace slower` or `--pace faster` to every later `explain validate`, `explain outline`, `explain play` and `explain render`. Later runs keep the last pace, so pass normal too. For "No voice, subtitles only", pass `--no-voice` to `explain play` and `explain render` as well.

## 2. Start the explanation

```bash
{{MR_CAST}}/bin/mr-cast explain init --title "How the rate limiter works"
```

Give a short title for what you explained. Each explanation gets its own data directory, `.mr-cast/explain/<slug>` in the git repository (or in the current directory outside one), where the slug comes from the title. `init` prints the directory and the slug.

Later `explain` commands use the most recently started explanation and name it on stderr. Several explanations can coexist. Pass `--name <slug>` to any `explain` command to work on another one, or to `init` to choose the slug yourself. `--dir <path>` uses any directory instead.

Running `init` again with the same title reopens that explanation and keeps its storyboard and snippets, and says so. Add `--reset` to start it over. A different title starts a new explanation.

Add `--simple` for simple mode, when the user picked "Someone new to this code" or asked for a simple, line-by-line explanation. See [Simple mode](#simple-mode).

## 3. Add the code worth showing

List the files and functions your explanation relied on. For each piece of code a viewer should see, add a snippet of the real lines.

```bash
{{MR_CAST}}/bin/mr-cast explain snippet src/limiter.ts:12-40 src/server.ts:5-18
```

- Each snippet is one `file:start-end` argument, or `file start-end`. A snippet holds at most 80 lines. Add the part the explanation needs, such as one function, rather than a whole file.
- The output gives each snippet an id (`s1`, `s2`, ...) and prints its lines with the file's own line numbers. Use those numbers in `focusLinesAfter`.
- Adding the same file and range again keeps its id and rereads the lines.
- Add only code you will show in a `code` scene. Code you mention without showing needs no snippet.

## 4. Write the storyboard

Write `storyboard.json` in the data directory. The JSON must match this TypeScript schema exactly.

```ts
{{STORYBOARD_TYPES}}
```

In an explanation every code scene's `hunkId` is a snippet id. Leave out `risk` on the intent scene and leave out `skipped`, since there is no change to review.

Then check it.

```bash
{{MR_CAST}}/bin/mr-cast explain validate
```

Fix every error and rerun until it prints `✓ storyboard ok`. Resolve the warnings about scene order, diagram count, and focus too. Treat other warnings as advice.

### Telling the story

The viewer is someone who did not read your explanation. A good walkthrough lets them understand the idea from the video alone. Complete coverage of the important details matters more than a short video. When you are unsure whether a detail belongs, include it.

- Plan before you write scenes. Take the key points of your explanation, the behaviors behind them ("when X happens, Y happens"), and the code that carries each one. Every scene must serve one of these.
- Order the video top-down. Start with the overview, then high-level diagrams, then the code, then any tests. Put all the high-level diagrams (`arch`, `sequence`, `flow`, `er`, `state`, `mermaid`) before the first code scene, and never go back to a diagram scene once the code starts. A code scene may still carry a `flow` step diagram beside its code. The viewer should know where each piece fits before they see its code.
- Open with one `intent` scene. The summary states the idea in one sentence. The bullets are the key points of the explanation, at most four, one short line each. For a bug, they are the symptom, the cause, and the fix or the way to avoid it.
- Show anything that can be a diagram as an animated diagram. Draw it in the diagram section, then show the code that implements it later. Pick the scene that fits the shape of the idea. An explanation with four or more code scenes usually needs at least two diagrams, such as a `sequence` for a call chain across functions and a `state` for a lifecycle.
- Use an `arch` scene for structure, meaning the parts and how they connect, whether they are services, people, teams or documents. Set `highlight` on the nodes the explanation centers on, and the scene badges them KEY.
- Give each `arch` node and `sequence` participant an `icon`, any Lucide icon name in kebab-case such as `server`, `database`, `user`, `users`, `headset`, `building-2` or `file-text` (https://lucide.dev/icons), and a short `caption` that says what it is, such as `datastore` or `customer`. A diagram need not be software: people, teams, documents and places work the same way. Put nodes that belong together in one `group`, such as a team, and use `"layout": "TB"` for a hierarchy or a hand-off from top to bottom. Set an edge's `direction` to `both` for a two-way relationship or `none` for a plain link, and its `style` to `solid` for a relationship where nothing moves or `dashed` for a weak or indirect one. Use `tone` to tell kinds of nodes apart, such as people `good` and systems `neutral`. `validate` rejects an icon Lucide lacks and suggests close names. Storyboards that use the older `kind` and `modified` still work, but write the new fields.
- Use a `sequence` scene when the order of calls matters, such as a request path, async work, or retries. List messages in time order, use `return` for responses and `async` for fire-and-forget, and use a self-message (`from` equal to `to`) for significant internal work. Mark the messages the explanation turns on as `modified`, and the key participants with `highlight`. Keep it to 6 participants and 12 messages.
- Use a `state` scene for a lifecycle or status machine. Set `initial`, mark terminal states `final`, and label each transition with its event or guard. Keep it to 10 states.
- Use an `er` scene for a data model. Show each table or model that matters with its keys and the fields the explanation uses.
- Use a `flow` scene when data moving through steps is the story. Each step names a real actor (function, service, component) and shows the payload as it looks after that step. Use 3 to 7 steps.
- Set `flow` on a `code` scene whose lines carry control flow, such as a branch, a retry-or-give-up decision, an allow-or-reject path, or a multi-step algorithm. The scene then draws a step diagram beside the code, and each step lights up with its range. Split the focus into one range per step, up to 4, and give `flow` one entry per range in the same top-to-bottom order. Write each `label` in plain words about what that range does, in under 60 characters. Add an `outcome` to a step that branches or ends the flow.
- Use `steps` instead of `focusLinesAfter` and `flow` when the voice should track the lines. Each step names its `lines` and the words to `say` while they are highlighted, and lasts as long as those words take. Write the steps top to bottom, at most 8 per scene, and give every step a `label` to draw the step diagram beside the code. The scene's `narration` is then the intro spoken before the first step, so use it to say what the code is. Simple mode uses `steps` on every code scene.
- Use a `mermaid` scene only for a diagram no other scene covers, such as a class diagram. Keep it to about 12 nodes, and run `explain still <sceneIndex>` to confirm it renders and fits.
- Use a `table` scene for facts that line up in rows, such as config options, API parameters, or error codes. List row indexes in `highlight` in the order the narration names them, or give the scene `steps`, each a `focus` and the words to `say`, so each row, column or cell lights just before its words. Keep it to 10 rows and 6 columns, and put it before the code with the diagrams.
- Use a `chart` scene when the explanation turns on a number, such as latency per percentile, a size, or a count over time. Use `bar` for categories and `line` for a trend. Use real values from the code, docs or measurements, never invented ones. Set `annotation` on the one point the narration explains.
- Use a `timeline` scene when timing is the story, such as retries and backoff, a timeout, a token's lifetime, or a schedule. Place each event at its real time in one `unit`, and draw waits and windows as `spans`. Keep it to 8 events and 4 spans.
- Move the viewer's attention with `steps` whenever the narration talks about one part of a diagram at a time. Each step gives a `focus` and the words to `say`, and what it focuses lights half a second before those words while the rest dims. A `focus` is one ref or an array of them. In an `arch` it is a node id, an edge `"a->b"` (`"a-b"` for either direction) or a group `"group:Name"`; in a `sequence` a message index, an `"a-b"` range or a participant id; in an `er` an entity id, a field `"orders.status"` or a relation `"users->orders"`; in a `state` a state id, a transition `"pending->paid"` or its label; in a `table` a row index, a column `"col:Header"` or a cell `"Header@row"`; in a `chart` a label, a series `"series:name"` or one value `"series@label"`; in a `timeline` an event index or range, or a span `"span:label"`; in `files` a path; in `tests` a case index or a gap `"gap:0"`; in an `intent` a bullet index. Walk a path by focusing a node, then the edge leaving it, then the next node, or a node and its edge together. A `sequence` and a `timeline` also draw their messages or events as the steps reach them, so focus those in order until each has a step. A `flow` gets a `say` on every step instead. The diagram draws in before the voice starts, so the scene's `narration` becomes a one-sentence intro. Keep to 8 steps a scene, and leave steps off a small diagram the narration takes in as a whole.
- Use a `files` scene when where the code lives helps the viewer, such as a feature spread over several modules. List each file as `{ "path": "src/limiter.ts" }` in `files`, since an explanation has no diff to list. Give each a short `notes` entry, and put the scene before the code. To name the files one at a time, give the scene `steps`, each a `focus` path and the words to `say`.
- Leave `change` off `er` and `state` items unless the explanation is itself about a change, such as a bug fix that adds a state.
- Show one idea per code scene, and narrate exactly the lines highlighted. Set `focusLinesAfter` from the snippet's line numbers, as numbers or `"start-end"` strings. A snippet longer than 12 lines needs a focus. Without one, the whole snippet is highlighted as one step.
- Highlight at most 8 lines per range and 3 ranges per scene (4 with `flow`). The ranges play top to bottom, one at a time, so narrate them in that order. Each `"start-end"` string is a range of its own, so write `["11-12", "13", "14-17"]` to walk contiguous lines as three steps.
- The `calloutText` must be about the code on screen.
- Explain each rule once, completely, in one place. If a behavior spans several files, explain it fully in one `flow`, `sequence` or `state` scene instead of in pieces across code scenes.
- Add a `tests` scene only when tests are part of the explanation, such as a bug that no test caught. List each case's name as written in code and what it proves, and put the important untested behaviors in `gaps`.

### Narration

- The narration is the explanation itself, spoken. Say behavior outright with real names and values, such as "after twenty requests in a minute the limiter answers too many requests". The viewer should never have to read the code to learn what happens. When a scene explains a behavior without showing its code, name the file and function it lives in.
- Write 15 to 50 words per scene, to be spoken aloud, and at most 35 over an `arch` or `sequence` diagram, where the viewer learns the names the rest of the video uses. A text-to-speech voice reads it, so use short sentences and plain words.
- Spell out symbols and code the way a person would say them. Say "the create order function", not `createOrder()`, and "four twenty-nine", not `429`. Avoid markdown, slashes, arrows, and abbreviations the voice could misread.
- Scene length comes from the spoken audio, or from word count without it, so never compute frames or seconds.
- Let the explanation set the length. If the user asks for a shorter or longer video, cut or add detail, not key points. Cover every point a viewer needs, and cut only what is genuinely trivial. Give each scene a short `chapter` title.

### Simple mode

Use simple mode when the user picks "Someone new to this code", or asks for it with phrases like "explain like I'm stupid", "ELI5", "simple", "line by line", "for a non-native speaker", "I'm new to this", or `--simple` among the arguments. Pass `--simple` to `explain init`. It records the style in `meta.json`, and `explain validate` and `explain outline` then say `simple style` and check the rules below.

The viewer is new to the codebase, reads English as a second language, or both. They want to understand every line. A long video is fine.

Build context first. Beyond the code your explanation named, read the callers of each function you show, the definitions and types it uses, the tests, and the config a value comes from. Add the key pieces as snippets and show them in `code` scenes before the code they support, as what this code does today. Diagrams still come first. Draw the idea before any code, and use the diagrams to anchor the names the steps will use. Walk every diagram in `steps`, `arch` included, one or two short sentences each, so the viewer sees each part as the voice names it. Prefer a diagram walked in steps to one shown all at once.

Write every `code` scene with `steps`. Walk the snippet's lines in order, one line or a small group of up to 3 lines per step. Spend the time where the code is hard. Put imports in one short step, and fold a closing brace into the step before it. Split a dense line, such as one that builds a key from several values, into two steps that each explain one part. Give the scene a short `narration` that says what the thing is before the steps say what it does, such as "This is the rate limit function. It runs before each request to the orders route."

Write for someone reading subtitles in a second language:

- Use plain words. Prefer "gets" to "retrieves" and "stops" to "short-circuits".
- Keep sentences under 18 words, one idea each. `explain validate` warns about longer ones.
- Name what a thing is before what it does. "Redis is a fast store for small values. The limiter keeps its counters there."
- Avoid idioms. Avoid jargon, or define it the first time. "A middleware is a function that runs before the route."
- Say the value and its effect. "Max is twenty, so the twenty first request in a minute is refused."
- In each step, say what the line does to the data, not how the syntax reads, unless the syntax is the point.

### Overview mode

Use overview mode when the user wants a quick overview for the team. The viewer wants the idea and how the parts fit, not how each line works.

- Keep the intent scene and the diagrams.
- Show at most 3 `code` scenes, on the lines that carry the main behavior.
- Say behavior in the diagram narration, with real values, instead of in code scenes.
- Aim for under 3 minutes.

## 5. Check the plan with the user

Print the plan of the walkthrough, with the same `--pace` as before.

```bash
{{MR_CAST}}/bin/mr-cast explain outline
```

When you are about to start the player, show the outline and go straight to the next step. The player reloads as you edit, so the user can ask for changes while it plays.

Before a render, show the outline as it prints, with at most one sentence of your own. Then ask with one `AskUserQuestion` call, header "Plan", question "Render this plan?":

- "Render it (Recommended)". Description: "Make the MP4 now."
- "Make it shorter". Description: "Cut minor scenes and trim the narration."
- "Make it longer". Description: "Add more steps, diagrams and edge cases."

The user can pick Other to describe any other change. Apply the change and rerun `explain validate`. If the change was substantial, show the new outline and ask again. Render once they pick "Render it".

If the user's request already said to just render, or not to ask, skip the question.

## 6. Show it

Start the player as a background command so it keeps running.

```bash
{{MR_CAST}}/bin/mr-cast explain play
```

`play` and `render` voice the narration first. The first run downloads a voice model of about 90 MB into `~/.cache/mr-cast`, which takes a minute. After that, each new or changed scene takes a few seconds to speak. Options for both commands:

- `--pace slower|normal|faster` sets how fast the voice speaks and how long it pauses. Later runs keep the last choice.
- `--voice <name>` picks the voice: `af_heart` (default), `af_bella`, `am_michael`, `bf_emma`, or `bm_george`. Later runs keep the last choice.
- `--no-voice` makes a silent walkthrough with subtitles, timed for reading.

If the voice model cannot load, the command prints a warning and continues without voice. Tell the user if that happens.

It prints `mr-cast player: http://127.0.0.1:<port>` and opens the browser. Give the user that URL and tell them to click play, since a voiced walkthrough does not autoplay. The player also has a speed control from 0.75x to 1.5x. The player reloads when `storyboard.json` changes, after it voices any changed narration, so edit and revalidate to iterate while it runs.

If the user wants an MP4, run `{{MR_CAST}}/bin/mr-cast explain render` instead of `explain play` (add `--out <path>` to choose the location). It takes minutes, so give it a long timeout or run it in the background. It writes the MP4 into the explanation's directory, named after the storyboard title, such as `how-the-rate-limiter-works.mp4`, and prints its path. The MP4 has a chapter marker for each chapter title. Give the user that path. The first render downloads a headless Chrome and takes a few minutes.

To check how scenes look without a browser, run `{{MR_CAST}}/bin/mr-cast explain still [sceneIndex...]` and read the PNGs it prints. Do this when a scene has long text, many nodes, or a long snippet.
