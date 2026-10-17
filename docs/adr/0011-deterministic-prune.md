# 11. Pruning is decided by the CLI; the agent never deletes by hand

- Status: Accepted
- Date: 2026-10-17

## Context

Since 0.7.0, `mr-cast prune` deletes only ids from a fresh listing, but the prune skill made Claude compute the
selection itself (walkthroughs older than 30 days from `modified`, all videos by collecting ids) and map free text to
ids. Nothing stopped an `rm`. The user: "pruning should be deterministic, based off a script. the agent should not be
handrolling the delete" (v023 prune brief).

## Decision

- `mr-cast prune` takes selectors: ids, `--kind video,stills`, `--all`, `--older-than <days>` with any of them, and
  `--except <id>`. Selection lives in one function. A busy artifact is never picked and is reported, and a walkthrough
  picked with its parts counts their bytes once (CHANGELOG 0.23.0).
- `--dry-run` prints what would be removed and the bytes, and removes nothing, also with `--json`.
- `prune --choices --json` builds the menu the skill shows, each option with the exact command that deletes it.
- The skill shows the options as given, runs the chosen option's command verbatim, checks a free-text answer with
  `--dry-run` and asks before deleting, and deletes only through `mr-cast prune`, never with `rm`, `find -delete` or
  `unlink` (skill/mr-cast-prune/SKILL.md). A test checks that the installed prune skill holds no such instruction.
- An artifact's age is its newest file's mtime, not its directory's, because deleting a video bumped the run
  directory's mtime and made an old walkthrough look new (v023 merge brief, 1).

## Consequences

Good:
- What is deleted is what the menu said, computed the same way every time.
- A free-text request is shown as a dry run before anything is removed.

Bad:
- A request the selectors cannot express is refused; the skill tells the user and stops instead of improvising.

## Alternatives considered

- Keep the agent computing selections from the listing: the agent could miscount or reach for `rm`.
- Prose rules alone ("never delete what the user did not pick"): kept, but the CLI now enforces it.
