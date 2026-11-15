# 39. The parts of a change drawn as a map, not a file list

- Status: Accepted
- Date: 2026-11-15
- Amends: 0037 (what a part holds, and what the parts scene draws)

## Context

A measurement compared videos made with the old and new skill. Two of three viewers named the parts scene, a files
scene drawing the brief's parts, the weakest: "only a file list, adds nothing", and "shows sizes and names but not how
the parts connect, and does not show the risky files". Critics rated the parts question weakly answered in two of the
three new videos. A part held a name, a weight and hunks, so the scene had nothing to say about what a part is for, or
how parts relate. A file's note failed to fit in that view even at two words.

## Decision

- A brief part gains `does`, one sentence of under about 90 characters, and optionally `after`, the names of the parts
  it builds on or is called by. `validate` warns on a core or support part with no `does` and on an `after` naming no
  part. guide.md and the player's guide panel show each part's `does`.
- A files scene with parts draws a card for each part: its name, weight, `does` line, file count, + and - totals, and
  its two or three largest files with "+ N more". With `after` links the cards sit in columns, a part after the parts it
  names, with a thin connector between linked cards; with none they fill a grid, core first. A part that holds a file
  named in `brief.check` carries a "check" marker.
- Per-file notes are not drawn in that view, since `does` carries the meaning; `validate` says so. The plain tree by
  directory, for a scene with no parts, is unchanged.

## Consequences

- The tree-with-headings drawing of parts is removed, not kept beside the cards. A storyboard written for it still
  validates and now draws as cards; its parts have no `does`, so a card shows the name and the files only.
- The map is laid out by its own code (`src/utils/partsLayout.ts`), which does not share the graph scene's layout:
  cards of equal size in a few columns need none of its routing.
- A part card too short for its text is reported by the fit check, naming the part.
