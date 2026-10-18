# text

Words as the picture: one lead drawn as its field says (a headline, a question, a number, a term or a quote), a kicker above it, a note under it, and a list or two sides under that. Steps rewrite, show and hide its parts.

## Example

```json
{
  "type": "text",
  "chapter": "The problem",
  "narration": "People upload more than five hundred hours of video to YouTube every minute.",
  "kicker": "Uploaded to YouTube",
  "number": "500 hours",
  "note": "of video, every minute",
  "steps": [
    { "set": { "number": "720,000 hours", "note": "of video, every day" }, "say": "Over a day, that is seven hundred and twenty thousand hours." }
  ]
}
```

## Schema and validate notes

Set one lead: `headline`, `question`, `number`, `term` or `quote`. A `question` draws a large question mark to its right. A `number` draws its leading figure in display type and the words after it smaller beside it; the figure counts up from 0 as the scene opens, and from the old figure when a step sets a new one with the same symbols around it ("$4" to "$9", not "$4" to "9%"). A `term` draws a short rule between it and its `note`. A `quote` draws a large opening quote mark at its left, and its `note` after a dash. `items` (up to 6) list under the lead. `sides` are two columns in place of items, left then right, each with a `label`, its own lead, `note`, up to 4 `items`, and a `tone`. `risk` draws a badge under the lead. `diffstat` shows the diff's files and lines at the top right. Without items or sides the lead is drawn larger. Everything shrinks together to fit the frame: the items first, down to 24px, then the lead and the note.

A ref is an item index or `"a-b"` range, `"note"`, `"kicker"`, the lead's field name, or a side `"left"` or `"right"`. `hidden` lists refs drawn only once a step `show`s them; `show` and `hide` take one part each. A step's `set` replaces the lead, `note` or `kicker` from that step on, by the same names, and the old text fades into the new. A step without `focus` lights what it sets or shows. A step's pen `mark` draws on its first focus ref. `{{MR_CAST}}/bin/mr-cast validate` fails on two leads, items beside sides, more than 6 items or 4 in a side, and a ref that names nothing. It warns when the text does not fit, in the first state or after any `set`, at the step that set it; when a hidden ref is never shown; and when a spoken count ("three things to check") disagrees with the items.

An `intent` scene from an older storyboard is drawn as a text scene: its `summary` as the `headline`, its `bullets` as the `items`, its `risk`, the storyboard's title and subtitle as the `kicker`, and `diffstat`. `validate` reports its problems by its own field names.

`{{MR_CAST}}/bin/mr-cast schema text` prints its fields. A whole demo: `{{MR_CAST}}/examples/primitives/text/storyboard.json`.
