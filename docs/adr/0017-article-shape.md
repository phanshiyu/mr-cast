# 17. The article's shape: claim headings with ids, questions with answers, and scenes that name their section

- Status: Accepted
- Date: 2026-10-17

## Context

ADR 14 makes the article the content contract of the video. A contract needs a shape a script can read: `validate`
must map each scene to the idea it conveys, and the reader test must see the questions without their answers
(quality/research/planning.md, rules for the article and for critiquing it; skills.md rule 12, a validator per
intermediate artifact).

## Decision

- `article.md` in the run's directory is Markdown with a fixed skeleton: `# Title`; `## Takeaways`, a numbered list; one
  `## <the claim, as a sentence> {#id}` per idea, in teaching order; `## Questions`, each `1. question` followed by
  indented `Answer:` and `Takeaway: <n>` lines; and `## Left out`.
- With a `plan.json`, each topic kept on the plan page is the section whose id is the topic's id, in plan order.
- `mr-cast article` checks it: a missing part, a section without an id, a question without its answer or takeaway, a
  takeaway with no question, and words about the medium (scene, slide, storyboard, primitive, narration, viewer, on
  screen, the video, animation) outside code are errors; a heading of fewer than four words and a plan topic with no
  section warn. It prints the takeaways for the user. `--reader` prints the article with the answers removed.
- A scene names the section it adapts with `section`, or by its `topic` when the topic is the section. `validate`
  fails on an unknown section, and warns about a section no scene adapts (unless the storyboard lists it in `textOnly`
  with a reason), about a scene that adapts none, and about scenes out of the article's order. The order is checked
  among the diagrams and again among the code scenes, because a video shows all its diagrams before its code (ADR 3).
- `render --out` copies `article.md` beside the MP4, as it does `review.md` and `reading.md`.

## Consequences

Good:
- Dropping or reordering an idea in the adaptation is caught by a script, not by a reread.
- The article reads as an ordinary document; the ids are the only machinery in it.

Bad:
- Adding an idea in the adaptation is not caught: a scene can name a section and say more than it.
- The medium-word list can hit a real word, such as an app's "viewer"; the error names it, and code spans are exempt.

## Alternatives considered

- Ids derived from the heading text: rewording a heading would break every scene that names it.
- A JSON article: checkable, but no longer a document a person reads or that is worth keeping.
- Front matter listing sections: a second copy of the headings that can drift from them.
