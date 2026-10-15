---
name: explain-in-animation
description: Turn what you just explained (a system, a flow, a bug, a design) into an animated video walkthrough with diagrams and real code. Use when the user asks to animate, visualize, or make a video of an explanation, such as "animate that", "show me", or "make a video of this".
---

# Explain in animation

You have just explained something in this conversation, such as how a subsystem works, why a bug happens, or how a design fits together. Now turn that explanation into an animated walkthrough with mr-cast. You write a storyboard JSON with diagrams and real code snippets. mr-cast plays it in a browser player or renders it as an MP4.

The video retells the explanation you already gave. It is not a new investigation. Open files again only to get exact line numbers for the code you show.

The CLI is `{{MR_CAST}}/bin/mr-cast`. Run every command from the directory your explanation is about, usually the repository root, because snippet paths are relative to it. The wrapper finds a working Node itself, so call it directly rather than through `node`.

## 1. Start the explanation

```bash
{{MR_CAST}}/bin/mr-cast explain init
```

It prints the data directory, `.mr-cast/explain` in the git repository (or in the current directory outside one). Every `explain` command uses that directory. Pass `--dir <path>` to each of them to use another one.

`init` keeps an existing storyboard and its snippets, and says so. When they belong to an earlier, different explanation, run `explain init --reset` to start clean.

## 2. Add the code worth showing

List the files and functions your explanation relied on. For each piece of code a viewer should see, add a snippet of the real lines.

```bash
{{MR_CAST}}/bin/mr-cast explain snippet src/limiter.ts:12-40 src/server.ts:5-18
```

- Each snippet is one `file:start-end` argument, or `file start-end`. A snippet holds at most 80 lines. Add the part the explanation needs, such as one function, rather than a whole file.
- The output gives each snippet an id (`s1`, `s2`, ...) and prints its lines with the file's own line numbers. Use those numbers in `focusLinesAfter`.
- Adding the same file and range again keeps its id and rereads the lines.
- Add only code you will show in a `code` scene. Code you mention without showing needs no snippet.

## 3. Write the storyboard

Write `storyboard.json` in the data directory. The JSON must match this TypeScript schema exactly.

```ts
{{STORYBOARD_TYPES}}
```

In an explanation every code scene's `hunkId` is a snippet id. Leave out `risk` on the intent scene and leave out `skipped`, since there is no change to review.

Then check it.

```bash
{{MR_CAST}}/bin/mr-cast explain validate
```

Fix every error and rerun until it prints `✓ storyboard ok`. Resolve the warnings about scene order and focus too. Treat other warnings as advice.

### Telling the story

The viewer is someone who did not read your explanation. A good walkthrough lets them understand the idea from the video alone. Complete coverage of the important details matters more than a short video. When you are unsure whether a detail belongs, include it.

- Plan before you write scenes. Take the key points of your explanation, the behaviors behind them ("when X happens, Y happens"), and the code that carries each one. Every scene must serve one of these.
- Order the video top-down. Start with the overview, then high-level diagrams, then the code. The viewer should know where each piece fits before they see its code.
- Open with one `intent` scene. The summary states the idea in one sentence. The bullets are the key points of the explanation, at most four, one short line each. For a bug, they are the symptom, the cause, and the fix or the way to avoid it.
- Show anything that can be a diagram as an animated diagram, then show the code that implements it. Pick the scene that fits the shape of the idea.
- Use an `arch` scene for structure, meaning the components and how they connect. Set `modified` on the nodes the explanation centers on, and the scene badges them as key.
- Use a `sequence` scene when the order of calls matters, such as a request path, async work, or retries. List messages in time order, use `return` for responses and `async` for fire-and-forget, and use a self-message (`from` equal to `to`) for significant internal work. Mark the steps the explanation turns on as `modified`. Keep it to 6 participants and 12 messages.
- Use a `state` scene for a lifecycle or status machine. Set `initial`, mark terminal states `final`, and label each transition with its event or guard. Keep it to 10 states.
- Use an `er` scene for a data model. Show each table or model that matters with its keys and the fields the explanation uses.
- Use a `flow` scene when data moving through steps is the story. Each step names a real actor (function, service, component) and shows the payload as it looks after that step. Use 3 to 7 steps.
- Set `flow` on a `code` scene whose lines carry control flow, such as a branch, a retry-or-give-up decision, an allow-or-reject path, or a multi-step algorithm. The scene then draws a step diagram beside the code, and each step lights up with its range. Split the focus into one range per step, up to 4, and give `flow` one entry per range in the same top-to-bottom order. Write each `label` in plain words about what that range does, in under 60 characters. Add an `outcome` to a step that branches or ends the flow.
- Use a `mermaid` scene only for a diagram no other scene covers, such as a class diagram. Keep it to about 12 nodes, and run `explain still <sceneIndex>` to confirm it renders and fits.
- Leave `change` off `er` and `state` items unless the explanation is itself about a change, such as a bug fix that adds a state.
- Show one idea per code scene, and narrate exactly the lines highlighted. Set `focusLinesAfter` from the snippet's line numbers, as numbers or `"start-end"` strings. A snippet longer than 12 lines needs a focus. Without one, the whole snippet is highlighted as one step.
- Highlight at most 8 lines per range and 3 ranges per scene (4 with `flow`). The ranges play top to bottom, one at a time, so narrate them in that order. Each `"start-end"` string is a range of its own, so write `["11-12", "13", "14-17"]` to walk contiguous lines as three steps.
- The `calloutText` must be about the code on screen.
- Explain each rule once, completely, in one place. If a behavior spans several files, explain it fully in one `flow`, `sequence` or `state` scene instead of in pieces across code scenes.
- Add a `tests` scene only when tests are part of the explanation, such as a bug that no test caught. List each case's name as written in code and what it proves, and put the important untested behaviors in `gaps`.

### Narration

- The narration is the explanation itself, spoken. Say behavior outright with real names and values, such as "after twenty requests in a minute the limiter answers too many requests". The viewer should never have to read the code to learn what happens. When a scene explains a behavior without showing its code, name the file and function it lives in.
- Write 15 to 50 words per scene, to be spoken aloud. A text-to-speech voice reads it, so use short sentences and plain words.
- Spell out symbols and code the way a person would say them. Say "the create order function", not `createOrder()`, and "four twenty-nine", not `429`. Avoid markdown, slashes, arrows, and abbreviations the voice could misread.
- Scene length comes from the spoken audio, or from word count without it, so never compute frames or seconds.
- Let the explanation set the length. Cover every point a viewer needs, and cut only what is genuinely trivial. Give each scene a short `chapter` title.

## 4. Show it

Start the player as a background command so it keeps running.

```bash
{{MR_CAST}}/bin/mr-cast explain play
```

`play` and `render` voice the narration first. The first run downloads a voice model of about 90 MB into `~/.cache/mr-cast`, which takes a minute. After that, each new or changed scene takes a few seconds to speak. Options for both commands:

- `--voice <name>` picks the voice: `af_heart` (default), `af_bella`, `am_michael`, `bf_emma`, or `bm_george`. Later runs keep the last choice.
- `--no-voice` makes a silent walkthrough, timed from word count.

If the voice model cannot load, the command prints a warning and continues without voice. Tell the user if that happens.

It prints `mr-cast player: http://127.0.0.1:<port>` and opens the browser. Give the user that URL and tell them to click play, since a voiced walkthrough does not autoplay. The player reloads when `storyboard.json` changes, after it voices any changed narration, so edit and revalidate to iterate while it runs.

If the user asked for a video file, run `{{MR_CAST}}/bin/mr-cast explain render` instead (add `--out <path>` to choose the location). It writes `walkthrough.mp4` in the data directory. The first render downloads a headless Chrome and takes a few minutes.

To check how scenes look without a browser, run `{{MR_CAST}}/bin/mr-cast explain still [sceneIndex...]` and read the PNGs it prints. Do this when a scene has long text, many nodes, or a long snippet.
