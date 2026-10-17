# intent

The opening card: a one-line summary, the risk, and up to 6 bullets.

## Lowers load when

- It names, before anything is drawn, the one problem and the few things the rest answers, so each later picture has a place to go.
- Not picked per idea. The mr-cast skill says where it goes.

## Adds load when

- It lists every detail. Keep the bullets the viewer must hold, at most 6.

## Load mistakes

- **An abstract problem,** such as "adds rate limiting". One real case with real values is easier to hold.
- **A count the voice promises that the card breaks,** such as "three things" over two bullets.

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

A `focus` is a bullet index. `{{MR_CAST}}/bin/mr-cast validate` fails on more than 6 bullets or a missing `summary`, and warns on a spoken count that disagrees with the bullets.

`{{MR_CAST}}/bin/mr-cast schema intent` prints its fields.
