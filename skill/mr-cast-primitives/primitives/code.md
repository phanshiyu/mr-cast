# code

The lines of one hunk or snippet, the rest dimmed, walked a range at a time, with an optional step diagram beside them.

## Lowers load when

- The idea is how the lines do it: "the key includes the minute, so a new minute starts a new count".
- A drawing of the idea came first. The picture gives the model, so the lines only confirm it.
- The idea is the lines themselves, such as an off-by-one or a missing check.

## Adds load when

- The idea can be drawn: a structure, an order of calls, a lifecycle, a schema, data moving through stages. Draw it first with the matching primitive.
- More than one idea is in the hunk. Split it, one idea a scene.

## Load mistakes

- **Words about lines that are not lit.** Never talk about line 14 while lines 11 to 13 are lit.
- **A wall of code.** Ranges over 8 lines, or a long hunk with no steps. Walk at most 8 lines a step.
- **Reading code aloud,** such as "count greater than max". Say what it does: "past the limit".
- **Steps out of order.** The light jumps up and down the screen. Walk top to bottom.

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

Each step names its `lines` (or `oldLines` for removed code), its `say`, and a `label` for the step diagram, with an `outcome` where it branches. Reference the code by `hunkId`. Never paste code. `{{MR_CAST}}/bin/mr-cast validate` fails on lines outside the hunk, overlapping or out-of-order steps, labels on only some steps, and 12 or more changed lines with no focus, and warns on a range over 8 lines or more than 8 steps.
