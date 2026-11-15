# compare

Two sides in one layout, row by row. Rows that differ get an arrow between the sides, rows that match dim; or, as options, a decision beside the alternative not taken.

## Example

```json
{
  "type": "compare",
  "chapter": "Before and after",
  "title": "A visitor's twenty first request",
  "narration": "Here is the same visitor, before the limiter and after it.",
  "sides": [{ "title": "Before the limiter" }, { "title": "After the limiter", "tone": "good" }],
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

A `focus` is a row index, an `"a-b"` range, `"side:After"`, or a cell `"2@After"`. A cell is text (up to 3 lines; a `"\n"` in it starts a new line, and its row grows to hold the lines), `{ "code": "...", "lang": "ts" }`, lines read from the diff (below), or a picture `{ "image": "before.png" }`, such as a screenshot of each side, drawn in a 16:9 box (`"fit": "cover"` fills it); see [image](image.md) for where a picture may come from. `sides` names the two sides and is optional (they default to Before and After). Each side is an object with a `title`, and optionally a `tone`: `[{ "title": "Before" }, { "title": "After", "tone": "good" }]`. A plain string such as `["Before", "After"]` is rejected. `{{MR_CAST}}/bin/mr-cast validate` fails on a row without exactly two cells and on two sides with one title, and warns past 6 rows, on a code cell over 6 lines (8 for one read from a hunk), and on a row no step names, which then appears unnamed with a neighbouring step.

### Lines from the diff

To show existing code whose behaviour changed, old lines against new, name the lines instead of typing them, so the cell cannot drift from the real diff:

```json
{ "label": "Starting up", "cells": [
  { "hunk": "h8", "side": "old", "lines": "4-6" },
  { "hunk": "h8", "side": "new", "lines": "4-5" }
] }
```

`hunk` is an id from the hunk index (a snippet id works for `"new"`), `lines` a number or an `"a-b"` range. `"old"` shows the removed and context lines of that range by old-file line numbers, `"new"` the added and context lines by new-file numbers. `lines` is numbered by the side you name, not by the hunk's own position: `old` counts the old file's lines, `new` the new file's, so after an edit that adds two lines above, the same code has different numbers on the two sides. In the example, `h8` removes old lines 4-6 and adds new lines 4-5, so `old` `"4-6"` and `new` `"4-5"` show the same place before and after. Read the numbers from the hunk (`{{MR_CAST}}/bin/mr-cast hunk h8`), not from a `code` scene's own line count. The cell draws the file name and line numbers quietly above the code. A cell holds up to 8 lines; two rows of 8 still read. The code takes the side's whole width and steps down to 15px, the smallest size code is read at: a line can be about 86 characters when no row has a `label` or a `verdict`, about 73 with a short label, and fewer with a long label (it takes up to 360px, and every row's cells narrow with it) or with verdict marks (44px); and the frame holds about 26 to 30 lines of code in all, shared by the rows. The fit check in `validate` reports a line or a row that no longer fits, and says the number of characters that cell holds, and what narrowed it. `validate` fails on a hunk, a side or a range that does not exist, and says which lines the hunk does have. A demo: `{{MR_CAST}}/examples/primitives/compare-diff/storyboard.json`.

### A decision and the alternative not taken

An arrow between the sides reads as "becomes", which is the wrong meaning for two options. Set `"mode": "options"` and nothing is drawn between the sides. Mark the one taken with `"chosen": true` on a side, or `"chosen": 0` or `1` on a row (the side that row took, 0 the left); the one taken is drawn strong and labelled "Chosen", the other quieter and labelled "Not taken". Mark sides or rows, not both. Without `chosen`, the options sit side by side unmarked. `validate` fails on `chosen` without `"mode": "options"`. A demo: scene 2 of `{{MR_CAST}}/examples/primitives/compare/storyboard.json`.

`{{MR_CAST}}/bin/mr-cast schema compare` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/compare/storyboard.json`. In the worked examples: `{{MR_CAST}}/examples/architecture/react/storyboard.json` (scene 1, JSX beside the object it becomes); `{{MR_CAST}}/examples/architecture/h3/storyboard.json` (scene 7); `{{MR_CAST}}/examples/tech/docker-100s/storyboard.json` (scene 1, a container against a VM); `{{MR_CAST}}/examples/cooking/bread/storyboard.json` (scene 2, wet dough against dry); `{{MR_CAST}}/examples/language/ser-estar/storyboard.json` (scenes 1 and 4, ink on each side); `{{MR_CAST}}/examples/product/raspberry-pi/storyboard.json` (scene 3).
