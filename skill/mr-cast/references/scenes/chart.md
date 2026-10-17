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

`kind` is `bar` or `line`. A `focus` is a label, `"series:after"`, or `"after@p99"`. `annotation` calls out one point. `{{MR_CAST}}/bin/mr-cast validate` fails on a series whose length differs from the labels and a negative bar, and warns past 12 labels or 4 series, and past 24 bars, where a bar is too thin for its value.

`{{MR_CAST}}/bin/mr-cast schema chart` prints its fields.
