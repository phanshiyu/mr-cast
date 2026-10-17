---
name: mr-cast-primitives
description: "Apply when turning one idea into mr-cast scenes and unsure which primitive explains it with the least cognitive load: graph, layers, sequence, flow, state, er, table, chart, timeline, compare, terminal, array, memory, code, mermaid and the rest. Give it the idea as the article states it, such as 'each pass bubbles the largest remaining value to the end'; it returns the primitive, or a short sequence of them, why that is least load, and when the runner-up wins."
user-invocable: false
---

# Which primitive explains this idea with the least load

Take one idea, as a sentence of the article states it. Decide what kind of idea it is, find its row, and use the answer. Then read the answer's file, which says when that primitive lowers load, when it adds load, and the mistakes that add it back. Read only the files you use.

Load is what the viewer must hold in their head that the screen does not hold for them. The least-load primitive is the one whose layout already says the relation, so the words only name the parts.

## What kind of idea is it?

| The idea, as the article states it | Least load | Why it is least load | Runner-up, and when it wins |
| --- | --- | --- | --- |
| A process stepping through data: "each pass bubbles the largest remaining value to the end", "the window slides one cell right", "the search halves the range" | [array](primitives/array.md) | The values stay in place and only what changes moves, so the eye follows one comparison or swap at a time | [memory](primitives/memory.md) when the point is that two names hold the same object |
| An order of calls: "the client calls the API, which asks the cache, then the database" | [sequence](primitives/sequence.md) | Time runs down the page, so the order needs no words | [layers](primitives/layers.md) when the calls go straight down a stack and back up |
| Data changing shape in stages: "the request is parsed, validated, then enriched with the user" | [flow](primitives/flow.md) | Each stage shows its payload beside it, so the viewer never has to remember the last one | [sequence](primitives/sequence.md) when who calls whom matters more than the payload |
| A lifecycle: "an order starts pending, becomes paid, and is cancelled after a day unpaid" | [state](primitives/state.md) | Every status is on screen at once, so a move is one lit arrow | [timeline](primitives/timeline.md) when the times matter more than the statuses |
| A whole lifecycle across services: "a request is accepted, queued, retried, and finally marked done" | [sequence](primitives/sequence.md), then [state](primitives/state.md) | Calls first, then the statuses those calls move through, one picture per question | [state](primitives/state.md) alone when no second actor is involved |
| A structure: "the service talks to a queue and two databases", "a hash map points at each node of the list" | [graph](primitives/graph.md) | Position and lines show what connects to what without a sentence for each link | [layers](primitives/layers.md) when the parts form a stack with an order |
| A stack or chain: "every request passes the middleware in order, and the limiter can stop it" | [layers](primitives/layers.md) | The screen order is the real order, and the token shows where it stops | [graph](primitives/graph.md) when the parts connect sideways, not in a stack |
| A decision: "if the cache has it, return it, otherwise ask the database" | [graph](primitives/graph.md) as a flowchart | The question and its branches are drawn, so the viewer sees both paths and follows one | [code](primitives/code.md) with labelled steps when the whole decision is a few lines |
| A rule for which item goes: "when the cache is full, the least recently used entry is dropped" | [array](primitives/array.md), cells in recency order | One row in order makes "least recent" a place, the end of the row | [graph](primitives/graph.md), the list nodes in a group, when the map pointing into the list is the point |
| Time and waits: "it retries after 1, 2, then 4 seconds", "the token expires after an hour" | [timeline](primitives/timeline.md) | Distance on the axis is time, so doubling waits look doubled | [sequence](primitives/sequence.md) when who acts matters more than when |
| A comparison: "the old code retried forever, the new code gives up after three" | [compare](primitives/compare.md) | Like sits beside like, row by row, so only the difference needs looking at | [table](primitives/table.md) when many settings each change one value |
| A list of facts: "four settings control the limit", "the API returns these error codes" | [table](primitives/table.md) | Rows and columns let the eye look up rather than remember | [compare](primitives/compare.md) when each fact has exactly two versions |
| A quantity, or a quantity over time: "p99 latency fell from 2.4 s to 0.9 s", "memory grows with each request" | [chart](primitives/chart.md), with real numbers | Size is seen, not read, so "much faster" needs no arithmetic | [table](primitives/table.md) when the numbers are to look up, not to compare |
| The shape of stored data: "each order has many items, and each item points at one product" | [er](primitives/er.md) | Keys and lines show how records relate in one picture | [table](primitives/table.md) for one table's columns as facts |
| A reshaping of stored data: "the migration splits the address out into its own table" | [er](primitives/er.md), then [compare](primitives/compare.md) | The model shows the new shape, and one row before and after makes it concrete | [terminal](primitives/terminal.md) when the story is running the migration and what it printed |
| References and copies: "the order kept the cart's own list, so editing the cart changed the order" | [memory](primitives/memory.md) | Two arrows into one box show sharing at a glance | [array](primitives/array.md) when it is one list and its indexes |
| A run and its output: "the test fails with a timeout, and passes after the fix" | [terminal](primitives/terminal.md), with real output | The viewer sees the evidence itself, not a claim about it | [compare](primitives/compare.md) when you know both behaviours but did not run them |
| What the tests prove: "three tests cover the limit, and nothing tests two servers" | [tests](primitives/tests.md) | Each test sits beside what it proves, and the gaps are listed apart | [terminal](primitives/terminal.md) when the run itself is the proof |
| Where it lives: "the change touches the limiter, the server and one test" | [files](primitives/files.md) | A tree places each file once, so names are not juggled | Leave it out when there are 3 files or fewer |
| How the lines do it: "the key includes the minute, so a new minute starts a new count" | A drawing of the idea first, then [code](primitives/code.md) | The picture gives the model, so the lines only confirm it | [code](primitives/code.md) alone when the idea is the lines, such as an off-by-one |
| A shape no other primitive draws: a class hierarchy, a gantt plan, a git history, proportions of a whole | [mermaid](primitives/mermaid.md) | A familiar diagram the viewer already knows how to read | Any row above that fits, since mermaid has no steps |

Three scenes are not picked per idea, so they have no row: [intent](primitives/intent.md), [review](primitives/review.md) and [reading](primitives/reading.md). Their files say what they hold.

When two primitives fit, pick the one whose steps change the fewest things at a time. When one idea needs two pictures, use the short sequence in its row, and let each picture answer one question.

## The load rules, for every primitive

A scene with `steps` draws first, then walks them. Each step lights what its `focus` names half a second before its `say` is spoken, and dims the rest.

- **The words name only what is lit.** A sentence about a part that is not lit sends the eye searching. When the sentence needs a second part, add it to the `focus`, or split the step.
- **Build it up.** One new thing a step: one comparison, one message, one move. A step that lights half the picture points at nothing.
- **Few things at once.** About 7 parts on screen is easy to hold; past 12, split the idea into two scenes.
- **Do not say what the picture says.** The `narration` is one sentence that says what the picture is. The steps say why each part matters, not what it is labelled.
- **Walk in order.** A `sequence`, `timeline`, `compare` or `terminal` draws up to the last item a step names, so name the items in order.

## The primitive files

[array](primitives/array.md), [sequence](primitives/sequence.md), [flow](primitives/flow.md), [state](primitives/state.md), [graph](primitives/graph.md), [layers](primitives/layers.md), [timeline](primitives/timeline.md), [compare](primitives/compare.md), [table](primitives/table.md), [chart](primitives/chart.md), [er](primitives/er.md), [memory](primitives/memory.md), [terminal](primitives/terminal.md), [tests](primitives/tests.md), [files](primitives/files.md), [code](primitives/code.md), [mermaid](primitives/mermaid.md), [intent](primitives/intent.md), [review](primitives/review.md), [reading](primitives/reading.md).

Every primitive is checked by `{{MR_CAST}}/bin/mr-cast validate`.
