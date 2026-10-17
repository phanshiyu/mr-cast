# 3. Diagrams before code, top-down, in a teaching arc and the reviewer's order

- Status: Superseded by 0019
- Date: 2026-10-16

## Context

Early walkthroughs were code-heavy: focus limits on code scenes had to become validator errors, and a trial agent
produced a walkthrough with its diagrams late (quality/research/skills.md, "Our own evidence"). Releases 0.4.0
("top-down diagram-first storyboards") and 0.5.0 ("strict top-down scene order") answered with order rules.

Two research summaries were written for 0.20.0. quality/research/teaching.md draws on worked examples, concreteness
fading, Mayer's multimedia principles and refutation of likely misreadings. quality/research/reviewing.md draws on Google's
code review guide and studies of what reviewers need (Bacchelli and Bird 2013, Tao et al. 2012, Spadini et al. 2019,
Baum et al.). No study tested narrated diff videos, so these rules are carried over from nearby fields (CHANGELOG 0.20.0).

## Decision

- Scenes go top-down: an intent scene first, diagrams before code, the tests near the end. `validate` warns when scenes
  are out of top-down order, a diagram comes after code, or a change to several files has no diagram
  (skill/mr-cast/references/branch.md; release titles 0.4.0 and 0.5.0).
- Each video follows a teaching arc (0.20.0): one concrete case with real values runs through the whole video; the
  problem, then the approach in one sentence, then the parts; the old behaviour before the new on the same case; each
  code scene opens with the question it answers; after the case, the general rule and where it stops, a likely wrong
  reading, and what is proven and what to still check (teaching.md, Teaching arc).
- The audience sets the order. A reviewer's video follows a reviewer's questions: why, approach, how it works, what else
  it could break, tests. Code scenes go by importance with related hunks together, not file by file (reviewing.md,
  sections 1 and 2; CHANGELOG 0.20.0).

## Consequences

Good:
- The viewer has the model before the lines, and code scenes are grouped by concern as Baum's relatedness grouping
  suggests (reviewing.md).
- The order is checked, not hoped for.

Bad:
- The evidence is indirect. reviewing.md says Baum's top-down versus bottom-up guidance was not verified, and that the
  later question order is practice-derived.
- Tests-first can help understanding (Spadini); the default is tests last, with tests first left to judgment for bug fixes.

## Alternatives considered

- File order, as a diff shows it: rejected, since reviewers comment in non-alphabetical order in 44.6 percent of PRs and
  files lower in the list get less attention (reviewing.md, item 16).
- Largest diff first: it finds the main part but can break the change's logical structure (reviewing.md).
