# code

The lines of one hunk or snippet, the rest dimmed, walked a range at a time, with an optional step diagram beside them.

## Example

```json
{
  "type": "code",
  "chapter": "The limiter",
  "hunkId": "h2",
  "narration": "So how does the limiter know a visitor is past the limit?",
  "steps": [
    { "lines": 11, "label": "key per visitor per minute", "say": "The limiter builds a key from the visitor's address and the current minute, so a new minute starts a new count." },
    { "lines": "12-13", "label": "count the request in Redis", "say": "Redis adds one to that count, and the first request of a minute sets the count to expire." },
    { "lines": "14-17", "label": "refuse past the limit", "outcome": "too many requests", "say": "Past the limit, the limiter tells the visitor when to retry and refuses the request." },
    { "lines": 18, "label": "let it through", "say": "Otherwise the request goes on to the route." }
  ]
}
```

## Schema and validate notes

Each step names its `lines` (or `oldLines` for removed code) and its `say`; with a `label` on every step, a step diagram is drawn beside the code, with an `outcome` where a step branches. The scene's `narration` is the intro before the first step. Reference the code by `hunkId`; the lines come from hunks.json. Without steps, `focusLinesAfter` (and `focusLinesBefore` for removed code) take the printed line numbers as numbers or `"start-end"` strings, each string its own range, and `flow` gives one labelled step per range, in the same order. A pen `token` is text that occurs once on the step's lines, such as `"max: 20"`. `{{MR_CAST}}/bin/mr-cast validate` fails on lines outside the hunk, overlapping steps, steps out of top-to-bottom order (the light follows the code down), labels on only some steps, and a `flow` whose length differs from the ranges. It warns past 6 labelled steps, which is what the step diagram holds.

`{{MR_CAST}}/bin/mr-cast schema code` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/code/storyboard.json`. In the worked examples: `{{MR_CAST}}/examples/algorithms/quicksort/storyboard.json` (scene 3, the partition in Java).
