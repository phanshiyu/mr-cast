# files

The files as a tree with their line counts, and a short note beside the ones that matter.

## Lowers load when

- The idea is where something lives: "the change touches the limiter, the server and one test".
- A tree places each file once, so the viewer does not juggle paths from the voice.

## Adds load when

- There are 3 files or fewer and the pictures already name them. Leave it out.
- The idea is how modules depend on each other. Use [graph](graph.md).
- More than 18 files. Name the ones that matter.

## Load mistakes

- **Notes on every file.** Note only the files the words name.
- **Reading paths aloud.** Say what each file holds.

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

A `focus` is a path in the tree. `notes` maps a path to a short note. `{{MR_CAST}}/bin/mr-cast validate` fails on a note or focus for a path not in the tree, and warns past 18 files.

`{{MR_CAST}}/bin/mr-cast schema files` prints its fields.
