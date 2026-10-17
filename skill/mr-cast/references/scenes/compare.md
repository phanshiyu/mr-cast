# compare

Two sides in one layout, row by row. Rows that differ get an arrow between the sides, rows that match dim.

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

A `focus` is a row index, an `"a-b"` range, `"side:After"`, or a cell `"2@After"`. A cell is text or `{ "code": "...", "lang": "ts" }`. `sides` names the two sides; they default to Before and After. `{{MR_CAST}}/bin/mr-cast validate` fails on a row without exactly two cells and on two sides with one title, and warns past 6 rows, on a code cell over 6 lines, and on a row no step names, which then appears unnamed with a neighbouring step.

`{{MR_CAST}}/bin/mr-cast schema compare` prints its fields.
