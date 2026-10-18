# chart

A bar, line, pie or donut chart of real numbers, with a change badge on each label when there are two series. Steps can change the values, which move to their new sizes, and sort the bars into a race.

## Example

```json
{
  "type": "chart",
  "chapter": "What the limit costs",
  "title": "Time added by the limiter",
  "kind": "bar",
  "unit": "ms",
  "better": "lower",
  "narration": "The limiter adds one Redis round trip to every request.",
  "labels": ["p50", "p99"],
  "series": [
    { "name": "before", "values": [42, 180] },
    { "name": "after", "values": [43, 186] }
  ],
  "annotation": { "at": "p99", "text": "one Redis round trip" },
  "steps": [
    { "focus": "p50", "say": "The typical request takes one millisecond longer." },
    { "focus": "after@p99", "say": "The slowest one percent take six milliseconds longer, one round trip to Redis." }
  ]
}
```

### Moving values, a race, pies and stacks

A step's `set` gives values that the bars, points or slices move to as the step starts: a series by name to one number per label, or one value `"series@label"` to a number. A step with no `focus` lights what it sets. `"sort": true` orders bars or slices by value, largest first, and a step's `sort` turns it on or off; bars that change places slide past each other. With `horizontal`, one series and `sort`, steps that `set` the next year's values and `callout` the year make a bar chart race:

```json
{
  "type": "chart",
  "title": "Services by language",
  "kind": "bar",
  "horizontal": true,
  "sort": true,
  "narration": "How many services each language ran, year by year.",
  "labels": ["Python", "Java", "Go"],
  "series": [{ "name": "services", "values": [24, 31, 6] }],
  "callout": "2020",
  "steps": [
    { "set": { "services": [27, 30, 14] }, "callout": "2021", "focus": "Go", "say": "In twenty twenty one, Go more than doubles." },
    { "set": { "services": [30, 24, 33] }, "callout": "2023", "say": "By twenty twenty three Go leads." }
  ]
}
```

A horizontal chart has no axis: each value is printed past its bar, and each bar is as long as its value against the largest value then on screen. With one series and no `tone`, each label gets its own colour. `kind: "pie"` or `"donut"` draws one series as slices clockwise from the top, with a legend of each slice's value and share; a donut prints the total in its hole. `stacked: true` stacks bar series, the label's total above each stack and a segment's own value inside it when it fits.

## Schema and validate notes

`kind` is `bar`, `line`, `pie` or `donut`. A value below 10,000 prints with up to four significant digits, so one written with four or fewer prints as written (`3.125`, `0.0243`) and `2/3` prints `0.6667`; a bigger one is compacted to three significant digits (`12.3k`, `3.4M`). `"badges": false` hides the change badges of a two-series chart. A `focus` is a label, `"series:after"`, or `"after@p99"`. `annotation` calls out one point. `{{MR_CAST}}/bin/mr-cast validate` fails on a series whose length differs from the labels and a negative bar, and warns past 12 labels or 4 series, and past 24 bars, where a bar is too thin for its value. It warns on a value label that runs into the one on its left, in any step's values; round the values or use fewer labels. It fails on a `set` that names no series or value, a series set with the wrong number of values, a pie or donut with other than one series or with every slice 0 at a step, `horizontal`, `stacked` or `sort` on a line, an `annotation` on a horizontal chart or a pie, and `show` or `hide` on a chart. It warns past 8 slices.

`{{MR_CAST}}/bin/mr-cast schema chart` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/chart/storyboard.json`; a race, a donut and stacked bars that steps change: `{{MR_CAST}}/examples/primitives/chart-motion/storyboard.json`. In the worked examples: `{{MR_CAST}}/examples/algorithms/binary-search/storyboard.json` (scene 5, steps by list size); `{{MR_CAST}}/examples/explain/gpt/storyboard.json` (scene 8, one set of scores at three temperatures).
