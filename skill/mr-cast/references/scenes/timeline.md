# timeline

Events at their real times on one axis, with spans for waits and windows, and a playhead that moves as the steps go.

## Lowers load when

- The idea is about time: "it retries after 1, 2, then 4 seconds", "the token expires after an hour", "the rollout takes three days".
- Distance on the axis is time, so a doubling wait looks doubled and a short window looks short.

## Adds load when

- Who acts matters more than when. Use [sequence](sequence.md).
- The story is which status a thing is in. Use [state](state.md).
- Events are so close together and so many that they crowd, past 8. Keep the ones the words name.

## Load mistakes

- **A spoken total that disagrees with the axis,** such as "about nine minutes" over 635 seconds. The viewer stops trusting one of them. Say the number the screen shows.
- **Words about events not yet reached.** The playhead stands on the last event a step names. Name events in order.
- **Mixed units in the words.** The axis has one unit. Say times in that unit.

## Example

```json
{
  "type": "timeline",
  "chapter": "One window",
  "title": "A visitor's minute",
  "unit": "s",
  "narration": "Here is one visitor's minute, request by request.",
  "events": [
    { "at": 0, "label": "First request", "detail": "count 1" },
    { "at": 41, "label": "Twentieth request", "detail": "count 20", "tone": "warn" },
    { "at": 45, "label": "Refused", "detail": "count 21", "tone": "bad" },
    { "at": 60, "label": "New window", "detail": "count 0", "tone": "good" }
  ],
  "spans": [
    { "from": 0, "to": 60, "label": "one window" }
  ],
  "steps": [
    { "focus": 0, "say": "The first request opens the visitor's window." },
    { "focus": 1, "say": "Forty one seconds in, the twentieth request uses up the limit." },
    { "focus": 2, "say": "Four seconds later the next request is refused." },
    { "focus": ["span:one window", 3], "say": "At sixty seconds a new window starts, and the count starts again." }
  ]
}
```

## Schema and validate notes

A `focus` is an event index, an `"a-b"` range, or `"span:label"`. `unit` is one of `ms`, `s`, `min`, `h` and `d`. `{{MR_CAST}}/bin/mr-cast validate` fails on events out of order of `at` with steps and a span that ends before it starts, and warns past 8 events or 4 spans.

`{{MR_CAST}}/bin/mr-cast schema timeline` prints its fields.
