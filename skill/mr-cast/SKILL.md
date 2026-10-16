---
name: mr-cast
description: Make a narrated, animated video walkthrough of this branch's changes or of something you just explained, played in the browser or saved as an MP4. Use when the user asks for a video, walkthrough, or animation of a branch, diff, pull request, or merge request, or asks to animate, visualize, or make a video of an explanation, such as "animate that", "make a video of this", or "turn that into a video". It can also flag what looks wrong in the branch as it walks through it, when the user asks for your review. Not for a code review or an explanation that does not ask for a video.
argument-hint: "[mp4] [base-branch | --working | what to focus on]"
---

# mr-cast

Make an animated, narrated walkthrough with mr-cast. Its source is either the current branch's diff or an explanation you gave earlier in this conversation. You write a storyboard JSON. mr-cast plays it in a browser player or renders it as an MP4.

The CLI is `{{MR_CAST}}/bin/mr-cast`. Run every command from the user's repository, or from the directory your explanation is about. The wrapper finds a working Node itself, so call it directly rather than through `node`.

If a command prints `mr-cast <version> is available`, tell the user once, at the end of your reply, that they can ask you to upgrade mr-cast. Do not upgrade unless they ask.

## 1. Pick the source and the output

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

## 2. Ask what the video is for

Ask with one `AskUserQuestion` call before you start the run. Ask only what the request leaves open:

- The user already answered a question with words such as "a simple video" or "explain like I'm new to this" (audience), "slowly" (pace), or "focus on the migration" (focus). A request for a quick or short video answers the audience with the quick overview.
- The user asked for your opinion of the branch, with words such as "review it", "with your review", "find issues" or "flag anything that looks wrong". That turns review on (question 5).
- The user said "just make it", "use the defaults" or "no questions". Skip the call and use the last choices from `status`, else the recommended options. Review stays off unless the words above turned it on.

Say in one line which choice you used for each question you skipped. "Render" means an MP4. It does not skip the questions.

Every question is multiple choice. Put the recommended option first and end its label with "(Recommended)". When `status` shows a last choice for the question, put that option first instead and end its label with "(Last time)", unless it is the recommended option. The user can then accept every default by pressing enter.

1. Only when both sources are live: header "Video of", question "What should the video show?"
   - "Changes on <branch> (<n> files) (Recommended)". Description: the commits and files from `status`.
   - "Your explanation of <topic>". Description: the explanation in one line.
2. Header "Audience", question "Who is this video for?" `status` names these `familiar`, `new` and `overview`.
   - `familiar`: "A reviewer of this change (Recommended)" for the branch, or "A teammate who knows this code (Recommended)" for an explanation. Description: "Diagrams, then the code behind each point."
   - `new`: "Someone new to this code". Description: "Walks the code one line at a time in plain words, after the code around it. Good for a second-language reader. Longer."
   - `overview`: "A quick overview for the team". Description: "Diagrams and behavior, with very little code. Usually under 3 minutes."
3. Header "Focus", `multiSelect: true`, question "Anything to go deeper on? Everything is still covered." Leave this question out when you ask "Video of", because its options depend on the source. The user can still steer the emphasis with Other, or after the outline.
   - First "All areas equally (Recommended)". Description: "Weigh each area by what the viewer needs."
   - Then up to 3 options, each an area of the change or a key point of your explanation in a few concrete words, such as "Rate limiter (Redis counter, 429)". Name branch areas from the files `status` lists. Group small areas so the options cover everything. When the change has tests, one of the 3 can be "Walk through the test code", with the description "Step through each test's setup and assertions."
4. Header "Pace", question "How should it sound?" `status` names these `normal`, `slower`, `faster` and `silent`.
   - "Normal pace (Recommended)". Description: "About 130 words a minute, with pauses between steps."
   - "Slower". Description: "A slower voice and longer pauses. Good for new readers or a second language."
   - "Faster". Description: "A quicker voice and shorter pauses."
   - "No voice, subtitles only". Description: "A silent video, timed for reading."

   When you already know the audience is someone new to this code, recommend "Slower" and list it first, unless a last choice comes first.
5. Only when the branch is live: header "Review", question "Should I also flag what looks wrong?"
   - "No, just explain (Recommended)". Description: "The video explains the change and gives no verdict."
   - "Yes, flag what looks off". Description: "I mark lines that look wrong as the walkthrough reaches them, as my opinion, recap them at the end and write them to review.md."

   Review applies to the branch only. If the user picks their explanation in question 1, ignore this answer.

The answers become the flags, written `<flags>` in every command below:

- Audience: `--audience familiar`, `--audience new` or `--audience overview`.
- Pace: `--pace normal`, `--pace slower` or `--pace faster`, or `--no-voice` for "No voice, subtitles only".

For example, `<flags>` is `--audience new --pace slower`. Pass `<flags>` to every `extract`, `init`, `validate`, `outline`, `play`, `render` and `still` command. A flag applies to its own command only, and the run does not keep it. A command without the flags checks and times the video for a familiar audience at the normal pace, and voices it.

mr-cast remembers these two answers, and `status` shows them next time. Review takes no flag: the storyboard's `findings` turn it on, so it is asked each time.

## 3. Start the run

Read the reference for the source, and only that one:

- The branch: [references/branch.md](references/branch.md).
- An explanation: [references/explanation.md](references/explanation.md).

It says how to start the run, which code to show, and what the video must cover. When review is on, also read [references/review.md](references/review.md), which says how to find, check and show what looks wrong. Then come back to step 4.

The run starts in `.mr-cast/<slug>/` and becomes the current run. Every later command works on the current run. Several runs can coexist in one repository, such as one per branch, or one rendering while you write the next. When you work on more than one, pass `--name <slug>` to every command.

## 4. Write the storyboard

Write `storyboard.json` in the run's directory, the one `extract` or `init` printed. The JSON must match this TypeScript schema exactly.

```ts
{{STORYBOARD_TYPES}}
```

Then check it.

```bash
{{MR_CAST}}/bin/mr-cast validate <flags>
```

Fix every error and rerun until it prints `✓ storyboard ok`. Resolve the warnings the reference names too. Treat other warnings as advice.

### Shared rules

The viewer has not read the diff or your explanation. A good walkthrough lets them understand it from the video alone. Complete coverage of the important details matters more than a short video. When you are unsure whether a detail belongs, include it.

- Plan before you write scenes, as the reference says. Every scene must serve the plan.
- Order the video top-down. Start with the overview, then high-level diagrams, then the code, then the tests. Put all the high-level diagrams (`graph`, `sequence`, `flow`, `er`, `state`, `mermaid`) before the first code scene, and never go back to a diagram scene once the code starts. A code scene may still carry a `flow` step diagram beside its code.
- Open with one `intent` scene, as the reference describes.
- Show anything that can be a diagram as an animated diagram. Draw it in the diagram section, then show the code that implements it later. Component interactions, call order, a lifecycle, a schema, and data moving through steps all belong in diagrams. A video with four or more code scenes usually needs at least two diagrams, such as a `sequence` for a call chain and a `state` for a lifecycle.
- Three marks say three different things. Never use one for another's job.
  - `change` (`added`, `removed` or `modified`) records what this diff actually does to a node, edge, participant, message, table, field, relation, state, transition, table row or file. Mark exactly that and nothing more. A viewer reads every change mark as a fact about the diff. `validate` warns when most of a diagram is marked, and when a table, field, state or row marked `added` or `removed` names nothing the diff changes.
  - To draw attention, use focus `steps` first, so the viewer looks at each part as the narration names it. Use `highlight: true` for a static "look here" on the one or two parts the whole scene is about. It draws a white glow with no word.
  - `badge` is a short label of your own, up to 14 characters, such as `"hot path"`, `"owner"`, `"v2"` or `"key"`, with `tone` for its colour. Use it to name a role or property the picture cannot show. Never write a change word (`new`, `changed`, `removed`) as a badge. Use `change` for that.
- An explanation has no diff, so leave `change` off entirely. Point with `steps` and `highlight`, and label with `badge`. Only when the explanation is itself about a change, such as how a migration reshaped a table, set `"explainsChange": true` on the storyboard, or on the one scene that shows the change, and mark what that change did.
- Use a `graph` scene for structure, meaning the parts and how they connect, whether they are services, people, teams or documents. (Older storyboards called it `arch`; write `graph`.)
- Use a `graph` of shapes, a flowchart, for branching logic: a check that decides what happens next, such as a guard, a retry-or-give-up rule or a fallback. Give the check `"shape": "decision"` with a short question, such as `"Cache hit?"`, and label each edge leaving it with its answer, `"yes"` and `"no"`. Draw where the flow starts and ends as `"shape": "terminal"`, and each action as `"shape": "step"`, a plain box with no icon. A graph with a decision lays out top to bottom by itself. Walk the one path the narration follows in `steps`: the decision, the edge of the answer taken, then the next node. Prefer a `state` scene when the story is which status a thing is in, a `sequence` when it is who calls whom in what order, and a `flow` when it is how the data changes.
- Give each `graph` card and `sequence` participant an `icon`, any Lucide icon name in kebab-case such as `server`, `database`, `user`, `users`, `headset`, `building-2` or `file-text` (https://lucide.dev/icons), and a short `caption` that says what it is, such as `datastore` or `customer`. Put nodes that belong together in one `group`, such as a team, and use `"layout": "TB"` for a hierarchy or a hand-off from top to bottom. Set an edge's `direction` to `both` for a two-way relationship or `none` for a plain link, and its `style` to `solid` for a relationship where nothing moves or `dashed` for a weak or indirect one. Use `tone` to tell kinds of nodes apart, such as people `good` and systems `neutral`. `validate` rejects an icon Lucide lacks and suggests close names. Storyboards that use the older `kind` and `modified` still work, but write `icon`, `caption`, `change` and `highlight`.
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
- Move the viewer's attention with `steps` whenever the narration talks about one part of a diagram at a time. Each step gives a `focus` and the words to `say`, and what it focuses lights half a second before those words while the rest dims. A `focus` is one ref or an array of them. In a `graph` it is a node id, an edge `"a->b"` (`"a-b"` for either direction) or a group `"group:Name"`; in a `sequence` a message index, an `"a-b"` range or a participant id; in an `er` an entity id, a field `"orders.status"` or a relation `"users->orders"`; in a `state` a state id, a transition `"pending->paid"` or its label; in a `table` a row index, a column `"col:Header"` or a cell `"Header@row"`; in a `chart` a label, a series `"series:name"` or one value `"series@label"`; in a `timeline` an event index or range, or a span `"span:label"`; in `files` a path; in `tests` a case index or a gap `"gap:0"`; in an `intent` a bullet index; in a `compare` a row index or `"a-b"` range, a side `"side:After"`, or a cell `"2@After"`; in a `terminal` an entry index or `"a-b"` range, or an output line `"2:3"`. Walk a path by focusing a node, then the edge leaving it, then the next node, or a node and its edge together. A `sequence`, a `timeline`, a `compare` and a `terminal` also draw their messages, events, rows or entries as the steps reach them, so focus those in order until each has a step. A `flow` gets a `say` on every step instead. The diagram draws in before the voice starts, so the scene's `narration` becomes a one-sentence intro. Keep to 8 steps a scene, and leave steps off a small diagram the narration takes in as a whole.
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

## 5. Check the plan with the user

```bash
{{MR_CAST}}/bin/mr-cast outline <flags>
```

For the player, show the outline and go straight to step 6. The player reloads as you edit, so the user can ask for changes while it plays.

Before an MP4, show the outline as it prints, with at most one sentence of your own. Then ask with one `AskUserQuestion` call, header "Plan", question "Render this plan?":

- "Render it (Recommended)". Description: "Make the MP4 now."
- "Make it shorter". Description: "Cut minor scenes and trim the narration."
- "Make it longer". Description: "Add more steps, diagrams and edge cases."

The user can pick Other to describe any other change. Apply the change and rerun `validate <flags>`. If the change was substantial, show the new outline and ask again. Render once they pick "Render it". Skip this question when the user said "just make it", "use the defaults" or "no questions".

## 6. Show it

Start the player as a background command so it keeps running.

```bash
{{MR_CAST}}/bin/mr-cast play <flags>
```

`play` and `render` voice the narration first, in the voice and at the pace their flags give. The first run downloads a voice model of about 90 MB into `~/.cache/mr-cast`, which takes a minute. After that, each new or changed scene takes a few seconds to speak. If the voice model cannot load, the command prints a warning and continues without voice. Tell the user if that happens.

To change the pace or turn the voice off, change `<flags>` and pass the new flags to every command after that. To pick another voice, add `--voice <name>` to `<flags>`: `af_heart` (default), `af_bella`, `am_michael`, `bf_emma`, or `bm_george`.

`play` prints `mr-cast player: http://127.0.0.1:<port>` and opens the browser. Give the user that URL and tell them to click play, since a voiced walkthrough does not autoplay. The player has a speed control from 0.75x to 1.5x, and reloads when `storyboard.json` changes, after it voices any changed narration. End your reply with: "Say 'save it as an MP4' when you want a file to share."

For an MP4, run `{{MR_CAST}}/bin/mr-cast render <flags>` instead of `play` (add `--out <path>` to choose the location). It takes minutes, so give it a long timeout or run it in the background. It writes the MP4 into the run's directory, named after the storyboard title, such as `.mr-cast/feature-rate-limit/rate-limiting-for-the-orders-api.mp4`, with a chapter marker for each chapter title, and prints its path. Give the user that path. The first render downloads a headless Chrome and takes a few minutes. Renders of different runs can run at the same time.

To check how scenes look without a browser, run `{{MR_CAST}}/bin/mr-cast still [sceneIndex...] <flags>` and read the PNGs it prints. Do this when a scene has long text, many nodes, or a large hunk or snippet.

When review is on, `validate` writes the findings to `review.md` in the run's directory and prints its path, and `render --out` writes a copy beside the MP4. In your final reply, list every finding as `severity file:line claim`, one per line, and give the path of `review.md`. With no findings, say that nothing looked wrong.
