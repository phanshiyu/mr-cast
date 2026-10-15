# Changelog

## 0.8.0

- **Simple mode.** Ask for a walkthrough "line by line", "like I'm new to this", "ELI5" or "for a non-native speaker", or pass `--simple` to `extract`, `explain init` or `/mr-cast-render`. Code is explained one line or small group at a time in short, plain sentences. `validate` checks step size, line coverage and sentence length.
- **Code steps.** A code scene can carry `steps`, each a line range with its own spoken words. The highlight moves when its words start, and the subtitle shows the same words.
- **Context beyond the diff.** `mr-cast snippet <file>:<a>-<b>` adds unchanged source, such as callers, types or config, to a diff walkthrough. Snippets survive a rerun of `extract`.
- **New scenes.** `table` (rows with added, removed and changed values), `chart` (bar and line, with before and after badges), `timeline` (events and spans on a time axis), and `files` (the change as a file tree with line counts and notes).
- **Upgrading.** `mr-cast upgrade` installs the latest version and refreshes the skills. Commands print a one-line notice when a newer version is on npm, from a check that runs in the background at most once a day. After `npm i -g`, the next command refreshes the installed skills. Ask Claude to "upgrade mr-cast" through the new `mr-cast-upgrade` skill.

## 0.7.0

- `mr-cast prune` lists walkthroughs, rendered videos, stills, voice clips and cached downloads with their sizes, and deletes the ids you pass. The `mr-cast-prune` skill asks which to delete.

## 0.6.1

- `install-skill` records what it installs and removes skills that later versions renamed. `mr-cast uninstall-skill` removes them all.

## 0.6.0

- Skills renamed to `mr-cast-review` and `mr-cast-explain`, with `/mr-cast-render` and `/mr-cast-explain-render`. Several renders can run at once. Rendered videos are named after the walkthrough title. `mr-cast --version`. The skills show an outline and ask before rendering.
