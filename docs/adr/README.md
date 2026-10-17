# Architecture decision records

Each file records one significant decision about mr-cast: its context, the decision, its good and bad consequences,
and the alternatives considered. The format is Michael Nygard's lightweight ADR.

Record a new decision as the next numbered file, `NNNN-short-title.md`, before or with the change that makes it. Do not
rewrite an accepted ADR: write a new one and mark the old one "Superseded by NNNN".

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-local-cli-skill-remotion-kokoro.md) | A local CLI and a Claude Code skill, rendered with Remotion and voiced with Kokoro | Accepted |
| [0002](0002-storyboard-json-checked-by-validate.md) | The storyboard is JSON written by the agent and checked by `mr-cast validate` | Accepted; schema delivery superseded by 0015 |
| [0003](0003-diagrams-first-teaching-order.md) | Diagrams before code, top-down, in a teaching arc and the reviewer's order | Superseded by 0019 |
| [0004](0004-plan-page.md) | A plan page of topics, with guarded writes and an explicit record of what was built | Accepted |
| [0005](0005-quick-mode.md) | Quick mode: no questions, 1 to 3 scenes, a separate quick run | Accepted; warnings superseded by 0019 |
| [0006](0006-play-at-once-voice-in-background.md) | Play at once and voice in the background | Superseded by 0007 |
| [0007](0007-open-page-when-voice-ready.md) | Open the page only when the voice is ready | Accepted |
| [0008](0008-preread-audience.md) | A pre-read audience: no code on screen, then the order to read it in | Accepted; advice superseded by 0019 |
| [0009](0009-highlight-check.md) | The lit part matches the words: a linter plus one fresh audit subagent | Accepted; audit superseded by 0019 |
| [0010](0010-primitive-picker.md) | A primitive picker: one hidden skill, an index by kind of idea, one file per scene | Superseded by 0016, then 0019 |
| [0011](0011-deterministic-prune.md) | Pruning is decided by the CLI; the agent never deletes by hand | Accepted |
| [0012](0012-publish-from-ci.md) | Publish to npm only from CI, with trusted publishing | Accepted |
| [0013](0013-evaluation-harness.md) | Evaluate skill changes with blind graded reviewers, in isolated config | Accepted |
| [0014](0014-article-first-pipeline.md) | Article first: write a teaching article, test it with a reader, then adapt it | Superseded by 0019 |
| [0015](0015-skill-restructure.md) | Restructure the skill: schema out, branches into references, checks into the CLI | Accepted; references superseded by 0019 |
| [0016](0016-picker-as-references.md) | The primitive picker lives in the mr-cast skill's references, not in a skill of its own | Superseded by 0019 |
| [0017](0017-article-shape.md) | The article's shape: claim headings with ids, questions with answers, and scenes that name their section | Superseded by 0019 |
| [0018](0018-validate-hook.md) | A PostToolUse hook in the skill runs the checks after every write | Accepted; article part superseded by 0019 |
| [0019](0019-tools-not-opinions.md) | Tools, not opinions: the skill and `validate` give the model tools and leave the teaching to it | Accepted |
| [0020](0020-stepped-scene-additions-and-svg.md) | Callout, tint, growing diagrams, several arrays, changing tables, and an svg scene | Accepted |
