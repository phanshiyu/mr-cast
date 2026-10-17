---
name: mr-cast-prune
description: Free disk space used by mr-cast, letting the user pick what goes, such as old walkthroughs, rendered videos, stills, voice clips, and the downloaded Chrome, voice model and player bundle. Use when the user asks to prune, clean up, or delete mr-cast files, videos or caches, or asks what mr-cast is using disk space on.
---

# mr-cast prune

Show the user what mr-cast can delete, let them choose, and delete exactly that. The CLI decides what each choice deletes. You never pick files yourself.

Delete only through `{{MR_CAST}}/bin/mr-cast prune`. Never delete with `rm`, `find -delete`, `unlink` or any other command or tool, even for one file, even when `prune` refuses. If `prune` cannot do what the user asks, tell the user and stop.

The CLI is `{{MR_CAST}}/bin/mr-cast`. Run it from the user's repository, because walkthroughs live in its `.mr-cast/` directory. Outside a git repository it looks in the current directory's `.mr-cast/`. The shared cache in `~/.cache/mr-cast` is listed from anywhere. The wrapper finds a working Node itself, so call it directly rather than through `node`.

## 1. Get the menu

```bash
{{MR_CAST}}/bin/mr-cast prune --choices --json
```

The output has `groups` and `inUse`. Each group has a `name` and up to 4 `options`. Each option has a `label`, a `description` (its size and what deleting it means), a `command` (the exact arguments to pass to the CLI), and the `ids` it deletes.

If `groups` is empty, tell the user there is nothing to prune and stop. Each entry of `inUse` is busy, such as the Chrome cache while a render runs. Name it as in use and say it can be pruned once the render finishes.

## 2. Ask what to delete

Ask with the AskUserQuestion tool, with `multiSelect: true`, one question per group, in the order given. Use the group's `name` as the header, and each option's `label` and `description` exactly as given. Do not add, merge or reword options.

If the user picks nothing, delete nothing, say so, and stop.

## 3. Delete the chosen options

If the user chose one option, run its `command` as given, after the CLI path. For example, the command `["prune", "--kind", "video"]` runs as:

```bash
{{MR_CAST}}/bin/mr-cast prune --kind video
```

Do not add, drop or change any argument.

If the user chose more than one option, in one group or several, run one `prune` with the `ids` of every chosen option, each id once. One command per option would fail: after "All rendered videos", the single video it already removed is an unknown id. For example, "All rendered videos" with `ids` `["video:a/a.mp4", "video:b/b.mp4"]` and a stills option with `ids` `["stills:a"]` run as:

```bash
{{MR_CAST}}/bin/mr-cast prune video:a/a.mp4 video:b/b.mp4 stills:a
```

## 4. A free-text answer

The user can answer in their own words, such as "everything except the rate limit walkthrough" or "videos older than a week". Build one `prune` command from these selectors, which combine:

- `<id> ...`: artifacts by id, from the `ids` of the menu or `{{MR_CAST}}/bin/mr-cast prune --json`.
- `--kind <kinds>`: every artifact of these kinds, comma-separated: `run` and `explain` (walkthroughs), `video`, `stills`, `audio` (voice clips), `cache`.
- `--all`: everything.
- `--older-than <days>`: only what has not changed in that many days.
- `--except <id>`: keep this artifact. Repeat it for more. Keeping a walkthrough keeps its videos, stills and clips too.

Run it with `--dry-run` first:

```bash
{{MR_CAST}}/bin/mr-cast prune --all --except run:rate-limit --dry-run
```

Show the user its output as printed, and ask them to confirm. If they confirm, run the same command without `--dry-run`. If they do not, delete nothing. If the answer is unclear, or no selector expresses it, ask again rather than guessing.

## 5. Report

`prune` prints one `removed <id>` line per artifact and `freed <size>` at the end. A part inside a chosen walkthrough prints as `removed <id> (with <walkthrough id>)`. An `in use, not removed` line names a busy artifact it left alone. It rejects an unknown id, or a busy one named by id, and then deletes nothing. In that case run step 1 again, tell the user what changed, and ask again. A `kept <id>` line means a render started using that cache after the listing. Tell the user to prune it after the render finishes. Report what was removed and the space freed.
