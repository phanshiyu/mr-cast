# table

Rows and columns of facts, with a changed value drawn as the old one struck through beside the new.

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

A `focus` is a row index, a column `"col:Header"`, or a cell `"Header@row"`. Each row has one cell per column. Rows marked `added` or `removed` hold plain text. `{{MR_CAST}}/bin/mr-cast validate` fails on a row whose cells do not match the columns, and warns past 10 rows or 6 columns.

**Steps that change the table.** A row with `"hidden": true` is drawn when a step's `show` names it (`[3]`), in the place it keeps from the start. A step's `set` changes cells by `"Header@row"`; `{ "before": "4", "after": "3" }` strikes the old value beside the new, whose colour follows the row's tint. `tint` colours rows (by index) and cells from that step on, with a tone, `"dim"` or `"clear"`. `callout` is a boxed line at the right of the header that steps replace. A step without `focus` lights what it changes.

`{{MR_CAST}}/bin/mr-cast schema table` prints its fields. A whole demo: `{{MR_CAST}}/examples/primitives/table/storyboard.json`.
