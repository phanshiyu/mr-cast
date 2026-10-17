# 17. The article's shape: claim headings with ids, questions with answers, and scenes that name their section

- Status: Superseded by 0019 (the article stage is removed)
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
- `mr-cast article` checks it: a missing part, a section without an id, a question without its answer or takeaway, and
  a takeaway with no question are errors; a heading of fewer than four words, a plan topic with no section, and a
  phrase about the medium outside code warn. The phrases are only those that cannot mean anything else: this video,
  the video, on screen, the viewer, storyboard, narration, and this, the next or the previous scene or slide. Fenced
  blocks and code spans are code, and a `## ` line inside a fence is not a heading. It prints the takeaways for the
  user. `--reader` prints the article with the answers removed.
  As built, the first version failed on single words (scene, slide, primitive, narrat*, viewer, animat*); review
  showed they hit ordinary words of articles about code, such as "scene graph", "synchronization primitives", "the
  window slides right", "image viewer", "narrative" and "CSS animation", so the list was narrowed and made a warning,
  which `validate` never copies into its errors.
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
- The medium phrases still miss most talk about the medium ("as shown here", "in the diagram below"), and can hit a
  real phrase, such as an app's "the viewer"; it is a warning that names the phrase, and code spans are exempt.

## Alternatives considered

- Ids derived from the heading text: rewording a heading would break every scene that names it.
- A JSON article: checkable, but no longer a document a person reads or that is worth keeping.
- Front matter listing sections: a second copy of the headings that can drift from them.
