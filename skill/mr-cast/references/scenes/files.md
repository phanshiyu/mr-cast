# files

The files as a tree with their line counts, and a short note beside the ones that matter; or, with parts, a map of cards, one for each part, with what it does and the links between parts.

## Example

```json
{
  "type": "files",
  "chapter": "What changed",
  "title": "Files in this change",
  "narration": "The change adds one file.",
  "notes": { "src/api/rate-limit.ts": "counts each visitor's requests" },
  "steps": [
    { "focus": "src/api/rate-limit.ts", "say": "The new rate limit file holds the whole limiter." }
  ]
}
```

## Schema and validate notes

A `focus` is a path in the tree, or a part's name. `notes` maps a path to a short note. Leave `files` out in a diff walkthrough and the tree is every changed file. `{{MR_CAST}}/bin/mr-cast validate` fails on a note or focus for a path not in the tree, and warns on a path the diff does not change, and without parts past 18 files.

### Parts and weight

A tree by directory says where files live, not which matter or how they connect. Give the scene `parts` and each file a `part`, and the scene draws a map instead: a card for each part, with its name, its weight (core strongest and first, routine quietest and last), a `does` line, its file count and + and − totals, and its largest files, core parts more of them, with a quiet "+ N more" line, so a branch of 25 or 30 files fits.

```json
{
  "type": "files",
  "chapter": "By importance",
  "narration": "The same files, grouped by what matters.",
  "parts": [
    { "name": "Finding and checking places", "weight": "core", "does": "Finds each place in an answer and checks it against the branch" },
    { "name": "The command line", "weight": "support", "does": "Adds the reply and explain commands", "after": ["Finding and checking places"] },
    { "name": "Docs and the key sheet", "weight": "routine" }
  ],
  "files": [
    { "path": "src/check.ts", "part": "Finding and checking places" },
    { "path": "src/cli.ts", "part": "The command line" },
    { "path": "README.md", "part": "Docs and the key sheet" }
  ],
  "steps": [{ "focus": "Finding and checking places", "say": "The core is how a place is found and checked." }]
}
```

`weight` is `core`, `support` or `routine`. `does` is one sentence under about 90 characters. `after` names the parts this one builds on or is called by: the card sits after them, with a thin link from each; with no `after` the cards fill a grid, core first. `"check": true` marks a card "check"; `"risk": "what the risk is"` (with `"riskMore": 2`) draws that line quietly under `does`. A file that names no part sits under "Other files", last and quietest. A step's `focus` may name a part (or `"part:Name"`) to light its card. In a branch video with a `brief`, write `"parts": "brief"` and leave `files` out: the parts, their `does` and `after`, and the files come from `brief.parts` and their hunks (a file whose hunks sit in two parts is listed under each, with that part's share of its lines), and a part holding a file named in `brief.check` is marked "check" and shows the `what` of the first check item in that part under `does`, with "+ N more", so nothing is typed twice. `notes` are not drawn on a map, and `validate` says so; the `does` line carries the meaning. `validate` fails on a `part` that no entry of `parts` names, a repeated part name, an unknown weight, and `"brief"` with no brief to read; it warns on files in no part, on a part with no file, and on an `after` that names no part. A demo: scene 2 of `{{MR_CAST}}/examples/primitives/files/storyboard.json`.

`{{MR_CAST}}/bin/mr-cast schema files` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/files/storyboard.json`.
