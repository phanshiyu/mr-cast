# tests

A matrix of the situations the code meets against the outcomes it promises, with the tests that check each cell, the promises nothing checks, and the situations no test tries.

## Example

```json
{
  "type": "tests",
  "chapter": "What the tests prove",
  "title": "Rate limit tests",
  "subject": "rateLimit in src/api/rate-limit.ts",
  "narration": "Two tests check the limiter.",
  "when": "When a visitor sends…",
  "outcomes": ["Status", "Retry-After"],
  "situations": [
    { "id": "under", "when": "20 requests in a minute", "expect": { "Status": "200" } },
    { "id": "over", "when": "a 21st request", "expect": { "Status": "429", "Retry-After": "the seconds left" } },
    { "id": "proxy", "when": "from behind one proxy", "gap": "nothing tries this: everyone behind it shares one count" }
  ],
  "tests": [
    { "name": "allows twenty requests a minute", "checks": ["under.Status"] },
    { "name": "refuses the twenty first", "checks": ["over.Status"] }
  ],
  "steps": [
    { "focus": "refuses the twenty first", "say": "The second test checks that the twenty first request is refused." },
    { "focus": "over.Retry-After", "say": "But nothing checks how long it tells the visitor to wait." },
    { "focus": "proxy", "say": "And nothing tries visitors behind one proxy." }
  ]
}
```

## Schema and validate notes

Rows are `situations`, columns are `outcomes`. A situation's `expect` gives the promised value per outcome; a test's `checks` names the cells it asserts as `"situation.Outcome"`. A checked cell draws green with a tick, its value, and NEW or CHANGED from the tests that check it; a promised cell no test checks draws amber and dashed, "unchecked"; an outcome a situation leaves out draws a faint dash. A situation with `gap` and no `expect` is one red dashed bar holding the gap. A `"removed"` test checks nothing: its `was` shows struck through in the cells it named, which read REMOVED when nothing else is there. `was` on any test strikes the old value under the new one.

A `focus` is a situation id (its row), a cell `"retry.Calls"`, an outcome (its column) or a test's name (every cell it checks). A step that focuses tests shows their names and status in the header callout; a step's own `callout` replaces it, and `""` shows none. The tests that check each row are listed in a column at the right when every value fits on one line beside it; otherwise each row's header counts them. The subject and the counts sit under the matrix. A test's `hunkId` counts its hunk as shown.

`{{MR_CAST}}/bin/mr-cast validate` fails on a check naming a missing situation or outcome, a duplicate situation id or outcome, an `expect` key that is no outcome, and text that does not fit, and on a matrix that does not fit the screen at a readable size. It warns on a test checking a cell with no promised value, on `gap` beside `expect`, which is not drawn, on a spoken count of tests that differs from the tests on screen or lit, and on words naming a situation, outcome, test or value that the step leaves dark. A scene written before 0.27 with `cases` and `gaps` still validates: each case reads as a situation named by its test, with one outcome, "Proves".

`{{MR_CAST}}/bin/mr-cast schema tests` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/tests/storyboard.json`. A decision graph with `tint` can show the paths tests take: see `{{MR_CAST}}/examples/primitives/tests-map/storyboard.json`, a graph scene of the same webhook delivery.
