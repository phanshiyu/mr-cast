# 14. Article first: write a teaching article, test it with a reader, then adapt it

- Status: Accepted (as built in 0.24.0; see As built)
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

## As built (0.24.0)

- The article's shape and the section checks are ADR 17. The plan page stays before the article: each kept topic is
  one section, so the article respects the user's picks.
- The reader test is one fresh Sonnet subagent per round with the article minus its answers. Instead of a second run
  without the article, each answer must quote the sentence it came from or say `not in the article`, which blocks
  outside knowledge more cheaply. The writer marks answers against its own key; it never critiques the prose.
- A named concept ("explain quicksort in a video") now makes a full video, so it gets its article. "Animate that"
  still makes a quick video when it fits in three scenes.
- Quick mode writes no article. Measured on 2 topics (binary search, exponential backoff), one writer each: a quick
  run that first wrote a few paragraphs took 25 and 30 s against 25 and 32 s without, and its video scored 6 of 8
  against 5.5 of 8 on the blind quiz. No difference either way at that size, so quick mode keeps its one job.
- Eval, old skill (0.23.0) against new, Sonnet writers, one blind Sonnet reader per video graded against fixed keys
  (small n: 7 videos per arm on 4 explanation topics, 1 per arm on 2 fixture branches). Explanations: 31.5 of 35
  (old) against 30.5 of 35 (new), at the ceiling; the new videos were shorter, 4:17 on average against 6:12.
  Branches: 12.5 of 14 against 11.5 of 14, with videos of 3:31 and 6:02 against 7:10 and 8:04. Articles read alone by
  two readers each: 61.5 of 70 on explanations, and 19 of 28 on branches, where every miss was a "where is it" or
  "which files" question; the article reference now asks a branch's article to name files and functions. One rerun of the invoice branch after that change: both readers of its article scored 6 of 7, with
  the file and location questions right.
