# reading

The order in which to read the code, each item with its file, lines and what to check there. With no items it draws the brief's check list, in any video of a branch.

## Example

```json
{
  "type": "reading",
  "chapter": "What to read",
  "narration": "Read the limiter first, from the key to the refusal, since everything else only wires it in.",
  "items": [
    { "hunkId": "h2", "lines": "9-20", "check": "the key changes each minute; `count > max` lets exactly 20 through", "why": "every request on the route passes this one check" }
  ]
}
```

## Schema and validate notes

Any video of a branch can use this scene, and a pre-read (`--audience preread`) is built on it. With no `items` it draws the brief's `check` list, and `validate` fails when that is empty. Items of its own are for a pre-read, or when the order should differ from the brief's. Each item names a `hunkId`, optional `lines` inside it, a `check` unless it is `routine`, and optionally a `why`, one short line on why it matters, drawn quietly under the check and written to reading.md (without items, the scene draws `brief.check`, and each entry's `why` comes from the brief); the file and lines come from hunks.json. The scene shows the first 6 items to read and counts the rest; `reading.md` and the player's Reading order panel list them all, grouped by the `topic` of the scene that cites each hunk in `from`. A `flag` names a finding whose line is in the item's hunk. The scene takes no `steps`. `{{MR_CAST}}/bin/mr-cast validate` fails on a hunk listed twice, a missing check, and `lines` outside the hunk.

`{{MR_CAST}}/bin/mr-cast schema reading` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/reading/storyboard.json`.
