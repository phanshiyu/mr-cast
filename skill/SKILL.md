---
name: mr-video
description: Turn the current git branch or merge request diff into an animated video walkthrough explaining architecture, flows, and code changes.
---

# MR video

Make an animated walkthrough of the current branch's diff with mr-cast. You write a storyboard JSON. mr-cast renders it in a browser player or as an MP4.

The CLI is `{{MR_CAST}}/bin/mr-cast`. Run every command from inside the user's repository. The wrapper finds a working Node itself, so call it directly rather than through `node`.

## 1. Extract the diff

```bash
{{MR_CAST}}/bin/mr-cast extract [base]
```

- Pass a base branch when the user names one. Otherwise mr-cast picks origin's default branch, then `main` or `master`.
- Add `--working` when the changes are uncommitted or the user is still on the base branch.
- For a PR or MR number that isn't checked out, check it out first with `gh pr checkout <n>` or `glab mr checkout <n>`.

The output is a hunk index: each file, its hunk ids (`h1`, `h2`, ...), and the changed lines with their line numbers. Full hunks go to `.mr-cast/hunks.json`. Don't read that file. Read the source files instead when a change needs more context to explain.

## 2. Write `.mr-cast/storyboard.json`

The JSON must match this TypeScript schema exactly.

```ts
{{STORYBOARD_TYPES}}
```

Then check it.

```bash
{{MR_CAST}}/bin/mr-cast validate
```

Fix every error and rerun until it prints `✓ storyboard ok`. Resolve every coverage warning, the ones saying a hunk is not shown or tests are not walked through, by adding a code scene for the hunk or a `skipped` entry with a reason. Treat other warnings as advice.

### Writing a good storyboard

The viewer is a reviewer who has not read the diff. A good walkthrough lets them understand the change and know what to check without reading the code themselves.

- Plan before you write scenes. Decide three things: the problem this change solves, the one to three things a reviewer must check (risks, questionable choices, missing cases), and the key behaviors ("when X happens, Y happens"). Every scene must serve one of these. Cut any scene that does not.
- Open with one `intent` scene. The narration says what problem the change solves and what it does about it. The bullets are the review concerns from your plan: at most three, one short line each, concrete enough to act on ("a crash after claiming leaves the delivery stuck forever"), not a list of features. State the risk honestly: `high` means data migrations, auth, money, or public API breaks.
- Add a diagram scene only when it explains something the code cannot show on its own: how several components interact, a lifecycle, a call order, or a schema. Skip the `arch` scene for a change inside one component or touching only a few files.
- Show one idea per scene. A `code` scene covers one change, and the narration explains exactly the lines highlighted. When a hunk mixes several changes, split them into separate scenes or leave out the minor ones. The `calloutText` must be about the code on screen, never a concern from elsewhere.
- Say behavior outright in the narration, with real values: "after twenty requests in a minute the limiter answers too many requests", "a failed delivery retries with doubling delays and is marked dead after eight attempts". The reviewer should never have to read the code to learn what happens. When a scene explains a behavior without showing its code, name the file and function it lives in.
- Explain each rule once, completely, in one place. If a behavior spans several files, such as when something retries and when it gives up, explain it fully in one `flow`, `state` or `sequence` scene instead of in pieces across code scenes.
- Show every substantive hunk in a `code` scene. Skip only formatting, renames, generated files, and boilerplate, and record each skipped hunk in `skipped` with a short reason. Reference hunks by `hunkId` and never paste code into the storyboard.
- When the diff adds or changes tests, walk through them in one or more `code` scenes after the code they test. Narrate which scenarios and edge cases each test proves, naming the test in plain words. Then say which important cases have no test. Focus on test names and key assertions, not setup boilerplate.
- Set `focusLinesAfter` from the line numbers in the index, as numbers or `"start-end"` strings, on the lines the narration talks about. Use `focusLinesBefore` for removed code. Always set a focus on hunks with more than 12 changed lines.
- Highlight at most 8 lines per range and 3 ranges per scene. The ranges play top to bottom, one at a time, so narrate them in that order.
- Add a `flow` scene when the change alters how a request or data moves. Each step names a real actor (function, service, component) and shows the payload as it looks after that step. Use 3 to 7 steps.
- Add a `sequence` scene when the order of calls between components matters: a new hop, a call moved before or after another, async work, or retries. List messages in time order, use `return` for responses and `async` for fire-and-forget, and mark only the participants and messages this change adds or alters as `modified`. Use a self-message (`from` equal to `to`) for significant internal work. Keep it to 6 participants and 12 messages. Prefer `flow` when the data's shape is the story, and `sequence` when who calls whom is.
- Add an `er` scene when the diff changes a schema: migrations, ORM models, or table definitions. Read the migration or model files, and show each changed table plus its directly related tables. List keys and the fields the change touches, and mark each with `change`: `added`, `removed` or `modified`. Then follow with a `code` scene on the migration hunk.
- Add a `state` scene when the change touches a lifecycle or status machine: a new status, a removed or new transition, or a changed guard. Find the states in enums, status columns, or reducers. Set `initial` to the starting state, mark terminal states `final`, label each transition with its event or guard, and mark what the change added, removed or modified. Keep it to 10 states.
- Use a `mermaid` scene only for a diagram no other scene covers, such as a class diagram, gantt chart, git graph, or pie chart. Prefer `arch`, `sequence`, `er`, `state`, and `flow`, because they highlight what the change touched and Mermaid cannot. Keep Mermaid diagrams small, about 12 nodes or fewer, so the text stays readable. `validate` checks Mermaid syntax, but run `mr-cast still <sceneIndex>` on each mermaid scene to confirm it renders and fits.
- Write narration to be spoken aloud, 15 to 50 words per scene. A text-to-speech voice reads it, so use short sentences and plain words.
- Spell out symbols and code the way a person would say them: "the create order function", not `createOrder()`, and "four twenty-nine" or "too many requests", not `429`. Avoid markdown, slashes, arrows, and abbreviations the voice could misread.
- Scene length comes from the spoken audio, or from word count without it, so never compute frames or seconds.
- Let the change set the length. Cover every hunk a reviewer needs to judge the change, and cut only what is genuinely trivial. A small change may need 4 to 6 scenes. A large one can run several minutes. List each deliberate omission in `skipped` with its reason. Give each scene a short `chapter` title.

## 3. Show it

Start the player as a background command so it keeps running.

```bash
{{MR_CAST}}/bin/mr-cast play
```

`play` and `render` voice the narration first. The first run downloads a voice model of about 90 MB into `~/.cache/mr-cast`, which takes a minute. After that, each new or changed scene takes a few seconds to speak. Options for both commands:

- `--voice <name>` picks the voice: `af_heart` (default), `af_bella`, `am_michael`, `bf_emma`, or `bm_george`. Later runs keep the last choice.
- `--no-voice` makes a silent walkthrough, timed from word count.

If the voice model cannot load, the command prints a warning and continues without voice. Tell the user if that happens.

It prints `mr-cast player: http://127.0.0.1:<port>` and opens the browser. Give the user that URL and tell them to click play, since a voiced walkthrough does not autoplay. The player reloads when `storyboard.json` changes, after it voices any changed narration, so edit and revalidate to iterate while it runs.

If the user asked for a video file, run `{{MR_CAST}}/bin/mr-cast render` (add `--out <path>` to choose the location). It writes `.mr-cast/walkthrough.mp4`. The first render downloads a headless Chrome and takes a few minutes.

To check how scenes look without a browser, run `{{MR_CAST}}/bin/mr-cast still [sceneIndex...]` and read the PNGs it prints. Do this when a scene has long text, many nodes, or a large hunk.
