# files

The files as a tree with their line counts, and a short note beside the ones that matter.

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

A `focus` is a path in the tree. `notes` maps a path to a short note. Leave `files` out in a diff walkthrough and the tree is every changed file. `{{MR_CAST}}/bin/mr-cast validate` fails on a note or focus for a path not in the tree, and warns past 18 files and on a path the diff does not change.

`{{MR_CAST}}/bin/mr-cast schema files` prints its fields.
