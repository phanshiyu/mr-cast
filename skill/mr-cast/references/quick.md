# Quick mode

A short diagram video of one thing, on screen in about 20 seconds: 1 to 3 scenes and about a minute of narration. Quick mode asks no questions, shows no outline, writes no article and no `plan.json`, never opens the plan page, and never reviews. Besides this file it needs only [voice.md](voice.md) and the scene files of the scenes you write. Run `{{MR_CAST}}/bin/mr-cast status` once, and pass the pace it shows from last time as `<flags>` (`--pace slower`, `--pace faster` or `--no-voice`) to every command below. Without one, pass nothing.

**Find the code.** For a selection, the code is the selected lines. When the user selected one line, grow it to the function around it and say so in the start line, such as `Quick video of rateLimit() in limiter.ts (you selected line 52).` A selection over 80 lines is too long for one snippet: show the main path and say in your reply what you left out. Use at most 3 lookups (reads, searches or language-server calls) before you write the storyboard, such as the function's callers and what it calls. For your explanation, the code is what you already explained. For the branch, it is the one change `status` lists that matters most: show its new code as snippets, and set `"explainsChange": true` on the storyboard when you mark what the change did.

**Start the run.** Give a short title, such as the file and lines.

```bash
{{MR_CAST}}/bin/mr-cast init --quick --title "limiter.ts lines 40 to 72" <flags>
{{MR_CAST}}/bin/mr-cast snippet src/limiter.ts:40-72
```

The run is `.mr-cast/quick-<title-slug>/`, so it never overwrites a full run. Add the snippet only for a selection, or when the user asked to see code.

**Write the storyboard** (`storyboard.json` in the directory `init` printed; `{{MR_CAST}}/bin/mr-cast schema <type>` prints a scene's fields), with no intent scene and no recap:

1. The flow of the code, as a `flow`, `sequence`, `state` or a decision `graph`. Walk it in `steps` with real values.
2. Only when the code has 2 or more callers, or is called from another module: "where this sits", a `graph` of at most 6 nodes with the callers on the left, the code highlighted in the middle, and what it calls on the right. Add the test that covers it as a node, or a `warn` badge "no tests". Callers a language server found are facts. Callers you found by text search are a guess, so give the graph the caption "Found by search" and say "called from at least these places".
3. For a selection: the lines themselves, a `code` scene on the snippet with at most 6 `steps`.

"Just a diagram" means one scene and no code. Read the [scene file](scenes/) of each scene you write, such as [scenes/flow.md](scenes/flow.md), and [voice.md](voice.md).

```bash
{{MR_CAST}}/bin/mr-cast validate <flags>
```

Fix every error, and the warnings about more than 3 scenes or about 60 seconds of narration.

**Show it.** Start the player as a background command, and do not wait for it:

```bash
{{MR_CAST}}/bin/mr-cast play <flags>
```

`play` prints the URL at once, voices the narration, then opens the browser: the page opens once the voice is ready, about 16 seconds for a 2-scene video, or at once when its clips are cached. The video ends on a card of next steps. End your reply with: `The player opens at <url> once the voice is ready, in about 15 seconds. Say "go deeper" for a full walkthrough of these lines, or "save it" for an MP4.`

## What comes next

- "go deeper": a full video of the same code. Ask only the audience question of step 2, with no outline question. Run `init` with the same `--title` and no `--quick`: the new run starts from the quick video's storyboard, snippets and voice. Then continue from step 4 of SKILL.md, with the topic that holds these lines suggested as `deep`, and keep the quick video's scenes as that topic's diagrams.
- "the whole branch": the full flow from step 1, on the branch.
- "save it": `{{MR_CAST}}/bin/mr-cast render <flags>` on the quick run as it is, with no outline question.
