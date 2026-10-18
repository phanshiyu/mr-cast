# table

Rows and columns of facts, with a changed value drawn as the old one struck through beside the new. Steps can add rows, change cells and tint rows.

## Example

```json
{
  "type": "table",
  "chapter": "The settings",
  "title": "Rate limit options",
  "narration": "Three settings control the new limit.",
  "columns": ["Setting", "Value", "What it controls"],
  "rows": [
    { "cells": ["max", "20", "Requests a visitor may send in a window"], "change": "added" },
    { "cells": ["windowMs", "60000", "How long a window lasts, in milliseconds"], "change": "added" },
    { "cells": ["TRUST_PROXY", { "before": "false", "after": "true" }, "Read the visitor's address from the proxy header"] }
  ],
  "steps": [
    { "focus": 0, "say": "A visitor may send twenty requests in a window." },
    { "focus": 1, "say": "Each window lasts sixty seconds." },
    { "focus": "Value@2", "say": "The server now trusts the proxy, so each visitor's real address is counted." }
  ]
}
```

## Schema and validate notes

A `focus` is a row index, a column `"col:Header"`, or a cell `"Header@row"`. Each row has one cell per column. A header is drawn upper-cased unless it holds a formula or code mark (`^ _ = ( ) [ ] { } < > | * +` or a camelCase word), which keeps it as written. A cell of one word with code marks (an identifier, a path, `2s`) renders in mono; math such as `O(n²)`, `O(n log n)` or `n × m`, and a percentage such as `66%`, render as text. Rows marked `added` or `removed` hold plain text. `{{MR_CAST}}/bin/mr-cast validate` fails on a row whose cells do not match the columns, and warns past 10 rows or 6 columns.

**Steps that change the table.** A row with `"hidden": true` is drawn when a step's `show` names it (`[3]`), in the place it keeps from the start; `{{MR_CAST}}/bin/mr-cast validate` warns on one no step shows. A step's `set` changes cells by `"Header@row"`; `{ "before": "4", "after": "3" }` strikes the old value beside the new, whose colour follows the row's tint. `tint` colours rows (by index) and cells from that step on, with a tone, `"dim"` or `"clear"`. `callout` is a boxed line at the right of the header that steps replace. The callout box is as wide as its longest text; beside it, a title too long for one line wraps onto a second. A step without `focus` lights what it changes.

`{{MR_CAST}}/bin/mr-cast schema table` prints its fields. A whole demo: `{{MR_CAST}}/examples/primitives/table/storyboard.json`. In the worked examples: `{{MR_CAST}}/examples/explain/bitcoin/storyboard.json` (scenes 0 and 6, ledger rows that arrive and get rejected); `{{MR_CAST}}/examples/explain/gpt/storyboard.json` (scene 7, softmax cells set one at a time).
