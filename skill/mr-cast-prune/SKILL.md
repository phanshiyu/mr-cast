---
name: mr-cast-prune
description: Free disk space taken by mr-cast, letting the user pick what goes, such as old walkthroughs, rendered videos, stills, voice clips, and the downloaded Chrome, voice model and player bundle. Use when the user asks to prune, clean up, or delete mr-cast artifacts, videos or caches, or asks what mr-cast is using disk space on.
---

# mr-cast prune

Show the user what mr-cast has stored, let them choose what to delete, and delete exactly that. Never delete anything the user did not pick.

The CLI is `{{MR_CAST}}/bin/mr-cast`. Run it from the user's repository, because walkthroughs live in its `.mr-cast/` directory. Outside a git repository it looks in the current directory's `.mr-cast/`. The shared cache in `~/.cache/mr-cast` is listed from anywhere. The wrapper finds a working Node itself, so call it directly rather than through `node`.

## 1. List the artifacts

```bash
{{MR_CAST}}/bin/mr-cast prune --json
```

If the user asked only for old things, add `--older-than <days>`, such as `--older-than 30`. Pass the same option again in step 3.

The output has `reclaimableBytes` and an `artifacts` array. Each artifact has these fields:

- `id`: what to pass to `prune` to delete it.
- `kind`: `run` (a diff walkthrough), `explain` (an explanation), `video` (a rendered MP4), `stills` (PNG stills), `audio` (voice-over clips), or `cache` (a shared download).
- `parent`: for a `video`, `stills` or `audio` artifact, the id of the walkthrough that contains it. Deleting the walkthrough deletes its parts too.
- `bytes`, `modified` (ISO time of the newest file inside), `path`, `detail` (what it is, with the storyboard title for walkthroughs).
- `busy`: why it cannot be deleted right now, such as a render using the cache, or `null`.

If `artifacts` is empty, tell the user there is nothing to prune and stop.

## 2. Ask what to delete

Show the user a short summary grouped as below, with sizes in MB or GB and ages in days. Name each walkthrough by its storyboard title. Leave out groups that are empty.

- **Rendered videos.** `video` artifacts. The walkthrough stays, so `render` can make the video again.
- **Stills and voice clips.** `stills` and `audio` artifacts. `still` and `voice` regenerate them, and voice clips take a few seconds per scene to speak again.
- **Walkthroughs.** `run` and `explain` artifacts, which delete the storyboard and everything inside. Point out the ones not modified in 30 days or more.
- **Cache.** `cache:remotion` is the Chrome Headless Shell, which the next render downloads again (its size in `bytes`). `cache:models` is the Kokoro voice model, which the next voice-over downloads again. `cache:bundle` is the player bundle, which the next render rebuilds in seconds. The age of a cache entry is when it was downloaded, not when it was last used.

Mark each busy artifact as in use and leave it out of the choices.

Then ask with the AskUserQuestion tool, with `multiSelect: true`. Each question takes at most 4 options, so use up to 4 questions, one per group above that has artifacts. Make each option one choice the user is likely to want, with the total size in its description, for example:

- "All rendered videos" (every `video` id).
- "Walkthroughs older than 30 days" (every `run` and `explain` id with `modified` at least 30 days ago).
- "Chrome cache" (`cache:remotion`), described as "588 MB; the next render downloads it again".
- One walkthrough or video by its title, when a group has few enough items to list each one.

The user can also answer with their own text, such as ids or "everything except the rate limit walkthrough". Map that answer to ids from the listing. If the answer is unclear, ask again rather than guessing.

If the user picks nothing, delete nothing, say so, and stop.

## 3. Delete the chosen artifacts

Before you run the command, tell the user in one line which ids you will delete and how much space that frees. Then pass exactly those ids.

```bash
{{MR_CAST}}/bin/mr-cast prune <id> <id> ...
```

The command deletes only ids from a fresh listing. It rejects an unknown id or an artifact in use, and then deletes nothing. If it rejects one, list again with step 1, tell the user what changed, and ask again.

It prints one `removed <id>` line per artifact and `freed <size>` at the end. A part inside a chosen walkthrough prints as `removed <id> (with <walkthrough id>)`. A `kept <id>` line means a render started using that cache after the listing; tell the user to prune it after the render finishes. Report what was removed and the space freed. If you deleted the current explanation, tell the user that later `explain` commands need `--name` or a new `explain init`.
