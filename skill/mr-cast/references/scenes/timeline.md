# timeline

Events at their real times on one axis, with spans for waits and windows, and a playhead that moves as the steps go.

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

A `focus` is an event index, an `"a-b"` range, or `"span:label"`. `unit` is one of `ms`, `s`, `min`, `h`, `d`, `wk`, `mo` and `yr`. The axis starts at 0, so `at` is the time since the start ("year 12 of the loan"), not a calendar date such as 1969. `{{MR_CAST}}/bin/mr-cast validate` fails on events out of order of `at` with steps and a span that ends before it starts, and warns past 8 events.

`{{MR_CAST}}/bin/mr-cast schema timeline` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/timeline/storyboard.json`. In the worked examples: `{{MR_CAST}}/examples/architecture/youtube/storyboard.json` (scene 4, chunks during playback); `{{MR_CAST}}/examples/architecture/react/storyboard.json` (scene 6, dropped frames); `{{MR_CAST}}/examples/architecture/oauth/storyboard.json` (scene 8, token expiry); `{{MR_CAST}}/examples/cooking/bread/storyboard.json` (scene 5, where a day of baking goes).
