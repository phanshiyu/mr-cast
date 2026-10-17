---
name: mr-cast
description: Make a narrated, animated video walkthrough of this branch's changes, of something you just explained, or of code the user selected, played in the browser or saved as an MP4. Use when the user asks for a video, walkthrough, or animation of a branch, diff, pull request, or merge request, asks to animate, visualize, or make a video of an explanation, such as "animate that", "make a video of this", or "turn that into a video", or asks for a quick diagram video, such as "explain this flow in a diagram", "just a diagram" or "/mr-cast quick". It can also flag what looks wrong in the branch as it walks through it, when the user asks for your review. Not for a code review or an explanation that does not ask for a video.
argument-hint: "[quick] [mp4] [base-branch | --working | what to focus on]"
---

# mr-cast

Make an animated, narrated walkthrough with mr-cast. Its source is either the current branch's diff or an explanation you gave earlier in this conversation. You write a storyboard JSON. mr-cast plays it in a browser player or renders it as an MP4.

The CLI is `{{MR_CAST}}/bin/mr-cast`. Run every command from the user's repository, or from the directory your explanation is about. The wrapper finds a working Node itself, so call it directly rather than through `node`.

If a command prints `mr-cast <version> is available`, tell the user once, at the end of your reply, that they can ask you to upgrade mr-cast. Do not upgrade unless they ask.

## 1. Pick the mode, the source and the output

After a quick video in this conversation, a short reply such as "save it", "render it", "mp4", "go deeper" or "the whole branch" is about that video: do what [What comes next](#what-comes-next) says for it. "Save it" renders the quick run as it is. It does not start the full flow.

For any other request, pick the mode with the first row that matches. The words the user types always beat what is in context.

| # | The request | The video |
| --- | --- | --- |
| 1 | "mp4", "render", "save", "share" | Full mode, as an MP4. Quick words are ignored, because an MP4 is meant to be shared. |
| 2 | "pre-read", "before I review", "no code on screen", "without code" | Full mode, with the audience `preread` of step 2, even when the request also says "quick". See [Pre-read mode](#pre-read-mode). |
| 3 | "quick", "quickly", "just a diagram", "diagram of", "draw this flow", "explain this in a diagram", "sketch", `/mr-cast quick` | [Quick mode](#quick-mode), even when the request also names the PR or the branch, as in "a quick video of the PR". Its source is the selection if there is one, else your explanation, else the branch. |
| 4 | "walkthrough", "full", "whole branch", "the PR", "review it" | Full mode, with the plan page of step 4. A selection makes the topic that holds it `deep` there. |
| 5 | A bare `/mr-cast` with selected or pasted code | [Quick mode](#quick-mode) on those lines. |
| 6 | "animate that", "what you said" | Your explanation. Quick mode if it fits 3 scenes, else full mode. |
| 7 | A bare `/mr-cast` with no selection | Full mode, on the source the rules below pick. |

**Selected code.** When Claude Code is connected to the user's IDE (through `/ide`, or by running in the IDE's integrated terminal), the lines the user highlights reach you with the prompt as context, such as "Selected 14 lines from src/limiter.ts", with the line range. Without that connection no selection arrives, but the user may paste the code instead. Find pasted code's file and lines with a search before you use it. The IDE sends the selection with every prompt while text is highlighted, so it may be one the user forgot. That is why a bare `/mr-cast` with a selection makes the cheap quick video, and says in its first line how to get the branch instead.

Before any work, write one line that names the mode, the source and how to switch, such as `Quick video of limiter.ts lines 40 to 72: how it flows, then the lines. About 45 seconds.` When the branch is live too, add `Want the whole branch instead? Say "the whole branch".` In full mode, say `Full walkthrough of <source>. Say "quick" for a short diagram instead.` Then follow [Quick mode](#quick-mode), or the steps below for full mode.

The rest of this step and steps 2 to 7 are full mode.

```bash
{{MR_CAST}}/bin/mr-cast status
```

It prints the branch, the commits and files it has ahead of its base, the uncommitted files, and the audience and pace the user chose last time.

The branch is **live** when `status` shows commits ahead of the base, or changed files with nothing ahead. The explanation is **live** when one of your replies in this conversation explained a system, a flow, a bug or a design. Pick the source with the first rule that applies:

1. **The arguments and the wording name it.** A base branch, `--working`, a PR or MR number, or "this branch", "this PR", "this MR", "the diff" or "these changes" mean the branch. "That", "what you said", "this explanation" or "animate that" mean the explanation.
2. **Exactly one source is live.** Use it.
3. **Both are live.** Ask which one in step 2.
4. **Neither is live.** Tell the user in two sentences what `/mr-cast` makes: a narrated video of a branch's changes, or of something you explained in this conversation. Then stop.

The output is an MP4 when the request or the arguments say "mp4", "video file", "render", "save" or "share", as in `/mr-cast mp4` or `/mr-cast mp4 main`. Otherwise it is the browser player, which starts at once and reloads as you edit.

## Quick mode

A short diagram video of one thing, on screen in about 20 seconds: 1 to 3 scenes and about a minute of narration. Quick mode asks no questions, shows no outline and needs no reference file. It never opens the plan page, writes no `plan.json`, and never reviews. Run `{{MR_CAST}}/bin/mr-cast status` once, and pass the pace it shows from last time as `<flags>` (`--pace slower`, `--pace faster` or `--no-voice`) to every command below. Without one, pass nothing.

**Find the code.** For a selection, the code is the selected lines. When the user selected one line, grow it to the function around it and say so in the start line, such as `Quick video of rateLimit() in limiter.ts (you selected line 52).` A selection over 80 lines is too long for one snippet: show the main path and say in your reply what you left out. Use at most 3 lookups (reads, searches or language-server calls) before you write the storyboard, such as the function's callers and what it calls. For your explanation, the code is what you already explained. For the branch, it is the one change `status` lists that matters most: show its new code as snippets, and set `"explainsChange": true` on the storyboard when you mark what the change did.

**Start the run.** Give a short title, such as the file and lines.

```bash
{{MR_CAST}}/bin/mr-cast init --quick --title "limiter.ts lines 40 to 72" <flags>
{{MR_CAST}}/bin/mr-cast snippet src/limiter.ts:40-72
```

The run is `.mr-cast/quick-<title-slug>/`, so it never overwrites a full run. Add the snippet only for a selection, or when the user asked to see code.

**Write the storyboard** (`storyboard.json` in the directory `init` printed, in the schema of step 5), with no intent scene and no recap:

1. The flow of the code, as a `flow`, `sequence`, `state` or a decision `graph`. Walk it in `steps` with real values.
2. Only when the code has 2 or more callers, or is called from another module: "where this sits", a `graph` of at most 6 nodes with the callers on the left, the code highlighted in the middle, and what it calls on the right. Add the test that covers it as a node, or a `warn` badge "no tests". Callers a language server found are facts. Callers you found by text search are a guess, so give the graph the caption "Found by search" and say "called from at least these places".
3. For a selection: the lines themselves, a `code` scene on the snippet with at most 6 `steps`.

"Just a diagram" means one scene and no code. Follow [Shared rules](#shared-rules) and [How the voice talks](#how-the-voice-talks).

```bash
{{MR_CAST}}/bin/mr-cast validate <flags>
```

A quick run skips the intent rule, warns past 3 scenes or about 60 seconds of narration, and keeps every other check. Fix errors and those two warnings.

**Show it.** Start the player as a background command, and do not wait for it:

```bash
{{MR_CAST}}/bin/mr-cast play <flags>
```

`play` prints the URL at once, voices the narration, then opens the browser: the page opens once the voice is ready, about 16 seconds for a 2-scene video, or at once when its clips are cached. The video ends on a card of next steps. End your reply with: `The player opens at <url> once the voice is ready, in about 15 seconds. Say "go deeper" for a full walkthrough of these lines, or "save it" for an MP4.`

### What comes next

- "go deeper": a full video of the same code. Ask only the audience question of step 2, with no outline question. Run `init` with the same `--title` and no `--quick`: the new run starts from the quick video's storyboard, snippets and voice. Then continue from step 4, with the topic that holds these lines suggested as `deep`, and keep the quick video's scenes as that topic's diagrams.
- "the whole branch": the full flow from step 1, on the branch.
- "save it": `{{MR_CAST}}/bin/mr-cast render <flags>` on the quick run as it is, with no outline question.

## 2. Ask what the video is for

Ask with one `AskUserQuestion` call before you start the run. Ask only what the request leaves open:

- The user already answered a question with words such as "a simple video" or "explain like I'm new to this" (audience), or "slowly" (pace). A request for a short video, or one for the team, answers the audience with the short overview, unless it also says pre-read. "Pre-read", "before I review", "no code on screen" or "without code" answer it with `preread`. Words such as "focus on the migration" do not answer a question here. They shape your suggested picks in step 4.
- The user asked for your opinion of the branch, with words such as "review it", "with your review", "find issues" or "flag anything that looks wrong". That turns review on (question 4).
- The user said "just make it", "use the defaults" or "no questions". Skip the call and use the last choices from `status`, else the recommended options. Review stays off unless the words above turned it on.

Say in one line which choice you used for each question you skipped. "Render" means an MP4. It does not skip the questions.

Every question is multiple choice. Put the recommended option first and end its label with "(Recommended)". When `status` shows a last choice for the question, put that option first instead and end its label with "(Last time)", unless it is the recommended option. The user can then accept every default by pressing enter.

1. Only when both sources are live: header "Video of", question "What should the video show?"
   - "Changes on <branch> (<n> files) (Recommended)". Description: the commits and files from `status`.
   - "Your explanation of <topic>". Description: the explanation in one line.
2. Header "Audience", question "Who is this video for?" `status` names these `familiar`, `new`, `overview` and `preread`.
   - `familiar`: "A reviewer of this change (Recommended)" for the branch, or "A teammate who knows this code (Recommended)" for an explanation. Description: "Diagrams, then the code behind each point."
   - `new`: "Someone new to this code". Description: "Walks the code one line at a time in plain words, after the code around it. Good for a second-language reader. Longer."
   - `overview`: "A short overview for the team". Description: "Diagrams and behavior, with very little code. Usually under 3 minutes."
   - `preread`: "A reviewer who will read the code next". Description: "Diagrams only. Ends with a reading order to follow in your editor." Offer it for the branch and for an explanation alike, so a last choice of `preread` always has its option.
3. Header "Pace", question "How should it sound?" `status` names these `normal`, `slower`, `faster` and `silent`.
   - "Normal pace (Recommended)". Description: "About 130 words a minute, with pauses between steps."
   - "Slower". Description: "A slower voice and longer pauses. Good for new readers or a second language."
   - "Faster". Description: "A quicker voice and shorter pauses."
   - "No voice, subtitles only". Description: "A silent video, timed for reading."

   When you already know the audience is someone new to this code, recommend "Slower" and list it first, unless a last choice comes first.
4. Only when the branch is live: header "Review", question "Should I also flag what looks wrong?"
   - "No, just explain (Recommended)". Description: "The video explains the change and gives no verdict."
   - "Yes, flag what looks off". Description: "I mark lines that look wrong as the walkthrough reaches them, as my opinion, recap them at the end and write them to review.md."

   Review applies to the branch only. If the user picks their explanation in question 1, ignore this answer.

The answers become the flags, written `<flags>` in every command below:

- Audience: `--audience familiar`, `--audience new`, `--audience overview` or `--audience preread`.
- Pace: `--pace normal`, `--pace slower` or `--pace faster`, or `--no-voice` for "No voice, subtitles only".

For example, `<flags>` is `--audience new --pace slower`. Pass `<flags>` to every `extract`, `init`, `validate`, `outline`, `play`, `render` and `still` command. A flag applies to its own command only, and the run does not keep it. A command without the flags checks and times the video for a familiar audience at the normal pace, and voices it.

mr-cast remembers these two answers, and `status` shows them next time. Review takes no flag: the storyboard's `findings` turn it on, so it is asked each time.

## 3. Start the run

Read the reference for the source, and only that one:

- The branch: [references/branch.md](references/branch.md).
- An explanation: [references/explanation.md](references/explanation.md).

It says how to start the run, which code to show, and what the video must cover. When review is on, also read [references/review.md](references/review.md), which says how to find, check and show what looks wrong. Then come back to step 4.

The run starts in `.mr-cast/<slug>/` and becomes the current run. Every later command works on the current run. Several runs can coexist in one repository, such as one per branch, or one rendering while you write the next. When you work on more than one, pass `--name <slug>` to every command.

## 4. Let the user pick the topics

Before you write the storyboard, cut the change into topics and let the user choose, in the browser, how much time each topic gets and how it is shown. Read the diff and the code around it first, as the reference says. For an explanation, the topics are the key points of your explanation.

### Write plan.json

Write `plan.json` in the run's directory, beside `hunks.json`:

```json
{
  "topics": [
    {
      "id": "rate-limiter",
      "title": "Rate limiter: twenty orders a minute",
      "summary": "Counts each visitor's order requests per minute and refuses the twenty-first.",
      "files": ["src/api/rate-limit.ts", "src/api/server.ts"],
      "depth": "deep",
      "views": ["calls", "data", "compare"],
      "why": "The limit is a check that runs before the order is saved, so the order of calls shows it best.",
      "seconds": { "brief": 45, "deep": 120 }
    }
  ]
}
```

- **Topics.** Write 4 to 8 topics. Name each one by what it does, not by its file: "Rate limiter: twenty orders a minute", not "rate-limit.ts". A topic can span several files. Put routine changes, such as renames, formatting or deleted dead code, together in one topic. List the topics in the order the video shows them, the main behaviour first. The opening intent scene, and for the branch the closing tests scene, are always in the video, so they are not topics. The `id` is a short slug, and `summary` says in one line what the topic covers.
- **Depth.** `depth` is your suggestion. `skip` leaves the topic out. `brief` shows the topic's view and the key lines. `deep` shows the view, then the code line by line. Suggest `deep` for the main behaviour and `brief` for the code that supports it. For the short overview, suggest `brief` for most topics. In a pre-read, `brief` is the topic's picture and its key fact, and `deep` adds one more diagram, a `flow`, `array` or `table` that traces the concrete case with the actual limits, keys and order. For someone new to the code, suggest `deep` for every topic that changes logic. When the user had code selected as they asked for the full video, suggest `deep` for the topic whose files hold those lines, whatever the audience, and say so in its `why`.
- **Views.** `views` lists 1 to 3 ways to show the topic, your suggestion first. Offer only views that truly fit the topic, and offer one when two would look almost the same. A choice that changes nothing teaches the user to ignore the choices. `why` says in one line why your suggestion fits. The user reads the label, never the key:

{{PLAN_VIEWS}}

`decisions` is a `graph` drawn as a flowchart. `code` shows only code scenes. In a pre-read, never offer `code`: give every topic views that draw it, and `plan` rejects a topic that offers `code`.
- **Seconds.** `seconds` is about how long the topic takes at each depth, such as 30 to 50 for `brief` and 80 to 150 for `deep`. The page adds them up to show the user the length of the video.

### Open the plan page

Skip the page and use your suggestions when the user said "just make it", "use the defaults" or "no questions", or when the plan has 2 topics or fewer. Still write `plan.json`, so `validate` checks the scenes against it and the player's Plan tab lets the user change the picks later.

Otherwise start the page as a background command:

```bash
{{MR_CAST}}/bin/mr-cast plan <flags>
```

It checks `plan.json` first. Fix every error it prints and run it again. Then it prints `mr-cast plan: <url>` and opens the browser. In the same reply, ask one `AskUserQuestion`, header "Plan", question "I opened the plan in your browser. Make the video from it?":

- "Use my picks from the browser (Recommended)". Description: "Pick depth and view per topic there, then press Enter here."
- "Use your picks". Description: "Skip the browser and use what I suggested."

When the user writes something else with Other, such as "add the migration as its own topic", change `plan.json` to match. The page reloads by itself. Then ask the same question again.

After the answer, stop the `mr-cast plan` command and read `plan.json`. The page saves each pick the user made as the topic's `choice`, `{ "depth": "deep", "view": "compare" }`. A topic without `choice` keeps your suggestion: its `depth` and the first of its `views`. When the user answered "Use your picks", remove every `choice` from `plan.json` first.

### Write the scenes from the picks

- Set `"topic": "<id>"` on every scene that shows a topic. Leave it off the intent, tests and review scenes.
- Copy your picks into the storyboard's `plan`: for each topic, the pick you wrote its scenes from, `"plan": { "<id>": { "depth": "brief", "view": "calls" } }`. Update an entry whenever you rebuild that topic.
- A topic at `skip` gets no scene. List its hunks in `skipped` with the reason "the viewer chose to skip this topic".
- A topic at `brief` gets one scene of its view, and one code scene on its key lines. Leave the code scene out when the view is `code`, or the audience is the short overview or a pre-read. List its other hunks in `skipped` with the reason "the viewer chose a brief look at this topic", in those words, since a reviewer's video otherwise warns about every substantial hunk it does not show.
- A topic at `deep` gets one scene of its view, then its code line by line, in code scenes with `steps`. In a pre-read it gets its view and a second diagram that traces the concrete case instead, and no code.
- In a pre-read, the depth changes only the video. Every hunk of a `brief` or `skip` topic still goes in the reading order, the minor ones with `"routine": true`, since the reviewer reads the code next. Do not list them in `skipped` with the two reasons above: `validate` warns that such a hunk is not in the reading order.
- The shared rules below still put every diagram before the first code scene. Keep the topics in plan order within the diagrams, and again within the code.

`validate` reports a scene or a `plan` entry whose topic is not in `plan.json`. It warns about a topic missing from `plan`, a pick in `plan.json` that changed since you wrote `plan`, a topic kept with no scene, a skipped topic that still has scenes, and a topic none of whose scenes draws its view. When the storyboard is valid, `validate` saves your `plan` in `plan-built.json`, and `outline` groups the scenes by topic.

## 5. Write the storyboard

Write `storyboard.json` in the run's directory, the one `extract` or `init` printed. The JSON must match this TypeScript schema exactly.

```ts
{{STORYBOARD_TYPES}}
```

Then check it.

```bash
{{MR_CAST}}/bin/mr-cast validate <flags>
```

Fix every error and rerun until it prints `✓ storyboard ok`. Resolve the warnings the reference names too, and every warning that says a step's words name what is `not lit` or that a swap lands `before its words`. Treat other warnings as advice.

**Check what each step lights.** When a scene other than `code` has `steps`, check that every step lights what its words talk about. `validate` catches a value or a full label the words name, but not "the left one", a step whose light lags its words, or a change that happens a step early. Run this after `validate` passes:

```bash
{{MR_CAST}}/bin/mr-cast steps <flags>
```

It prints each step's words beside what is lit and what changes on screen. Then make one `Agent` call with `model: "sonnet"`. Its prompt is the text of [references/highlight-audit.md](references/highlight-audit.md) with the `steps` output pasted under its last heading. It answers `no problems`, or one line per step whose words and light disagree, with a fix. Apply each fix you agree with, by changing the step's `focus`, giving a change its own step, or rewording, then rerun `validate`. Make one call for the whole video, not one per scene, and do not call it again after the fixes. Skip this check in quick mode.

### Teach the change

Write the video the way a good teacher would explain the change to this viewer. People understand a new idea faster when they first see one concrete case. They learn even more when they see what goes wrong without the change, and when each step comes with its reason. Review guides also say to start with why the change exists and its approach before any line of it.

- **Start from one concrete case.** Pick one real case, with real values, that shows the problem: "a visitor sends a twenty-first request inside one minute, and today it still goes through." The intent says it. Then the diagrams, the code and the tests follow that same case, so the viewer always knows what is happening to it. Use a second case only when the change handles two different ones, and then show the two side by side, as a `compare`.
- **Problem first, then the approach in one sentence, then the parts.** Before any diagram, the viewer should know what goes wrong today, or what was missing, and the one idea of the fix, such as "count each visitor's requests per minute, and refuse past twenty". Every later scene is a part of that idea.
- **Show the old behaviour before the new.** When the change fixes or alters behaviour, show the same case before and after: a `compare` row, a `sequence` or `flow` step that names the old result, or for a bug, a `terminal` with the failing test or the repro. Use only output you actually ran or read. Never invent output.
- **Ask the question, then answer it.** Open each code scene by saying the question it answers, such as "So how does the limiter know it is a new minute?" Then the steps answer it and give the reason: "because the key includes the minute, a new minute starts a new count." Never show code without saying why the viewer is looking at it.
- **Example first, then the rule.** After the case has gone through, say the general rule and where it stops: "Any client past twenty in a minute is refused, but the count is per server, so two servers allow forty."
- **Name the likely wrong reading.** When the code invites a mistake, such as a name that suggests the wrong unit or a check that seems to run first but does not, say the wrong reading and why it is wrong. Do this at most once or twice a video.
- **Say what you skip.** When you leave something out, say so in a few words, such as "the logging changes are routine, so I skip them". The viewer then knows nothing was hidden.
- **Close the loop.** The last scene's narration ends with what the video showed is proven, and what the viewer should still check. It ties back to the concerns the intent scene listed.

The audience decides the order and the depth.

- **A reviewer** (`familiar`) reads a change with these questions, roughly in order. Why does it exist? Is the approach right? How does it work, and is it correct and complete? What else could it break? Is it tested? Follow that order. The intent gives the why and the concerns. The diagrams show the approach. Code scenes go in order of importance: the main behaviour first, then the code that supports it. Group related hunks together, not file by file. Then show what else it could break, such as callers, a migration, a public API or two requests at once, as their own scene or step. When the diff leaves a caller unchanged that should have changed, say so. The tests come last. Skip background a reviewer of this code already knows, such as what the service is for, and say that you skip it. Never skip a hunk for this reason.
- **Someone new to this code** (`new`) needs the code as it is today before the change. Name the few terms they will hear before they hear them. Follow the concrete case through every step, line by line, as [Simple mode](#simple-mode) says.
- **A reviewer who reads the code next** (`preread`) follows the reviewer's order with no code on screen, then gets the order in which to read it. [Pre-read mode](#pre-read-mode) says how.
- **The team** (`overview`) needs the problem, the approach, what changes for users, the risk, how well it is tested, and who should look closer. [Overview mode](#overview-mode) says how.
- **An explanation** follows the same order: the question or symptom as a concrete case, then the idea, then the parts, then the code.

### Shared rules

The viewer has not read the diff or your explanation. A good walkthrough lets them understand it from the video alone. Complete coverage of the important details matters more than a short video. When you are unsure whether a detail belongs, include it.

- Plan before you write scenes, as the reference says. Every scene must serve the plan.
- Order the video top-down. Start with the overview, then high-level diagrams, then the code, then the tests. Put all the high-level diagrams (`graph`, `sequence`, `flow`, `er`, `state`, `layers`, `array`, `memory`, `mermaid`) before the first code scene, and never go back to a diagram scene once the code starts. A code scene may still carry a `flow` step diagram beside its code.
- Open with one `intent` scene, as the reference describes.
- Show anything that can be a diagram as an animated diagram. Draw it in the diagram section, then show the code that implements it later. Component interactions, call order, a lifecycle, a schema, and data moving through steps all belong in diagrams. A video with four or more code scenes usually needs at least two diagrams, such as a `sequence` for a call chain and a `state` for a lifecycle.
- Three marks say three different things. Never use one for another's job.
  - `change` (`added`, `removed` or `modified`) records what this diff actually does to a node, edge, participant, message, table, field, relation, state, transition, table row or file. Mark exactly that and nothing more. A viewer reads every change mark as a fact about the diff. `validate` warns when most of a diagram is marked, and when a table, field, state or row marked `added` or `removed` names nothing the diff changes.
  - To draw attention, use focus `steps` first, so the viewer looks at each part as the narration names it. Use `highlight: true` for a static "look here" on the one or two parts the whole scene is about. It draws a white glow with no word.
  - `badge` is a short label of your own, up to 14 characters, such as `"hot path"`, `"owner"`, `"v2"` or `"key"`, with `tone` for its colour. Use it to name a role or property the picture cannot show. Never write a change word (`new`, `changed`, `removed`) as a badge. Use `change` for that.
- An explanation has no diff, so leave `change` off entirely. Point with `steps` and `highlight`, and label with `badge`. Only when the explanation is itself about a change, such as how a migration reshaped a table, set `"explainsChange": true` on the storyboard, or on the one scene that shows the change, and mark what that change did.
- Pick the scene whose shape matches the idea, so the picture's layout carries the meaning: parts and links are a `graph`, order or nesting is `layers`, calls over time are a `sequence`, statuses are a `state`, time is a `timeline`, two versions side by side are a `compare`, values that change step by step are an `array` or `memory`, a shell session is a `terminal`. When two fit, pick the one whose steps change the fewest things at a time. Unsure which primitive? Read the [mr-cast-primitives index](../mr-cast-primitives/SKILL.md).
- Use a `graph` scene for structure, meaning the parts and how they connect, whether they are services, people, teams or documents. (Older storyboards called it `arch`; write `graph`.)
- Use a `graph` of shapes, a flowchart, for branching logic: a check that decides what happens next, such as a guard, a retry-or-give-up rule or a fallback. Give the check `"shape": "decision"` with a short question, such as `"Cache hit?"`, and label each edge leaving it with its answer, `"yes"` and `"no"`. Draw where the flow starts and ends as `"shape": "terminal"`, and each action as `"shape": "step"`, a plain box with no icon. A graph with a decision lays out top to bottom by itself. Walk the one path the narration follows in `steps`: the decision, the edge of the answer taken, then the next node. Prefer a `state` scene when the story is which status a thing is in, a `sequence` when it is who calls whom in what order, and a `flow` when it is how the data changes.
- Give each `graph` card and `sequence` participant an `icon`, any Lucide icon name in kebab-case such as `server`, `database`, `user`, `users`, `headset`, `building-2` or `file-text` (https://lucide.dev/icons), and a short `caption` that says what it is, such as `datastore` or `customer`. Put nodes that belong together in one `group`, such as a team, and use `"layout": "TB"` for a hierarchy or a hand-off from top to bottom. Set an edge's `direction` to `both` for a two-way relationship or `none` for a plain link, and its `style` to `solid` for a relationship where nothing moves or `dashed` for a weak or indirect one. Use `tone` to tell kinds of nodes apart, such as people `good` and systems `neutral`. `validate` rejects an icon Lucide lacks and suggests close names. Storyboards that use the older `kind` and `modified` still work, but write `icon`, `caption`, `change` and `highlight`.
- Use a `layers` scene instead of a `graph` when order or nesting is the story: a layered architecture (UI, API, domain, data), a middleware or plugin chain, network or OS layers, or C4 levels. List the `layers` top to bottom in their real order, the first to see a request on top, 2 to 7 of them, each with a short `caption` and up to 5 `items` (cards with an `icon`, as in a graph). Ids are unique across layers and items. To show a request moving through the stack, give a `path` with its `label` (`"POST /orders"`) and its `stops` in order, down the stack, and `"return": true` with a `reply` (`"201 Created"`) for the answer coming back up. When one stop answers early, such as a rate limiter or a cache, keep the full list of stops and add `"skip": { "at": "limiter", "reply": "429 Too Many Requests" }`: the token turns back there and the stops below fade as never reached. Walk the stops in `steps`, in order, and end on the first stop to bring the reply back up; when the token turns back at the first stop itself, focus it twice.
- Use a `flow` scene when data moving through steps is the story. Each step names a real actor (function, service, component) and shows the payload as it looks after that step. Use 3 to 7 steps.
- Use a `sequence` scene when the order of calls matters, such as a request path, a new hop, async work, or retries. List messages in time order, use `return` for responses and `async` for fire-and-forget, and use a self-message (`from` equal to `to`) for significant internal work. Keep it to 6 participants. A longer sequence keeps every message readable and scrolls under its pinned participants, the camera following the steps, so walk one with more than about 12 messages in `steps`, each a few messages long. Past 24 messages split it into two scenes. Prefer `flow` when the data's shape is the story, and `sequence` when who calls whom is.
- Use an `er` scene for a data model or a schema change. Show each table that matters and its directly related tables, with keys and the fields in play.
- Use a `state` scene for a lifecycle or status machine. Find the states in enums, status columns, or reducers. Set `initial`, mark terminal states `final`, and label each transition with its event or guard. Keep it to 10 states.
- Use a `mermaid` scene only for a diagram no other scene covers, such as a class diagram, gantt chart, git graph, or pie chart. Keep it to about 12 nodes, and run `{{MR_CAST}}/bin/mr-cast still <sceneIndex> <flags>` to confirm it renders and fits.
- Use a `table` scene for facts that line up in rows, such as config, API parameters, error codes, or a decision matrix. For the branch, mark rows the diff adds or removes with `change`, and write a value it changes as `{ "before": "0", "after": "3" }`. List row indexes in `highlight` in the order the narration names them. Keep it to 10 rows and 6 columns, and put it before the code with the diagrams.
- Use a `chart` scene when a number is the story, such as latency, size, memory, a count, or a limit. Use `bar` for categories like p50, p95 and p99, and `line` for a trend. Give two series named `before` and `after` to get a change badge on each label, and set `better` to `lower` or `higher` so the badges read green or red. Use real measured or documented values, never invented ones. Set `annotation` on the one point the narration explains.
- Use a `timeline` scene when timing is the story, such as retries and backoff, timeouts, expiry windows, a schedule, or a rollout plan. Place each event at its real time in one `unit`, and draw waits and windows as `spans`. Keep it to 8 events and 4 spans.
- Use a `compare` scene when two things are best understood side by side: old and new behaviour, an API or config shape, two designs, or what the user sees before and after. Give each row a `label` for the aspect it compares, such as "On Redis outage", and one cell per side, as text or `{ "code": "...", "lang": "ts" }` for a snippet of a few lines. Name the sides in `sides` when they are not "Before" and "After". A row whose two cells are equal dims as the same; set `verdict`, such as `["bad", "good"]`, on a row where one side is better. Keep it to 6 rows, and walk them top to bottom in `steps`.
- Use a `terminal` scene for a shell session: repro steps, running a migration, a failing then passing test run, a CLI before and after, or logs. Give each entry a `command`, its `output` (lines separated by `\n`), and its `exit` status when it matters, which tints a failure red. Colour a log word or line with markup, such as `[FAIL]{bad}`. Trim the output to the lines the narration names, and set `window`, such as `"zsh: ~/app"`. A session of more than 3 entries needs `steps`, one or two entries a step, so each command holds while it is explained.
- Use an `array` scene when an algorithm or a buffer changes step by step: binary search, a sliding window, a pagination cursor, a ring buffer, a queue, an off-by-one bug. List up to 16 `values`, name `pointers` such as `lo`, `hi` or `cursor` at cell indexes (`-1` and the length stand just past either end), and shade `ranges` such as a window or a page. Each step changes the array at its start, before its words: `set` gives cells new values, as `{ "3": 42 }`, and `move` puts a pointer at a new cell or a range on new cells, as `{ "lo": 4, "window": "2-5" }`. `show` and `hide` bring a pointer or range in or out, as `["ptr:mid"]`. Because a change lands before the words, compare, then swap: one step focuses both cells while the words compare them, and the next step swaps them. The [array file](../mr-cast-primitives/primitives/array.md) of mr-cast-primitives has the full rule and an example.
- Use a `memory` scene for what a program holds: mutation and aliasing bugs, references versus copies, closures, what a request handler keeps, cache entries. List up to 4 call `frames`, outermost first, each with its `vars`, and up to 6 `objects`, each with an `id`, a `type` and its `fields`. A value written `{ "ref": "c1" }` draws an arrow to object `c1`, so two arrows into one object show two names sharing it. A step's `set` changes a variable or field, as `{ "main.total": 3 }` or `{ "c1.items": { "ref": "l2" } }`, which re-routes its arrow. List objects and frames a later step creates with `"hidden": true` and `show` them then, and `hide` a frame that returns. In both scenes a step without `focus` focuses what it sets, moves or shows, so give a step that only hides a `focus`, and `validate` names any change whose ref names nothing.
- Move the viewer's attention with `steps` whenever the narration talks about one part of a diagram at a time. Each step gives a `focus` and the words to `say`, and what it focuses lights half a second before those words while the rest dims. A `focus` is one ref or an array of them. In a `graph` it is a node id, an edge `"a->b"` (`"a-b"` for either direction) or a group `"group:Name"`; in a `sequence` a message index, an `"a-b"` range or a participant id; in an `er` an entity id, a field `"orders.status"` or a relation `"users->orders"`; in a `state` a state id, a transition `"pending->paid"` or its label; in a `table` a row index, a column `"col:Header"` or a cell `"Header@row"`; in a `chart` a label, a series `"series:name"` or one value `"series@label"`; in a `timeline` an event index or range, or a span `"span:label"`; in `files` a path; in `tests` a case index or a gap `"gap:0"`; in `layers` a layer id, an item id or `"layer.item"`, or a path stop index, and focusing a stop moves the token there; in an `array` a cell index, an `"a-b"` range of cells, a pointer `"ptr:lo"` or a range `"range:window"`; in a `memory` a frame `"frame:main"`, a variable `"main.cart"`, an object id or a field `"c1.items"`; in an `intent` a bullet index; in a `compare` a row index or `"a-b"` range, a side `"side:After"`, or a cell `"2@After"`; in a `terminal` an entry index or `"a-b"` range, or an output line `"2:3"`. Walk a path by focusing a node, then the edge leaving it, then the next node, or a node and its edge together. A `sequence`, a `timeline`, a `compare` and a `terminal` also draw their messages, events, rows or entries as the steps reach them, so focus those in order until each has a step. A `flow` gets a `say` on every step instead. The diagram draws in before the voice starts, so the scene's `narration` becomes a one-sentence intro. Keep to 8 steps a scene, and leave steps off a small diagram the narration takes in as a whole.
- Show one idea per code scene, and narrate exactly the lines highlighted. When a hunk or snippet mixes several ideas, split it into separate scenes. The `calloutText` must be about the code on screen. Reference code by `hunkId` and never paste code into the storyboard.
- Set `focusLinesAfter` from the printed line numbers, as numbers or `"start-end"` strings, on the lines the narration talks about. Use `focusLinesBefore` for removed code. Code with more than 12 changed or shown lines needs a focus.
- Highlight at most 8 lines per range and 3 ranges per scene (4 with `flow`). The ranges play top to bottom, one at a time, so narrate them in that order. Each `"start-end"` string is a range of its own, so write `["11-12", "13", "14-17"]` to walk contiguous lines as three steps.
- Set `flow` on a code scene whose lines carry control flow, such as a branch, a retry-or-give-up decision, an allow-or-reject path, a state change, or a multi-step algorithm. The scene then draws a step diagram beside the code, and each step lights up with its range. Give `flow` one entry per focus range, in the same top-to-bottom order. Write each `label` in plain words about what that range does, such as "count the request in Redis", in under 60 characters. Add an `outcome` to a step that branches or ends the flow. Leave `flow` off declarations, config, and plain data shapes.
- Use `steps` instead of `focusLinesAfter` and `flow` when the voice should track the lines. Each step names its `lines` (or `oldLines` for removed code) and the words to `say` while they are highlighted, and lasts as long as those words take. Write the steps top to bottom, at most 8 per scene, and give every step a `label` to draw the step diagram beside the code. The scene's `narration` is then the intro spoken before the first step, so use it to say what the code is.
- Draw a pen `mark` on a step only for the one thing its sentence is about on a busy screen, such as a node that is a single point of failure, a risky value in code, or a missing piece. `circle` rings it, `underline` and `box` draw under and around it, `arrow` points at it from a free spot, and `strike` and `cross` cross it out. Add a `note` of a few words, up to 40 characters, such as `"no fallback"`. The mark goes on the step's first `focus` ref, or on a code step's lines, or on its `token`, text that occurs once on those lines such as `"max: 20"`. It draws itself just before the step's words and clears when the next step starts. Keep marks rare, at most 2 a scene and a few a video, because a mark on every step stops meaning anything. On a simple diagram, focus alone is enough.
- Text on screen is never cut. Every label, caption, bullet, note and cell wraps and then shrinks to fit its place, and `validate` fails on any that still does not fit at its smallest readable size, as `scenes[2].messages[4].label: "..." does not fit its message label, even at 15px; shorten the label, or split the message in two`. Fix it the way the error says: shorten the text, split a step or message in two, or lay a graph out top to bottom with `"layout": "TB"`. Never abbreviate into words the viewer must decode.
- Style on-screen text sparingly with inline markup, only the one word or value a sentence is about: `**bold**`, `` `code` `` for an identifier, `==marked==` for a highlighter, and `[words]{tone}` in `good`, `bad`, `warn`, `accent` or `neutral`, as in `"the limit is **20 per minute**"` or `"Redis down: requests [fail]{bad}"`. Bold and code may sit inside a mark or a tone. `validate` fails on unclosed markup and an unknown tone, and warns when most of a text is styled. Narration, `say` and pen notes stay plain.
- Explain each rule once, completely, in one place. If a behavior spans several files, such as when something retries and when it gives up, explain it fully in one `flow`, `sequence` or `state` scene instead of in pieces across code scenes.

### How the voice talks

Every narration and `say`, in every audience, is one person explaining the change to another out loud. The listener hears each sentence once, cannot rewind, and may not be looking at the code. Write what you would say to a colleague at their desk.

- **Plain words.** Say what the code does for the user in everyday words. Name the job, not the mechanism: "counts how many requests each visitor sent this minute", not "increments a Redis counter keyed by IP".
- **Code names stay on screen.** Never read out an identifier, file path, symbol, operator or status code as written. Say what it is: "the create order function", "the orders table", "too many requests". Say a number such as "four twenty-nine" only when the number itself matters. The screen shows the exact name.
- **Name the subject.** Open every scene and every step by naming what it is about, never with a bare "It", "This" or "That". Use one only when the sentence before named the thing. When in doubt, name it again. Say what the lines do, not "this line" or "here".
- **Keep your promises.** When you say "two questions" or "three parts", name each one in order: "The first question is ...". Give a stand-in word its meaning once: "each visitor, meaning each IP address".
- **One idea per sentence.** Short sentences in the active voice, under about 25 words, with no stacked clauses.
- **Explain a term once.** The first time a technical term is needed, explain it in a few words, as in "Redis, a shared in-memory store". Otherwise replace it with plain words.
- **Say why.** Say why each change matters, such as what breaks, what the user sees, or what risk it removes, not only what changed.
- **Say something new.** Each scene adds to what the viewer heard before. A diagram of the parts, the order of calls and the data at each step tell three different things, so do not retell the same path in each.
- Say behavior outright, with real values: "after twenty requests in a minute, the limiter refuses the request". When a scene explains a behavior without showing its code, name the file and function it lives in, in words.

Before and after, from the demo:

| Before | After |
| --- | --- |
| "The limiter buckets each IP into a one-minute window, increments a Redis counter, and sets the expiry only on the first hit." | "The rate limiter counts each visitor's requests in the current minute. The count starts again at zero every new minute." |
| "Past twenty requests it answers 429 with a Retry-After header." | "Past twenty requests, the limiter answers with a too many requests error, and says when to try again." |
| "They now look up each SKU in parallel, and empty orders are rejected up front." | "Now the orders service asks the pricing module for each item's real price. An order with no items is refused before anything is saved." |
| "The server mounts the limiter on the orders route." | "The API puts the rate limiter in front of the orders route, the address clients send new orders to." |

`validate` warns about spoken text that reads as code, a bare status code, a sentence over 25 words, a scene that opens on a bare "It" or "This", and a short list of terms to explain or replace. Each warning quotes the phrase and says what to say instead. The voice already reads "e.g.", "5s", "200 ms", an arrow and "v0.14" as words, so write those however you like.

Write 15 to 50 words per scene, and at most 35 over a `graph` or `sequence` diagram, where the viewer learns the names the rest of the video uses. Markup in spoken text is dropped, so style the words on screen instead. Scene length comes from the spoken audio, or from word count without it, so never compute frames or seconds. Let the source set the length. If the user asks for a shorter or longer video, cut or add detail, not coverage. Give each scene a short `chapter` title.

### Simple mode

Use simple mode when the audience is `new`. With `--audience new` in `<flags>`, `validate` and `outline` say `simple style` and check the rules below. Phrases like "explain like I'm stupid", "ELI5", "simple", "line by line", "for a non-native speaker" or "I'm new to this" answer the audience this way when the user asked for a video. They never start a video by themselves.

The viewer is new to the codebase, reads English as a second language, or both. They want to understand every line. A long video is fine.

Build context first. Read the callers of each function you show, the definitions and types it uses, the tests, and the config a value comes from. Add the key pieces with `{{MR_CAST}}/bin/mr-cast snippet` and show them in `code` scenes before the code they support, as what this code does today. Diagrams still come first, and anchor the names the steps will use. Walk every diagram in `steps`, `graph` included, one or two short sentences each.

Write every `code` scene with `steps`. Walk the lines in order, one line or a small group of up to 3 lines per step. For the branch, put every changed line of the hunk in a step, and `validate` warns about the lines you miss. Spend the time where the code is hard. Put imports in one short step, and fold a closing brace into the step before it. Split a dense line, such as one that builds a key from several values, into two steps. Give the scene a short `narration` that says what the thing is before the steps say what it does, such as "This is the rate limit function. It runs before each request to the orders route."

Write for someone reading subtitles in a second language, on top of [How the voice talks](#how-the-voice-talks):

- Keep sentences under 18 words. `validate` warns about longer ones.
- Prefer the simplest word: "gets" to "retrieves", "stops" to "short-circuits". Avoid idioms.
- Name what a thing is before what it does. "Redis is a fast store for small values. The limiter keeps its counters there."
- Say the value and its effect. "Max is twenty, so the twenty first request in a minute is refused."
- In each step, say what the line does to the data, not how the syntax reads, unless the syntax is the point.

### Overview mode

Use overview mode when the audience is `overview`. The viewer wants to know what changed or how the parts fit, and why, not how each line works.

- Keep the intent scene, the diagrams, and for the branch the tests scene.
- Show at most 3 `code` scenes, on the lines that carry the main behavior. The reference says how to record the rest.
- Say behavior in the diagram narration, with real values, instead of in code scenes.
- Aim for under 3 minutes.

### Pre-read mode

Use pre-read mode when the audience is `preread`. The viewer will review the code right after the video, so the video builds the model in their head and hands them the code in order. It follows the reviewer's order of [Teach the change](#teach-the-change), with these changes:

- **No code on screen.** No `code` scene, and no code cell in a `compare`. `validate` rejects both. Identifiers and file names may appear on screen; expressions and code lines may not. `validate` warns about a label that writes code, such as an object literal `{ status: 'pending' }`, an arrow `=>`, a comparison `===`, `&&`, a call with arguments `claimDue(row, now)`, or statements split by `;`. Say it in words instead: "status pending, next try in 10 s". Label each diagram with the real identifiers and file names, such as `` `checkLimit` `` and `` `limiter.ts` ``, so the viewer can map the picture onto the code. Put the facts a code line would show, such as limits, keys, conditions and order, into the labels and the narration with their real values. This warning reads diagram labels only. A reading item's `check` and a terminal session may name operators and identifiers as inline code, such as "`>=` on (created_at, id)".
- **Draw what the code does, not what it is meant to do.** When the diff behaves differently from the intent, such as a `>=` where the intent says "after", the diagram shows the code's behaviour, and the reading item says what to check there. A diagram of the intended behaviour hides the bug from the reviewer.
- **Name every change in the intent.** The `intent` narration names every change a user or caller would notice, one sentence each, not only the main story. A branch that rate-limits orders and also starts pricing them from the catalogue names both.
- **Say totals from the screen.** A spoken total of a schedule or a count matches the numbers on screen: waits of 5 s doubling to 320 s add up to 635 s, "about ten and a half minutes", not "about nine". Add the numbers before you say the total.
- **`from` on each diagram.** Give each diagram scene that explains changed code `"from": ["h1", "h3"]`, the ids of at most 3 hunks it explains. The scene then shows a quiet "In the code: limiter.ts, server.ts" line, and the reading order says which chapter explains each hunk. `validate` warns when a cited hunk's file name, or one of its identifiers written as code writes them (`checkLimit`, `MAX_REQUESTS`, `retry_count`), appears in none of the scene's labels. Only labels count, not the narration or a step's `say`, since the viewer maps what they see onto the code. Plain words such as `limit` do not count. Give two scenes that cite hunks their own `chapter`, since each reading item names the chapter that explains it.
- **Explain what the reader needs to read the code.** The video does not have to cover every hunk. The reading order does.
- **The tests stay.** Keep the `tests` scene, with no test code.
- **End on a `reading` scene**, after the tests. Its `items` are the order to read the code in, main behaviour first, with related hunks together, as the code scenes of a reviewer's video would go. The order is grouped by the `topic` of the scene that explains each item, each topic once, and numbered in that order, so keep a topic's items together and the numbers you say will match. Each item is `{ "hunkId": "h1", "check": "the key resets on a new minute; check the off-by-one" }`: `check` says what to verify there, in under 80 characters, with the real values. Mark wiring, renames and config `"routine": true`, with no `check`; they go on one "skim" line. The file and lines come from `hunks.json`, so never type them. A new file's hunk is the whole file, so point at the lines that matter with `"lines": "40-58"`, inside the hunk's new lines. `validate` rejects lines outside the hunk and warns about an item over 40 lines without `lines`. A `check` says what to verify and where, such as "the cursor's own row is returned again on the next page". Never write a list of nouns ("query bounds and ordering"), trivia, or "off by one" without saying where. Every substantial hunk must be an item or in `skipped`, and `validate` warns about each one that is neither. The scene shows the first 6 items to read under "Read first" and counts the rest. Narrate only the first three and why they come first.
- **Point at the item.** For a claim the video cannot show, such as an off-by-one or a missing await, say "check this at item 2" in the narration, with the item's number in the reading order. Name only an item whose hunk the scene cites in `from`. `validate` warns about a number the order does not have, and about an item whose hunk the scene does not cite.
- **Review mode.** Flag each finding on the item of its hunk with `"flag": "<finding id>"`, never on a diagram step. The finding's line must be in that hunk's new lines. The item shows it in its severity's colour, such as "Claude: likely bug, the count is per server". A pre-read has no `review` scene: the reading scene is the one closing list, and `review.md` still lists the findings.

With `--audience preread`, `validate` writes `reading.md` in the run's directory, a checklist of the reading order with each topic once, and `outline` prints it as `1. src/limiter.ts:12-30  check` lines. A routine hunk of a file the order already lists goes on that file's item, as "also 1-6", never on a skim line. Without the flag, a storyboard with a `reading` scene or a `from` warns `this storyboard is a pre-read; pass --audience preread`, and no `reading.md` is written. The player shows the same list in a Reading order panel beside the video, with "Copy as checklist" for the merge request.

## 6. Check the plan with the user

```bash
{{MR_CAST}}/bin/mr-cast outline <flags>
```

For the player, show the outline and go straight to step 7. The player reloads as you edit, so the user can ask for changes while it plays.

Before an MP4, show the outline as it prints, with at most one sentence of your own. Then ask with one `AskUserQuestion` call, header "Plan", question "Render this plan?":

- "Render it (Recommended)". Description: "Make the MP4 now."
- "Make it shorter". Description: "Cut minor scenes and trim the narration."
- "Make it longer". Description: "Add more steps, diagrams and edge cases."

The user can pick Other to describe any other change. Apply the change and rerun `validate <flags>`. If the change was substantial, show the new outline and ask again. Render once they pick "Render it". Skip this question when the user said "just make it", "use the defaults" or "no questions".

## 7. Show it

Start the player as a background command so it keeps running.

```bash
{{MR_CAST}}/bin/mr-cast play <flags>
```

`play` voices the narration in the voice and at the pace its flags give, then opens the player, which waits for a click and plays with its voice. `render` voices everything first too. Voicing takes about a third of the length of the audio, so a minute of narration takes about 20 seconds, and clips already made are reused. The first run downloads a voice model of about 90 MB into `~/.cache/mr-cast`, which takes a minute. If the voice model cannot load, the command prints a warning and continues without voice. Tell the user if that happens.

To change the pace or turn the voice off, change `<flags>` and pass the new flags to every command after that. To pick another voice, add `--voice <name>` to `<flags>`: `af_heart` (default), `af_bella`, `am_michael`, `bf_emma`, or `bm_george`.

`play` prints `mr-cast player: <url>` at once and opens the browser once the voice is ready. Give the user that URL, and tell them the page opens once the voice is ready, in about a third of the narration's length. If `play` prints that voicing failed, tell the user the player plays silent with subtitles and why. The player has a speed control from 0.75x to 1.5x. When `storyboard.json` changes, it keeps playing and shows "Updating..." until the changed narration is voiced, then reloads once. End your reply with: "Say 'save it as an MP4' when you want a file to share."

With a `plan.json`, the player also has a Plan tab with the same picks. When the user changes a pick there, the row says "Changed, not in the video yet", and the page asks them to say "update the video" in the terminal. Then run `validate <flags>`: it names each topic whose pick changed. Rewrite only the scenes of those topics, update their entries in the storyboard's `plan`, and run `validate <flags>` again. Only those scenes need voicing again.

For an MP4, run `{{MR_CAST}}/bin/mr-cast render <flags>` instead of `play` (add `--out <path>` to choose the location). It takes minutes, so give it a long timeout or run it in the background. It writes the MP4 into the run's directory, named after the storyboard title, such as `.mr-cast/feature-rate-limit/rate-limiting-for-the-orders-api.mp4`, with a chapter marker for each chapter title, and prints its path. Give the user that path. The first render downloads a headless Chrome and takes a few minutes. Renders of different runs can run at the same time.

To check how scenes look without a browser, run `{{MR_CAST}}/bin/mr-cast still [sceneIndex...] <flags>` and read the PNGs it prints. Do this when a scene has long text, many nodes, or a large hunk or snippet.

In a pre-read, end your reply with the reading order as `outline` prints it, one `path:line  check` line per item, so the user can click each one to open it in the editor, and give the path of `reading.md`.

When review is on, `validate` writes the findings to `review.md` in the run's directory and prints its path, and `render --out` writes a copy beside the MP4. In your final reply, list every finding as `severity file:line claim`, one per line, and give the path of `review.md`. With no findings, say that nothing looked wrong.
