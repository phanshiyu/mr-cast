# chart

A bar or line chart of real numbers, with a change badge on each label when there are two series.

## Lowers load when

- The idea is a quantity: "p99 latency fell from 2.4 s to 0.9 s", "memory grows with each request".
- Size is seen, not read, so "much faster" needs no arithmetic. Two series named `before` and `after` with `better` set get green or red badges.

## Adds load when

- The numbers are facts to look up. Use [table](table.md).
- You do not have real numbers. Never invent them. Say the trend in words over another primitive instead.

## Load mistakes

- **Too many bars.** Past about 12 labels or 3 series the eye cannot find the one that matters. Keep the ones the words name.
- **Words about a value that is not lit.** To say the p99 number, light `"after@p99"`.
- **The voice reads every number.** Name the one or two that carry the point, and let the bars show the rest.

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

`kind` is `bar` for categories and `line` for a trend. A `focus` is a label, `"series:after"`, or `"after@p99"`. `annotation` calls out one point. `{{MR_CAST}}/bin/mr-cast validate` fails on a series whose length differs from the labels and a negative bar, and warns past 12 labels or 4 series.

`{{MR_CAST}}/bin/mr-cast schema chart` prints its fields.
