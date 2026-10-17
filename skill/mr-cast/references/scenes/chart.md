# chart

A bar or line chart of real numbers, with a change badge on each label when there are two series.

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

## Schema and validate notes

`kind` is `bar` or `line`. A value below 10,000 prints with the digits it is written with (`3.125`, `0.0243`); a bigger one is compacted to three significant digits (`12.3k`, `3.4M`). `"badges": false` hides the change badges of a two-series chart. A `focus` is a label, `"series:after"`, or `"after@p99"`. `annotation` calls out one point. `{{MR_CAST}}/bin/mr-cast validate` fails on a series whose length differs from the labels and a negative bar, and warns past 12 labels or 4 series, and past 24 bars, where a bar is too thin for its value.

`{{MR_CAST}}/bin/mr-cast schema chart` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/chart/storyboard.json`.
