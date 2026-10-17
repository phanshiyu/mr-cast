# Upgrade notes

To upgrade, run `mr-cast upgrade` or ask Claude to "upgrade mr-cast". See [Upgrade](cli.md#upgrade) in the command reference. This page lists what changed for skills, walkthroughs and storyboards made by older versions. [CHANGELOG.md](../CHANGELOG.md) has every release.

Storyboards from older versions keep working. Steps from 0.10 that named `messages`, `events`, `entity` and so on, and nodes with `kind` and `modified: true` from 0.10 and earlier, are rewritten where the storyboard enters.

## From 0.13

0.14 never cuts text on screen. Labels that used to end in an ellipsis now wrap and shrink, and `validate` fails on any that still don't fit. See [Text on screen](storyboard.md#text-on-screen). The `arch` scene is now `graph`, and `arch` still works.

## From 0.11

0.12 replaced four skill entries with one:

| Before | After |
| --- | --- |
| `/mr-cast-review [base]` | `/mr-cast [base]` |
| `/mr-cast-render [base]` | `/mr-cast mp4 [base]` |
| `/mr-cast-explain` | `/mr-cast` (after Claude explains something) |
| `/mr-cast-explain-render` | `/mr-cast mp4` (after Claude explains something) |
| `/mr-cast-prune`, `/mr-cast-upgrade` | unchanged |

The first `mr-cast` command after the upgrade reinstalls the skills and deletes the old ones, but only files whose content shows that mr-cast wrote them. Start a new Claude Code session afterwards. Walkthroughs now live in `.mr-cast/<name>/`. A walkthrough made by 0.11 stays where it was, and `--dir .mr-cast` or `--dir .mr-cast/explain/<name>` reaches it.

## From 0.5

0.6 renamed `mr-video` and `explain-in-animation`, and 0.12 replaced both with `mr-cast`. Installing a newer version deletes their files. An explanation made by 0.5 stays in `.mr-cast/explain/`, and `--dir .mr-cast/explain` reaches it.
