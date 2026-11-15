# 38. Facts about the mix of scenes, and what the hook says on success

- Status: Proposed
- Date: 2026-11-15
- Amends: 0037 (what `validate` reports), 0019 (tools, not opinions)

## Context

Three baseline videos of merge requests used 5 of 24 scene types. Sixteen of 25 scenes were code scenes, with a run of
seven in a row. Every flow scene held a sentence in `payload`, which is drawn as one large monospace line. Two videos
had a diagram that repeated an earlier one, which viewers named the weakest scene. The before and after was told in
narration only, and a branch that added 23 named tests showed none on screen. None of this is visible without
rendering.

## Decision

`validate` reports these as warnings. Each states a fact and what the writer can look at; none says which scene to
use, which is the line ADR 0019 draws.

- **The mix line**, in `validate` and `outline` for every video: `scenes: 9 · code 7, text 1, state 1 · longest run: 7 code`.
  A warning when one type runs 4 or more scenes in a row (branch videos).
- **A flow `payload` that is a sentence**: 6 or more words and no digit, quote, bracket, equals sign or colon.
- **A diagram that repeats an earlier one**: of flow, graph, sequence, state, layers and mermaid scenes, a later one of
  at least 3 labels, 70% of whose case-folded labels are in an earlier one.
- **A case that is only spoken** (branch videos): `brief.case` has a before and an after, and no scene that answers
  "case" puts both on screen. On screen means: a compare row whose two cells differ; a code scene on a hunk with
  removed and added lines (a cited one, when the case cites hunks) that does not type; a table with a `{ before, after }`
  cell or a modified row; a tests scene with a test that says what a cell `was`; a terminal with two entries that print.
- **Tests changed and none named on screen** (branch videos): `map.json` lists added test names, no scene draws any of
  them, and no scene shows a test hunk.

The hook prints the brief line and the scene mix line on success too. Claude Code ignores plain stdout of a hook that
exits 0, and exit 2 reports a failure, so on success the hook prints a JSON reply on stdout, exit 0, whose
`hookSpecificOutput.additionalContext` holds the two lines. Its exit status is unchanged.

## Consequences

- Warnings only, so every storyboard that passed still passes.
- A run of code scenes, or a repeated diagram, can be meant; the warning states the fact and the writer decides.
