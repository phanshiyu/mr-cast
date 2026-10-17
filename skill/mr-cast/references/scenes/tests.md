# tests

Each test beside what it proves in plain words, and the gaps nothing tests listed apart.

## Example

```json
{
  "type": "tests",
  "chapter": "What the tests prove",
  "title": "Rate limit tests",
  "subject": "rateLimit in src/api/rate-limit.ts",
  "narration": "Nothing tests the limiter yet.",
  "cases": [],
  "gaps": [
    "A twenty first request inside a minute is refused",
    "A new minute starts a new count",
    "Visitors behind one proxy share one count"
  ],
  "steps": [
    { "focus": "gap:0", "say": "Nothing checks that the twenty first request is refused." },
    { "focus": "gap:1", "say": "Nothing checks that the count starts again in a new minute." },
    { "focus": "gap:2", "say": "And nothing shows what happens to visitors behind one proxy." }
  ]
}
```

## Schema and validate notes

A `focus` is a case index, a case name, or `"gap:0"`. Each case has its `name` and what it `proves`; `cases` and `gaps` may be empty, and `titles` renames the panels. `{{MR_CAST}}/bin/mr-cast validate` warns past 10 cases and on a spoken count that disagrees with the cases.

`{{MR_CAST}}/bin/mr-cast schema tests` prints its fields.
