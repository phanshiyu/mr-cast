---
name: mr-cast
description: Makes a narrated, animated video walkthrough of this branch's changes, of something just explained, of a concept the user names, or of code the user selected, played in the browser or saved as an MP4. It first writes a short teaching article, which can also be the deliverable on its own. Use when the user asks for a video, walkthrough, or animation of a branch, diff, pull request, or merge request, asks to animate, visualize, or make a video of an explanation, such as "animate that", "make a video of this", "explain quicksort in a video", or "turn that into a video", or asks for a quick diagram video, such as "explain this flow in a diagram", "just a diagram" or "/mr-cast quick". It can also flag what looks wrong in the branch as it walks through it, when the user asks for a review. Not for a code review or an explanation that asks for neither a video nor an mr-cast article.
argument-hint: "[quick] [mp4] [article] [base-branch | --working | what to focus on]"
hooks:
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "'{{MR_CAST}}/bin/mr-cast' hook"
---

# mr-cast

Make an animated, narrated walkthrough with mr-cast. You write a teaching article, then adapt it into a storyboard JSON, and mr-cast plays it in a browser player or renders it as an MP4.

The CLI is `{{MR_CAST}}/bin/mr-cast`. Run every command from the user's repository, or from the directory the explanation is about. Call it directly, not through `node`. If a command prints `mr-cast <version> is available`, tell the user once, at the end of your reply, that they can ask you to upgrade. Do not upgrade unless they ask.

Each step below names the reference to read for it. Read a reference when you reach its step, and read it again after a compaction before you edit the file it is about. A hook runs `mr-cast validate` after every write to `storyboard.json` and `mr-cast article` after every write to `article.md`, and shows you the errors.

## The steps of a full video

1. Pick the mode, the source and the output.
2. Ask what the video is for: [references/questions.md](references/questions.md).
3. Start the run: [references/branch.md](references/branch.md) or [references/explanation.md](references/explanation.md), and [references/review.md](references/review.md) when review is on.
4. Let the user pick the topics: [references/plan.md](references/plan.md).
5. Write the article and test it with a reader: [references/article.md](references/article.md), [references/reader-test.md](references/reader-test.md).
6. Adapt the article into the storyboard: [references/adapt.md](references/adapt.md), [references/voice.md](references/voice.md), the audience's reference, and the scene files.
7. Show it.

A quick video skips all of this: [references/quick.md](references/quick.md).

## 1. Pick the mode, the source and the output

Pick the mode with the first row that matches. The words the user types beat what is in context.

| # | The request | The video |
| --- | --- | --- |
| 0 | After a quick video in this conversation: "save it", "render it", "mp4", "go deeper", "the whole branch" | About that video: [references/quick.md](references/quick.md), What comes next. "Save it" renders the quick run as it is. |
| 1 | "mp4", "render", "save", "share" | Full mode, as an MP4. Quick words are ignored. |
| 2 | "pre-read", "before I review", "no code on screen", "without code" | Full mode, audience `preread`, even with "quick". |
| 3 | "article", "write it up", "just the article", "no video" | Full mode up to step 5, then stop with the article. |
| 4 | "quick", "quickly", "just a diagram", "diagram of", "draw this flow", "explain this in a diagram", "sketch", `/mr-cast quick` | Quick mode, even when the request also names the PR or the branch. |
| 5 | "walkthrough", "full", "whole branch", "the PR", "review it" | Full mode. A selection makes the topic that holds it `deep`. |
| 6 | A bare `/mr-cast` with selected or pasted code | Quick mode on those lines. |
| 7 | "animate that", "what you said", or a concept such as "explain quicksort in a video" | An explanation. Quick mode if it fits 3 scenes and the user asked for nothing longer, else full mode. |
| 8 | A bare `/mr-cast` with no selection | Full mode, on the source the rules below pick. |

**Selected code.** When Claude Code is connected to the user's IDE, the lines the user highlights arrive with the prompt, such as "Selected 14 lines from src/limiter.ts". The IDE sends them with every prompt while text is highlighted, so a selection may be one the user forgot: that is why a bare `/mr-cast` with a selection makes the cheap quick video. Find pasted code's file and lines with a search before you use it.

Before any work, write one line that names the mode, the source and how to switch, such as `Quick video of limiter.ts lines 40 to 72: how it flows, then the lines. About 45 seconds.` When the branch is live too, add `Want the whole branch instead? Say "the whole branch".` In full mode, say `Full walkthrough of <source>. Say "quick" for a short diagram instead.`

```bash
{{MR_CAST}}/bin/mr-cast status
```

It prints the branch, the commits and files ahead of its base, the uncommitted files, and the audience and pace chosen last time. The branch is **live** when `status` shows commits ahead of the base, or changed files with nothing ahead. The explanation is **live** when one of your replies in this conversation explained a system, a flow, a bug or a design, or the request names a concept to explain. Pick the source with the first rule that applies:

1. **The words name it.** A base branch, `--working`, a PR or MR number, "this branch", "this PR", "the diff" or "these changes" mean the branch. "That", "what you said", "this explanation", "animate that" or a named concept mean the explanation.
2. **Exactly one source is live.** Use it.
3. **Both are live.** Ask which in step 2.
4. **Neither is live.** Say in two sentences what `/mr-cast` makes: a narrated video of a branch's changes, or of something explained in this conversation. Then stop.

The output is an MP4 when the request says "mp4", "video file", "render", "save" or "share". Otherwise it is the browser player, which reloads as you edit.

## 2. Ask what the video is for

Read [references/questions.md](references/questions.md) and ask its questions in one `AskUserQuestion` call, or skip them as it says. The answers become `<flags>`:

- Audience: `--audience familiar`, `--audience new`, `--audience overview` or `--audience preread`.
- Pace: `--pace normal`, `--pace slower` or `--pace faster`, or `--no-voice`.

Pass `<flags>` to every `extract`, `init`, `plan`, `article`, `validate`, `steps`, `outline`, `play`, `render` and `still` command. A flag applies to its own command only. mr-cast remembers the audience and pace for next time. Review takes no flag: the storyboard's `findings` turn it on.

The audience's reference holds its rules for steps 5 and 6: [audience-new.md](references/audience-new.md) for `new`, [audience-overview.md](references/audience-overview.md) for `overview`, [audience-preread.md](references/audience-preread.md) for `preread`. `familiar` has none.

## 3. Start the run

Read the reference for the source, and only that one: [references/branch.md](references/branch.md) for the branch, [references/explanation.md](references/explanation.md) for an explanation. It says how to start the run and what the video must cover. When review is on, also read [references/review.md](references/review.md).

The run is `.mr-cast/<slug>/` and becomes the current run, which every later command works on. When you work on more than one run, pass `--name <slug>` to every command.

## 4. Let the user pick the topics

Read [references/plan.md](references/plan.md). Write `plan.json`, open the plan page unless it says to skip it, and read the user's picks.

## 5. Write the article

Read [references/article.md](references/article.md), write `article.md` in the run's directory, and check it:

```bash
{{MR_CAST}}/bin/mr-cast article <flags>
```

Then test it with a reader who is not you. Run `{{MR_CAST}}/bin/mr-cast article --reader <flags>`, which prints the article without the answers. Make one `Agent` call with `model: "sonnet"` that starts a new subagent, its prompt the text of [references/reader-test.md](references/reader-test.md) with that output pasted under its last heading. Wait for its reply before you go on. Never resume an agent that wrote the article, and never answer the test yourself.

Mark each answer against the article's `Answer:`. A question fails when the answer is wrong or `not in the article`. Revise where the reader went wrong: the quoted sentence, the step where it got stuck, each term it guessed. Do not add content unless it serves a takeaway. Then run `article` and the reader again, with a new subagent. Stop when every question passes, after at most 2 revisions, and keep the earlier version if a question that passed now fails.

Show the user the takeaways `article` prints, in a few lines, with the article's path and the score, such as `Reader test: 5 of 5 questions.` For row 3 of step 1, stop here and give the path. Otherwise go on: the user can stop you there.

## 6. Adapt the article into the storyboard

Read [references/adapt.md](references/adapt.md) and [references/voice.md](references/voice.md). Pick the scene for each idea of the article with the table in `adapt.md`, read the file of each scene you write, and print its fields:

```bash
{{MR_CAST}}/bin/mr-cast schema <type>
```

`schema` alone prints the storyboard and what every scene shares. The scene files: [array](references/scenes/array.md), [chart](references/scenes/chart.md), [code](references/scenes/code.md), [compare](references/scenes/compare.md), [er](references/scenes/er.md), [files](references/scenes/files.md), [flow](references/scenes/flow.md), [graph](references/scenes/graph.md), [intent](references/scenes/intent.md), [layers](references/scenes/layers.md), [memory](references/scenes/memory.md), [mermaid](references/scenes/mermaid.md), [reading](references/scenes/reading.md), [review](references/scenes/review.md), [sequence](references/scenes/sequence.md), [state](references/scenes/state.md), [table](references/scenes/table.md), [terminal](references/scenes/terminal.md), [tests](references/scenes/tests.md), [timeline](references/scenes/timeline.md).

Write `storyboard.json` in the run's directory, then check it:

```bash
{{MR_CAST}}/bin/mr-cast validate <flags>
```

Fix every error and rerun until it prints `✓ storyboard ok`. Resolve the warnings the references name, every warning about an article section, and every warning that a step's words name what is `not lit` or that a swap lands `before its words`. Treat other warnings as advice.

**Check what each step lights.** When a scene other than `code` has `steps`, run `{{MR_CAST}}/bin/mr-cast steps <flags>` after `validate` passes. Make one `Agent` call with `model: "sonnet"` that starts a new subagent, its prompt the text of [references/highlight-audit.md](references/highlight-audit.md) with the `steps` output pasted under its last heading. Wait for its reply. Never resume or message an agent that wrote any of the storyboard, and never answer the audit yourself. Apply each fix you agree with, rerun `validate`, and do not call the audit again.

## 7. Show it

```bash
{{MR_CAST}}/bin/mr-cast outline <flags>
```

For the player, show the outline and start the player at once. Before an MP4, show the outline as it prints, with at most one sentence of your own, and ask one `AskUserQuestion`, header "Plan", question "Render this plan?": "Render it (Recommended)" ("Make the MP4 now."), "Make it shorter" ("Cut minor scenes and trim the narration."), "Make it longer" ("Add more steps, diagrams and edge cases."). Apply another answer and ask again when the change was large. Skip the question when the user said "just make it", "use the defaults" or "no questions".

Start the player as a background command:

```bash
{{MR_CAST}}/bin/mr-cast play <flags>
```

`play` prints `mr-cast player: <url>` at once, voices the narration, and opens the browser once the voice is ready, in about a third of the narration's length; clips already made are reused. The first run downloads a voice model of about 90 MB. Give the user the URL and say the page opens once the voice is ready. If `play` prints that voicing failed, tell the user the player plays silent with subtitles, and why. End your reply with: "Say 'save it as an MP4' when you want a file to share." To change the pace or voice, change `<flags>` (`--voice af_heart`, `af_bella`, `am_michael`, `bf_emma` or `bm_george`) and pass them to every later command.

With a `plan.json`, the player has a Plan tab. When the user changes a pick there and says "update the video", run `validate <flags>`: it names each topic whose pick changed. Rewrite the article sections and scenes of only those topics, update their `plan` entries, and validate again.

For an MP4, run `{{MR_CAST}}/bin/mr-cast render <flags>` instead of `play` (`--out <path>` picks the location), with a long timeout or in the background. It prints the MP4's path, with copies of `article.md`, `review.md` and `reading.md` beside it when it is saved outside the run. Give the user the path.

To see scenes without a browser, run `{{MR_CAST}}/bin/mr-cast still [sceneIndex...] <flags>` and read the PNGs. Do this when a scene has long text, many nodes, or a large hunk.

In a pre-read, end your reply with the reading order as `outline` prints it, one `path:line  check` line per item, and the path of `reading.md`. When review is on, list every finding as `severity file:line claim`, one per line, with the path of `review.md`, or say that nothing looked wrong.
