# reading

The order in which to read the code, each item with its file, lines and what to check there.

## Example

```json
{
  "type": "reading",
  "chapter": "What to read",
  "narration": "Read the limiter first, from the key to the refusal, since everything else only wires it in.",
  "items": [
    { "hunkId": "h2", "lines": "9-20", "check": "the key changes each minute; `count > max` lets exactly 20 through" }
  ]
}
```

## Schema and validate notes

Pre-read only (`--audience preread`). Each item names a `hunkId`, optional `lines` inside it, and a `check` unless it is `routine`; the file and lines come from hunks.json. The scene shows the first 6 items to read and counts the rest; `reading.md` and the player's Reading order panel list them all, grouped by the `topic` of the scene that cites each hunk in `from`. A `flag` names a finding whose line is in the item's hunk. The scene takes no `steps`. `{{MR_CAST}}/bin/mr-cast validate` fails on a hunk listed twice, a missing check, and `lines` outside the hunk.

`{{MR_CAST}}/bin/mr-cast schema reading` prints its fields.
