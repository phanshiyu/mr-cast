# reading

The order in which to read the code, each item with its file, lines and what to check there.

## Lowers load when

- The viewer will read the code next. A short ordered list, main behaviour first, tells them where to start and what to look for.
- Not picked per idea. The mr-cast skill says when there is one.

## Adds load when

- An item points at a whole file. Give it the `lines` that matter.

## Load mistakes

- **More than 6 items to read first.** Mark wiring and config `routine` so they leave the screen.
- **A check in vague words.** Write the real names and values, such as "the key resets on a new minute".

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

Each item names a `hunkId`, optional `lines` inside it, and a `check` unless it is `routine`. The scene takes no `steps`. `{{MR_CAST}}/bin/mr-cast validate` fails on a hunk listed twice and a missing check, and warns on an item over 40 lines with no `lines`.

`{{MR_CAST}}/bin/mr-cast schema reading` prints its fields.
