# 14. Article first: write a teaching article, test it with a reader, then adapt it

- Status: Proposed
- Date: 2026-10-17

## Context

Today the agent plans topics and writes the storyboard directly, so content and medium are decided together. The closest
published systems plan content before visuals: removing Code2Video's planner dropped its TeachQuiz score from 82.0 to
40.5. Plan-first generation is consistently better on long-form text (Re3, DOC, STORM), and writers drift from their plans
unless adherence is checked (DOC). No study tests writing a full prose article before adapting it to video
(quality/research/planning.md).

## Decision

- The agent first writes a medium-free teaching article that teaches the concept on its own: "explain quicksort" yields
  an article you can learn from. It starts from the reader's knowledge state, 2 to 4 takeaways, and questions with answers
  for each; one running example traced end to end; and a "left out" list. The article stage sees no list of primitives.
- A fresh simulated reader, in a new context and preferably a different model, tests it by answering the questions with
  outside knowledge blocked, once without the article and once with only the article, and by tracing the example. It is
  never asked to rate clarity (planning.md, items 27 and 28).
- At most 2 revisions, stopping when every question passes, and keeping the previous version if a passing question fails.
- A separate step adapts the article into a storyboard. It may not add, drop or reorder ideas across sections.
- `validate` checks that every article section is covered by the storyboard.

## Consequences

Good:
- The article is a deliverable of its own and a fixed content contract, so the adaptation is checkable by re-asking
  the same questions (planning.md, QAGS and TeachQuiz).
- Self-critique risk is contained: the critic is external and task-based (Huang et al.; Self-Refine).

Bad:
- More model calls and time per video; quick mode would likely skip it.
- Simulated readers learn too fast and know too much; a pass is necessary, not sufficient (planning.md, items 24 to 26).
- Untested on our harness. Run it against the current flow before adopting it (quality/research/skills.md).

## Alternatives considered

- Outline to storyboard, as Code2Video does: supported, but medium-aware from the start.
- Writer self-critique loops: rejected on Huang et al. and the self-bias studies.
