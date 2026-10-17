# Adapt the article into a storyboard

The article is the content contract. The storyboard conveys it on screen and adds nothing to it.

- Each scene adapts one article section, named by `"section": "<id>"`, or by its `topic` when the topic is the section. The intent, files, review and reading scenes frame the whole video and adapt none.
- Keep every idea, the running example, the misconception and the order of the sections. You may condense the wording and drop asides. When an idea does not work on screen, change the article first, run `{{MR_CAST}}/bin/mr-cast article` again, then adapt it. A section that stays in the article alone goes in the storyboard's `textOnly` with the reason.
- The voice says less than the article. What the viewer must hold in mind, such as a condition, a limit or a definition, stays visible as a label, not spoken only.
- Animate only what changes in the explanation, in steps that match the article's steps, with the example's real values. Keep the rest still.
- Order the video top-down: the intent, then every diagram (`graph`, `sequence`, `flow`, `er`, `state`, `layers`, `array`, `memory`, `table`, `mermaid` and the rest) in the article's order, then the code in the article's order, then the tests. Never go back to a diagram once the code starts. A video with four or more code scenes needs at least two diagrams.

## Pick the scene for each idea

Take each idea as the article states it, find its kind below, and use the scene with the least load: what the viewer must hold in their head that the screen does not hold for them. Then read the file of each scene you write, which says when it adds load and the mistakes that add it back, and run `{{MR_CAST}}/bin/mr-cast schema <type>` for its exact fields.

| The idea, as the article states it | Least load | Why it is least load | Runner-up, and when it wins |
| --- | --- | --- | --- |
| A process stepping through data: "each pass bubbles the largest remaining value to the end", "the window slides one cell right", "the search halves the range" | [array](scenes/array.md) | The values stay in place and only what changes moves, so the eye follows one comparison or swap at a time | [memory](scenes/memory.md) when the point is that two names hold the same object |
| An order of calls: "the client calls the API, which asks the cache, then the database" | [sequence](scenes/sequence.md) | Time runs down the page, so the order needs no words | [layers](scenes/layers.md) when the calls go straight down a stack and back up |
| Data changing shape in stages: "the request is parsed, validated, then enriched with the user" | [flow](scenes/flow.md) | Each stage shows its payload beside it, so the viewer never has to remember the last one | [sequence](scenes/sequence.md) when who calls whom matters more than the payload |
| A lifecycle: "an order starts pending, becomes paid, and is cancelled after a day unpaid" | [state](scenes/state.md) | Every status is on screen at once, so a move is one lit arrow | [timeline](scenes/timeline.md) when the times matter more than the statuses |
| A whole lifecycle across services: "a request is accepted, queued, retried, and finally marked done" | [sequence](scenes/sequence.md), then [state](scenes/state.md) | Calls first, then the statuses those calls move through, one picture per question | [state](scenes/state.md) alone when no second actor is involved |
| A structure: "the service talks to a queue and two databases", "a hash map points at each node of the list" | [graph](scenes/graph.md) | Position and lines show what connects to what without a sentence for each link | [layers](scenes/layers.md) when the parts form a stack with an order |
| A stack or chain: "every request passes the middleware in order, and the limiter can stop it" | [layers](scenes/layers.md) | The screen order is the real order, and the token shows where it stops | [graph](scenes/graph.md) when the parts connect sideways, not in a stack |
| A decision: "if the cache has it, return it, otherwise ask the database" | [graph](scenes/graph.md) as a flowchart | The question and its branches are drawn, so the viewer sees both paths and follows one | [code](scenes/code.md) with labelled steps when the whole decision is a few lines |
| A rule for which item goes: "when the cache is full, the least recently used entry is dropped" | [array](scenes/array.md), cells in recency order | One row in order makes "least recent" a place, the end of the row | [graph](scenes/graph.md), the list nodes in a group, when the map pointing into the list is the point |
| Time and waits: "it retries after 1, 2, then 4 seconds", "the token expires after an hour" | [timeline](scenes/timeline.md) | Distance on the axis is time, so doubling waits look doubled | [sequence](scenes/sequence.md) when who acts matters more than when |
| A comparison: "the old code retried forever, the new code gives up after three" | [compare](scenes/compare.md) | Like sits beside like, row by row, so only the difference needs looking at | [table](scenes/table.md) when many settings each change one value |
| A list of facts: "four settings control the limit", "the API returns these error codes" | [table](scenes/table.md) | Rows and columns let the eye look up rather than remember | [compare](scenes/compare.md) when each fact has exactly two versions |
| A quantity, or a quantity over time: "p99 latency fell from 2.4 s to 0.9 s", "memory grows with each request" | [chart](scenes/chart.md), with real numbers | Size is seen, not read, so "much faster" needs no arithmetic | [table](scenes/table.md) when the numbers are to look up, not to compare |
| The shape of stored data: "each order has many items, and each item points at one product" | [er](scenes/er.md) | Keys and lines show how records relate in one picture | [table](scenes/table.md) for one table's columns as facts |
| A reshaping of stored data: "the migration splits the address out into its own table" | [er](scenes/er.md), then [compare](scenes/compare.md) | The model shows the new shape, and one row before and after makes it concrete | [terminal](scenes/terminal.md) when the story is running the migration and what it printed |
| References and copies: "the order kept the cart's own list, so editing the cart changed the order" | [memory](scenes/memory.md) | Two arrows into one box show sharing at a glance | [array](scenes/array.md) when it is one list and its indexes |
| A run and its output: "the test fails with a timeout, and passes after the fix" | [terminal](scenes/terminal.md), with real output | The viewer sees the evidence itself, not a claim about it | [compare](scenes/compare.md) when you know both behaviours but did not run them |
| What the tests prove: "three tests cover the limit, and nothing tests two servers" | [tests](scenes/tests.md) | Each test sits beside what it proves, and the gaps are listed apart | [terminal](scenes/terminal.md) when the run itself is the proof |
| Where it lives: "the change touches the limiter, the server and one test" | [files](scenes/files.md) | A tree places each file once, so names are not juggled | Leave it out when there are 3 files or fewer |
| How the lines do it: "the key includes the minute, so a new minute starts a new count" | A drawing of the idea first, then [code](scenes/code.md) | The picture gives the model, so the lines only confirm it | [code](scenes/code.md) alone when the idea is the lines, such as an off-by-one |
| A shape no other primitive draws: a class hierarchy, a gantt plan, a git history, proportions of a whole | [mermaid](scenes/mermaid.md) | A familiar diagram the viewer already knows how to read | Any row above that fits, since mermaid has no steps |

Three scenes are not picked per idea, so they have no row: [intent](scenes/intent.md), [review](scenes/review.md) and [reading](scenes/reading.md). Their files say what they hold.

When two scenes fit, pick the one whose steps change the fewest things at a time. When one idea needs two pictures, use the short sequence in its row, and let each picture answer one question.

## The load rules, for every scene

A scene with `steps` draws first, then walks them. Each step lights what its `focus` names half a second before its `say` is spoken, and dims the rest.

- **The words name only what is lit.** A sentence about a part that is not lit sends the eye searching. When the sentence needs a second part, add it to the `focus`, or split the step.
- **Build it up.** One new thing a step: one comparison, one message, one move. A step that lights half the picture points at nothing.
- **Few things at once.** About 7 parts on screen is easy to hold; past 12, split the idea into two scenes.
- **Do not say what the picture says.** The `narration` is one sentence that says what the picture is. The steps say why each part matters, not what it is labelled.
- **Walk in order.** A `sequence`, `timeline`, `compare` or `terminal` draws up to the last item a step names, so name the items in order.

## With a plan.json: scenes from the picks

- Set `"topic": "<id>"` on every scene that shows a topic. Leave it off the intent, tests and review scenes.
- Copy your picks into the storyboard's `plan`: for each topic, the pick you wrote its scenes from, `"plan": { "<id>": { "depth": "brief", "view": "calls" } }`. Update an entry whenever you rebuild that topic.
- A topic at `skip` gets no scene. List its hunks in `skipped` with the reason "the viewer chose to skip this topic".
- A topic at `brief` gets one scene of its view, and one code scene on its key lines. Leave the code scene out when the view is `code`, or the audience is the short overview or a pre-read. List its other hunks in `skipped` with the reason "the viewer chose a brief look at this topic", in those words, since a reviewer's video otherwise warns about every substantial hunk it does not show.
- A topic at `deep` gets one scene of its view, then its code line by line, in code scenes with `steps`. In a pre-read it gets its view and a second diagram that traces the concrete case instead, and no code.
- In a pre-read, the depth changes only the video. Every hunk of a `brief` or `skip` topic still goes in the reading order, the minor ones with `"routine": true`, since the reviewer reads the code next. Do not list them in `skipped` with the two reasons above: `validate` warns that such a hunk is not in the reading order.

## Marks, focus and text

- Three marks say three different things. `change` (`added`, `removed` or `modified`) records what this diff does to an item, exactly that and nothing more: a viewer reads every change mark as a fact about the diff. To point, use focus `steps` first, and `highlight: true` for a static "look here" on the one or two parts the whole scene is about. `badge` is a short label of your own for a role or property the picture cannot show, such as `"hot path"` or `"owner"`, never a change word.
- An explanation has no diff, so it leaves `change` off. Only when the explanation is itself about a change, such as how a migration reshaped a table, set `"explainsChange": true` on the storyboard, or on the one scene that shows the change.
- Walk a diagram in `steps` whenever the words talk about one part at a time. Each step's `focus` lights a half second before its `say`, and the scene's `narration` becomes a one-sentence intro. Each scene file lists the refs its `focus` takes. Keep to 8 steps a scene, and leave steps off a small diagram the words take in as a whole.
- One idea per code scene. Narrate exactly the lines that are lit, top to bottom, and open with the question the lines answer. Reference code by `hunkId`; never paste code into the storyboard.
- A pen `mark` goes on a step only for the one thing its sentence is about on a busy screen, such as a single point of failure or a risky value, with a `note` of a few words. At most 2 a scene and a few a video.
- Text on screen is never cut. When `validate` says a text does not fit, do what it says: shorten it, split a step or message, or lay a graph out top to bottom. Never abbreviate into words the viewer must decode.
- Style on-screen text sparingly, only the one word or value a sentence is about: `**bold**`, `` `code` `` for an identifier, `==marked==`, and `[words]{tone}` in `good`, `bad`, `warn`, `accent` or `neutral`. Narration, `say` and pen notes stay plain.

## Before you run validate

Check each, and fix the storyboard where the answer is no:

1. Does each scene adapt one section, in the article's order, with nothing the article does not say?
2. Does the running example, with its real values, go through the diagrams, the code and the tests?
3. Is the old behaviour shown before the new, when the change alters behaviour?
4. Does each code scene open with the question it answers?
5. Does the last scene say what is proven and what to still check?
