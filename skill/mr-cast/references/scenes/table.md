# table

Rows and columns of facts, with a changed value drawn as the old one struck through beside the new.

## Lowers load when

- The idea is a list of facts: "four settings control the limit", "the API returns these error codes".
- Rows and columns let the eye look a fact up rather than remember it from the voice.
- Many settings each change one value. A `{ "before", "after" }` cell shows each change in place.

## Adds load when

- Each fact has exactly two versions to weigh. Use [compare](compare.md).
- The numbers are to be compared by size. Use [chart](chart.md).
- It is a schema with relations. Use [er](er.md).
- More than 10 rows or 6 columns. Keep what the words name.

## Load mistakes

- **The voice reads the table out.** The viewer can read it. Say why each row matters, one row a step.
- **The whole table lit while the words name one value.** Light the cell, as `"Value@2"`.
- **Columns the idea does not use.** Every column is one more thing to scan past.

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

`{{MR_CAST}}/bin/mr-cast schema table` prints its fields.
