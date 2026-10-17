# tests

Each test beside what it proves in plain words, and the gaps nothing tests listed apart.

## Lowers load when

- The idea is what the tests prove: "three tests cover the limit, and nothing tests two servers".
- The proof and the gap sit in separate columns, so the viewer does not have to sort them from the voice.

## Adds load when

- The run itself is the proof. Use [terminal](terminal.md).
- More than 10 tests. Group them by subject in two scenes.

## Load mistakes

- **A count the voice says that the screen contradicts,** such as "seven tests" over nine rows.
- **Reading out test names.** Say what each proves.
- **Words about a gap while a test is lit.** Light `"gap:0"` to talk about it.

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

A `focus` is a case index, a case name, or `"gap:0"`. Each case has its `name` as written in code and what it `proves`. `{{MR_CAST}}/bin/mr-cast validate` fails on no cases and no gaps, and warns past 10 cases or 4 gaps and on a spoken count that disagrees.

`{{MR_CAST}}/bin/mr-cast schema tests` prints its fields.
