# files

The files as a tree with their line counts, and a short note beside the ones that matter; or grouped into parts by importance, core first and routine last.

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

A `focus` is a path in the tree, or a part's name. `notes` maps a path to a short note. Leave `files` out in a diff walkthrough and the tree is every changed file. `{{MR_CAST}}/bin/mr-cast validate` fails on a note or focus for a path not in the tree, and warns past 18 files and on a path the diff does not change.

### Parts and weight

A tree by directory says where files live, not which matter. Give the scene `parts` and each file a `part`, and the files group under their part instead of by directory: core parts first and strongest, support next, routine last and quietest, each heading with its weight, file count and + and − totals.

```json
{
  "type": "files",
  "chapter": "By importance",
  "narration": "The same files, grouped by what matters.",
  "parts": [
    { "name": "Finding and checking places", "weight": "core" },
    { "name": "Docs and the key sheet", "weight": "routine" }
  ],
  "files": [
    { "path": "src/cli.ts", "part": "Finding and checking places" },
    { "path": "README.md", "part": "Docs and the key sheet" }
  ],
  "steps": [{ "focus": "Finding and checking places", "say": "The core is how a place is found and checked." }]
}
```

`weight` is `core`, `support` or `routine`. A file that names no part sits under "Other files", last and quietest. A step's `focus` may name a part (or `"part:Name"`) to light its heading and every file in it. In a branch video with a `brief`, write `"parts": "brief"` and leave `files` out: the groups, weights and files come from `brief.parts` and their hunks (a file in two parts goes to the one holding most of its changed lines), so nothing is typed twice. `notes` still go beside single files. `validate` fails on a `part` that no entry of `parts` names, a repeated part name, an unknown weight, and `"brief"` with no brief to read; it warns on files in no part and on a part with no file. A demo: scene 2 of `{{MR_CAST}}/examples/primitives/files/storyboard.json`.

`{{MR_CAST}}/bin/mr-cast schema files` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/files/storyboard.json`.
