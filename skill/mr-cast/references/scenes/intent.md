# intent

A card with a one-line summary, an optional risk badge, and up to 6 bullets.

## Example

```json
{
  "type": "intent",
  "chapter": "Why this change",
  "narration": "Today a visitor can send as many orders as they like. This change refuses a visitor past twenty requests a minute.",
  "summary": "Limit each visitor to **20** requests a minute",
  "risk": "medium",
  "bullets": [
    "Visitors behind one proxy share one count",
    "A refused visitor is told to retry after a minute"
  ],
  "steps": [
    { "focus": 0, "say": "The first thing to check is who counts as one visitor behind a proxy." },
    { "focus": 1, "say": "The second is what a refused visitor is told." }
  ]
}
```

## Schema and validate notes

A `focus` is a bullet index. `risk` is optional and drawn as a badge. `{{MR_CAST}}/bin/mr-cast validate` fails on more than 6 bullets, which is what the card holds, or a missing `summary`, and warns on a spoken count that disagrees with the bullets.

`{{MR_CAST}}/bin/mr-cast schema intent` prints its fields.
