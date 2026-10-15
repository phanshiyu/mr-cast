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

Fix every error and rerun until it prints `✓ storyboard ok`. Treat warnings as advice.

### Writing a good storyboard

- Open with one `intent` scene. State the risk honestly. `high` means data migrations, auth, money, or public API breaks.
- Add an `arch` scene when the change touches more than one component. Use components that exist in the code and mark the ones this diff changes as `modified`. Keep it under 10 nodes. Layout is automatic, so never send coordinates.
- Pick the 2 to 5 hunks that carry the change for `code` scenes. Skip formatting, renames, and boilerplate. Reference hunks by `hunkId` and never paste code into the storyboard.
- Set `focusLinesAfter` from the line numbers in the index, as numbers or `"start-end"` strings, on the lines the narration talks about. Use `focusLinesBefore` for removed code. Use `calloutText` for the one thing a reviewer must notice, such as a bug risk, an edge case, or a design choice, in under 15 words.
- Add a `flow` scene when the change alters how a request or data moves. Each step names a real actor (function, service, component) and shows the payload as it looks after that step. Use 3 to 7 steps.
- Write narration to be spoken aloud for a reviewer, 15 to 50 words per scene. A text-to-speech voice reads it, so use short sentences and plain words. Explain why, not only what.
- Spell out symbols and code the way a person would say them: "the create order function", not `createOrder()`, and "four twenty-nine" or "too many requests", not `429`. Avoid markdown, slashes, arrows, and abbreviations the voice could misread.
- Scene length comes from the spoken audio, or from word count without it, so never compute frames or seconds.
- Aim for 5 to 10 scenes and one to three minutes in total. Give each scene a short `chapter` title.

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
