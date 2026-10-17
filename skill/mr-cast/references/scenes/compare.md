# compare

Two sides in one layout, row by row. Rows that differ get an arrow between the sides, rows that match dim.

## Lowers load when

- The idea is a comparison: "the old code retried forever, the new code gives up after three", "Redis versus an in-process cache".
- Like sits beside like at the same height, so the eye only looks at what differs. A `verdict` says which side is better without a sentence.
- After an [er](er.md) of a new model, one stored row before and after makes the change concrete.

## Adds load when

- Many settings each change one value. Use [table](table.md) with `{ "before", "after" }` cells.
- You ran both versions and the output is the proof. Use [terminal](terminal.md).
- More than 6 rows. Keep the rows that differ.

## Load mistakes

- **Rows that match, shown as if they differ.** Every row demands attention. Let equal rows dim, or leave them out.
- **Words that name both sides while one cell is lit.** Light the row to talk about both, or the cell `"2@After"` to talk about one.
- **Rows shown before their words.** A step shows every row up to the last one it names. Give each row a step, top to bottom.

## Example

```json
{
  "type": "compare",
  "chapter": "Before and after",
  "title": "A visitor's twenty first request",
  "narration": "Here is the same visitor, before the limiter and after it.",
  "rows": [
    { "label": "21st request in a minute", "cells": ["Goes through", "Refused with **429**"], "verdict": ["bad", "good"] },
    { "label": "Told when to retry", "cells": ["No", "After 60 seconds"], "verdict": [null, "good"] },
    { "label": "Requests under the limit", "cells": ["Go through", "Go through"] }
  ],
  "steps": [
    { "focus": 0, "say": "A twenty first request inside a minute used to go through. Now the server refuses it." },
    { "focus": 1, "say": "The refusal also tells the visitor to retry after sixty seconds." },
    { "focus": 2, "say": "Requests under the limit go through as before." }
  ]
}
```

## Schema and validate notes

A `focus` is a row index, an `"a-b"` range, `"side:After"`, or a cell `"2@After"`. A cell is text or `{ "code": "...", "lang": "ts" }`. Name the sides in `sides` when they are not Before and After. `{{MR_CAST}}/bin/mr-cast validate` fails on a row without exactly two cells and on two sides with one title, and warns past 6 rows, on a code cell over 6 lines, and on a row no step names.

`{{MR_CAST}}/bin/mr-cast schema compare` prints its fields.
